import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJSON } from '../lib/api';

// Unified "experiment" view: subject (prototype) → lines/rounds (batches) → runs → review.
// Cross-scenario: any prompt-driven subject (build / experiment / other) is listed once it
// has activity (test lines, associated runs, or reviews).
const MAIN = 'main';
const V = ['pass', 'fix', 'redo'];
const CAT: Record<string, string> = { build: '搭建', experiment: '实验', other: '其他' };
const pad2 = (n: any) => String(n).padStart(2, '0');
const scenarioOf = (id: string) => { const m = /(?:^|[-_])(0[1-9])(?:[-_]|$)/.exec(id || ''); return m ? m[1] : null; };
const branchObj = (m: any, b: string) => (m.branches && m.branches[b]) || null;
const hasData = (rd: any) => !!rd && (!!rd.image || !!(rd.reasoning && rd.reasoning.length));

export default function Experiments() {
  const [mods, setMods] = useState<any[]>([]);
  const [user, setUser] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [server, setServer] = useState<any>({});
  const [runs, setRuns] = useState<any[]>([]);
  const [q, setQ] = useState(''); const [cat, setCat] = useState(''); const [status, setStatus] = useState('');

  useEffect(() => {
    getJSON('/library.json').then((d) => { setMods(d.modules || []); setRounds((d.rounds || []).filter((r: any) => r.date)); }).catch(() => {});
    getJSON('/api/app-library-scores').then(setServer).catch(() => {});
    getJSON('/api/runs').then(setRuns).catch(() => {});
    getJSON('/api/prototypes').then(setUser).catch(() => {});
  }, []);

  const all = useMemo(() => [...mods, ...user], [mods, user]);
  const uVerdict = (mid: string, r: string, b: string) => { const e = server?.[b]?.[r]?.[mid]; return e && V.includes(e.verdict) ? e.verdict : null; };

  const exps = useMemo(() => {
    return all.map((m) => {
      const num = pad2(m.num);
      const branches = m.branches ? Object.keys(m.branches) : [];
      // test records = (branch × round-with-data)
      let records = 0, reviewed = 0; const vd: any = { pass: 0, fix: 0, redo: 0 };
      branches.forEach((b) => rounds.forEach((rr) => {
        const o = branchObj(m, b); const rd = o?.rounds?.[rr.id];
        if (hasData(rd)) { records++; const uv = uVerdict(m.id, rr.id, b); if (uv) { reviewed++; vd[uv]++; } }
      }));
      // associated runs (explicit runIds on branches, or scenario/lineage.module)
      const ridSet = new Set(branches.flatMap((b) => branchObj(m, b)?.runIds || []));
      const myRuns = runs.filter((r) => ridSet.has(r.id) || r.lineage?.module === num || scenarioOf(r.id) === num);
      const status = reviewed > 0 && reviewed >= records ? 'reviewed' : (records > 0 ? 'review' : (myRuns.length ? 'testing' : 'none'));
      return { m, num, lines: branches.length, records, runs: myRuns.length, reviewed, vd, status };
    }).filter((e) => e.records > 0 || e.runs > 0 || (e.m.category === 'experiment'));
  }, [all, rounds, server, runs]);

  const rows = useMemo(() => exps.filter((e) => {
    if (cat && (e.m.category || 'build') !== cat) return false;
    if (status && e.status !== status) return false;
    if (q && !(`${e.num} ${e.m.cn || ''} ${e.m.name || ''} ${(e.m.tags || []).join(' ')}`).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [exps, cat, status, q]);

  const tot = useMemo(() => ({
    subjects: exps.length, runs: exps.reduce((s, e) => s + e.runs, 0), records: exps.reduce((s, e) => s + e.records, 0),
    reviewed: exps.reduce((s, e) => s + e.reviewed, 0),
  }), [exps]);

  return (
    <>
      <div className="pagehead"><h1>实验总览</h1><span className="sub">实验对象 → 批次/测试线 → 跑测 → 评审 · 跨场景统一视图。NocoBase 搭建实验前置:nb CLI + skills + 本地 Docker</span></div>
      <div className="bar">
        <input type="search" placeholder="搜索 实验对象 / 标签…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">全部场景</option><option value="build">搭建</option><option value="experiment">实验记录</option><option value="other">其他</option></select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="testing">测试中</option><option value="review">审核中</option><option value="reviewed">已审核</option></select>
        <span className="stats" style={{ marginLeft: 'auto' }}>对象 <b>{tot.subjects}</b> · 测试记录 <b>{tot.records}</b> · 跑测 <b>{tot.runs}</b> · 已评 <b>{tot.reviewed}</b></span>
      </div>
      <div className="wrap">
        <table className="dtable">
          <thead><tr><th>#</th><th>实验对象</th><th>场景</th><th>类型</th><th>测试线</th><th>记录</th><th>关联跑测</th><th>评审</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.m.slug}>
                <td>{e.num}</td>
                <td><b>{e.m.cn || e.m.name}</b> <span className="muted">{e.m.en || ''}</span></td>
                <td><span className={'pill ' + (e.m.category === 'experiment' ? 'fix' : 'pass')}>{CAT[e.m.category || 'build']}</span></td>
                <td className="muted">{e.m.dataType || 'html'}</td>
                <td>{e.lines || '—'}</td>
                <td>{e.records || '—'}</td>
                <td>{e.runs ? <Link to={`/runs`}>{e.runs}</Link> : '—'}</td>
                <td>{e.records ? <>{e.reviewed}/{e.records} {e.vd.pass ? <span className="pill pass">{e.vd.pass}</span> : null} {e.vd.fix ? <span className="pill fix">{e.vd.fix}</span> : null} {e.vd.redo ? <span className="pill redo">{e.vd.redo}</span> : null}</> : '—'}</td>
                <td><span className={'pill ' + (e.status === 'reviewed' ? 'pass' : e.status === 'review' ? 'fix' : '')} style={e.status === 'testing' ? { background: '#f0f1f4' } : {}}>{e.status === 'reviewed' ? '已审核' : e.status === 'review' ? '审核中' : e.status === 'testing' ? '测试中' : '—'}</span></td>
                <td>
                  {(e.m.test && e.m.test !== 'none') || e.records ? <Link to={`/tests?mod=${e.num}`}>测试 →</Link> : null}
                  {' '}<Link to={`/?`} onClick={(ev) => { ev.preventDefault(); window.open(`/${e.m.slug}.html`, '_blank'); }}>原型 ↗</Link>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>无实验对象</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
