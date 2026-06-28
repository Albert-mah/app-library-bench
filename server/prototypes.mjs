// Prototype creation/registry — formalizes a prototype as { kind, content } so creation
// and display are uniform. SPEC: every prototype is HTML-backed — html kind uses the given
// html; prompt/info/composite are rendered into a standalone html doc. A cover image is then
// auto-generated from that html via a headless screenshot (npx playwright screenshot).
// User prototypes live in web/prototypes.json (curated library.json untouched).
//   GET  /api/prototypes        · POST /api/prototypes · DELETE /api/prototypes/:id
//   POST /api/shot { url|slug, num }  → (re)generate a cover image from html
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const KINDS = ['html', 'prompt', 'info', 'composite'];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf-8') || '[]'); } catch { return []; } }
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, file);
}
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// render a non-html prototype's content into a standalone styled html doc (so it's HTML-backed)
function renderHtml(mod) {
  const c = mod.content || {};
  let main = '';
  if (mod.kind === 'prompt') main = `<div class="kind">📝 Prompt 原型</div><pre class="prompt">${esc(c.prompt)}</pre>`;
  else if (mod.kind === 'info') main = `<div class="kind">📄 信息原型</div>` + (Array.isArray(c.sections) && c.sections.length
    ? c.sections.map((s) => `<h3>${esc(s.title)}</h3><p>${esc(s.body)}</p>`).join('')
    : `<p style="white-space:pre-wrap">${esc(c.text)}</p>`);
  else if (mod.kind === 'composite') main = `<div class="kind">🧩 组合原型</div>` + (c.blocks || []).map((b) =>
    b.type === 'html' ? b.value : b.type === 'image' ? `<img src="${esc(b.value)}" style="max-width:100%">` : `<pre class="prompt">${esc(b.value)}</pre>`).join('\n');
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(mod.cn || mod.name)}</title><style>
body{margin:0;font:15px/1.7 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:rgba(0,0,0,.88);background:#f7f8fa}
.doc{max-width:860px;margin:0 auto;padding:32px 28px 64px;background:#fff;min-height:100vh}
h1{font-size:26px;margin:0 0 4px} h3{font-size:16px;margin:18px 0 4px}
.lead{color:rgba(0,0,0,.5);margin:0 0 14px}
.kind{display:inline-block;font-size:12px;color:#d46b08;background:#fff7e6;border:1px solid #ffe58f;border-radius:6px;padding:3px 10px;margin-bottom:16px}
.prompt{white-space:pre-wrap;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0f1320;color:#e6e9ef;border-radius:10px;padding:16px 18px;overflow:auto}
.tags span{font-size:12px;background:#f0f1f4;color:rgba(0,0,0,.5);border-radius:6px;padding:2px 9px;margin-right:6px}
</style></head><body><div class="doc">
<h1>${esc(mod.cn || mod.name)}</h1><p class="lead">${esc(mod.en || '')}</p>
<div class="tags">${(mod.tags || []).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
${mod.desc ? `<p>${esc(mod.desc)}</p>` : ''}
${main}
</div></body></html>`;
}

// fire-and-forget cover screenshot (non-blocking): npx playwright screenshot <url> <out>
function shotCover(baseUrl, slug, outFile) {
  try {
    const p = spawn('npx', ['--no-install', 'playwright', 'screenshot', '--viewport-size=1280,832',
      '--wait-for-timeout=700', `${baseUrl}/${slug}.html`, outFile], { stdio: 'ignore', detached: true });
    p.on('error', () => {}); p.unref();
  } catch { /* ignore */ }
}

export function registerPrototypes(app, { file, webDir, baseUrl }) {
  app.get('/api/prototypes', (_req, res) => res.type('application/json; charset=utf-8').send(JSON.stringify(read(file))));

  app.post('/api/prototypes', (req, res) => {
    const J = (c, o) => res.status(c).type('application/json').send(JSON.stringify(o));
    const b = req.body || {};
    if (!KINDS.includes(b.kind)) return J(400, { error: 'kind must be one of ' + KINDS.join('/') });
    if (!b.name) return J(400, { error: 'name required' });
    const content = b.content && typeof b.content === 'object' ? b.content : {};
    if (b.kind === 'html' && !content.html) return J(400, { error: 'html kind needs content.html' });
    if (b.kind === 'prompt' && !content.prompt) return J(400, { error: 'prompt kind needs content.prompt' });
    if (b.kind === 'info' && !content.text && !(content.sections && content.sections.length)) return J(400, { error: 'info kind needs content.text/sections' });
    if (b.kind === 'composite' && !(content.blocks && content.blocks.length)) return J(400, { error: 'composite kind needs content.blocks[]' });

    const list = read(file);
    const num = 300 + list.length + 1;
    const slug = `${num}-${slugify(b.name) || 'proto-' + num}`;
    const mod = {
      id: String(num), num, slug, name: b.name, cn: b.cn || b.name, en: b.en || '', desc: b.desc || '',
      tags: Array.isArray(b.tags) ? b.tags : (b.tags ? String(b.tags).split(/[,，]/).map((s) => s.trim()).filter(Boolean) : []),
      kind: b.kind, content, source: 'user', test: 'none',
      dataType: b.kind === 'html' ? 'html' : 'prompt',
      category: ['build', 'experiment', 'other'].includes(b.category) ? b.category : 'other',
      stages: { proto: 'done', spec: 'none', built: 'no', tested: 'none', published: 'no' },
      createdAt: new Date().toISOString(),
    };
    // SPEC: every prototype is HTML-backed → write web/<slug>.html
    try {
      const htmlBody = b.kind === 'html' ? content.html : renderHtml(mod);
      fs.writeFileSync(path.join(webDir, `${slug}.html`), htmlBody, 'utf-8');
    } catch (e) { return J(500, { error: 'write html failed: ' + e.message }); }
    list.push(mod);
    try { writeAtomic(file, list); } catch (e) { return J(500, { error: 'write failed: ' + e.message }); }
    // auto cover (non-blocking) → thumbs/<num>.jpg
    if (baseUrl) shotCover(baseUrl, slug, path.join(webDir, 'thumbs', `${num}.jpg`));
    return J(200, { ok: true, module: mod, coverPending: !!baseUrl });
  });

  app.delete('/api/prototypes/:id', (req, res) => {
    const list = read(file);
    const i = list.findIndex((m) => String(m.id) === req.params.id);
    if (i < 0) return res.status(404).type('application/json').send('{"error":"not found"}');
    const [m] = list.splice(i, 1);
    if (m.slug) { try { fs.unlinkSync(path.join(webDir, `${m.slug}.html`)); } catch { /* ignore */ } try { fs.unlinkSync(path.join(webDir, 'thumbs', `${m.num}.jpg`)); } catch { /* ignore */ } }
    writeAtomic(file, list);
    res.type('application/json').send(JSON.stringify({ ok: true }));
  });

  // general cover/screenshot: regenerate from a served html (slug or url) → thumbs/<num>.jpg
  app.post('/api/shot', (req, res) => {
    const b = req.body || {};
    const url = b.url || (b.slug && baseUrl ? `${baseUrl}/${b.slug}.html` : null);
    if (!url || !b.num) return res.status(400).type('application/json').send('{"error":"need (url|slug) + num"}');
    shotCover(baseUrl, b.slug || '', path.join(webDir, 'thumbs', `${String(b.num)}.jpg`));
    res.type('application/json').send(JSON.stringify({ ok: true, pending: true }));
  });
}
