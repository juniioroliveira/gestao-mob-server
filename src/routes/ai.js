import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config/env.js';
import multer from 'multer';
import sharp from 'sharp';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.post('/ai/extract-transaction', upload.single('file'), async (req, res, next) => {
  try {
    const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'missing_gemini_key' });

    let data = null;
    let mimeType = null;

    if (req.file && req.file.buffer) {
      mimeType = req.file.mimetype;
      const isImage = mimeType?.startsWith('image/');
      if (isImage) {
        const buf = await sharp(req.file.buffer).rotate().resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
        data = buf.toString('base64');
        mimeType = 'image/jpeg';
      } else {
        data = req.file.buffer.toString('base64');
      }
    } else {
      const body = req.body || {};
      data = body.data;
      mimeType = body.mimeType;
    }

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
    const msg = e?.message || '';
    if (msg.includes('File too large')) {
      return res.status(413).json({ error: 'payload_too_large', message: msg });
    }
    return res.status(500).json({ error: 'internal_error', message: msg });
  }
});

export default router;
