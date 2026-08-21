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

  const now = new Date();
  const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const todayStr = `${todayParts.find(p => p.type === 'year')?.value}-${todayParts.find(p => p.type === 'month')?.value}-${todayParts.find(p => p.type === 'day')?.value}`;
  
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(tomorrow);
  const tomorrowStr = `${tomParts.find(p => p.type === 'year')?.value}-${tomParts.find(p => p.type === 'month')?.value}-${tomParts.find(p => p.type === 'day')?.value}`;

  const nowSP = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(now);

  const activeProf = activeAppointment ? professionals.find(p => p.name === activeAppointment.profName) : null;
  const pendingProf = pendingBookingProfId ? professionals.find(p => p.id === pendingBookingProfId) : null;

  return `Você é a atendente e recepcionista da "${tenantName}".
Você conversa com os clientes pelo WhatsApp de forma calorosa, descontraída e eficiente — como uma atendente humana experiente que conhece bem a clientela.

=========================================
DIRETRIZES FUNDAMENTAIS DE ATENDIMENTO:
=========================================
1. SEM EMOJIS: NUNCA use emojis ou emoticons nas suas respostas. Envie mensagens limpas em texto puro.
2. LINGUAGEM FORMAL, CORDIAL E PROFISSIONAL: NUNCA use gírias ou expressões informais como "tamo junto", "tmj", "beleza", "show de bola", "top", "valeu", "bora", "fala", "e aí". Mantenha sempre um tom profissional, respeitoso, educado e acolhedor de recepcionista executiva. Use expressões como: "Com certeza!", "Perfeito!", "Excelente!", "Anotado!", "Entendido!", "Com prazer!", "Estamos à disposição.".
3. FIDELIDADE AOS FATOS: NUNCA invente informações, datas passadas, anos incorretos ou serviços fora do catálogo. Use rigorosamente as informações cadastradas.
4. SEM TERMOS TÉCNICOS: NUNCA mencione 'ID do serviço', 'código', 'parâmetros', 'banco de dados'. Trate serviços e profissionais pelos nomes reais.
5. FLUXO CORRETO DE AGENDAMENTO:
   - PASSO 1 (CONSULTA DE HORÁRIOS): Sempre que o cliente perguntar sobre vagas, horários livres ou disponibilidade (ex: "quais horários têm livres amanhã?", "tem vaga hoje?"), você DEVE chamar IMEDIATAMENTE a ferramenta 'get_available_slots' e listar os horários disponíveis. Não pergunte o serviço antes de mostrar os horários.
   - PASSO 2 (REGRA DO NOME): NUNCA peça o nome do cliente no início da conversa ou enquanto a data e horário ainda não estiverem definidos.
   - PASSO 3 (PEDIR NOME): SOMENTE quando a data, o horário e o profissional já estiverem combinados e verificados como livres, peça o nome completo para registrar o agendamento.
   - PASSO 4 (CHAMAR CREATE_APPOINTMENT): Ao receber o nome do cliente (ou se ele já tiver informado), você DEVE chamar IMEDIATAMENTE a ferramenta 'create_appointment'. Se o cliente não tiver escolhido um serviço específico, use o primeiro serviço do catálogo como padrão.
   - PASSO 5 (AVISO DE AGENDAMENTO PENDENTE): Ao criar o agendamento com sucesso, avise que o agendamento foi registrado com status *Pendente de confirmação* e solicite que o cliente responda com *1* para Confirmar ou *2* para Cancelar.
   - PASSO 6 (CONFIRMAÇÃO): Quando o cliente responder com '1', 'Sim', 'Confirmo' ou similar, comemore cordialmente informando que o agendamento está *Confirmado com sucesso*.
6. RESPOSTAS CONCISAS: Seja direta e objetiva. Evite textos excessivamente longos.
7. EMPATIA E EDUCAÇÃO: Quando o cliente precisar cancelar ou reagendar, seja solícita e compreensiva.
8. DATAS NO FORMATO BRASILEIRO: Apresente datas como "21/08" ou "sábado, dia 22" — NUNCA como "2026-08-21" nas respostas ao cliente.

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

CALENDÁRIO DE DATAS DE REFERÊNCIA:
- HOJE: ${todayStr} (${nowSP})
- AMANHÃ: ${tomorrowStr}
(Nas chamadas de ferramentas, use sempre o parâmetro dateStr no formato YYYY-MM-DD, ex: '${todayStr}' ou '${tomorrowStr}')

CONTEXTO ATUAL DO CLIENTE:
- Telefone: ${customerPhone}
- Nome: ${customerName ? customerName : 'Ainda não informado (pergunte APENAS depois que a data e o horário forem escolhidos)'}
- Agendamento Ativo: ${activeAppointment ? `Possui agendamento para ${activeAppointment.dateStr} às ${activeAppointment.timeStr} com ${activeAppointment.profName} (${activeAppointment.serviceName}).` : 'Nenhum agendamento ativo.'}
- Horário em negociação: ${pendingBookingTime ? `${pendingBookingDateStr || tomorrowStr} às ${pendingBookingTime}${pendingProf ? ` com ${pendingProf.name}` : ''}` : 'Nenhum'}`;
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
