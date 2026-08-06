import { describe, it } from 'node:test';
import assert from 'node:assert';
import { aiOrchestrator } from '../services/ai-orchestrator.service.js';
import { whatsappService } from '../services/whatsapp.service.js';
describe('AI Orchestrator & WhatsApp Webhook - Testes de Integração', () => {
    it('deve listar serviços ao perguntar os preços/opções', async () => {
        const result = await aiOrchestrator.processIncomingMessage('tenant-demo-barbearia', '5511999991111', 'Quais os serviços e preços disponíveis?');
        assert.ok(result.replyText.includes('Corte de Cabelo'));
        assert.ok(result.replyText.includes('Barba Completa'));
        assert.ok(result.functionCallsExecuted.includes('list_services'));
    });
    it('deve consultar horários livres no banco de dados', async () => {
        const result = await aiOrchestrator.processIncomingMessage('tenant-demo-barbearia', '5511999991111', 'Quais horários livres vocês têm hoje?');
        assert.ok(result.functionCallsExecuted.includes('get_available_slots'));
        assert.ok(result.replyText.includes('08:00'));
    });
    it('deve confirmar o agendamento e retornar os dados da reserva', async () => {
        const result = await aiOrchestrator.processIncomingMessage('tenant-demo-barbearia', '5511999991111', 'Quero agendar e confirmar meu corte para hoje às 14:00');
        assert.ok(result.functionCallsExecuted.includes('create_appointment'));
        assert.ok(result.appointmentCreated !== undefined);
        assert.strictEqual(result.appointmentCreated.status, 'CONFIRMED');
    });
    it('deve processar webhook do WhatsApp recebido da Evolution API', async () => {
        const webhookPayload = {
            event: 'messages.upsert',
            instance: 'instancia-navalha',
            data: {
                key: {
                    remoteJid: '5511988887777@s.whatsapp.net',
                    fromMe: false,
                    id: 'MSG12345'
                },
                pushName: 'Cliente Teste',
                message: {
                    conversation: 'Gostaria de agendar um corte'
                }
            }
        };
        const webhookResult = await whatsappService.handleWebhook(webhookPayload);
        assert.strictEqual(webhookResult.success, true);
        assert.ok(webhookResult.replyText !== undefined);
        assert.ok(webhookResult.replyText.includes('CONFIRMED') || webhookResult.replyText.includes('agendamento'));
    });
});
