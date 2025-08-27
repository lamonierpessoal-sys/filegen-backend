// server.cjs — Express + IA (OpenAI opcional) + CORS whitelist + PDF/MD/CSV/TXT
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 8080;

/* ===================== CORS ===================== */
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
    return cb(null, allowed.includes(origin));
  },
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  optionsSuccessStatus: 204,
}));

/* ================= middlewares ================== */
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

/* =================== helpers ==================== */
// tokens ≈ palavras * 1.4 (aprox)
function wordsToTokens(n) { return Math.max(64, Math.ceil(Number(n || 800) * 1.4)); }

// CSV helpers
function extractCsvFromMarkdown(s) {
  if (!s) return '';
  const m = String(s).match(/```(?:csv)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : s).trim();
}
function toCsvUtf8Bom(s) {
  const normalized = String(s).replace(/\r?\n/g, '\r\n');
  return Buffer.from('\uFEFF' + normalized, 'utf8');
}

// anti-repetição
function normalizeSpaces(s) {
  return String(s).replace(/[ \t]+/g, ' ').replace(/\s+\n/g, '\n').trim();
}
function dedupeSentences(s) {
  const parts = String(s).match(/[^.!?…]+[.!?…]?/g) || [];
  const seen = new Set(), out = [];
  for (let seg of parts) {
    const key = seg.replace(/\s+/g,' ').trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(seg.trim());
  }
  return out.join(' ');
}
function postProcess(content, format) {
  if (format === 'csv') return content;
  let t = String(content || '');
  t = t.replace(/```[\s\S]*?```/g, m => m.includes('csv') ? m : '');
  t = t.replace(/\b(\w+)(\s+\1){1,}\b/gi, '$1');
  t = dedupeSentences(t);
  t = normalizeSpaces(t);
  return t;
}

function langName(code) {
  const map = {
    pt:'Portuguese', en:'English', es:'Spanish', fr:'French', de:'German',
    it:'Italian', ja:'Japanese', ko:'Korean', zh:'Chinese', hi:'Hindi', ar:'Arabic'
  };
  return map[code] || 'Portuguese';
}

function gerarLocal({ language='pt', targetCountry='Brasil', words=800, style='informativo', tone='casual', pov='first', contentType='plain', topic='', keywords='' }) {
  const lingua = langName(language);
  const pv = pov === 'first' ? 'first-person' : pov === 'second' ? 'second-person' : 'third-person';
  const header = `(${lingua}, target: ${targetCountry}, style: ${style}, tone: ${tone}, ${pv})`;
  const assunto = topic ? ` Topic: ${topic}.` : '';
  const kws = keywords ? ` Keywords: ${keywords}.` : '';

  if (contentType === 'planilha') {
    const rows = [
      ['Titulo','Resumo','PalavrasChave'],
      ['Item 1','Descrição breve 1', keywords || ''],
      ['Item 2','Descrição breve 2', keywords || ''],
      ['Item 3','Descrição breve 3', keywords || ''],
    ];
    return rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
  }

  // gerar por PALAVRAS
  const bag = [
    `High-level overview ${header}.`, 'Key points explained clearly.',
    'Practical examples to illustrate ideas.', 'Actionable recommendations.',
    'Nuanced perspective to avoid repetition.', 'Smooth transitions between sections.'
  ].join(' ');
  const base = `${bag}${assunto}${kws} `;
  const wordsArr = base.split(/\s+/);
  const out = [];
  while (out.length < words) out.push(wordsArr[out.length % wordsArr.length]);
  return postProcess(out.slice(0, words).join(' '), 'txt');
}

/* ================ IA (OpenAI) opcional ================ */
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

async function gerarIA({
  language='pt', targetCountry='Brasil', words=800,
  style='informativo', tone='casual', pov='first',
  contentType='plain', topic='', keywords='', temperature=0.8, format='txt', aiModel
}) {
  if (!openaiClient) throw new Error('IA indisponível');
  const model = aiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const ln = langName(language);
  const pv = pov === 'first' ? 'first-person' : pov === 'second' ? 'second-person' : 'third-person';
  const max_tokens = wordsToTokens(words);
  const temp = Math.max(0, Math.min(1, Number(temperature) || 0.8));

  let userContent = '';
  if (contentType === 'planilha' || format === 'csv') {
    userContent = `
Create a CSV with header: "Titulo,Resumo,PalavrasChave".
Language: ${ln}. Country target: ${targetCountry}. Style: ${style}. Tone: ${tone}. POV: ${pv}.
Topic: ${topic || 'generic'}. Keywords: ${keywords || 'none'}.
Rows: 4–8, concise, no commentary. Return ONLY raw CSV (no code fences).
`.trim();
  } else if (format === 'md' || contentType === 'blog') {
    userContent = `
Write a high-quality Markdown article in ${ln} for ${targetCountry}, style ${style}, tone ${tone}, POV ${pv}.
Topic: ${topic || 'generic'}. Keywords: ${keywords || 'none'}.
- 1 H1 title, 2–4 H2 sections, short paragraphs, varied vocabulary
- No boilerplate, no repeated sentences
Return ONLY Markdown (no code fences). Target ≈ ${words} words (±10%).
`.trim();
  } else if (contentType === 'email') {
    userContent = `
Write a professional email in ${ln} for ${targetCountry}, style ${style}, tone ${tone}, POV ${pv}.
Subject: ${topic || 'Subject'}. Keywords/context: ${keywords || 'none'}.
No boilerplate and no repetition. Return ONLY the email body as plain text.
Target ≈ ${words} words (±10%).
`.trim();
  } else if (contentType === 'resumo') {
    userContent = `
Write a concise summary in ${ln} for ${targetCountry}, style ${style}, tone ${tone}, POV ${pv}.
Topic: ${topic || 'generic'}; Keywords: ${keywords || 'none'}.
No boilerplate or repetition. Return plain text only. Target ≈ ${words} words (±10%).
`.trim();
  } else if (contentType === 'social') {
    userContent = `
Write a short social post in ${ln} for ${targetCountry}, style ${style}, tone ${tone}, POV ${pv}.
Topic: ${topic || 'generic'}; Keywords: ${keywords || 'none'}.
Catchy, varied wording, no repetition. Max ${Math.max(50, Math.min(180, words))} words.
Return plain text only.
`.trim();
  } else {
    userContent = `
Write a high-quality plain text in ${ln} for ${targetCountry}, style ${style}, tone ${tone}, POV ${pv}.
Topic: ${topic || 'generic'}; Keywords: ${keywords || 'none'}.
Varied vocabulary, coherent structure, no boilerplate or repetition.
Return plain text only. Target ≈ ${words} words (±10%).
`.trim();
  }

  const resp = await openaiClient.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'You are a careful writing assistant. Avoid repetition and boilerplate, follow the requested format strictly.' },
      { role: 'user', content: userContent }
    ],
    max_tokens,
    temperature: temp,
    top_p: 0.9,
    presence_penalty: 0.4,
    frequency_penalty: 0.9,
  });

  const content = resp?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Resposta vazia da IA');
  return content;
}

/* ===================== rotas ===================== */
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), ai: !!openaiClient });
});

app.post('/api/generate', async (req, res, next) => {
  try {
    const {
      language='pt', targetCountry='Brasil', words=800,
      style='informativo', tone='casual', pov='first',
      contentType='plain',
      format='txt',
      filename,
      topic='', keywords='', temperature=0.8,
      aiModel
    } = req.body || {};

    // gerar conteúdo (IA se disponível; fallback local)
    let content;
    try {
      content = openaiClient
        ? await gerarIA({ language, targetCountry, words, style, tone, pov, contentType, topic, keywords, temperature, format, aiModel })
        : gerarLocal({ language, targetCountry, words, style, tone, pov, contentType, topic, keywords });
    } catch (e) {
      console.warn('IA falhou, usando local:', e?.message);
      content = gerarLocal({ language, targetCountry, words, style, tone, pov, contentType, topic, keywords });
    }

    content = postProcess(content, format);

    // nome seguro
    const safeName = String(filename || 'arquivo.txt').replace(/[^\w.\-]/g, '_');

    // PDF (inline)
    if (format === 'pdf') {
      const chunks = [];
      const doc = new PDFDocument({ margin: 40 });
      doc.on('data', c => chunks.push(c));
      doc.on('error', err => next(err));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${safeName || 'arquivo.pdf'}"`);
        return res.status(200).send(pdfBuffer);
      });

      doc.fontSize(16).text('Arquivo Gerado', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(content, { align: 'left' });
      doc.end();
      return;
    }

    // Markdown
    if (format === 'md') {
      const cleaned = String(content).replace(/```(?:markdown)?\s*|\s*```/gi, '');
      const buf = Buffer.from(cleaned, 'utf-8');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'arquivo.md'}"`);
      return res.status(200).send(buf);
    }

    // CSV (BOM + CRLF, sem cercas)
    if (format === 'csv') {
      const cleaned = extractCsvFromMarkdown(content);
      const buf = toCsvUtf8Bom(cleaned);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'arquivo.csv'}"`);
      return res.status(200).send(buf);
    }

    // TXT
    const buffer = Buffer.from(content, 'utf-8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'arquivo.txt'}"`);
    return res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error('GLOBAL ERROR:', err);
  if (!res.headersSent) res.status(500).json({ error: 'Erro interno', detail: String(err?.message || err) });
});

app.listen(PORT, () => {
  console.log(`API ouvindo em http://localhost:${PORT}`);
});
