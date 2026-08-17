import dotenv from 'dotenv';
dotenv.config();

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { aiOrchestrator, sanitizeUserTimeInput, formatHumanSlots } from '../services/ai-orchestrator.service.js';

describe('AI Orchestrator - Gerenciamento Inteligente de Agendamentos Existentes', () => {

  it('deve perguntar ao cliente se deseja mudar ou criar um novo quando já tem agendamento ativo', async () => {
    const phone = `551195${Date.now().toString().slice(-6)}`;
    const tenantId = 'tenant-demo-estilo';

    // Agendar às 14h amanhã
    await aiOrchestrator.processIncomingMessage(tenantId, phone, 'Quero agendar amanhã às 14h');
    await aiOrchestrator.processIncomingMessage(tenantId, phone, 'Iran Araujo');

    // Pedir horário das 13h sem especificar se é novo ou mudança
    const res = await aiOrchestrator.processIncomingMessage(tenantId, phone, 'pode ser às 13h');

    assert.ok(res.replyText, 'IA deve retornar resposta');

    // Cliente confirma que quer mudar
    const resChange = await aiOrchestrator.processIncomingMessage(tenantId, phone, 'quero mudar para 13h');
    assert.ok(resChange.replyText, 'IA deve responder à alteração');
  });

  it('deve alterar diretamente se a solicitação for explícita de alteração (ex: "quero mudar para 13h")', async () => {
    const phone = `551193${Date.now().toString().slice(-6)}`;
    const tenantId = 'tenant-demo-estilo';

    // Agendar às 14h amanhã
    await aiOrchestrator.processIncomingMessage(tenantId, phone, 'Quero agendar amanhã às 14h com o Lucas');
    await aiOrchestrator.processIncomingMessage(tenantId, phone, 'Cliente Teste');

    // Solicitação explícita de mudança
    const res = await aiOrchestrator.processIncomingMessage(tenantId, phone, 'Quero mudar para 13h');

    assert.ok(res.replyText, 'IA deve responder à alteração');
  });
});
