// FULL module × CRUD evidence long image per system (v3, per user spec):
//   one row PER BUSINESS PAGE: [full page] + [Add new form] + [View drawer] + [Edit drawer]  (horizontal)
//   one row workflows: [list page] + [each enabled workflow canvas]
//   one row roles: per custom role -> main datasource -> Action permissions (Individual = special)
//   one row AI employee: Profile / Prompt (Role setting) / Skills
// usage: node pages-module-shots.cjs <run-id>   (one system per invocation)
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'web/acceptance-fullstack');
const SYS = {
  'crm-fable': { port: 14241, label: 'CRM · Fable 5 (fablecrm)',
    pages: [['Dashboard', '4sq7alvizlj'], ['Pipeline', '27j6w8m1gq5'], ['Customers', 'ro3mtrcnb4d'], ['Contacts', 'y3f698uy1je'], ['Activities', 'wtlnpfnp3ag'], ['Blueprint', '7mzs3jpxu5y']],
    wfList: [['Lead intake', '374668772573184'], ['Deal won', '374668898402304'], ['High-value approval', '374669814857728']],
    roles: [['Sales Rep', 'Sales Rep'], ['Sales Manager', 'Sales Manager']], employee: 'sales-assistant' },
  'erp-fable': { port: 14242, label: 'ERP · Fable 5 (fableerp)',
    pages: [['Dashboard', '0lh53wc4y3r'], ['Products', 'oydvvijibnz'], ['Purchase Orders', '3qr8rz83f6x'], ['Sales Orders', '0cs4lko29ij'], ['Inventory', 'eq6l4v6u4c3'], ['Suppliers', '6656xrzc6ur']],
    wfList: [['PO received', '374667291983872'], ['SO fulfilled', '374667298275329'], ['Low-stock alert', '374667308761088'], ['PO approval', '374667317149697']],
    roles: [['Warehouse', 'Warehouse'], ['Purchaser', 'Purchaser'], ['Sales', 'Sales'], ['Manager', 'Manager']], employee: 'ops-assistant' },
  'crm-codex56': { port: 14243, label: 'CRM · Codex 5.6-sol (codexcrm)',
    pages: [['Sales Dashboard', 'eb2git0blkk'], ['Sales Pipeline', 'xjllqwe8gu0'], ['Customers', '8ww0f7u3690'], ['Contacts', 'mzl47t6ytug'], ['Activities', '76osjph7qhd'], ['CRM Blueprint', 'gc0mjl8dn7s']],
    wfList: [['Lead intake', '374664655667200'], ['Deal won', '374664659861504'], ['High-value approval', '374664666152960']],
    roles: [['Sales Rep', 'Sales Representative'], ['Sales Manager', 'Sales Manager']], employee: 'sales-assistant' },
  'erp-codex56': { port: 14244, label: 'ERP · Codex 5.6-sol (codexerp)',
    pages: [['Dashboard', 'wj960d7mc2y'], ['Products', 'heuqoosbym4'], ['Purchase Orders', 'vp0efgzzum8'], ['Sales Orders', 'lf8pw96pbz4'], ['Inventory', 'f7utdmd4hhc'], ['Suppliers', 'ocpovi7fqlf']],
    wfList: [['Low-stock alert', '374666554703872'], ['PO approval', '374666611326976'], ['PO received', '374667506810880'], ['SO fulfilled', '374667508908032']],
    roles: [['Warehouse', 'Warehouse'], ['Purchaser', 'Purchaser'], ['Sales', 'Sales'], ['Manager', 'Manager']], employee: 'ops-assistant' },
};
async function token(port) {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth:signIn`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin@nocobase.com', password: 'admin123' }) });
  return (await r.json()).data.token;
}
const closeOverlays = async (pg) => {
  for (let i = 0; i < 2; i++) {
    await pg.locator('.ant-drawer-close, .ant-modal-close').last().click({ timeout: 1200 }).catch(() => {});
    await pg.keyboard.press('Escape').catch(() => {});
    await pg.waitForTimeout(500);
  }
};

(async () => {
  const runId = process.argv[2];
  const sys = SYS[runId];
  if (!sys) { console.error('usage: node pages-module-shots.cjs <' + Object.keys(SYS).join('|') + '>'); process.exit(1); }
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const pg = await ctx.newPage();
  const base = `http://127.0.0.1:${sys.port}`;
  await pg.goto(base + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await pg.evaluate((t) => { localStorage.setItem('NOCOBASE_TOKEN', t); localStorage.setItem('NOCOBASE_LOCALE', 'en-US'); }, await token(sys.port));
  const rows = []; let n = 0;
  const snap = async (p, label, full = false) => {
    const fp = `${os.tmpdir()}/ms-${runId}-${n++}.png`;
    await p.screenshot({ path: fp, fullPage: full });
    console.log(`  ${runId} ✓ ${label}`);
    return { label, fp };
  };
  // ---- one row per business page: full page + Add new + View + Edit
  for (const [name, uid] of sys.pages) {
    const shots = [];
    try {
      await pg.goto(`${base}/admin/${uid}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await pg.waitForTimeout(4500);
      shots.push(await snap(pg, `${name} · 整页`, true));
      // Add new (创建表单)
      try {
        await pg.locator('button', { hasText: /^Add new$/ }).first().click({ timeout: 5000 });
        await pg.waitForTimeout(3000);
        shots.push(await snap(pg, `${name} · Add new 表单`));
        await closeOverlays(pg);
      } catch { console.log(`  ${runId} - ${name}: no Add new`); }
      // View (详情)
      try {
        await pg.locator('.ant-table-row').first().locator('button, a', { hasText: /^(View|Details)$/ }).first().click({ timeout: 5000 });
        await pg.waitForTimeout(3500);
        shots.push(await snap(pg, `${name} · View 详情`));
        await closeOverlays(pg);
      } catch { console.log(`  ${runId} - ${name}: no View`); }
      // Edit (编辑)
      try {
        await pg.locator('.ant-table-row').first().locator('button, a', { hasText: /^Edit$/ }).first().click({ timeout: 5000 });
        await pg.waitForTimeout(3000);
        shots.push(await snap(pg, `${name} · Edit 编辑`));
        await closeOverlays(pg);
      } catch { console.log(`  ${runId} - ${name}: no Edit`); }
    } catch (e) { console.log(`  ${runId} ✗ ${name}: ${e.message.split('\n')[0]}`); }
    if (shots.length) rows.push({ section: `页面 · ${name} — 整页 + 增查改`, shots });
  }
  // ---- workflows: list + each canvas
  {
    const shots = [];
    try {
      await pg.goto(`${base}/admin/settings/workflow`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await pg.waitForTimeout(4000);
      shots.push(await snap(pg, '工作流 · 列表'));
    } catch (e) { console.log(`  ${runId} ✗ WF list: ${e.message.split('\n')[0]}`); }
    for (const [name, id] of sys.wfList) {
      try {
        await pg.goto(`${base}/admin/settings/workflow/workflows/${id}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
        await pg.waitForTimeout(4000);
        shots.push(await snap(pg, `画布 · ${name}`));
      } catch (e) { console.log(`  ${runId} ✗ WF ${name}: ${e.message.split('\n')[0]}`); }
    }
    if (shots.length) rows.push({ section: '工作流 — 列表 + 每条画布', shots });
  }
  // ---- roles: per role -> Action permissions (fresh tab; proven selector set)
  {
    const shots = []; const pgr = await ctx.newPage();
    // first column = the roles MAIN page (overview), details to its right
    try {
      await pgr.goto(`${base}/admin/settings/users-permissions/roles`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await pgr.waitForTimeout(3500);
      shots.push(await snap(pgr, '角色权限 · 主页面'));
    } catch (e) { console.log(`  ${runId} ✗ Roles main: ${e.message.split('\n')[0]}`); }
    for (const [label, roleTitle] of sys.roles) {
      let step = 'goto';
      try {
        await pgr.goto(`${base}/admin/settings/users-permissions/roles`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
        await pgr.waitForTimeout(3500);
        step = 'role'; await pgr.click(`text="${roleTitle}"`, { timeout: 8000 });
        await pgr.waitForTimeout(1800);
        step = 'ds-tab'; await pgr.getByRole('tab', { name: /Data sources|数据源/ }).first().click({ timeout: 8000 });
        await pgr.waitForTimeout(2200);
        step = 'configure'; await pgr.click('text="Configure"', { timeout: 8000 });
        await pgr.waitForTimeout(3500);
        step = 'action-perm'; await pgr.getByRole('tab', { name: /Action permissions/i }).last().click({ timeout: 8000 });
        await pgr.waitForTimeout(3000);
        shots.push(await snap(pgr, `Role · ${label}`));
        await pgr.locator('.ant-drawer-close').last().click({ timeout: 3000 }).catch(() => {});
        await pgr.keyboard.press('Escape'); await pgr.waitForTimeout(800);
      } catch (e) { console.log(`  ${runId} ✗ Role ${label} @${step}: ${e.message.split('\n')[0]}`); }
    }
    await pgr.close();
    if (shots.length) rows.push({ section: '角色 × 主数据源 Action permissions(Individual=特殊配置表)', shots });
  }
  // ---- AI employee: Profile / Prompt / Skills
  {
    const shots = [];
    try {
      await pg.goto(`${base}/admin/settings/ai/employees`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await pg.waitForTimeout(3500);
      shots.push(await snap(pg, 'AI员工 · 主页面(列表)'));   // first column = main page
      let row = pg.locator('tr', { hasText: sys.employee });
      if (!(await row.count())) row = pg.locator('tr', { hasText: /assistant/i });
      await row.first().locator('a, button', { hasText: 'Edit' }).first().click({ timeout: 8000 });
      await pg.waitForTimeout(2500);
      shots.push(await snap(pg, 'AI员工 · Profile'));
      await pg.getByRole('tab', { name: /Role setting/i }).click({ timeout: 6000 });
      await pg.waitForTimeout(2000);
      shots.push(await snap(pg, 'AI员工 · Prompt'));
      await pg.getByRole('tab', { name: /Skills/i }).click({ timeout: 6000 });
      await pg.waitForTimeout(2000);
      shots.push(await snap(pg, 'AI员工 · Skills'));
    } catch (e) { console.log(`  ${runId} ✗ AI: ${e.message.split('\n')[0]}`); }
    if (shots.length) rows.push({ section: 'AI员工 — Profile / Prompt / Skills', shots });
  }
  await ctx.close();
  // ---- compose
  const IMGW = 860;
  const maxCols = Math.max(...rows.map((r) => r.shots.length));
  const width = Math.min(maxCols, 5) * (IMGW + 14) + 44;
  const html = `<!doctype html><body style="margin:0;background:#eef1f5;font:14px system-ui"><div id=cap style="width:${width}px;padding:16px">`
    + `<div style="font:700 24px system-ui;color:#111827;padding:4px 4px 16px">${sys.label} — 模块全景:页面+增查改 / 工作流 / 权限 / AI员工</div>`
    + rows.map((r) => `<div style="margin-bottom:24px"><div style="font:600 17px system-ui;color:#fff;background:#1f2937;border-radius:8px;padding:8px 14px;margin-bottom:10px">${r.section}</div>`
      + `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">`
      + r.shots.map((s) => `<div style="width:${IMGW}px"><div style="font:600 13px system-ui;color:#374151;padding:3px 2px">${s.label}</div>`
        + `<img src="file://${s.fp}" style="width:100%;display:block;border:1px solid #cbd5e1;border-radius:6px;background:#fff"></div>`).join('')
      + `</div></div>`).join('')
    + `</div></body>`;
  const hf = `${os.tmpdir()}/mc-${runId}.html`; fs.writeFileSync(hf, html);
  const c2 = await b.newContext({ deviceScaleFactor: 1 }); const p2 = await c2.newPage();
  await p2.goto('file://' + hf, { waitUntil: 'networkidle' }); await p2.waitForTimeout(1200);
  const out = path.join(OUT, `modules-${runId}.jpg`);
  await (await p2.$('#cap')).screenshot({ path: out, type: 'jpeg', quality: 76 });
  await c2.close(); await b.close();
  console.log(`${runId} MODULES -> ${path.relative(ROOT, out)} (${Math.round(fs.statSync(out).size / 1024)}KB, rows=${rows.map((r) => r.shots.length).join('/')})`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
