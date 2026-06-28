import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getJSON, postJSON, fmtTime } from '../lib/api';

const st = (r: any) => r?.outcome?.status || 'unknown';
const scenarioOfRun = (id: string) => { const m = /(?:^|[-_])(0[1-9])(?:[-_]|$)/.exec(id || ''); return m ? m[1] : null; };
const COLS: [string, string, (r: any) => any][] = [
  ['startedAt', '时间', (r) => fmtTime(r?.timing?.startedAt)],
  ['id', 'ID', (r) => r.id],
  ['model', '模型', (r) => r.model || ''],
  ['cli', 'CLI', (r) => r.cli || ''],
  ['env', '实例', (r) => r?.target?.env || ''],
  ['status', '状态', (r) => <span className={'s-' + st(r)}>{st(r)}</span>],
  ['rounds', '轮次', (r) => r.rounds ?? ''],
  ['toolCalls', '工具', (r) => r.toolCalls ?? ''],
  ['errors', '报错', (r) => { const n = r?.errors?.count || 0; return n ? <span className="err-n">{n}</span> : '0'; }],
  ['out', '输出tok', (r) => r?.tokens?.output || ''],
  ['dur', '时长', (r) => (r?.timing?.durationSec != null ? r.timing.durationSec + 's' : '')],
  ['verdict', '结论', (r) => (r?.review?.verdict ? <span className={'pill ' + r.review.verdict}>{r.review.verdict}</span> : '')],
  ['score', '分', (r) => (r?.review?.score != null ? r.review.score : '')],
];
function sortVal(r: any, k: string) {
  if (k === 'startedAt') return r?.timing?.startedAt || '';
  if (k === 'out') return r?.tokens?.output || 0;
  if (k === 'dur') return r?.timing?.durationSec || 0;
  if (k === 'errors') return r?.errors?.count || 0;
  if (k === 'status') return st(r);
  if (k === 'env') return r?.target?.env || '';
  if (k === 'verdict') return r?.review?.verdict || '';
  if (k === 'score') return r?.review?.score ?? -1;
  return r[k] ?? '';
}

export default function Runs() {
  const [data, setData] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [fModel, setFModel] = useState(''); const [fCli, setFCli] = useState('');
  const [fStatus, setFStatus] = useState(''); const [fVerdict, setFVerdict] = useState('');
  const [sortKey, setSortKey] = useState('startedAt'); const [sortDir, setSortDir] = useState(-1);
  const [tree, setTree] = useState(false);
  const nav = useNavigate();
  const { id: selId } = useParams();

  const load = () => getJSON<any[]>('/api/runs').then(setData).catch(() => {});
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    let r = data.filter((x) => {
      if (fModel && x.model !== fModel) return false;
      if (fCli && x.cli !== fCli) return false;
      if (fStatus && st(x) !== fStatus) return false;
      if (fVerdict) { const v = x?.review?.verdict; if (fVerdict === 'none' ? v : v !== fVerdict) return false; }
      if (q) { const hay = (x.id + ' ' + (x.model || '') + ' ' + (x.tags || []).join(' ') + ' ' + (x?.prompt?.text || '')).toLowerCase(); if (!hay.includes(q.toLowerCase())) return false; }
      return true;
    });
    r = [...r].sort((a, b) => { const x = sortVal(a, sortKey), y = sortVal(b, sortKey); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
    return r;
  }, [data, q, fModel, fCli, fStatus, fVerdict, sortKey, sortDir]);

  const models = [...new Set(data.map((r) => r.model).filter(Boolean))].sort();
  const clis = [...new Set(data.map((r) => r.cli).filter(Boolean))].sort();
  const stats = useMemo(() => {
    const sv: any = {}, vv: any = {};
    data.forEach((r) => { sv[st(r)] = (sv[st(r)] || 0) + 1; const v = r?.review?.verdict; if (v) vv[v] = (vv[v] || 0) + 1; });
    return { sv, vv };
  }, [data]);

  function clickHead(k: string) { if (sortKey === k) setSortDir(-sortDir); else { setSortKey(k); setSortDir(1); } }
  function row(r: any, indent = 0) {
    return (
      <tr key={r.id} className={r.id === selId ? 'sel' : ''} onClick={() => nav('/runs/' + r.id)}>
        {COLS.map((c, i) => <td key={c[0]}>{i === 1 && indent ? <span style={{ paddingLeft: indent * 14 }}>↳ </span> : null}{c[2](r)}</td>)}
      </tr>
    );
  }
  function body() {
    if (!tree) return rows.map((r) => row(r));
    const byBatch: Record<string, any[]> = {};
    rows.forEach((r) => { const b = r?.lineage?.batch || '(未分组)'; (byBatch[b] = byBatch[b] || []).push(r); });
    const out: any[] = [];
    Object.keys(byBatch).sort().forEach((b) => {
      const grp = byBatch[b], ids = new Set(grp.map((r) => r.id));
      out.push(<tr className="grp" key={'g-' + b}><td colSpan={COLS.length}>🌳 批次 <b>{b}</b> · {grp.length} run</td></tr>);
      const childrenOf = (p: string) => grp.filter((r) => r?.lineage?.parent === p);
      const roots = grp.filter((r) => !r?.lineage?.parent || !ids.has(r.lineage.parent));
      const walk = (r: any, d: number) => { out.push(row(r, d)); childrenOf(r.id).forEach((c) => walk(c, d + 1)); };
      roots.forEach((r) => walk(r, 1));
    });
    return out;
  }

  return (
    <>
      <div className="pagehead">
        <h1>历次跑测</h1>
        <span className="stats">
          共 <b>{data.length}</b> · 显示 <b>{rows.length}</b> · done <b>{stats.sv.done || 0}</b> error <b>{stats.sv.error || 0}</b>
          {' · '}pass <b>{stats.vv.pass || 0}</b> fix <b>{stats.vv.fix || 0}</b> redo <b>{stats.vv.redo || 0}</b>
        </span>
      </div>
      <div className="bar">
        <input type="search" placeholder="搜索 id / 模型 / 标签 / 提示词…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={fModel} onChange={(e) => setFModel(e.target.value)}><option value="">全部模型</option>{models.map((m) => <option key={m}>{m}</option>)}</select>
        <select value={fCli} onChange={(e) => setFCli(e.target.value)}><option value="">全部 CLI</option>{clis.map((m) => <option key={m}>{m}</option>)}</select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">全部状态</option><option>done</option><option>error</option><option>unknown</option></select>
        <select value={fVerdict} onChange={(e) => setFVerdict(e.target.value)}><option value="">全部结论</option><option value="pass">pass</option><option value="fix">fix</option><option value="redo">redo</option><option value="none">未评</option></select>
        <button className={'btn' + (tree ? ' on' : '')} onClick={() => setTree(!tree)}>🌳 树视图</button>
      </div>
      <div className="runs-main">
        <div className="tablewrap">
          <table>
            <thead><tr>{COLS.map((c) => <th key={c[0]} onClick={() => clickHead(c[0])}>{c[1]}{!tree && sortKey === c[0] ? (sortDir < 0 ? ' ▾' : ' ▴') : ''}</th>)}</tr></thead>
            <tbody>{body()}</tbody>
          </table>
        </div>
        <aside className={'drawer' + (selId ? ' open' : '')}>
          {selId && <Detail id={selId} onClose={() => nav('/runs')} onSaved={load} />}
        </aside>
      </div>
    </>
  );
}

