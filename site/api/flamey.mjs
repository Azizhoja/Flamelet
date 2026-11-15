// Vercel serverless function: POST /api/ogonek  { question, facts }  →  { answer, model }
import { answer } from './_core.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  let input = req.body;
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = null; } }
  const who = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const out = await answer(input, process.env.GEMINI_API_KEY, who);
  res.status(out.status).json(out.body);
}
