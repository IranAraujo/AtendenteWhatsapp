import logger from '../utils/logger.js';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { aiOrchestrator, transcribeAudioBuffer } from './ai-orchestrator.service.js';
import { dbRepository } from './db.service.js';

export interface WhatsAppSessionState {
  tenantId: string;
  status: 'DISCONNECTED' | 'INITIALIZING' | 'QR_READY' | 'CONNECTED';
  qrCodeBase64?: string;
  connectedPhone?: string;
  sock?: any;
}

export const activeSessions = new Map<string, WhatsAppSessionState>();

function getAuthBaseDir(): string {
  const isVercel = !!process.env.VERCEL || process.env.NODE_ENV === 'production';
  const baseDir = isVercel ? '/tmp' : process.cwd();
  const dataDir = path.join(baseDir, 'data');
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (e) {}
  }
  return dataDir;
}

export class WhatsAppService {
  getSessionState(tenantId: string): Omit<WhatsAppSessionState, 'sock'> {
    if (!activeSessions.has(tenantId)) {
      activeSessions.set(tenantId, {
        tenantId,
        status: 'DISCONNECTED'
      });
    }
    const s = activeSessions.get(tenantId)!;
    return {
      tenantId: s.tenantId,
      status: s.status,
      qrCodeBase64: s.qrCodeBase64,
      connectedPhone: s.connectedPhone
    };
  }

  async startSession(tenantId: string, forceClean = false): Promise<Omit<WhatsAppSessionState, 'sock'>> {
    const session = activeSessions.get(tenantId) || { tenantId, status: 'DISCONNECTED' as const };
    activeSessions.set(tenantId, session);

    if (session.status === 'CONNECTED' && session.sock && !forceClean) {
      return this.getSessionState(tenantId);
    }

    const dataDir = getAuthBaseDir();
    const authFolder = path.join(dataDir, 'baileys_auth_' + tenantId);

    // Se estiver solicitando novo QR Code ou se o estado não for CONECTADO, limpa sessão obsoleta para evitar travamento em 401/reconexão
    if (forceClean || session.status === 'DISCONNECTED' || !session.sock) {
      if (session.sock) {
        try {
          session.sock.ev.removeAllListeners();
          session.sock.end(undefined);
        } catch (e) {}
        session.sock = undefined;
      }
      if (fs.existsSync(authFolder)) {
        try {
          fs.rmSync(authFolder, { recursive: true, force: true });
        } catch (e) {}
      }
      try {
        fs.mkdirSync(authFolder, { recursive: true });
      } catch (e) {}
    }

    session.status = 'INITIALIZING';
    session.qrCodeBase64 = undefined;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(authFolder);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        syncFullHistory: false,
        browser: ['SaaS Atendente IA', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000
      });

