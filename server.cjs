// server.cjs — Express + IA (OpenAI) + SEO avançado + FALLBACK local sólido
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 8080;

/* =============== CORS =============== */
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!allowed.length) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
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

/* =============== middlewares =============== */
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

/* =============== helpers =============== */
function wordsToTokens(n) { return Math.max(64, Math.ceil(Number(n || 800) * 1.4)); }

function extractCsvFromMarkdown(s) {
  if (!s) return '';
  const m = String(s).match(/```(?:csv)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : s).trim();
}
function toCsvUtf8Bom(s) {
  const normalized = String(s).replace(/\r?\n/g, '\r\n');
  return Buffer.from('\uFEFF' + normalized, 'utf8');
}

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
  const map = { pt:'Portuguese', en:'English', es:'Spanish', fr:'French', de:'German', it:'Italian', ja:'Japanese', ko:'Korean', zh:'Chinese', hi:'Hindi', ar:'Arabic' };
  return map[code] || 'Portuguese';
}
function ensureArrayFromCsv(s) {
  return String(s || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

/* =============== IA opcional =============== */
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

/* =============== geração local (fallback) =============== */
function localSecondaryKeywords({ primaryKeyword, topic, min=8 }) {
  const base = ensureArrayFromCsv(primaryKeyword).concat(
    ensureArrayFromCsv(topic),
    ['guia','dicas','estratégias','tendências','vantagens','como fazer','exemplos','melhores práticas','otimização','resultados']
  ).filter(Boolean);
  const out = [];
  let i = 0;
  while (out.length < min) out.push((base[i++] || `palavra-chave-extra-${i}`).toString());
  return out;
}

function localCsvFromKeywords(secList, words) {
  const rows = [['SecondaryKeyword','Paragraph']];
  for (const k of secList) {
    rows.push([k, `${k} — Parágrafo otimizado para SEO, linguagem natural, sem repetição, cobrindo nuances relevantes.`]);
  }
  return rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
}

function localTextFromKeywords({
  language='pt', targetCountry='Brasil', style='informativo', tone='casual', pov='first',
  primaryKeyword='', topic='', secList=[], words=800, isMD=false
}) {
  const ln = langName(language);
  const pv = pov === 'first' ? 'first-person' : pov === 'second' ? 'second-person' : 'third-person';
  const intro = `Introdução — conteúdo SEO em ${ln}, alvo ${targetCountry}, estilo ${style}, tom ${tone}, ${pv}. `
    + (primaryKeyword ? `Palavra-chave principal: ${primaryKeyword}. ` : '')
    + (topic ? `Tema: ${topic}. ` : '');

  const paras = secList.map(k => `${isMD ? '**'+k+'**' : k} — Parágrafo otimizado para SEO em linguagem natural, sem repetição, trazendo variações e contexto relevante.`);
  const base = isMD
    ? [
        `# ${topic || primaryKeyword || 'Título (SEO)'}`,
        primaryKeyword ? `> Meta: ${primaryKeyword}` : '',
        '',
        intro,
        '',
        ...paras
      ].filter(Boolean).join('\n\n')
    : [intro, ...paras].join('\n\n');

  // aproxima a meta de palavras sem repetir frases
  const tokens = base.split(/\s+/);
  if (tokens.length >= words) return tokens.slice(0, words).join(' ');
  const extras = ['Detalhamento adicional.', 'Exemplo prático.', 'Recomendações finais.', 'Observações úteis.'];
  let i = 0;
  while (tokens.length < words) tokens.push(extras[i++ % extras.length].replace(/\.$/, ''));
  return tokens.slice(0, words).join(' ');
}

/* =============== geração com IA + fallback interno =============== */
async function generateSecondaryKeywords({
  language='pt', targetCountry='Brasil', topic='', primaryKeyword='', min=8, aiModel
}) {
  // Tenta IA primeiro
  if (openaiClient) {
    try {
      const model = aiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const resp = await openaiClient.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'Return only a comma-separated list of SEO secondary keywords. No numbering. No extra text.' },
          { role: 'user', content:
`Language: ${langName(language)}; Country target: ${targetCountry}.
Topic: ${topic || '(none)'}
Primary keyword: ${primaryKeyword || '(none)'}
Return at least ${min} related SEO secondary keywords, comma-separated.` }
        ],
        max_tokens: 300,
        temperature: 0.7,
      });
      const text = resp?.choices?.[0]?.message?.content || '';
      const arr = ensureArrayFromCsv(text);
      if (arr.length >= min) return arr.slice(0, Math.max(min, arr.length));
    } catch (e) {
      console.warn('IA (keywords) falhou:', e?.message);
    }
  }
  // Fallback local
  return localSecondaryKeywords({ primaryKeyword, topic, min });
}

