import { GoogleGenerativeAI } from '@google/generative-ai';
import { dbRepository } from './db.service.js';
import { calculateAvailableSlots } from './schedule.service.js';
import { buildSystemInstruction, aiTools } from './ai.service.js';
export class AiOrchestratorService {
    genAI;
    constructor(apiKey) {
        const key = apiKey || process.env.GEMINI_API_KEY || 'DEMO_API_KEY';
        this.genAI = new GoogleGenerativeAI(key);
    }
    async executeToolCall(tenantId, functionName, args) {
        if (functionName === 'list_services') {
            const services = await dbRepository.listServices(tenantId);
            return { result: services.map(s => ({ id: s.id, nome: s.name, preco: `R$ ${s.price}`, duracao: `${s.durationMinutes} min` })) };
        }
        if (functionName === 'list_professionals') {
            const professionals = await dbRepository.listProfessionals(tenantId, args?.serviceId);
            return { result: professionals.map(p => ({ id: p.id, nome: p.name })) };
        }
        if (functionName === 'get_available_slots') {
            const { professionalId, serviceId, dateStr } = args;
            const services = await dbRepository.listServices(tenantId);
            const service = services.find(s => s.id === serviceId) || services[0];
            const serviceDuration = service ? service.durationMinutes : 30;
            const existingAppointments = await dbRepository.getAppointmentsForProfessional(professionalId, dateStr);
            const slots = calculateAvailableSlots({
                dateStr,
                serviceDurationMinutes: serviceDuration,
                schedule: { startTime: '08:00', endTime: '18:00', lunchStartTime: '12:00', lunchEndTime: '13:00' },
                existingAppointments: existingAppointments.map(a => ({ startTime: a.startTime, endTime: a.endTime })),
                slotIntervalMinutes: 30
            });
            return { result: { data: dateStr, horariosDisponiveis: slots } };
        }
        if (functionName === 'create_appointment') {
            const { professionalId, serviceId, customerName, customerPhone, dateStr, timeStr } = args;
            const services = await dbRepository.listServices(tenantId);
            const service = services.find(s => s.id === serviceId) || services[0];
            const duration = service ? service.durationMinutes : 30;
            const [year, month, day] = dateStr.split('-').map(Number);
            const [hours, minutes] = timeStr.split(':').map(Number);
            const startTime = new Date(year, month - 1, day, hours, minutes);
            const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
            const tenant = await dbRepository.getTenantById(tenantId);
            const isPixEnabled = tenant?.enablePixDeposit || false;
            const status = isPixEnabled ? 'PENDING_PAYMENT' : 'CONFIRMED';
            const appointment = await dbRepository.createAppointment({
                tenantId,
                professionalId,
                serviceId,
                customerName,
                customerPhone,
                startTime,
                endTime,
                status,
                pixQrCode: isPixEnabled ? `00020126580014br.gov.bcb.pix0136${Date.now()}` : undefined
            });
            return {
                result: {
                    status: 'SUCESSO',
                    mensagem: isPixEnabled ? 'Agendamento criado! Aguardando pagamento do sinal PIX.' : 'Agendamento CONFIRMADO com sucesso!',
                    agendamentoId: appointment.id,
                    sinalPixNecessario: isPixEnabled,
                    valorSinal: isPixEnabled ? `R$ ${tenant?.pixDepositValue}` : undefined
                },
                appointmentCreated: appointment
            };
        }
        return { result: { error: `Função ${functionName} não encontrada.` } };
    }
    async processIncomingMessage(tenantId, customerPhone, userMessage) {
        const tenant = await dbRepository.getTenantById(tenantId);
        if (!tenant) {
            return { replyText: 'Desculpe, estabelecimento não encontrado.', functionCallsExecuted: [] };
        }
        const systemInstruction = buildSystemInstruction({
            tenantName: tenant.name,
            systemPrompt: tenant.aiConfig.systemPrompt,
            businessInfo: tenant.aiConfig.businessInfo
        });
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === 'DEMO_API_KEY') {
            return this.simulateAiResponse(tenantId, customerPhone, userMessage);
        }
        try {
            const model = this.genAI.getGenerativeModel({
                model: 'gemini-1.5-flash',
                systemInstruction,
                tools: [{ functionDeclarations: aiTools }]
            });
            const chat = model.startChat();
            const result = await chat.sendMessage(userMessage);
            const response = await result.response;
            const functionCalls = response.functionCalls();
            const executedTools = [];
            let appointmentCreated = undefined;
            if (functionCalls && functionCalls.length > 0) {
                for (const call of functionCalls) {
                    executedTools.push(call.name);
                    const toolExec = await this.executeToolCall(tenantId, call.name, call.args);
                    if (toolExec.appointmentCreated) {
                        appointmentCreated = toolExec.appointmentCreated;
                    }
                    const secondResult = await chat.sendMessage([
                        {
                            functionResponse: {
                                name: call.name,
                                response: toolExec.result
                            }
                        }
                    ]);
                    const secondResponse = await secondResult.response;
                    return {
                        replyText: secondResponse.text(),
                        functionCallsExecuted: executedTools,
                        appointmentCreated
                    };
                }
            }
            return {
                replyText: response.text(),
                functionCallsExecuted: executedTools,
                appointmentCreated
            };
        }
        catch (error) {
            console.error('Erro na chamada Gemini:', error.message);
            return this.simulateAiResponse(tenantId, customerPhone, userMessage);
        }
    }
    async simulateAiResponse(tenantId, customerPhone, userMessage) {
        const lower = userMessage.toLowerCase();
        const executedTools = [];
        // Prioridade 1: Solicitação explícita de agendamento/confirmação
        if (lower.includes('agendar') || lower.includes('marcar') || lower.includes('confirmar')) {
            const todayStr = new Date().toISOString().split('T')[0];
            const exec = await this.executeToolCall(tenantId, 'create_appointment', {
                professionalId: 'prof-1',
                serviceId: 'srv-1',
                customerName: 'Cliente WhatsApp',
                customerPhone,
                dateStr: todayStr,
                timeStr: '14:00'
            });
            executedTools.push('create_appointment');
            return {
                replyText: `Perfeito! Seu agendamento para *Corte de Cabelo* com *Lucas Barbeiro* foi *CONFIRMADO* para hoje às *14:00*! ✂️💈\n\nTe esperamos na Av. Central, 500.`,
                functionCallsExecuted: executedTools,
                appointmentCreated: exec.appointmentCreated
            };
        }
        // Prioridade 2: Serviços e preços
        if (lower.includes('servico') || lower.includes('serviço') || lower.includes('preco') || lower.includes('preço') || lower.includes('opções')) {
            const exec = await this.executeToolCall(tenantId, 'list_services', {});
            executedTools.push('list_services');
            const serviceList = exec.result.map((s) => `• *${s.nome}*: ${s.preco} (${s.duracao})`).join('\n');
            return {
                replyText: `Olá! Na Barbearia Navalha de Ouro temos os seguintes serviços disponíveis:\n\n${serviceList}\n\nQual deles você deseja agendar?`,
                functionCallsExecuted: executedTools
            };
        }
        // Prioridade 3: Consulta de horários
        if (lower.includes('horario') || lower.includes('horário') || lower.includes('vaga') || lower.includes('hoje') || lower.includes('amanha') || lower.includes('amanhã')) {
            const todayStr = new Date().toISOString().split('T')[0];
            const exec = await this.executeToolCall(tenantId, 'get_available_slots', { professionalId: 'prof-1', serviceId: 'srv-1', dateStr: todayStr });
            executedTools.push('get_available_slots');
            const slots = exec.result.horariosDisponiveis.join(', ');
            return {
                replyText: `Para a data *${todayStr}* com o barbeiro Lucas, temos os seguintes horários disponíveis:\n\n📅 *${slots}*\n\nQual desses horários fica melhor para você?`,
                functionCallsExecuted: executedTools
            };
        }
        return {
            replyText: `Olá! Sou a assistente virtual da Barbearia Navalha de Ouro. Posso te ajudar a agendar um corte de cabelo ou barba. Gostaria de ver nossos serviços ou horários livres?`,
            functionCallsExecuted: []
        };
    }
}
export const aiOrchestrator = new AiOrchestratorService();
