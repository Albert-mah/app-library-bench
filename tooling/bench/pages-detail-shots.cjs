// Detail evidence long image v2 per system — rows are MODULES, columns are the CLICKED-OPEN
// details inside that module:
//   row1 业务弹窗   : record drawers (Customers/Products View; ERP also PO drawer)
//   row2 工作流详情 : every ENABLED workflow's canvas, side by side
//   row3 角色权限   : per custom role → its main-datasource collection-permission tab
//   row4 AI员工     : edit drawer "Role setting" (prompt) + "Skills" tab
// → web/acceptance-fullstack/detail-<run>.jpg
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'web/acceptance-fullstack');
const SYS = [
  { run: 'crm-fable', port: 14241, label: 'CRM · Fable 5 (fablecrm)',
    drawers: [['Customers 详情抽屉', 'ro3mtrcnb4d']],
    workflows: [['Lead intake', '374668772573184'], ['Deal won', '374668898402304'], ['High-value approval', '374669814857728']],
    roles: [['Sales Rep', 'Sales Rep'], ['Sales Manager', 'Sales Manager']],
    employee: 'sales-assistant' },
  // NOTE: role titles are per-build (codex named its rep "Sales Representative")
  { run: 'erp-fable', port: 14242, label: 'ERP · Fable 5 (fableerp)',
    drawers: [['Products 详情抽屉', 'oydvvijibnz'], ['Purchase Order 抽屉', '3qr8rz83f6x']],
    workflows: [['PO received', '374667291983872'], ['SO fulfilled', '374667298275329'], ['Low-stock alert', '374667308761088'], ['PO approval', '374667317149697']],
    roles: [['Warehouse', 'Warehouse'], ['Purchaser', 'Purchaser'], ['Sales', 'Sales'], ['Manager', 'Manager']],
    employee: 'ops-assistant' },
  { run: 'crm-codex56', port: 14243, label: 'CRM · Codex 5.6-sol (codexcrm)',
    drawers: [['Customers 详情抽屉', '8ww0f7u3690']],
    workflows: [['Lead intake', '374664655667200'], ['Deal won', '374664659861504'], ['High-value approval', '374664666152960']],
    roles: [['Sales Rep', 'Sales Representative'], ['Sales Manager', 'Sales Manager']],
    employee: 'sales-assistant' },
  { run: 'erp-codex56', port: 14244, label: 'ERP · Codex 5.6-sol (codexerp)',
    drawers: [['Products 详情抽屉', 'heuqoosbym4'], ['Purchase Order 抽屉', 'vp0efgzzum8']],
    workflows: [['Low-stock alert', '374666554703872'], ['PO approval', '374666611326976'], ['PO received', '374667506810880'], ['SO fulfilled', '374667508908032']],
    roles: [['Warehouse', 'Warehouse'], ['Purchaser', 'Purchaser'], ['Sales', 'Sales'], ['Manager', 'Manager']],
    employee: 'ops-assistant' },
];

