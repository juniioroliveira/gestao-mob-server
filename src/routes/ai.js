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

    const userId = Number(req.auth?.userId || req.query.userId);
    const isAsync = String(req.query.async || (req.body ? req.body.async : '') || '') === '1';
    const autoCreate = String(req.query.create || (req.body ? req.body.create : '') || '') === '1';
    if (isAsync && autoCreate && userId) {
      let jobId = null;
      try {
        const ins = await query(
          'INSERT INTO ingest_jobs (user_id, status, mime_type, filename, data_base64) VALUES (?, ?, ?, ?, ?)',
          [userId, 'queued', mimeType || null, req.file?.originalname || null, String(data)]
        );
        jobId = ins.insertId;
      } catch {}
      res.status(202).json({ queued: 1, job_id: jobId });
      setImmediate(async () => {
        try {
          if (jobId) await processIngestJobById(jobId);
        } catch {}
      });
      return;
    }
    let categories = [];
    if (userId) {
      try { 
        categories = await query('SELECT id, name, subcategories FROM categories WHERE user_id = ?', [userId]);
      } catch {}
    }
    const catList = Array.isArray(categories)
      ? categories.map((c) => {
          let subs = [];
          try {
            const raw = typeof c.subcategories === 'string' ? JSON.parse(c.subcategories) : c.subcategories;
            subs = Array.isArray(raw) ? raw.map((s) => String(s)) : [];
          } catch {}
          return { id: Number(c.id), name: String(c.name), subcategories: subs };
        })
      : [];

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          parts: [
            {
              text:
                'Analise este comprovante/documento e RETORNE APENAS um objeto JSON com: ' +
                'type (income|expense|transfer), ' +
                'amount (número decimal com ponto, ex: 54.52), ' +
                "occurred_at (string no formato 'YYYY-MM-DD HH:mm:ss', horário local do Brasil). Regra: para FATURAS/BOLETOS/CONTAS (ex.: \"Fatura de Cartão\",\"Boleto\",\"Conta de Luz\",\"Conta de Água\",\"Conta de Internet\",\"Conta de Celular\"), occurred_at deve ser a DATA DE VENCIMENTO; para COMPROVANTES/NOTAS/RECIBOS/CUPONS, occurred_at deve ser a DATA DO DOCUMENTO. Nunca use a data/hora atual; se não identificar, retorne null. " +
                'inscricao_federal (CNPJ ou CPF presente no documento; se não encontrar, use vazio), ' +
                'description (um título curto e CANÔNICO da natureza do gasto/recebimento; evite variações) ' +
                'category_id (um ID escolhido da lista fornecida). ' +
                'Se a data estiver no formato brasileiro (ex. 15/02/2026), use-a; caso falte o ano, infira pelo contexto do documento ou use o ano atual. ' + 
                'Nunca inclua valores formatados com R$, apenas número em amount. ' +
                'A saída deve ser somente JSON sem comentários. ' +
                'Inclua também um campo metadata com os dados do DOCUMENTO contendo (preencher SEMPRE issuer_name e document_type): ' +
                'issuer_name (nome do emissor/beneficiário), issuer_federal_id (CNPJ ou CPF), document_type (use uma destas labels CANÔNICAS quando aplicável: "Conta de Luz","Conta de Água","Conta de Internet","Conta de Celular","Fatura de Cartão","Cupom de Estacionamento","Pedágio","Supermercado - Nota","Farmácia - Nota","Nota Fiscal","Boleto","Recibo"), document_number, series, payment_method, currency (ex.: BRL), occurred_at_original (data/hora como no documento), due_date/vencimento (se houver), ' +
                'items (lista de itens com description, quantity, unit_price, total) e totals (subtotal, discount, tax, total).',
            },
            {
              text:
                'Categorias do usuário com IDs e subcategorias/sinônimos (EXEMPLOS, não regras rígidas): ' +
                JSON.stringify(catList) +
                '. Use as subcategorias apenas como referência para aprendizado; se não houver correspondência clara, escolha a categoria que melhor representa a transação. Persistindo dúvida, deixe category_id vazio e inclua category_name.',
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
            inscricao_federal: { type: Type.STRING },
            description: { type: Type.STRING },
            category_id: { type: Type.NUMBER },
            metadata: {
              type: Type.OBJECT,
              properties: {
                issuer_name: { type: Type.STRING },
                issuer_federal_id: { type: Type.STRING },
                document_type: { type: Type.STRING },
                document_number: { type: Type.STRING },
                series: { type: Type.STRING },
                payment_method: { type: Type.STRING },
                currency: { type: Type.STRING },
                occurred_at_original: { type: Type.STRING },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      description: { type: Type.STRING },
                      quantity: { type: Type.NUMBER },
                      unit_price: { type: Type.NUMBER },
                      total: { type: Type.NUMBER },
                    },
                  },
                },
                totals: {
                  type: Type.OBJECT,
                  properties: {
                    subtotal: { type: Type.NUMBER },
                    discount: { type: Type.NUMBER },
                    tax: { type: Type.NUMBER },
                    total: { type: Type.NUMBER },
                  },
                },
              },
            },
          },
          required: ['type', 'amount', 'description', 'metadata'],
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
    // Normalize amount
    const amount = Number(parsed?.amount);
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
      return null;
    }
    function parseBrDatetime(s) {
      const v = String(s || '').trim();
      const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
      if (m) {
        const dd = Number(m[1]);
        const MM = Number(m[2]);
        const yyyy = Number(m[3]);
        const hh = Number(m[4] || 0);
        const mi = Number(m[5] || 0);
        const ss = Number(m[6] || 0);
        const d = new Date(yyyy, MM - 1, dd, hh, mi, ss);
        return toSqlDatetime(d);
      }
      return toSqlDatetime(v);
    }
    let occurred_at = null;
    function cleanDescription(s) {
      return String(s || '')
        .replace(/\b(LTDA|ME|EIRELI|S\.?A\.?|SA|CNPJ|CPF|RAZÃO SOCIAL|RAZAO SOCIAL)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
    function normalizeFederalId(s) {
      const digits = String(s || '').replace(/[^\d]/g, '');
      if (digits.length === 14 || digits.length === 11) return digits;
      return '';
    }
    function normalizeText(s) {
      return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    }
    function canonicalIssuerName(name, desc) {
      const n = normalizeText(name) || normalizeText(desc);
      if (/enel|eletropaulo|elektro|cpfl|light|equatorial|celesc|cemig/.test(n)) return 'Enel';
      if (/sabesp|sanepar|copasa|compesa|cagece|saneago/.test(n)) return 'Sabesp';
      if (/\bvivo\b|telefonica/.test(n)) return 'Vivo';
      if (/\bclaro\b|net\b/.test(n)) return 'Claro';
      if (/\btim\b/.test(n)) return 'TIM';
      if (/\boi\b/.test(n)) return 'Oi';
      if (/sem\s*parar/.test(n)) return 'Sem Parar';
      return name || null;
    }
    function canonicalDocType(desc, issuer) {
      const d = normalizeText(desc + ' ' + (issuer || ''));
      if (/luz|energia|eletric/.test(d)) return 'Conta de Luz';
      if (/\bagua\b|sanepar|sabesp/.test(d)) return 'Conta de Água';
      if (/internet|fibra|banda larga|net|claro|vivo|oi fibra/.test(d)) return 'Conta de Internet';
      if (/plano|celular|telefonia/.test(d)) return 'Conta de Celular';
      if (/fatura.*cart[aã]o|cart[aã]o.*fatura/.test(d)) return 'Fatura de Cartão';
      if (/estacion|parking/.test(d)) return 'Cupom de Estacionamento';
      if (/ped[aá]gio|sem\s*parar/.test(d)) return 'Pedágio';
      if (/supermerc|mercado/.test(d)) return 'Supermercado - Nota';
      if (/farm[aá]cia|droga|drogasil|raia|panvel|pacheco/.test(d)) return 'Farmácia - Nota';
      if (/nota\s*fiscal|nfe|nf-e/.test(d)) return 'Nota Fiscal';
      if (/boleto|linha\s*digit[aá]vel/.test(d)) return 'Boleto';
      if (/recibo/.test(d)) return 'Recibo';
      return null;
    }
  function canonicalTitle(docType, issuer, desc) {
    const base = String(desc || '').trim();
    const dt = String(docType || '').trim();
    const isr = String(issuer || '').trim();
    if (dt && isr) return `${dt} - ${isr}`;
    if (dt) return dt;
    if (isr && base && !base.toLowerCase().includes(isr.toLowerCase())) return `${base} - ${isr}`;
    return base || isr || '';
  }
    function heuristicCategoryIdByDocType(docType, catList) {
      if (!docType) return null;
      const nameNorm = normalizeText(docType);
      const pickByName = (name) => {
        const target = normalizeText(name);
        const m = catList.find((c) => normalizeText(c.name) === target);
        return m ? Number(m.id) : null;
      };
      if (/conta de luz|conta de [aá]gua|conta de internet|conta de celular|cupom de estacion|ped[aá]gio/.test(nameNorm)) {
        return pickByName('Essencial Fixo');
      }
      if (/supermercado|farm[aá]cia/.test(nameNorm)) return pickByName('Essencial Variável');
      return null;
    }
    function heuristicCategoryIdByDescription(desc, catList) {
      const d = normalizeText(desc);
      const pickByName = (name) => {
        const target = normalizeText(name);
        const m = catList.find((c) => normalizeText(c.name) === target);
        return m ? Number(m.id) : null;
      };
      if (/estacion/.test(d) || /garag/.test(d) || /parking/.test(d)) return pickByName('Essencial Fixo');
      if (/internet/.test(d) || /plano/.test(d) || /celular/.test(d)) return pickByName('Essencial Fixo');
      if (/aluguel/.test(d) || /\bagua\b/.test(d) || /\bluz\b/.test(d)) return pickByName('Essencial Fixo');
      if (/mercado/.test(d) || /supermerc/.test(d) || /carrefour|extra|assai|atacad/.test(d)) return pickByName('Essencial Variável');
      if (/farmac/.test(d) || /droga|drogasil|panvel|pacheco|raia/.test(d)) return pickByName('Essencial Variável');
      if (/combustivel|gasolina|etanol|diesel|posto/.test(d)) return pickByName('Essencial Variável');
      if (/restaurante|lanchonete|burger|pizza|sushi|cafeteria/.test(d)) return pickByName('Não Essencial (Lazer)');
      if (/streaming|netflix|spotify|prime|youtube|disney|apple/.test(d)) return pickByName('Não Essencial (Lazer)');
      if (/compra|eletron|roupa|viagem|lazer/.test(d)) return pickByName('Não Essencial (Lazer)');
      if (/acoes|fundos|renda fixa|cripto|previd/.test(d)) return pickByName('Investimentos');
      if (/emergenc|fundo|reserva|objetivos/.test(d)) return pickByName('Reserva');
      return null;
    }
    function toNatureLabel(s) {
      const v = String(s || '').toLowerCase();
      if (/\bestac/i.test(v) || /\bparking\b/.test(v)) return 'Estacionamento';
      if (/\bipiranga\b/.test(v) || /\bshell\b/.test(v) || /\bpetrobras\b/.test(v) || /\bposto\b/.test(v) || /\bdiesel\b/.test(v) || /\bgasolina\b/.test(v) || /\betanol\b/.test(v)) return 'Combustível';
      if (/\bsupermercado\b/.test(v) || /\bmercado\b/.test(v) || /\bcarrefour\b/.test(v) || /\bextra\b/.test(v) || /\bassai\b/.test(v) || /\batacad[aã]o\b/.test(v) || /\bp[aã]o de a[cç]ucar\b/.test(v)) return 'Supermercado';
      if (/\bfarm[aá]cia\b/.test(v) || /\bdroga/i.test(v) || /\bdrogasil\b/.test(v) || /\bpanvel\b/.test(v) || /\bpacheco\b/.test(v) || /\braia\b/.test(v)) return 'Farmácia';
      if (/\bpadaria\b/.test(v)) return 'Padaria';
      if (/\brestaurante\b/.test(v) || /\blanchonete\b/.test(v) || /\bburger\b/.test(v) || /\bpizza\b/.test(v) || /\bsushi\b/.test(v) || /\bcafeteria\b/.test(v) || /\bcaf[eé]\b/.test(v)) return 'Restaurante';
      if (/\bped[aá]gio\b/.test(v) || /\bsem parar\b/.test(v) || /\bconcession[aá]ria\b/.test(v)) return 'Pedágio';
      if (/\buber\b/.test(v) || /\b99\b/.test(v) || /\bcabify\b/.test(v) || /\bindrive\b/.test(v)) return 'Transporte por aplicativo';
      if (/\bmensalidade\b/.test(v) || /\bmensal\b/.test(v) || /\bacademia\b/.test(v)) return 'Mensalidade';
      if (/\bassinatura\b/.test(v) || /\bsubscription\b/.test(v) || /\bspotify\b/.test(v) || /\bnetflix\b/.test(v) || /\bprime\b/.test(v) || /\blicloud\b/.test(v) || /\bgoogle one\b/.test(v) || /\byoutube premium\b/.test(v)) return 'Assinatura';
      if (/\beletr[oô]nicos?\b/.test(v) || /\bsmartphone\b/.test(v) || /\bnotebook\b/.test(v) || /\biphone\b/.test(v)) return 'Eletrônicos';
      return null;
    }
    let description = cleanDescription(parsed?.description);
    const nature = toNatureLabel(description);
    if (nature) description = nature;
    const type = parsed?.type === 'income' ? 'income' : parsed?.type === 'transfer' ? 'transfer' : 'expense';
    let category_id = null;
    if (Array.isArray(catList) && catList.length) {
      const cid = Number(parsed?.category_id);
      if (Number.isFinite(cid) && catList.some((c) => Number(c.id) === cid)) {
        category_id = cid;
      } else {
        const cname = String(parsed?.category_name || '').toLowerCase();
        const match = catList.find((c) => {
          if (String(c.name).toLowerCase() === cname) return true;
          const subs = Array.isArray(c.subcategories) ? c.subcategories : [];
          return subs.some((s) => String(s).toLowerCase() === cname);
        });
        category_id = match ? Number(match.id) : null;
      }
    } else {
      const cid = Number(parsed?.category_id);
      category_id = Number.isFinite(cid) ? cid : null;
    }
    const docMeta = parsed?.metadata || {};
    const inscricao_federal = normalizeFederalId(parsed?.inscricao_federal || docMeta?.issuer_federal_id);
    const inscricao_federal_out = inscricao_federal === '' ? ' ' : inscricao_federal;
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
      const issuer_name_norm = canonicalIssuerName(docMeta?.issuer_name || null, description);
      const doc_type_norm = canonicalDocType(description, issuer_name_norm) || docMeta?.document_type || null;
      description = canonicalTitle(doc_type_norm, issuer_name_norm, description);
      function isInvoiceDocType(s) {
        const n = normalizeText(s || '');
        return /(fatura.*cart|boleto|conta de luz|conta de [aá]gua|conta de internet|conta de celular)/.test(n);
      }
      {
        const invoice = isInvoiceDocType(doc_type_norm);
        const cands = invoice
          ? [docMeta?.due_date, docMeta?.vencimento, docMeta?.due, parsed?.occurred_at, docMeta?.occurred_at_original]
          : [docMeta?.occurred_at_original, parsed?.occurred_at, docMeta?.due_date, docMeta?.vencimento, docMeta?.due];
        for (const c of cands) {
          const dt = parseBrDatetime(c);
          if (dt) {
            occurred_at = dt;
            break;
          }
        }
      }
      const metadata = {
      source: { mimeType, isImage: String(mimeType || '').startsWith('image/') },
      document: {
          issuer_name: issuer_name_norm ?? docMeta?.issuer_name ?? null,
        issuer_federal_id: normalizeFederalId(docMeta?.issuer_federal_id) || null,
          document_type: doc_type_norm ?? null,
        document_number: docMeta?.document_number ?? null,
        series: docMeta?.series ?? null,
        occurred_at_original: docMeta?.occurred_at_original ?? (parsed?.occurred_at ?? null),
        payment_method: docMeta?.payment_method ?? null,
        currency: docMeta?.currency ?? 'BRL',
      },
      items: Array.isArray(docMeta?.items)
        ? docMeta.items.map((i) => ({
            description: String(i?.description || ''),
            quantity: Number(i?.quantity || 0),
            unit_price: Number(i?.unit_price || 0),
            total: Number(i?.total ?? (Number(i?.quantity || 0) * Number(i?.unit_price || 0))),
          }))
        : [],
      totals: {
        subtotal: Number(docMeta?.totals?.subtotal ?? 0),
        discount: Number(docMeta?.totals?.discount ?? 0),
        tax: Number(docMeta?.totals?.tax ?? 0),
        total: Number.isFinite(amount) ? amount : Number(docMeta?.totals?.total ?? 0),
      },
      ai: { model: 'gemini-3-flash-preview' },
    };
    const result = { account_id, category_id, type, amount: Number.isFinite(amount) ? amount : 0, occurred_at, description, inscricao_federal: inscricao_federal_out, metadata };
    if (autoCreate && userId) {
      if (!category_id && userId && description) {
        try {
          const hist = await query(
            'SELECT category_id FROM transactions WHERE user_id = ? AND description = ? AND category_id IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1',
            [userId, description]
          );
          const hid = Number(hist?.[0]?.category_id || 0);
          if (Number.isFinite(hid) && hid > 0) category_id = hid;
        } catch {}
      }
      if (!category_id) category_id = heuristicCategoryIdByDocType(doc_type_norm, catList) || heuristicCategoryIdByDescription(description, catList) || null;
      const occurred_at_sql = occurred_at || null;
      try {
        const insert = await query(  
          'INSERT INTO transactions (user_id, account_id, category_id, type, amount, occurred_at, description, inscricao_federal, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            userId,
            account_id || null,
            category_id || null,
            result.type,
            result.amount,
            occurred_at_sql,
            result.description || null,
            result.inscricao_federal || null,
            JSON.stringify(result.metadata || {}),
          ]
        );
        const [row] = await query('SELECT id, user_id, account_id, category_id, member_id, type, amount, occurred_at, description, inscricao_federal, metadata, created_at FROM transactions WHERE id = ?', [insert.insertId]);
        return res.status(201).json(row);
      } catch (err) {
        return res.status(500).json({ error: 'create_failed', message: err?.message || '' , payload: result });
      }
    }
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
export async function processIngestJobById(jobId) {
  try {
    const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) return;
    const [job] = await query('SELECT * FROM ingest_jobs WHERE id = ?', [jobId]);
    if (!job) return;
    const userId = Number(job.user_id);
    const data = String(job.data_base64 || '');
    const mimeType = String(job.mime_type || '');
    const attempts = Number(job.attempts || 0);
    const maxAttempts = Number(job.max_attempts || config.ingest?.maxAttempts || 5);
    if (Number.isFinite(maxAttempts) && attempts >= maxAttempts) {
      await query('UPDATE ingest_jobs SET status = ?, error = ? WHERE id = ?', ['failed', 'max_attempts_reached', jobId]);
      return;
    }
    await query('UPDATE ingest_jobs SET status = ?, attempts = attempts + 1, last_attempt_at = NOW() WHERE id = ?', ['processing', jobId]);
    let categories = [];
    try {
      categories = await query('SELECT id, name, subcategories FROM categories WHERE user_id = ?', [userId]);
    } catch {}
    const catList = Array.isArray(categories)
      ? categories.map((c) => {
          let subs = [];
          try {
            const raw = typeof c.subcategories === 'string' ? JSON.parse(c.subcategories) : c.subcategories;
            subs = Array.isArray(raw) ? raw.map((s) => String(s)) : [];
          } catch {}
          return { id: Number(c.id), name: String(c.name), subcategories: subs };
        })
      : [];
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          parts: [
            {
              text:
                'Analise este comprovante/documento e RETORNE APENAS um objeto JSON com: ' +
                'type (income|expense|transfer), ' +
                'amount (número decimal com ponto, ex: 54.52), ' +
                "occurred_at (string no formato 'YYYY-MM-DD HH:mm:ss', horário local do Brasil). Regra: para FATURAS/BOLETOS/CONTAS (ex.: \"Fatura de Cartão\",\"Boleto\",\"Conta de Luz\",\"Conta de Água\",\"Conta de Internet\",\"Conta de Celular\"), occurred_at deve ser a DATA DE VENCIMENTO; para COMPROVANTES/NOTAS/RECIBOS/CUPONS, occurred_at deve ser a DATA DO DOCUMENTO. Nunca use a data/hora atual; se não identificar, retorne null. " +
                'inscricao_federal (CNPJ ou CPF presente no documento; se não encontrar, use vazio), ' +
                'description (um título curto e CANÔNICO da natureza do gasto/recebimento; evite variações), ' +
                'category_id (um ID escolhido da lista fornecida; persistindo dúvida, deixe category_id vazio e inclua category_name). ' +
                'Se a data estiver no formato brasileiro (ex. 15/02/2026), use-a; caso falte o ano, infira pelo contexto do documento ou use o ano atual. ' +
                'Nunca inclua valores formatados com R$, apenas número em amount. ' +
                'A saída deve ser somente JSON sem comentários. ' +
                'Inclua também um campo metadata com os dados do DOCUMENTO contendo (preencher SEMPRE issuer_name e document_type): issuer_name, issuer_federal_id, document_type, document_number, series, payment_method, currency, occurred_at_original (data/hora como no documento), due_date/vencimento (se houver), items e totals.',
            },
            {
              text:
                'Categorias do usuário com IDs e subcategorias/sinônimos (EXEMPLOS, não regras rígidas): ' +
                JSON.stringify(catList) +
                '. Use as subcategorias apenas como referência para aprendizado; se não houver correspondência clara, escolha a categoria que melhor representa a transação. Persistindo dúvida, deixe category_id vazio e inclua category_name.',
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
            inscricao_federal: { type: Type.STRING },
            description: { type: Type.STRING },
            category_id: { type: Type.NUMBER },
            metadata: { type: Type.OBJECT },
          },
          required: ['type', 'amount', 'description', 'metadata'],
        },
      },
    });
    const text = response?.text;
    if (!text) {
      const nextSec = Math.min((config.ingest?.retryBaseSeconds || 30) * Math.pow(2, attempts), config.ingest?.retryMaxSeconds || 3600);
      await query('UPDATE ingest_jobs SET status = ?, error = ?, next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id = ?', ['queued', 'empty_ai_response', nextSec, jobId]);
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const nextSec = Math.min((config.ingest?.retryBaseSeconds || 30) * Math.pow(2, attempts), config.ingest?.retryMaxSeconds || 3600);
      await query('UPDATE ingest_jobs SET status = ?, error = ?, next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id = ?', ['queued', 'invalid_ai_json', nextSec, jobId]);
      return;
    }
          const amount = Number(parsed?.amount);
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
      return null;
    }
          function parseBrDatetime(s) {
            const v = String(s || '').trim();
            const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
            if (m) {
              const dd = Number(m[1]);
              const MM = Number(m[2]);
              const yyyy = Number(m[3]);
              const hh = Number(m[4] || 0);
              const mi = Number(m[5] || 0);
              const ss = Number(m[6] || 0);
              const d = new Date(yyyy, MM - 1, dd, hh, mi, ss);
              return toSqlDatetime(d);
            }
            return toSqlDatetime(v);
          }
    function cleanDescription(s) {
      return String(s || '').replace(/\b(LTDA|ME|EIRELI|S\.?A\.?|SA|CNPJ|CPF|RAZÃO SOCIAL|RAZAO SOCIAL)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
    }
    function normalizeFederalId(s) {
      const digits = String(s || '').replace(/[^\d]/g, '');
      if (digits.length === 14 || digits.length === 11) return digits;
      return '';
    }
    function normalizeText(s) {
      return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    function canonicalIssuerName(name, desc) {
      const n = normalizeText(name) || normalizeText(desc);
      if (/enel|eletropaulo|elektro|cpfl|light|equatorial|celesc|cemig/.test(n)) return 'Enel';
      if (/sabesp|sanepar|copasa|compesa|cagece|saneago/.test(n)) return 'Sabesp';
      if (/\bvivo\b|telefonica/.test(n)) return 'Vivo';
      if (/\bclaro\b|net\b/.test(n)) return 'Claro';
      if (/\btim\b/.test(n)) return 'TIM';
      if (/\boi\b/.test(n)) return 'Oi';
      if (/sem\s*parar/.test(n)) return 'Sem Parar';
      return name || null;
    }
    function canonicalDocType(desc, issuer) {
      const d = normalizeText(desc + ' ' + (issuer || ''));
      if (/luz|energia|eletric/.test(d)) return 'Conta de Luz';
      if (/\bagua\b|sanepar|sabesp/.test(d)) return 'Conta de Água';
      if (/internet|fibra|banda larga|net|claro|vivo|oi fibra/.test(d)) return 'Conta de Internet';
      if (/plano|celular|telefonia/.test(d)) return 'Conta de Celular';
      if (/fatura.*cart[aã]o|cart[aã]o.*fatura/.test(d)) return 'Fatura de Cartão';
      if (/estacion|parking/.test(d)) return 'Cupom de Estacionamento';
      if (/ped[aá]gio|sem\s*parar/.test(d)) return 'Pedágio';
      if (/supermerc|mercado/.test(d)) return 'Supermercado - Nota';
      if (/farm[aá]cia|droga|drogasil|raia|panvel|pacheco/.test(d)) return 'Farmácia - Nota';
      if (/nota\s*fiscal|nfe|nf-e/.test(d)) return 'Nota Fiscal';
      if (/boleto|linha\s*digit[aá]vel/.test(d)) return 'Boleto';
      if (/recibo/.test(d)) return 'Recibo';
      return null;
    }
    function canonicalTitle(docType, issuer, desc) {
      const base = String(desc || '').trim();
      const dt = String(docType || '').trim();
      const isr = String(issuer || '').trim();
      if (dt && isr) return `${dt} - ${isr}`;
      if (dt) return dt;
      if (isr && base && !base.toLowerCase().includes(isr.toLowerCase())) return `${base} - ${isr}`;
      return base || isr || '';
    }
    let description = cleanDescription(parsed?.description);
    const type = parsed?.type === 'income' ? 'income' : parsed?.type === 'transfer' ? 'transfer' : 'expense';
    let category_id = null;
    if (Array.isArray(catList) && catList.length) {
      const cid = Number(parsed?.category_id);
      if (Number.isFinite(cid) && catList.some((c) => Number(c.id) === cid)) {
        category_id = cid;
      } else {
        const cname = String(parsed?.category_name || '').toLowerCase();
        const match = catList.find((c) => {
          if (String(c.name).toLowerCase() === cname) return true;
          const subs = Array.isArray(c.subcategories) ? c.subcategories : [];
          return subs.some((s) => String(s).toLowerCase() === cname);
        });
        category_id = match ? Number(match.id) : null;
      }
    }
          const docMeta = parsed?.metadata || {};
    const inscricao_federal = normalizeFederalId(parsed?.inscricao_federal || docMeta?.issuer_federal_id);
    const inscricao_federal_out = inscricao_federal === '' ? ' ' : inscricao_federal;
    const issuer_name_norm2 = canonicalIssuerName(docMeta?.issuer_name || null, description);
    const doc_type_norm2 = canonicalDocType(description, issuer_name_norm2) || docMeta?.document_type || null;
    description = canonicalTitle(doc_type_norm2, issuer_name_norm2, description);
    function isInvoiceDocType2(s) {
      const n = normalizeText(s || '');
      return /(fatura.*cart|boleto|conta de luz|conta de [aá]gua|conta de internet|conta de celular)/.test(n);
    }
    let occurred_at = null;
    {
      const invoice = isInvoiceDocType2(doc_type_norm2);
      const cands = invoice
        ? [docMeta?.due_date, docMeta?.vencimento, docMeta?.due, parsed?.occurred_at, docMeta?.occurred_at_original]
        : [docMeta?.occurred_at_original, parsed?.occurred_at, docMeta?.due_date, docMeta?.vencimento, docMeta?.due];
      for (const c of cands) {
        const dt = parseBrDatetime(c);
        if (dt) {
          occurred_at = dt;
          break;
        }
      }
    }
    if (!category_id && userId) {
      try {
        const hist = await query('SELECT category_id FROM transactions WHERE user_id = ? AND description = ? AND category_id IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1', [userId, description]);
        const hid = Number(hist?.[0]?.category_id || 0);
        if (Number.isFinite(hid) && hid > 0) category_id = hid;
      } catch {}
    }
    const occurred_at_sql = occurred_at || null;
    const requiredOk = type && Number.isFinite(amount) && description && String(description).length > 0;
    if (!requiredOk) {
      await query('UPDATE ingest_jobs SET status = ?, ai_output = ? WHERE id = ?', ['needs_review', JSON.stringify({ type, amount, occurred_at, description, category_id }), jobId]);
      return;
    }
    const insTx = await query(
      'INSERT INTO transactions (user_id, account_id, category_id, type, amount, occurred_at, description, inscricao_federal, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, null, category_id || null, type, Number.isFinite(amount) ? amount : 0, occurred_at_sql, description || null, inscricao_federal_out || null, JSON.stringify({ source: { mimeType, isImage: String(mimeType || '').startsWith('image/') }, ai: { model: 'gemini-3-flash-preview' }, document: docMeta || {} })]
    );
    await query('UPDATE ingest_jobs SET status = ?, transaction_id = ?, ai_output = ?, next_attempt_at = NULL WHERE id = ?', ['done', insTx.insertId, JSON.stringify({ type, amount, occurred_at, description, category_id }), jobId]);
  } catch (err) {
    try {
      const [job] = await query('SELECT attempts, max_attempts FROM ingest_jobs WHERE id = ?', [jobId]);
      const attempts = Number(job?.attempts || 0);
      const maxAttempts = Number(job?.max_attempts || config.ingest?.maxAttempts || 5);
      const willRetry = !Number.isFinite(maxAttempts) || attempts < maxAttempts;
      if (willRetry) {
        const nextSec = Math.min((config.ingest?.retryBaseSeconds || 30) * Math.pow(2, Math.max(0, attempts - 1)), config.ingest?.retryMaxSeconds || 3600);
        await query('UPDATE ingest_jobs SET status = ?, error = ?, next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id = ?', ['queued', String(err?.message || err || ''), nextSec, jobId]);
      } else {
        await query('UPDATE ingest_jobs SET status = ?, error = ? WHERE id = ?', ['failed', String(err?.message || err || ''), jobId]);
      }
    } catch {}
  }
}
