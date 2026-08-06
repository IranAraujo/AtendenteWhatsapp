import { SchemaType } from '@google/generative-ai';
// Definição das ferramentas (Function Declarations) que a IA pode invocar
const listServicesDeclaration = {
    name: 'list_services',
    description: 'Lista todos os serviços oferecidos pelo estabelecimento com seus preços e durações.',
    parameters: {
        type: SchemaType.OBJECT,
        properties: {},
    },
};
const listProfessionalsDeclaration = {
    name: 'list_professionals',
    description: 'Lista os profissionais do estabelecimento que realizam determinado serviço.',
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            serviceId: {
                type: SchemaType.STRING,
                description: 'ID do serviço (opcional). Se informado, lista apenas quem faz este serviço.',
            },
        },
    },
};
const getAvailableSlotsDeclaration = {
    name: 'get_available_slots',
    description: 'Consulta os horários reais disponíveis de um profissional para um serviço em uma data (YYYY-MM-DD). NUNCA invente horários, use esta função!',
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            professionalId: {
                type: SchemaType.STRING,
                description: 'ID do profissional escolhido pelo cliente',
            },
            serviceId: {
                type: SchemaType.STRING,
                description: 'ID do serviço desejado',
            },
            dateStr: {
                type: SchemaType.STRING,
                description: 'Data no formato YYYY-MM-DD (ex: 2026-08-10)',
            },
        },
        required: ['professionalId', 'serviceId', 'dateStr'],
    },
};
const createAppointmentDeclaration = {
    name: 'create_appointment',
    description: 'Confirma e realiza o agendamento no sistema para o cliente.',
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            professionalId: { type: SchemaType.STRING, description: 'ID do profissional' },
            serviceId: { type: SchemaType.STRING, description: 'ID do serviço' },
            customerName: { type: SchemaType.STRING, description: 'Nome completo do cliente' },
            customerPhone: { type: SchemaType.STRING, description: 'Telefone/WhatsApp do cliente' },
            dateStr: { type: SchemaType.STRING, description: 'Data YYYY-MM-DD' },
            timeStr: { type: SchemaType.STRING, description: 'Horário HH:mm escolhido (ex: 14:00)' },
        },
        required: ['professionalId', 'serviceId', 'customerName', 'customerPhone', 'dateStr', 'timeStr'],
    },
};
export const aiTools = [
    listServicesDeclaration,
    listProfessionalsDeclaration,
    getAvailableSlotsDeclaration,
    createAppointmentDeclaration,
];
/**
 * Monta o Prompt de Sistema com as regras rígidas anti-alucinação
 */
export function buildSystemInstruction(context) {
    const currentDate = new Date().toISOString().split('T')[0];
    return `Você é a atendente virtual via WhatsApp da "${context.tenantName}".
Seu objetivo é ser extremamente cortês, eficiente e ajudar o cliente a agendar seus serviços.

REGRAS OBRIGATÓRIAS:
1. A data atual de hoje é: ${currentDate}.
2. NUNCA invente horários ou confirme agendamentos sem antes usar as funções 'get_available_slots' e 'create_appointment'.
3. Se o cliente perguntar os horários de um dia, execute a função 'get_available_slots' e apresente apenas os horários retornados por ela.
4. Para agendar, você DEVE obter: Nome do cliente, Serviço desejado, Profissional preferido, Data e Horário.
5. Seja natural, use emojis com moderação e responda de forma direta e amigável.

INFORMAÇÕES DO ESTABELECIMENTO:
${context.businessInfo}

INSTRUÇÕES ADICIONAIS DO CLIENTE:
${context.systemPrompt}`;
}
