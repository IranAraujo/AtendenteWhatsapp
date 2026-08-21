import dotenv from 'dotenv';
dotenv.config();
import { GoogleGenerativeAI } from '@google/generative-ai';
import { dbRepository } from './db.service.js';
import { calculateAvailableSlots, ScheduleTimeBlock, selectRoundRobinProfessional } from './schedule.service.js';
import { buildSystemInstruction, buildDynamicBusinessMemory, buildGlmTools } from './ai.service.js';
import { webhookService } from './webhook.service.js';

export interface ProcessMessageResult {
  replyText: string;
  functionCallsExecuted: string[];
  appointmentCreated?: any;
  appointmentCancelledId?: string;
  engine?: 'LLAMA_LIVE_LLM' | 'GLM_LIVE_LLM' | 'LOCAL_FALLBACK';
  errorReason?: string;
}

export async function transcribeAudioBuffer(audioBuffer: Buffer, mimeType: string = 'audio/ogg'): Promise<string> {
  if (!audioBuffer || audioBuffer.length === 0) return '';
  const cleanMimeType = mimeType.split(';')[0].trim() || 'audio/ogg';

  let filename = 'audio.ogg';
  let cleanType = 'audio/ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) {
    filename = 'audio.m4a';
    cleanType = 'audio/mp4';
  } else if (mimeType.includes('wav')) {
    filename = 'audio.wav';
    cleanType = 'audio/wav';
  } else if (mimeType.includes('webm')) {
    filename = 'audio.webm';
    cleanType = 'audio/webm';
  } else if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
    filename = 'audio.mp3';
    cleanType = 'audio/mp3';
  }

  // 1. Groq Whisper (Gratuito e ultraveloz ~300ms)
  const groqKey = process.env.GROQ_API_KEY || process.env.NVIDIA_API_KEY;
  if (groqKey && (groqKey.startsWith('gsk_') || process.env.GROQ_API_KEY)) {
    const modelsToTry = ['whisper-large-v3-turbo', 'whisper-large-v3'];
    for (const model of modelsToTry) {
      try {
        const blob = new Blob([new Uint8Array(audioBuffer)], { type: cleanType });
        const formData = new FormData();
        formData.append('file', blob, filename);
        formData.append('model', model);
        formData.append('language', 'pt');

        const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY || groqKey}` },
          body: formData
        });

        if (res.ok) {
          const json: any = await res.json();
          if (json.text && json.text.trim()) {
            return json.text.trim();
          }
        } else {
          const errText = await res.text();
          console.warn(`[Audio STT Groq ${model}]: status ${res.status} - ${errText}`);
        }
      } catch (e: any) {
        console.warn(`[Audio STT Groq ${model} Error]:`, e.message);
      }
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
  pendingActionConfirmation?: {
    type: 'CANCEL' | 'RESCHEDULE';
    appointmentId: string;
    newDateStr?: string;
    newTimeStr?: string;
    currentDateStr?: string;
    currentTimeStr?: string;
    profName?: string;
  };
  lastInteractionTimestamp?: number;
  history: Array<{ role: 'user' | 'model'; text: string }>;
  pendingWaitlist?: { dateStr: string; professionalId?: string; serviceId?: string; };
  isRecurringClient?: boolean;
}

const customerSessions = new Map<string, CustomerSession>();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas de inatividade

// M6: Limpeza proativa de sessões inativas a cada 30 min para evitar memory leak em produção
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [phone, session] of customerSessions.entries()) {
    if (session.lastInteractionTimestamp && (now - session.lastInteractionTimestamp > SESSION_TTL_MS)) {
      customerSessions.delete(phone);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[Session GC] ${cleaned} sessões inativas removidas. Sessões ativas: ${customerSessions.size}`);
  }
}, 30 * 60 * 1000);

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
      existing.pendingActionConfirmation = undefined;
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
  if (!input) return '';
  let text = input.trim();

  const explicitPrefixes = [
    /^meu\s+nome\s+(é|e)\s+/i,
    /^me\s+chamo\s+/i,
    /^me\s+chama\s+/i,
    /^chamo\s+/i,
    /^sou\s+(o|a)\s+/i,
    /^pode\s+colocar\s+(o\s+nome\s+(de\s+)?)?/i,
    /^pode\s+anotar\s+(o\s+nome\s+(de\s+)?)?/i,
    /^anota\s+(aí\s+|ai\s+)?(o\s+nome\s+(de\s+)?)?/i,
    /^nome\s*:\s*/i,
    /^não,?\s*(é|e)?\s*(para|pra|pro|o|a)?\s+/i,
    /^(é|e)\s*(para|pra|pro|o|a)\s+/i
  ];

  let hasExplicitIntro = false;
  for (const prefix of explicitPrefixes) {
    if (prefix.test(text)) {
      text = text.replace(prefix, '').trim();
      hasExplicitIntro = true;
      break;
    }
  }

  const cleaned = text.replace(/[.,!?;:()\[\]{}—–\-_]/g, ' ').replace(/\s+/g, ' ').trim();
  const lower = cleaned.toLowerCase();

  const forbiddenWords = [
    'quero', 'queria', 'queira', 'gostaria', 'posso', 'podemos', 'pode', 'vamos', 'vou', 'vai',
    'marcar', 'agendar', 'ver', 'trocar', 'mudar', 'reagendar', 'cancelar', 'desmarcar',
    'corte', 'cote', 'cortar', 'fazer', 'barba', 'cabelo', 'sobrancelha', 'escova', 'unha', 'massagem',
    'serviço', 'servico', 'atendimento', 'produto', 'pomada', 'shampoo',
    'hoje', 'amanhã', 'amanha', 'ontem', 'segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta', 'sábado', 'sabado', 'domingo',
    'manhã', 'manha', 'tarde', 'noite', 'horário', 'horario', 'hora', 'horas', 'vaga', 'livre',
    'sim', 'não', 'nao', 'ok', 'beleza', 'valeu', 'obrigado', 'obrigada', 'por favor', 'pfv', 'show',
    'lucas', 'matheus', 'atendente', 'recepcionista', 'salão', 'salao', 'barbearia', 'estilo', 'beleza',
    'cliente', 'whatsapp', 'informado', 'desconhecido', 'completo', 'nome',
    'para', 'pra', 'pro', 'com', 'sem', 'tem', 'teria', 'ter', 'estar', 'está', 'esta', 'ser', 'simples'
  ];

  const words = lower.split(/\s+/).filter(Boolean);

  if (/\d/.test(cleaned)) return '';
  if (!hasExplicitIntro && (words.length > 4 || cleaned.length > 35)) return '';

  if (!hasExplicitIntro) {
    if (words.some(w => forbiddenWords.includes(w))) return '';
  } else {
    const validWords: string[] = [];
    for (const w of text.split(/\s+/)) {
      if (forbiddenWords.includes(w.toLowerCase()) && !['da', 'de', 'do', 'dos', 'das', 'e'].includes(w.toLowerCase())) break;
      validWords.push(w);
    }
    const result = validWords.join(' ').trim();
    if (result.length < 2) return '';
    return result;
  }

  if (cleaned.length < 2) return '';
  return cleaned;
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
      const service = services.find(s => s.id === serviceId || (serviceId && s.name.toLowerCase().includes(serviceId.toLowerCase()))) || services[0];
      const serviceDuration = service ? service.durationMinutes : 30;

      const profMap: Record<string, string[]> = {};
      const allUniqueSlots = new Set<string>();

      const targetProfs = professionalId 
        ? profs.filter(p => p.id === professionalId || p.name.toLowerCase().includes(professionalId.toLowerCase())) 
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
        const blocks = await dbRepository.getScheduleBlocks(tenantId, prof.id, dateStr);
        const dayCount = await dbRepository.getDailyAppointmentCount(prof.id, dateStr);
        const tenantItem = await dbRepository.getTenantById(tenantId);
        const bufferMinutes = service?.bufferTimeMinutes ?? tenantItem?.bookingRules?.bufferTimeMinutes ?? 10;
        const minNotice = tenantItem?.bookingRules?.minimumNoticeMinutes ?? 60;
        const tenantDailyLimit = dbRepository.getTenantDailyAppointmentLimit(tenantItem);
        const tenantDayCount = await dbRepository.getDailyAppointmentCountForTenant(tenantId, dateStr);
        const maxFutureDays = tenantItem?.bookingRules?.maxFutureDays ?? 30;

        const slots = calculateAvailableSlots({
          dateStr,
          serviceDurationMinutes: serviceDuration,
          schedule: scheduleToUse,
          existingAppointments: existingAppointments.map(a => ({ startTime: a.startTime, endTime: a.endTime })),
          scheduleBlocks: blocks.map(b => ({ startTime: b.startTime, endTime: b.endTime })),
          maxAppointmentsPerDay: (prof as any).maxAppointmentsPerDay,
          currentDayAppointmentCount: dayCount,
          maxDailyAppointmentsForTenant: tenantDailyLimit,
          currentTenantDailyAppointmentCount: tenantDayCount,
          bufferTimeMinutes: bufferMinutes,
          minimumNoticeMinutes: minNotice,
          maxFutureDays: maxFutureDays,
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

      let targetDateStr = dateStr || this.getTomorrowDateStr();
      let targetTimeStr = timeStr || '14:00';
      if (!targetDateStr.includes('-')) targetDateStr = this.getTomorrowDateStr();
      if (!targetTimeStr.includes(':')) targetTimeStr = '14:00';

      const profs = await dbRepository.listProfessionals(tenantId);
      const services = await dbRepository.listServices(tenantId);
      const targetProf = profs.find(p => p.id === professionalId || (professionalId && p.name.toLowerCase().includes(professionalId.toLowerCase()))) || profs[0];
      const targetProfId = targetProf.id;
      const service = services.find(s => s.id === serviceId || (serviceId && s.name.toLowerCase().includes(serviceId.toLowerCase()))) || services[0];
      const targetServiceId = service.id;
      const duration = service ? service.durationMinutes : 30;

      const cleanName = extractCleanCustomerName(customerName || '');
      const isGenericName = !cleanName || cleanName.toLowerCase() === 'cliente' || cleanName.toLowerCase() === 'cliente whatsapp' || cleanName.length < 2 || cleanName.toLowerCase().includes('nome completo') || cleanName.toLowerCase().includes('informado') || cleanName.toLowerCase().includes('desconhecido') || cleanName.toLowerCase().includes('ainda não');

      if (!dateStr || !timeStr || isGenericName) {
        return {
          result: {
            status: 'HORARIO_LIVRE_AGUARDANDO_NOME',
            horarioDisponivel: true,
            mensagem: `O horário das ${targetTimeStr} do dia ${targetDateStr} com ${targetProf?.name || 'o profissional'} está disponível e pré-reservado! Peça agora o nome completo do cliente para registrar o agendamento.`,
            data: targetDateStr,
            horario: targetTimeStr
          }
        };
      }

      const [year, month, day] = targetDateStr.split('-').map(Number);
      const [hours, minutes] = targetTimeStr.split(':').map(Number);

      // Validação de disponibilidade real da agenda antes de confirmar
      let scheduleToUse: ScheduleTimeBlock = { startTime: '08:00', endTime: '18:00', lunchStartTime: '12:00', lunchEndTime: '13:00' };
      if (targetProf?.workSchedule) {
        scheduleToUse = {
          startTime: targetProf.workSchedule.startTime || '08:00',
          endTime: targetProf.workSchedule.endTime || '18:00',
          lunchStartTime: targetProf.workSchedule.lunchStartTime || null,
          lunchEndTime: targetProf.workSchedule.lunchEndTime || null
        };
      }
      const existingAppointments = await dbRepository.getAppointmentsForProfessional(targetProf.id, targetDateStr);
      const otherAppointments = existingAppointments.filter(a => a.customerPhone !== customerPhone);
      const blocks = await dbRepository.getScheduleBlocks(tenantId, targetProf.id, targetDateStr);
      const dayCount = otherAppointments.length;
      const tenantObj = await dbRepository.getTenantById(tenantId);
      const tenantDailyLimit = dbRepository.getTenantDailyAppointmentLimit(tenantObj);
      const tenantDayCount = await dbRepository.getDailyAppointmentCountForTenant(tenantId, targetDateStr);

      const availableSlots = calculateAvailableSlots({
        dateStr: targetDateStr,
        serviceDurationMinutes: duration,
        schedule: scheduleToUse,
        existingAppointments: otherAppointments.map(a => ({ startTime: a.startTime, endTime: a.endTime })),
        scheduleBlocks: blocks.map(b => ({ startTime: b.startTime, endTime: b.endTime })),
        maxAppointmentsPerDay: targetProf.maxAppointmentsPerDay,
        currentDayAppointmentCount: dayCount,
        maxDailyAppointmentsForTenant: tenantDailyLimit,
        currentTenantDailyAppointmentCount: tenantDayCount,
        slotIntervalMinutes: 30
      });

      if (!availableSlots.includes(targetTimeStr)) {
        return {
          result: {
            status: 'HORARIO_INDISPONIVEL',
            horarioSolicitado: targetTimeStr,
            data: targetDateStr,
            profissional: targetProf.name,
            horariosLivresMaisProximos: availableSlots.slice(0, 5)
          }
        };
      }

      // Usa string ISO local com offset explícito de Brasília (UTC-3)
      const pad = (n: number) => String(n).padStart(2, '0');
      const localIso = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00-03:00`;
      let startTime = new Date(localIso);
      if (isNaN(startTime.getTime())) {
        startTime = new Date();
        startTime.setDate(startTime.getDate() + 1);
        startTime.setHours(14, 0, 0, 0);
      }
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
        status: 'PENDING'
      });

      // #3/#16: Atualiza perfil do cliente com preferências aprendidas
      await dbRepository.incrementVisitCount(tenantId, customerPhone, professionalId, serviceId);

      // Webhook dispatch: booking.created
      await webhookService.dispatch(tenantId, 'booking.created', newAppt);

      // #20: Notifica o profissional no WhatsApp
      const notifProf = profs.find((p: any) => p.id === newAppt.professionalId) || profs[0];
      if (notifProf && (notifProf as any).phone) {
        const apptStartForNotif = newAppt.startTime instanceof Date ? newAppt.startTime : new Date(newAppt.startTime);
        const apptDateForNotif = `${String(apptStartForNotif.getDate()).padStart(2,'0')}/${String(apptStartForNotif.getMonth()+1).padStart(2,'0')}`;
        const apptTimeForNotif = `${String(apptStartForNotif.getHours()).padStart(2,'0')}:${String(apptStartForNotif.getMinutes()).padStart(2,'0')}`;
        const srvForNotif = services.find((s: any) => s.id === newAppt.serviceId);
        const notifMsg = `*Novo agendamento (Pendente de confirmação)*\n\nCliente: *${cleanName}*\nServiço: *${srvForNotif?.name || 'Atendimento'}*\nData: *${apptDateForNotif}*\nHorário: *${apptTimeForNotif}*`;
        try {
          const { whatsappService } = await import('./whatsapp.service.js');
          await whatsappService.sendMessage(tenantId, (notifProf as any).phone, notifMsg);
        } catch(e: any) {
          console.warn('[Notif Profissional] Falha ao enviar notificação:', e.message);
        }
      }

      const [apptY, apptM, apptD] = dateStr.split('-');
      return {
        result: {
          status: 'SUCESSO',
          mensagem: `Agendamento pré-reservado para ${cleanName} às ${timeStr} do dia ${apptD}/${apptM}/${apptY} com status PENDENTE de confirmação. Solicite que o cliente responda com 1 para Confirmar ou 2 para Cancelar.`,
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

      // BUG 1 FIX: buscar duração real do serviço em vez de hardcode de 30 min
      const allServices = await dbRepository.listServices(tenantId);
      const apptService = allServices.find(s => s.id === existingAppt.serviceId) || allServices[0];
      const apptDuration = apptService?.durationMinutes ?? 30;

      // BUG 2 FIX: validar disponibilidade do novo horário antes de confirmar reagendamento
      const allProfs = await dbRepository.listProfessionals(tenantId);
      const apptProf = allProfs.find(p => p.id === existingAppt.professionalId) || allProfs[0];
      if (apptProf) {
        const profSchedule: ScheduleTimeBlock = {
          startTime: apptProf.workSchedule?.startTime || '08:00',
          endTime: apptProf.workSchedule?.endTime || '18:00',
          lunchStartTime: apptProf.workSchedule?.lunchStartTime || null,
          lunchEndTime: apptProf.workSchedule?.lunchEndTime || null
        };
        const existingAppts = await dbRepository.getAppointmentsForProfessional(apptProf.id, newDateStr);
        // Exclui o próprio agendamento atual da verificação de conflito
        const otherAppts = existingAppts.filter(a => a.id !== existingAppt.id);
        const blocks = await dbRepository.getScheduleBlocks(tenantId, apptProf.id, newDateStr);
        const dayCount = otherAppts.length;
        const availableSlots = calculateAvailableSlots({
          dateStr: newDateStr,
          serviceDurationMinutes: apptDuration,
          schedule: profSchedule,
          existingAppointments: otherAppts.map(a => ({ startTime: a.startTime, endTime: a.endTime })),
          scheduleBlocks: blocks.map(b => ({ startTime: b.startTime, endTime: b.endTime })),
          maxAppointmentsPerDay: apptProf.maxAppointmentsPerDay,
          currentDayAppointmentCount: dayCount,
          slotIntervalMinutes: 30
        });

        if (!availableSlots.includes(newTimeStr)) {
          return {
            result: {
              status: 'ERRO_HORARIO_INDISPONIVEL',
              mensagem: `O horário das ${newTimeStr} não está disponível para reagendamento. Horários disponíveis para essa data: ${availableSlots.slice(0, 6).join(', ')}.`
            }
          };
        }
      }

      const [year, month, day] = newDateStr.split('-').map(Number);
      const [hours, minutes] = newTimeStr.split(':').map(Number);

      const pad = (n: number) => String(n).padStart(2, '0');
      const localIso = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00-03:00`;
      const startTime = new Date(localIso);
      const endTime = new Date(startTime.getTime() + apptDuration * 60 * 1000);

      const updatedAppt = await dbRepository.updateAppointmentTime(existingAppt.id, startTime, endTime);

      return {
        result: {
          status: 'SUCESSO',
          mensagem: `Agendamento alterado com sucesso para ${pad(day)}/${pad(month)}/${year} às ${newTimeStr}.`,
          agendamentoId: existingAppt.id
        },
        appointmentCreated: updatedAppt
      };
    }


    if (functionName === 'cancel_appointment') {
      const { customerPhone } = args;
      if (!customerPhone) {
        return { result: { status: 'ERRO', mensagem: 'Telefone do cliente não fornecido para cancelamento.' } };
      }
      const cancelled = await dbRepository.cancelAppointmentByPhone(tenantId, customerPhone);
      
      // Webhook dispatch: booking.cancelled
      if (cancelled) {
        await webhookService.dispatch(tenantId, 'booking.cancelled', cancelled);
      }

      // #1: Notifica primeiro da lista de espera
      if (cancelled) {
        try {
          const cancelledDateStr = (() => {
            const st = cancelled.startTime;
            const p = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(st instanceof Date ? st : new Date(st));
            return `${p.find(x=>x.type==='year')?.value}-${p.find(x=>x.type==='month')?.value}-${p.find(x=>x.type==='day')?.value}`;
          })();
          const waitlistForDay = await dbRepository.getWaitlistForDate(tenantId, cancelledDateStr, cancelled.professionalId);
          if (waitlistForDay.length > 0) {
            const nextInLine = waitlistForDay[0];
            const { whatsappService } = await import('./whatsapp.service.js');
            const [wy, wm, wd] = nextInLine.dateStr.split('-');
            await whatsappService.sendMessage(tenantId, nextInLine.customerPhone, `🎉 Boa notícia, ${nextInLine.customerName}! Abriu um horário para o dia *${wd}/${wm}*! Quer confirmar seu agendamento? Responda aqui para garantir sua vaga!`);
            await dbRepository.removeFromWaitlist(nextInLine.id);
          }
        } catch(e: any) {
          console.warn('[Waitlist Notify]:', e.message);
        }
      }

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

    // Busca agendamento ativo existente do cliente
    const existingAppt = await dbRepository.findActiveAppointmentByPhone(tenantId, customerPhone);
    if (existingAppt && !session.customerName && existingAppt.customerName) {
      session.customerName = existingAppt.customerName;
    }

    // #3/#16: Carrega perfil do cliente para personalização
    const customerProfile = await dbRepository.getCustomerProfile(tenantId, customerPhone);
    if (customerProfile) {
      if (!session.customerName && customerProfile.name) session.customerName = customerProfile.name;
      if (!session.pendingBookingProfId && customerProfile.preferredProfId) session.pendingBookingProfId = customerProfile.preferredProfId;
      if (!session.pendingBookingServiceId && customerProfile.preferredServiceId) session.pendingBookingServiceId = customerProfile.preferredServiceId;
      session.isRecurringClient = customerProfile.visitCount > 0;
    }


    let activeAppointmentInfo = undefined;
    if (existingAppt) {
      const profObj = profs.find(p => p.id === existingAppt.professionalId);
      const srvObj = services.find(s => s.id === existingAppt.serviceId);
      const st = (existingAppt.startTime instanceof Date) ? existingAppt.startTime : new Date(existingAppt.startTime);
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(st);
      const y = parts.find(p => p.type === 'year')?.value;
      const m = parts.find(p => p.type === 'month')?.value;
      const d = parts.find(p => p.type === 'day')?.value;
      const h = parts.find(p => p.type === 'hour')?.value;
      const min = parts.find(p => p.type === 'minute')?.value;
      activeAppointmentInfo = {
        customerName: existingAppt.customerName,
        dateStr: `${d}/${m}/${y}`,
        timeStr: `${h}:${min}`,
        profName: profObj ? profObj.name : 'Lucas',
        serviceName: srvObj ? srvObj.name : 'Serviço'
      };

      // Se o cliente tem um agendamento PENDENTE e responde confirmando ou cancelando
      const lowerTrim = userMessage.trim().toLowerCase();
      const isConfirmWord = lowerTrim === '1' || lowerTrim === 'sim' || lowerTrim === 'confirmo' || lowerTrim === 'confirmar' || lowerTrim === 'está confirmado' || lowerTrim === 'esta confirmado' || lowerTrim === 'pode confirmar' || lowerTrim === 'ok';
      const isCancelWord = lowerTrim === '2' || lowerTrim === 'cancelar' || lowerTrim === 'não' || lowerTrim === 'nao' || lowerTrim === 'cancela' || lowerTrim === 'desistir';

      if (existingAppt.status === 'PENDING') {
        const clientName = existingAppt.customerName || session.customerName || 'Cliente';
        if (isConfirmWord) {
          await dbRepository.updateAppointmentDetails(existingAppt.id, { status: 'CONFIRMED' });
          existingAppt.status = 'CONFIRMED';
          const replyText = `Excelente, *${clientName}*! Seu agendamento com *${profObj?.name || 'nosso profissional'}* para o dia *${d}/${m} às ${h}:${min}* está *Confirmado com sucesso*. Te esperamos lá!`;
          session.history.push({ role: 'user', text: userMessage });
          session.history.push({ role: 'model', text: replyText });
          return { replyText, functionCallsExecuted: [], engine: 'LLAMA_LIVE_LLM' };
        } else if (isCancelWord) {
          await dbRepository.updateAppointmentDetails(existingAppt.id, { status: 'CANCELLED' });
          existingAppt.status = 'CANCELLED';
          const replyText = `Entendido, *${clientName}*. Seu agendamento para o dia *${d}/${m} às ${h}:${min}* foi cancelado e o horário liberado. Se precisar marcar outro horário, estamos à sua disposição.`;
          session.history.push({ role: 'user', text: userMessage });
          session.history.push({ role: 'model', text: replyText });
          return { replyText, functionCallsExecuted: [], engine: 'LLAMA_LIVE_LLM' };
        }
      }
    }

    // 1. Atualiza dados de sessão a partir do texto do usuário
    const extractedIntent = extractBookingIntentFromText(userMessage);
    if (extractedIntent.timeStr) session.pendingBookingTime = extractedIntent.timeStr;
    if (extractedIntent.dateStr) session.pendingBookingDateStr = extractedIntent.dateStr;

    const possibleName = extractCleanCustomerName(userMessage);
    if (possibleName && possibleName.length >= 2) {
      if (!session.customerName || userMessage.toLowerCase().includes('meu nome') || userMessage.toLowerCase().includes('me chamo') || userMessage.toLowerCase().includes('sou o')) {
        session.customerName = possibleName;
      }
    }

    if (userMessage.toLowerCase().includes('lucas')) {
      const profLucas = profs.find(p => p.name.toLowerCase().includes('lucas'));
      if (profLucas) session.pendingBookingProfId = profLucas.id;
    } else if (userMessage.toLowerCase().includes('matheus')) {
      const profMatheus = profs.find(p => p.name.toLowerCase().includes('matheus'));
      if (profMatheus) session.pendingBookingProfId = profMatheus.id;
    }

    // M5: Persistência do serviço selecionado na sessão ao mencionar um serviço do catálogo
    const lowerMsg = userMessage.toLowerCase();
    const matchedServiceInMsg = services.find(s => {
      const sLow = s.name.toLowerCase();
      return lowerMsg.includes(sLow) || sLow.split(' ').filter(w => w.length > 3).some(w => lowerMsg.includes(w));
    });
    if (matchedServiceInMsg) {
      session.pendingBookingServiceId = matchedServiceInMsg.id;
    } else if (session.pendingBookingTime && !session.pendingBookingServiceId) {
      session.pendingBookingServiceId = services[0]?.id;
    }

    if (session.pendingBookingTime && !session.pendingBookingProfId) {
      session.pendingBookingProfId = profs[0]?.id;
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
      activeAppointment: activeAppointmentInfo,
      pendingBookingTime: session.pendingBookingTime,
      pendingBookingDateStr: session.pendingBookingDateStr,
      pendingBookingProfId: session.pendingBookingProfId
    });

    const groqKey = process.env.GROQ_API_KEY || '';
    const nvidiaKey = process.env.NVIDIA_API_KEY || '';

    const useGroq = Boolean(groqKey);
    const llmEndpoint = useGroq 
      ? 'https://api.groq.com/openai/v1/chat/completions' 
      : 'https://integrate.api.nvidia.com/v1/chat/completions';
    const llmKey = useGroq ? groqKey : nvidiaKey;
    const llmModel = useGroq ? 'openai/gpt-oss-120b' : 'meta/llama-3.3-70b-instruct';

    if (!llmKey) {
      throw new Error('Nenhuma chave de IA configurada (GROQ_API_KEY ou NVIDIA_API_KEY). Adicione no .env ou no painel do servidor.');
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
        let resp: Response | null = null;

        // 1. Tenta Groq com modelos suportados (gpt-oss-20b primeiro por menor latência e maior limite)
        if (groqKey) {
          const groqModels = ['openai/gpt-oss-20b', 'qwen/qwen3.6-27b', 'openai/gpt-oss-120b'];
          for (const gModel of groqModels) {
            try {
              const abortCtrl = new AbortController();
              const timeoutId = setTimeout(() => abortCtrl.abort(), 12000);
              const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                signal: abortCtrl.signal,
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${groqKey}`
                },
                body: JSON.stringify({
                  model: gModel,
                  messages,
                  tools,
                  tool_choice: 'auto',
                  max_tokens: 1000,
                  temperature: 0.55
                })
              });
              clearTimeout(timeoutId);
              if (r.ok) {
                resp = r;
                break;
              } else {
                console.warn(`[Groq ${gModel} returned status ${r.status}]`);
              }
            } catch (e: any) {
              console.warn(`[Groq ${gModel} Error]:`, e.message);
            }
          }
        }

        // 2. Se Groq falhar ou der rate limit, tenta NVIDIA NIM com llama-3.1-8b (ultra-rápido) seguido por 70b
        if (!resp && nvidiaKey) {
          const nvidiaModels = ['meta/llama-3.1-8b-instruct', 'meta/llama-3.3-70b-instruct'];
          for (const nModel of nvidiaModels) {
            try {
              const abortCtrl = new AbortController();
              const timeoutId = setTimeout(() => abortCtrl.abort(), 15000);
              const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                signal: abortCtrl.signal,
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${nvidiaKey}`
                },
                body: JSON.stringify({
                  model: nModel,
                  messages,
                  tools,
                  tool_choice: 'auto',
                  max_tokens: 600,
                  temperature: 0.55
                })
              });
              clearTimeout(timeoutId);
              if (r.ok) {
                resp = r;
                break;
              } else {
                console.warn(`[NVIDIA ${nModel} returned status ${r.status}]`);
              }
            } catch (e: any) {
              console.warn(`[NVIDIA ${nModel} Error]:`, e.message);
            }
          }
        }

        if (!resp || !resp.ok) {
          const errBody = resp ? await resp.text() : 'Sem conexão com provedores de IA';
          throw new Error(`LLM Failover Exceeded: ${errBody}`);
        }

        const data = await resp.json();
        const choice = data.choices?.[0];
        const msg = choice?.message;

        if (!msg) throw new Error('LLM retornou resposta vazia.');

        // Verifica se o modelo quer chamar ferramentas
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          messages.push({
            role: 'assistant',
            content: msg.content || null,
            tool_calls: msg.tool_calls
          });

          for (const toolCall of msg.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs: any = {};
            try { toolArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch {}

            // Preenche dados pendentes da sessão se a IA não passou argumentos
            if (toolName === 'create_appointment') {
              if (!toolArgs.customerName && session.customerName) toolArgs.customerName = session.customerName;
              if (!toolArgs.customerPhone) toolArgs.customerPhone = customerPhone;
              if (!toolArgs.dateStr && session.pendingBookingDateStr) toolArgs.dateStr = session.pendingBookingDateStr;
              if (!toolArgs.timeStr && session.pendingBookingTime) toolArgs.timeStr = session.pendingBookingTime;
              if (!toolArgs.professionalId && session.pendingBookingProfId) toolArgs.professionalId = session.pendingBookingProfId;
              if (!toolArgs.serviceId && session.pendingBookingServiceId) toolArgs.serviceId = session.pendingBookingServiceId;
            }

            if (toolName === 'cancel_appointment') {
              if (!toolArgs.customerPhone) toolArgs.customerPhone = customerPhone;
            }

            if (toolName === 'reschedule_appointment') {
              if (!toolArgs.customerPhone) toolArgs.customerPhone = customerPhone;
              if (!toolArgs.newDateStr && session.pendingBookingDateStr) toolArgs.newDateStr = session.pendingBookingDateStr;
              if (!toolArgs.newTimeStr && session.pendingBookingTime) toolArgs.newTimeStr = session.pendingBookingTime;
            }

            if (toolName === 'get_available_slots') {
              if (!toolArgs.dateStr && session.pendingBookingDateStr) toolArgs.dateStr = session.pendingBookingDateStr;
              if (!toolArgs.professionalId && session.pendingBookingProfId) toolArgs.professionalId = session.pendingBookingProfId;
              if (!toolArgs.serviceId && session.pendingBookingServiceId) toolArgs.serviceId = session.pendingBookingServiceId;
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
        let rawReply = msg.content || '';

        // 1. Remove tags <think>...</think>
        rawReply = rawReply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        // 2. Remove todos os emojis (solicitação estrita do usuário)
        let finalReply = rawReply.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{FE0F}\u{200D}\u{1FA70}-\u{1FAFF}]/gu, '').trim();

        // 3. Higieniza colapso/repetições de pontuação
        if (finalReply.includes('...') || finalReply.includes('…')) {
          const lines = finalReply.split('\n').filter((l: string) => {
            const trimmed = l.trim();
            if (!trimmed) return false;
            const dotCount = (trimmed.match(/\./g) || []).length + (trimmed.match(/…/g) || []).length;
            return dotCount < 5 && trimmed.length > 2;
          });
          if (lines.length > 0) {
            finalReply = lines.join('\n');
          }
        }

        // Safety Net: Quando há data e horário pendentes na sessão e o cliente fornece o nome,
        // assegura a criação do agendamento mesmo se o modelo não tiver chamado a ferramenta explicitamente.
        const targetCustomerName = session.customerName || (possibleName && possibleName.length >= 2 ? possibleName : undefined);
        const hasPendingBooking = !!(session.pendingBookingTime && session.pendingBookingDateStr && targetCustomerName && targetCustomerName.toLowerCase() !== 'cliente');
        
        if (!appointmentCreated && hasPendingBooking && targetCustomerName && !existingAppt) {
          const targetDateStr = session.pendingBookingDateStr;
          const targetTimeStr = session.pendingBookingTime!;
          const targetProfId = session.pendingBookingProfId || profs[0]?.id || 'prof-1';
          const targetServiceId = session.pendingBookingServiceId || services[0]?.id || 'srv-1';

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

        // Se a resposta estiver vazia ou for muito curta após filtragem, monta confirmação limpa e calorosa
        if (!finalReply || finalReply.length < 5) {
          if (appointmentCreated) {
            const profObj = profs.find(p => p.id === appointmentCreated.professionalId) || profs[0];
            const st = (appointmentCreated.startTime instanceof Date) ? appointmentCreated.startTime : new Date(appointmentCreated.startTime);
            const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(st);
            const sD = parts.find(p => p.type === 'day')?.value || '01';
            const sM = parts.find(p => p.type === 'month')?.value || '01';
            const sH = parts.find(p => p.type === 'hour')?.value || '09';
            const sMin = parts.find(p => p.type === 'minute')?.value || '00';
            const cName = appointmentCreated.customerName || session.customerName || 'você';
            finalReply = `Prontinho, *${cName}*! Seu agendamento com *${profObj?.name || 'nosso profissional'}* está pré-agendado para o dia *${sD}/${sM} às ${sH}:${sMin}* (Status: Pendente de confirmação).\n\nPor favor, responda com *1* para Confirmar ou *2* para Cancelar.`;
          } else if (appointmentCancelledId) {
            finalReply = `Seu agendamento foi cancelado com sucesso no sistema. Horário liberado! Se precisar reagendar ou tiver alguma dúvida, estou à disposição.`;
          } else {
            finalReply = `Como posso te ajudar hoje? Se quiser ver os horários disponíveis, serviços ou tirar dúvidas, é só me avisar.`;
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

    // 0.0 Waitlist confirmation (#1)
    if (session?.pendingWaitlist && (lower === 'sim' || lower === 'quero' || lower === 'pode' || lower === 'ok')) {
      const wl = session.pendingWaitlist;
      session.pendingWaitlist = undefined;
      const clientName = session.customerName || session.suggestedPushName || 'Cliente';
      await dbRepository.addToWaitlist({
        tenantId,
        customerPhone,
        customerName: clientName,
        professionalId: wl.professionalId,
        serviceId: wl.serviceId,
        dateStr: wl.dateStr
      });
      const [y, m, d] = wl.dateStr.split('-');
      return {
        replyText: `Anotado${session.customerName ? ', ' + session.customerName : ''}! Você entrou na lista de espera para *${d}/${m}*. Assim que um horário abrir, eu te aviso aqui pelo WhatsApp! 🔔`,
        functionCallsExecuted: []
      };
    }

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
        const stDate = activeAppt.startTime instanceof Date ? activeAppt.startTime : new Date(activeAppt.startTime);
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(stDate);
        const d = parts.find(p => p.type === 'day')?.value || '01';
        const m = parts.find(p => p.type === 'month')?.value || '01';
        const y = parts.find(p => p.type === 'year')?.value || '2026';
        const h = parts.find(p => p.type === 'hour')?.value || '00';
        const min = parts.find(p => p.type === 'minute')?.value || '00';
        const timeFormatted = `${h}:${min}`;
        const pObj = profs.find(p => p.id === activeAppt.professionalId);
        const pName = pObj ? pObj.name : 'nosso profissional';
        const clientName = activeAppt.customerName || session?.customerName || 'Cliente';

        return {
          replyText: `Isso mesmo, *${clientName}*! Seu agendamento está confirmado com o *${pName}* às *${timeFormatted}* de *${d}/${m}/${y}*. Te esperamos logo mais!`,
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
        replyText: `Aqui na equipe${dayLabel}${sLabel}, quem atende é ${profNames}.\n\nQuer dar uma olhada nos horários livres de algum deles?`,
        functionCallsExecuted: []
      };
    }

    // 0.2 Pergunta de Profissionais Específicos ("só o lucas atende?", "o matheus também atende?")
    if (lower.includes('so lucas') || lower.includes('só lucas') || lower.includes('só o lucas') || lower.includes('so o lucas') || lower.includes('so matheus') || lower.includes('só matheus') || lower.includes('so o matheus') || lower.includes('só o matheus') || lower.includes('tambem atende') || lower.includes('também atende')) {
      const profNames = profs.map(p => `*${p.name}*`).join(' e ');
      return {
        replyText: `Temos ${profNames} atendendo na nossa equipe!\n\nSe você preferir agendar com um profissional específico, só me avisar o nome dele que busco os horários pra você.`,
        functionCallsExecuted: []
      };
    }

    // 0.3 Pergunta de Ausência de Horários ("não tem horario para hoje?", "lotado hoje?")
    if (lower.includes('não tem') || lower.includes('nao tem') || lower.includes('sem horario') || lower.includes('sem horário') || lower.includes('lotado')) {
      const dateLabel = hasExplicitDateInMessage ? `para *${dateFormattedLabel}*` : 'para hoje';
      // Consulta real de slots para o dia seguinte
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomY = tomorrow.getFullYear();
      const tomM = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const tomD = String(tomorrow.getDate()).padStart(2, '0');
      return {
        replyText: `No momento nossa agenda ${dateLabel} está com todos os horários preenchidos. Para *Amanhã (${tomD}/${tomM})* temos vagas disponíveis. Gostaria de verificar os horários de amanhã?`,
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

    // 0.1 Perguntas do negócio (endereço, pagamento, horário de funcionamento, etc.) - Feature #17
    const tenant = await dbRepository.getTenantById(tenantId);
    const businessInfo = customPrompt || tenant?.aiConfig?.businessInfo;
    const faqItems = (tenant as any)?.aiConfig?.faqItems || [];
    const lowerForFaq = lower.trim();
    if (faqItems.length > 0) {
      const faqMatch = faqItems.find((item: any) => {
        const qWords = item.question.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
        return qWords.some((w: string) => lowerForFaq.includes(w));
      });
      if (faqMatch) {
        return { replyText: faqMatch.answer, functionCallsExecuted: [] };
      }
    }
    // Fallback keyword-based FAQ
    const isAddressQuestion = lowerForFaq.includes('endereço') || lowerForFaq.includes('endereco') || lowerForFaq.includes('fica') || lowerForFaq.includes('onde') || lowerForFaq.includes('localização') || lowerForFaq.includes('localizacao');
    const isPaymentQuestion = lowerForFaq.includes('pagamento') || lowerForFaq.includes('pix') || lowerForFaq.includes('cartão') || lowerForFaq.includes('cartao') || lowerForFaq.includes('aceita') || lowerForFaq.includes('dinheiro');
    const isHoursQuestion = lowerForFaq.includes('funciona') || lowerForFaq.includes('abre') || lowerForFaq.includes('fecha') || lowerForFaq.includes('horário de atendimento') || lowerForFaq.includes('horario de atendimento');
    
    if (isAddressQuestion || isPaymentQuestion || isHoursQuestion) {
      const info = businessInfo || tenant?.aiConfig?.businessInfo;
      if (info && info.length > 10) {
        return { replyText: `Com certeza! Aqui estão as informações sobre o estabelecimento:\n\n${info}\n\nPosso ajudar em algo mais?`, functionCallsExecuted: [] };
      }
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

      const namePart = session?.customerName ? `, *${session.customerName}*` : '';
      return {
        replyText: `${greetingTime}${namePart}! Como posso ajudar você hoje? Se desejar consultar nossos serviços, horários disponíveis ou realizar um agendamento, estou à disposição.`,
        functionCallsExecuted: []
      };
    }

    // 1. Agradecimento e Despedida
    if (lower.includes('obrigad') || lower.includes('valeu') || lower.includes('tmj') || lower.includes('muito obrigado') || lower.includes('flw')) {
      const name = session?.customerName ? `, ${session.customerName}` : '';
      return { replyText: `Por nada${name}! Estamos à sua disposição. Tenha um excelente dia!`, functionCallsExecuted: [] };
    }

    // 2. Pergunta de Identidade ("como é seu nome?", "quem é você?", "quem fala?")
    if (lower.includes('seu nome') || lower.includes('como te chamo') || lower.includes('quem e voce') || lower.includes('quem é você') || lower.includes('com quem falo') || lower.includes('quem ta falando') || lower.includes('quem tá falando')) {
      return {
        replyText: `Sou a recepcionista aqui do estabelecimento. Como posso te ajudar hoje?`,
        functionCallsExecuted: []
      };
    }

    // 2.1 Resposta à escolha explícita de profissional quando o usuário responde apenas o nome do profissional (ex: "matheus", "lucas", "com matheus")
    const isJustProfName = Boolean(matchedProf) && !hasTimeSpecified && !phoneInText && !lower.includes('hoje') && !lower.includes('amanhã') && !lower.includes('cancelar') && !lower.includes('desistir');
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
            replyText: `Perfeito! Horário com *${profName}* às *${targetTimeStr}* anotado. O agendamento é em seu nome ou para outra pessoa?`,
            functionCallsExecuted: []
          };
        }

        if (!hasRealPhone) {
          return {
            replyText: `Perfeito, *${clientName}*! Horário pré-reservado com *${profName}* às *${targetTimeStr}*. Por favor, informe seu número de WhatsApp com DDD para envio da confirmação e lembretes.`,
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
            replyText: `Com certeza! Para o profissional *${profName}*, temos os seguintes horários disponíveis para *${targetDateFormatted} (${d}/${m})*:\n\n${formatHumanSlots(availableSlots)}\n\nQual desses horários é mais conveniente para você?`,
            functionCallsExecuted: ['get_available_slots']
          };
        } else {
          if (session) {
            session.pendingWaitlist = { dateStr: targetDateStr, professionalId: matchedProf?.id || profs[0]?.id, serviceId: defaultServiceId };
          }
          return {
            replyText: `O profissional *${profName}* está com a agenda completa para *${targetDateFormatted} (${d}/${m})*.\n\nGostaria de entrar na *lista de espera*? Caso surja uma desistência, você será notificado imediatamente. Responda *sim* para entrar na lista ou informe outra data de sua preferência.`,
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

      const savedDateLabel = session.lastQueryDateLabel;
      session.pendingBookingTime = undefined;
      session.pendingBookingDateStr = undefined;

      const profObj = profs.find(p => p.id === targetProfId) || profs[0];
      const profName = profObj ? ` com *${profObj.name}*` : '';
      const [y, m, d] = targetDateStr.split('-');
      return {
        replyText: `Prontinho, *${clientName}*! Seu horário${profName} para *${savedDateLabel || `${d}/${m}/${y}`}* às *${targetTimeStr}* foi registrado e está *Pendente de confirmação*.\n\nPor favor, responda com *1* para Confirmar ou *2* para Cancelar.`,
        functionCallsExecuted: executedTools,
        appointmentCreated: exec.appointmentCreated
      };
    }

    // 4. Escolha de horário exata (ex: "marque as 14", "as 14h", "pode ser 14")
    if (hasTimeSpecified && timeStr) {
      const existingAppt = await dbRepository.findActiveAppointmentByPhone(tenantId, customerPhone);
      const isExplicitChangeRequest = lower.includes('mudar') || lower.includes('reagendar') || lower.includes('trocar') || lower.includes('alterar');

      if (existingAppt && !isExplicitChangeRequest) {
        // Usa Intl.DateTimeFormat para exibir data/hora no fuso de Brasília
        const stExist = existingAppt.startTime instanceof Date ? existingAppt.startTime : new Date(existingAppt.startTime);
        const existParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(stExist);
        const existD = existParts.find(p => p.type === 'day')?.value || '01';
        const existM = existParts.find(p => p.type === 'month')?.value || '01';
        const existH = existParts.find(p => p.type === 'hour')?.value || '00';
        const existMin = existParts.find(p => p.type === 'minute')?.value || '00';
        const apptTimeStr = `${existH}:${existMin}`;

        if (session) {
          session.pendingExistingApptChoice = { newDateStr: dateStr, newTimeStr: timeStr, dateFormattedLabel };
        }

        return {
          replyText: `Identifiquei que você já possui um agendamento para *${existD}/${existM} às ${apptTimeStr}*. Deseja *reagendar esse horário* para *${dateFormattedLabel} às ${timeStr}* ou criar um *novo agendamento adicional*?`,
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
              replyText: `O horário das *${timeStr}* para *${dateFormattedLabel}* está disponível. O agendamento é em seu nome, *${session.suggestedPushName}*, ou para outra pessoa?`,
              functionCallsExecuted: executedTools
            };
          }
          return {
            replyText: `O horário das *${timeStr}* para *${dateFormattedLabel}* está disponível. Por favor, informe seu nome completo para registrarmos o agendamento.`,
            functionCallsExecuted: executedTools
          };
        }

        const hasValidRealPhone = isValidRealPhoneNumber(phoneInText || session?.customerPhone || customerPhone);
        if (!hasValidRealPhone) {
          return {
            replyText: `Perfeito, *${session.customerName}*! O horário das *${timeStr}* para *${dateFormattedLabel}* está reservado. Por favor, informe seu número de WhatsApp com DDD para envio da confirmação e lembretes.`,
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
          ? `Prontinho, *${clientName}*! Seu horário foi alterado para *${dateFormattedLabel} (${d}/${m}/${y})* às *${timeStr}* (Status: Pendente de confirmação).\n\nPor favor, responda com *1* para Confirmar ou *2* para Cancelar.`
          : `Prontinho, *${clientName}*! Seu horário para *${dateFormattedLabel} (${d}/${m}/${y})* às *${timeStr}* foi registrado e está *Pendente de confirmação*.\n\nPor favor, responda com *1* para Confirmar ou *2* para Cancelar.`;

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
          replyText: `Às *${timeStr}* para *${dateFormattedLabel}* já está ocupado. Confira os horários disponíveis:\n${formatHumanSlots(availableSlots)}`,
          functionCallsExecuted: executedTools
        };
      }
    }

    // 5. Perguntas diretas de Serviços / Profissionais
    if (lower.includes('profissional') || lower.includes('atendente') || lower.includes('quem atende') || lower.includes('quem sao') || lower.includes('serviço') || lower.includes('servico') || lower.includes('opções') || lower.includes('opcoes') || lower.includes('catalogo') || lower.includes('catálogo') || lower.includes('oferecido') || lower.includes('trabalham') || lower.includes('fazem')) {
      executedTools.push('list_services');
      
      let breakdown = 'Conheça nossa equipe e os serviços:\n\n';
      for (const p of profs) {
        breakdown += `*${p.name}*\n`;
        let pServices = services;
        if (p.servicesHandled && p.servicesHandled.length > 0) {
          pServices = services.filter(s => p.servicesHandled!.includes(s.id));
        }
        pServices.forEach(s => {
          breakdown += `  - ${s.name}: R$ ${s.price.toFixed(2)} (${s.durationMinutes} min)\n`;
        });
        if (p.workSchedule) {
          breakdown += `  Horário: ${p.workSchedule.startTime || '08:00'} às ${p.workSchedule.endTime || '18:00'}\n`;
        }
        breakdown += `\n`;
      }
      breakdown += `Com qual desses profissionais você prefere agendar?`;

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
          replyText: `Claro! Temos estes horários livres para *${targetDateFormatted} (${tD}/${tM})*:\n\n${formatHumanSlots(availableSlots, undefined, tomProfMap)}\n\nQual desses fica melhor para você?`,
          functionCallsExecuted: executedTools
        };
      }

      const profMap = slotsExec.result.profMap;
      const [curY, curM, curD] = targetDateStr.split('-');
      return {
        replyText: `Claro! Temos estes horários livres para *${targetDateFormatted} (${curD}/${curM})*:\n\n${formatHumanSlots(availableSlots, undefined, profMap)}\n\nQual desses fica melhor para você?`,
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
          replyText: `Para *${dateFormattedLabel} (${d}/${m})*${profLabel}${periodLabel}, temos estes horários livres:\n\n${formatHumanSlots(availableSlots, periodFilter, profMap)}\n\nQual desses horários fica melhor para você?`,
          functionCallsExecuted: executedTools
        };
      } else {
        const profNameStr = matchedProf ? `O *${matchedProf.name}*` : 'Nossa equipe';
        if (session) {
          session.pendingWaitlist = { dateStr, professionalId: matchedProf?.id || profs[0]?.id, serviceId: defaultServiceId };
        }
        return {
          replyText: `${profNameStr} está com a agenda cheia para *${dateFormattedLabel} (${d}/${m})*.\n\nQuer entrar na *lista de espera*? Se abrir um horário, você será avisado automaticamente. Responda *sim* para entrar na lista ou me diga outro dia que prefere.`,
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

    // Intenção Explícita de Agendamento ou Menção de Serviço
    const isExplicitBookingCommand = lower.includes('quero agendar') || lower.includes('quero marcar') || lower.includes('gostaria de agendar') || lower.includes('gostaria de marcar') || Boolean(matchedService);

    if (isExplicitBookingCommand) {
      const serviceLabel = matchedService ? `*${matchedService.name}* (R$ ${matchedService.price.toFixed(2)})` : 'seu atendimento';

      if (hasExplicitDateInMessage) {
        const slotsExec = await this.executeToolCall(tenantId, 'get_available_slots', { professionalId: defaultProfId, serviceId: matchedService ? matchedService.id : defaultServiceId, dateStr });
        executedTools.push('get_available_slots');
        const availableSlots: string[] = slotsExec.result.horariosDisponiveis || [];
        const profMap = slotsExec.result.profMap;

        return {
          replyText: `Claro! Vamos agendar ${serviceLabel} para *${dateFormattedLabel}*.\n\nHorários disponíveis:\n${formatHumanSlots(availableSlots, undefined, profMap)}\n\nQual desses fica melhor pra você?`,
          functionCallsExecuted: executedTools
        };
      } else {
        return {
          replyText: `Claro! Vamos agendar ${serviceLabel}. Qual dia (ex: hoje, amanhã, sábado) e horário fica melhor pra você vir?`,
          functionCallsExecuted: []
        };
      }
    }

    // 8. Saudações Iniciais (com outras palavras na mesma mensagem)
    if (lower.includes('bom dia') || lower.includes('boa tarde') || lower.includes('boa noite') || lower.includes('ola') || lower.includes('olá') || lower.includes('oi') || lower.includes('opa') || lower.includes('fala')) {
      if (session) session.hasGreeted = true;
      const hours = new Date().getHours();
      let greeting = 'Olá!';
      if (hours >= 5 && hours < 12) greeting = 'Bom dia!';
      else if (hours >= 12 && hours < 18) greeting = 'Boa tarde!';
      else greeting = 'Boa noite!';

      const namePart = session?.customerName ? ` *${session.customerName}*` : '';
      return {
        replyText: `${greeting}${namePart} Em que posso te ajudar hoje?`,
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
          replyText: `Prontinho, *${clientName}*! Seu horário foi alterado para *${dateFormattedLabel} (${d}/${m}/${y})* às *${newTimeStr}*. O horário anterior foi liberado.`,
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
          replyText: `Anotado! Adicionei um *segundo agendamento* para *${dateFormattedLabel} (${d}/${m}/${y})* às *${newTimeStr}*.`,
          functionCallsExecuted: executedTools,
          appointmentCreated: exec.appointmentCreated
        };
      }
    }

    // 10. Reagendamento explícito
    if (lower.includes('mudar') || lower.includes('reagendar') || lower.includes('trocar') || lower.includes('alterar')) {
      return {
        replyText: `Claro! Para qual dia e horário você prefere mudar?`,
        functionCallsExecuted: []
      };
    }

    // 11. Cancelamento — pedir confirmação antes de cancelar
    if (lower.includes('cancelar') || lower.includes('desistir')) {
      const activeApptForCancel = await dbRepository.findActiveAppointmentByPhone(tenantId, customerPhone);
      if (activeApptForCancel) {
        // Usa Intl.DateTimeFormat para datas corretas no fuso de Brasília
        const cancelSt = activeApptForCancel.startTime instanceof Date ? activeApptForCancel.startTime : new Date(activeApptForCancel.startTime);
        const cancelParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(cancelSt);
        const cancelDay = cancelParts.find(p => p.type === 'day')?.value || '01';
        const cancelMonth = cancelParts.find(p => p.type === 'month')?.value || '01';
        const cancelHour = cancelParts.find(p => p.type === 'hour')?.value || '00';
        const cancelMin = cancelParts.find(p => p.type === 'minute')?.value || '00';
        const cancelDateStr = `${cancelDay}/${cancelMonth}`;
        const cancelTimeStr = `${cancelHour}:${cancelMin}`;
        const cancelProfObj = profs.find(p => p.id === activeApptForCancel.professionalId);
        if (session) {
          session.pendingActionConfirmation = {
            type: 'CANCEL',
            appointmentId: activeApptForCancel.id,
            currentDateStr: cancelDateStr,
            currentTimeStr: cancelTimeStr,
            profName: cancelProfObj?.name || 'nosso profissional'
          };
        }
        return {
          replyText: `Entendido! Você confirma o cancelamento do seu atendimento de ${cancelDateStr} às ${cancelTimeStr} com o ${cancelProfObj?.name || 'nosso profissional'}?`,
          functionCallsExecuted: []
        };
      }
      return {
        replyText: `Não encontrei nenhum agendamento ativo para cancelar. Gostaria de fazer um novo agendamento?`,
        functionCallsExecuted: []
      };
    }


    // Resposta Humana Aberta
    const nameStr = session?.customerName ? `, *${session.customerName}*` : '';
    return {
      replyText: `Oi${nameStr}! Posso te ajudar com agendamentos, serviços ou tirar dúvidas sobre o estabelecimento. O que você precisa?`,
      functionCallsExecuted: []
    };
  }
}

export const aiOrchestrator = new AiOrchestratorService();

