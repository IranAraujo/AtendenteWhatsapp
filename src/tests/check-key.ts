import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const key = process.env.GEMINI_API_KEY || '';
  console.log('Testing key:', key);

  const genAI = new GoogleGenerativeAI(key);

  for (const modelName of ['gemini-1.5-flash-latest', 'gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-pro']) {
    try {
      console.log(`Trying model ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent('Olá');
      console.log(`SUCCESS with ${modelName}! Gemini response:`, result.response.text());
      return;
    } catch (err: any) {
      console.error(`Error with ${modelName}:`, err.message);
    }
  }
}

main();
