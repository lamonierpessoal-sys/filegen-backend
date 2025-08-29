// server.cjs — Express + IA (OpenAI) + Blog SEO estruturado + CORS + FALLBACK local com conteúdo real
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CORS ================= */
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const okSuffixes = ['.repl.co', '.replit.app', '.replit.dev', '.worf.replit.dev'];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!allowed.length) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else {
    try {
      const host = new URL(origin || '', 'http://x').hostname;
      if ((origin && allowed.includes(origin)) || okSuffixes.some(s => host.endsWith(s))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
    } catch {}
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
    try {
      const host = new URL(origin).hostname;
      if (allowed.includes(origin) || okSuffixes.some(s => host.endsWith(s))) return cb(null, true);
    } catch {}
    return cb(null, false);
  },
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  optionsSuccessStatus: 204,
}));

/* ================= middlewares ================= */
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

/* ================= helpers ================= */
function wordsToTokens(n){ return Math.max(64, Math.ceil(Number(n||800)*1.4)); }
function extractCsvFromMarkdown(s){ const m=String(s||'').match(/```(?:csv)?\s*([\s\S]*?)```/i); return (m?m[1]:s||'').trim(); }
function toCsvUtf8Bom(s){ return Buffer.from('\uFEFF' + String(s).replace(/\r?\n/g, '\r\n'),'utf8'); }
function normalizeSpaces(s){ return String(s).replace(/[ \t]+/g,' ').replace(/\s+\n/g,'\n').trim(); }
function dedupeSentences(s){
  const parts = String(s).match(/[^.!?…]+[.!?…]?/g) || [];
  const seen = new Set(), out=[];
  for (let seg of parts){
    const key = seg.replace(/\s+/g,' ').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(seg.trim());
  }
  return out.join(' ');
}
function postProcess(content, format){
  if (format==='csv') return content;
  let t = String(content||'');
  t = t.replace(/```[\s\S]*?```/g, m => m.includes('csv') ? m : '');
  t = t.replace(/\b(\w+)(\s+\1){1,}\b/gi, '$1');
  t = dedupeSentences(t);
  t = normalizeSpaces(t);
  return t;
}
function langName(code){
  const map={pt:'Portuguese',en:'English',es:'Spanish',fr:'French',de:'German',it:'Italian',ja:'Japanese',ko:'Korean',zh:'Chinese',hi:'Hindi',ar:'Arabic'};
  return map[code] || 'Portuguese';
}
function ensureArrayFromCsv(s){ return String(s||'').split(',').map(x=>x.trim()).filter(Boolean); }

/* ================= IA opcional ================= */
const useAI = !!process.env.OPENAI_API_KEY;
let openaiClient = null;
if (useAI) {
  try {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('IA: OpenAI habilitada');
  } catch(e){ console.warn('IA: pacote openai indisponível, usando fallback local.', e?.message); }
}

/* ================= secundárias ================= */
function localSecondaryKeywords({ primaryKeyword, topic, min=8 }){
  const base = ensureArrayFromCsv(primaryKeyword).concat(
    ensureArrayFromCsv(topic),
    ['apresentação','benefícios','estratégias','práticas recomendadas','otimização','tendências','métricas','exemplos']
  ).filter(Boolean);
  const out=[]; let i=0;
  while(out.length<min) out.push((base[i++]||`palavra-chave-extra-${i}`).toString());
  return out;
}
async function generateSecondaryKeywords({ language='pt', targetCountry='Brasil', topic='', primaryKeyword='', min=8, aiModel }){
  if (openaiClient){
    try{
      const selected=(aiModel||'').toLowerCase();
      const map={ 'gpt-4o':'gpt-4o','gpt-4o-mini':'gpt-4o-mini','gpt-4-turbo':'gpt-4.1-mini','gpt-3.5-turbo':'gpt-4o-mini' };
      const model = map[selected] || process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const r = await openaiClient.chat.completions.create({
        model, max_tokens:300, temperature:0.7,
        messages:[
          {role:'system',content:'Return only a comma-separated list of SEO secondary keywords. No numbering. No extra text.'},
          {role:'user',content:
`Language: ${langName(language)}; Country target: ${targetCountry}.
Topic: ${topic || '(none)'}
Primary keyword: ${primaryKeyword || '(none)'}
Return at least ${min} related SEO secondary keywords, comma-separated.`}
        ]
      });
      const arr = ensureArrayFromCsv(r?.choices?.[0]?.message?.content || '');
      if (arr.length>=min) return arr;
    }catch(e){ console.warn('IA (keywords) falhou:', e?.message); }
  }
  return localSecondaryKeywords({ primaryKeyword, topic, min });
}

