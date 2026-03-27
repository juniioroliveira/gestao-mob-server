import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config/env.js';
import multer from 'multer';
import sharp from 'sharp';
import { query } from '../db/query.js';

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
                'Analise este comprovante/documento e RETORNE APENAS um objeto JSON com o contrato da tabela de transações: ' +
                'type (income|expense|transfer), ' +
                'amount (número decimal, ponto como separador, ex: 54.52), ' +
                "occurred_at (string no formato 'YYYY-MM-DD HH:mm:ss', use horário local do Brasil), " +
                'description (texto curto do estabelecimento/descrição), ' +
                'category_name (um destes: Alimentação, Lazer, Tecnologia, Renda, Transporte, Outros). ' +
                'Se a data do documento estiver no formato brasileiro (ex. 15/02/2026), use-a; caso falte o ano, infira pelo contexto do documento ou use o ano atual. ' +
                'Nunca inclua valores formatados com R$, apenas número em amount. ' +
                'Saída deve ser somente JSON sem comentários.',
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
            type: { type: Type.STRING, enum: ['income', 'expense', 'transfer'] },
            amount: { type: Type.NUMBER },
            occurred_at: { type: Type.STRING },
            description: { type: Type.STRING },
            category_name: {
              type: Type.STRING,
              enum: ['Alimentação', 'Lazer', 'Tecnologia', 'Renda', 'Transporte', 'Outros'],
            },
          },
          required: ['type', 'amount', 'occurred_at', 'description', 'category_name'],
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
    const userId = Number(req.auth?.userId || req.query.userId);
    // Normalize amount
    const amount = Number(parsed?.amount);
    // Normalize occurred_at to 'YYYY-MM-DD HH:mm:ss'
    function toSqlDatetime(s) {
      const tryDate = new Date(s);
      if (!isNaN(tryDate.getTime())) {
        const pad = (n) => String(n).padStart(2, '0');
        const yyyy = tryDate.getFullYear();
        const MM = pad(tryDate.getMonth() + 1);
        const dd = pad(tryDate.getDate());
        const hh = pad(tryDate.getHours());
        const mm = pad(tryDate.getMinutes());
        const ss = pad(tryDate.getSeconds());
        return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
      }
      return new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    const occurred_at = toSqlDatetime(parsed?.occurred_at);
    const description = String(parsed?.description || '').trim();
    const type = parsed?.type === 'income' ? 'income' : parsed?.type === 'transfer' ? 'transfer' : 'expense';
    // Map category_name -> category_id
    let category_id = null;
    if (userId) {
      try {
        const cats = await query('SELECT id, name FROM categories WHERE user_id = ?', [userId]);
        const match = cats.find((c) => String(c.name).toLowerCase() === String(parsed?.category_name || '').toLowerCase());
        category_id = match ? Number(match.id) : null;
      } catch {}
    }
    // Heuristic: map account_id for liabilities if description suggests "fatura/cartão"
    let account_id = null;
    if (userId) {
      const descLower = description.toLowerCase();
      if (descLower.includes('fatura') || descLower.includes('cartão')) {
        try {
          const accs = await query('SELECT id, name, type FROM accounts WHERE user_id = ?', [userId]);
          const match = accs.find((a) => String(a.name).toLowerCase().includes('cartão') || String(a.type) === 'liability');
          account_id = match ? Number(match.id) : null;
        } catch {}
      }
    }
    const result = { account_id, category_id, type, amount: Number.isFinite(amount) ? amount : 0, occurred_at, description };
    return res.json(result);
  } catch (e) {
    const msg = e?.message || '';
    if (msg.includes('File too large')) {
      return res.status(413).json({ error: 'payload_too_large', message: msg });
    }
    return res.status(500).json({ error: 'internal_error', message: msg });
  }
});

export default router;