      session.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr);
            session.qrCodeBase64 = qrDataUrl;
            session.status = 'QR_READY';
            logger.info(`[WhatsApp Real Baileys] QR Code gerado para tenant: ${tenantId}`);
          } catch (err: any) {
            logger.error('[WhatsApp Real Baileys] Erro ao converter QR Code:', err.message);
          }
        }

        if (connection === 'open') {
          session.status = 'CONNECTED';
          session.qrCodeBase64 = undefined;
          const userJid = sock.user?.id || '';
          session.connectedPhone = userJid.split(':')[0] || userJid.split('@')[0];
          logger.info(`[WhatsApp Real Baileys]  WhatsApp Conectado com sucesso para tenant ${tenantId}! Número: ${session.connectedPhone}`);
        }

        if (connection === 'close') {
          const reason = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = reason !== DisconnectReason.loggedOut;
          logger.info(`[WhatsApp Real Baileys] Conexão fechada. Motivo: ${reason}. Reconectando? ${shouldReconnect}`);

          if (shouldReconnect) {
            this.startSession(tenantId);
          } else {
            session.status = 'DISCONNECTED';
            session.sock = undefined;
            session.qrCodeBase64 = undefined;
            session.connectedPhone = undefined;
          }
        }
      });

      // Ouvinte de mensagens recebidas no WhatsApp Real
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;

          const remoteJid = msg.key.remoteJid;
          if (!remoteJid || remoteJid.endsWith('@g.us')) continue;

          let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
          const isAudioInput = Boolean(msg.message.audioMessage);

          // Suporte NATIVO para Áudio de Voz do WhatsApp (Multimodal Gemini / Whisper AI)
          if (!text && isAudioInput) {
            const customerPhone = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
            const pushName = msg.pushName || 'Cliente';
            logger.info(`[WhatsApp Real Audio] 🎙️ Áudio de voz recebido de ${pushName} (${customerPhone}). Baixando e transcrevendo via Whisper AI...`);

            try {
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              const mimeType = msg.message.audioMessage?.mimetype || 'audio/ogg; codecs=opus';
              text = await transcribeAudioBuffer(buffer as Buffer, mimeType);
              logger.info(`[WhatsApp Real Audio Transcribed] 📝 Transcrição do áudio: "${text}"`);
            } catch (audioErr: any) {
              logger.error('[WhatsApp Real Audio Error] Falha ao processar áudio:', audioErr.message);
              await sock.sendMessage(remoteJid, { 
                text: `Desculpe, não consegui compreender o áudio perfeitamente! 🎙️ Poderia enviar por texto ou mandar outro áudio para que eu possa te ajudar? 😊` 
              });
              continue;
            }
          }

          if (!text) continue;

          const customerPhone = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
          const pushName = msg.pushName || undefined;
          logger.info(`[WhatsApp Real Input] Mensagem recebida de ${customerPhone} (${pushName || 'Cliente'}) (tenant ${tenantId}): "${text}"`);

          try {
            const tenant = await dbRepository.getTenantById(tenantId);
            const voiceMode = tenant?.aiConfig?.voiceReplyMode || 'WHEN_AUDIO_RECEIVED';
            const voiceId = tenant?.aiConfig?.voiceId || 'pt-BR-FranciscaNeural';
            const shouldReplyWithVoice = voiceMode === 'ALWAYS' || (voiceMode === 'WHEN_AUDIO_RECEIVED' && isAudioInput);

            // Importa a fila e enfileira a tarefa (NÃO-BLOQUEANTE)
            const { aiQueue } = await import('../jobs/ai-processor.job.js');
            aiQueue.push({
              tenantId,
              customerPhone,
              remoteJid,
              text,
              pushName,
              shouldReplyWithVoice,
              voiceId
            });
            logger.info(`[Queue] Mensagem de ${customerPhone} enviada para a fila de IA (Tamanho: ${aiQueue.length()})`);

          } catch (err: any) {
            logger.error(`[WhatsApp Error] Falha ao enfileirar mensagem de ${customerPhone}:`, err);
          }
        }
      });

      // Aguarda até 8 segundos pela geração do QR Code se o estado estiver em INITIALIZING
      let attempts = 0;
      while ((session.status === 'INITIALIZING' && !session.qrCodeBase64) && attempts < 16) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
      }

      return this.getSessionState(tenantId);
    } catch (err: any) {
      logger.error('[WhatsApp Real Baileys Init Error]', err.message);
      session.status = 'DISCONNECTED';
      return this.getSessionState(tenantId);
    }
  }

  async logoutSession(tenantId: string): Promise<boolean> {
    const session = activeSessions.get(tenantId);
    if (session && session.sock) {
      try {
        await session.sock.logout();
      } catch (err: any) {
        logger.warn('Erro ao fazer logout do socket:', err.message);
      }
      session.status = 'DISCONNECTED';
      session.sock = undefined;
      session.qrCodeBase64 = undefined;
      session.connectedPhone = undefined;

      const authFolder = path.join(process.cwd(), 'data', 'baileys_auth_' + tenantId);
      if (fs.existsSync(authFolder)) {
        fs.rmSync(authFolder, { recursive: true, force: true });
      }

      return true;
    }
    return false;
  }

  async sendMessage(tenantId: string, toPhone: string, text: string): Promise<boolean> {
    const session = activeSessions.get(tenantId);
    if (!session || session.status !== 'CONNECTED' || !session.sock) {
      logger.warn(`[WhatsApp Service] Tentativa de disparo para tenant ${tenantId} falhou: WhatsApp desconectado.`);
      return false;
    }

    try {
      let cleanPhone = toPhone.replace(/\D/g, '');
      if (!cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
        cleanPhone = `55${cleanPhone}`;
      }

      let targetJid = cleanPhone.includes('@s.whatsapp.net') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;

      // Resolução inteligente do 9º dígito no WhatsApp para garantir entrega no Brasil
      try {
        const [onWa] = await session.sock.onWhatsApp(cleanPhone);
        if (onWa && onWa.exists && onWa.jid) {
          targetJid = onWa.jid;
        } else if (cleanPhone.length === 13 && cleanPhone.startsWith('55')) {
          const altPhone = cleanPhone.slice(0, 4) + cleanPhone.slice(5);
          const [onWaAlt] = await session.sock.onWhatsApp(altPhone);
          if (onWaAlt && onWaAlt.exists && onWaAlt.jid) {
            targetJid = onWaAlt.jid;
          }
        } else if (cleanPhone.length === 12 && cleanPhone.startsWith('55')) {
          const altPhone = cleanPhone.slice(0, 4) + '9' + cleanPhone.slice(4);
          const [onWaAlt] = await session.sock.onWhatsApp(altPhone);
          if (onWaAlt && onWaAlt.exists && onWaAlt.jid) {
            targetJid = onWaAlt.jid;
          }
        }
      } catch (checkErr: any) {
        logger.warn('[WhatsApp Service] Aviso na checagem do número:', checkErr.message);
      }

      await session.sock.sendMessage(targetJid, { text });
      logger.info(`[WhatsApp Service] Mensagem ativa enviada com sucesso para ${targetJid} (${tenantId})`);
      return true;
    } catch (err: any) {
      logger.error(`[WhatsApp Service] Erro ao enviar mensagem para ${toPhone}:`, err.message);
      return false;
    }
  }

  async autoReconnectSavedSessions() {
    const dataDir = getAuthBaseDir();
    if (!fs.existsSync(dataDir)) return;

    const files = fs.readdirSync(dataDir);
    for (const file of files) {
      if (file.startsWith('baileys_auth_')) {
        const tenantId = file.replace('baileys_auth_', '');
        const authFolder = path.join(dataDir, file);
        const credsFile = path.join(authFolder, 'creds.json');
        if (fs.existsSync(credsFile)) {
          logger.info(`[WhatsApp AutoReconnect] Restaurando sessão salva para tenant: ${tenantId}...`);
          try {
            await this.startSession(tenantId, false);
          } catch (e: any) {
            logger.warn(`[WhatsApp AutoReconnect] Erro ao reconectar tenant ${tenantId}:`, e.message);
          }
        }
      }
    }
  }

  async handleWebhook(body: any) {
    return { status: 'DEPRECATED_USE_BAILEYS' };
  }
}

export const whatsappService = new WhatsAppService();
export function getSock(tenantId: string) { return activeSessions.get(tenantId)?.sock; }
