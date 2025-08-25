// server.js — Express 4 + IA (OpenAI) + CORS whitelist + PDF em buffer + tema/keywords/temperature

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 8080;

// ====== CORS (preflight + whitelist sem lançar erro) ======
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!allowed.length) {
    res.setHeader('Access-Control-Allow-Origin', '*'); // dev
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (!allowed.length) return cb(null, true);
    return cb(null, allowed.includes(origin)); // true/false (sem throw)
  },
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  optionsSuccessStatus: 204,
}));

// ====== middlewares comuns ======
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

// ====== util ======
function gerarTextoLocal({ language = 'pt', length = 200, tone = 'casual', topic = '', keywords = '' }) {
  const lingua = { pt: 'em Português', en: 'in English', es: 'en Español' }[language] || 'em Português';
  const base = tone === 'professional' ? 'Conteúdo profissional' : 'Conteúdo casual';
  const kw = String(keywords || '').split(',').map(s=>s.trim()).filter(Boolean);
  const assunto = topic ? ` Tema: ${topic}.` : '';
  const kws = kw.length ? ` Palavras-chave: ${kw.slice(0,8).join(', ')}.` : '';
  const alvo = Math.max(30, Math.min(5000, Number(length) || 200));
  const bloco = `${base} ${lingua}.${assunto}${kws} `;
  return bloco.repeat(Math.ceil(alvo / Math.max(20, bloco.length))).slice(0, alvo);
}

// ≈ conversão letras→tokens (aprox.)
const lettersToTokens = (n) => Math.max(50, Math.ceil(Number(n || 200) / 4));

// ====== IA (OpenAI) ======
const useAI = !!process.env.OPENAI_API_KEY;
let openaiClient = null;
if (useAI) {
  try {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('IA: OpenAI habilitada');
  } catch (e) {
    console.warn('IA: pacote openai indisponível, usando fallback local.', e?.message);
  }
}

async function gerarTextoIA({ language = 'pt', length = 200, tone = 'casual', topic = '', keywords = '', temperature = 0.8 }) {
  if (!openaiClient) throw new Error('IA indisponível');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const langName = language === 'en' ? 'English' : language === 'es' ? 'Spanish' : 'Portuguese';
  const toneName = tone === 'professional' ? 'professional' : 'casual';
  const kw = String(keywords || '').split(',').map(s=>s.trim()).filter(Boolean).slice(0,8);
  const max_tokens = lettersToTokens(length) + 60;
  const temp = Math.max(0, Math.min(1, Number(temperature) || 0.8));

  const prompt = `
Write a ${toneName} plain-text piece in ${langName}.
Target length: around ${length} characters (do not exceed much).
Topic: ${topic || 'generic demonstration'}.
Keywords: ${kw.length ? kw.join(', ') : 'none'}.
No markdown, no lists unless necessary. Keep it coherent and natural.
`.trim();

  const resp = await openaiClient.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'You are a writing assistant that follows size, language, and tone constraints strictly. Return only plain text.' },
      { role: 'user', content: prompt }
    ],
    max_tokens,
    temperature: temp,
  });

  const content = resp?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Resposta vazia da IA');
  return content.length > length ? content.slice(0, length) : content;
}

// ====== rotas ======
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'filegen-backend',
    endpoints: ['GET /health', 'POST /api/generate'],
    ai: useAI ? 'openai' : 'disabled'
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), ai: useAI });
});

app.post('/api/generate', async (req, res, next) => {
  try {
    const {
      language = 'pt',
      length = 200,
      tone = 'casual',
      format = 'txt',
      filename,
      topic = '',
      keywords = '',
      temperature = 0.8,
    } = req.body || {};

    // texto: IA (se habilitada) -> fallback local
    let text;
    try {
      text = useAI
        ? await gerarTextoIA({ language, length, tone, topic, keywords, temperature })
        : gerarTextoLocal({ language, length, tone, topic, keywords });
    } catch (err) {
      console.warn('IA falhou, usando fallback local:', err?.message || err);
      text = gerarTextoLocal({ language, length, tone, topic, keywords });
    }

    const safeName = String(filename || (format === 'pdf' ? 'arquivo.pdf' : 'arquivo.txt')).replace(/[^\w.\-]/g, '_');

    if (format === 'pdf') {
      // PDF em memória
      const chunks = [];
      const doc = new PDFDocument({ margin: 40 });
      doc.on('data', c => chunks.push(c));
      doc.on('error', err => next(err));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'arquivo.pdf'}"`);
        return res.status(200).send(pdfBuffer);
      });
      doc.fontSize(16).text('Arquivo Gerado', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(text, { align: 'left' });
      doc.end();
      return;
    }

    // TXT
    const buffer = Buffer.from(text, 'utf-8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'arquivo.txt'}"`);
    return res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
});

// handler global
app.use((err, _req, res, _next) => {
  console.error('GLOBAL ERROR:', err);
  if (!res.headersSent) res.status(500).json({ error: 'Erro interno', detail: String(err?.message || err) });
});

// start
app.listen(PORT, () => {
  console.log(`API ouvindo em http://localhost:${PORT}`);
});

