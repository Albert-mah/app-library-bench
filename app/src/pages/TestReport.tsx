import { useEffect, useMemo, useRef, useState } from 'react';
import { getJSON, postJSON } from '../lib/api';

const MAIN = 'main';
const ALL_V = '__all__';
const MODEL_ORDER = ['Claude', 'DeepSeek-Pro', 'DeepSeek-Flash', 'Qwen', '其他'];
const VERDICTS = ['pass', 'fix', 'redo'] as const;
const imgSrc = (s?: string) => (s ? '/' + s.replace(/^\.?\//, '') : '');

type Round = { id: string; label?: string; date?: string };
type Mod = any;

// ---- ported helpers (pure) ----
const branchObj = (m: Mod, b: string) => (m.branches && m.branches[b]) || null;
const modBranchIds = (m: Mod): string[] => {
  if (!m.branches) return [];
  return Object.keys(m.branches).sort((a, b) => (a === MAIN ? -1 : b === MAIN ? 1 : 0));
};
const modBranchRound = (m: Mod, b: string, r: string) => { const o = branchObj(m, b); return (o && o.rounds && o.rounds[r]) || null; };
const hasRoundData = (rd: any) => !!rd && (!!rd.image || !!(rd.reasoning && rd.reasoning.length));
const branchSkillVersion = (mods: Mod[], bid: string) => { for (const m of mods) { const b = branchObj(m, bid); if (b) return b.skillVersion || 'v260605'; } return 'v260605'; };

function branchModelGroup(bid: string): string {
  if (bid === MAIN || bid === 'design' || bid === 'blind') return 'Claude';
  if (bid === 'blind-dspro') return 'DeepSeek-Pro';
  if (bid === 'blind-dsflash' || bid === 'flash-retest') return 'DeepSeek-Flash';
  if (bid === 'bench' || bid.startsWith('bench-') || bid.indexOf('qwen') >= 0) return 'Qwen';
  const hay = bid.toLowerCase();
  if (hay.indexOf('pro') >= 0) return 'DeepSeek-Pro';
  if (hay.indexOf('flash') >= 0) return 'DeepSeek-Flash';
  if (hay.indexOf('deepseek') >= 0 || hay.indexOf('ds') >= 0) return 'DeepSeek-Pro';
  if (hay.indexOf('claude') >= 0 || hay.indexOf('sonnet') >= 0 || hay.indexOf('opus') >= 0) return 'Claude';
  return '其他';
}
const globalBranchLabel = (mods: Mod[], bid: string) => {
  if (bid === MAIN) return '主应用线';
  for (const m of mods) { const b = branchObj(m, bid); if (b && b.label) return b.label; }
  return bid;
};

export default function TestReport() {
  const [mods, setMods] = useState<Mod[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [server, setServer] = useState<any>(null);
  const [reachable, setReachable] = useState(false);
  const [err, setErr] = useState('');
  // filters
  const [round, setRound] = useState(''); // '' = 最新(current)
  const [ver, setVer] = useState(ALL_V);
  const [tag, setTag] = useState('');
  const [branches, setBranches] = useState<string[]>([]); // [] = 全部线
  const [msOpen, setMsOpen] = useState(false);
  const [light, setLight] = useState<string | null>(null);

  useEffect(() => {
    getJSON('/library.json').then((d) => {
      setMods((d.modules || []).filter((m: Mod) => m.branches));
      setRounds((d.rounds || []).filter((r: Round) => r.date));
    }).catch((e) => setErr(String(e)));
    getJSON('/api/app-library-scores').then((d) => { setServer(d || {}); setReachable(true); }).catch(() => setReachable(false));
  }, []);

  const versions = useMemo(() => {
    const seen: any = {}, vs: string[] = [];
    mods.forEach((m) => Object.keys(m.branches).forEach((k) => { const v = m.branches[k]?.skillVersion || 'v260605'; if (!seen[v]) { seen[v] = 1; vs.push(v); } }));
    return vs.sort((a, b) => (a < b ? 1 : -1));
  }, [mods]);
  const verActive = ver !== ALL_V;
  const tags = useMemo(() => [...new Set(mods.map((m) => m.tag).filter(Boolean))].sort(), [mods]);

  const globalBranchList = useMemo(() => {
    const seen: any = {}, list: string[] = [];
    mods.forEach((m) => Object.keys(m.branches).forEach((k) => {
      if (k === MAIN || seen[k]) return;
      if (verActive && branchSkillVersion(mods, k) !== ver) return;
      seen[k] = 1; list.push(k);
    }));
    const withMain = !verActive || branchSkillVersion(mods, MAIN) === ver;
    return withMain ? [MAIN, ...list] : list;
  }, [mods, ver, verActive]);

  const modelGroups = useMemo(() => {
    const buckets: Record<string, string[]> = {};
    globalBranchList.forEach((b) => { const g = branchModelGroup(b); (buckets[g] = buckets[g] || []).push(b); });
    const out: { group: string; branches: string[] }[] = [];
    MODEL_ORDER.forEach((g) => { if (buckets[g]) { out.push({ group: g, branches: buckets[g] }); delete buckets[g]; } });
    Object.keys(buckets).forEach((g) => out.push({ group: g, branches: buckets[g] }));
    return out;
  }, [globalBranchList]);

  const branchAll = branches.length === 0;
  const viewBranch = branches.length === 1 && branches[0] !== MAIN ? branches[0] : MAIN;
  const modHasView = (m: Mod) => branchAll || branches.some((b) => !!branchObj(m, b));

  const readyRounds = rounds;
  const currentRoundId = (m: Mod, b: string) => {
    for (let i = readyRounds.length - 1; i >= 0; i--) if (hasRoundData(modBranchRound(m, b, readyRounds[i].id))) return readyRounds[i].id;
    return readyRounds.length ? readyRounds[readyRounds.length - 1].id : '';
  };

  // server reads
  const srv = (mid: string, r: string, b: string) => { const br = server?.[b]; return (br && br[r] && br[r][mid]) || null; };
  const userScore = (m: Mod, r: string, b: string) => { const e = srv(m.id, r, b); if (e && typeof e.score === 'number') return e.score; const rd = modBranchRound(m, b, r); return rd && rd.userScore != null ? rd.userScore : null; };
  const userVerdict = (m: Mod, r: string, b: string) => { const e = srv(m.id, r, b); return e && VERDICTS.includes(e.verdict) ? e.verdict : null; };
  const userNote = (m: Mod, r: string, b: string) => { const e = srv(m.id, r, b); if (e && typeof e.note === 'string') return e.note; const rd = modBranchRound(m, b, r); return (rd && rd.userNote) || ''; };
  const aiVerdict = (rd: any) => (rd && VERDICTS.includes(rd.verdict) ? rd.verdict : null);

  async function patch(r: string, mid: string, b: string, p: any) {
    const res = await postJSON('/api/app-library-scores', { round: r, module: mid, branch: b, ...p });
    if (res && typeof res === 'object' && !res.error) { setServer(res); setReachable(true); }
    return res;
  }

  const cards = useMemo(() => {
    return mods.filter((m) => modHasView(m) && (!tag || m.tag === tag)).map((m) => {
      const b = viewBranch;
      const r = round || currentRoundId(m, b);
      const rd = modBranchRound(m, b, r);
      return { m, b, r, rd };
    }).filter((c) => c.rd); // only those with data for that branch/round
  }, [mods, branches, tag, round, ver, server]);

  const stats = useMemo(() => {
    const s: any = { total: cards.length, pass: 0, fix: 0, redo: 0, reviewed: 0, ai: 0, aiN: 0 };
    cards.forEach((c) => { const v = userVerdict(c.m, c.r, c.b); if (v) { s[v]++; s.reviewed++; } if (typeof c.rd.aiScore === 'number') { s.ai += c.rd.aiScore; s.aiN++; } });
    return s;
  }, [cards, server]);

  if (err) return <div className="loading">加载失败:{err}</div>;
  if (!mods.length) return <div className="loading">加载中…</div>;

  const lineLabel = branchAll ? '全部线' : (branches.length === 1 ? globalBranchLabel(mods, branches[0]) : branches.length + ' 条线');

  return (
    <>
      <div className="pagehead">
        <h1>复刻测试中心</h1>
        <span className="sub">{mods.length} 个已测模块 · 原型↔复刻对比 · AI 评分 + 人工核验{reachable ? '' : ' · ⚠️ 评分服务未连(只读)'}</span>
      </div>

      <div className="bar" style={{ gap: 10 }}>
        <span className="muted">轮次</span>
        <button className={'btn' + (round === '' ? ' on' : '')} onClick={() => setRound('')}>最新</button>
        {readyRounds.map((r) => <button key={r.id} className={'btn' + (round === r.id ? ' on' : '')} onClick={() => setRound(r.id)}>{r.id.toUpperCase()}</button>)}
        <span className="sep" />
        <select value={ver} onChange={(e) => { setVer(e.target.value); setBranches([]); }}>
          <option value={ALL_V}>全部版本</option>
          {versions.map((v) => <option key={v} value={v}>skill {v}</option>)}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)}><option value="">全部分类</option>{tags.map((t) => <option key={t}>{t}</option>)}</select>
        <LineSelect {...{ open: msOpen, setOpen: setMsOpen, modelGroups, branches, setBranches, mods, label: lineLabel }} />
        <span className="muted" style={{ marginLeft: 'auto' }}>显示 {cards.length}</span>
      </div>

      <div className="bar" style={{ borderBottom: '1px solid var(--split)' }}>
        <span className="stats">
          共 <b>{stats.total}</b> · 已评 <b>{stats.reviewed}</b> · <span className="pill pass">pass {stats.pass}</span> <span className="pill fix">fix {stats.fix}</span> <span className="pill redo">redo {stats.redo}</span>
          {stats.aiN ? <> · 均 AI <b>{(stats.ai / stats.aiN).toFixed(1)}</b></> : null}
        </span>
      </div>

      <div className="wrap">
        <div className="grid tr-grid">
          {cards.map((c) => (
            <Card key={c.m.id + c.b} card={c} mods={mods} reachable={reachable}
              userScore={userScore(c.m, c.r, c.b)} userVerdict={userVerdict(c.m, c.r, c.b)} userNote={userNote(c.m, c.r, c.b)}
              aiVerdict={aiVerdict(c.rd)} onImg={setLight} onPatch={patch} multiBranch={modBranchIds(c.m).length > 1} />
          ))}
          {!cards.length && <div style={{ gridColumn: '1/-1', padding: 48, textAlign: 'center', color: 'var(--text3)' }}>该筛选下没有用例</div>}
        </div>
      </div>

      {light && <div className="lightbox" onClick={() => setLight(null)}>
        <span className="lb-close">×</span><img src={light} alt="" onClick={(e) => e.stopPropagation()} />
      </div>}
    </>
  );
}

function LineSelect({ open, setOpen, modelGroups, branches, setBranches, mods, label }: any) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: any) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', h); return () => document.removeEventListener('click', h);
  }, [setOpen]);
  const toggle = (b: string) => setBranches((p: string[]) => (p.includes(b) ? p.filter((x) => x !== b) : [...p, b]));
  const groupAll = (bs: string[]) => { const all = bs.every((b) => branches.includes(b)); setBranches((p: string[]) => all ? p.filter((x) => !bs.includes(x)) : [...new Set([...p, ...bs])]); };
  return (
    <div className="ms" ref={ref}>
      <button className="btn" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>线:{label} ▾</button>
      {open && (
        <div className="ms-pop" onClick={(e) => e.stopPropagation()}>
          <div className="ms-top"><button className="btn" onClick={() => setBranches([])}>全部线</button><button className="btn" onClick={() => setBranches([])}>清空</button><button className="btn primary" onClick={() => setOpen(false)}>完成</button></div>
          {modelGroups.map((g: any) => (
            <div className="ms-grp" key={g.group}>
              <div className="ms-gh" onClick={() => groupAll(g.branches)}><b>{g.group}</b> <span className="muted">全选</span></div>
              {g.branches.map((b: string) => (
                <label className="ms-it" key={b}>
                  <input type="checkbox" checked={branches.includes(b)} onChange={() => toggle(b)} />
                  {globalBranchLabel(mods, b)} <span className="muted">[{b}]</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ card, mods, reachable, userScore, userVerdict, userNote, aiVerdict, onImg, onPatch, multiBranch }: any) {
  const { m, b, r, rd } = card;
  const [verdict, setVerdict] = useState(userVerdict || '');
  const [score, setScore] = useState(userScore != null ? String(userScore) : '');
  const [note, setNote] = useState(userNote || '');
  const [msg, setMsg] = useState('');
  useEffect(() => { setVerdict(userVerdict || ''); setScore(userScore != null ? String(userScore) : ''); setNote(userNote || ''); }, [m.id, b, r]);
  const save = async () => {
    const res = await onPatch(r, m.id, b, { verdict: verdict || null, score: score === '' ? null : parseFloat(score), note: note || null });
    setMsg(res?.error ? '失败:' + res.error : '已保存');
  };
  return (
    <div className="card tr-card">
      <div className="thumb tr-thumb" style={{ backgroundImage: rd.image ? `url(${imgSrc(rd.image)})` : '' }} onClick={() => rd.image && onImg(imgSrc(rd.image))}>
        <span className="num">{String(m.num).padStart(2, '0')}</span>
        <span className="rbadge">{r.toUpperCase()} · {globalBranchLabel(mods, b)}</span>
      </div>
      <div className="body">
        <h3>{m.cn || m.name}</h3>
        {m.desc && <div className="desc">{m.desc}</div>}
        <div className="airow">
          {typeof rd.aiScore === 'number' && <span className="aiscore">AI {rd.aiScore}/10</span>}
          {aiVerdict && <span className={'pill ' + aiVerdict}>{aiVerdict}</span>}
        </div>
        {rd.reasoning?.length ? <div className="reason">{rd.reasoning.join(' ')}</div> : null}
        {multiBranch && <div className="bchips">{modBranchIds(m).map((bid: string) => <span key={bid} className={'bchip' + (bid === b ? ' sel' : '')}>{globalBranchLabel(mods, bid)}</span>)}</div>}
        <div className="review-mini">
          <div className="vbtns">
            {VERDICTS.map((v) => <button key={v} disabled={!reachable} className={'btn ' + v + (verdict === v ? ' on' : '')} onClick={() => setVerdict(verdict === v ? '' : v)}>{v}</button>)}
            <input type="number" min={0} max={10} step={0.5} placeholder="分" disabled={!reachable} value={score} onChange={(e) => setScore(e.target.value)} />
          </div>
          <textarea placeholder="备注…" disabled={!reachable} value={note} onChange={(e) => setNote(e.target.value)} />
          <div><button className="save" disabled={!reachable} onClick={save}>保存</button> <span className="muted">{msg}</span></div>
        </div>
      </div>
    </div>
  );
}
