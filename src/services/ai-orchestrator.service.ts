import { GoogleGenerativeAI } from '@google/generative-ai';
import { dbRepository } from './db.service.js';
import { calculateAvailableSlots, ScheduleTimeBlock } from './schedule.service.js';
import { buildSystemInstruction, buildDynamicBusinessMemory, buildGlmTools } from './ai.service.js';

export interface ProcessMessageResult {
  replyText: string;
  functionCallsExecuted: string[];
  appointmentCreated?: any;
  appointmentCancelledId?: string;
  engine?: 'LLAMA_LIVE_LLM' | 'GLM_LIVE_LLM' | 'LOCAL_FALLBACK';
  errorReason?: string;
}

export async function transcribeAudioBuffer(audioBuffer: Buffer, mimeType: string = 'audio/ogg'): Promise<string> {
  const cleanMimeType = mimeType.split(';')[0].trim() || 'audio/ogg';

  // 1. Groq Whisper (Gratuito e ultraveloz ~300ms)
  const groqKey = process.env.GROQ_API_KEY || process.env.NVIDIA_API_KEY;
  if (groqKey && (groqKey.startsWith('gsk_') || process.env.GROQ_API_KEY)) {
    try {
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: cleanMimeType });
      const formData = new FormData();
      formData.append('file', blob, 'audio.ogg');
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('language', 'pt');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY || groqKey}` },
        body: formData
      });
      if (res.ok) {
        const json: any = await res.json();
        if (json.text && json.text.trim()) return json.text.trim();
      }
    } catch (e: any) {
      console.warn('[Audio STT Groq Fallback]:', e.message);
    }
  }

  // 2. OpenAI Whisper
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: cleanMimeType });
      const formData = new FormData();
      formData.append('file', blob, 'audio.ogg');
      formData.append('model', 'whisper-1');
      formData.append('language', 'pt');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}` },
        body: formData
      });
      if (res.ok) {
        const json: any = await res.json();
        if (json.text && json.text.trim()) return json.text.trim();
      }
    } catch (e: any) {
      console.warn('[Audio STT OpenAI Fallback]:', e.message);
    }
  }

  // 3. Gemini Multimodal
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const audioPart = {
        inlineData: {
          data: audioBuffer.toString('base64'),
          mimeType: cleanMimeType
        }
      };
      const result = await model.generateContent([
        audioPart,
        'Transcreva este áudio do WhatsApp exatamente como falado pelo cliente em português do Brasil. Retorne APENAS a transcrição textual exata do áudio, sem saudações ou explicações.'
      ]);
      const text = (await result.response).text().trim();
      if (text) return text;
    } catch (e: any) {
      console.warn('[Audio STT Gemini Fallback]:', e.message);
    }
  }

  // Se nenhuma chave de áudio externa estiver definida, utiliza fallback gracioso
  throw new Error('Serviço de transcrição de áudio não configurado. Adicione GROQ_API_KEY, OPENAI_API_KEY ou GEMINI_API_KEY nas variáveis de ambiente.');
}

export interface CustomerSession {
  customerName?: string;
  customerPhone?: string;
  suggestedPushName?: string;
  hasGreeted?: boolean;
  lastQueryDateStr?: string;
  lastQueryDateLabel?: string;
  pendingBookingTime?: string;
  pendingBookingDateStr?: string;
  pendingBookingProfId?: string;
  pendingBookingServiceId?: string;
  pendingExistingApptChoice?: { newDateStr: string; newTimeStr: string; dateFormattedLabel: string };
  lastInteractionTimestamp?: number;
  history: Array<{ role: 'user' | 'model'; text: string }>;
}

const customerSessions = new Map<string, CustomerSession>();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas de inatividade

export function getOrCreateSession(customerPhone: string): CustomerSession {
  const cleanPhone = customerPhone.split('@')[0].split(':')[0].replace(/\D/g, '') || customerPhone;
  const now = Date.now();

  if (customerSessions.has(cleanPhone)) {
    const existing = customerSessions.get(cleanPhone)!;
    if (existing.lastInteractionTimestamp && (now - existing.lastInteractionTimestamp > SESSION_TTL_MS)) {
      const savedName = existing.customerName;
      existing.history = [];
      existing.pendingBookingTime = undefined;
      existing.pendingBookingDateStr = undefined;
      existing.pendingBookingProfId = undefined;
      existing.pendingBookingServiceId = undefined;
      existing.pendingExistingApptChoice = undefined;
      existing.customerName = savedName;
      existing.hasGreeted = false;
    }
    existing.lastInteractionTimestamp = now;
    return existing;
  }

  const newSession: CustomerSession = { 
    customerPhone: cleanPhone, 
    history: [], 
    lastInteractionTimestamp: now 
  };
  customerSessions.set(cleanPhone, newSession);
  return newSession;
}

export function sanitizeUserTimeInput(text: string): string {
  let cleaned = text.toLowerCase();
  cleaned = cleaned.replace(/(\d)oh/gi, '$10h'); 
  cleaned = cleaned.replace(/(\d)o\b/gi, '$10'); 
  cleaned = cleaned.replace(/(\d)o:/gi, '$10:');
  return cleaned;
}

