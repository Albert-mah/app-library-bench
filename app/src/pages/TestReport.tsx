import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getJSON, postJSON, fmtTime } from '../lib/api';

const MAIN = 'main';
const ALL_V = '__all__';
const MODEL_ORDER = ['Claude', 'DeepSeek-Pro', 'DeepSeek-Flash', 'Qwen', '其他'];
const VERDICTS = ['pass', 'fix', 'redo'] as const;
const STATUS: [string, string][] = [['testing', '测试中'], ['review', '审核中'], ['reviewed', '已审核']];
const imgSrc = (s?: string) => (s ? '/' + s.replace(/^\.?\//, '') : '');
const pad2 = (n: any) => String(n).padStart(2, '0');
const scenarioOfRun = (id: string) => { const m = /(?:^|[-_])(0[1-9])(?:[-_]|$)/.exec(id); return m ? m[1] : null; };

const branchObj = (m: any, b: string) => (m.branches && m.branches[b]) || null;
const modBranchIds = (m: any): string[] => (m.branches ? Object.keys(m.branches).sort((a, b) => (a === MAIN ? -1 : b === MAIN ? 1 : 0)) : []);
const modBR = (m: any, b: string, r: string) => { const o = branchObj(m, b); return (o && o.rounds && o.rounds[r]) || null; };
const hasData = (rd: any) => !!rd && (!!rd.image || !!(rd.reasoning && rd.reasoning.length));
const branchSkillVersion = (mods: any[], bid: string) => { for (const m of mods) { const b = branchObj(m, bid); if (b) return b.skillVersion || 'v260605'; } return 'v260605'; };
function branchModelGroup(bid: string) {
  if (bid === MAIN || bid === 'design' || bid === 'blind') return 'Claude';
  if (bid === 'blind-dspro') return 'DeepSeek-Pro';
  if (bid === 'blind-dsflash' || bid === 'flash-retest') return 'DeepSeek-Flash';
  if (bid === 'bench' || bid.startsWith('bench-') || bid.indexOf('qwen') >= 0) return 'Qwen';
  const h = bid.toLowerCase();
  if (h.includes('pro')) return 'DeepSeek-Pro'; if (h.includes('flash')) return 'DeepSeek-Flash';
  if (h.includes('deepseek') || h.includes('ds')) return 'DeepSeek-Pro';
  if (h.includes('claude') || h.includes('sonnet') || h.includes('opus')) return 'Claude';
  return '其他';
}
const gLabel = (mods: any[], bid: string) => { if (bid === MAIN) return '主应用线'; for (const m of mods) { const b = branchObj(m, bid); if (b && b.label) return b.label; } return bid; };
const srvE = (server: any, mid: string, r: string, b: string) => server?.[b]?.[r]?.[mid] || null;
const uVerdict = (server: any, mid: string, r: string, b: string) => { const e = srvE(server, mid, r, b); return e && VERDICTS.includes(e.verdict) ? e.verdict : null; };
const aiVerdict = (rd: any) => (rd && VERDICTS.includes(rd.verdict) ? rd.verdict : null);
const statusOf = (server: any, m: any, r: string, b: string, rd: any) => (uVerdict(server, m.id, r, b) ? 'reviewed' : aiVerdict(rd) ? 'review' : 'testing');
const backupFor = (backups: any[], m: any, b: string) => { const o = branchObj(m, b); return (o && o.backupId && backups.find((x) => x.id === o.backupId)) || null; };

export default function TestReport() {
  const [mods, setMods] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);
  const [server, setServer] = useState<any>(null);
  const [reachable, setReachable] = useState(false);
  const [runsIdx, setRunsIdx] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [round, setRound] = useState('');
  const [ver, setVer] = useState(ALL_V);
  const [tag, setTag] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [msOpen, setMsOpen] = useState(false);
  const [sel, setSel] = useState<any>(null); // {mId,b,r}
  const [light, setLight] = useState<string | null>(null);
  const [sp, setSp] = useSearchParams();
  const modFilter = sp.get('mod');

  useEffect(() => {
    getJSON('/library.json').then((d) => {
      setMods((d.modules || []).filter((m: any) => m.branches));
      setRounds((d.rounds || []).filter((r: any) => r.date));
      setBackups(d.backups || []);
    }).catch((e) => setErr(String(e)));
    getJSON('/api/app-library-scores').then((d) => { setServer(d || {}); setReachable(true); }).catch(() => { setServer({}); setReachable(false); });
    getJSON('/api/runs').then(setRunsIdx).catch(() => {});
  }, []);

  const verActive = ver !== ALL_V;
  const versions = useMemo(() => { const s: any = {}, v: string[] = []; mods.forEach((m) => Object.keys(m.branches).forEach((k) => { const x = m.branches[k]?.skillVersion || 'v260605'; if (!s[x]) { s[x] = 1; v.push(x); } })); return v.sort((a, b) => (a < b ? 1 : -1)); }, [mods]);
  const tags = useMemo(() => [...new Set(mods.map((m) => m.tag).filter(Boolean))].sort(), [mods]);
  const globalBranchList = useMemo(() => {
    const s: any = {}, list: string[] = [];
    mods.forEach((m) => Object.keys(m.branches).forEach((k) => { if (k === MAIN || s[k]) return; if (verActive && branchSkillVersion(mods, k) !== ver) return; s[k] = 1; list.push(k); }));
    const wm = !verActive || branchSkillVersion(mods, MAIN) === ver;
    return wm ? [MAIN, ...list] : list;
  }, [mods, ver, verActive]);
  const modelGroups = useMemo(() => {
    const bk: Record<string, string[]> = {}; globalBranchList.forEach((b) => { (bk[branchModelGroup(b)] = bk[branchModelGroup(b)] || []).push(b); });
    const out: any[] = []; MODEL_ORDER.forEach((g) => { if (bk[g]) { out.push({ group: g, branches: bk[g] }); delete bk[g]; } }); Object.keys(bk).forEach((g) => out.push({ group: g, branches: bk[g] })); return out;
  }, [globalBranchList]);

  const branchAll = branches.length === 0;
  const viewBranch = branches.length === 1 && branches[0] !== MAIN ? branches[0] : MAIN;
  const curRound = (m: any, b: string) => { for (let i = rounds.length - 1; i >= 0; i--) if (hasData(modBR(m, b, rounds[i].id))) return rounds[i].id; return rounds.length ? rounds[rounds.length - 1].id : ''; };
  const modFor = (mId: string) => mods.find((m) => m.id === mId);

  const cards = useMemo(() => {
    const inMod = (m: any) => !modFilter || pad2(m.num) === pad2(modFilter) || m.id === modFilter;
    const sel = mods.filter((m) => (branchAll || branches.some((b) => branchObj(m, b))) && (!tag || m.tag === tag) && inMod(m));
    let list: any[];
    if (modFilter) {
      // single prototype → one card per test line (all records visible at a glance)
      list = sel.flatMap((m) => modBranchIds(m)
        .filter((b) => branchAll || branches.includes(b))
        .map((b) => { const r = round || curRound(m, b); return { m, b, r, rd: modBR(m, b, r) }; }));
    } else {
      list = sel.map((m) => { const b = viewBranch; const r = round || curRound(m, b); return { m, b, r, rd: modBR(m, b, r) }; });
    }
    return list.filter((c) => c.rd).filter((c) => status.length === 0 || status.includes(statusOf(server, c.m, c.r, c.b, c.rd)));
  }, [mods, branches, tag, round, ver, server, status, modFilter]);

  const stats = useMemo(() => { const s: any = { total: cards.length, testing: 0, review: 0, reviewed: 0, ai: 0, aiN: 0 }; cards.forEach((c) => { s[statusOf(server, c.m, c.r, c.b, c.rd)]++; if (typeof c.rd.aiScore === 'number') { s.ai += c.rd.aiScore; s.aiN++; } }); return s; }, [cards, server]);

  async function patch(r: string, mid: string, b: string, p: any) { const res = await postJSON('/api/app-library-scores', { round: r, module: mid, branch: b, ...p }); if (res && !res.error) { setServer(res); setReachable(true); } return res; }

  if (err) return <div className="loading">加载失败:{err}</div>;
  if (!mods.length) return <div className="loading">加载中…</div>;
  const lineLabel = branchAll ? '全部线' : branches.length === 1 ? gLabel(mods, branches[0]) : branches.length + ' 条线';
  const modObj = modFilter ? mods.find((m) => pad2(m.num) === pad2(modFilter) || m.id === modFilter) : null;

  return (
    <>
      <div className="pagehead">
        <h1>复刻测试中心</h1>
        <span className="sub">{mods.length} 个已测模块{reachable ? '' : ' · ⚠️ 评分服务未连(只读)'}</span>
        {modObj && <span className="modchip">原型 #{pad2(modObj.num)} {modObj.cn || modObj.name} <span onClick={() => setSp({})}>✕</span></span>}
      </div>

      <div className="bar" style={{ gap: 10 }}>
        <span className="muted">轮次</span>
        <button className={'btn' + (round === '' ? ' on' : '')} onClick={() => setRound('')}>最新</button>
        {rounds.map((r) => <button key={r.id} className={'btn' + (round === r.id ? ' on' : '')} onClick={() => setRound(r.id)}>{r.id.toUpperCase()}</button>)}
        <span className="sep" />
        {STATUS.map(([k, l]) => <button key={k} className={'btn' + (status.includes(k) ? ' on' : '')} onClick={() => setStatus((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k])}>{l}</button>)}
        <span className="sep" />
        <select value={ver} onChange={(e) => { setVer(e.target.value); setBranches([]); }}><option value={ALL_V}>全部版本</option>{versions.map((v) => <option key={v} value={v}>skill {v}</option>)}</select>
        <select value={tag} onChange={(e) => setTag(e.target.value)}><option value="">全部分类</option>{tags.map((t) => <option key={t}>{t}</option>)}</select>
        <LineSelect {...{ open: msOpen, setOpen: setMsOpen, modelGroups, branches, setBranches, mods, label: lineLabel }} />
        <span className="muted" style={{ marginLeft: 'auto' }}>显示 {cards.length}</span>
      </div>
      <div className="bar"><span className="stats">共 <b>{stats.total}</b> · <span className="pill" style={{ background: '#f0f1f4' }}>测试中 {stats.testing}</span> <span className="pill fix">审核中 {stats.review}</span> <span className="pill pass">已审核 {stats.reviewed}</span>{stats.aiN ? <> · 均 AI <b>{(stats.ai / stats.aiN).toFixed(1)}</b></> : null}</span></div>

      <div className="wrap">
        <div className="grid tr-grid">
          {cards.map((c) => {
            const stt = statusOf(server, c.m, c.r, c.b, c.rd);
            const uv = uVerdict(server, c.m.id, c.r, c.b);
            return (
              <div className="card tr-card" key={c.m.id + c.b} onClick={() => setSel({ mId: c.m.id, b: c.b, r: c.r })}>
                <div className="thumb tr-thumb" style={{ backgroundImage: c.rd.image ? `url(${imgSrc(c.rd.image)})` : '' }}>
                  <span className="num">#{pad2(c.m.num)}</span>
                  <span className="rbadge">{c.r.toUpperCase()} · {gLabel(mods, c.b)}</span>
                  <span className={'stbadge ' + stt}>{stt === 'reviewed' ? '已审核' : stt === 'review' ? '审核中' : '测试中'}</span>
                </div>
                <div className="body">
                  <h3>{c.m.cn || c.m.name}</h3>
                  <div className="airow">
                    {typeof c.rd.aiScore === 'number' && <span className="aiscore">AI {c.rd.aiScore}/10</span>}
                    {aiVerdict(c.rd) && <span className={'pill ' + aiVerdict(c.rd)}>AI {aiVerdict(c.rd)}</span>}
                    {uv && <span className={'pill ' + uv}>人工 {uv}</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>点击查看链路回溯 / 聊天记录 / 关联文件 →</div>
                </div>
              </div>
            );
          })}
          {!cards.length && <div style={{ gridColumn: '1/-1', padding: 48, textAlign: 'center', color: 'var(--text3)' }}>该筛选下没有用例</div>}
        </div>
      </div>

      {sel && <TestModal {...{ sel, setSel, modFor, mods, rounds, backups, server, reachable, runsIdx, patch, setLight, curRound }} />}
      {light && <div className="lightbox" onClick={() => setLight(null)}><span className="lb-close">×</span><img src={light} alt="" onClick={(e) => e.stopPropagation()} /></div>}
    </>
  );
}

function LineSelect({ open, setOpen, modelGroups, branches, setBranches, mods, label }: any) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: any) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('click', h); return () => document.removeEventListener('click', h); }, [setOpen]);
  const toggle = (b: string) => setBranches((p: string[]) => p.includes(b) ? p.filter((x) => x !== b) : [...p, b]);
  const groupAll = (bs: string[]) => { const all = bs.every((b) => branches.includes(b)); setBranches((p: string[]) => all ? p.filter((x) => !bs.includes(x)) : [...new Set([...p, ...bs])]); };
  return (
    <div className="ms" ref={ref}>
      <button className="btn" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>线:{label} ▾</button>
      {open && <div className="ms-pop" onClick={(e) => e.stopPropagation()}>
        <div className="ms-top"><button className="btn" onClick={() => setBranches([])}>全部线</button><button className="btn primary" onClick={() => setOpen(false)}>完成</button></div>
        {modelGroups.map((g: any) => <div className="ms-grp" key={g.group}>
          <div className="ms-gh" onClick={() => groupAll(g.branches)}><b>{g.group}</b> <span className="muted">全选</span></div>
          {g.branches.map((b: string) => <label className="ms-it" key={b}><input type="checkbox" checked={branches.includes(b)} onChange={() => toggle(b)} />{gLabel(mods, b)} <span className="muted">[{b}]</span></label>)}
        </div>)}
      </div>}
    </div>
  );
}

