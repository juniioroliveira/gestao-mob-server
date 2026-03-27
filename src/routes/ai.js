import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config/env.js';

const router = Router();

router.post('/ai/extract-transaction', async (req, res, next) => {
  try {
    const { data, mimeType } = req.body || {};
    const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'missing_gemini_key' });
    if (!data || !mimeType) return res.status(400).json({ error: 'invalid_body' });

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          parts: [
            {
              text:
                'Analise este comprovante ou documento e extraia os detalhes da transação. ' +
                'Retorne APENAS um objeto JSON com os campos: ' +
                'title (nome do estabelecimento ou descrição), ' +
                'category (deve ser um destes: Alimentação, Lazer, Tecnologia, Renda, Transporte, Outros), ' +
                'amount (valor formatado como R$ 0,00), ' +
                'isPositive (boolean, true se for entrada/recebimento, false se for gasto/pagamento), ' +
                "date (data formatada como 'DD MMM, HH:mm').",
            },
            { inlineData: { data, mimeType } },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            category: {
              type: Type.STRING,
              enum: ['Alimentação', 'Lazer', 'Tecnologia', 'Renda', 'Transporte', 'Outros'],
            },
            amount: { type: Type.STRING },
            isPositive: { type: Type.BOOLEAN },
            date: { type: Type.STRING },
          },
          required: ['title', 'category', 'amount', 'isPositive', 'date'],
        },
      },
    });

    const text = response?.text;
    if (!text) return res.status(502).json({ error: 'empty_ai_response' });
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: 'invalid_ai_json', raw: text });
    }
    return res.json(parsed);
  } catch (e) {
    next(e);
  }
});

export default router;
