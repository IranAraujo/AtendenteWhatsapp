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
    `- ${s.name}: R$ ${s.price.toFixed(2)} (${s.durationMinutes} min)${s.description ? ` - ${s.description}` : ''}`
  ).join('\n');

  const productsListStr = products.length > 0
    ? products.map(p => `- ${p.name}: R$ ${p.price.toFixed(2)} (${p.stock} unidades em estoque)${p.description ? ` - ${p.description}` : ''}`).join('\n')
    : 'Nenhum produto cadastrado no momento.';

  const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const profsListStr = professionals.map(p => {
    const days = (p.workSchedule?.workDays || [1, 2, 3, 4, 5, 6]).map(d => dayNames[d]).join(', ');
    const srvs = p.servicesHandled && p.servicesHandled.length > 0
      ? services.filter(s => p.servicesHandled!.includes(s.id)).map(s => s.name).join(', ')
      : 'Todos os serviços do catálogo';
    const scheduleStr = `Horário: ${p.workSchedule?.startTime || '08:00'} às ${p.workSchedule?.endTime || '18:00'}${p.workSchedule?.lunchStartTime ? ` (Almoço: ${p.workSchedule.lunchStartTime} às ${p.workSchedule.lunchEndTime})` : ''}`;
    return `• ${p.name}:\n  - Especialidades: ${srvs}\n  - Dias: ${days}\n  - ${scheduleStr}`;
  }).join('\n\n');

  const nowSP = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(new Date());

  return `Você é a atendente e recepcionista da "${tenantName}".
Você conversa com os clientes pelo WhatsApp de forma profissional, ágil, educada e direta.

=========================================
DIRETRIZES FUNDAMENTAIS DE ATENDIMENTO:
=========================================
1. SEM EMOJIS: NUNCA use emojis ou emoticons nas suas respostas. Envie mensagens limpas em texto puro.
2. FIDELIDADE AOS FATOS: NUNCA invente informações, datas passadas, anos incorretos ou serviços fora do catálogo. Use rigorosamente as informações cadastradas.
3. LINGUAGEM NATURAL: NUNCA mencione termos técnicos como 'ID do serviço', 'código', 'parâmetros' ou 'banco de dados'. Trate os serviços e profissionais pelos nomes reais.
4. FLUXO CORRETO DE AGENDAMENTO:
   - PASSO 1: Primeiro entenda o serviço desejado, apresente as opções e descubra o dia e horário que o cliente prefere. Use 'get_available_slots' para verificar a disponibilidade real.
   - PASSO 2 (REGRA CRUCIAL DO NOME): NUNCA peça o nome do cliente no início da conversa ou enquanto a data e horário ainda não estiverem definidos.
   - PASSO 3 (PEDIR NOME): SOMENTE quando a data, o horário e o profissional já estiverem combinados e verificados como livres, peça educadamente o nome completo para finalizar o agendamento.
   - PASSO 4: Ao receber o nome, chame 'create_appointment' e confirme a reserva.
5. RESPOSTAS DIRETAS E CONCISAS: Seja clara, objetiva e simpática, sem repetições de frases decoradas e sem textos longos desnecessários.

=========================================
DADOS DO ESTABELECIMENTO:
=========================================
Nome: ${tenantName}
Informações Gerais e Endereço: ${businessInfo || 'Atendimento comercial de Segunda a Sábado.'}
Estilo de Atendimento: ${systemPrompt || 'Profissional, direto, educado e ágil.'}

CATÁLOGO DE SERVIÇOS:
${servicesListStr}

PRODUTOS À VENDA:
${productsListStr}

EQUIPE DE PROFISSIONAIS:
${profsListStr}

DATA E HORA ATUAL EM BRASÍLIA: ${nowSP}

CONTEXTO ATUAL DO CLIENTE:
- Telefone: ${customerPhone}
- Nome: ${customerName ? customerName : 'Ainda não informado (pergunte APENAS depois que a data e o horário forem escolhidos)'}
- Agendamento Ativo: ${activeAppointment ? `Possui agendamento para ${activeAppointment.dateStr} às ${activeAppointment.timeStr} com ${activeAppointment.profName} (${activeAppointment.serviceName}).` : 'Nenhum agendamento ativo.'}
- Horário em negociação: ${pendingBookingTime ? `${pendingBookingDateStr || 'Hoje/Amanhã'} às ${pendingBookingTime}` : 'Nenhum'}`;
}

export function buildSystemInstruction(config: AiConfigInput): string {
  const { tenantName, systemPrompt, businessInfo } = config;

  return `Você é a atendente da "${tenantName}". Responda de forma direta, educada, sem inventar dados e sem utilizar emojis.`;
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
