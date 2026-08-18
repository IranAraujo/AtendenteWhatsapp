// ai.service.ts - Motor de IA e Memória Dinâmica do Negócio

export interface AiConfigInput {
  tenantName: string;
  systemPrompt: string;
  businessInfo: string;
}

export interface DynamicMemoryInput {
  tenantName: string;
  systemPrompt?: string;
  businessInfo?: string;
  services: Array<{ id: string; name: string; price: number; durationMinutes: number; description?: string }>;
  products: Array<{ id: string; name: string; price: number; stock: number; description?: string }>;
  professionals: Array<{ 
    id: string; 
    name: string; 
    servicesHandled?: string[]; 
    workSchedule?: { startTime?: string; endTime?: string; lunchStartTime?: string | null; lunchEndTime?: string | null; workDays?: number[] } 
  }>;
  customerPhone: string;
  customerName?: string;
  activeAppointment?: {
    customerName: string;
    dateStr: string;
    timeStr: string;
    profName: string;
    serviceName: string;
  };
  pendingBookingTime?: string;
  pendingBookingDateStr?: string;
  pendingBookingProfId?: string;
  pendingBookingServiceId?: string;
}

export function buildDynamicBusinessMemory(data: DynamicMemoryInput): string {
  const {
    tenantName,
    systemPrompt,
    businessInfo,
    services,
    products,
    professionals,
    customerPhone,
    customerName,
    activeAppointment,
    pendingBookingTime,
    pendingBookingDateStr,
    pendingBookingProfId
  } = data;

  const servicesListStr = services.map(s => 
    `- [ID: ${s.id}] *${s.name}*: R$ ${s.price.toFixed(2)} (Duração: ${s.durationMinutes} min)${s.description ? ` - ${s.description}` : ''}`
  ).join('\n');

  const productsListStr = products.length > 0
    ? products.map(p => `- *${p.name}*: R$ ${p.price.toFixed(2)} (${p.stock} unidades em estoque)${p.description ? ` - ${p.description}` : ''}`).join('\n')
    : 'Nenhum produto cadastrado no momento.';

  const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const profsListStr = professionals.map(p => {
    const days = (p.workSchedule?.workDays || [1, 2, 3, 4, 5, 6]).map(d => dayNames[d]).join(', ');
    const srvs = p.servicesHandled && p.servicesHandled.length > 0
      ? services.filter(s => p.servicesHandled!.includes(s.id)).map(s => s.name).join(', ')
      : 'Todos os serviços do catálogo';
    const scheduleStr = `⏰ Horário: ${p.workSchedule?.startTime || '08:00'} às ${p.workSchedule?.endTime || '18:00'}${p.workSchedule?.lunchStartTime ? ` (Almoço: ${p.workSchedule.lunchStartTime} às ${p.workSchedule.lunchEndTime})` : ''}`;
    return `• [ID: ${p.id}] *${p.name}*:\n  - Serviços que realiza: ${srvs}\n  - Dias de trabalho: ${days}\n  - ${scheduleStr}`;
  }).join('\n\n');

  const nowSP = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(new Date());

  return `Você é a atendente e recepcionista humana da "${tenantName}".
Você conversa com os clientes pelo WhatsApp de forma 100% natural, acolhedora, brasileira e espontânea.

=========================================
DIRETRIZES DE ATENDIMENTO E ESPONTANEIDADE:
=========================================
1. TOTAL ESPONTANEIDADE: NUNCA use scripts decorados, respostas pré-moldadas ou frases repetitivas de robô. Em cada mensagem, converse livremente e de forma personalizada com suas próprias palavras, variando seu vocabulário e estilo como uma pessoa real no WhatsApp!
2. CONSULTA PRECISA DE HORÁRIOS: Sempre que o cliente quiser saber sobre horários ou perguntar a disponibilidade (hoje, amanhã ou outro dia), você DEVE executar a função 'get_available_slots'. NUNCA invente horários e NUNCA ofereça horários passados para o dia de hoje (horário atual: ${nowSP}).
3. AGENDAMENTO E ATENDIMENTO:
   - Para agendar: Ajude o cliente a escolher o serviço, o profissional e o horário. Peça o nome completo antes de confirmar e chame 'create_appointment'.
   - Se o cliente já tiver agendamento: Trate com carinho, esclareça dúvidas sobre o horário marcado e, se ele desejar remarcar ou cancelar, execute 'reschedule_appointment' ou 'cancel_appointment'.
   - Dúvidas gerais: Esclareça dúvidas sobre endereço, formas de pagamento, serviços e produtos com cordialidade e precisão.
4. CALOR HUMANO: Use primeira pessoa ("eu", "aqui na nossa equipe"), seja simpática, educada e ágil.

=========================================
DADOS DO ESTABELECIMENTO:
=========================================
Nome: ${tenantName}
Informações Gerais e Endereço: ${businessInfo || 'Atendimento comercial de Segunda a Sábado.'}
Estilo de Atendimento: ${systemPrompt || 'Acolhedor, prestativo e dinâmico.'}

CATÁLOGO DE SERVIÇOS:
${servicesListStr}

PRODUTOS À VENDA:
${productsListStr}

EQUIPE DE PROFISSIONAIS:
${profsListStr}

DATA E HORA ATUAL EM BRASÍLIA: ${nowSP}

CONTEXTO ATUAL DO CLIENTE:
- Telefone: ${customerPhone}
- Nome: ${customerName ? customerName : 'Ainda não informado (peça com simpatia antes de confirmar o agendamento final)'}
- Agendamento Ativo: ${activeAppointment ? `Possui agendamento marcado para ${activeAppointment.dateStr} às ${activeAppointment.timeStr} com ${activeAppointment.profName} (${activeAppointment.serviceName}).` : 'Nenhum agendamento ativo.'}
- Horário em negociação na conversa: ${pendingBookingTime ? `${pendingBookingDateStr || 'Hoje/Amanhã'} às ${pendingBookingTime}` : 'Nenhum'}`;
}

