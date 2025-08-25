const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 8080;

// --- middlewares ---
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// CORS (em produção, preencha ALLOWED_ORIGINS com as URLs do seu Replit)
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowed.length === 0) return cb(null, true); // dev libera tudo
    return allowed.includes(origin) ? cb(null, true) : cb(new Error('CORS: origem não permitida'));
  }
}));

app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

function gerarTexto({ language = 'pt', length = 200, tone = 'casual' }) {
  const lingua = { pt: 'em Português', en: 'in English', es: 'en Español' }[language] || 'em Português';
  const base = tone === 'professional' ? 'Conteúdo profissional' : 'Conteúdo casual';
  const alvo = Math.max(30, Math.min(5000, Number(length) || 200));
  const texto = (base + ' ' + lingua + '. ').repeat(Math.ceil(alvo / 30));
  return texto.slice(0, alvo);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.post('/api/generate', async (req, res) => {
  try {
    const { language = 'pt', length = 200, tone = 'casual', format = 'txt' } = req.body || {};
    const text = gerarTexto({ language, length, tone });

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="arquivo.pdf"');
      const doc = new PDFDocument({ margin: 40 });
      doc.pipe(res);
      doc.fontSize(16).text('Arquivo Gerado', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(text, { align: 'left' });
      doc.end();
      return;
    }

    const buffer = Buffer.from(text, 'utf-8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="arquivo.txt"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha ao gerar arquivo' });
  }
});

app.listen(PORT, () => {
  console.log(`API ouvindo em http://localhost:${PORT}`);
});