function TestModal({ sel, setSel, modFor, mods, rounds, backups, server, reachable, runsIdx, patch, setLight, curRound }: any) {
  const m = modFor(sel.mId);
  const [b, setB] = useState(sel.b);
  const [r, setR] = useState(sel.r);
  const [hideSide, setHideSide] = useState(false);
  const [mainView, setMainView] = useState<'img' | 'proto'>('img');
  useEffect(() => { setB(sel.b); setR(sel.r); }, [sel.mId]);
  useEffect(() => { const h = (e: any) => { if (e.key === 'Escape') setSel(null); }; document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, [setSel]);
  if (!m) return null;
  const rd = modBR(m, b, r) || {};
  const bk = backupFor(backups, m, b);
  const bo = branchObj(m, b) || {};
  const uv = uVerdict(server, m.id, r, b);
  const e = srvE(server, m.id, r, b) || {};
  const ridSet = new Set([...(rd.runIds || []), ...(bo.runIds || [])]);
  const related = runsIdx.filter((x: any) => ridSet.has(x.id) || x.lineage?.module === pad2(m.num) || scenarioOfRun(x.id) === pad2(m.num));
  const page = bo.pageUid ? (bo.baseUrl || '') + '/admin/' + bo.pageUid : (b === MAIN && m.pageUid ? (bo.baseUrl || '') + '/admin/' + m.pageUid : '');

  return (
    <div className="tm-overlay" onClick={() => setSel(null)}>
      <div className="tm" onClick={(ev) => ev.stopPropagation()}>
        <div className="tm-head">
          <span className="tm-num">#{pad2(m.num)}</span>
          <div><h2>{m.cn || m.name}</h2><div className="muted" style={{ fontSize: 12 }}>{m.en} · {m.tag}</div></div>
          <span className="spacer" />
          <div className="seg">
            <button className={mainView === 'img' ? 'on' : ''} onClick={() => setMainView('img')}>对比图</button>
            <button className={mainView === 'proto' ? 'on' : ''} onClick={() => setMainView('proto')}>原型预览</button>
          </div>
          <div className="win-ctrls">
            <button className="win-btn" title={hideSide ? '显示侧栏' : '隐藏侧栏'} onClick={() => setHideSide(!hideSide)}>{hideSide ? '◧' : '◨'}</button>
            <a className="win-btn" title="原型新窗口打开" href={`/${m.slug}.html`} target="_blank" rel="noopener">↗</a>
            {page && <a className="win-btn" title="打开 NocoBase 页面" href={page} target="_blank" rel="noopener">🔗</a>}
            <button className="win-btn win-close" title="关闭" onClick={() => setSel(null)}>✕</button>
          </div>
        </div>

        {/* 链路回溯:线 tabs + 该线轮次 timeline */}
        <div className="tm-trace">
          <div className="tm-tabs">{modBranchIds(m).map((bid: string) => <button key={bid} className={'btn' + (bid === b ? ' on' : '')} onClick={() => { setB(bid); setR(curRound(m, bid)); }}>{gLabel(mods, bid)}</button>)}</div>
          <div className="tm-rounds">{rounds.filter((rr: any) => hasData(modBR(m, b, rr.id))).map((rr: any) => { const x = modBR(m, b, rr.id); return <button key={rr.id} className={'troundchip' + (rr.id === r ? ' on' : '')} onClick={() => setR(rr.id)}><b>{rr.id.toUpperCase()}</b>{typeof x.aiScore === 'number' ? ' · AI ' + x.aiScore : ''}{aiVerdict(x) ? ' · ' + aiVerdict(x) : ''}</button>; })}</div>
        </div>

        <div className="tm-body">
          <div className="tm-left" style={hideSide ? { borderRight: 0 } : undefined}>
            {mainView === 'proto'
              ? <iframe className="tm-proto" src={`/${m.slug}.html`} title="原型预览" />
              : rd.image ? <img className="tm-img" src={imgSrc(rd.image)} onClick={() => setLight(imgSrc(rd.image))} alt="" /> : <div className="muted" style={{ padding: 40 }}>无对比图</div>}
          </div>
          {!hideSide && <div className="tm-right">
            <div className="sect">当前详情</div>
            <div className="dgrid">
              <div>线 / 轮</div><div>{gLabel(mods, b)} · {r.toUpperCase()}</div>
              <div>AI 分 / 结论</div><div>{typeof rd.aiScore === 'number' ? rd.aiScore + '/10' : '—'} {aiVerdict(rd) && <span className={'pill ' + aiVerdict(rd)}>{aiVerdict(rd)}</span>}</div>
              <div>模型</div><div>{bo.model || '—'}</div>
              <div>skill 版本</div><div>{bo.skillVersion || '—'}</div>
            </div>
            {rd.reasoning?.length ? <><div className="sect">AI 评述</div><ul className="tm-reason">{rd.reasoning.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></> : null}

            <div className="sect">关联文件</div>
            <div className="tm-files">
              {rd.image && <div>🖼️ 对比图:<a href={imgSrc(rd.image)} target="_blank" rel="noopener">{rd.image.split('/').pop()}</a></div>}
              {bk ? <div>💾 备份:<code className="mono">{bk.file}</code> @ {bk.env} ({bk.date}{bk.sizeKiB ? ' · ' + bk.sizeKiB + 'KiB' : ''})<br /><span className="muted mono" style={{ fontSize: 11 }}>nb api backup restore --filename {bk.file} -e {bk.env} --yes</span>{bk.note ? <div className="muted" style={{ fontSize: 11 }}>{bk.note}</div> : null}</div> : <div className="muted">无关联备份</div>}
              {page && <div>🔗 页面:<a href={page} target="_blank" rel="noopener">{page}</a></div>}
            </div>

            <div className="sect">关联跑测记录 ({related.length})</div>
            {related.length ? related.map((run: any) => <RelatedRun key={run.id} run={run} />) : <div className="muted">无(此模块未关联到跑测会话;01/02/03 对应 bench inventory/asset/content)</div>}

            <div className="sect">人工核验 · 评分</div>
            <ReviewBox key={m.id + b + r} {...{ m, b, r, e, uv, reachable, patch, setSel }} />
          </div>}
        </div>
      </div>
    </div>
  );
}

function RelatedRun({ run }: { run: any }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<any>(null);
  useEffect(() => { if (open && !d) getJSON('/api/runs/' + encodeURIComponent(run.id)).then(setD).catch(() => setD({ error: 1 })); }, [open]);
  const tr = d?.transcript || [];
  const arts = d?.record?.artifacts || [];
  return (
    <div className="relrun">
      <div className="relrun-h" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'} <b>{run.id}</b></span>
        <span className="muted">{run.model} · {run.outcome?.status} · err {run.errors?.count || 0}</span>
        <Link to={'/runs/' + run.id} onClick={(e) => e.stopPropagation()} style={{ marginLeft: 'auto' }}>跑测详情 ↗</Link>
      </div>
      {open && <div className="relrun-b">
        {!d ? <span className="muted">加载…</span> : <>
          {arts.length ? <div className="shots">{arts.map((a: any, i: number) => a.kind === 'image' || !a.kind ? <a key={i} href={'/runs-artifacts/' + a.file} target="_blank" rel="noopener"><img src={'/runs-artifacts/' + a.file} style={{ maxHeight: 120 }} /></a> : <a key={i} href={'/runs-artifacts/' + a.file} target="_blank" rel="noopener">📎 {a.label}</a>)}</div> : null}
          <div className="relrun-log">{tr.slice(-40).map((t: any, i: number) => <div className={'t-row t-' + (t.t === 'text' ? (t.role || 'a') : t.t)} key={i}>{t.t === 'tool' ? <><span className="t-tool">▸ {t.tool}</span> <span className="mono">{(t.cmd || '').slice(0, 160)}</span></> : t.t === 'reasoning' ? <span className="t-reasoning">🤔 {(t.text || '').slice(0, 240)}</span> : <><b>{t.role}</b> {(t.text || '').slice(0, 400)}</>}</div>)}</div>
        </>}
      </div>}
    </div>
  );
}

function ReviewBox({ m, b, r, e, uv, reachable, patch, setSel }: any) {
  const [verdict, setVerdict] = useState(uv || '');
  const [score, setScore] = useState(e.score != null ? String(e.score) : '');
  const [note, setNote] = useState(e.note || '');
  const [msg, setMsg] = useState('');
  const save = async () => { const res = await patch(r, m.id, b, { verdict: verdict || null, score: score === '' ? null : parseFloat(score), note: note || null }); setMsg(res?.error ? '失败:' + res.error : '已保存 ✓'); };
  return (
    <div className="review">
      <div className="vbtns">
        {VERDICTS.map((v) => <button key={v} disabled={!reachable} className={'btn ' + v + (verdict === v ? ' on' : '')} onClick={() => setVerdict(verdict === v ? '' : v)}>{v}</button>)}
        <span style={{ marginLeft: 12 }}>分 <input type="number" min={0} max={10} step={0.5} disabled={!reachable} value={score} onChange={(ev) => setScore(ev.target.value)} /></span>
      </div>
      <textarea placeholder="备注 / 结论…" disabled={!reachable} value={note} onChange={(ev) => setNote(ev.target.value)} />
      <div><button className="save" disabled={!reachable} onClick={save}>保存</button> <span className="muted" style={{ marginLeft: 10 }}>{msg}</span></div>
    </div>
  );
}