/* ============== FALLBACK LOCAL COM CONTEÚDO REAL ============== */
function makeSentenceBank({topic, primaryKeyword, targetCountry}){
  const subject = primaryKeyword || topic || 'o tema';
  return [
    `Em ${targetCountry}, **${subject}** ganhou relevância por combinar praticidade com resultados tangíveis.`,
    `Consumidores avaliam soluções de ${subject} com base em confiança, custo total e clareza de benefícios.`,
    `Marcas que comunicam valor com transparência e métricas concretas conquistam vantagem competitiva.`,
    `A adoção eficiente depende de um plano simples, metas mensuráveis e revisão contínua do desempenho.`,
    `Ao integrar dados e feedbacks, é possível evoluir rapidamente sem perder o foco no usuário.`,
    `Boas práticas transformam promessas em entregas e reduzem atritos na experiência.`,
    `Com o cenário dinâmico, atualizar processos garante consistência e escalabilidade.`,
    `Indicadores como taxa de conversão, retenção e satisfação mostram onde otimizar primeiro.`
  ];
}
function paragraphFrom(bank, minWords=55){
  let text='', i=0;
  while(text.split(/\s+/).length < minWords){
    text += (i? ' ' : '') + bank[i%bank.length];
    i++;
  }
  return text;
}
function paragraphForKeyword(keyword, extras){
  const p = [
    `**${keyword}** destaca-se quando alinhada às expectativas do público e à proposta de valor.`,
    `Para consolidar ${keyword}, combine clareza, utilidade e uma jornada livre de fricções.`,
    `Resultados consistentes surgem de testes rápidos, análise de dados e ajustes iterativos.`,
    `Mensurar ${keyword} com métricas relevantes sustenta decisões e priorizações.`,
    `Use exemplos do contexto local para tornar ${keyword} mais concreto e aplicável.`,
  ];
  return paragraphFrom(p.concat(extras), 60);
}
function sectionHowTo(bank){
  const passos = [
    ['Mapeie objetivos e público-alvo', 'Defina metas claras, personas e expectativas de valor. Conecte indicadores a resultados de negócio.'],
    ['Crie uma proposta simples', 'Explique benefícios em linguagem direta. Remova jargões e destaque diferenciais.'],
    ['Implemente em ciclos curtos', 'Teste hipóteses, colete feedback e aprimore; velocidade com qualidade.'],
    ['Padronize e documente', 'Guarde aprendizados, crie checklists e reduza variabilidade entre equipes.'],
  ];
  return passos.map(([t,desc]) => `### ${t}\n${desc} ${paragraphFrom(bank, 45)}`).join('\n\n');
}
function sectionMistakes(bank){
  const erros = [
    ['Promessas vagas', 'Metas sem indicadores claros produzem frustração e desperdício.'],
    ['Excesso de complexidade', 'Processos pesados afastam usuários e elevam custos.'],
    ['Ignorar contexto', 'Copiar soluções sem adaptar ao público e ao país alvo compromete resultados.'],
    ['Falta de acompanhamento', 'Sem revisão regular, problemas se acumulam e as vitórias não se repetem.'],
  ];
  return erros.map(([t,desc]) => `- **${t}:** ${desc}`).join('\n');
}
function localBlogMarkdown({
  language='pt', targetCountry='Brasil', style='informativo', tone='professional', pov='first',
  topic='', primaryKeyword='', secondaryList=[], words=1000
}) {
  const title = topic || primaryKeyword || 'Guia prático e completo';
  const bank = makeSentenceBank({topic, primaryKeyword, targetCountry});

  const povTxt = pov==='first' ? 'eu/nós' : pov==='second' ? 'você' : 'o leitor';
  const intro = paragraphFrom([
    `Este guia apresenta uma visão prática de **${title}** com foco no contexto de ${targetCountry}.`,
    `Adotamos um estilo **${style}** e tom **${tone}**, priorizando clareza e utilidade para ${povTxt}.`,
    `Você encontrará benefícios, passos acionáveis, erros comuns e um plano simples para evoluir continuamente.`
  ].concat(bank), 80);

  const overview = [
    '## Visão Geral',
    paragraphFrom(bank, 90),
    '### Benefícios',
    paragraphFrom(bank, 80)
  ].join('\n\n');

  const howto = `## Como Fazer (Passo a Passo)\n\n${sectionHowTo(bank)}`;

  const mistakes = `## Erros Comuns\n\n${sectionMistakes(bank)}`;

  const secSection = [
    '## Palavras-chave Secundárias',
    ...secondaryList.map(k => paragraphForKeyword(k, bank))
  ].join('\n\n');

  const dicas = [
    '## Dicas',
    '- **Estruture** títulos descritivos e conecte cada seção a um objetivo.',
    '- **Varie** o vocabulário; evite repetição e enchimentos.',
    '- **Exemplifique** com dados, cenários e resultados mensuráveis.',
    '- **Otimize** continuamente com testes e feedback do público.',
  ].join('\n');

  const faq = [
    '## FAQ',
    '### Como medir resultados de forma prática?',
    'Acompanhe poucas métricas ligadas ao objetivo (ex.: conversão, retenção, custo por aquisição). Revise semanalmente.',
    '### Qual o primeiro passo para começar com segurança?',
    'Defina um piloto pequeno, metas claras e critérios de sucesso antes de escalar.',
    '### O que diferencia iniciativas de alto impacto?',
    'Clareza de proposta, foco no usuário e iteração rápida com aprendizado documentado.',
    '### Como adaptar ao contexto local?',
    `Considere hábitos, canais preferidos e barreiras culturais do público em ${targetCountry}.`
  ].join('\n\n');

  const conclusion = [
    '## Conclusão',
    paragraphFrom([
      `Com objetivos claros, métricas simples e ciclos curtos, **${title}** deixa de ser promessa e vira resultado.`,
      'Aplique as práticas deste guia, revise semanalmente e compartilhe aprendizados para multiplicar ganhos.'
    ].concat(bank), 70)
  ].join('\n');

  // Junta tudo e corta para o alvo aproximado de palavras
  const doc = [`# ${title}`, '', intro, '', overview, '', howto, '', mistakes, '', secSection, '', dicas, '', faq, '', conclusion].join('\n');
  const tokens = doc.split(/\s+/);
  if (tokens.length <= words) return doc;
  return tokens.slice(0, words).join(' ');
}