export function isValidRealPhoneNumber(phone?: string): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  // Telefones válidos (com ou sem 55, celular ou fixo) possuem entre 10 e 13 dígitos.
  // Identificadores de privacidade LID do WhatsApp possuem 14 ou 15 dígitos (ex: 166975980450029).
  if (digits.length >= 10 && digits.length <= 13) {
    return true;
  }
  return false;
}

export function extractPhoneNumberFromText(text: string): string | null {
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

export function extractCleanCustomerName(input: string): string {
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

export function parseNaturalLanguageDateTime(
  userMessage: string, 
  session?: CustomerSession
): { 
  dateStr: string; 
  timeStr: string | null; 
  dateFormattedLabel: string;
  hasTimeSpecified: boolean;
  hasExplicitDateInMessage: boolean;
} {
  const lower = sanitizeUserTimeInput(userMessage);
  const now = new Date();
  let targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let dateFormattedLabel = 'Hoje';
  let hasExplicitDateInMessage = false;

  if (lower.includes('amanha') || lower.includes('amanhã')) {
    targetDate.setDate(targetDate.getDate() + 1);
    dateFormattedLabel = 'Amanhã';
    hasExplicitDateInMessage = true;
  } else if (lower.includes('hoje')) {
    dateFormattedLabel = 'Hoje';
    hasExplicitDateInMessage = true;
  } else if (lower.includes('sabado') || lower.includes('sábado')) {
    const currentDay = targetDate.getDay();
    let daysUntilSaturday = (6 - currentDay + 7) % 7;
    if (daysUntilSaturday === 0) daysUntilSaturday = 7;
    targetDate.setDate(targetDate.getDate() + daysUntilSaturday);
    dateFormattedLabel = 'Sábado';
    hasExplicitDateInMessage = true;
  } else if (lower.includes('domingo')) {
    const currentDay = targetDate.getDay();
    let daysUntilSun = (0 - currentDay + 7) % 7;
    if (daysUntilSun === 0) daysUntilSun = 7;
    targetDate.setDate(targetDate.getDate() + daysUntilSun);
    dateFormattedLabel = 'Domingo';
    hasExplicitDateInMessage = true;
  } else if (lower.includes('segunda')) {
    const currentDay = targetDate.getDay();
    let days = (1 - currentDay + 7) % 7;
    if (days === 0) days = 7;
    targetDate.setDate(targetDate.getDate() + days);
    dateFormattedLabel = 'Segunda-feira';
    hasExplicitDateInMessage = true;
  } else if (lower.includes('terça') || lower.includes('terca')) {
    const currentDay = targetDate.getDay();
    let days = (2 - currentDay + 7) % 7;
    if (days === 0) days = 7;
    targetDate.setDate(targetDate.getDate() + days);
    dateFormattedLabel = 'Terça-feira';
    hasExplicitDateInMessage = true;
  } else if (lower.includes('quarta')) {
    const currentDay = targetDate.getDay();
    let days = (3 - currentDay + 7) % 7;
    if (days === 0) days = 7;
    targetDate.setDate(targetDate.getDate() + days);
    dateFormattedLabel = 'Quarta-feira';
    hasExplicitDateInMessage = true;
  } else if (lower.includes('quinta')) {
    const currentDay = targetDate.getDay();
    let days = (4 - currentDay + 7) % 7;
    if (days === 0) days = 7;
    targetDate.setDate(targetDate.getDate() + days);
    dateFormattedLabel = 'Quinta-feira';
    hasExplicitDateInMessage = true;
  } else if (lower.includes('sexta')) {
    const currentDay = targetDate.getDay();
    let days = (5 - currentDay + 7) % 7;
    if (days === 0) days = 7;
    targetDate.setDate(targetDate.getDate() + days);
    dateFormattedLabel = 'Sexta-feira';
    hasExplicitDateInMessage = true;
  } else if (session?.lastQueryDateStr) {
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

  let timeStr: string | null = null;
  let hasTimeSpecified = false;

  const timeMatch = 
    lower.match(/\b(\d{1,2})\s*:\s*(\d{2})\b/) ||
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

function extractBookingIntentFromText(userMessage: string): { dateStr?: string; timeStr?: string } {
  try {
    const info = parseNaturalLanguageDateTime(userMessage, undefined);
    const dateStr = info.hasExplicitDateInMessage ? (info.dateStr || undefined) : undefined;
    const timeStr = info.hasTimeSpecified ? (info.timeStr || undefined) : undefined;
    return { dateStr, timeStr };
  } catch (e) {
    return {};
  }
}

export function formatHumanSlots(
  slots: string[], 
  periodFilter?: 'morning' | 'afternoon',
  profMap?: Record<string, string[]>
): string {
  if (!slots || slots.length === 0) {
    return 'Nenhum horário disponível para esta data.';
  }

  let filteredSlots = slots;
  if (periodFilter === 'morning') {
    filteredSlots = slots.filter(s => parseInt(s.split(':')[0], 10) < 12);
  } else if (periodFilter === 'afternoon') {
    filteredSlots = slots.filter(s => parseInt(s.split(':')[0], 10) >= 12);
  }

  if (filteredSlots.length === 0) {
    filteredSlots = slots;
  }

  // Se houver mais de 6 horários, seleciona uma amostragem ideal (manhã/tarde) para não sobrecarregar o cliente
  const displaySlots = filteredSlots.length > 8 
    ? [filteredSlots[0], filteredSlots[1], filteredSlots[Math.floor(filteredSlots.length / 2)], filteredSlots[filteredSlots.length - 2], filteredSlots[filteredSlots.length - 1]]
    : filteredSlots;

  return displaySlots.map(s => {
    const profsList = profMap && profMap[s] && profMap[s].length > 0
      ? ` _(${profMap[s].join(', ')})_`
      : '';
    return `• *${s}*${profsList}`;
  }).join('\n');
}

export class AiOrchestratorService {
  private getTomorrowDateStr(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }


  private async executeToolCall(tenantId: string, functionName: string, args: any): Promise<{ result: any; appointmentCreated?: any; appointmentCancelledId?: string }> {
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
      const profs = await dbRepository.listProfessionals(tenantId);
      const services = await dbRepository.listServices(tenantId);
      const service = services.find(s => s.id === serviceId) || services[0];
      const serviceDuration = service ? service.durationMinutes : 30;

      const profMap: Record<string, string[]> = {};
      const allUniqueSlots = new Set<string>();

      const targetProfs = professionalId 
        ? profs.filter(p => p.id === professionalId) 
        : (profs.length > 0 ? profs : [{ id: 'prof-1', name: 'Atendente', workSchedule: { startTime: '08:00', endTime: '18:00', lunchStartTime: '12:00', lunchEndTime: '13:00' } }]);

      for (const prof of targetProfs) {
        let scheduleToUse: ScheduleTimeBlock = { startTime: '08:00', endTime: '18:00', lunchStartTime: '12:00', lunchEndTime: '13:00' };
        if (prof.workSchedule) {
          const [y, m, d] = dateStr.split('-').map(Number);
          const targetDate = new Date(y, m - 1, d);
          const dayOfWeek = targetDate.getDay();

          const workDays = (prof.workSchedule as any)?.workDays;
          if (workDays && workDays.length > 0 && !workDays.includes(dayOfWeek)) {
            continue;
          }

          scheduleToUse = {
            startTime: prof.workSchedule.startTime || '08:00',
            endTime: prof.workSchedule.endTime || '18:00',
            lunchStartTime: prof.workSchedule.lunchStartTime || null,
            lunchEndTime: prof.workSchedule.lunchEndTime || null
          };
        }

        const existingAppointments = await dbRepository.getAppointmentsForProfessional(prof.id, dateStr);
        const slots = calculateAvailableSlots({
          dateStr,
          serviceDurationMinutes: serviceDuration,
          schedule: scheduleToUse,
          existingAppointments: existingAppointments.map(a => ({ startTime: a.startTime, endTime: a.endTime })),
          slotIntervalMinutes: 30
        });

        for (const s of slots) {
          allUniqueSlots.add(s);
          if (!profMap[s]) profMap[s] = [];
          profMap[s].push(prof.name);
        }
      }

      const sortedSlots = Array.from(allUniqueSlots).sort();
      return { 
        result: { 
          data: dateStr, 
          horariosDisponiveis: sortedSlots,
          profMap: profMap
        } 
      };
    }

    if (functionName === 'create_appointment') {
      const { professionalId, serviceId, customerName, customerPhone, dateStr, timeStr } = args;

      const cleanName = extractCleanCustomerName(customerName || '');
      const isGenericName = !cleanName || cleanName.toLowerCase() === 'cliente' || cleanName.toLowerCase() === 'cliente whatsapp' || cleanName.length < 2 || cleanName.toLowerCase().includes('nome completo');

      if (!dateStr || !timeStr || isGenericName) {
        return {
          result: {
            status: 'ERRO_PARAMETROS_PENDENTES',
            mensagem: 'Não é possível agendar ainda porque faltam dados essenciais (nome completo do cliente, dia ou horário). Por favor, pergunte ao cliente de forma simpática qual dia/horário ele deseja e o nome completo dele antes de agendar.'
          }
        };
      }

      const profs = await dbRepository.listProfessionals(tenantId);
      const services = await dbRepository.listServices(tenantId);
      const targetProfId = professionalId || profs[0]?.id || 'prof-1';
      const targetServiceId = serviceId || services[0]?.id || 'srv-1';

      const service = services.find(s => s.id === targetServiceId) || services[0];
      const duration = service ? service.durationMinutes : 30;

      const [year, month, day] = dateStr.split('-').map(Number);
      const [hours, minutes] = timeStr.split(':').map(Number);

      // Usa string ISO local para evitar conversão de fuso (ex: 14:00 BRT não vira 11:00 UTC)
      const pad = (n: number) => String(n).padStart(2, '0');
      const localIso = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;
      const startTime = new Date(localIso);
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

      const pad = (n: number) => String(n).padStart(2, '0');
      const localIso = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;
      const startTime = new Date(localIso);
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

  async processIncomingMessage(
    tenantId: string, 
    customerPhone: string, 
    userMessage: string,
    customConfig?: { systemPrompt?: string; businessInfo?: string; pushName?: string }
  ): Promise<ProcessMessageResult> {
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
    const products = await dbRepository.listProducts(tenantId);

    // 1. Atualiza dados de sessão a partir do texto do usuário
    const extractedIntent = extractBookingIntentFromText(userMessage);
    if (extractedIntent.timeStr) session.pendingBookingTime = extractedIntent.timeStr;
    if (extractedIntent.dateStr) session.pendingBookingDateStr = extractedIntent.dateStr;

    const possibleName = extractCleanCustomerName(userMessage);
    if (possibleName && possibleName.toLowerCase() !== 'cliente' && possibleName.length >= 3 && !userMessage.toLowerCase().includes('marcar') && !userMessage.toLowerCase().includes('corte') && !userMessage.toLowerCase().includes('horário')) {
      session.customerName = possibleName;
    }

    if (userMessage.toLowerCase().includes('lucas')) {
      const profLucas = profs.find(p => p.name.toLowerCase().includes('lucas'));
      if (profLucas) session.pendingBookingProfId = profLucas.id;
    } else if (userMessage.toLowerCase().includes('matheus')) {
      const profMatheus = profs.find(p => p.name.toLowerCase().includes('matheus'));
      if (profMatheus) session.pendingBookingProfId = profMatheus.id;
    }

    const fullInstruction = buildDynamicBusinessMemory({
      tenantName: tenant.name,
      systemPrompt,
      businessInfo,
      services,
      products,
      professionals: profs,
      customerPhone,
      customerName: session.customerName,
      pendingBookingTime: session.pendingBookingTime,
      pendingBookingDateStr: session.pendingBookingDateStr,
      pendingBookingProfId: session.pendingBookingProfId
    });

    const apiKey = process.env.NVIDIA_API_KEY || '';
    if (!apiKey) {
      throw new Error('NVIDIA_API_KEY não configurada. Adicione a variável de ambiente no painel do Render/servidor.');
    }

    // Monta histórico no formato OpenAI (role: user/assistant)
    const messages: any[] = [
      { role: 'system', content: fullInstruction }
    ];
    for (const h of session.history.slice(0, -1)) {
      if (h.text && typeof h.text === 'string' && h.text.trim()) {
        messages.push({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: h.text
        });
      }
    }
    messages.push({ role: 'user', content: userMessage });

    const tools = buildGlmTools();

    try {
      const executedTools: string[] = [];
      let appointmentCreated: any = undefined;
      let appointmentCancelledId: string | undefined = undefined;

      // Loop de function calling OpenAI-compatible
      for (let round = 0; round < 5; round++) {
        const resp = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'meta/llama-3.1-8b-instruct',
            messages,
            tools,
            tool_choice: 'auto',
            max_tokens: 1024,
            temperature: 0.75
          })
        });

        if (!resp.ok) {
          const errBody = await resp.text();
          throw new Error(`LLM API ${resp.status}: ${errBody}`);
        }

        const data = await resp.json();
        const choice = data.choices?.[0];
        const msg = choice?.message;

        if (!msg) throw new Error('LLM retornou resposta vazia.');

        // Verifica se o modelo quer chamar ferramentas
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          messages.push(msg); // adiciona a mensagem do assistant com tool_calls

          for (const toolCall of msg.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs: any = {};
            try { toolArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch {}

            // Preenche dados pendentes da sessão se a IA não passou argumentos
            if (toolName === 'create_appointment') {
              if (!toolArgs.customerName && session.customerName) toolArgs.customerName = session.customerName;
              if (!toolArgs.dateStr && session.pendingBookingDateStr) toolArgs.dateStr = session.pendingBookingDateStr;
              if (!toolArgs.timeStr && session.pendingBookingTime) toolArgs.timeStr = session.pendingBookingTime;
              if (!toolArgs.professionalId && session.pendingBookingProfId) toolArgs.professionalId = session.pendingBookingProfId;
            }

            executedTools.push(toolName);
            const toolExec = await this.executeToolCall(tenantId, toolName, toolArgs);
            if (toolExec.appointmentCreated) {
              appointmentCreated = toolExec.appointmentCreated;
              session.pendingBookingTime = undefined;
              session.pendingBookingDateStr = undefined;
            }
            if (toolExec.appointmentCancelledId) appointmentCancelledId = toolExec.appointmentCancelledId;

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolExec.result)
            });
          }
          // Continua o loop para o modelo gerar a resposta final
          continue;
        }

        // Resposta de texto final
        const finalReply = msg.content || '';

        // Safety Net: Se a IA confirmou verbalmente o agendamento mas não acionou a ferramenta create_appointment,
        // efetuamos a gravação automática no banco para salvar o agendamento!
        const replyLower = finalReply.toLowerCase();
        const isVerbalConfirm = (replyLower.includes('confirmad') || replyLower.includes('sucesso') || replyLower.includes('marcad') || replyLower.includes('tudo certo')) && (replyLower.includes('sábado') || replyLower.includes('sabado') || replyLower.includes('amanhã') || replyLower.includes('amanha') || replyLower.includes('hoje') || replyLower.includes('às') || replyLower.includes('as '));

        const targetCustomerName = session.customerName || (possibleName && possibleName.length >= 3 ? possibleName : undefined);

        if (!appointmentCreated && isVerbalConfirm && targetCustomerName && targetCustomerName.toLowerCase() !== 'cliente') {
          const targetDateStr = session.pendingBookingDateStr || this.getTomorrowDateStr();
          const targetTimeStr = session.pendingBookingTime || '10:00';
          const targetProfId = session.pendingBookingProfId || profs[0]?.id || 'prof-1';
          const targetServiceId = services[0]?.id || 'srv-1';

          const safetyExec = await this.executeToolCall(tenantId, 'create_appointment', {
            professionalId: targetProfId,
            serviceId: targetServiceId,
            customerName: targetCustomerName,
            customerPhone,
            dateStr: targetDateStr,
            timeStr: targetTimeStr
          });

          if (safetyExec.appointmentCreated) {
            appointmentCreated = safetyExec.appointmentCreated;
            executedTools.push('create_appointment');
            session.pendingBookingTime = undefined;
            session.pendingBookingDateStr = undefined;
          }
        }

        session.history.push({ role: 'model', text: finalReply });
        return {
          replyText: finalReply,
          functionCallsExecuted: executedTools,
          appointmentCreated,
          appointmentCancelledId,
          engine: 'LLAMA_LIVE_LLM'
        };
      }

      throw new Error('Número máximo de rounds de tool calling atingido.');
    } catch (error: any) {
      console.warn('[GLM-5.2 LLM Engine Exception]:', error.message);
      const simResult = await this.simulateHumanReceptionist(tenantId, customerPhone, userMessage, systemPrompt, session);
      simResult.engine = 'LOCAL_FALLBACK';
      simResult.errorReason = error.message;
      session.history.push({ role: 'model', text: simResult.replyText });
      return simResult;
    }
  }

  private async simulateHumanReceptionist(
    tenantId: string, 
    customerPhone: string, 
    userMessage: string, 
    customPrompt?: string,
    session?: CustomerSession
  ): Promise<ProcessMessageResult> {
    const lower = sanitizeUserTimeInput(userMessage);
    const executedTools: string[] = [];

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
            if (hours < 7 && !histText.toLowerCase().includes('manhã')) hours += 12;
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
        } else if (isExplicitReminderCancel) {
          activeAppt.status = 'CANCELLED';
          await dbRepository.updateAppointmentDetails(activeAppt.id, { status: 'CANCELLED' });
          return {
            replyText: `Entendido, *${clientNameStr}*! Seu agendamento para *${dateFormatted} às ${timeStrFormatted}* foi **CANCELADO**. Se quiser agendar para outro dia ou horário, é só nos chamar por aqui! `,
            functionCallsExecuted: ['cancel_appointment']
          };
        }
      }
    }

    // Extrai profissional se o cliente mencionou o nome ou primeiro nome de algum profissional (ex: "Matheus tem horário?", "com o Lucas", "vai ser com Matheus")
    const matchedProf = profs.find(p => {
      const pNameLower = p.name.toLowerCase();
      const firstName = pNameLower.split(' ')[0];
      const firstNameRegex = new RegExp(`\\b${firstName}\\b`, 'i');
      const fullNameRegex = new RegExp(`\\b${pNameLower}\\b`, 'i');
      return fullNameRegex.test(lower) || firstNameRegex.test(lower);
    });

    if (matchedProf && session) {
      session.pendingBookingProfId = matchedProf.id;
    }

    // 0.0 Pergunta de Verificação de Agendamento ("Está marcado com Matheus?", "Confirmado com Lucas?")
    if (lower.includes('marcado com') || lower.includes('agendado com') || lower.includes('vai ser com') || lower.includes('com o matheus') || lower.includes('com o lucas')) {
      const activeAppt = await dbRepository.findActiveAppointmentByPhone(tenantId, customerPhone);
      if (activeAppt) {
        const apptDate = new Date(activeAppt.startTime);
        const [y, m, d] = activeAppt.startTime.toISOString().split('T')[0].split('-');
        const timeFormatted = `${String(apptDate.getHours()).padStart(2, '0')}:${String(apptDate.getMinutes()).padStart(2, '0')}`;
        const pObj = profs.find(p => p.id === activeAppt.professionalId);
        const pName = pObj ? pObj.name : 'nosso profissional';
        const clientName = activeAppt.customerName || session?.customerName || 'Cliente';

        return {
          replyText: `Isso mesmo, *${clientName}*! Seu agendamento está 100% confirmado com o *${pName}* às *${timeFormatted}* de *${d}/${m}/${y}*! Te esperamos logo mais. `,
          functionCallsExecuted: []
        };
      }
    }

    // 0.1 Pergunta de Quem Atende / Quem faz o serviço ("quem está atendendo na segunda?", "quem corta cabelo?", "quem faz sobrancelha?")
    const isWhoAttendsQuery = 
      lower.includes('quem atende') || 
      lower.includes('quem está atendendo') || 
      lower.includes('quem esta atendendo') || 
      lower.includes('quem corta') || 
      lower.includes('quem faz') || 
      lower.includes('quem trabalha');

    const matchedServiceForWho = services.find(s => {
      const sNameLower = s.name.toLowerCase();
      return lower.includes(sNameLower) || sNameLower.split(' ').filter(w => w.length > 3).some(w => lower.includes(w));
    });

    if (isWhoAttendsQuery) {
      let matchingProfs = profs;
      if (matchedServiceForWho) {
        matchingProfs = profs.filter(p => !p.servicesHandled || p.servicesHandled.length === 0 || p.servicesHandled.includes(matchedServiceForWho.id));
        if (matchingProfs.length === 0) matchingProfs = profs;
      }
      const profNames = matchingProfs.map(p => `*${p.name}*`).join(' e ');
      const dayLabel = hasExplicitDateInMessage ? ` para *${dateFormattedLabel}*` : '';
      const sLabel = matchedServiceForWho ? ` para *${matchedServiceForWho.name}*` : '';
      return {
        replyText: `Aqui na equipe${dayLabel}${sLabel}, quem atende é o ${profNames}! ✂️\n\nQuer dar uma olhada nos horários livres de algum deles ou prefere ver a agenda completa?`,
        functionCallsExecuted: []
      };
    }

    // 0.2 Pergunta de Profissionais Específicos ("só o lucas atende?", "o matheus também atende?")
    if (lower.includes('so lucas') || lower.includes('só lucas') || lower.includes('só o lucas') || lower.includes('so o lucas') || lower.includes('so matheus') || lower.includes('só matheus') || lower.includes('so o matheus') || lower.includes('só o matheus') || lower.includes('tambem atende') || lower.includes('também atende')) {
      const profNames = profs.map(p => `*${p.name}*`).join(' e ');
      return {
        replyText: `Nós temos ${profNames} atendendo na nossa equipe! ✂️\n\nSe você preferir agendar com um profissional específico, só me avisar o nome dele que busco os horários pra você!`,
        functionCallsExecuted: []
      };
    }

    // 0.3 Pergunta de Ausência de Horários ("não tem horario para hoje?", "lotado hoje?")
    if (lower.includes('não tem') || lower.includes('nao tem') || lower.includes('sem horario') || lower.includes('sem horário') || lower.includes('lotado')) {
      return {
        replyText: `Poxa, para hoje a nossa agenda já está 100% cheia! 💈\n\nMas para *Amanhã* eu consigo te encaixar com calma na equipe. Quer dar uma olhada nos horários livres de amanhã?`,
        functionCallsExecuted: []
      };
    }

    // 0.4 Pergunta de Horários de Amanhã ("e para amanha", "e para amanhã", "e amanha", "e amanhã")
    if (lower === 'e para amanha' || lower === 'e para amanhã' || lower === 'e amanha' || lower === 'e amanhã' || lower === 'e pra amanha' || lower === 'e pra amanhã' || lower === 'e amanhã?' || lower === 'e amanha?') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomY = tomorrow.getFullYear();
      const tomM = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const tomD = String(tomorrow.getDate()).padStart(2, '0');
      const tomDateStr = `${tomY}-${tomM}-${tomD}`;

      const tomSlotsExec = await this.executeToolCall(tenantId, 'get_available_slots', { professionalId: session?.pendingBookingProfId || defaultProfId, serviceId: defaultServiceId, dateStr: tomDateStr });
      const availableSlots = tomSlotsExec.result.horariosDisponiveis || [];
      const tomProfMap = tomSlotsExec.result.profMap;

      return {
        replyText: `Para *Amanhã (${tomD}/${tomM})*, temos estes horários livres na agenda:\n\n${formatHumanSlots(availableSlots, undefined, tomProfMap)}\n\nQual desses horários fica melhor para você?`,
        functionCallsExecuted: ['get_available_slots']
      };
    }

    // 0.5 Saudação Pura / Cumprimento ("boa tarde", "bom dia", "boa noite", "oi", "olá", "tudo bem?")
    const isPureGreeting = 
      /^(bom\s*dia|boa\s*tarde|boa\s*noite|olá|ola|oi|opa|tudo\s*bem|fala|e\s*ai|e\s*aí)[!.\s]*$/i.test(lower.trim());

    if (isPureGreeting) {
      const nowHour = new Date().getHours();
      let greetingTime = 'Olá';
      if (nowHour >= 5 && nowHour < 12) greetingTime = 'Bom dia';
      else if (nowHour >= 12 && nowHour < 18) greetingTime = 'Boa tarde';
      else greetingTime = 'Boa noite';

      return {
        replyText: `${greetingTime}! Tudo ótimo por aqui! 😊 Como posso te ajudar hoje? Se quiser dar uma olhada nos horários, serviços ou agendar um atendimento, só me avisar!`,
        functionCallsExecuted: []
      };
    }

    // 1. Agradecimento e Despedida
    if (lower.includes('obrigad') || lower.includes('valeu') || lower.includes('tmj') || lower.includes('muito obrigado') || lower.includes('flw')) {
      const name = session?.customerName ? `, ${session.customerName}` : '';
      return { replyText: `Por nada${name}! Tamo junto! Qualquer coisa só me chamar aqui.`, functionCallsExecuted: [] };
    }

    // 2. Pergunta de Identidade ("como é seu nome?", "quem é você?", "quem fala?")
    if (lower.includes('seu nome') || lower.includes('como te chamo') || lower.includes('quem e voce') || lower.includes('quem é você') || lower.includes('com quem falo') || lower.includes('quem ta falando') || lower.includes('quem tá falando')) {
      return {
        replyText: `Sou a recepcionista aqui do estabelecimento! Como posso te ajudar hoje? 😊`,
        functionCallsExecuted: []
      };
    }

    // 2.1 Resposta à escolha explícita de profissional quando o usuário responde apenas o nome do profissional (ex: "matheus", "lucas", "com matheus")
    const isJustProfName = Boolean(matchedProf) && !hasTimeSpecified && !phoneInText && !lower.includes('hoje') && !lower.includes('amanhã');
    if (isJustProfName && matchedProf) {
      if (session) {
        session.pendingBookingProfId = matchedProf.id;
      }
      const profName = matchedProf.name;

      if (session?.pendingBookingTime) {
        const targetTimeStr = session.pendingBookingTime;
        const clientName = session.customerName;
        const hasRealPhone = isValidRealPhoneNumber(phoneInText || session.customerPhone || customerPhone);

        if (!clientName) {
          return {
            replyText: `Fechado! Agendamento com o *${profName}* para as *${targetTimeStr}* anotado! ✂️ O agendamento é em seu nome mesmo ou para outra pessoa?`,
            functionCallsExecuted: []
          };
        }

        if (!hasRealPhone) {
          return {
            replyText: `Perfeito, *${clientName}*! Agendamento com o *${profName}* às *${targetTimeStr}*! ✂️ Me manda por favor o seu número de WhatsApp com DDD para eu confirmar e te mandar os lembretes?`,
            functionCallsExecuted: []
          };
        }
      } else {
        // Se ainda não escolheu horário, exibe diretamente os horários livres desse profissional!
        const slotsExec = await this.executeToolCall(tenantId, 'get_available_slots', { professionalId: matchedProf.id, serviceId: defaultServiceId, dateStr });
        let availableSlots: string[] = slotsExec.result.horariosDisponiveis || [];
        let targetDateFormatted = dateFormattedLabel;
        let targetDateStr = dateStr;

        if (availableSlots.length === 0 && dateFormattedLabel === 'Hoje') {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomY = tomorrow.getFullYear();
          const tomM = String(tomorrow.getMonth() + 1).padStart(2, '0');
          const tomD = String(tomorrow.getDate()).padStart(2, '0');
          targetDateStr = `${tomY}-${tomM}-${tomD}`;
          targetDateFormatted = 'Amanhã';

          const tomSlotsExec = await this.executeToolCall(tenantId, 'get_available_slots', { professionalId: matchedProf.id, serviceId: defaultServiceId, dateStr: targetDateStr });
          availableSlots = tomSlotsExec.result.horariosDisponiveis || [];
        }

        const [y, m, d] = targetDateStr.split('-');
        if (availableSlots.length > 0) {
          return {
            replyText: `Show de bola! Para o *${profName}*, temos estes horários livres para *${targetDateFormatted} (${d}/${m})*:\n\n${formatHumanSlots(availableSlots)}\n\nQual desses horários fica melhor para você?`,
            functionCallsExecuted: ['get_available_slots']
          };
        } else {
          return {
            replyText: `O *${profName}* está com a agenda lotada para hoje! Deseja ver os horários dele para amanhã ou consultar outro dia?`,
            functionCallsExecuted: []
          };
        }
      }
    }

    // 3. SE EXISTE UM HORÁRIO EM NEGOCIAÇÃO E O CLIENTE ENVIA O NOME OU DADOS
    if (session?.pendingBookingTime) {
      const targetDateStr = session.pendingBookingDateStr || dateStr;
      const targetTimeStr = session.pendingBookingTime;
      const targetProfId = session.pendingBookingProfId || defaultProfId;
      const targetServiceId = session.pendingBookingServiceId || defaultServiceId;

      // Se a mensagem contiver o nome (ex: "Iran Araujo", "Meu nome é Iran", "Pode colocar Iran Araujo", "Iran", etc.)
      const isSelfConfirm = lower.includes('sim') || lower.includes('mim') || lower.includes('isso') || lower.includes('mesmo') || lower.includes('sou eu') || lower.includes('meu nome') || lower.includes('pra mim');
      const isProfMention = Boolean(matchedProf) || lower.includes('com ') || lower.includes('com o ') || lower.includes('vai ser com');

      if (!session.customerName && !isProfMention) {
        if (isSelfConfirm && session.suggestedPushName) {
          session.customerName = session.suggestedPushName;
        } else if (!hasTimeSpecified) {
          session.customerName = extractCleanCustomerName(userMessage);
        }
      }

      const clientName = session.customerName || extractCleanCustomerName(userMessage) || session.suggestedPushName || 'Cliente';
      session.customerName = clientName;

      const clientPhone = (phoneInText && isValidRealPhoneNumber(phoneInText)) 
        ? phoneInText 
        : (isValidRealPhoneNumber(session.customerPhone) ? session.customerPhone! : customerPhone);

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

      const profObj = profs.find(p => p.id === targetProfId) || profs[0];
      const profName = profObj ? ` com o *${profObj.name}*` : '';
      const [y, m, d] = targetDateStr.split('-');
      return {
        replyText: `Show de bola, *${clientName}*! Seu horário${profName} para *${session.lastQueryDateLabel || 'o dia escolhido'} (${d}/${m}/${y})* às *${targetTimeStr}* está **confirmado com sucesso**! Te esperamos aqui!`,
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
      const availableSlots: string[] = slotsExec.result.horariosDisponiveis || [];

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
      } else {
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
          pServices = services.filter(s => p.servicesHandled!.includes(s.id));
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

    const isAffirmativeSlotsRequest = 
      lower === 'quero' || 
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
      let availableSlots: string[] = slotsExec.result.horariosDisponiveis || [];
      let targetDateFormatted = dateFormattedLabel;
      let targetDateStr = dateStr;

      // Se hoje não houver mais horários livres, consulta automaticamente o dia de amanhã
      if (availableSlots.length === 0 && dateFormattedLabel === 'Hoje') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomY = tomorrow.getFullYear();
        const tomM = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const tomD = String(tomorrow.getDate()).padStart(2, '0');
        targetDateStr = `${tomY}-${tomM}-${tomD}`;
        targetDateFormatted = 'Amanhã';

        const tomSlotsExec = await this.executeToolCall(tenantId, 'get_available_slots', { professionalId: defaultProfId, serviceId: defaultServiceId, dateStr: targetDateStr });
        availableSlots = tomSlotsExec.result.horariosDisponiveis || [];
        const tomProfMap = tomSlotsExec.result.profMap;
        const [tY, tM, tD] = targetDateStr.split('-');
        return {
          replyText: `Com certeza! Temos estes horários livres para *${targetDateFormatted} (${tD}/${tM})*:\n\n${formatHumanSlots(availableSlots, undefined, tomProfMap)}\n\nQual desses fica melhor para você? `,
          functionCallsExecuted: executedTools
        };
      }

      const profMap = slotsExec.result.profMap;
      const [curY, curM, curD] = targetDateStr.split('-');
      return {
        replyText: `Com certeza! Temos estes horários livres para *${targetDateFormatted} (${curD}/${curM})*:\n\n${formatHumanSlots(availableSlots, undefined, profMap)}\n\nQual desses fica melhor para você? `,
        functionCallsExecuted: executedTools
      };
    }

    // 7. Consulta de Dia / Período / Horários de Profissional
    const isPeriodOrDayQuery = 
      hasExplicitDateInMessage || 
      Boolean(matchedProf) ||
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
      const targetProfIdToQuery = matchedProf ? matchedProf.id : (session?.pendingBookingProfId || undefined);
      const slotsExec = await this.executeToolCall(tenantId, 'get_available_slots', { 
        professionalId: targetProfIdToQuery, 
        serviceId: defaultServiceId, 
        dateStr 
      });
      executedTools.push('get_available_slots');
      let availableSlots: string[] = slotsExec.result.horariosDisponiveis || [];
      const profMap = slotsExec.result.profMap;

      let periodFilter: 'morning' | 'afternoon' | undefined = undefined;
      if (/\bmanhã\b|\bmanha\b/i.test(lower)) periodFilter = 'morning';
      else if (/\btarde\b/i.test(lower)) periodFilter = 'afternoon';

      const periodLabel = periodFilter === 'morning' ? ' pela manhã' : periodFilter === 'afternoon' ? ' pela tarde' : '';
      const [y, m, d] = dateStr.split('-');
      const profLabel = matchedProf ? ` para o *${matchedProf.name}*` : '';

      if (availableSlots.length > 0) {
        return {
          replyText: `Show de bola! Para *${dateFormattedLabel} (${d}/${m})*${profLabel}${periodLabel}, temos estes horários livres:\n\n${formatHumanSlots(availableSlots, periodFilter, profMap)}\n\nQual desses horários fica melhor para você?`,
          functionCallsExecuted: executedTools
        };
      } else {
        const profNameStr = matchedProf ? `O *${matchedProf.name}*` : 'Nossa equipe';
        return {
          replyText: `${profNameStr} está com a agenda lotada para *${dateFormattedLabel} (${d}/${m})*! Deseja ver os horários para outro dia ou consultar outro profissional?`,
          functionCallsExecuted: executedTools
        };
      }
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
        const availableSlots: string[] = slotsExec.result.horariosDisponiveis || [];
        const profMap = slotsExec.result.profMap;

        return {
          replyText: `Com certeza! Vamos agendar ${serviceLabel} para *${dateFormattedLabel}*! \n\nOlha os horários livres que temos:\n${formatHumanSlots(availableSlots, undefined, profMap)}\n\nQual desses fica melhor pra você?`,
          functionCallsExecuted: executedTools
        };
      } else {
        return {
          replyText: `Com certeza! Vamos agendar ${serviceLabel}!  Qual dia (ex: hoje, amanhã, sábado) e horário fica melhor pra você vir?`,
          functionCallsExecuted: []
        };
      }
    }

    // 8. Saudações Iniciais
    if (lower.includes('bom dia') || lower.includes('boa tarde') || lower.includes('boa noite') || lower.includes('ola') || lower.includes('olá') || lower.includes('oi') || lower.includes('opa') || lower.includes('fala')) {
      if (session) session.hasGreeted = true;
      const hours = new Date().getHours();
      let greeting = 'Olá!';
      if (hours >= 5 && hours < 12) greeting = 'Bom dia!';
      else if (hours >= 12 && hours < 18) greeting = 'Boa tarde!';
      else greeting = 'Boa noite!';

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
      } else {
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