function Detail({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<any>(null);
  const [verdict, setVerdict] = useState(''); const [score, setScore] = useState<string>(''); const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    setD(null);
    getJSON('/api/runs/' + encodeURIComponent(id)).then((data) => {
      setD(data);
      const rev = data.review || data.record?.review || {};
      setVerdict(rev.verdict || ''); setScore(rev.score != null ? String(rev.score) : ''); setNote(rev.note || ''); setMsg('');
    }).catch(() => {});
  }, [id]);
  if (!d) return <div className="detail">加载中…</div>;
  const r = d.record || {}, tr = d.transcript || [], air = d.aiReview || {};
  const arts = r.artifacts || r.screenshots || [];
  const errs = r?.errors?.samples || [];
  const adopt = () => { if (air.verdict) setVerdict(air.verdict); if (air.score != null) setScore(String(air.score)); if (air.comment) setNote(air.comment); setMsg('已填入 AI 自评,确认后保存'); };
  const save = async () => {
    const res = await postJSON('/api/runs/' + encodeURIComponent(id) + '/review',
      { verdict: verdict || null, score: score === '' ? null : parseFloat(score), note: note || null });
    setMsg(res.ok ? '已保存' : '失败:' + (res.error || '')); onSaved();
  };
  return (
    <div className="detail">
      <span className="closex" onClick={onClose}>×</span>
      <h2>{r.id}</h2>
      <div className="muted">{r.model} · {r.cli} · {r?.target?.env}{r?.lineage?.batch ? ' · 批次 ' + r.lineage.batch : ''}{r?.lineage?.parent ? ' · ↳迭代自 ' + r.lineage.parent : ''}</div>
      {scenarioOfRun(r.id) && <div style={{ fontSize: 12, marginTop: 3 }}>↔ 关联原型:<Link to={`/tests?mod=${scenarioOfRun(r.id)}`}>测试中心 #{scenarioOfRun(r.id)}</Link> · <a href={`/${scenarioOfRun(r.id) === '01' ? '01-inventory-management' : scenarioOfRun(r.id) === '02' ? '02-asset-management' : '03-content-calendar'}.html`} target="_blank" rel="noopener">原型 ↗</a></div>}
      {arts.length > 0 && <div className="shots">{arts.map((a: any, i: number) => <Artifact a={a} key={i} />)}</div>}
      <div className="dgrid">
        <div>状态</div><div className={'s-' + st(r)}>{st(r)}</div>
        <div>时间</div><div>{fmtTime(r?.timing?.startedAt)} → {fmtTime(r?.timing?.endedAt)} ({r?.timing?.durationSec ?? '?'}s)</div>
        <div>轮次/工具</div><div>{r.rounds ?? '?'} 轮 · {r.toolCalls ?? '?'} 工具</div>
        <div>token</div><div>in {r?.tokens?.input ?? '?'} · out {r?.tokens?.output ?? '?'} · reasoning {r?.tokens?.reasoning ?? '?'}</div>
        <div>报错</div><div className={r?.errors?.count ? 'err-n' : ''}>{r?.errors?.count || 0}</div>
        <div>标签</div><div>{(r.tags || []).join(', ')}</div>
      </div>
      {errs.length > 0 && <>
        <div className="sect">报错样本 ({r.errors.count})</div>
        <div>{errs.slice(0, 20).map((e: any, i: number) => <div className="t-row" key={i}><span className="t-tool">{e.tool}</span> {e.msg}<br /><span className="muted mono">{(e.cmd || '').slice(0, 140)}</span></div>)}</div>
      </>}
      <div className="sect">提示词 {r?.prompt?.sha256 ? '· ' + r.prompt.sha256.slice(0, 10) : ''}</div>
      <pre>{r?.prompt?.text || '(无)'}</pre>
      <div className="sect">对话明细 ({tr.length})</div>
      <div>{tr.map((e: any, i: number) => <TItem e={e} key={i} />)}</div>
      <div className="review">
        {(air.verdict || air.score != null || air.comment) && (
          <div className="aibox">
            <div className="aihd">🤖 AI 自评 {air.verdict && <span className={'pill ' + air.verdict}>{air.verdict}</span>} {air.score != null && <b>{air.score}</b>}
              <button className="adopt" onClick={adopt}>采纳 →</button></div>
            <div style={{ margin: '6px 0', fontSize: 12 }}>{air.comment}</div>
            <div className="muted" style={{ fontSize: 11 }}>{air.model} {air.ts ? '· ' + fmtTime(air.ts) : ''}</div>
          </div>
        )}
        <div className="sect" style={{ border: 0, padding: 0 }}>人工核验 · 评分</div>
        <div className="vbtns">
          {['pass', 'fix', 'redo'].map((v) => (
            <button key={v} className={'btn ' + v + (verdict === v ? ' on' : '')} onClick={() => setVerdict(verdict === v ? '' : v)}>{v}</button>
          ))}
          <span style={{ marginLeft: 14 }}>分 <input type="number" min={0} max={10} step={0.5} value={score} onChange={(e) => setScore(e.target.value)} /></span>
        </div>
        <textarea placeholder="备注 / 结论…" value={note} onChange={(e) => setNote(e.target.value)} />
        <div><button className="save" onClick={save}>保存</button> <span className="muted" style={{ marginLeft: 10 }}>{msg}</span></div>
      </div>
    </div>
  );
}