/* ================= geração principal ================= */
async function gerarConteudo({
  language='pt', targetCountry='Brasil', words=1000,
  style='informativo', tone='professional', pov='first',
  contentType='blog', topic='', primaryKeyword='', secondaryKeywords=[],
  temperature=0.8, format='md', aiModel
}){
  const minSec = 8;
  const secIn = Array.isArray(secondaryKeywords) ? secondaryKeywords : ensureArrayFromCsv(secondaryKeywords);
  const finalSec = secIn.length>=minSec ? secIn : await generateSecondaryKeywords({ language, targetCountry, topic, primaryKeyword, min:minSec, aiModel });

  // CSV (planilha)
  if (format==='csv' || contentType==='planilha'){
    const rows = [['SecondaryKeyword','Paragraph']];
    for (const k of finalSec) rows.push([k, paragraphForKeyword(k, makeSentenceBank({topic, primaryKeyword, targetCountry}))]);
    return rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
  }

  // Tenta IA
  if (openaiClient){
    try{
      const selected=(aiModel||'').toLowerCase();
      const map={ 'gpt-4o':'gpt-4o','gpt-4o-mini':'gpt-4o-mini','gpt-4-turbo':'gpt-4.1-mini','gpt-3.5-turbo':'gpt-4o-mini' };
      const model = map[selected] || process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const ln = langName(language);
      const pv = pov==='first'?'first-person':pov==='second'?'second-person':'third-person';
      const prompt = `
Write a full **blog post** in ${ln} for ${targetCountry}, style ${style}, tone ${tone}, POV ${pv}.
Structure in Markdown with: Overview/Context/Benefits; How-To (steps); Common Mistakes; a section "Palavras-chave Secundárias" with ONE paragraph per keyword (start each paragraph with the keyword in **bold**); "Dicas" (bulleted); "FAQ"; and Conclusion with CTA.
Rules: rich and specific content (no generic instructions), varied vocabulary, avoid repetition, ~${words} words, return ONLY Markdown (no code fences).
Primary keyword: ${primaryKeyword || '(none)'}
Topic: ${topic || '(none)'}
Secondary keywords (at least ${minSec}):
${finalSec.map(k=>`- ${k}`).join('\n')}
`.trim();

      const r = await openaiClient.chat.completions.create({
        model, max_tokens: wordsToTokens(words)+300, temperature,
        top_p: 0.9, presence_penalty: 0.4, frequency_penalty: 0.9,
        messages:[
          {role:'system', content:'You produce complete, actionable articles. Never describe the structure; write the content itself.'},
          {role:'user', content: prompt}
        ]
      });
      const txt = r?.choices?.[0]?.message?.content?.trim();
      if (txt) return txt;
    }catch(e){ console.warn('IA (blog) falhou:', e?.message); }
  }

  // Fallback local com conteúdo real
  return localBlogMarkdown({
    language, targetCountry, style, tone, pov, topic, primaryKeyword,
    secondaryList: finalSec, words
  });
}

