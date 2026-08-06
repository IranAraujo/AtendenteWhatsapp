import { aiOrchestrator } from './ai-orchestrator.service.js';
import { dbRepository } from './db.service.js';
export class WhatsAppService {
    evolutionApiUrl;
    evolutionApiKey;
    constructor() {
        this.evolutionApiUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
        this.evolutionApiKey = process.env.EVOLUTION_API_KEY || 'GLOBAL_API_KEY';
    }
    /**
     * Processa o Webhook recebido de uma mensagem no WhatsApp
     */
    async handleWebhook(payload) {
        // Ignorar mensagens enviadas pelo próprio robô ou sem dados
        if (!payload?.data?.key || payload.data.key.fromMe) {
            return { success: false };
        }
        const remoteJid = payload.data.key.remoteJid;
        // Ignorar mensagens de grupos
        if (remoteJid.includes('@g.us')) {
            return { success: false };
        }
        const customerPhone = remoteJid.replace('@s.whatsapp.net', '');
        const instanceName = payload.instance;
        // Localizar o Tenant correspondente a esta instância do WhatsApp
        const tenant = await dbRepository.getTenantByInstance(instanceName);
        if (!tenant) {
            console.warn(`[WhatsApp Webhook] Nenhum tenant encontrado para a instância: ${instanceName}`);
            return { success: false };
        }
        // Extrair o texto da mensagem
        const messageContent = payload.data.message?.conversation || payload.data.message?.extendedTextMessage?.text || '';
        if (!messageContent.trim()) {
            return { success: false };
        }
        console.log(`[WhatsApp Webhook] Mensagem recebida de ${customerPhone} (${tenant.name}): "${messageContent}"`);
        // Enviar mensagem para a Engine de IA
        const aiResult = await aiOrchestrator.processIncomingMessage(tenant.id, customerPhone, messageContent);
        // Enviar resposta no WhatsApp via Evolution API Gateway
        await this.sendTextMessage(instanceName, customerPhone, aiResult.replyText);
        return {
            success: true,
            replyText: aiResult.replyText
        };
    }
    /**
     * Envia uma mensagem de texto via Evolution API Gateway
     */
    async sendTextMessage(instanceName, recipientPhone, text) {
        try {
            const url = `${this.evolutionApiUrl}/message/sendText/${instanceName}`;
            const payload = {
                number: recipientPhone,
                options: {
                    delay: 1200,
                    presence: 'composing'
                },
                textMessage: {
                    text
                }
            };
            console.log(`[WhatsApp Outgoing] Enviando resposta para ${recipientPhone} via instância ${instanceName}...`);
            // Em ambiente de simulação/local sem a Evolution API rodando, logamos o sucesso
            if (process.env.NODE_ENV !== 'production' && !process.env.EVOLUTION_API_URL) {
                console.log(`[WhatsApp Mock Dispatch] Texto enviado com sucesso:\n"${text}"`);
                return true;
            }
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.evolutionApiKey
                },
                body: JSON.stringify(payload)
            });
            return response.ok;
        }
        catch (error) {
            console.error('[WhatsApp Outgoing Error]', error.message);
            return false;
        }
    }
}
export const whatsappService = new WhatsAppService();
