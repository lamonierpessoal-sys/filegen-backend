// server.js — estável (Express 4) com CORS por whitelist e PDF em buffer

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 8080;

// ============ CORS (preflight + whitelist sem lançar erro) ============
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Preflight universal (evita bloqueio no OPTIONS)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Se tiver lista, ecoa a origem se estiver na lista; senão usa '*'
  if (!allowed.length) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// cors() com whitelist que NÃO lança erro (true/false)
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);           // curl/server-to-server
    if (!allowed.length) return cb(null, true);   // se lista vazia, libera em dev
    return cb(null, allowed.includes(origin));    // true permite; false bloqueia (sem throw)
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));

// ============ middlewares comuns ============
app.use(helmet({ crossOriginResourcePolicy: false })); // permite download do PDF
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));
app.use(rateLimit({ windowMs: 60_000, max: 60 }));     // 60 req/min por IP

// ============ util ============
function gerarTexto({ language = 'pt', length = 200, tone = 'casual' }) {
  const lingua = { pt: 'em Português', en: 'in English', es: 'en Español' }[language] || 'em Português';
  const base = tone === 'professional' ? 'Conteúdo profissional' : 'Conteúdo casual';
  const alvo = Math.max(30, Math.min(5000, Number(length) || 200));
  const texto = (base + ' ' + lingua + '. ').repeat(Math.ceil(alvo / 30));
  return texto.slice(0, alvo);
}

// ============ rotas ============
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'filegen-backend', endpoints: ['GET /health', 'POST /api/generate'] });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.post('/api/generate', (req, res, next) => {
  try {
    const { language = 'pt', length = 200, tone = 'casual', format = 'txt', filename } = req.body || {};
    const text = gerarTexto({ language, length, tone });
    const safeName = String(filename || (format === 'pdf' ? 'arquivo.pdf' : 'arquivo.txt')).replace(/[^\w.\-]/g, '_');

    if (format === 'pdf') {
      // Gera PDF em memória (buffer) para evitar erros de stream
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
      return; // aguarda 'end'
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

// handler global de erros
app.use((err, _req, res, _next) => {
  console.error('GLOBAL ERROR:', err);
  if (!res.headersSent) res.status(500).json({ error: 'Erro interno', detail: String(err?.message || err) });
});

// start
app.listen(PORT, () => {
  console.log(`API ouvindo em http://localhost:${PORT}`);
});
