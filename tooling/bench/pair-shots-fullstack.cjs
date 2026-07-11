// Result images for the fullstack-205-206 batch: side-by-side of the prototype HOME
// (left, localhost:8080/<slug>.html) and the BUILT dashboard (right, live /admin/<uid>
// with a fresh signIn token). Writes web/acceptance-fullstack/pair-<runId>.png, copies
// into runs/artifacts/<runId>/ and records it in artifacts.json.
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const PAIRS = [
  { run: 'crm-fable',   proto: '205-crm-pipeline',  port: 14241, uid: '4sq7alvizlj', label: 'CRM · Fable 5' },
  { run: 'erp-fable',   proto: '206-erp-inventory', port: 14242, uid: '0lh53wc4y3r', label: 'ERP · Fable 5' },
  { run: 'crm-codex56', proto: '205-crm-pipeline',  port: 14243, uid: 'eb2git0blkk', label: 'CRM · Codex 5.6-sol' },
  { run: 'erp-codex56', proto: '206-erp-inventory', port: 14244, uid: 'wj960d7mc2y', label: 'ERP · Codex 5.6-sol' },
];
const artsP = path.join(ROOT, 'tooling/bench/runs/artifacts.json');
const arts = JSON.parse(fs.readFileSync(artsP));
const outDir = path.join(ROOT, 'web/acceptance-fullstack');
fs.mkdirSync(outDir, { recursive: true });

async function token(port) {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth:signIn`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin@nocobase.com', password: 'admin123' }) });
  return (await r.json()).data.token;
}

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  for (const p of PAIRS) {
    const tmp = os.tmpdir(), lp = `${tmp}/L-${p.run}.png`, rp = `${tmp}/R-${p.run}.png`;
    let lok = false, rok = false;
    try { // LEFT: prototype home
      const pg = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
      await pg.goto(`http://localhost:8080/${p.proto}.html`, { waitUntil: 'networkidle', timeout: 30000 });
      await pg.waitForTimeout(900);
      await pg.screenshot({ path: lp, fullPage: true });
      await pg.context().close();
      lok = fs.statSync(lp).size > 8000;
    } catch (e) { console.log(p.run, 'LEFT fail', e.message); }
    try { // RIGHT: built dashboard, live
      const tok = await token(p.port);
      const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
      const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${p.port}/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await pg.evaluate((t) => { localStorage.setItem('NOCOBASE_TOKEN', t); localStorage.setItem('NOCOBASE_LOCALE', 'en-US'); }, tok);
      await pg.goto(`http://127.0.0.1:${p.port}/admin/${p.uid}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      await pg.waitForTimeout(6000);
      await pg.screenshot({ path: rp, fullPage: true });
      await ctx.close();
      rok = fs.statSync(rp).size > 15000;
    } catch (e) { console.log(p.run, 'RIGHT fail', e.message); }
    if (!(lok && rok)) { console.log(`${p.run} SKIP left=${lok} right=${rok}`); continue; }
    const out = path.join(outDir, `pair-${p.run}.png`);
    const html = `<!doctype html><body style="margin:0;background:#f3f4f6;font:14px system-ui"><div id=cap style="display:flex;gap:10px;padding:12px;width:1600px;align-items:flex-start">`
      + `<div style="flex:1"><div style="font-weight:600;color:#374151;padding:4px">原型 Prototype · ${p.proto.slice(0, 3)}</div><img src="file://${lp}" style="width:100%;border:1px solid #cbd5e1;border-radius:6px;background:#fff;display:block"></div>`
      + `<div style="flex:1"><div style="font-weight:600;color:#374151;padding:4px">复刻 Dashboard · ${p.label}</div><img src="file://${rp}" style="width:100%;border:1px solid #cbd5e1;border-radius:6px;background:#fff;display:block"></div></div></body>`;
    const hf = `${tmp}/c-${p.run}.html`; fs.writeFileSync(hf, html);
    const pg = await (await b.newContext({ deviceScaleFactor: 1.25 })).newPage();
    await pg.goto('file://' + hf, { waitUntil: 'networkidle' }); await pg.waitForTimeout(500);
    await (await pg.$('#cap')).screenshot({ path: out }); await pg.context().close();
    const ad = path.join(ROOT, `tooling/bench/runs/artifacts/${p.run}`); fs.mkdirSync(ad, { recursive: true });
    fs.copyFileSync(out, path.join(ad, `pair-${p.run}.png`));
    arts[p.run] = [{ kind: 'image', file: `${p.run}/pair-${p.run}.png`, label: '原型 vs 复刻 Dashboard' }];
    console.log(`${p.run} OK -> ${path.relative(ROOT, out)}`);
  }
  fs.writeFileSync(artsP, JSON.stringify(arts, null, 1));
  await b.close(); console.log('DONE');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
