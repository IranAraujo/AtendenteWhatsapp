import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const key = process.env.GEMINI_API_KEY || '';
  console.log('Testing AI Studio Key:', key);

  const genAI = new GoogleGenerativeAI(key);

  const candidateModels = [
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-exp',
    'gemini-exp-1206',
    'chat-bison-001'
  ];

  for (const modelName of candidateModels) {
    try {
      console.log(`\nTesting candidate model: ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent('Olá! Responda "OK" se estiver funcionando.');
      console.log(`✅ SUCCESS with model ${modelName}! Response:`, result.response.text());
      return;
    } catch (err: any) {
      console.log(`❌ Failed ${modelName}:`, err.message.substring(0, 150));
    }
  }
}

main();
