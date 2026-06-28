import { useEffect, useRef, useState } from 'react';
import { getJSON } from '../lib/api';

const COLS: [string, string, string][] = [
  ['qwen-plus', 'pure', 'plus·纯'], ['qwen-plus', 'html', 'plus·html'],
  ['qwen-max', 'pure', 'max·纯'], ['qwen-max', 'html', 'max·html'],
];
const SCN: [string, string][] = [['01', '库存 inventory'], ['02', '资产 asset'], ['03', '内容 content-cal']];
const fmtAge = (s: number) => (s >= 1e8 ? '' : s < 90 ? Math.round(s) + 's' : s < 5400 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h');

export default function BenchLive() {
  const [cells, setCells] = useState<Record<string, any>>({});
  const [updated, setUpdated] = useState('');
  const [cur, setCur] = useState<string | null>(null);
  const [curKey, setCurKey] = useState('');
  const [items, setItems] = useState<any[] | null>(null);
  const curRef = useRef<string | null>(null);
  curRef.current = cur;
  const logRef = useRef<HTMLDivElement>(null);

  async function loadList() {
    try {
      const d = await getJSON('/api/bench-live');
      const map: Record<string, any> = {};
      (d.cells || []).forEach((c: any) => { map[c.cell] = c; });
      setCells(map);
      setUpdated('刷新 ' + new Date((d.updated || 0) * 1000).toLocaleTimeString());
    } catch { setUpdated('API 错误'); }
  }
  async function pumpStream() {
    const sid = curRef.current; if (!sid) return;
    try {
      const d = await getJSON('/api/bench-live?session=' + sid + '&tail=1&size=400');
      setItems(d.items || []);
      setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 0);
    } catch { /* keep last */ }
  }
  useEffect(() => { loadList(); const t = setInterval(loadList, 5000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => { if (curRef.current) pumpStream(); }, 4000); return () => clearInterval(t); }, []);

  function open(sid: string, key: string) { setCur(sid); setCurKey(key); setItems(null); curRef.current = sid; pumpStream(); }
  function close() { setCur(null); setItems(null); }

  return (
    <>
      <nav className="bl-head">
        <b>Bench Live</b>
        <span className="muted">model × flow × scenario · opencode 实时会话(自动关联)</span>
        <span className="legend">
          <span><i className="dot done" />done</span>
          <span><i className="dot working" />working</span>
          <span><i className="dot stalled" />stalled</span>
          <span className="muted">{updated}</span>
        </span>
      </nav>
      <div className="bl-wrap">
        <div className="bl-grid">
          <table className="mx">
            <thead><tr><th /> {COLS.map((c) => <th key={c[2]}>{c[2]}</th>)}</tr></thead>
            <tbody>
              {SCN.map(([sc, scl]) => (
                <tr key={sc}>
                  <td className="scn">#{sc}<br />{scl}</td>
                  {COLS.map(([m, f]) => {
                    const key = `${m}-${f}-${sc}`, c = cells[key];
                    if (!c) return <td key={key}><div className="cell empty"><div className="crow"><span className="dot idle" /><span className="ttl">{m.replace('qwen-', '')}·{f}</span></div><div className="last">— 未开始 —</div></div></td>;
                    return (
                      <td key={key}>
                        <button className={'cell' + (cur === c.session ? ' sel' : '')} onClick={() => open(c.session, key)}>
                          <div className="crow"><span className={'dot ' + c.status} /><span className="ttl">{c.model.replace('qwen-', '')}·{c.flow}</span>
                            <span className="meta">{c.tokensOut || 0} tok · {c.parts}p · {fmtAge(c.ageSec)}</span></div>
                          <div className="last">{c.last || ''}</div>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="stream">
          <div className="shead"><b>{cur ? curKey + ' · ' + cur.slice(0, 18) : '点左侧任意格看实时活动'}</b>{cur && <span className="x" onClick={close}>×</span>}</div>
          <div className="slog" ref={logRef}>
            {!cur ? <div className="empty-stream">选一个 cell 查看它的 opencode 会话流(分页轮询)。</div>
              : items == null ? <div className="empty-stream">加载…</div>
                : items.length === 0 ? <div className="empty-stream">暂无活动</div>
                  : items.map((it, i) => { const k = ['think', 'tool', 'say', 'step'].includes(it.kind) ? it.kind : 'think'; return <div className={'it ' + k} key={i}><span className="k">{it.kind}</span>{it.text}</div>; })}
          </div>
        </div>
      </div>
    </>
  );
}
