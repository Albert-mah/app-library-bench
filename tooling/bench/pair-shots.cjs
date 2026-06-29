// Regenerate proper RESULT images for the #61-90 round: a side-by-side of the
// prototype HOME page (left, shot from the local html) and the built signature/home
// page (right, live-shot of /admin/<pageUid> with the env token). Composites overwrite
// web/acceptance-r1/pair-NN.png, refresh the run artifact, and bump library.json image ?v.
// Why this exists: the first pass attached "latest scratchpad png" (often a list/drawer
// view), with no homepage/comparison notion — wrong. This is deterministic.
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const ROOT = '/home/albert/prj/vscodes/app-library-bench';
const PORT = { appslib: 14220, maxbench01: 14233, maxbench02: 14234, maxbench03: 14235, flash14231: 14231, fable14232: 14232, expagents: 14230, cleanbeta: 14239, crmnative: 14236 };
const idx = JSON.parse(fs.readFileSync(ROOT + '/tooling/bench/runs/index.json'));
const artsP = ROOT + '/tooling/bench/runs/artifacts.json';
const arts = JSON.parse(fs.readFileSync(artsP));
const nb = JSON.parse(fs.readFileSync('/home/albert/.nocobase/config.json')).envs;
const libP = ROOT + '/web/library.json';
const lib = JSON.parse(fs.readFileSync(libP));
const byNum = Object.fromEntries(lib.modules.map((m) => [m.num, m]));
const runs = idx.filter((x) => (x.lineage || {}).batch === 'round-61-90').sort((a, b) => a.id.localeCompare(b.id));
const VER = 2;

const pageUid = (r) => { // signature page's route uid — final reports phrase it several ways
  const ft = (r.outcome || {}).finalText || '';
  const pats = [
    /Signature[\s\S]{0,130}?pageSchemaUid[\s`*=:]*([a-z0-9]{9,})/i,
    /Signature[\s\S]{0,130}?pageUid[\s`*=:]*([a-z0-9]{9,})/i,
    /pageSchemaUid[\s`*=:]*([a-z0-9]{9,})/i,
    /pageUid[\s`*=:]*([a-z0-9]{9,})/i,
    /\/admin\/([a-z0-9]{9,})/i,
  ];
  for (const p of pats) { const m = ft.match(p); if (m) return m[1]; }
  return (byNum[r.id.slice(1)] || {}).pageUid || null;
};
function dashShot(num) { // fallback: pick the most "homepage dashboard"-looking scratchpad png
  let pngs = [];
  try { pngs = cp.execSync(`find /tmp/claude-1000/-tmp-round-61-90-p${num} -name '*.png' 2>/dev/null`, { encoding: 'utf8' }).split('\n').filter(Boolean); } catch {}
  const sc = (f) => { const b = path.basename(f).toLowerCase(); let s = 0; if (/dash|sig|home|overview|main|hero/.test(b)) s += 5; if (/full|final|page/.test(b)) s += 3; if (/list|drawer|tbl|table|detail|sub|popup|proto|mobile|low|card|form|s1|s2|_s/.test(b)) s -= 4; try { s += fs.statSync(f).size / 1e7; } catch {} return s; };
  pngs.sort((a, b) => sc(b) - sc(a)); return pngs[0] || null;
}

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  for (const r of runs) {
    const num = r.id.slice(1), env = (r.target || {}).env, port = PORT[env], slug = (byNum[num] || {}).slug;
    const tok = ((nb[env] || {}).auth || {}).accessToken; const tmp = os.tmpdir();
    const lp = `${tmp}/L${num}.png`, rp = `${tmp}/R${num}.png`; let lok = false, rok = false;
    try { const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); await pg.goto(`http://localhost:8080/${slug}.html`, { waitUntil: 'networkidle', timeout: 30000 }); await pg.waitForTimeout(900); await pg.screenshot({ path: lp, fullPage: true }); await pg.context().close(); lok = fs.existsSync(lp) && fs.statSync(lp).size > 8000; } catch {}
    const uid = pageUid(r);
    if (port && tok && uid) { try {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }); const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await pg.evaluate((t) => { localStorage.setItem('NOCOBASE_TOKEN', t); localStorage.setItem('NOCOBASE_LOCALE', 'en-US'); }, tok);
      await pg.goto(`http://127.0.0.1:${port}/admin/${uid}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await pg.waitForTimeout(5000); await pg.screenshot({ path: rp, fullPage: true }); await ctx.close();
      rok = fs.existsSync(rp) && fs.statSync(rp).size > 18000;
    } catch {} }
    const rsrc = rok ? rp : dashShot(num);
    const out = `${ROOT}/web/acceptance-r1/pair-${num}.png`;
    if (lok && rsrc) {
      const html = `<!doctype html><body style="margin:0;background:#f3f4f6;font:14px system-ui"><div id=cap style="display:flex;gap:10px;padding:12px;width:1560px;align-items:flex-start">`
        + `<div style="flex:1"><div style="font-weight:600;color:#374151;padding:4px">原型 Prototype · #${num}</div><img src="file://${lp}" style="width:100%;border:1px solid #cbd5e1;border-radius:6px;background:#fff;display:block"></div>`
        + `<div style="flex:1"><div style="font-weight:600;color:#374151;padding:4px">复刻首页 Reproduction · ${env}${rok ? '' : ' (scratchpad)'}</div><img src="file://${rsrc}" style="width:100%;border:1px solid #cbd5e1;border-radius:6px;background:#fff;display:block"></div></div></body>`;
      const hf = `${tmp}/c${num}.html`; fs.writeFileSync(hf, html);
      const pg = await (await b.newContext({ deviceScaleFactor: 1.25 })).newPage();
      await pg.goto('file://' + hf, { waitUntil: 'networkidle' }); await pg.waitForTimeout(500);
      await (await pg.$('#cap')).screenshot({ path: out }); await pg.context().close();
      const ad = `${ROOT}/tooling/bench/runs/artifacts/${r.id}`; fs.mkdirSync(ad, { recursive: true });
      fs.copyFileSync(out, `${ad}/pair-${num}.png`);
      arts[r.id] = [{ kind: 'image', file: `${r.id}/pair-${num}.png`, label: '原型 vs 复刻首页' }];
      const rd = (((byNum[num] || {}).branches || {}).main || {}).rounds?.r1;
      if (rd) rd.image = `./acceptance-r1/pair-${num}.png?v=${VER}`;
    }
    console.log(`${r.id} num=${num} env=${env} left=${lok} right=${rok ? 'LIVE' : (rsrc ? 'scratch' : 'NONE')} uid=${uid || '-'}`);
  }
  fs.writeFileSync(artsP, JSON.stringify(arts, null, 1));
  fs.writeFileSync(libP, JSON.stringify(lib, null, 2));
  await b.close(); console.log('DONE');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
