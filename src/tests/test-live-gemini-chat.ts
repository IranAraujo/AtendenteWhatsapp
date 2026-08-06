import { aiOrchestrator } from '../services/ai-orchestrator.service.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('Testing live processIncomingMessage with user key...');

  const res1 = await aiOrchestrator.processIncomingMessage('tenant-demo-barbearia', '5511999998888', 'boa tarde');
  console.log('User: boa tarde');
  console.log('AI Reply 1:', res1.replyText);

  const res2 = await aiOrchestrator.processIncomingMessage('tenant-demo-barbearia', '5511999998888', 'tem como marcar para amanhã 13h?');
  console.log('\nUser: tem como marcar para amanhã 13h?');
  console.log('AI Reply 2:', res2.replyText);
  console.log('Tools Executed:', res2.functionCallsExecuted);

  const res3 = await aiOrchestrator.processIncomingMessage('tenant-demo-barbearia', '5511999998888', 'meu nome é Iran Araujo');
  console.log('\nUser: meu nome é Iran Araujo');
  console.log('AI Reply 3:', res3.replyText);
  console.log('Tools Executed:', res3.functionCallsExecuted);
}

main();
