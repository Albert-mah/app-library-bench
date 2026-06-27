import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJSON } from '../lib/api';

type Mod = {
  num?: number; slug: string; name?: string; title?: string; en?: string;
  desc?: string; tags?: string[]; series?: string;
  test?: string; stages?: Record<string, string>;
};

export default function Gallery() {
  const [mods, setMods] = useState<Mod[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    getJSON<{ modules: Mod[] }>('/library.json')
      .then((d) => setMods(d.modules || []))
      .catch((e) => setErr(String(e)));
  }, []);

  const rows = useMemo(() => {
    if (!mods) return [];
    const k = q.toLowerCase().trim();
    if (!k) return mods;
    return mods.filter((m) =>
      (`${m.num || ''} ${m.name || m.title || ''} ${m.en || ''} ${m.desc || ''} ${(m.tags || []).join(' ')}`)
        .toLowerCase()
        .includes(k)
    );
  }, [mods, q]);

  if (err) return <div className="loading">加载失败:{err}</div>;
  if (!mods) return <div className="loading">加载中…</div>;

  return (
    <>
      <div className="pagehead">
        <h1>企业应用示例库</h1>
        <span className="sub">{mods.length} 个原型 · 缩略图为原型,点开看搭建效果</span>
      </div>
      <div className="bar">
        <input type="search" placeholder="搜索 名称 / 英文 / 描述 / 标签…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted">显示 {rows.length} / {mods.length}</span>
      </div>
      <div className="wrap">
        <div className="grid">
          {rows.map((m) => (
            <div className="card" key={m.slug}>
              <a className="thumb" href={`/${m.slug}.html`} target="_blank" rel="noopener"
                 style={{ backgroundImage: `url(thumbs/${m.slug}.png)` }}>
                {m.num != null && <span className="num">{String(m.num).padStart(2, '0')}</span>}
                {m.series === 'v2' && <span className="b" style={{ background: '#7c3aed', position: 'absolute', top: 6, right: 6 }}>v2</span>}
              </a>
              <div className="body">
                <h3>{m.name || m.title || m.slug}</h3>
                {m.en && <div className="en">{m.en}</div>}
                {m.desc && <div className="desc">{m.desc}</div>}
                <div>
                  {(m.tags || []).slice(0, 4).map((t) => <span className="tag" key={t}>{t}</span>)}
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
                  <a href={`/${m.slug}.html`} target="_blank" rel="noopener">原型 ↗</a>
                  {m.test && m.test !== 'none' && <Link to="/tests">测试 →</Link>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
