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
 * Calcula os horários de início disponíveis para um determinado serviço em um dia específico.
 */
export function calculateAvailableSlots(params) {
    const { dateStr, serviceDurationMinutes, schedule, isExceptionUnavailable = false, existingAppointments, slotIntervalMinutes = 30 } = params;
    // Se o profissional registrou folga/exceção de indisponibilidade
    if (isExceptionUnavailable || !schedule) {
        return [];
    }
    const workStart = parseDateTime(dateStr, schedule.startTime);
    const workEnd = parseDateTime(dateStr, schedule.endTime);
    const lunchStart = schedule.lunchStartTime ? parseDateTime(dateStr, schedule.lunchStartTime) : null;
    const lunchEnd = schedule.lunchEndTime ? parseDateTime(dateStr, schedule.lunchEndTime) : null;
    const availableSlots = [];
    let currentSlotStart = new Date(workStart.getTime());
    while (currentSlotStart < workEnd) {
        const currentSlotEnd = new Date(currentSlotStart.getTime() + serviceDurationMinutes * 60 * 1000);
        // 1. O slot termina após o horário de expediente?
        if (currentSlotEnd > workEnd) {
            break;
        }
        // 2. O slot conflita com o horário de almoço?
        let overlapsLunch = false;
        if (lunchStart && lunchEnd) {
            // Conflito se o início do slot for antes do fim do almoço E o fim do slot for depois do início do almoço
            if (currentSlotStart < lunchEnd && currentSlotEnd > lunchStart) {
                overlapsLunch = true;
            }
        }
        // 3. O slot conflita com algum agendamento existente?
        let overlapsAppointment = false;
        if (!overlapsLunch) {
            for (const appt of existingAppointments) {
                if (currentSlotStart < appt.endTime && currentSlotEnd > appt.startTime) {
                    overlapsAppointment = true;
                    break;
                }
            }
        }
        // 4. Se a data for hoje, não mostra horários que já passaram
        const now = new Date();
        const [curYear, curMonth, curDay] = [now.getFullYear(), now.getMonth() + 1, now.getDate()];
        const todayStr = `${curYear}-${String(curMonth).padStart(2, '0')}-${String(curDay).padStart(2, '0')}`;
        let isPastTime = false;
        if (dateStr === todayStr && currentSlotStart.getTime() <= now.getTime()) {
            isPastTime = true;
        }
        // Se estiver livre de almoço, de outros agendamentos e não for horário passado, adiciona à lista
        if (!overlapsLunch && !overlapsAppointment && !isPastTime) {
            availableSlots.push(formatTimeHHMM(currentSlotStart));
        }
        // Incrementa pelo intervalo do slot (ex: de 30 em 30 min)
        currentSlotStart = new Date(currentSlotStart.getTime() + slotIntervalMinutes * 60 * 1000);
    }
    return availableSlots;
}
