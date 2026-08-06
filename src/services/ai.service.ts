import { FunctionDeclaration, SchemaType } from '@google/generative-ai';

export interface AiConfigInput {
  tenantName: string;
  systemPrompt: string;
  businessInfo: string;
}

export function buildSystemInstruction(config: AiConfigInput): string {
  const { tenantName, systemPrompt, businessInfo } = config;

  return `Você é a recepcionista humana real da "${tenantName}". Você está com o celular na mão respondendo as mensagens do WhatsApp do estabelecimento.

REGRAS DE CONVERSAÇÃO HUMANA OBRIGATÓRIAS:
1. RESPONDA COMO UM SER HUMANO REAL EM TODAS AS PERGUNTAS E TODAS AS INTERAÇÕES.
2. NUNCA USE RESPOSTAS PRONTAS OU SCRIPTS RÍGIDOS. Responda sempre levando em conta todo o histórico da conversa e o contexto atual.
3. Converse com simpatia, naturalidade e empatia brasileira (ex: "Opa!", "Tudo ótimo por aqui!", "Fechado!", "Show de bola!", "Certinho!", "Com certeza!").
4. Responda a QUALQUER pergunta do cliente (preços de serviços, produtos à venda, endereço, formas de pagamento, dicas de atendimento, horários, conversas casuais) de forma direta e acolhedora.
5. Mantenha mensagens curtas, agradáveis e fluidas (1 a 3 linhas por mensagem).
6. Quando o cliente perguntar de horários vagos, sugira amigavelmente de 2 a 3 horários (ex: "Tenho vago às 10h ou às 14h30. Qual fica melhor pra você?").
7. REGRA OBRIGATÓRIA DE COLETA DE DADOS: Para confirmar qualquer agendamento, peça SEMPRE o NOME COMPLETO e o TELEFONE DE CONTATO do cliente. Se o cliente enviar o nome em uma mensagem e o telefone na mensagem seguinte, lembre-se do nome informado anteriormente e continue a conversa normalmente sem reiniciar o atendimento!
8. Ao finalizar um agendamento ou tirada de dúvida, demonstre alegria genuína (ex: "Perfeito, [Nome]! Agendado! Te esperamos aqui! ✂️").

Tom de Voz Personalizado:
${systemPrompt}

Informações do Estabelecimento:
${businessInfo}`;
}

export const aiTools: FunctionDeclaration[] = [
  {
    name: 'list_services',
    description: 'Lista todos os serviços e preços disponíveis no estabelecimento.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {}
    }
  },
  {
    name: 'list_products',
    description: 'Lista todos os produtos à venda no estabelecimento (ex: pomadas, shampoos, óleos) com preços e estoque.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {}
    }
  },
  {
    name: 'list_professionals',
    description: 'Lista os profissionais disponíveis.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        serviceId: {
          type: SchemaType.STRING,
          description: 'ID do serviço opcional.'
        }
      }
    }
  },
  {
    name: 'get_available_slots',
    description: 'Busca os horários livres na agenda para um determinado dia e profissional.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        professionalId: {
          type: SchemaType.STRING,
          description: 'ID do profissional.'
        },
        serviceId: {
          type: SchemaType.STRING,
          description: 'ID do serviço.'
        },
        dateStr: {
          type: SchemaType.STRING,
          description: 'Data no formato YYYY-MM-DD (ex: 2026-08-04).'
        }
      },
      required: ['professionalId', 'serviceId', 'dateStr']
    }
  },
  {
    name: 'create_appointment',
    description: 'Cria ou altera o agendamento no sistema. Requer nome completo do cliente, telefone, data e horário.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        professionalId: { type: SchemaType.STRING },
        serviceId: { type: SchemaType.STRING },
        customerName: { type: SchemaType.STRING, description: 'Nome completo do cliente.' },
        customerPhone: { type: SchemaType.STRING, description: 'Telefone/WhatsApp do cliente.' },
        dateStr: { type: SchemaType.STRING, description: 'Data no formato YYYY-MM-DD.' },
        timeStr: { type: SchemaType.STRING, description: 'Horário no formato HH:MM (ex: 14:00).' }
      },
      required: ['professionalId', 'serviceId', 'customerName', 'customerPhone', 'dateStr', 'timeStr']
    }
  },
  {
    name: 'reschedule_appointment',
    description: 'Altera a data e/ou horário de um agendamento já existente.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        customerPhone: { type: SchemaType.STRING, description: 'Telefone do cliente.' },
        newDateStr: { type: SchemaType.STRING, description: 'Nova data no formato YYYY-MM-DD.' },
        newTimeStr: { type: SchemaType.STRING, description: 'Novo horário HH:MM.' }
      },
      required: ['customerPhone', 'newDateStr', 'newTimeStr']
    }
  },
  {
    name: 'cancel_appointment',
    description: 'Cancela um agendamento do cliente pelo telefone.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        customerPhone: { type: SchemaType.STRING, description: 'Telefone do cliente.' }
      },
      required: ['customerPhone']
    }
  }
];
