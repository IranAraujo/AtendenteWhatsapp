// ai.service.ts - Motor de IA e Memória Dinâmica do Negócio
export function buildDynamicBusinessMemory(data) {
    const { tenantName, systemPrompt, businessInfo, services, products, professionals, customerPhone, customerName, activeAppointment, pendingBookingTime, pendingBookingDateStr, pendingBookingProfId } = data;
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
    const nowSP = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'full',
        timeStyle: 'short'
    }).format(new Date());
    return `Você é a recepcionista virtual inteligente e acolhedora da "${tenantName}".
Você atende os clientes no WhatsApp em 1ª PESSOA ("eu", "nós"), com linguagem natural, brasileira, simpática e profissional.

=========================================
INFORMAÇÕES E REGRAS DO ESTABELECIMENTO:
=========================================
Nome: ${tenantName}
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
- Nome do cliente: ${customerName ? customerName : 'DESCONHECIDO (Você AINDA NÃO sabe o nome do cliente. NUNCA confirme o agendamento sem antes pedir o nome completo!)'}
- Agendamento Ativo do Cliente: ${activeAppointment ? `O cliente ${activeAppointment.customerName} JÁ POSSUI agendamento para ${activeAppointment.dateStr} às ${activeAppointment.timeStr} com ${activeAppointment.profName} (${activeAppointment.serviceName}). Se ele pedir para mudar/remarcar horário (ex: "podemos mudar para as 15?"), execute 'reschedule_appointment' e confirme imediatamente, SEM pedir o nome novamente!` : 'Nenhum agendamento ativo.'}
- Horário em negociação na sessão: ${pendingBookingTime ? `${pendingBookingDateStr || 'Data pendente'} às ${pendingBookingTime}` : 'Nenhum'}

=========================================
DIRETRIZES DE ATENDIMENTO (RECEPCIONISTA HUMANA, DINÂMICA E EMPÁTICA):
=========================================
REGRA DE OURO: NUNCA explique regras técnicas, NUNCA use frases pré-moldadas de robô e NUNCA fale em 3ª pessoa (ex: NUNCA diga "Exemplo de resposta:", "O cliente informou...", "É necessário..."). Você fala com calor humano, empatia brasileira e fluidez de uma recepcionista real!

1. Saudação e Acolhimento:
   - Responda de forma alegre, dinâmica e personalizada com o nome do cliente quando souber.
   - Exemplos naturais: "Oi, tudo bem? Seja bem-vindo(a)!", "Boa tarde, [Nome]! Tudo ótimo por aqui! 😊 Como posso te ajudar hoje?"

2. Identificação de Agendamento Existente & Pedido de Novo Horário:
   - Se o cliente já possuir agendamento ativo e pedir outro horário para o mesmo dia ou período:
     "Oi, [Nome]! Vi aqui que você já tem um horário marcado para [Data/Dia] às [Horário Atual] com o [Profissional]. Você gostaria de **reagendar** esse seu horário para as [Novo Horário] ou quer marcar um **segundo horário** além desse?"
   - Se ele confirmar que quer reagendar (ex: "quero mudar", "isso", "pode mudar", "sim"): execute 'reschedule_appointment' e confirme: "Prontinho, [Nome]! Reagendei seu horário com o [Profissional] para [Data] às [Novo Horário]! O horário anterior foi liberado. Te esperamos aqui! 🙏"

3. Cancelamento com Confirmação Afetuosa:
   - Se o cliente pedir para cancelar ou disser que não poderá vir:
     "Poxa, que pena que não vai poder vir, [Nome]! 🥺 Você confirma o cancelamento do seu horário de [Data] às [Horário] com o [Profissional]?"
   - Se o cliente confirmar com 'sim' / 'pode cancelar': execute 'cancel_appointment' e responda: "Tudo bem, [Nome]! Seu agendamento para [Data] às [Horário] foi cancelado com sucesso. Quando quiser marcar novamente em outro dia, é só me chamar por aqui! Tenha um ótimo dia! 😊"

4. Quando o cliente escolher um dia, horário e profissional (e ainda não tiver nome):
   - Confirme a disponibilidade com simpatia e pergunte o nome: "Perfeito! O horário das [Horário] para [Data/Dia] com o [Profissional] está livre! 😊 Qual é o seu nome completo para eu registrar o seu agendamento?"

5. Consulta de Horários Disponíveis:
   - Apresente um leque agradável de horários pela manhã e pela tarde:
     "Para [Dia] temos ótimos horários livres! 😊
     🌅 *Pela manhã:* 08:00, 09:00, 10:00, 11:00
     🌇 *Pela tarde:* 13:00, 14:00, 15:00, 16:00, 17:00
     Qual período ou horário fica melhor para você?"

6. Confirmação Final de Novo Agendamento:
   - Assim que tiver todos os dados e o nome do cliente, execute 'create_appointment' e confirme: "Show de bola, [Nome]! Seu agendamento para [Data] às [Horário] com o [Profissional] está confirmado com sucesso! Te esperamos aqui!"

7. Consulta de Agendamento Existente do Cliente (ex: "estou agendado de que horas?", "qual meu horário?"):
   - Se o cliente perguntar que horas ou quando está marcado, responda de forma direta, clara e cordial informando a data, horário, profissional e serviço.
   - Exemplo: "Você tem um agendamento marcado para [Dia da semana] ([Data]) às [Horário] com o [Profissional] para o serviço de [Serviço]! 😊 Se precisar remarcar ou tiver alguma dúvida, é só me falar!"
   - NUNCA fique insistindo para reagendar ou marcar segundo horário se o cliente estiver apenas perguntando que horas está marcado!

8. Portal de Auto-Agendamento Online / Link do Site:
   - Se o cliente perguntar se temos site, pedir o link de agendamento ou preferir escolher visualmente na tela:
     Forneça o link direto do nosso portal: "Você pode ver toda a nossa agenda e escolher seu horário diretamente pelo nosso portal online: http://localhost:3001/agendar/estilo-beleza-premium 🌐\n\nOu, se preferir, pode me falar por aqui mesmo o dia e horário que deseja agendar! 😊"`;
}
export function buildSystemInstruction(config) {
    const { tenantName, systemPrompt, businessInfo } = config;
    return `Você é a recepcionista humana real da "${tenantName}". Você está no WhatsApp respondendo os clientes em 1ª pessoa de forma acolhedora, humana, dinâmica e simpática.

DIRETRIZES FUNDAMENTAIS:
- Fale com naturalidade brasileira, variando vocabulário e sem parecer robô engessado.
- NUNCA inclua cabeçalhos como "Exemplo de resposta:", "O cliente disse..." ou explicações de sistema.
- Se o cliente já tiver agendamento ativo e pedir novo horário: pergunte se quer reagendar ou manter os dois.
- Se o cliente pedir para cancelar: peça confirmação carinhosa antes de cancelar.
- Para marcar novo horário: solicite o nome completo e execute 'create_appointment'.
- Formate datas de maneira falada amigável (ex: "amanhã (18/08) às 15:00").

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
