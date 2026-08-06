import { describe, it } from 'node:test';
import assert from 'node:assert';
import { aiOrchestrator, sanitizeUserTimeInput, formatHumanSlots } from '../services/ai-orchestrator.service.js';

describe('AI Orchestrator - Gerenciamento Inteligente de Agendamentos Existentes', () => {

  it('deve perguntar ao cliente se deseja mudar ou criar um novo quando já tem agendamento ativo', async () => {
    const phone = '5511955554444';
    const tenantId = 'tenant-demo-estilo';

    // Agendar às 14h amanhã
    await aiOrchestrator.processIncomingMessage(tenantId, phone, 'Quero agendar amanhã às 14h');
    await aiOrchestrator.processIncomingMessage(tenantId, phone, 'Iran Araujo');

    // Pedir horário das 13h sem especificar se é novo ou mudança
    const res = await aiOrchestrator.processIncomingMessage(tenantId, phone, 'pode ser às 13h');

    assert.ok(res.replyText.includes('mudar esse seu agendamento') || res.replyText.includes('novo agendamento'));

    // Cliente confirma que quer mudar
    const resChange = await aiOrchestrator.processIncomingMessage(tenantId, phone, 'mudar');
    assert.ok(resChange.replyText.includes('alterado com sucesso') || resChange.replyText.includes('13:00'));
  });

  it('deve alterar diretamente se a solicitação for explícita de alteração (ex: "quero mudar para 13h")', async () => {
    const phone = '5511933332222';
    const tenantId = 'tenant-demo-estilo';

    // Agendar às 14h amanhã
    await aiOrchestrator.processIncomingMessage(tenantId, phone, 'Quero agendar amanhã às 14h');
    await aiOrchestrator.processIncomingMessage(tenantId, phone, 'Cliente Teste');

    // Solicitação explícita de mudança
    const res = await aiOrchestrator.processIncomingMessage(tenantId, phone, 'Quero mudar para 13h');

    assert.ok(res.replyText.includes('alterado') || res.replyText.includes('13:00'));
  });
});
