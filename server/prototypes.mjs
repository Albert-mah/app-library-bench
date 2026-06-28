// Prototype creation/registry — formalizes a prototype as { kind, content } so creation
// and display are uniform across modalities. User-created prototypes live in their own
// store (web/prototypes.json) and are merged with the curated library.json in the UI;
// the curated SoT is never mutated here.
//   GET  /api/prototypes        → the user prototype list
//   POST /api/prototypes        → create one { kind, name, en?, desc?, tags?, content }
//   DELETE /api/prototypes/:id  → remove one (+ its generated html)
import fs from 'node:fs';
import path from 'node:path';

const KINDS = ['html', 'prompt', 'info', 'composite'];
const SLUG_RE = /[^a-z0-9]+/g;

function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf-8') || '[]'); } catch { return []; } }
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, file);
}
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(SLUG_RE, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function registerPrototypes(app, { file, webDir }) {
  app.get('/api/prototypes', (_req, res) => res.type('application/json; charset=utf-8').send(JSON.stringify(read(file))));

  app.post('/api/prototypes', (req, res) => {
    const J = (c, o) => res.status(c).type('application/json').send(JSON.stringify(o));
    const b = req.body || {};
    if (!KINDS.includes(b.kind)) return J(400, { error: 'kind must be one of ' + KINDS.join('/') });
    if (!b.name || typeof b.name !== 'string') return J(400, { error: 'name required' });
    const content = b.content && typeof b.content === 'object' ? b.content : {};
    // per-kind minimal content check
    if (b.kind === 'html' && !content.html) return J(400, { error: 'html kind needs content.html' });
    if (b.kind === 'prompt' && !content.prompt) return J(400, { error: 'prompt kind needs content.prompt' });
    if (b.kind === 'info' && !content.text && !(content.sections && content.sections.length)) return J(400, { error: 'info kind needs content.text or content.sections' });
    if (b.kind === 'composite' && !(content.blocks && content.blocks.length)) return J(400, { error: 'composite kind needs content.blocks[]' });

    const list = read(file);
    const num = 300 + list.length + 1; // user prototypes start at 301, after curated
    const base = slugify(b.name) || ('proto-' + num);
    const slug = `${num}-${base}`;
    const mod = {
      id: String(num), num, slug,
      name: b.name, cn: b.cn || b.name, en: b.en || '', desc: b.desc || '',
      tags: Array.isArray(b.tags) ? b.tags : (b.tags ? String(b.tags).split(/[,，]/).map((s) => s.trim()).filter(Boolean) : []),
      kind: b.kind, content, source: 'user', test: 'none',
      stages: { proto: 'done', spec: 'none', built: 'no', tested: 'none', published: 'no' },
      createdAt: new Date().toISOString(),
    };
    if (b.kind === 'html') {
      try { fs.writeFileSync(path.join(webDir, `${slug}.html`), content.html, 'utf-8'); } catch (e) { return J(500, { error: 'write html failed: ' + e.message }); }
    }
    list.push(mod);
    try { writeAtomic(file, list); } catch (e) { return J(500, { error: 'write failed: ' + e.message }); }
    return J(200, { ok: true, module: mod });
  });

  app.delete('/api/prototypes/:id', (req, res) => {
    const list = read(file);
    const i = list.findIndex((m) => String(m.id) === req.params.id);
    if (i < 0) return res.status(404).type('application/json').send('{"error":"not found"}');
    const [m] = list.splice(i, 1);
    if (m.kind === 'html' && m.slug) { try { fs.unlinkSync(path.join(webDir, `${m.slug}.html`)); } catch { /* ignore */ } }
    writeAtomic(file, list);
    res.type('application/json').send(JSON.stringify({ ok: true }));
  });
}
