import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const key = process.env.GEMINI_API_KEY || '';
  console.log('Testing key with gemini-2.5-flash & gemini-flash-latest...');

  const genAI = new GoogleGenerativeAI(key);

  for (const modelName of ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash-lite']) {
    try {
      console.log(`\nCalling ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent('Olá! Responda "OK" se estiver funcionando.');
      console.log(`🎉 SUCCESS with ${modelName}! Response:`, result.response.text());
      return;
    } catch (err: any) {
      console.error(`Failed ${modelName}:`, err.message.substring(0, 200));
    }
  }
}

main();