/* ================= rotas ================= */
app.get('/health', (_req, res) => {
  res.json({ ok:true, uptime:process.uptime(), ai: !!openaiClient });
});

app.post('/api/generate', async (req, res, next) => {
  try{
    const {
      language='pt', targetCountry='Brasil', words=1000,
      style='informativo', tone='professional', pov='first',
      contentType='blog', format='md',
      filename, topic='', primaryKeyword='', secondaryKeywords='',
      temperature=0.8, aiModel
    } = req.body || {};

    let content = await gerarConteudo({
      language, targetCountry, words, style, tone, pov,
      contentType, topic, primaryKeyword, secondaryKeywords, temperature, format, aiModel
    });

    content = postProcess(content, format);
    const safeName = String(filename || (format==='md'?'artigo.md':'arquivo.txt')).replace(/[^\w.\-]/g,'_');

    if (format==='pdf'){
      const chunks=[]; const doc=new PDFDocument({ margin:40 });
      doc.on('data', c=>chunks.push(c));
      doc.on('error', err=>next(err));
      doc.on('end', ()=>{
        const pdfBuffer = Buffer.concat(chunks);
        res.setHeader('Content-Type','application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${safeName||'artigo.pdf'}"`);
        res.status(200).send(pdfBuffer);
      });
      doc.fontSize(16).text('Artigo (Blog Post)', { align:'center' });
      doc.moveDown();
      doc.fontSize(12).text(content, { align:'left' });
      doc.end();
      return;
    }

    if (format==='md'){
      const cleaned = String(content).replace(/```(?:markdown)?\s*|\s*```/gi,'');
      const buf = Buffer.from(cleaned,'utf-8');
      res.setHeader('Content-Type','text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName||'artigo.md'}"`);
      return res.status(200).send(buf);
    }

    if (format==='csv' || contentType==='planilha'){
      const cleaned = extractCsvFromMarkdown(content);
      const buf = toCsvUtf8Bom(cleaned);
      res.setHeader('Content-Type','text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName||'planilha.csv'}"`);
      return res.status(200).send(buf);
    }

    const buffer = Buffer.from(content,'utf-8');
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName||'artigo.txt'}"`);
    return res.status(200).send(buffer);
  }catch(err){ next(err); }
});

app.use((err,_req,res,_next)=>{
  console.error('GLOBAL ERROR:', err);
  if (!res.headersSent) res.status(500).json({ error:'Erro interno', detail:String(err?.message||err) });
});

app.listen(PORT, ()=> console.log(`API ouvindo em http://localhost:${PORT}`));
