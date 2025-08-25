import { useEffect, useMemo, useState } from 'react';

export default function App() {
  const [language, setLanguage] = useState('pt');
  const [length, setLength] = useState(300);
  const [tone, setTone] = useState('casual');
  const [format, setFormat] = useState('txt');
  const [fileName, setFileName] = useState('arquivo.txt');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [fileUrl, setFileUrl] = useState(null);

  const [topic, setTopic] = useState('');
  const [keywords, setKeywords] = useState('');
  const [temperature, setTemperature] = useState(0.8);
  const [aiOn, setAiOn] = useState(null);

  // preview
  const [previewType, setPreviewType] = useState(null); // 'pdf' | 'txt' | null
  const [previewText, setPreviewText] = useState('');   // conteúdo do .txt para mostrar

  const apiBase = useMemo(() => (import.meta.env.VITE_API_URL || '').replace(/\/+$/,''), []);
  const hasBackend = !!apiBase;

  useEffect(() => {
    if (!apiBase) { setAiOn(false); return; }
    fetch(`${apiBase}/health`).then(r => r.json())
      .then(j => setAiOn(!!j.ai))
      .catch(() => setAiOn(false));
  }, [apiBase]);

  function sanitizeName(name, fmt) {
    const def = fmt === 'pdf' ? 'arquivo.pdf' : 'arquivo.txt';
    const s = String(name || def).replace(/[^\w.\-]/g, '_');
    return s || def;
  }

  function gerarTextoLocal(lang, len, t, top = '', kw = '') {
    const lingua = lang === 'pt' ? 'Português' : lang === 'en' ? 'Inglês' : 'Espanhol';
    const cab = t === 'professional' ? 'Conteúdo profissional' : 'Conteúdo casual';
    const assunto = top ? ` Tema: ${top}.` : '';
    const kws = kw ? ` Palavras-chave: ${kw}.` : '';
    const base = `${cab} (${lingua}).${assunto}${kws} `;
    let out = '';
    while (out.length < len) out += base;
    return out.slice(0, len);
  }

  async function handleGenerate(e) {
    e.preventDefault();
    setLoading(true);
    setStatus('Gerando…');
    if (fileUrl) { URL.revokeObjectURL(fileUrl); setFileUrl(null); }
    setPreviewText('');
    setPreviewType(null);

    const body = JSON.stringify({
      language, length, tone, format,
      filename: sanitizeName(fileName, format),
      topic, keywords, temperature
    });

    const withTimeout = (promise, ms = 20000) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ms);
      return Promise.race([
        promise(ctrl.signal),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms + 50))
      ]).finally(() => clearTimeout(timer));
    };

    try {
      if (!hasBackend) {
        // demo local
        if (format === 'txt') {
          const text = gerarTextoLocal(language, length, tone, topic, keywords);
          const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          setFileUrl(url);
          setPreviewText(text);
          setPreviewType('txt');
          setStatus('TXT local gerado (demo, sem backend).');
        } else {
          setStatus('Pré-visualização PDF local indisponível sem backend.');
        }
        return;
      }

      const resp = await withTimeout(signal => fetch(`${apiBase}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body, signal
      }));
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status} em /api/generate: ${txt.slice(0,200)}`);
      }

      // Para TXT, capturamos também o texto pro preview
      let textForPreview = '';
      if (format === 'txt') {
        try { textForPreview = await resp.clone().text(); } catch {}
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      setFileUrl(url);
      setPreviewType(format === 'pdf' ? 'pdf' : 'txt');
      setPreviewText(textForPreview || '');
      setStatus('Pronto! Visualize ou baixe o arquivo.');
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg.includes('Failed to fetch') || msg.includes('TypeError')) {
        setStatus('Falha de rede/CORS. Confira ALLOWED_ORIGINS no backend e a URL em VITE_API_URL.');
      } else {
        setStatus(msg);
      }
      console.error('GERAR ERRO:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!fileUrl) return;
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = sanitizeName(fileName, format);
    a.click();
  }

  function handlePreview() {
    if (!fileUrl) return;
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  }

  function handleDelete() {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFileUrl(null);
    setPreviewText('');
    setPreviewType(null);
    setStatus('Arquivo descartado no navegador.');
  }

  return (
    <div className="page">
      <header className="header">
        <h1>Gerador de Arquivos</h1>
        <span className="api-pill">
          API: {apiBase || '(sem VITE_API_URL)'} • IA: {aiOn === null ? '...' : aiOn ? 'ON' : 'OFF'}
        </span>
      </header>

      {!hasBackend && (
        <div className="banner warn">Modo demo (sem backend): apenas TXT local.</div>
      )}

      <main className="grid">
        <section className="card">
          <h2 className="card-title">Configurações</h2>
          <form onSubmit={handleGenerate} className="form">
            <label className="field">
              <span>Idioma</span>
              <select value={language} onChange={e => setLanguage(e.target.value)}>
                <option value="pt">Português</option>
                <option value="en">Inglês</option>
                <option value="es">Espanhol</option>
              </select>
            </label>

            <label className="field">
              <span>Quantidade de letras (aprox.)</span>
              <div className="dual">
                <input type="range" min={30} max={5000} value={length}
                  onChange={e => setLength(Number(e.target.value))} />
                <input type="number" min={30} max={5000} value={length}
                  onChange={e => setLength(Number(e.target.value))} />
              </div>
              <small>{length} caracteres</small>
            </label>

            <label className="field">
              <span>Tom/Linguagem</span>
              <div className="segmented">
                <button type="button"
                  className={tone === 'casual' ? 'seg on' : 'seg'}
                  onClick={() => setTone('casual')}>Casual</button>
                <button type="button"
                  className={tone === 'professional' ? 'seg on' : 'seg'}
                  onClick={() => setTone('professional')}>Profissional</button>
              </div>
            </label>

            <label className="field">
              <span>Tema/Assunto</span>
              <input type="text" value={topic} onChange={e => setTopic(e.target.value)}
                placeholder="ex.: apresentação de produto, marketing..." />
            </label>

            <label className="field">
              <span>Palavras-chave (separe por vírgulas)</span>
              <input type="text" value={keywords} onChange={e => setKeywords(e.target.value)}
                placeholder="ex.: tecnologia, eficiência, design" />
            </label>

            <label className="field">
              <span>Criatividade (temperature)</span>
              <div className="dual">
                <input type="range" min={0} max={1} step={0.1} value={temperature}
                  onChange={e => setTemperature(Number(e.target.value))} />
                <input type="number" min={0} max={1} step={0.1} value={temperature}
                  onChange={e => setTemperature(Number(e.target.value))} />
              </div>
              <small>0 = mais fiel, 1 = mais criativo</small>
            </label>

            <label className="field">
              <span>Formato</span>
              <select value={format} onChange={e => {
                const fmt = e.target.value;
                setFormat(fmt);
                setFileName(sanitizeName(fileName, fmt));
              }}>
                <option value="txt">TXT</option>
                <option value="pdf">PDF</option>
              </select>
            </label>

            <label className="field">
              <span>Nome do arquivo</span>
              <input
                type="text"
                value={fileName}
                onChange={e => setFileName(sanitizeName(e.target.value, format))}
                placeholder={format === 'pdf' ? 'arquivo.pdf' : 'arquivo.txt'}
              />
            </label>

            <button className="btn primary" type="submit" disabled={loading}>
              {loading ? 'Gerando…' : 'Gerar'}
            </button>

            <p className="status">{status}</p>
          </form>
        </section>

        <section className="card">
          <h2 className="card-title">Resultado</h2>

          {!fileUrl ? (
            <p className="muted">Nada gerado ainda.</p>
          ) : (
            <>
              <div className="actions">
                <button className="btn" onClick={handlePreview}>Visualizar</button>
                <button className="btn" onClick={handleDownload}>Baixar</button>
                <button className="btn danger" onClick={handleDelete}>Apagar</button>
              </div>

              <div className="preview">
                <div className="preview-header">Pré-visualização</div>
                {previewType === 'pdf' ? (
                  <iframe className="preview-frame" src={fileUrl} title="Pré-visualização PDF" />
                ) : (
                  <pre className="preview-text">{previewText || '...'}</pre>
                )}
              </div>
            </>
          )}

          <ul className="tips">
            <li>Se “Falha de rede/CORS”, verifique <code>ALLOWED_ORIGINS</code> no backend e <code>VITE_API_URL</code> no front (sem “/” no fim).</li>
            <li>Abra o app em aba externa (não no webview).</li>
          </ul>
        </section>
      </main>

      <footer className="footer">
        <small>Feito com React + Vite</small>
      </footer>
    </div>
  );
}