function Artifact({ a }: { a: any }) {
  const url = '/runs-artifacts/' + a.file, k = a.kind || 'image';
  if (k === 'image') return <a href={url} target="_blank" rel="noopener"><img src={url} alt={a.label} /></a>;
  if (k === 'html') return <div className="art"><div className="muted">🌐 {a.label} <a href={url} target="_blank" rel="noopener">↗</a></div><iframe src={url} sandbox="" /></div>;
  if (k === 'text') return <div className="art"><div className="muted">📄 {a.label} <a href={url} target="_blank" rel="noopener">↗</a></div><TextArt url={url} /></div>;
  return <div className="art"><a href={url} download>⬇ {a.label || a.file}</a></div>;
}
function TextArt({ url }: { url: string }) {
  const [t, setT] = useState('…');
  useEffect(() => { fetch(url).then((r) => r.text()).then((x) => setT(x.slice(0, 6000))).catch(() => setT('(读取失败)')); }, [url]);
  return <pre>{t}</pre>;
}
function TItem({ e }: { e: any }) {
  if (e.t === 'text') return <div className={'t-row t-' + (e.role || 'assistant')}><b>{e.role}</b> {(e.text || '').slice(0, 1200)}</div>;
  if (e.t === 'reasoning') return <div className="t-row t-reasoning">🤔 {(e.text || '').slice(0, 500)}</div>;
  if (e.t === 'tool') return <div className="t-row t-tool">▸ <b>{e.tool}</b>{e.status ? ' · ' + e.status : ''} <span className="mono">{(e.cmd || '').slice(0, 200)}</span><span className="o">{(e.out || '').slice(0, 500)}</span></div>;
  return null;
}
