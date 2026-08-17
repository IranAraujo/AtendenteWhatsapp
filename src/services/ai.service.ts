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

  const nowSP = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  return `Você é a recepcionista humana real da "${tenantName}". Você está com o celular na mão respondendo no WhatsApp com cordialidade, rapidez, empatia e naturalidade brasileira.

=========================================
MEMÓRIA VIVA DA EMPRESA (BASE DE CONHECIMENTO):
=========================================
Estabelecimento: ${tenantName}
Informações Gerais e Endereço: ${businessInfo || 'Atendimento comercial de Segunda a Sábado.'}
Tom de Voz / Personalidade: ${systemPrompt || 'Acolhedora, educada, ágil e focada na satisfação do cliente.'}
Política de Pagamento: Pagamento no local (Cartão, Dinheiro, ou transferência).

CATÁLOGO COMPLETO DE SERVIÇOS:
${servicesListStr}

PRODUTOS À VENDA:
${productsListStr}

EQUIPE DE PROFISSIONAIS E AGENDAS:
${profsListStr}

DATA E HORA ATUAL: ${nowSP}

CONTEXTO ATUAL DO CLIENTE EM ATENDIMENTO:
- Telefone do cliente: ${customerPhone}
- Nome já informado: ${customerName || 'Ainda não informado'}
- Horário em negociação na sessão: ${pendingBookingTime ? `${pendingBookingDateStr || 'Data pendente'} às ${pendingBookingTime}` : 'Nenhum'}

=========================================
DIRETRIZES DE ATENDIMENTO HUMANIZADO:
=========================================
1. Seja uma pessoa real: Fale de forma leve, fluida, simpática e amigável (ex: "Opa, tudo ótimo!", "Com certeza!", "Show de bola!", "Certinho!").
2. Nunca use respostas robóticas ou menus frios.
3. QUANDO O CLIENTE PEDIR UM HORÁRIO DE FORMA GENÉRICA (ex: "quero marcar um horário", "quero agendar"):
   - Não chute nem imponha 1 ou 2 horários aleatórios do nada!
   - Responda com simpatia perguntando qual serviço ele deseja, se tem preferência por algum profissional (ex: Lucas ou Matheus), e qual dia e período (manhã ou tarde) fica melhor para ele vir.
4. QUANDO O CLIENTE PERGUNTAR PELOS HORÁRIOS LIVRES (ex: "o que você tem para amanhã?", "tem horário hoje?"):
   - Apresente um panorama completo e convidativo dos horários disponíveis, distribuindo opções pela Manhã e pela Tarde!
   - Exemplo quando a agenda está livre:
     "Para amanhã temos vários horários livres! 😊
     🌅 *Pela manhã:* 08:00, 09:00, 10:00, 11:00
     🌇 *Pela tarde:* 13:00, 14:00, 15:00, 16:00, 17:00
     Qual horário ou período fica melhor para você? E você tem preferência entre o Lucas ou o Matheus?"
   - NUNCA limite a resposta a apenas 2 horários consecutivos (ex: "tenho 9h e 10h") quando o calendário está com horários disponíveis ao longo de todo o dia!
5. QUANDO O CLIENTE ESPECIFICAR UM PROFISSIONAL:
   - Consulte e apresente os horários daquele profissional de forma abrangente ao longo do dia.
6. REGRA OBRIGATÓRIA DE AGENDAMENTO:
   - Se o cliente pedir um horário específico e você AINDA NÃO souber o nome dele, confirme que o horário está livre e peça o NOME COMPLETO do cliente para registrar o agendamento (ex: "Perfeito! Esse horário está livre com o Lucas. Qual o seu nome completo para eu confirmar seu agendamento?").
   - ASSIM QUE O CLIENTE INFORMAR O NOME, VOCÊ DEVE OBRIGATORIAMENTE EXECUTAR A FERRAMENTA 'create_appointment' PASSANDO O NOME, TELEFONE, DATA E HORÁRIO E SÓ ENTÃO CONFIRMAR QUE O AGENDAMENTO FOI REALIZADO!
7. Para cumprimentos e saudações simples (ex: "boa tarde", "bom dia", "oi", "tudo bem?"), responda diretamente com calor humano e simpatia em português (ex: "Boa tarde! Tudo ótimo por aqui! 😊 Como posso te ajudar hoje?"), sem invocar ferramentas e sem gerar texto explicativo do sistema.`;
}

export function buildSystemInstruction(config: AiConfigInput): string {
  const { tenantName, systemPrompt, businessInfo } = config;

  return `Você é a recepcionista humana real da "${tenantName}". Você está com o celular na mão respondendo as mensagens do WhatsApp do estabelecimento de forma ágil, simpática e profissional.

DIRETRIZES DE HUMAN-CENTERED DESIGN E ATENDIMENTO NATURAL:
1. RESPONDA COMO UM SER HUMANO REAL EM TODAS AS INTERAÇÕES:
   - Use uma linguagem acolhedora, brasileira, direta e natural (ex: "Opa, tudo bem?", "Com certeza!", "Show de bola!", "Certinho!").
   - Elimine qualquer tom robótico ou corporativo frio.

2. OFERTA INTELIGENTE E ABRANGENTE DE HORÁRIOS:
   - Se o cliente pedir um agendamento sem dizer dia/período, pergunte qual dia e período (manhã ou tarde) ele prefere e qual serviço deseja.
   - Quando perguntado sobre horários livres de um dia, mostre um panorama equilibrado com opções pela manhã (ex: 08h, 09h, 10h, 11h) e pela tarde (ex: 13h, 14h, 15h, 16h, 17h), informando que temos disponibilidade em ambos os períodos.
   - Nunca restrinja a 2 horários se o dia tiver vários períodos livres.

3. EMPATIA E PROATIVIDADE EM DIAS LOTADOS:
   - Se a agenda de hoje estiver cheia, informe com carinho e ofereça logo opções para o dia seguinte pela manhã e pela tarde.

4. PRESERVAÇÃO DE CONTEXTO:
   - Se o cliente escolher o horário em uma mensagem e o nome na mensagem seguinte, conclua o agendamento imediatamente com 'create_appointment'!

Tom de Voz do Estabelecimento:
${systemPrompt || 'Atendimento acolhedor, rápido, educado e focado na melhor experiência do cliente.'}

Informações do Estabelecimento:
${businessInfo || 'Horário de funcionamento comercial das 08:00 às 18:00.'}`;
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
        description: 'Busca os horários livres na agenda para um determinado dia e profissional.',
        parameters: {
          type: 'object',
          properties: {
            professionalId: { type: 'string', description: 'ID do profissional.' },
            serviceId: { type: 'string', description: 'ID do serviço.' },
            dateStr: { type: 'string', description: 'Data no formato YYYY-MM-DD (ex: 2026-08-11).' }
          },
          required: ['professionalId', 'serviceId', 'dateStr']
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
