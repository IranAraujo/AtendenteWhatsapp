import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export interface AvailableVoice {
  id: string;
  name: string;
  gender: 'FEMALE' | 'MALE';
  description: string;
  previewText: string;
}

export const AVAILABLE_VOICES: AvailableVoice[] = [
  {
    id: 'pt-BR-FranciscaNeural',
    name: 'Francisca (Feminina - Suave & Acolhedora)',
    gender: 'FEMALE',
    description: 'Voz feminina natural e calorosa, perfeita para salões, clínicas e estética.',
    previewText: 'Olá! Seja muito bem-vindo! Como posso te ajudar com seu agendamento hoje?'
  },
  {
    id: 'pt-BR-AntonioNeural',
    name: 'Antonio (Masculino - Profissional & Amigável)',
    gender: 'MALE',
    description: 'Voz masculina clara, segura e profissional.',
    previewText: 'Olá! Tudo bem? Estou aqui para ajudar você a agendar o seu atendimento.'
  },
  {
    id: 'pt-BR-ThalitaNeural',
    name: 'Thalita (Feminina - Jovem & Dinâmica)',
    gender: 'FEMALE',
    description: 'Voz feminina jovem, ágil e simpática.',
    previewText: 'Oi! Tudo ótimo por aqui! Qual dia e horário você prefere marcar?'
  },
  {
    id: 'pt-BR-FabioNeural',
    name: 'Fabio (Masculino - Confiante)',
    gender: 'MALE',
    description: 'Voz masculina firme, moderna e confiante.',
    previewText: 'Perfeito! Seu agendamento foi registrado com sucesso. Te esperamos!'
  },
  {
    id: 'pt-BR-BrendaNeural',
    name: 'Brenda (Feminina - Espontânea)',
    gender: 'FEMALE',
    description: 'Voz feminina espontânea e alegre.',
    previewText: 'Combinado! Qualquer dúvida sobre o endereço ou horário, só me chamar!'
  },
  {
    id: 'pt-BR-DonatoNeural',
    name: 'Donato (Masculino - Maduro & Cordial)',
    gender: 'MALE',
    description: 'Voz masculina madura e cordial.',
    previewText: 'Olá! Que bom ter você conosco. Temos horários disponíveis para esta semana.'
  }
];

export async function generateSpeechAudio(text: string, voiceId: string = 'pt-BR-FranciscaNeural'): Promise<Buffer> {
  // Limpa caracteres especiais, formatação markdown e emojis para que a voz soe 100% fluida e natural
  const cleanText = text
    .replace(/\*+/g, '')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~([^~]+)~/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/https?:\/\/\S+/g, 'no link informado')
    .replace(/[\u{1F300}-\u{1FAD6}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanText) {
    throw new Error('Texto vazio para sintetizar voz.');
  }

  // 1. Tenta sintetizar com Microsoft Edge Neural TTS (Alta fidelidade)
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voiceId || 'pt-BR-FranciscaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const result = tts.toStream(cleanText);
    const audioStream: any = (result as any).audioStream || result;

    const chunks: Buffer[] = [];
    return await new Promise<Buffer>((resolve, reject) => {
      let isDone = false;
      const finish = () => {
        if (isDone) return;
        isDone = true;
        try { tts.close(); } catch (e) {}
        if (chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error('Nenhum dado de áudio gerado.'));
        }
      };

      audioStream.on('data', (chunk: any) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      audioStream.on('end', finish);
      audioStream.on('close', finish);
      audioStream.on('error', (err: any) => {
        if (chunks.length > 0) {
          finish();
        } else {
          reject(err);
        }
      });
    });
  } catch (err: any) {
    console.warn('[TTS Service] Edge TTS falhou, tentando fallback Google TTS:', err.message);

    // 2. Fallback Google Translate TTS
    try {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText.slice(0, 200))}&tl=pt-BR&client=tw-ob`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }
    } catch (gErr: any) {
      console.error('[TTS Service] Fallback Google TTS falhou:', gErr.message);
    }

    throw new Error(`Falha na síntese de voz: ${err.message}`);
  }
}
