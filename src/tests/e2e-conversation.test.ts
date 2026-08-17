import dotenv from 'dotenv';
dotenv.config();

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { aiOrchestrator } from '../services/ai-orchestrator.service.js';
import { dbRepository } from '../services/db.service.js';

describe('E2E Conversation & Booking Flow - Suíte de Testes da Equipe QA', () => {
  const tenantId = 'tenant-demo-estilo';

  it('1. Fluxo de 2 turnos: deve agendar com sucesso quando o cliente pede horário no turno 1 e informa o nome no turno 2', async () => {
    const testPhone = `558499${Date.now().toString().slice(-6)}`;

    // Turno 1: Cliente solicita corte para amanhã às 11h com o Lucas
    const r1 = await aiOrchestrator.processIncomingMessage(
      tenantId, 
      testPhone, 
      'quero marcar um corte com lucas amanhã 11h'
    );
    assert.ok(r1.replyText, 'IA deve retornar resposta no turno 1');

    // Turno 2: Cliente informa o nome completo
    const r2 = await aiOrchestrator.processIncomingMessage(
      tenantId, 
      testPhone, 
      'Fernanda Montenegro'
    );

    assert.ok(r2.replyText, 'IA deve retornar resposta no turno 2');
    
    // Verifica se o agendamento foi salvo no banco de dados
    const appts = await dbRepository.listAppointments(tenantId);
    const found = appts.find(a => a.customerPhone === testPhone);
    assert.ok(found, 'Agendamento deve existir no banco de dados');
    assert.ok(
      found.customerName.toLowerCase().includes('fernanda'),
      `Nome do cliente no banco (${found.customerName}) deve conter Fernanda`
    );
  });

  it('2. Fluxo de 1 turno direto: deve agendar imediatamente quando todos os dados são enviados', async () => {
    const testPhone = `558498${Date.now().toString().slice(-6)}`;

    const r = await aiOrchestrator.processIncomingMessage(
      tenantId,
      testPhone,
      'Meu nome é Roberto Carlos e quero agendar corte amanhã às 16h com o Lucas'
    );

    assert.ok(r.replyText, 'IA deve retornar resposta');
    const appts = await dbRepository.listAppointments(tenantId);
    const found = appts.find(a => a.customerPhone === testPhone);
    assert.ok(found, 'Agendamento direto deve ter sido gravado');
  });

  it('3. Consulta de serviços e catálogo: deve responder cordialmente com os serviços disponíveis', async () => {
    const testPhone = `558497${Date.now().toString().slice(-6)}`;

    const r = await aiOrchestrator.processIncomingMessage(
      tenantId,
      testPhone,
      'Quais serviços vocês oferecem?'
    );

    assert.ok(r.replyText && r.replyText.length > 5, 'IA deve responder à pergunta de serviços');
  });
});
