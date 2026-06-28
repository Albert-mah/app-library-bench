import { useEffect, useMemo, useState } from 'react';
import { getJSON } from '../lib/api';

const MAIN = 'main';
const branchObj = (m: any, b: string) => (m.branches && m.branches[b]) || null;
const modBR = (m: any, b: string, r: string) => { const o = branchObj(m, b); return (o && o.rounds && o.rounds[r]) || null; };
const hasData = (rd: any) => !!rd && (!!rd.image || !!(rd.reasoning && rd.reasoning.length));
const V = ['pass', 'fix', 'redo'];

export default function Dashboard() {
  const [mods, setMods] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [server, setServer] = useState<any>({});
  const [err, setErr] = useState('');

  useEffect(() => {
    getJSON('/library.json').then((d) => {
      setMods((d.modules || []).filter((m: any) => m.branches));
      setRounds((d.rounds || []).filter((r: any) => r.date));
    }).catch((e) => setErr(String(e)));
    getJSON('/api/app-library-scores').then(setServer).catch(() => getJSON('/user-scores.json').then(setServer).catch(() => setServer({})));
  }, []);

  const curRound = (m: any, b: string) => { for (let i = rounds.length - 1; i >= 0; i--) if (hasData(modBR(m, b, rounds[i].id))) return rounds[i].id; return rounds.length ? rounds[rounds.length - 1].id : ''; };
  const uVerdict = (mid: string, r: string, b: string) => { const e = server?.[b]?.[r]?.[mid]; return e && V.includes(e.verdict) ? e.verdict : null; };

  const D = useMemo(() => {
    if (!mods.length) return null;
    // main-line current round per module
    const main = mods.map((m) => { const r = curRound(m, MAIN); const rd = modBR(m, MAIN, r); return { m, r, rd }; }).filter((x) => x.rd);
    const vdist: any = { pass: 0, fix: 0, redo: 0, review: 0 };
    let aiSum = 0, aiN = 0, reviewed = 0;
    main.forEach(({ m, r, rd }) => {
      const uv = uVerdict(m.id, r, MAIN);
      if (uv) { vdist[uv]++; reviewed++; } else vdist.review++;
      if (typeof rd.aiScore === 'number') { aiSum += rd.aiScore; aiN++; }
    });
    // lines (branches)
    const lineIds: string[] = [];
    mods.forEach((m) => Object.keys(m.branches).forEach((k) => { if (!lineIds.includes(k)) lineIds.push(k); }));
    lineIds.sort((a, b) => (a === MAIN ? -1 : b === MAIN ? 1 : 0));
    const lines = lineIds.map((b) => {
      let n = 0, ai = 0, aiN2 = 0, pass = 0, rev = 0;
      mods.forEach((m) => { if (!branchObj(m, b)) return; const r = curRound(m, b); const rd = modBR(m, b, r); if (!rd) return; n++; if (typeof rd.aiScore === 'number') { ai += rd.aiScore; aiN2++; } const uv = uVerdict(m.id, r, b); if (uv) rev++; if (uv === 'pass') pass++; });
      return { b, n, avgAI: aiN2 ? ai / aiN2 : null, pass, rev };
    }).filter((l) => l.n > 0);
    // rounds (main) avg AI
    const roundStat = rounds.map((rr) => { let ai = 0, n = 0; mods.forEach((m) => { const rd = modBR(m, MAIN, rr.id); if (rd && typeof rd.aiScore === 'number') { ai += rd.aiScore; n++; } }); return { id: rr.id, label: rr.label, avgAI: n ? ai / n : null, n }; }).filter((x) => x.n);
    return { main, vdist, avgAI: aiN ? aiSum / aiN : 0, reviewed, lines, roundStat, tested: main.length };
  }, [mods, rounds, server]);

  if (err) return <div className="loading">加载失败:{err}</div>;
  if (!D) return <div className="loading">加载中…</div>;
  const max = Math.max(1, ...Object.values(D.vdist).map(Number));
  const lineLabel = (b: string) => (b === MAIN ? '主应用线' : (mods.find((m) => branchObj(m, b)?.label)?.branches[b].label || b));

  return (
    <>
      <div className="pagehead"><h1>搭建总览</h1><span className="sub">搭建情况 · 优化效果 · 成果(从 library.json + 评分实时算)</span></div>
      <div className="wrap">
        <div className="kpis">
          <Kpi label="已测模块" val={D.tested} />
          <Kpi label="已人工评审" val={D.reviewed} />
          <Kpi label="通过(pass)" val={D.vdist.pass} accent="var(--pass-fg)" />
          <Kpi label="主线均 AI 分" val={D.avgAI.toFixed(1)} accent="var(--primary)" />
        </div>

        <section className="dcard">
          <h2>主应用线 · 当前结论分布</h2>
          {(['pass', 'fix', 'redo', 'review'] as const).map((k) => (
            <div className="brow" key={k}>
              <span className="blab">{k === 'review' ? '待评审' : k}</span>
              <div className="btrack"><div className={'bfill ' + k} style={{ width: (D.vdist[k] / max * 100) + '%' }} /></div>
              <span className="bval">{D.vdist[k]}</span>
            </div>
          ))}
        </section>

        <section className="dcard">
          <h2>优化效果 · 各轮主线均 AI 分</h2>
          {D.roundStat.map((r) => (
            <div className="brow" key={r.id}>
              <span className="blab">{r.id.toUpperCase()} <span className="muted">{r.label}</span></span>
              <div className="btrack"><div className="bfill pass" style={{ width: ((r.avgAI || 0) / 10 * 100) + '%' }} /></div>
              <span className="bval">{r.avgAI != null ? r.avgAI.toFixed(1) : '—'} <span className="muted">/{r.n}</span></span>
            </div>
          ))}
        </section>

        <section className="dcard">
          <h2>复刻线成果对比</h2>
          <table className="dtable">
            <thead><tr><th>线</th><th>模块数</th><th>均 AI 分</th><th>已评</th><th>通过</th><th>通过率</th></tr></thead>
            <tbody>
              {D.lines.map((l) => (
                <tr key={l.b}>
                  <td>{lineLabel(l.b)} <span className="muted">[{l.b}]</span></td>
                  <td>{l.n}</td><td>{l.avgAI != null ? l.avgAI.toFixed(1) : '—'}</td><td>{l.rev}</td><td>{l.pass}</td>
                  <td>{l.rev ? Math.round(l.pass / l.rev * 100) + '%' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="dcard">
          <h2>模块明细(主线当前轮)</h2>
          <table className="dtable">
            <thead><tr><th>#</th><th>模块</th><th>轮</th><th>AI 分</th><th>AI 结论</th><th>人工结论</th></tr></thead>
            <tbody>
              {D.main.map(({ m, r, rd }) => {
                const uv = uVerdict(m.id, r, MAIN);
                return <tr key={m.id}>
                  <td>{String(m.num).padStart(2, '0')}</td><td>{m.cn || m.name}</td><td>{r.toUpperCase()}</td>
                  <td>{typeof rd.aiScore === 'number' ? rd.aiScore : '—'}</td>
                  <td>{rd.verdict && V.includes(rd.verdict) ? <span className={'pill ' + rd.verdict}>{rd.verdict}</span> : '—'}</td>
                  <td>{uv ? <span className={'pill ' + uv}>{uv}</span> : <span className="muted">待评</span>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </section>
        <p className="muted" style={{ fontSize: 12 }}>注:donut / 散点 / 搭建经济(build-audit)等图表暂以条形+表格呈现,后续可补原生图表。</p>
      </div>
    </>
  );
}

function Kpi({ label, val, accent }: { label: string; val: any; accent?: string }) {
  return <div className="kpi"><div className="kv" style={accent ? { color: accent } : undefined}>{val}</div><div className="kl">{label}</div></div>;
}
