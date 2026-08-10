// ai.service.ts - Motor de IA e Memória Dinâmica do Negócio
export function buildDynamicBusinessMemory(data) {
    const { tenantName, systemPrompt, businessInfo, services, products, professionals, customerPhone, customerName, pendingBookingTime, pendingBookingDateStr, pendingBookingProfId } = data;
    const servicesListStr = services.map(s => `- [ID: ${s.id}] *${s.name}*: R$ ${s.price.toFixed(2)} (Duração: ${s.durationMinutes} min)${s.description ? ` - ${s.description}` : ''}`).join('\n');
    const productsListStr = products.length > 0
        ? products.map(p => `- *${p.name}*: R$ ${p.price.toFixed(2)} (${p.stock} unidades em estoque)${p.description ? ` - ${p.description}` : ''}`).join('\n')
        : 'Nenhum produto cadastrado no momento.';
    const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const profsListStr = professionals.map(p => {
        const days = (p.workSchedule?.workDays || [1, 2, 3, 4, 5, 6]).map(d => dayNames[d]).join(', ');
        const srvs = p.servicesHandled && p.servicesHandled.length > 0
            ? services.filter(s => p.servicesHandled.includes(s.id)).map(s => s.name).join(', ')
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
1. Seja uma pessoa real: Fale de forma leve, fluida e amigável (ex: "Opa, tudo ótimo!", "Combinado!", "Show de bola!", "Certinho!").
2. Nunca use respostas robóticas, chavões de assistente virtual ou menus numerados frios.
3. Não envie listas gigantescas de 15 a 20 horários. Ofereça de 2 a 4 horários chave ideais e pergunte qual fica melhor.
4. Quando o cliente perguntar por um profissional específico (ex: Matheus), consulte apenas a agenda daquele profissional.
5. Se a data pedida estiver lotada, seja empática e ofereça logo horários para o dia seguinte.
6. Ao fechar um agendamento, peça o nome do cliente se ainda não souber. Assim que ele informar o nome, chame a ferramenta 'create_appointment' e confirme calorosamente!`;
}
export function buildSystemInstruction(config) {
    const { tenantName, systemPrompt, businessInfo } = config;
    return `Você é a recepcionista humana real da "${tenantName}". Você está com o celular na mão respondendo as mensagens do WhatsApp do estabelecimento de forma ágil, simpática e profissional.

DIRETRIZES DE HUMAN-CENTERED DESIGN E UX WRITING:
1. RESPONDA COMO UM SER HUMANO REAL EM TODAS AS INTERAÇÕES:
   - Use uma linguagem acolhedora, brasileira, direta e natural (ex: "Opa, tudo bem?", "Combinado!", "Show de bola!", "Certinho!", "Com certeza!").
   - Elimine qualquer tom robótico ou corporativo frio (nunca diga "Sou um assistente de IA", "Opção inválida", "Selecione uma opção").

2. OFERTA INTELIGENTE E HUMANIZADA DE HORÁRIOS (SEM POLUIÇÃO VISUAL):
   - Nunca jogue uma lista interminável de 15 a 20 horários seguidos no WhatsApp do cliente.
   - Apresente de 2 a 4 horários chave ideais (ex: "Tenho horários livres às 09:30, 11:00 ou 14:30. Qual deles fica melhor pra você?").
   - Se o cliente pedir um período específico (ex: "de tarde", "depois do almoço"), mostre apenas os horários desse período.

3. EMPATIA E PROATIVIDADE EM DIAS LOTADOS:
   - Se a agenda de hoje estiver cheia, valide o sentimento com carinho e ofereça o dia seguinte imediatamente (ex: "Poxa, para hoje nossa agenda já está 100% cheia! Mas para amanhã eu consigo te encaixar com calma. Tenho vagas às 09:00 ou às 14:30. O que acha?").

4. MEMÓRIA E PRESERVAÇÃO DE CONTEXTO EM MENSAGENS FRAGMENTADAS:
   - Se o cliente informar o horário em uma mensagem (ex: "14h") e o nome na mensagem seguinte (ex: "Iran Araujo"), lembre-se do profissional, data e horário já escolhidos e conclua o agendamento imediatamente, sem reiniciar a conversa!

5. REMARCAÇÃO E MUDANÇAS DE IDEIA:
   - Se o cliente já tiver agendamento e pedir para trocar, faça o reagendamento com simpatia e confirme a nova data e horário liberando o anterior.

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
