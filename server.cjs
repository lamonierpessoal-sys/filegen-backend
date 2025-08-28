// server.cjs — Express + IA (OpenAI) + Blog SEO estruturado (H1/H2/H3, bold, Dicas, FAQ) + 8+ keywords + fallback local
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

/* =============== SEO: keywords secundárias =============== */
function localSecondaryKeywords({ primaryKeyword, topic, min=8 }) {
  const base = ensureArrayFromCsv(primaryKeyword).concat(
    ensureArrayFromCsv(topic),
    ['apresentação', 'benefícios', 'estratégias', 'práticas recomendadas', 'otimização', 'tendências', 'métricas', 'exemplos']
  ).filter(Boolean);
  const out = [];
  let i = 0;
  while (out.length < min) out.push((base[i++] || `palavra-chave-extra-${i}`).toString());
  return out;
}

async function generateSecondaryKeywords({ language='pt', targetCountry='Brasil', topic='', primaryKeyword='', min=8, aiModel }) {
  if (openaiClient) {
    try {
      // modelos conforme UI
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
  return localSecondaryKeywords({ primaryKeyword, topic, min });
}

/* =============== geração de conteúdo =============== */
function localBlogMarkdown({
  language='pt', targetCountry='Brasil', style='informativo', tone='casual', pov='first',
  topic='', primaryKeyword='', secondaryList=[], words=800
}) {
  const H1 = `# ${topic || primaryKeyword || 'Título do Artigo (SEO)'}`;
  const meta = primaryKeyword ? `> **Palavra-chave principal:** ${primaryKeyword}` : '';
  const intro = `**Introdução** — contexto em **${targetCountry}**, idioma **${language}**, estilo **${style}**, tom **${tone}**, ponto de vista **${pov}**.`;

  const corpo = [
    '## Visão Geral',
    '### Contexto',
    'Texto introdutório com **termos importantes** e ligação ao problema do leitor.',
    '### Benefícios',
    'Lista de vantagens e valor para o público-alvo com **ganhos concretos**.',
    '## Como Fazer (Passo a Passo)',
    '### Passo 1',
    'Instruções claras, com **palavras-chave** relacionadas de forma natural.',
    '### Passo 2',
    'Mais instruções com foco em **resultado** e **clareza**.',
    '## Erros Comuns',
    '**Evite** armadilhas e explique o porquê, sempre com alternativas.'
  ].join('\n\n');

  const secaoKeywords = [
    '## Palavras-chave Secundárias',
    ...secondaryList.map(k => `**${k}** — Parágrafo otimizado para SEO, denso em informação, natural e sem repetição.`)
  ].join('\n\n');

  const dicas = [
    '## Dicas',
    '- **Estruture** o conteúdo com subtítulos descritivos.',
    '- **Varie** o vocabulário e evite repetição.',
    '- **Inclua** exemplos e casos práticos.',
    '- **Use** ligações internas e externas relevantes.',
  ].join('\n');

  const faq = [
    '## FAQ',
    '### 1) Qual é o objetivo principal?',
    'Responder em **linguagem clara** e objetiva.',
    '### 2) Como medir resultados?',
    'Aponte **métricas** e ferramentas.',
    '### 3) Quais os erros comuns?',
    '**Liste** problemas e **soluções**.',
    '### 4) Como aprofundar?',
    'Sugira **leituras** e próximos **passos**.',
  ].join('\n\n');

  const all = [H1, meta, '', intro, '', corpo, '', secaoKeywords, '', dicas, '', '## Conclusão', 'Resumo final com **call to action**.', '', faq].join('\n');
  const tokens = all.split(/\s+/);
  if (tokens.length <= words) return all;
  return tokens.slice(0, words).join(' ');
}

async function gerarConteudo({
  language='pt', targetCountry='Brasil', words=800,
  style='informativo', tone='casual', pov='first',
  contentType='blog', topic='', primaryKeyword='', secondaryKeywords=[],
  temperature=0.8, format='md', aiModel
}) {
  const minSec = 8;
  const secListIn = Array.isArray(secondaryKeywords) ? secondaryKeywords : ensureArrayFromCsv(secondaryKeywords);
  const finalSec = secListIn.length >= minSec
    ? secListIn
    : await generateSecondaryKeywords({ language, targetCountry, topic, primaryKeyword, min: minSec, aiModel });

  // CSV: SecondaryKeyword,Paragraph
  if (format === 'csv' || contentType === 'planilha') {
    // IA -> CSV
    if (openaiClient) {
      try {
        const model = aiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini';
        const prompt = `
Create SEO paragraphs for each secondary keyword below.
- One paragraph per secondary keyword, and each paragraph MUST START with the keyword in **bold**.
- Use natural density (no stuffing), varied vocabulary, no repetition.
- Balanced length (target ≈ ${words} words total).
Return ONLY CSV with header: SecondaryKeyword,Paragraph (no code fences).

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
      } catch (e) { console.warn('IA (CSV) falhou:', e?.message); }
    }
    // Fallback CSV local
    const rows = [['SecondaryKeyword','Paragraph']];
    for (const k of finalSec) rows.push([k, `**${k}** — Parágrafo otimizado para SEO, natural e sem repetição.`]);
    return rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
  }

  // Blog/MD/TXT/PDF
  if (openaiClient && (contentType === 'blog' || format === 'md' || format === 'pdf' || format === 'txt')) {
    try {
      const model = aiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const ln = langName(language);
      const pv = pov === 'first' ? 'first-person' : pov === 'second' ? 'second-person' : 'third-person';
      const isMD = format === 'md' || contentType === 'blog';

      const prompt = `
Write a **blog post** in ${ln} for ${targetCountry}, style ${style}, tone ${tone}, POV ${pv}.
Structure strictly as Markdown with:
- H1 title including the primary keyword
- H2/H3 hierarchy (Overview/Context/Benefits, How-To with steps, Common Mistakes)
- A section "Palavras-chave Secundárias" where EACH paragraph starts with the secondary keyword in **bold**
- A section "Dicas" (bulleted list) with bolded important terms
- A section "FAQ" with 4–6 Q&As (H3 questions), concise answers
- Conclusion with CTA
Rules:
- Use **bold** for important terms naturally
- Avoid repetition/boilerplate, varied vocabulary
- Target ≈ ${words} words (±10%)
- Return ONLY Markdown (no code fences)

Primary keyword: ${primaryKeyword || '(none)'}
Topic: ${topic || '(none)'}
Secondary keywords (MIN 8, one paragraph EACH in the secondary section):
${finalSec.map(k => `- ${k}`).join('\n')}
`.trim();

      const r = await openaiClient.chat.completions.create({
        model,
        max_tokens: wordsToTokens(words) + 300,
        temperature,
        top_p: 0.9,
        presence_penalty: 0.4,
        frequency_penalty: 0.9,
        messages: [
          { role: 'system', content: 'You generate coherent SEO blog posts. Follow structure strictly; avoid repetition; use bold for emphasis.' },
          { role: 'user', content: prompt }
        ]
      });
      const txt = r?.choices?.[0]?.message?.content?.trim() || '';
      if (txt) return txt;
    } catch (e) { console.warn('IA (blog) falhou:', e?.message); }
  }

  // Fallback local (Markdown)
  return localBlogMarkdown({
    language, targetCountry, style, tone, pov, topic, primaryKeyword,
    secondaryList: finalSec, words
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
      contentType='blog', // blog padrão
      format='md',
      filename,
      topic='', primaryKeyword='', secondaryKeywords='',
      temperature=0.8,
      aiModel // gpt-4o | gpt-4o-mini | gpt-4-turbo | gpt-3.5-turbo
    } = req.body || {};

    let content = await gerarConteudo({
      language, targetCountry, words, style, tone, pov,
      contentType, topic, primaryKeyword, secondaryKeywords,
      temperature, format, aiModel
    });

    content = postProcess(content, format);
    const safeName = String(filename || (format === 'md' ? 'artigo.md' : 'arquivo.txt')).replace(/[^\w.\-]/g, '_');

    if (format === 'pdf') {
      const chunks = [];
      const doc = new PDFDocument({ margin: 40 });
      doc.on('data', c => chunks.push(c));
      doc.on('error', err => next(err));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${safeName || 'artigo.pdf'}"`);
        return res.status(200).send(pdfBuffer);
      });
      doc.fontSize(16).text('Artigo (Blog Post)', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(content, { align: 'left' });
      doc.end();
      return;
    }

    if (format === 'md') {
      const cleaned = String(content).replace(/```(?:markdown)?\s*|\s*```/gi, '');
      const buf = Buffer.from(cleaned, 'utf-8');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'artigo.md'}"`);
      return res.status(200).send(buf);
    }

    if (format === 'csv' || contentType === 'planilha') {
      const cleaned = extractCsvFromMarkdown(content);
      const buf = toCsvUtf8Bom(cleaned);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'planilha.csv'}"`);
      return res.status(200).send(buf);
    }

    const buffer = Buffer.from(content, 'utf-8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'artigo.txt'}"`);
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