async function token(port) {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth:signIn`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin@nocobase.com', password: 'admin123' }) });
  return (await r.json()).data.token;
}
const VP = { width: 1600, height: 950 };

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  for (const sys of SYS) {
    const tok = await token(sys.port);
    const ctx = await b.newContext({ viewport: VP });
    const pg = await ctx.newPage();
    const base = `http://127.0.0.1:${sys.port}`;
    await pg.goto(base + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await pg.evaluate((t) => { localStorage.setItem('NOCOBASE_TOKEN', t); localStorage.setItem('NOCOBASE_LOCALE', 'en-US'); }, tok);
    const rows = [];   // {section, shots:[{label, fp}]}
    let n = 0;
    const shot = async (label) => {
      const fp = `${os.tmpdir()}/ds-${sys.run}-${n++}.png`;
      await pg.screenshot({ path: fp });
      console.log(`  ${sys.run} ✓ ${label}`);
      return { label, fp };
    };
    // ---- row1: record drawers
    const r1 = [];
    for (const [label, uid] of sys.drawers) {
      try {
        await pg.goto(`${base}/admin/${uid}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
        await pg.waitForTimeout(5000);
        // .ant-table-row = real data rows (plain `tbody tr` first-hits the empty measure row);
        // row actions are BUTTONs (not <a>) in 2.2
        let view = pg.locator('.ant-table-row').first()
          .locator('button, a', { hasText: /^(View|Details|查看)$/ }).first();
        if (!(await view.count())) view = pg.getByRole('button', { name: /^(View|Details)$/ }).first();
        await view.click({ timeout: 8000 });
        await pg.waitForTimeout(4500);
        r1.push(await shot(label));
        await pg.keyboard.press('Escape'); await pg.waitForTimeout(800);
      } catch (e) { console.log(`  ${sys.run} ✗ ${label}: ${e.message.split('\n')[0]}`); }
    }
    if (r1.length) rows.push({ section: '业务弹窗 Record drawers', shots: r1 });
    // ---- row2: workflow canvases
    const r2 = [];
    for (const [label, id] of sys.workflows) {
      try {
        await pg.goto(`${base}/admin/settings/workflow/workflows/${id}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
        await pg.waitForTimeout(4000);
        r2.push(await shot(`WF · ${label}`));
      } catch (e) { console.log(`  ${sys.run} ✗ WF ${label}: ${e.message.split('\n')[0]}`); }
    }
    if (r2.length) rows.push({ section: '工作流详情 Workflow canvases', shots: r2 });
    // ---- row3: per-role main-datasource collection permissions.
    // Use a FRESH tab per system (same context = same localStorage token): the probe proved
    // these exact clicks work on a directly-navigated page, while reusing the tab that had
    // been on the workflow canvas made the same clicks time out.
    const r3 = [];
    const pgr = await ctx.newPage();
    for (const [label, roleTitle] of sys.roles) {
      let step = 'goto';
      try {
        await pgr.goto(`${base}/admin/settings/users-permissions/roles`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
        await pgr.waitForTimeout(3500);
        step = `click role "${roleTitle}"`;
        // quoted text= = exact whole-text (case-insensitive) — "Manager" won't collide with
        // the sidebar's "Notification manager" / "Plugin manager"
        await pgr.click(`text="${roleTitle}"`, { timeout: 8000 });
        await pgr.waitForTimeout(1800);
        step = 'click Data sources tab';
        await pgr.getByRole('tab', { name: /Data sources|数据源/ }).first().click({ timeout: 8000 });
        await pgr.waitForTimeout(2200);
        step = 'click Configure';
        // element-agnostic: NocoBase renders this "link" as a styled span, not <a>/<button>
        await pgr.click('text="Configure"', { timeout: 8000 });
        await pgr.waitForTimeout(3500);
        step = 'click Action permissions tab';
        // per-COLLECTION config lives in the second tab — that is "which tables are special".
        // .last() = the TOPMOST drawer's tab (a leftover stacked drawer would otherwise
        // trigger a strict-mode two-element violation)
        await pgr.getByRole('tab', { name: /Action permissions/i }).last().click({ timeout: 8000 });
        await pgr.waitForTimeout(3000);
        const fp = `${os.tmpdir()}/ds-${sys.run}-${n++}.png`;
        await pgr.screenshot({ path: fp });
        console.log(`  ${sys.run} ✓ Role · ${label}`);
        r3.push({ label: `Role · ${label} · main 数据表权限`, fp });
        // close the Configure drawer for real: X button first, Escape as backup
        await pgr.locator('.ant-drawer-close').last().click({ timeout: 3000 }).catch(() => {});
        await pgr.keyboard.press('Escape'); await pgr.waitForTimeout(800);
      } catch (e) {
        await pgr.screenshot({ path: `/tmp/fail-${sys.run}-${label.replace(/\W+/g, '_')}.png` }).catch(() => {});
        console.log(`  ${sys.run} ✗ Role ${label} @${step}: ${e.message.split('\n')[0]}`);
      }
    }
    await pgr.close();
    if (r3.length) rows.push({ section: '角色 × 主数据源数据表权限 Role collection permissions', shots: r3 });
    // ---- row4: AI employee prompt + skills
    const r4 = [];
    try {
      await pg.goto(`${base}/admin/settings/ai/employees`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await pg.waitForTimeout(3500);
      let row = pg.locator('tr', { hasText: sys.employee });
      if (!(await row.count())) row = pg.locator('tr', { hasText: /assistant/i });
      await row.first().locator('a', { hasText: 'Edit' }).click({ timeout: 8000 });
      await pg.waitForTimeout(2500);
      r4.push(await shot('AI员工 · Profile'));
      await pg.getByRole('tab', { name: /Role setting/i }).click({ timeout: 6000 });
      await pg.waitForTimeout(2000);
      r4.push(await shot('AI员工 · Prompt (Role setting)'));
      await pg.getByRole('tab', { name: /Skills/i }).click({ timeout: 6000 });
      await pg.waitForTimeout(2000);
      r4.push(await shot('AI员工 · Skills'));
    } catch (e) { console.log(`  ${sys.run} ✗ AI: ${e.message.split('\n')[0]}`); }
    if (r4.length) rows.push({ section: 'AI员工 Prompt / Skills', shots: r4 });
    await ctx.close();
    // ---- compose: rows vertical, shots horizontal within a row
    const IMGW = 1050;
    const maxCols = Math.max(...rows.map((r) => r.shots.length));
    const width = Math.min(maxCols, 4) * (IMGW + 14) + 40;
    const html = `<!doctype html><body style="margin:0;background:#eef1f5;font:14px system-ui"><div id=cap style="width:${width}px;padding:16px">`
      + `<div style="font:700 24px system-ui;color:#111827;padding:4px 4px 16px">${sys.label} — 模块详情(弹窗/工作流/权限/AI员工)</div>`
      + rows.map((r) => `<div style="margin-bottom:22px"><div style="font:600 17px system-ui;color:#fff;background:#1f2937;border-radius:8px;padding:8px 14px;margin-bottom:10px">${r.section}</div>`
        + `<div style="display:flex;gap:14px;flex-wrap:wrap">`
        + r.shots.map((s) => `<div style="width:${IMGW}px"><div style="font:600 13px system-ui;color:#374151;padding:3px 2px">${s.label}</div>`
          + `<img src="file://${s.fp}" style="width:100%;display:block;border:1px solid #cbd5e1;border-radius:6px;background:#fff"></div>`).join('')
        + `</div></div>`).join('')
      + `</div></body>`;
    const hf = `${os.tmpdir()}/dc-${sys.run}.html`; fs.writeFileSync(hf, html);
    const c2 = await b.newContext({ deviceScaleFactor: 1 }); const p2 = await c2.newPage();
    await p2.goto('file://' + hf, { waitUntil: 'networkidle' }); await p2.waitForTimeout(900);
    const out = path.join(OUT, `detail-${sys.run}.jpg`);
    await (await p2.$('#cap')).screenshot({ path: out, type: 'jpeg', quality: 80 });
    await c2.close();
    console.log(`${sys.run} DETAIL -> ${path.relative(ROOT, out)} (${Math.round(fs.statSync(out).size / 1024)}KB, rows=${rows.map((r) => r.shots.length).join('/')})`);
  }
  await b.close(); console.log('DONE');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