export function buildSystemInstruction(config: AiConfigInput): string {
  const { tenantName, systemPrompt, businessInfo } = config;

  return `Você é a atendente humana da "${tenantName}". Converse com os clientes no WhatsApp de forma natural, espontânea, educada e resolutiva. NUNCA use frases prontas de robô.`;
}

// (legado Gemini removido - usando buildGlmTools() para OpenAI-compatible API)

// =========================================
// FERRAMENTAS NO FORMATO OPENAI (GLM-5.2 / NVIDIA NIM)
// =========================================
export function buildGlmTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'list_services',
        description: 'Lista todos os serviços e preços disponíveis no estabelecimento.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_products',
        description: 'Lista todos os produtos à venda no estabelecimento (ex: pomadas, shampoos, óleos) com preços e estoque.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_professionals',
        description: 'Lista os profissionais disponíveis.',
        parameters: {
          type: 'object',
          properties: {
            serviceId: { type: 'string', description: 'ID do serviço opcional.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_available_slots',
        description: 'Consulta os horários livres reais na agenda para um determinado dia e profissional.',
        parameters: {
          type: 'object',
          properties: {
            dateStr: { type: 'string', description: 'Data no formato YYYY-MM-DD (ex: 2026-08-18 para hoje).' },
            professionalId: { type: 'string', description: 'ID do profissional opcional.' },
            serviceId: { type: 'string', description: 'ID do serviço opcional.' }
          },
          required: ['dateStr']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_appointment',
        description: 'Cria ou altera o agendamento no sistema. Requer nome completo do cliente, telefone, data e horário.',
        parameters: {
          type: 'object',
          properties: {
            professionalId: { type: 'string' },
            serviceId: { type: 'string' },
            customerName: { type: 'string', description: 'Nome completo do cliente.' },
            customerPhone: { type: 'string', description: 'Telefone/WhatsApp do cliente.' },
            dateStr: { type: 'string', description: 'Data no formato YYYY-MM-DD.' },
            timeStr: { type: 'string', description: 'Horário no formato HH:MM (ex: 14:00).' }
          },
          required: ['professionalId', 'serviceId', 'customerName', 'customerPhone', 'dateStr', 'timeStr']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'reschedule_appointment',
        description: 'Altera a data e/ou horário de um agendamento já existente.',
        parameters: {
          type: 'object',
          properties: {
            customerPhone: { type: 'string', description: 'Telefone do cliente.' },
            newDateStr: { type: 'string', description: 'Nova data no formato YYYY-MM-DD.' },
            newTimeStr: { type: 'string', description: 'Novo horário HH:MM.' }
          },
          required: ['customerPhone', 'newDateStr', 'newTimeStr']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'cancel_appointment',
        description: 'Cancela um agendamento do cliente pelo telefone.',
        parameters: {
          type: 'object',
          properties: {
            customerPhone: { type: 'string', description: 'Telefone do cliente.' }
          },
          required: ['customerPhone']
        }
      }
    }
  ];
}
