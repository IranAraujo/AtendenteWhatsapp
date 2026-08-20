/**
 * Converte string "HH:mm" e data "YYYY-MM-DD" em objeto Date JS
 */
export function parseDateTime(dateStr, timeStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes, 0, 0);
}
/**
 * Formata objeto Date JS para string "HH:mm"
 */
export function formatTimeHHMM(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}
/**
 * Calcula os horários de início disponíveis para um determinado serviço em um dia específico,
 * respeitando expediente, almoço, bloqueios, atendimentos existentes com buffer times e antecedência mínima.
 */
export function calculateAvailableSlots(params) {
    const { dateStr, serviceDurationMinutes, schedule, isExceptionUnavailable = false, existingAppointments, slotIntervalMinutes = 30, bufferTimeMinutes = 0, minimumNoticeMinutes = 0, maxFutureDays } = params;
    // 1. Se o profissional registrou folga/exceção de indisponibilidade
    if (isExceptionUnavailable || !schedule) {
        return [];
    }
    // 2. Janela Máxima de Agendamento no Futuro
    if (maxFutureDays !== undefined && maxFutureDays > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const targetDate = parseDateTime(dateStr, '00:00');
        const diffDays = Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > maxFutureDays) {
            return [];
        }
    }
    // 3. Limite Diário de Atendimentos por Profissional
    if (params.maxAppointmentsPerDay !== undefined && params.currentDayAppointmentCount !== undefined) {
        if (params.currentDayAppointmentCount >= params.maxAppointmentsPerDay) {
            return [];
        }
    }
    // 3.1 Limite Diário de Atendimentos por Plano do Estabelecimento (ex: Plano Free limite de 5/dia)
    if (params.maxDailyAppointmentsForTenant !== undefined && params.currentTenantDailyAppointmentCount !== undefined) {
        if (params.currentTenantDailyAppointmentCount >= params.maxDailyAppointmentsForTenant) {
            return [];
        }
    }
    const workStart = parseDateTime(dateStr, schedule.startTime);
    const workEnd = parseDateTime(dateStr, schedule.endTime);
    const lunchStart = schedule.lunchStartTime ? parseDateTime(dateStr, schedule.lunchStartTime) : null;
    const lunchEnd = schedule.lunchEndTime ? parseDateTime(dateStr, schedule.lunchEndTime) : null;
    const availableSlots = [];
    let currentSlotStart = new Date(workStart.getTime());
    const bufferMs = bufferTimeMinutes * 60 * 1000;
    // Antecedência Mínima para atendimentos no dia de hoje
    const now = new Date();
    const [curYear, curMonth, curDay] = [now.getFullYear(), now.getMonth() + 1, now.getDate()];
    const todayStr = `${curYear}-${String(curMonth).padStart(2, '0')}-${String(curDay).padStart(2, '0')}`;
    const minNoticeMs = (minimumNoticeMinutes > 0 ? minimumNoticeMinutes : 0) * 60 * 1000;
    const earliestAllowedTime = now.getTime() + minNoticeMs;
    while (currentSlotStart < workEnd) {
        const currentSlotEnd = new Date(currentSlotStart.getTime() + serviceDurationMinutes * 60 * 1000);
        // 4.1. O slot termina após o horário de expediente?
        if (currentSlotEnd > workEnd) {
            break;
        }
        // 4.2. O slot conflita com o horário de almoço?
        let overlapsLunch = false;
        if (lunchStart && lunchEnd) {
            if (currentSlotStart < lunchEnd && currentSlotEnd > lunchStart) {
                overlapsLunch = true;
            }
        }
        // 4.3. O slot conflita com algum bloqueio de agenda (folga parcial/total)?
        let overlapsBlock = false;
        if (params.scheduleBlocks && !overlapsLunch) {
            for (const block of params.scheduleBlocks) {
                if (!block.startTime || !block.endTime) {
                    overlapsBlock = true;
                    break;
                }
                const blockStart = parseDateTime(dateStr, block.startTime);
                const blockEnd = parseDateTime(dateStr, block.endTime);
                if (currentSlotStart < blockEnd && currentSlotEnd > blockStart) {
                    overlapsBlock = true;
                    break;
                }
            }
        }
        // 4.4. O slot conflita com algum agendamento existente (incluindo o Buffer Time)?
        let overlapsAppointment = false;
        if (!overlapsLunch && !overlapsBlock) {
            for (const appt of existingAppointments) {
                const apptStart = appt.startTime instanceof Date ? appt.startTime : new Date(appt.startTime);
                const apptEnd = appt.endTime instanceof Date ? appt.endTime : new Date(appt.endTime);
                // O atendimento existente ocupa até seu fim + o tempo de buffer de respiro
                const apptEffectiveEnd = new Date(apptEnd.getTime() + bufferMs);
                if (currentSlotStart < apptEffectiveEnd && currentSlotEnd > apptStart) {
                    overlapsAppointment = true;
                    break;
                }
            }
        }
        // 4.5. Se a data for hoje, valida horário passado e antecedência mínima
        let isPastOrTooSoon = false;
        if (dateStr === todayStr && currentSlotStart.getTime() < earliestAllowedTime) {
            isPastOrTooSoon = true;
        }
        // Se estiver 100% livre, adiciona o slot
        if (!overlapsLunch && !overlapsBlock && !overlapsAppointment && !isPastOrTooSoon) {
            availableSlots.push(formatTimeHHMM(currentSlotStart));
        }
        // Incrementa pelo intervalo do slot (ex: de 30 em 30 min)
        currentSlotStart = new Date(currentSlotStart.getTime() + slotIntervalMinutes * 60 * 1000);
    }
    return availableSlots;
}
export function selectRoundRobinProfessional(candidates, desiredTime) {
    if (!candidates || candidates.length === 0)
        return undefined;
    // Filtra candidatos disponíveis no horário desejado (se especificado)
    const eligible = desiredTime
        ? candidates.filter(c => c.availableSlots.includes(desiredTime))
        : candidates.filter(c => c.availableSlots.length > 0);
    if (eligible.length === 0)
        return undefined;
    // Ordena pelo menor número de atendimentos já marcados no dia (Workload Balance)
    eligible.sort((a, b) => a.todayCount - b.todayCount);
    return eligible[0];
}
