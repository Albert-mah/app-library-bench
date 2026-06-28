import { useEffect, useRef, useState } from 'react';
import { getJSON } from '../lib/api';

// Live board = what is ACTUALLY running in tmux right now (not an opencode-DB history matrix).
// Each card is a real tmux session; clicking one streams its live pane.
const DOT: Record<string, string> = { working: 'working', done: 'done', permission: 'stalled', idle: 'idle', ended: 'idle' };
const LABEL: Record<string, string> = { working: '运行中', done: '已完成', permission: '待确认', idle: '空闲', ended: '已结束' };
const fmtAge = (s: number | null) => (s == null ? '' : s < 90 ? Math.round(s) + 's' : s < 5400 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h');

export default function BenchLive() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [updated, setUpdated] = useState('');
  const [err, setErr] = useState('');
  const [cur, setCur] = useState<string | null>(null);
  const [pane, setPane] = useState<string | null>(null);
  const curRef = useRef<string | null>(null);
  curRef.current = cur;
  const logRef = useRef<HTMLPreElement>(null);

  async function loadList() {
    try {
      const d = await getJSON('/api/bench-live');
      setSessions(d.sessions || []);
      setErr(d.error || '');
      setUpdated('刷新 ' + new Date((d.updated || 0) * 1000).toLocaleTimeString());
    } catch { setErr('API 错误'); }
  }
  async function pump() {
    const name = curRef.current; if (!name) return;
    try {
      const d = await getJSON('/api/bench-live?pane=' + encodeURIComponent(name));
      setPane(d.pane || '(空)');
      setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 0);
    } catch { /* keep last */ }
  }
  useEffect(() => { loadList(); const t = setInterval(loadList, 5000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => { if (curRef.current) pump(); }, 3000); return () => clearInterval(t); }, []);

  function open(name: string) { setCur(name); setPane(null); curRef.current = name; pump(); }

  const live = sessions.filter((s) => s.status === 'working' || s.status === 'permission').length;

  return (
    <>
      <nav className="bl-head">
        <b>Bench Live</b>
        <span className="muted">实时 tmux 运行会话(非历史矩阵)· {sessions.length} 个会话 · {live} 个活跃</span>
        <span className="legend">
          <span><i className="dot working" />运行中</span>
          <span><i className="dot stalled" />待确认</span>
          <span><i className="dot idle" />空闲/结束</span>
          <span><i className="dot done" />完成</span>
          <span className="muted">{updated}</span>
        </span>
      </nav>
      <div className="bl-wrap">
        <div className="bl-grid">
          {err && <div className="empty-stream" style={{ color: 'var(--redo-fg)' }}>{err}</div>}
          {!err && sessions.length === 0 && <div className="empty-stream">当前没有运行中的 tmux 会话。<br /><span className="muted">用 <code>npm run bench</code> 启动后会出现在这里。</span></div>}
          {(() => { const runs = sessions.filter((s) => s.isRun), others = sessions.filter((s) => !s.isRun); const card = (s: any) => {
            const r = s.run;
            return (
              <button key={s.name} className={'cell' + (cur === s.name ? ' sel' : '')} style={s.isRun ? undefined : { opacity: .55 }} onClick={() => open(s.name)}>
                <div className="crow">
                  <span className={'dot ' + (DOT[s.status] || 'idle')} title={LABEL[s.status] || s.status} />
                  <span className="ttl">{s.name}</span>
                  <span className="meta">{LABEL[s.status] || s.status} · {fmtAge(s.ageSec)}{s.attached ? ' · 看护中' : ''}</span>
                </div>
                {r && (r.id || r.env || r.model) && (
                  <div className="muted" style={{ fontSize: 11.5, marginBottom: 3 }}>{[r.id, r.recipe, r.env, r.model].filter(Boolean).join(' · ')}</div>
                )}
                {r?.goal && <div className="muted" style={{ fontSize: 11, marginBottom: 3, opacity: .85 }}>🎯 {r.goal}</div>}
                <div className="last">{s.last || '— 无输出 —'}</div>
              </button>
            );
          }; return (<>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>{runs.map(card)}</div>
            {others.length > 0 && <>
              <div className="muted" style={{ margin: '16px 0 8px', fontSize: 12, borderTop: '1px solid var(--split)', paddingTop: 10 }}>其他 tmux 会话(非本轮跑测) · {others.length}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>{others.map(card)}</div>
            </>}
          </>); })()}
        </div>
        <div className="stream">
          <div className="shead"><b>{cur ? cur + ' · 实时 pane' : '点左侧会话看实时终端'}</b>{cur && <span className="x" onClick={() => { setCur(null); setPane(null); }}>×</span>}</div>
          {!cur ? <div className="empty-stream">选一个会话,实时回显它的 tmux 终端(每 3s 轮询)。</div>
            : pane == null ? <div className="empty-stream">加载…</div>
              : <pre className="slog" ref={logRef} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{pane}</pre>}
        </div>
      </div>
    </>
  );
}
