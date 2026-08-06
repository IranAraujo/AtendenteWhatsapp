import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { aiOrchestrator, transcribeAudioBuffer } from './ai-orchestrator.service.js';
const activeSessions = new Map();
export class WhatsAppService {
    getSessionState(tenantId) {
        if (!activeSessions.has(tenantId)) {
            activeSessions.set(tenantId, {
                tenantId,
                status: 'DISCONNECTED'
            });
        }
        const s = activeSessions.get(tenantId);
        return {
            tenantId: s.tenantId,
            status: s.status,
            qrCodeBase64: s.qrCodeBase64,
            connectedPhone: s.connectedPhone
        };
    }
    async startSession(tenantId, forceClean = false) {
        const session = activeSessions.get(tenantId) || { tenantId, status: 'DISCONNECTED' };
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
                }
                catch (e) { }
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
                    }
                    catch (err) {
                        console.error('[WhatsApp Real Baileys] Erro ao converter QR Code:', err.message);
                    }
                }
                if (connection === 'open') {
                    session.status = 'CONNECTED';
                    session.qrCodeBase64 = undefined;
                    const userJid = sock.user?.id || '';
                    session.connectedPhone = userJid.split(':')[0] || userJid.split('@')[0];
                    console.log(`[WhatsApp Real Baileys]  WhatsApp Conectado com sucesso para tenant ${tenantId}! Número: ${session.connectedPhone}`);
                }
                if (connection === 'close') {
                    const reason = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = reason !== DisconnectReason.loggedOut;
                    console.log(`[WhatsApp Real Baileys] Conexão fechada. Motivo: ${reason}. Reconectando? ${shouldReconnect}`);
                    if (shouldReconnect) {
                        this.startSession(tenantId);
                    }
                    else {
                        session.status = 'DISCONNECTED';
                        session.sock = undefined;
                        session.qrCodeBase64 = undefined;
                        session.connectedPhone = undefined;
                    }
                }
            });
            // Ouvinte de mensagens recebidas no WhatsApp Real
            sock.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify')
                    return;
                for (const msg of messages) {
                    if (!msg.message || msg.key.fromMe)
                        continue;
                    const remoteJid = msg.key.remoteJid;
                    if (!remoteJid || remoteJid.endsWith('@g.us'))
                        continue;
                    let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
                    // Suporte NATIVO para Áudio de Voz do WhatsApp (Multimodal Gemini AI)
                    if (!text && msg.message.audioMessage) {
                        const customerPhone = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
                        const pushName = msg.pushName || 'Cliente';
                        console.log(`[WhatsApp Real Audio] ️ Áudio de voz recebido de ${pushName} (${customerPhone}). Baixando e transcrevendo via Gemini AI...`);
                        try {
                            const buffer = await downloadMediaMessage(msg, 'buffer', {});
                            const mimeType = msg.message.audioMessage.mimetype || 'audio/ogg; codecs=opus';
                            text = await transcribeAudioBuffer(buffer, mimeType);
                            console.log(`[WhatsApp Real Audio Transcribed]  Transcrição do áudio: "${text}"`);
                        }
                        catch (audioErr) {
                            console.error('[WhatsApp Real Audio Error] Falha ao processar áudio:', audioErr.message);
                            await sock.sendMessage(remoteJid, {
                                text: `Desculpe, no momento não consigo ouvir mensagens de áudio por aqui! ️ Por favor, me mande sua mensagem por escrito em texto para que eu possa te ajudar com seu agendamento! `
                            });
                            continue;
                        }
                    }
                    if (!text)
                        continue;
                    const customerPhone = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
                    const pushName = msg.pushName || undefined;
                    console.log(`[WhatsApp Real Input] Mensagem recebida de ${customerPhone} (${pushName || 'Cliente'}) (tenant ${tenantId}): "${text}"`);
                    try {
                        const aiResult = await aiOrchestrator.processIncomingMessage(tenantId, customerPhone, text, { pushName });
                        if (aiResult.replyText) {
                            await sock.sendMessage(remoteJid, { text: aiResult.replyText });
                            console.log(`[WhatsApp Real Output] Resposta enviada para ${customerPhone}: "${aiResult.replyText}"`);
                        }
                    }
                    catch (err) {
                        console.error('[WhatsApp Real AI Error]', err.message);
                    }
                }
            });
            return this.getSessionState(tenantId);
        }
        catch (err) {
            console.error('[WhatsApp Real Baileys Init Error]', err.message);
            session.status = 'DISCONNECTED';
            return this.getSessionState(tenantId);
        }
    }
    async logoutSession(tenantId) {
        const session = activeSessions.get(tenantId);
        if (session && session.sock) {
            try {
                await session.sock.logout();
            }
            catch (err) {
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
    async sendMessage(tenantId, toPhone, text) {
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
                }
                else if (cleanPhone.length === 13 && cleanPhone.startsWith('55')) {
                    const altPhone = cleanPhone.slice(0, 4) + cleanPhone.slice(5);
                    const [onWaAlt] = await session.sock.onWhatsApp(altPhone);
                    if (onWaAlt && onWaAlt.exists && onWaAlt.jid) {
                        targetJid = onWaAlt.jid;
                    }
                }
                else if (cleanPhone.length === 12 && cleanPhone.startsWith('55')) {
                    const altPhone = cleanPhone.slice(0, 4) + '9' + cleanPhone.slice(4);
                    const [onWaAlt] = await session.sock.onWhatsApp(altPhone);
                    if (onWaAlt && onWaAlt.exists && onWaAlt.jid) {
                        targetJid = onWaAlt.jid;
                    }
                }
            }
            catch (checkErr) {
                console.warn('[WhatsApp Service] Aviso na checagem do número:', checkErr.message);
            }
            await session.sock.sendMessage(targetJid, { text });
            console.log(`[WhatsApp Service] Mensagem ativa enviada com sucesso para ${targetJid} (${tenantId})`);
            return true;
        }
        catch (err) {
            console.error(`[WhatsApp Service] Erro ao enviar mensagem para ${toPhone}:`, err.message);
            return false;
        }
    }
    async autoReconnectSavedSessions() {
        const dataDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dataDir))
            return;
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
                    }
                    catch (e) {
                        console.warn(`[WhatsApp AutoReconnect] Erro ao reconectar tenant ${tenantId}:`, e.message);
                    }
                }
            }
        }
    }
    async handleWebhook(body) {
        return { status: 'DEPRECATED_USE_BAILEYS' };
    }
}
export const whatsappService = new WhatsAppService();
