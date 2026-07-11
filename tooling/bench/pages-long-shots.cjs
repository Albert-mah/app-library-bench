// Long vertical evidence image per system (fullstack-205-206 batch): one row per module —
// every desktop page, then Workflows admin, AI-employees admin, Roles admin. Row = label
// bar + full-page screenshot, stacked vertically → web/acceptance-fullstack/full-<run>.jpg
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'web/acceptance-fullstack');
const SETTINGS = [
  ['Workflows 工作流', '/admin/settings/workflow'],
  ['AI Employees AI员工', '/admin/settings/ai/employees'],
  ['Roles 角色权限', '/admin/settings/users-permissions/roles'],
];
const SYS = [
  { run: 'crm-fable', port: 14241, label: 'CRM · Fable 5 (fablecrm :14241)', pages: [
    ['Dashboard', '4sq7alvizlj'], ['Pipeline', '27j6w8m1gq5'], ['Customers', 'ro3mtrcnb4d'],
    ['Contacts', 'y3f698uy1je'], ['Activities', 'wtlnpfnp3ag'], ['Blueprint', '7mzs3jpxu5y']] },
  { run: 'erp-fable', port: 14242, label: 'ERP · Fable 5 (fableerp :14242)', pages: [
    ['Dashboard', '0lh53wc4y3r'], ['Products', 'oydvvijibnz'], ['Purchase Orders', '3qr8rz83f6x'],
    ['Sales Orders', '0cs4lko29ij'], ['Inventory', 'eq6l4v6u4c3'], ['Suppliers', '6656xrzc6ur']] },
  { run: 'crm-codex56', port: 14243, label: 'CRM · Codex 5.6-sol (codexcrm :14243)', pages: [
    ['Sales Dashboard', 'eb2git0blkk'], ['Sales Pipeline', 'xjllqwe8gu0'], ['Customers', '8ww0f7u3690'],
    ['Contacts', 'mzl47t6ytug'], ['Activities', '76osjph7qhd'], ['CRM Blueprint', 'gc0mjl8dn7s']] },
  { run: 'erp-codex56', port: 14244, label: 'ERP · Codex 5.6-sol (codexerp :14244)', pages: [
    ['Dashboard', 'wj960d7mc2y'], ['Products', 'heuqoosbym4'], ['Purchase Orders', 'vp0efgzzum8'],
    ['Sales Orders', 'lf8pw96pbz4'], ['Inventory', 'f7utdmd4hhc'], ['Suppliers', 'ocpovi7fqlf']] },
];

async function token(port) {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth:signIn`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin@nocobase.com', password: 'admin123' }) });
  return (await r.json()).data.token;
}

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  for (const sys of SYS) {
    const tok = await token(sys.port);
    const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
    const pg = await ctx.newPage();
    await pg.goto(`http://127.0.0.1:${sys.port}/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await pg.evaluate((t) => { localStorage.setItem('NOCOBASE_TOKEN', t); localStorage.setItem('NOCOBASE_LOCALE', 'en-US'); }, tok);
    const rows = [];
    const shots = [...sys.pages.map(([l, uid]) => [l, `/admin/${uid}`]), ...SETTINGS];
    for (const [label, route] of shots) {
      const fp = `${os.tmpdir()}/ls-${sys.run}-${rows.length}.png`;
      try {
        await pg.goto(`http://127.0.0.1:${sys.port}${route}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
        await pg.waitForTimeout(5000);
        await pg.screenshot({ path: fp, fullPage: true });
        rows.push({ label, fp });
        console.log(`  ${sys.run} ✓ ${label}`);
      } catch (e) { console.log(`  ${sys.run} ✗ ${label}: ${e.message}`); }
    }
    await ctx.close();
    // compose vertical long image
    const html = `<!doctype html><body style="margin:0;background:#eef1f5;font:14px system-ui"><div id=cap style="width:1500px;padding:14px">`
      + `<div style="font:700 22px system-ui;color:#111827;padding:6px 4px 14px">${sys.label} — 全页面 + 工作流 + AI员工 + 权限</div>`
      + rows.map((r) => `<div style="margin-bottom:18px"><div style="font:600 16px system-ui;color:#fff;background:#374151;border-radius:6px 6px 0 0;padding:7px 12px">${r.label}</div>`
        + `<img src="file://${r.fp}" style="width:100%;display:block;border:1px solid #cbd5e1;border-top:none;border-radius:0 0 6px 6px;background:#fff"></div>`).join('')
      + `</div></body>`;
    const hf = `${os.tmpdir()}/lc-${sys.run}.html`; fs.writeFileSync(hf, html);
    const c2 = await b.newContext({ deviceScaleFactor: 1 }); const p2 = await c2.newPage();
    await p2.goto('file://' + hf, { waitUntil: 'networkidle' }); await p2.waitForTimeout(800);
    const out = path.join(OUT, `full-${sys.run}.jpg`);
    await (await p2.$('#cap')).screenshot({ path: out, type: 'jpeg', quality: 78 });
    await c2.close();
    console.log(`${sys.run} LONG -> ${path.relative(ROOT, out)} (${Math.round(fs.statSync(out).size / 1024)}KB, ${rows.length} rows)`);
  }
  await b.close(); console.log('DONE');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
