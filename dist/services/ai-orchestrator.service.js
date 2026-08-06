import { GoogleGenerativeAI } from '@google/generative-ai';
import { dbRepository } from './db.service.js';
import { calculateAvailableSlots } from './schedule.service.js';
import { buildSystemInstruction, aiTools } from './ai.service.js';
export async function transcribeAudioBuffer(audioBuffer, mimeType = 'audio/ogg') {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
        throw new Error('Chave GEMINI_API_KEY não configurada no servidor.');
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const cleanMimeType = mimeType.split(';')[0].trim() || 'audio/ogg';
    const audioPart = {
        inlineData: {
            data: audioBuffer.toString('base64'),
            mimeType: cleanMimeType
        }
    };
    const result = await model.generateContent([
        audioPart,
        'Transcreva este áudio do WhatsApp exatamente como falado pelo cliente em português do Brasil. Retorne APENAS a transcrição textual exata do áudio, sem saudações, pontuações desnecessárias ou explicações.'
    ]);
    const response = await result.response;
    return response.text().trim();
}
const customerSessions = new Map();
export function getOrCreateSession(customerPhone) {
    const cleanPhone = customerPhone.split('@')[0].split(':')[0].replace(/\D/g, '') || customerPhone;
    if (!customerSessions.has(cleanPhone)) {
        customerSessions.set(cleanPhone, { history: [] });
    }
    const session = customerSessions.get(cleanPhone);
    if (!session.customerPhone) {
        session.customerPhone = cleanPhone;
    }
    return session;
}
export function sanitizeUserTimeInput(text) {
    let cleaned = text.toLowerCase();
    cleaned = cleaned.replace(/(\d)oh/gi, '$10h');
    cleaned = cleaned.replace(/(\d)o\b/gi, '$10');
    cleaned = cleaned.replace(/(\d)o:/gi, '$10:');
    return cleaned;
}
export function isValidRealPhoneNumber(phone) {
    if (!phone)
        return false;
    const digits = phone.replace(/\D/g, '');
    // Telefones válidos (com ou sem 55, celular ou fixo) possuem entre 10 e 13 dígitos.
    // Identificadores de privacidade LID do WhatsApp possuem 14 ou 15 dígitos (ex: 166975980450029).
    if (digits.length >= 10 && digits.length <= 13) {
        return true;
    }
    return false;
}
export function extractPhoneNumberFromText(text) {
    const digits = text.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 13) {
        if (digits.startsWith('55') && digits.length >= 12) {
            return digits;
        }
        if (digits.length === 10 || digits.length === 11) {
            return `55${digits}`;
        }
        if (digits.length === 8 || digits.length === 9) {
            return digits;
        }
        return digits;
    }
    return null;
}
export function extractCleanCustomerName(input) {
    let name = input.trim();
    const prefixes = [
        /^meu\s+nome\s+é\s+/i,
        /^meu\s+nome\s+e\s+/i,
        /^sou\s+o\s+/i,
        /^sou\s+a\s+/i,
        /^pode\s+colocar\s+/i,
        /^me\s+chamo\s+/i,
        /^me\s+chama\s+/i,
        /^chamo\s+/i,
        /^não,?\s*(é|e)?\s*(para|pra|pro|o|a)?\s+/i,
        /^(é|e)\s*(para|pra|pro|o|a)\s+/i,
        /^para\s+/i,
        /^pro\s+/i,
        /^pra\s+/i
    ];
    for (const prefix of prefixes) {
        name = name.replace(prefix, '');
    }
    return name.trim() || input.trim();
}
export function parseNaturalLanguageDateTime(userMessage, session) {
    const lower = sanitizeUserTimeInput(userMessage);
    const now = new Date();
    let targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let dateFormattedLabel = 'Hoje';
    let hasExplicitDateInMessage = false;
    if (lower.includes('amanha') || lower.includes('amanhã')) {
        targetDate.setDate(targetDate.getDate() + 1);
        dateFormattedLabel = 'Amanhã';
        hasExplicitDateInMessage = true;
    }
    else if (lower.includes('hoje')) {
        dateFormattedLabel = 'Hoje';
        hasExplicitDateInMessage = true;
    }
    else if (lower.includes('sabado') || lower.includes('sábado')) {
        const currentDay = targetDate.getDay();
        let daysUntilSaturday = (6 - currentDay + 7) % 7;
        if (daysUntilSaturday === 0)
            daysUntilSaturday = 7;
        targetDate.setDate(targetDate.getDate() + daysUntilSaturday);
        dateFormattedLabel = 'Sábado';
        hasExplicitDateInMessage = true;
    }
    else if (lower.includes('domingo')) {
        const currentDay = targetDate.getDay();
        let daysUntilSun = (0 - currentDay + 7) % 7;
        if (daysUntilSun === 0)
            daysUntilSun = 7;
        targetDate.setDate(targetDate.getDate() + daysUntilSun);
        dateFormattedLabel = 'Domingo';
        hasExplicitDateInMessage = true;
    }
    else if (lower.includes('segunda')) {
        const currentDay = targetDate.getDay();
        let days = (1 - currentDay + 7) % 7;
        if (days === 0)
            days = 7;
        targetDate.setDate(targetDate.getDate() + days);
        dateFormattedLabel = 'Segunda-feira';
        hasExplicitDateInMessage = true;
    }
    else if (lower.includes('terça') || lower.includes('terca')) {
        const currentDay = targetDate.getDay();
        let days = (2 - currentDay + 7) % 7;
        if (days === 0)
            days = 7;
        targetDate.setDate(targetDate.getDate() + days);
        dateFormattedLabel = 'Terça-feira';
        hasExplicitDateInMessage = true;
    }
    else if (lower.includes('quarta')) {
        const currentDay = targetDate.getDay();
        let days = (3 - currentDay + 7) % 7;
        if (days === 0)
            days = 7;
        targetDate.setDate(targetDate.getDate() + days);
        dateFormattedLabel = 'Quarta-feira';
        hasExplicitDateInMessage = true;
    }
    else if (lower.includes('quinta')) {
        const currentDay = targetDate.getDay();
        let days = (4 - currentDay + 7) % 7;
        if (days === 0)
            days = 7;
        targetDate.setDate(targetDate.getDate() + days);
        dateFormattedLabel = 'Quinta-feira';
        hasExplicitDateInMessage = true;
    }
    else if (lower.includes('sexta')) {
        const currentDay = targetDate.getDay();
        let days = (5 - currentDay + 7) % 7;
        if (days === 0)
            days = 7;
        targetDate.setDate(targetDate.getDate() + days);
        dateFormattedLabel = 'Sexta-feira';
        hasExplicitDateInMessage = true;
    }
    else if (session?.lastQueryDateStr) {
        const [y, m, d] = session.lastQueryDateStr.split('-').map(Number);
        targetDate = new Date(y, m - 1, d);
        dateFormattedLabel = session.lastQueryDateLabel || 'no dia escolhido';
    }
    const dateMatch = lower.match(/dia\s+(\d{1,2})\/(\d{1,2})/i) || lower.match(/(\d{1,2})\/(\d{1,2})/);
    if (dateMatch) {
        const day = parseInt(dateMatch[1], 10);
        const month = parseInt(dateMatch[2], 10) - 1;
        targetDate = new Date(now.getFullYear(), month, day);
        dateFormattedLabel = `dia ${day}/${month + 1}`;
        hasExplicitDateInMessage = true;
    }
    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const d = String(targetDate.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    if (session) {
        session.lastQueryDateStr = dateStr;
        session.lastQueryDateLabel = dateFormattedLabel;
    }
    let timeStr = null;
    let hasTimeSpecified = false;
    const timeMatch = lower.match(/\b(\d{1,2})\s*:\s*(\d{2})\b/) ||
        lower.match(/\b(\d{1,2})\s*h\s*(\d{2})?\b/) ||
        lower.match(/\bas\s*(\d{1,2})\b/) ||
        lower.match(/\bàs\s*(\d{1,2})\b/) ||
        lower.match(/\bpara\s*as\s*(\d{1,2})\b/) ||
        lower.match(/\bpras\s*(\d{1,2})\b/) ||
        lower.match(/\bpara\s*às\s*(\d{1,2})\b/) ||
        lower.match(/\b(\d{1,2})\s*hrs\b/) ||
        lower.match(/\b(\d{1,2})\s*horas\b/);
    if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        let minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        if (hours < 7 && !lower.includes('manhã') && !lower.includes('manha')) {
            hours += 12;
        }
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
            timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            hasTimeSpecified = true;
        }
    }
    return {
        dateStr,
        timeStr,
        dateFormattedLabel,
        hasTimeSpecified,
        hasExplicitDateInMessage
    };
}
export function formatHumanSlots(slots, periodFilter) {
    if (!slots || slots.length === 0) {
        return 'Nenhum horário disponível para esta data.';
    }
    let filteredSlots = slots;
    if (periodFilter === 'morning') {
        filteredSlots = slots.filter(s => parseInt(s.split(':')[0], 10) < 12);
    }
    else if (periodFilter === 'afternoon') {
        filteredSlots = slots.filter(s => parseInt(s.split(':')[0], 10) >= 12);
    }
    if (filteredSlots.length === 0) {
        filteredSlots = slots;
    }
    return filteredSlots.map(s => `• *${s}*`).join('\n');
}
export class AiOrchestratorService {
    async executeToolCall(tenantId, functionName, args) {
        if (functionName === 'list_services') {
            const services = await dbRepository.listServices(tenantId);
            return { result: { status: 'SUCESSO', servicos: services } };
        }
        if (functionName === 'list_products') {
            const products = await dbRepository.listProducts(tenantId);
            return { result: { status: 'SUCESSO', produtos: products } };
        }
        if (functionName === 'list_professionals') {
            const profs = await dbRepository.listProfessionals(tenantId, args.serviceId);
            return { result: { status: 'SUCESSO', profissionais: profs } };
        }
        if (functionName === 'get_available_slots') {
            const { professionalId, serviceId, dateStr } = args;
            const targetProfId = professionalId || 'prof-1';
            const prof = await dbRepository.getProfessionalById(tenantId, targetProfId);
            const services = await dbRepository.listServices(tenantId);
            const service = services.find(s => s.id === serviceId) || services[0];
            const serviceDuration = service ? service.durationMinutes : 30;
            let scheduleToUse = { startTime: '08:00', endTime: '18:00', lunchStartTime: '12:00', lunchEndTime: '13:00' };
            if (prof && prof.workSchedule) {
                const [y, m, d] = dateStr.split('-').map(Number);
                const targetDate = new Date(y, m - 1, d);
                const dayOfWeek = targetDate.getDay();
                if (prof.workSchedule.workDays && prof.workSchedule.workDays.length > 0 && !prof.workSchedule.workDays.includes(dayOfWeek)) {
                    return { result: { data: dateStr, horariosDisponiveis: [] } };
                }
                scheduleToUse = {
                    startTime: prof.workSchedule.startTime || '08:00',
                    endTime: prof.workSchedule.endTime || '18:00',
                    lunchStartTime: prof.workSchedule.lunchStartTime || null,
                    lunchEndTime: prof.workSchedule.lunchEndTime || null
                };
            }
            const existingAppointments = await dbRepository.getAppointmentsForProfessional(targetProfId, dateStr);
            const slots = calculateAvailableSlots({
                dateStr,
                serviceDurationMinutes: serviceDuration,
                schedule: scheduleToUse,
                existingAppointments: existingAppointments.map(a => ({ startTime: a.startTime, endTime: a.endTime })),
                slotIntervalMinutes: 30
            });
            return { result: { data: dateStr, horariosDisponiveis: slots } };
        }
        if (functionName === 'create_appointment') {
            const { professionalId, serviceId, customerName, customerPhone, dateStr, timeStr } = args;
            const profs = await dbRepository.listProfessionals(tenantId);
            const services = await dbRepository.listServices(tenantId);
            const targetProfId = professionalId || profs[0]?.id || 'prof-1';
            const targetServiceId = serviceId || services[0]?.id || 'srv-1';
            const cleanName = extractCleanCustomerName(customerName || 'Cliente');
            const service = services.find(s => s.id === targetServiceId) || services[0];
            const duration = service ? service.durationMinutes : 30;
            const [year, month, day] = dateStr.split('-').map(Number);
            const [hours, minutes] = timeStr.split(':').map(Number);
            const startTime = new Date(year, month - 1, day, hours, minutes);
            const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
            const existingAppt = await dbRepository.findActiveAppointmentByPhone(tenantId, customerPhone);
            if (existingAppt) {
                const updated = await dbRepository.updateAppointmentTime(existingAppt.id, startTime, endTime);
                if (updated) {
                    updated.customerName = cleanName;
                    return {
                        result: {
                            status: 'SUCESSO',
                            mensagem: `Agendamento existente de ${cleanName} alterado com sucesso para o novo horário! O horário antigo foi liberado.`,
                            agendamentoId: updated.id
                        },
                        appointmentCreated: updated
                    };
                }
            }
            const newAppt = await dbRepository.createAppointment({
                tenantId,
                professionalId: professionalId || 'prof-1',
                serviceId: serviceId || 'srv-1',
                customerName: cleanName,
                customerPhone,
                startTime,
                endTime,
                status: 'CONFIRMED'
            });
            return {
                result: {
                    status: 'SUCESSO',
                    mensagem: `Novo agendamento criado com sucesso para ${cleanName} às ${timeStr} do dia ${dateStr}!`,
                    agendamentoId: newAppt.id
                },
                appointmentCreated: newAppt
            };
        }
        if (functionName === 'reschedule_appointment') {
            const { customerPhone, newDateStr, newTimeStr } = args;
            const existingAppt = await dbRepository.findActiveAppointmentByPhone(tenantId, customerPhone);
            if (!existingAppt) {
                return { result: { status: 'ERRO', mensagem: 'Nenhum agendamento ativo foi encontrado para este telefone.' } };
            }
            const [year, month, day] = newDateStr.split('-').map(Number);
            const [hours, minutes] = newTimeStr.split(':').map(Number);
            const startTime = new Date(year, month - 1, day, hours, minutes);
            const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
            const updatedAppt = await dbRepository.updateAppointmentTime(existingAppt.id, startTime, endTime);
            return {
                result: {
                    status: 'SUCESSO',
                    mensagem: `Agendamento alterado com sucesso para ${newDateStr} às ${newTimeStr}.`,
                    agendamentoId: existingAppt.id
                },
                appointmentCreated: updatedAppt
            };
        }
        if (functionName === 'cancel_appointment') {
            const { customerPhone } = args;
            const cancelled = await dbRepository.cancelAppointmentByPhone(tenantId, customerPhone || '5511999998888');
            const apptId = cancelled ? cancelled.id : undefined;
            return {
                result: { status: 'SUCESSO', mensagem: 'Agendamento cancelado com sucesso no banco de dados. Horário liberado!' },
                appointmentCancelledId: apptId
            };
        }
        return { result: { error: `Função ${functionName} não encontrada.` } };
    }
    async processIncomingMessage(tenantId, customerPhone, userMessage, customConfig) {
        const tenant = await dbRepository.getTenantById(tenantId);
        if (!tenant) {
            return { replyText: 'Desculpe, estabelecimento não encontrado.', functionCallsExecuted: [] };
        }
        const session = getOrCreateSession(customerPhone);
        if (customConfig?.pushName) {
            session.suggestedPushName = extractCleanCustomerName(customConfig.pushName);
        }
        session.history.push({ role: 'user', text: userMessage });
        const systemPrompt = customConfig?.systemPrompt || tenant.aiConfig.systemPrompt;
        const businessInfo = customConfig?.businessInfo || tenant.aiConfig.businessInfo;
        const services = await dbRepository.listServices(tenantId);
        const profs = await dbRepository.listProfessionals(tenantId);
        let teamAndServicesText = '';
        for (const p of profs) {
            teamAndServicesText += `\n• Profissional: ${p.name}\n`;
            let pServices = services;
            if (p.servicesHandled && p.servicesHandled.length > 0) {
                pServices = services.filter(s => p.servicesHandled.includes(s.id));
            }
            pServices.forEach(s => {
                teamAndServicesText += `  - ${s.name}: R$ ${s.price.toFixed(2)} (${s.durationMinutes} min)\n`;
            });
            if (p.workSchedule) {
                teamAndServicesText += `  - Horário: ${p.workSchedule.startTime || '08:00'} às ${p.workSchedule.endTime || '18:00'}\n`;
            }
        }
        const sessionContextText = `
CONTEXTO DO CLIENTE EM ATENDIMENTO:
- Telefone do WhatsApp do cliente: ${customerPhone}
- Nome já informado pelo cliente: ${session.customerName || 'Ainda não informado'}
- Horário em negociação: ${session.pendingBookingTime ? `${session.pendingBookingDateStr || 'Data pendente'} às ${session.pendingBookingTime}` : 'Nenhum'}
`;
        const fullInstruction = `${buildSystemInstruction({
            tenantName: tenant.name,
            systemPrompt,
            businessInfo
        })}

EQUIPE DE PROFISSIONAIS E SERVIÇOS QUE CADA UM REALIZA:
${teamAndServicesText}

${sessionContextText}

DATA E HORA ATUAL DO SISTEMA: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}

ORIENTAÇÃO CRÍTICA DE RESPOSTA HUMANA:
1. Responda a QUALQUER pergunta de forma natural, simpática e humanizada como uma recepcionista real.
2. NUNCA USE RESPOSTAS PRONTAS OU SCRIPTS RIGIDOS. Responda sempre de forma fluida baseada em todo o histórico da conversa.
3. Se o cliente perguntar sobre os serviços ou não especificar o profissional desejado, apresente a lista dos profissionais e os serviços de cada um, perguntando com qual ele prefere agendar!
4. Para confirmar qualquer agendamento, você DEVE solicitar o NOME COMPLETO e o TELEFONE do cliente. Se ele enviar o nome em uma mensagem e o telefone na mensagem seguinte, lembre-se do nome e prossiga sem reiniciar a conversa!`;
        const apiKey = process.env.GEMINI_API_KEY || '';
        const formattedHistory = [];
        for (const h of session.history.slice(0, -1)) {
            if (h.text && typeof h.text === 'string' && h.text.trim()) {
                formattedHistory.push({
                    role: h.role === 'user' ? 'user' : 'model',
                    parts: [{ text: h.text }]
                });
            }
        }
        try {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: 'gemini-3.5-flash-lite',
                systemInstruction: fullInstruction,
                tools: [{ functionDeclarations: aiTools }]
            });
            const chat = model.startChat({
                history: formattedHistory
            });
            const result = await chat.sendMessage(userMessage);
            const response = await result.response;
            const functionCalls = response.functionCalls();
            const executedTools = [];
            let appointmentCreated = undefined;
            let appointmentCancelledId = undefined;
            if (functionCalls && functionCalls.length > 0) {
                for (const call of functionCalls) {
                    executedTools.push(call.name);
                    const toolExec = await this.executeToolCall(tenantId, call.name, call.args);
                    if (toolExec.appointmentCreated) {
                        appointmentCreated = toolExec.appointmentCreated;
                    }
                    if (toolExec.appointmentCancelledId) {
                        appointmentCancelledId = toolExec.appointmentCancelledId;
                    }
                    const secondResult = await chat.sendMessage([
                        {
                            functionResponse: {
                                name: call.name,
                                response: {
                                    name: call.name,
                                    content: toolExec.result
                                }
                            }
                        }
                    ]);
                    const secondResponse = await secondResult.response;
                    const finalReply = secondResponse.text();
                    session.history.push({ role: 'model', text: finalReply });
                    return {
                        replyText: finalReply,
                        functionCallsExecuted: executedTools,
                        appointmentCreated,
                        appointmentCancelledId
                    };
                }
            }
            const finalReply = response.text();
            session.history.push({ role: 'model', text: finalReply });
            return {
                replyText: finalReply,
                functionCallsExecuted: executedTools,
                appointmentCreated,
                appointmentCancelledId
            };
        }
        catch (error) {
            console.warn('[Gemini Live LLM Engine Exception]:', error.message);
            const simResult = await this.simulateHumanReceptionist(tenantId, customerPhone, userMessage, systemPrompt, session);
            session.history.push({ role: 'model', text: simResult.replyText });
            return simResult;
        }
    }
    async simulateHumanReceptionist(tenantId, customerPhone, userMessage, customPrompt, session) {
        const lower = sanitizeUserTimeInput(userMessage);
        const executedTools = [];
        const services = await dbRepository.listServices(tenantId);
        const profs = await dbRepository.listProfessionals(tenantId);
        const defaultProfId = session?.pendingBookingProfId || profs[0]?.id || 'prof-1';
        const defaultServiceId = session?.pendingBookingServiceId || services[0]?.id || 'srv-1';
        // Extrai data e horário contextuais logo no início da função
        const { dateStr, timeStr, dateFormattedLabel, hasTimeSpecified, hasExplicitDateInMessage } = parseNaturalLanguageDateTime(userMessage, session);
        // Extrai telefone se o cliente enviou um número no texto
        const phoneInText = extractPhoneNumberFromText(userMessage);
        if (phoneInText && session) {
            session.customerPhone = phoneInText;
            // Recupera o horário pendente se ele tiver sido mencionado no histórico recente
            if (!session.pendingBookingTime) {
                for (let i = session.history.length - 1; i >= 0; i--) {
                    const histText = session.history[i].text;
                    const timeMatch = histText.match(/\b(\d{1,2})\s*:\s*(\d{2})\b/) || histText.match(/\b(\d{1,2})\s*h\s*(\d{2})?\b/);
                    if (timeMatch) {
                        let hours = parseInt(timeMatch[1], 10);
                        let minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
                        if (hours < 7 && !histText.toLowerCase().includes('manhã'))
                            hours += 12;
                        session.pendingBookingTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
                        if (!session.pendingBookingDateStr) {
                            const tomorrow = new Date();
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            const y = tomorrow.getFullYear();
                            const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
                            const d = String(tomorrow.getDate()).padStart(2, '0');
                            session.pendingBookingDateStr = `${y}-${m}-${d}`;
                            session.lastQueryDateLabel = 'Amanhã';
                        }
                        break;
                    }
                }
            }
        }
        // Handler de Resposta a Lembretes (1 para CONFIRMAR, 2 para CANCELAR)
        const isExplicitReminderConfirm = lower === '1' || lower === 'sim' || lower.includes('confirmo') || lower.includes('confirmado') || lower.includes('pode confirmar') || lower.includes('confirmar');
        const isExplicitReminderCancel = lower === '2' || lower === 'cancelar' || lower.includes('cancela') || lower.includes('não vou poder') || lower.includes('nao vou poder') || lower.includes('não posso');
        if ((isExplicitReminderConfirm || isExplicitReminderCancel) && !session?.pendingBookingTime && !session?.pendingExistingApptChoice) {
            const activeAppt = await dbRepository.findActiveAppointmentByPhone(tenantId, customerPhone);
            if (activeAppt) {
                const apptDate = new Date(activeAppt.startTime);
                const dateFormatted = `${String(apptDate.getDate()).padStart(2, '0')}/${String(apptDate.getMonth() + 1).padStart(2, '0')}`;
                const timeStrFormatted = `${String(apptDate.getHours()).padStart(2, '0')}:${String(apptDate.getMinutes()).padStart(2, '0')}`;
                const clientNameStr = activeAppt.customerName || session?.customerName || 'Cliente';
                if (isExplicitReminderConfirm) {
                    activeAppt.status = 'CONFIRMED';
                    await dbRepository.updateAppointmentDetails(activeAppt.id, { status: 'CONFIRMED' });
                    return {
                        replyText: `Maravilha, *${clientNameStr}*! Seu agendamento para *${dateFormatted} às ${timeStrFormatted}* foi **CONFIRMADO** com sucesso! Te esperamos aqui. `,
                        functionCallsExecuted: ['confirm_appointment']
                    };
                }
                else if (isExplicitReminderCancel) {
                    activeAppt.status = 'CANCELLED';
                    await dbRepository.updateAppointmentDetails(activeAppt.id, { status: 'CANCELLED' });
                    return {
                        replyText: `Entendido, *${clientNameStr}*! Seu agendamento para *${dateFormatted} às ${timeStrFormatted}* foi **CANCELADO**. Se quiser agendar para outro dia ou horário, é só nos chamar por aqui! `,
                        functionCallsExecuted: ['cancel_appointment']
                    };
                }
            }
        }
        // 0. Saudação Pura / Cumprimento ("boa tarde", "bom dia", "boa noite", "oi", "olá", "tudo bem?")
        const isPureGreeting = /^(bom\s*dia|boa\s*tarde|boa\s*noite|olá|ola|oi|opa|tudo\s*bem|fala|e\s*ai|e\s*aí)[!.\s]*$/i.test(lower.trim());
        if (isPureGreeting) {
            const nowHour = new Date().getHours();
            let greetingTime = 'Olá';
            if (nowHour >= 5 && nowHour < 12)
                greetingTime = 'Bom dia';
            else if (nowHour >= 12 && nowHour < 18)
                greetingTime = 'Boa tarde';
            else
                greetingTime = 'Boa noite';
            const tenantObj = await dbRepository.getTenantById(tenantId);
            const tenantName = tenantObj ? tenantObj.name : 'nosso estabelecimento';
            return {
                replyText: `Olá! ${greetingTime}! Seja muito bem-vindo(a) à *${tenantName}*. 😊\n\nComo posso te ajudar hoje? Você pode agendar um horário, consultar nossos serviços ou tirar dúvidas sobre o atendimento!`,
                functionCallsExecuted: []
            };
        }
        // 1. Agradecimento e Despedida
        if (lower.includes('obrigad') || lower.includes('valeu') || lower.includes('tmj') || lower.includes('muito obrigado') || lower.includes('flw')) {
            const name = session?.customerName ? `, ${session.customerName}` : '';
            return { replyText: `Por nada${name}! Tamo junto!  Qualquer coisa só me chamar aqui.`, functionCallsExecuted: [] };
        }
        // 2. Pergunta de Identidade ("como é seu nome?", "quem é você?", "quem fala?")
        if (lower.includes('seu nome') || lower.includes('como te chamo') || lower.includes('quem e voce') || lower.includes('quem é você') || lower.includes('com quem falo') || lower.includes('quem ta falando') || lower.includes('quem tá falando')) {
            return {
                replyText: `Sou a Camila, assistente de atendimento e agendamentos!  E com quem eu tô falando?`,
                functionCallsExecuted: []
            };
        }
        // 3. SE EXISTE UM HORÁRIO EM NEGOCIAÇÃO E ESTAMOS COLETANDO NOME / TELEFONE
        if (session?.pendingBookingTime) {
            const targetDateStr = session.pendingBookingDateStr || dateStr;
            const targetTimeStr = session.pendingBookingTime;
            const targetProfId = session.pendingBookingProfId || defaultProfId;
            const targetServiceId = session.pendingBookingServiceId || defaultServiceId;
            // Se a mensagem for afirmação ("sim", "pra mim", "isso", "mesmo", "sou eu") e temos o nome do perfil
            const isSelfConfirm = lower.includes('sim') || lower.includes('mim') || lower.includes('isso') || lower.includes('mesmo') || lower.includes('sou eu') || lower.includes('meu nome') || lower.includes('pra mim');
            if (!session.customerName) {
                if (isSelfConfirm && session.suggestedPushName) {
                    session.customerName = session.suggestedPushName;
                }
                else if (!phoneInText && !hasTimeSpecified) {
                    session.customerName = extractCleanCustomerName(userMessage);
                }
            }
            // Se temos o nome mas não temos um número de telefone real válido (ex: simulador ou conta WhatsApp LID)
            const hasRealPhone = isValidRealPhoneNumber(phoneInText || session.customerPhone || customerPhone);
            if (session.customerName && !hasRealPhone) {
                return {
                    replyText: `Prazer, *${session.customerName}*! Anotado aqui. Me manda por favor o seu número de telefone/WhatsApp com DDD para eu fechar seu agendamento das *${targetTimeStr}* e te mandar os lembretes? `,
                    functionCallsExecuted: []
                };
            }
            // Se temos Nome E Telefone Válido -> Cria o agendamento imediatamente!
            const clientName = session.customerName || 'Cliente';
            const clientPhone = (phoneInText && isValidRealPhoneNumber(phoneInText))
                ? phoneInText
                : (isValidRealPhoneNumber(session.customerPhone) ? session.customerPhone : customerPhone);
            const exec = await this.executeToolCall(tenantId, 'create_appointment', {
                professionalId: targetProfId,
                serviceId: targetServiceId,
                customerName: clientName,
                customerPhone: clientPhone,
                dateStr: targetDateStr,
                timeStr: targetTimeStr
            });
            executedTools.push('create_appointment');
            session.pendingBookingTime = undefined;
            session.pendingBookingDateStr = undefined;
            const [y, m, d] = targetDateStr.split('-');
            return {
                replyText: `Show de bola, *${clientName}*! Seu horário para *${session.lastQueryDateLabel || 'o dia escolhido'} (${d}/${m}/${y})* às *${targetTimeStr}* está **confirmado com sucesso**! `,
                functionCallsExecuted: executedTools,
                appointmentCreated: exec.appointmentCreated
            };
        }
        // 4. Escolha de horário exata (ex: "marque as 14", "as 14h", "pode ser 14")
        if (hasTimeSpecified && timeStr) {
            const existingAppt = await dbRepository.findActiveAppointmentByPhone(tenantId, customerPhone);
            const isExplicitChangeRequest = lower.includes('mudar') || lower.includes('reagendar') || lower.includes('trocar') || lower.includes('alterar');
            if (existingAppt && !isExplicitChangeRequest) {
                const apptDateStr = existingAppt.startTime.toISOString().split('T')[0];
                const [y, m, d] = apptDateStr.split('-');
                const apptTimeStr = existingAppt.startTime.toTimeString().substring(0, 5);
                if (session) {
                    session.pendingExistingApptChoice = { newDateStr: dateStr, newTimeStr: timeStr, dateFormattedLabel };
                }
                return {
                    replyText: `Vi que você já tem um agendamento pra *${d}/${m} às ${apptTimeStr}*!  Quer **mudar esse horário** pra *${dateFormattedLabel} às ${timeStr}* ou criar um **novo agendamento**?`,
                    functionCallsExecuted: []
                };
            }
            const slotsExec = await this.executeToolCall(tenantId, 'get_available_slots', { professionalId: defaultProfId, serviceId: defaultServiceId, dateStr });
            executedTools.push('get_available_slots');
            const availableSlots = slotsExec.result.horariosDisponiveis || [];
            if (availableSlots.includes(timeStr)) {
                if (session) {
                    session.pendingBookingTime = timeStr;
                    session.pendingBookingDateStr = dateStr;
                }
                if (!session?.customerName) {
                    if (session?.suggestedPushName) {
                        return {
                            replyText: `Fechado! O horário das *${timeStr}* para *${dateFormattedLabel}* está vago! ️ O agendamento é em seu nome mesmo, *${session.suggestedPushName}*, ou para outra pessoa?`,
                            functionCallsExecuted: executedTools
                        };
                    }
                    return {
                        replyText: `Fechado! O horário das *${timeStr}* para *${dateFormattedLabel}* está vago! ️ Me fala seu nome completo para eu colocar na agenda?`,
                        functionCallsExecuted: executedTools
                    };
                }
                const hasValidRealPhone = isValidRealPhoneNumber(phoneInText || session?.customerPhone || customerPhone);
                if (!hasValidRealPhone) {
                    return {
                        replyText: `Perfeito, *${session.customerName}*! O horário das *${timeStr}* para *${dateFormattedLabel}* é seu! ️ Me envia o seu número de WhatsApp com DDD para eu confirmar e te mandar os lembretes?`,
                        functionCallsExecuted: executedTools
                    };
                }
                const clientName = session.customerName || 'Cliente';
                const clientPhone = phoneInText || session.customerPhone || customerPhone;
                const exec = await this.executeToolCall(tenantId, 'create_appointment', {
                    professionalId: defaultProfId,
                    serviceId: defaultServiceId,
                    customerName: clientName,
                    customerPhone: clientPhone,
                    dateStr,
                    timeStr
                });
                executedTools.push('create_appointment');
                const [y, m, d] = dateStr.split('-');
                const replyMsg = existingAppt
                    ? `Show de bola, *${clientName}*! Seu horário foi **alterado com sucesso** para *${dateFormattedLabel} (${d}/${m}/${y})* às *${timeStr}*! O horário anterior foi liberado. `
                    : `Show de bola, *${clientName}*! Seu horário para *${dateFormattedLabel} (${d}/${m}/${y})* às *${timeStr}* tá confirmado! `;
                if (session) {
                    session.pendingBookingTime = undefined;
                    session.pendingBookingDateStr = undefined;
                }
                return {
                    replyText: replyMsg,
                    functionCallsExecuted: executedTools,
                    appointmentCreated: exec.appointmentCreated
                };
            }
            else {
                return {
                    replyText: `Poxa, às *${timeStr}* já tá ocupado para *${dateFormattedLabel}*.  Olha os horários vagos:\n${formatHumanSlots(availableSlots)}`,
                    functionCallsExecuted: executedTools
                };
            }
        }
        // 5. Perguntas diretas de Serviços / Profissionais
        if (lower.includes('profissional') || lower.includes('atendente') || lower.includes('quem atende') || lower.includes('quem sao') || lower.includes('serviço') || lower.includes('servico') || lower.includes('opções') || lower.includes('opcoes') || lower.includes('catalogo') || lower.includes('catálogo') || lower.includes('oferecido') || lower.includes('trabalham') || lower.includes('fazem')) {
            executedTools.push('list_services');
            let breakdown = 'Conheça nossa equipe e os serviços que cada profissional realiza:\n\n';
            for (const p of profs) {
                breakdown += ` *${p.name}*\n`;
                let pServices = services;
                if (p.servicesHandled && p.servicesHandled.length > 0) {
                    pServices = services.filter(s => p.servicesHandled.includes(s.id));
                }
                pServices.forEach(s => {
                    breakdown += `  • *${s.name}*: R$ ${s.price.toFixed(2)} (${s.durationMinutes} min)\n`;
                });
                if (p.workSchedule) {
                    breakdown += `  ⏰ Horário: ${p.workSchedule.startTime || '08:00'} às ${p.workSchedule.endTime || '18:00'}\n`;
                }
                breakdown += `\n`;
            }
            breakdown += `Com qual desses profissionais você prefere agendar seu horário? `;
            return {
                replyText: breakdown,
                functionCallsExecuted: executedTools
            };
        }
        // 6. Resposta afirmativa do cliente para ver horários (ex: "quero", "sim", "pode ser", "me mostra", "quero ver")
        const lastModelMsg = session?.history ? (session.history.filter(h => h.role === 'model').slice(-1)[0]?.text || '') : '';
        const lastBotAskedAboutSlots = lastModelMsg.toLowerCase().includes('horário') || lastModelMsg.toLowerCase().includes('horario') || lastModelMsg.toLowerCase().includes('semana') || lastModelMsg.toLowerCase().includes('disponíveis');
        const isAffirmativeSlotsRequest = lower === 'quero' ||
            lower === 'sim' ||
            lower === 'pode ser' ||
            lower.includes('quero ver') ||
            lower.includes('pode mostrar') ||
            lower.includes('me mostra') ||
            lower.includes('mostra') ||
            lower.includes('ver horários') ||
            lower.includes('ver horarios');
        if (isAffirmativeSlotsRequest) {
            const slotsExec = await this.executeToolCall(tenantId, 'get_available_slots', { professionalId: defaultProfId, serviceId: defaultServiceId, dateStr });
            executedTools.push('get_available_slots');
            let availableSlots = slotsExec.result.horariosDisponiveis || [];
            let targetDateFormatted = dateFormattedLabel;
            let targetDateStr = dateStr;
            // Se hoje não houver mais horários livres, consulta automaticamente o dia de amanhã
            if (availableSlots.length === 0 && dateFormattedLabel === 'Hoje') {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const y = tomorrow.getFullYear();
                const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
                const d = String(tomorrow.getDate()).padStart(2, '0');
                targetDateStr = `${y}-${m}-${d}`;
                targetDateFormatted = 'Amanhã';
                const tomSlotsExec = await this.executeToolCall(tenantId, 'get_available_slots', { professionalId: defaultProfId, serviceId: defaultServiceId, dateStr: targetDateStr });
                availableSlots = tomSlotsExec.result.horariosDisponiveis || [];
            }
            const [y, m, d] = targetDateStr.split('-');
            return {
                replyText: `Com certeza! Temos estes horários livres para *${targetDateFormatted} (${d}/${m})*:\n\n${formatHumanSlots(availableSlots)}\n\nQual desses fica melhor para você? `,
                functionCallsExecuted: executedTools
            };
        }
        // 7. Consulta de Dia / Período
        const isPeriodOrDayQuery = hasExplicitDateInMessage ||
            lower.includes('pela manhã') ||
            lower.includes('pela manha') ||
            lower.includes('pela tarde') ||
            lower.includes('pela noite') ||
            lower.includes('de manhã') ||
            lower.includes('de manha') ||
            lower.includes('de tarde') ||
            lower.includes('de noite') ||
            lower.includes('horario') ||
            lower.includes('horário') ||
            lower.includes('vaga') ||
            lower.includes('vagas');
        if (isPeriodOrDayQuery) {
            const slotsExec = await this.executeToolCall(tenantId, 'get_available_slots', { professionalId: defaultProfId, serviceId: defaultServiceId, dateStr });
            executedTools.push('get_available_slots');
            const availableSlots = slotsExec.result.horariosDisponiveis || [];
            let periodFilter = undefined;
            if (/\bmanhã\b|\bmanha\b/i.test(lower))
                periodFilter = 'morning';
            else if (/\btarde\b/i.test(lower))
                periodFilter = 'afternoon';
            const periodLabel = periodFilter === 'morning' ? ' pela manhã' : periodFilter === 'afternoon' ? ' pela tarde' : '';
            const [y, m, d] = dateStr.split('-');
            return {
                replyText: `Para *${dateFormattedLabel} (${d}/${m})*${periodLabel}, temos estes horários livres na agenda:\n\n${formatHumanSlots(availableSlots, periodFilter)}\n\nQual desses fica melhor para você? `,
                functionCallsExecuted: executedTools
            };
        }
        // 7. Detecta se o cliente mencionou algum serviço específico do catálogo
        const matchedService = services.find(s => {
            const sNameLower = s.name.toLowerCase();
            return lower.includes(sNameLower) || sNameLower.split(' ').filter(w => w.length > 3).some(w => lower.includes(w));
        });
        if (matchedService && session) {
            session.pendingBookingServiceId = matchedService.id;
        }
        // Intenção Explícita de Agendamento ou Mção de Serviço
        const isExplicitBookingCommand = lower.includes('quero agendar') || lower.includes('quero marcar') || lower.includes('gostaria de agendar') || lower.includes('gostaria de marcar') || Boolean(matchedService);
        if (isExplicitBookingCommand) {
            const serviceLabel = matchedService ? `*${matchedService.name}* (R$ ${matchedService.price.toFixed(2)})` : 'seu atendimento';
            if (hasExplicitDateInMessage) {
                const slotsExec = await this.executeToolCall(tenantId, 'get_available_slots', { professionalId: defaultProfId, serviceId: matchedService ? matchedService.id : defaultServiceId, dateStr });
                executedTools.push('get_available_slots');
                const availableSlots = slotsExec.result.horariosDisponiveis || [];
                return {
                    replyText: `Com certeza! Vamos agendar ${serviceLabel} para *${dateFormattedLabel}*! \n\nOlha os horários livres que temos:\n${formatHumanSlots(availableSlots)}\n\nQual desses fica melhor pra você?`,
                    functionCallsExecuted: executedTools
                };
            }
            else {
                return {
                    replyText: `Com certeza! Vamos agendar ${serviceLabel}!  Qual dia (ex: hoje, amanhã, sábado) e horário fica melhor pra você vir?`,
                    functionCallsExecuted: []
                };
            }
        }
        // 8. Saudações Iniciais
        if (lower.includes('bom dia') || lower.includes('boa tarde') || lower.includes('boa noite') || lower.includes('ola') || lower.includes('olá') || lower.includes('oi') || lower.includes('opa') || lower.includes('fala')) {
            if (session)
                session.hasGreeted = true;
            const hours = new Date().getHours();
            let greeting = 'Olá!';
            if (hours >= 5 && hours < 12)
                greeting = 'Bom dia!';
            else if (hours >= 12 && hours < 18)
                greeting = 'Boa tarde!';
            else
                greeting = 'Boa noite!';
            const namePart = session?.customerName ? ` ${session.customerName}` : '';
            return {
                replyText: `${greeting}${namePart} Tudo bem com você? Em que posso te ajudar hoje?`,
                functionCallsExecuted: []
            };
        }
        // 9. Reagendar vs Novo Agendamento
        if (session?.pendingExistingApptChoice) {
            const { newDateStr, newTimeStr, dateFormattedLabel } = session.pendingExistingApptChoice;
            session.pendingExistingApptChoice = undefined;
            const isMudarChoice = lower.includes('mudar') || lower.includes('reagendar') || lower.includes('alterar') || lower.includes('trocar') || lower.includes('sim') || lower.includes('1');
            const clientName = session.customerName || 'Cliente';
            const clientPhone = session.customerPhone || customerPhone;
            if (isMudarChoice) {
                const exec = await this.executeToolCall(tenantId, 'create_appointment', {
                    professionalId: defaultProfId,
                    serviceId: defaultServiceId,
                    customerName: clientName,
                    customerPhone: clientPhone,
                    dateStr: newDateStr,
                    timeStr: newTimeStr
                });
                executedTools.push('create_appointment');
                const [y, m, d] = newDateStr.split('-');
                return {
                    replyText: `Prontinho, *${clientName}*! Mudei seu horário para *${dateFormattedLabel} (${d}/${m}/${y})* às *${newTimeStr}*! O horário antigo foi liberado. `,
                    functionCallsExecuted: executedTools,
                    appointmentCreated: exec.appointmentCreated
                };
            }
            else {
                const exec = await this.executeToolCall(tenantId, 'create_appointment', {
                    professionalId: defaultProfId,
                    serviceId: defaultServiceId,
                    customerName: clientName,
                    customerPhone: clientPhone,
                    dateStr: newDateStr,
                    timeStr: newTimeStr
                });
                executedTools.push('create_appointment');
                const [y, m, d] = newDateStr.split('-');
                return {
                    replyText: `Perfeito! Adicionei um *segundo agendamento* para *${dateFormattedLabel} (${d}/${m}/${y})* às *${newTimeStr}*! `,
                    functionCallsExecuted: executedTools,
                    appointmentCreated: exec.appointmentCreated
                };
            }
        }
        // 10. Reagendamento explícito
        if (lower.includes('mudar') || lower.includes('reagendar') || lower.includes('trocar') || lower.includes('alterar')) {
            return {
                replyText: `Com certeza! Para qual dia e horário você prefere mudar?`,
                functionCallsExecuted: []
            };
        }
        // 11. Cancelamento
        if (lower.includes('cancelar') || lower.includes('desistir')) {
            const exec = await this.executeToolCall(tenantId, 'cancel_appointment', { customerPhone });
            executedTools.push('cancel_appointment');
            return {
                replyText: `Sem problemas! Seu agendamento foi cancelado. Se precisar de outro horário depois, só me chamar! `,
                functionCallsExecuted: executedTools,
                appointmentCancelledId: exec.appointmentCancelledId
            };
        }
        // Resposta Humana Aberta
        const nameStr = session?.customerName ? ` ${session.customerName}` : '';
        return {
            replyText: `Com certeza${nameStr}! Como posso te ajudar com seu atendimento hoje? Se quiser dar uma olhada nos horários pra agendar, só me avisar! `,
            functionCallsExecuted: []
        };
    }
}
export const aiOrchestrator = new AiOrchestratorService();
