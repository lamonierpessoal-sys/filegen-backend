// server.js — versão mínima e estável (dev)

const express = require('express');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 8080;

// CORS: libera tudo (para DEV). Depois a gente restringe.
app.use(cors());
app.options('*', cors());

// Logs + JSON
app.use(morgan('tiny'));
app.use(express.json({ limit: '1mb' }));

// Rota raiz só para não ver 404 no Render
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'filegen-backend', endpoints: ['GET /health', 'POST /api/generate'] });
});

// Health
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Util: gera texto de tamanho aproximado
function gerarTexto({ language = 'pt', length = 200, tone = 'casual' }) {
  const lingua = { pt: 'em Português', en: 'in English', es: 'en Español' }[language] || 'em Português';
  const base = tone === 'professional' ? 'Conteúdo profissional' : 'Conteúdo casual';
  const alvo = Math.max(30, Math.min(5000, Number(length) || 200));
  const texto = (base + ' ' + lingua + '. ').repeat(Math.ceil(alvo / 30));
  return texto.slice(0, alvo);
}

// Geração (TXT/PDF) — PDF em buffer (sem stream direto)
app.post('/api/generate', (req, res, next) => {
  try {
    const { language = 'pt', length = 200, tone = 'casual', format = 'txt', filename } = req.body || {};
    const text = gerarTexto({ language, length, tone });
    const safeName = String(filename || (format === 'pdf' ? 'arquivo.pdf' : 'arquivo.txt')).replace(/[^\w.\-]/g, '_');

    if (format === 'pdf') {
      const chunks = [];
      const doc = new PDFDocument({ margin: 40 });
      doc.on('data', (c) => chunks.push(c));
      doc.on('error', (err) => next(err));
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
      return; // aguardar 'end'
    }

    // TXT
    const buffer = Buffer.from(text, 'utf-8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'arquivo.txt'}"`);
    return res.status(200).send(buffer);
  } catch (err) {
    return next(err);
  }
});

// Handler global de erros
app.use((err, _req, res, _next) => {
  console.error('GLOBAL ERROR:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Erro interno', detail: String(err?.message || err) });
});

app.listen(PORT, () => {
  console.log(`API ouvindo em http://localhost:${PORT}`);
});
