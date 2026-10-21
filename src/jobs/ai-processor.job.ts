import fastq from 'fastq';
import type { queueAsPromised } from 'fastq';
import logger from '../utils/logger.js';
import { aiOrchestrator } from '../services/ai-orchestrator.service.js';
import { getSock } from '../services/whatsapp.service.js'; // We'll need a way to get the socket

export interface AiJobTask {
  tenantId: string;
  customerPhone: string;
  remoteJid: string;
  text: string;
  pushName?: string;
  shouldReplyWithVoice: boolean;
  voiceId?: string;
}

// 1. Definição da função Worker
async function processAiJob(task: AiJobTask): Promise<void> {
  const { tenantId, customerPhone, remoteJid, text, pushName, shouldReplyWithVoice, voiceId } = task;
  
  logger.info({ tenantId, customerPhone }, '🤖 Processando mensagem na fila de IA');

  try {
    const sock = getSock(tenantId);
    if (!sock) {
      logger.warn({ tenantId }, 'Socket não encontrado para processar fila de IA');
      return;
    }

    // Simula presença realista
    try {
      if (shouldReplyWithVoice) {
        await sock.sendPresenceUpdate('recording', remoteJid);
      } else {
        await sock.sendPresenceUpdate('composing', remoteJid);
      }
    } catch (e) {
      logger.debug('Falha ao enviar presence update');
    }

    // Processamento pesado (Nvidia / Groq)
    const aiResult = await aiOrchestrator.processIncomingMessage(tenantId, customerPhone, text, { pushName });

    if (aiResult.replyText) {
      if (shouldReplyWithVoice) {
        try {
          const { generateSpeechAudio } = await import('../services/tts.service.js');
          const audioBuffer = await generateSpeechAudio(aiResult.replyText, voiceId);

          const recordingDelay = Math.min(Math.max(aiResult.replyText.length * 20, 1200), 3000);
          await new Promise(resolve => setTimeout(resolve, recordingDelay));

          try { await sock.sendPresenceUpdate('paused', remoteJid); } catch (e) {}

          await sock.sendMessage(remoteJid, {
            audio: audioBuffer,
            mimetype: 'audio/mp4',
            ptt: true
          });
          logger.info({ tenantId, customerPhone }, '✅ Áudio enviado com sucesso via fila');
        } catch (audioErr) {
          logger.error({ err: audioErr, tenantId }, 'Falha ao gerar/enviar áudio. Fazendo fallback para texto.');
          try { await sock.sendPresenceUpdate('paused', remoteJid); } catch (e) {}
          await sock.sendMessage(remoteJid, { text: aiResult.replyText });
        }
      } else {
        // Texto normal
        const typingDelay = Math.min(Math.max(aiResult.replyText.length * 30, 800), 2000);
        await new Promise(resolve => setTimeout(resolve, typingDelay));
        
        try { await sock.sendPresenceUpdate('paused', remoteJid); } catch (e) {}
        
        await sock.sendMessage(remoteJid, { text: aiResult.replyText });
        logger.info({ tenantId, customerPhone }, '✅ Mensagem de texto enviada via fila');
      }
    }

  } catch (err) {
    logger.error({ err, tenantId, customerPhone }, '❌ Erro crítico no worker da IA');
    try { await getSock(tenantId)?.sendMessage(remoteJid, { text: 'Perdão, minha rede está passando por instabilidades técnicas momentâneas. Por favor, tente novamente em alguns instantes!' }); } catch(e) {}
  }
}

// 2. Instanciando a Fila em Memória
// Concurrency 10 = processa no máximo 10 mensagens simultâneas globalmente
export const aiQueue: queueAsPromised<AiJobTask> = fastq.promise(processAiJob, 10);

aiQueue.empty = () => {
  logger.info('Fila de IA esvaziada');
};
