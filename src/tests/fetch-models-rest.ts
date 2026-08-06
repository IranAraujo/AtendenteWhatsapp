import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const key = process.env.GEMINI_API_KEY || '';
  console.log('Fetching available models for key via REST API...');

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const data = await res.json();

    if (data.models) {
      console.log('Available models for your API Key:');
      data.models.forEach((m: any) => {
        if (m.supportedGenerationMethods?.includes('generateContent')) {
          console.log(`- ${m.name.replace('models/', '')} (${m.displayName})`);
        }
      });
    } else {
      console.log('Response:', JSON.stringify(data));
    }
  } catch (err: any) {
    console.error('Error fetching models:', err.message);
  }
}

main();
