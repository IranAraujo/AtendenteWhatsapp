import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const key = process.env.GEMINI_API_KEY || '';
  console.log('Testing key:', key);

  const genAI = new GoogleGenerativeAI(key);

  console.log('Waiting 15 seconds for quota reset...');
  await new Promise(r => setTimeout(r, 15000));

  try {
    console.log('Sending request to gemini-2.0-flash...');
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent('Olá! Responda como uma recepcionista amigável.');
    console.log('SUCCESS! Gemini response:', result.response.text());
  } catch (err: any) {
    console.error('Error with gemini-2.0-flash:', err.message);
  }
}

main();
