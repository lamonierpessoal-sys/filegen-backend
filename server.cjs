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

// Preflight + cabeçalhos básicos (permissivo em dev)
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

// Middleware cors com verificação de origin
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
function lettersToTokens(n) { return Math.max(50, Math.ceil(Number(n || 200) / 4)); }

function extractCsvFromMarkdown(s) {
  if (!s) return '';
  const m = String(s).match(/```(?:csv)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : s).trim();
}
function toCsvUtf8Bom(s) {
  const normalized = String(s).replace(/\r?\n/g, '\r\n'); // CRLF p/ Excel
  return Buffer.from('\uFEFF' + normalized, 'utf8');      // BOM UTF-8
}

function gerarLocal({ language='pt', length=200, tone='casual', contentType='plain', topic='', keywords='' }) {
  const lingua = { pt: 'em Português', en: 'in English', es: 'en Español' }[language] || 'em Português';
  const alvo = Math.max(30, Math.min(5000, Number(length) || 200));
  const assunto = topic ? `Tema: ${topic}. ` : '';
  const kws = keywords ? `Palavras-chave: ${keywords}. ` : '';
  let out = '';

  if (contentType === 'blog') {
    out = `# Título do Post (${lingua})\n\n## Introdução\n${assunto}${kws}Conteúdo ${tone}.\n\n## Seção\nTexto.\n\n## Conclusão\nEncerramento. `;
  } else if (contentType === 'resumo') {
    out = `Resumo (${lingua}) — ${assunto}${kws}Síntese objetiva em tom ${tone}. `;
  } else if (contentType === 'email') {
    out = `Assunto: ${topic || 'Assunto'}\n\nPrezados,\n\n${kws}Mensagem em tom ${tone}.\n\nAtenciosamente,\nSeu Nome`;
  } else if (contentType === 'social') {
    out = `Post (${lingua}) — ${assunto}${kws}Mensagem curta em tom ${tone}. #hashtag `;
  } else if (contentType === 'planilha') {
    const rows = [
      ['Titulo','Resumo','PalavrasChave'],
      ['Item 1','Descrição breve 1', keywords || ''],
      ['Item 2','Descrição breve 2', keywords || ''],
      ['Item 3','Descrição breve 3', keywords || ''],
    ];
    return rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
  } else {
    out = `Texto (${lingua}). ${assunto}${kws}Conteúdo ${tone}. `;
  }

  while (out.length < alvo) out += 'Conteúdo adicional. ';
  return out.slice(0, alvo);
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

async function gerarIA({ language='pt', length=200, tone='casual', contentType='plain', topic='', keywords='', temperature=0.8, format='txt' }) {
  if (!openaiClient) throw new Error('IA indisponível');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const langName = language === 'en' ? 'English' : language === 'es' ? 'Spanish' : 'Portuguese';
  const toneName = tone === 'professional' ? 'professional' : 'casual';
  const max_tokens = lettersToTokens(length) + 80;
  const temp = Math.max(0, Math.min(1, Number(temperature) || 0.8));

  let userContent = '';
  if (contentType === 'planilha' || format === 'csv') {
    userContent = `
Create a CSV with header: "Titulo,Resumo,PalavrasChave".
Language: ${langName}. Tone: ${toneName}.
Topic: ${topic || 'generic'}.
Keywords: ${keywords || 'none'}.
Rows: 3–6 rows, concise fields. Do not add commentary; return only CSV (no code fences).
Target total length around ${length} characters (approx).
`.trim();
  } else if (format === 'md' || contentType === 'blog') {
    userContent = `
Write a ${toneName} Markdown article in ${langName}.
Topic: ${topic || 'generic'}.
Keywords: ${keywords || 'none'}.
Use an H1 title, 2–3 H2 sections, short paragraphs and (optionally) a bullet list.
Target around ${length} characters. Return only Markdown (no code fences).
`.trim();
  } else if (contentType === 'email') {
    userContent = `
Write a ${toneName} professional email in ${langName}.
Subject: ${topic || 'Subject'}.
Keywords/context: ${keywords || 'none'}.
Target around ${length} characters. Return plain text email body only.
`.trim();
  } else if (contentType === 'resumo') {
    userContent = `
Write a concise summary in ${langName}, ${toneName} tone.
Topic: ${topic || 'generic'}; Keywords: ${keywords || 'none'}.
Target around ${length} characters. Return plain text only.
`.trim();
  } else if (contentType === 'social') {
    userContent = `
Write a short social media post in ${langName}, ${toneName} tone.
Topic: ${topic || 'generic'}; Keywords: ${keywords || 'none'}.
Max ${Math.max(120, Math.min(500, length))} characters. Return plain text only.
`.trim();
  } else {
    userContent = `
Write a ${toneName} plain text in ${langName}.
Topic: ${topic || 'generic'}; Keywords: ${keywords || 'none'}.
Target around ${length} characters. Return plain text only.
`.trim();
  }

  const resp = await openaiClient.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'You are a writing assistant. Return only the requested format (plain text, Markdown, or CSV). Do not wrap the output in code fences.' },
      { role: 'user', content: userContent }
    ],
    max_tokens,
    temperature: temp,
  });

  const content = resp?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Resposta vazia da IA');
  return content.length > length * 2 ? content.slice(0, length * 2) : content;
}

/* ===================== rotas ===================== */
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), ai: !!openaiClient });
});

app.post('/api/generate', async (req, res, next) => {
  try {
    const {
      language='pt', length=200, tone='casual',
      contentType='plain',
      format='txt',
      filename,
      topic='', keywords='', temperature=0.8,
    } = req.body || {};

    // gerar conteúdo (IA se disponível; fallback local)
    let content;
    try {
      content = openaiClient
        ? await gerarIA({ language, length, tone, contentType, topic, keywords, temperature, format })
        : gerarLocal({ language, length, tone, contentType, topic, keywords });
    } catch (e) {
      console.warn('IA falhou, usando local:', e?.message);
      content = gerarLocal({ language, length, tone, contentType, topic, keywords });
    }

    // nome seguro
    const safeName = String(filename || 'arquivo.txt').replace(/[^\w.\-]/g, '_');

    // PDF (inline para pré-visualização no navegador)
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

    // Markdown (.md)
    if (format === 'md') {
      const buf = Buffer.from(String(content).replace(/```(?:markdown)?\s*|\s*```/gi, ''), 'utf-8');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'arquivo.md'}"`);
      return res.status(200).send(buf);
    }

    // CSV (remove cercas ```csv e adiciona BOM + CRLF para Excel)
    if (format === 'csv') {
      const cleaned = extractCsvFromMarkdown(content);
      const buf = toCsvUtf8Bom(cleaned);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'arquivo.csv'}"`);
      return res.status(200).send(buf);
    }

    // TXT (default)
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
