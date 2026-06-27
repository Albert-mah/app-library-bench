// Interim: embed a not-yet-ported legacy page inside the unified shell.
export default function Embed({ src, title }: { src: string; title: string }) {
  return (
    <div style={{ height: 'calc(100vh - 52px)', display: 'flex', flexDirection: 'column' }}>
      <div className="bar" style={{ borderBottom: '1px solid var(--split)' }}>
        <span className="muted">{title} · 旧页内嵌(React 原生版迁移中)</span>
        <a className="btn" href={src} target="_blank" rel="noopener" style={{ marginLeft: 'auto' }}>新窗口打开 ↗</a>
      </div>
      <iframe src={src} title={title} style={{ flex: 1, border: 0, width: '100%' }} />
    </div>
  );
}