async function gerarConteudoSEO({
  language='pt', targetCountry='Brasil', words=800,
  style='informativo', tone='casual', pov='first',
  contentType='plain', topic='', primaryKeyword='', secondaryKeywords=[],
  temperature=0.8, format='txt', aiModel
}) {
  const ln = langName(language);
  const pv = pov === 'first' ? 'first-person' : pov === 'second' ? 'second-person' : 'third-person';
  const minSec = 8;

  // garante 8+ secundárias
  const secListIn = Array.isArray(secondaryKeywords) ? secondaryKeywords : ensureArrayFromCsv(secondaryKeywords);
  const finalSec = secListIn.length >= minSec
    ? secListIn
    : await generateSecondaryKeywords({ language, targetCountry, topic, primaryKeyword, min: minSec, aiModel });

  // CSV (planilha)
  if (format === 'csv' || contentType === 'planilha') {
    if (openaiClient) {
      try {
        const model = aiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini';
        const prompt = `
Create SEO paragraphs for each secondary keyword below.
Language: ${ln}; Country: ${targetCountry}; Style: ${style}; Tone: ${tone}; POV: ${pv}.
Primary keyword: ${primaryKeyword || '(none)'}
Rules:
- One paragraph per secondary keyword, optimized for SEO.
- Start the paragraph with the keyword itself.
- Natural density (no stuffing), varied vocabulary, no repetition.
- Balanced length (target ≈ ${words} words total).
Return ONLY CSV with header: SecondaryKeyword,Paragraph. No code fences.
Secondary keywords:
${finalSec.map(k => `- ${k}`).join('\n')}
`.trim();

        const r = await openaiClient.chat.completions.create({
          model, max_tokens: wordsToTokens(words) + 200, temperature,
          messages: [
            { role: 'system', content: 'You output only CSV when asked for CSV.' },
            { role: 'user', content: prompt }
          ]
        });
        return extractCsvFromMarkdown(r?.choices?.[0]?.message?.content || '');
      } catch (e) {
        console.warn('IA (CSV) falhou:', e?.message);
      }
    }
    // Fallback local
    return localCsvFromKeywords(finalSec, words);
  }

  // MD / TXT / PDF
  const isMD = format === 'md' || contentType === 'blog';
  if (openaiClient) {
    try {
      const model = aiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const prompt = `
Write SEO-optimized content in ${ln} for ${targetCountry}.
Style: ${style}; Tone: ${tone}; POV: ${pv}.
Primary keyword: ${primaryKeyword || '(none)'}
Topic: ${topic || '(none)'}
Secondary keywords (use AT LEAST these, one paragraph EACH, starting with the keyword):
${finalSec.map(k => `- ${k}`).join('\n')}

Rules:
- Start with a short introduction that naturally includes the primary keyword in the first 100 words.
- Then, create EXACTLY one paragraph per secondary keyword, and each paragraph MUST START with that keyword.
- Avoid repetition, keep vocabulary varied, and ensure coherence.
- Optimize headings/structure if Markdown; otherwise just paragraphs separated by blank lines.
- Target ≈ ${words} words overall (±10%).
- Return ONLY ${isMD ? 'Markdown' : 'plain text'} (no code fences).
`.trim();

      const r = await openaiClient.chat.completions.create({
        model,
        max_tokens: wordsToTokens(words) + 256,
        temperature,
        top_p: 0.9,
        presence_penalty: 0.4,
        frequency_penalty: 0.9,
        messages: [
          { role: 'system', content: 'You generate coherent SEO content. Avoid repetition and boilerplate. Follow the structural rules strictly.' },
          { role: 'user', content: prompt }
        ]
      });
      const txt = r?.choices?.[0]?.message?.content?.trim() || '';
      if (txt) return txt;
    } catch (e) {
      console.warn('IA (texto) falhou:', e?.message);
    }
  }

  // Fallback local
  return localTextFromKeywords({
    language, targetCountry, style, tone, pov,
    primaryKeyword, topic, secList: finalSec, words, isMD
  });
}

/* =============== rotas =============== */
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
      topic='', primaryKeyword='', secondaryKeywords='',
      temperature=0.8,
      aiModel
    } = req.body || {};

    // Gera conteúdo com IA + fallback automático
    let content = await gerarConteudoSEO({
      language, targetCountry, words, style, tone, pov,
      contentType, topic, primaryKeyword, secondaryKeywords,
      temperature, format, aiModel
    });

    content = postProcess(content, format);
    const safeName = String(filename || 'arquivo.txt').replace(/[^\w.\-]/g, '_');

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
      doc.fontSize(16).text('Arquivo Gerado (SEO)', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(content, { align: 'left' });
      doc.end();
      return;
    }

    if (format === 'md') {
      const cleaned = String(content).replace(/```(?:markdown)?\s*|\s*```/gi, '');
      const buf = Buffer.from(cleaned, 'utf-8');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'arquivo.md'}"`);
      return res.status(200).send(buf);
    }

    if (format === 'csv' || contentType === 'planilha') {
      const cleaned = extractCsvFromMarkdown(content);
      const buf = toCsvUtf8Bom(cleaned);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'arquivo.csv'}"`);
      return res.status(200).send(buf);
    }

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
