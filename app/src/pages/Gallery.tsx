import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJSON } from '../lib/api';

type Mod = {
  num?: number; slug: string; name?: string; cn?: string; title?: string; en?: string;
  desc?: string; tags?: string[]; series?: string; kind?: string;
  test?: string; prompt?: string; proto?: string; stages?: Record<string, string>;
};
const pad2 = (n: any) => String(n).padStart(2, '0');

export default function Gallery() {
  const [mods, setMods] = useState<Mod[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<Mod | null>(null);

  useEffect(() => { getJSON<{ modules: Mod[] }>('/library.json').then((d) => setMods(d.modules || [])).catch((e) => setErr(String(e))); }, []);

  const rows = useMemo(() => {
    if (!mods) return [];
    const k = q.toLowerCase().trim();
    if (!k) return mods;
    return mods.filter((m) => (`${m.num || ''} ${m.cn || ''} ${m.name || m.title || ''} ${m.en || ''} ${m.desc || ''} ${(m.tags || []).join(' ')}`).toLowerCase().includes(k));
  }, [mods, q]);

  if (err) return <div className="loading">加载失败:{err}</div>;
  if (!mods) return <div className="loading">加载中…</div>;

  return (
    <>
      <div className="pagehead"><h1>企业应用示例库</h1><span className="sub">{mods.length} 个原型 · 点卡片看详情(嵌入原型 / Prompt + 侧栏)</span></div>
      <div className="bar">
        <input type="search" placeholder="搜索 名称 / 英文 / 描述 / 标签…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted">显示 {rows.length} / {mods.length}</span>
      </div>
      <div className="wrap">
        <div className="grid">
          {rows.map((m) => (
            <div className="card" key={m.slug} onClick={() => setSel(m)} style={{ cursor: 'pointer' }}>
              <div className="thumb" style={{ backgroundImage: `url(/thumbs/${pad2(m.num)}.jpg)` }}>
                {m.num != null && <span className="num">#{pad2(m.num)}</span>}
                {m.series === 'v2' && <span className="b" style={{ background: '#7c3aed', position: 'absolute', top: 6, right: 6 }}>v2</span>}
              </div>
              <div className="body">
                <h3>{m.cn || m.name || m.title || m.slug}</h3>
                {m.en && <div className="en">{m.en}</div>}
                {m.desc && <div className="desc">{m.desc}</div>}
                <div>{(m.tags || []).slice(0, 4).map((t) => <span className="tag" key={t}>{t}</span>)}</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
                  <span className="muted" style={{ fontSize: 12 }}>详情 →</span>
                  {m.test && m.test !== 'none' && <Link to={`/tests?mod=${m.num ?? m.slug}`} onClick={(e) => e.stopPropagation()}>测试 →</Link>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {sel && <ProtoModal m={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function ProtoModal({ m, onClose }: { m: Mod; onClose: () => void }) {
  const [hideSide, setHideSide] = useState(false);
  const [htmlOk, setHtmlOk] = useState<boolean | null>(null); // null=检测中
  const url = `/${m.slug}.html`;
  useEffect(() => {
    const h = (e: any) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    // SPA 兜底会让缺失的 .html 也返回 index.html;抓回来检测是否真原型(非 SPA 外壳)
    fetch(url).then((r) => r.text()).then((t) => setHtmlOk(!t.includes('id="root"') && t.length > 400)).catch(() => setHtmlOk(false));
    return () => document.removeEventListener('keydown', h);
  }, [m.slug]);
  const kind = htmlOk === null ? '检测中' : htmlOk ? 'HTML 原型' : 'Prompt 原型';
  const stages = m.stages || {};

  return (
    <div className="tm-overlay" onClick={onClose}>
      <div className="tm" onClick={(e) => e.stopPropagation()}>
        <div className="tm-head">
          <span className="tm-num">#{pad2(m.num)}</span>
          <div><h2>{m.cn || m.name || m.slug}</h2><div className="muted" style={{ fontSize: 12 }}>{m.en} · {m.tags?.join(' / ')}</div></div>
          <span className="spacer" />
          <span className={'pill ' + (htmlOk ? 'pass' : 'fix')} style={{ marginRight: 8 }}>{kind}</span>
          <button className="btn" onClick={() => setHideSide(!hideSide)}>{hideSide ? '显示侧栏 ‹' : '隐藏侧栏 ›'}</button>
          {htmlOk && <a className="btn" href={url} target="_blank" rel="noopener">新窗口 ↗</a>}
          {m.test && m.test !== 'none' && <Link className="btn" to={`/tests?mod=${m.num ?? m.slug}`} onClick={onClose}>测试 →</Link>}
          <span className="closex" onClick={onClose}>×</span>
        </div>
        <div className="tm-body">
          <div className="tm-left" style={hideSide ? { borderRight: 0 } : undefined}>
            {htmlOk === null ? <div className="muted" style={{ padding: 40 }}>检测原型类型…</div>
              : htmlOk ? <iframe className="tm-proto" src={url} title="原型" />
                : <div className="proto-doc">
                    <div className="pd-kind">📝 Prompt 原型 · 由一段提示词定义(无静态 HTML)</div>
                    <h3>{m.cn || m.name}</h3>
                    {m.desc && <p className="muted">{m.desc}</p>}
                    <div className="pd-prompt">{m.prompt || '(无 prompt)'}</div>
                  </div>}
          </div>
          {!hideSide && <div className="tm-right">
            <div className="sect">原型信息</div>
            <div className="dgrid">
              <div>编号</div><div>#{pad2(m.num)}</div>
              <div>名称</div><div>{m.cn || m.name} <span className="muted">{m.en}</span></div>
              <div>分类</div><div>{m.tags?.join(' / ') || '—'}</div>
              <div>类型</div><div>{kind}{m.kind ? ' · ' + m.kind : ''}</div>
              <div>系列</div><div>{m.series || '—'}</div>
            </div>
            {Object.keys(stages).length > 0 && <><div className="sect">阶段</div><div className="pd-stages">{Object.entries(stages).map(([k, v]) => <span key={k} className={'stg stg-' + v}>{k}:{v}</span>)}</div></>}
            {m.desc && <><div className="sect">描述</div><p style={{ fontSize: 13 }}>{m.desc}</p></>}
            <div className="sect">提示词 (Prompt)</div>
            <pre>{m.prompt || '(无)'}</pre>
            <div className="sect">入口</div>
            <div className="tm-files">
              {htmlOk && <div>🌐 原型页:<a href={url} target="_blank" rel="noopener">{m.slug}.html</a></div>}
              {m.test && m.test !== 'none' && <div>📊 <Link to={`/tests?mod=${m.num ?? m.slug}`} onClick={onClose}>该原型的测试记录 →</Link></div>}
            </div>
          </div>}
        </div>
      </div>
    </div>
  );
}
