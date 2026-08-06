import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { aiOrchestrator } from './ai-orchestrator.service.js';
import { dbRepository } from './db.service.js';

export interface WhatsAppSessionState {
  tenantId: string;
  status: 'DISCONNECTED' | 'INITIALIZING' | 'QR_READY' | 'CONNECTED';
  qrCodeBase64?: string;
  connectedPhone?: string;
  sock?: any;
}

const activeSessions = new Map<string, WhatsAppSessionState>();

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

    const authFolder = path.join(process.cwd(), 'data', 'baileys_auth_' + tenantId);

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
        fs.rmSync(authFolder, { recursive: true, force: true });
      }
      fs.mkdirSync(authFolder, { recursive: true });
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
            console.log(`[WhatsApp Real Baileys] QR Code gerado para tenant: ${tenantId}`);
          } catch (err: any) {
            console.error('[WhatsApp Real Baileys] Erro ao converter QR Code:', err.message);
          }
        }

        if (connection === 'open') {
          session.status = 'CONNECTED';
          session.qrCodeBase64 = undefined;
          const userJid = sock.user?.id || '';
          session.connectedPhone = userJid.split(':')[0] || userJid.split('@')[0];
          console.log(`[WhatsApp Real Baileys] ✅ WhatsApp Conectado com sucesso para tenant ${tenantId}! Número: ${session.connectedPhone}`);
        }

        if (connection === 'close') {
          const reason = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = reason !== DisconnectReason.loggedOut;
          console.log(`[WhatsApp Real Baileys] Conexão fechada. Motivo: ${reason}. Reconectando? ${shouldReconnect}`);

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

          const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
          if (!text) continue;

          const customerPhone = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
          const pushName = msg.pushName || undefined;
          console.log(`[WhatsApp Real Input] Mensagem recebida de ${customerPhone} (${pushName || 'Cliente'}) (tenant ${tenantId}): "${text}"`);

          try {
            const aiResult = await aiOrchestrator.processIncomingMessage(tenantId, customerPhone, text, { pushName });

            if (aiResult.replyText) {
              await sock.sendMessage(remoteJid, { text: aiResult.replyText });
              console.log(`[WhatsApp Real Output] Resposta enviada para ${customerPhone}: "${aiResult.replyText}"`);
            }
          } catch (err: any) {
            console.error('[WhatsApp Real AI Error]', err.message);
          }
        }
      });

      return this.getSessionState(tenantId);
    } catch (err: any) {
      console.error('[WhatsApp Real Baileys Init Error]', err.message);
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
        console.warn('Erro ao fazer logout do socket:', err.message);
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
      console.warn(`[WhatsApp Service] Tentativa de disparo para tenant ${tenantId} falhou: WhatsApp desconectado.`);
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
        console.warn('[WhatsApp Service] Aviso na checagem do número:', checkErr.message);
      }

      await session.sock.sendMessage(targetJid, { text });
      console.log(`[WhatsApp Service] Mensagem ativa enviada com sucesso para ${targetJid} (${tenantId})`);
      return true;
    } catch (err: any) {
      console.error(`[WhatsApp Service] Erro ao enviar mensagem para ${toPhone}:`, err.message);
      return false;
    }
  }

  async autoReconnectSavedSessions() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) return;

    const files = fs.readdirSync(dataDir);
    for (const file of files) {
      if (file.startsWith('baileys_auth_')) {
        const tenantId = file.replace('baileys_auth_', '');
        const authFolder = path.join(dataDir, file);
        const credsFile = path.join(authFolder, 'creds.json');
        if (fs.existsSync(credsFile)) {
          console.log(`[WhatsApp AutoReconnect] Restaurando sessão salva para tenant: ${tenantId}...`);
          try {
            await this.startSession(tenantId, false);
          } catch (e: any) {
            console.warn(`[WhatsApp AutoReconnect] Erro ao reconectar tenant ${tenantId}:`, e.message);
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
