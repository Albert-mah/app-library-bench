import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJSON, postJSON } from '../lib/api';

type Mod = any;
const pad2 = (n: any) => String(n).padStart(2, '0');
const KINDS: [string, string][] = [['html', 'HTML 原型'], ['prompt', 'Prompt 原型'], ['info', '信息原型'], ['composite', '组合原型']];

export default function Gallery() {
  const [mods, setMods] = useState<Mod[] | null>(null);
  const [user, setUser] = useState<Mod[]>([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<Mod | null>(null);
  const [creating, setCreating] = useState(false);

  const loadUser = () => getJSON<Mod[]>('/api/prototypes').then(setUser).catch(() => setUser([]));
  useEffect(() => { getJSON<{ modules: Mod[] }>('/library.json').then((d) => setMods(d.modules || [])).catch((e) => setErr(String(e))); loadUser(); }, []);

  const all = useMemo(() => [...(mods || []), ...user], [mods, user]);
  const rows = useMemo(() => {
    const k = q.toLowerCase().trim();
    if (!k) return all;
    return all.filter((m) => (`${m.num || ''} ${m.cn || ''} ${m.name || ''} ${m.en || ''} ${m.desc || ''} ${(m.tags || []).join(' ')}`).toLowerCase().includes(k));
  }, [all, q]);

  if (err) return <div className="loading">加载失败:{err}</div>;
  if (!mods) return <div className="loading">加载中…</div>;

  return (
    <>
      <div className="pagehead"><h1>企业应用示例库</h1><span className="sub">{all.length} 个原型 · 点卡片看详情(嵌入原型 / Prompt / 信息 + 侧栏)</span></div>
      <div className="bar">
        <input type="search" placeholder="搜索 名称 / 英文 / 描述 / 标签…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" onClick={() => setCreating(true)}>+ 新建原型</button>
        <span className="muted">显示 {rows.length} / {all.length}</span>
      </div>
      <div className="wrap">
        <div className="grid">
          {rows.map((m) => (
            <div className="card" key={m.slug} onClick={() => setSel(m)} style={{ cursor: 'pointer' }}>
              <div className="thumb" style={{ backgroundImage: `url(/thumbs/${pad2(m.num)}.jpg)` }}>
                {m.num != null && <span className="num">#{pad2(m.num)}</span>}
                {m.source === 'user' && <span className="b" style={{ background: '#1677ff', position: 'absolute', top: 6, right: 6 }}>{m.kind}</span>}
                {m.series === 'v2' && <span className="b" style={{ background: '#7c3aed', position: 'absolute', top: 6, right: 6 }}>v2</span>}
              </div>
              <div className="body">
                <h3>{m.cn || m.name || m.slug}</h3>
                {m.en && <div className="en">{m.en}</div>}
                {m.desc && <div className="desc">{m.desc}</div>}
                <div>{(m.tags || []).slice(0, 4).map((t: string) => <span className="tag" key={t}>{t}</span>)}</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
                  <span className="muted" style={{ fontSize: 12 }}>详情 →</span>
                  {m.test && m.test !== 'none' && <Link to={`/tests?mod=${m.num ?? m.slug}`} onClick={(e) => e.stopPropagation()}>测试 →</Link>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {sel && <ProtoModal m={sel} onClose={() => setSel(null)} onDeleted={() => { setSel(null); loadUser(); }} />}
      {creating && <CreateForm onClose={() => setCreating(false)} onCreated={(m) => { setCreating(false); loadUser().then(() => setSel(m)); }} />}
    </>
  );
}

function ProtoModal({ m, onClose, onDeleted }: { m: Mod; onClose: () => void; onDeleted: () => void }) {
  const [hideSide, setHideSide] = useState(false);
  const [full, setFull] = useState(true);
  // only user-created prototypes carry an authoritative display kind; curated modules use a
  // semantic `kind` (build type) so we always probe the .html for those.
  const useKind = m.source === 'user' ? (m.kind || null) : null;
  const [htmlOk, setHtmlOk] = useState<boolean | null>(useKind ? useKind === 'html' : null);
  const url = `/${m.slug}.html`;
  useEffect(() => {
    const h = (e: any) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    if (!useKind) fetch(url).then((r) => r.text()).then((t) => setHtmlOk(!t.includes('id="root"') && t.length > 400)).catch(() => setHtmlOk(false));
    return () => document.removeEventListener('keydown', h);
  }, [m.slug]);
  const kind = useKind || (htmlOk === null ? null : htmlOk ? 'html' : 'prompt');
  const kindLabel = (KINDS.find((k) => k[0] === kind)?.[1]) || '检测中';
  const stages = m.stages || {};
  const del = async () => { if (!confirm('删除该原型?')) return; await fetch('/api/prototypes/' + m.id, { method: 'DELETE' }); onDeleted(); };

  return (
    <div className={'tm-overlay' + (full ? ' tm-overlay-full' : '')} onClick={onClose}>
      <div className={'tm ' + (full ? 'tm-screen' : 'tm-full')} onClick={(e) => e.stopPropagation()}>
        <div className="tm-head">
          <span className="tm-num">#{pad2(m.num)}</span>
          <div><h2>{m.cn || m.name || m.slug}</h2><div className="muted" style={{ fontSize: 12 }}>{m.en} · {(m.tags || []).join(' / ')}</div></div>
          <span className="spacer" />
          <span className={'pill ' + (kind === 'html' ? 'pass' : 'fix')} style={{ marginRight: 8 }}>{kindLabel}</span>
          <button className="btn" onClick={() => setFull(!full)}>{full ? '退出全屏 ⤢' : '全屏 ⛶'}</button>
          <button className="btn" onClick={() => setHideSide(!hideSide)}>{hideSide ? '显示侧栏 ‹' : '隐藏侧栏 ›'}</button>
          {kind === 'html' && <a className="btn" href={url} target="_blank" rel="noopener">新窗口 ↗</a>}
          {m.test && m.test !== 'none' && <Link className="btn" to={`/tests?mod=${m.num ?? m.slug}`} onClick={onClose}>测试 →</Link>}
          <span className="closex" onClick={onClose}>×</span>
        </div>
        <div className="tm-body">
          <div className="tm-left" style={hideSide ? { borderRight: 0 } : undefined}><ProtoMain m={m} kind={kind} url={url} /></div>
          {!hideSide && <div className="tm-right">
            <div className="sect">原型信息</div>
            <div className="dgrid">
              <div>编号</div><div>#{pad2(m.num)}</div>
              <div>名称</div><div>{m.cn || m.name} <span className="muted">{m.en}</span></div>
              <div>分类</div><div>{(m.tags || []).join(' / ') || '—'}</div>
              <div>类型</div><div>{kindLabel}{m.source === 'user' ? ' · 用户创建' : ''}</div>
            </div>
            {Object.keys(stages).length > 0 && <><div className="sect">阶段</div><div className="pd-stages">{Object.entries(stages).map(([k, v]) => <span key={k} className={'stg stg-' + v}>{k}:{String(v)}</span>)}</div></>}
            {m.desc && <><div className="sect">描述</div><p style={{ fontSize: 13 }}>{m.desc}</p></>}
            {(m.content?.prompt || m.prompt) && <><div className="sect">提示词</div><pre>{m.content?.prompt || m.prompt}</pre></>}
            <div className="sect">入口</div>
            <div className="tm-files">
              {kind === 'html' && <div>🌐 <a href={url} target="_blank" rel="noopener">{m.slug}.html</a></div>}
              {m.test && m.test !== 'none' && <div>📊 <Link to={`/tests?mod=${m.num ?? m.slug}`} onClick={onClose}>该原型的测试记录 →</Link></div>}
              {m.source === 'user' && <div style={{ marginTop: 8 }}><button className="btn" onClick={del} style={{ color: 'var(--redo-fg)' }}>删除原型</button></div>}
            </div>
          </div>}
        </div>
      </div>
    </div>
  );
}

function ProtoMain({ m, kind, url }: { m: Mod; kind: string | null; url: string }) {
  if (kind === null) return <div className="muted" style={{ padding: 40 }}>检测原型类型…</div>;
  if (kind === 'html') return <iframe className="tm-proto" src={url} title="原型" />;
  const c = m.content || {};
  return (
    <div className="proto-doc">
      <div className="pd-kind">{kind === 'prompt' ? '📝 Prompt 原型' : kind === 'info' ? '📄 信息原型' : '🧩 组合原型'}</div>
      <h3>{m.cn || m.name}</h3>{m.desc && <p className="muted">{m.desc}</p>}
      {kind === 'prompt' && <div className="pd-prompt">{c.prompt || m.prompt || '(无 prompt)'}</div>}
      {kind === 'info' && (c.sections?.length
        ? c.sections.map((s: any, i: number) => <div key={i} style={{ marginTop: 12 }}><h4>{s.title}</h4><p style={{ whiteSpace: 'pre-wrap' }}>{s.body}</p></div>)
        : <p style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{c.text || ''}</p>)}
      {kind === 'composite' && (c.blocks || []).map((bk: any, i: number) => <div key={i} style={{ marginTop: 14 }}>
        {bk.type === 'html' ? <div dangerouslySetInnerHTML={{ __html: bk.value }} />
          : bk.type === 'image' ? <img src={bk.value} style={{ maxWidth: '100%' }} />
            : bk.type === 'prompt' ? <div className="pd-prompt">{bk.value}</div>
              : <p style={{ whiteSpace: 'pre-wrap' }}>{bk.value}</p>}
      </div>)}
    </div>
  );
}

function CreateForm({ onClose, onCreated }: { onClose: () => void; onCreated: (m: Mod) => void }) {
  const [kind, setKind] = useState('prompt');
  const [name, setName] = useState(''); const [en, setEn] = useState(''); const [desc, setDesc] = useState(''); const [tags, setTags] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');
  const label: any = { html: '粘贴完整 HTML', prompt: '一段提示词 Prompt', info: '信息正文(纯文本/分段)', composite: '组合块 JSON:[{"type":"text|html|prompt|image","value":"..."}]' };
  const submit = async () => {
    if (!name.trim()) { setMsg('请填名称'); return; }
    let content: any = {};
    if (kind === 'html') content = { html: body };
    else if (kind === 'prompt') content = { prompt: body };
    else if (kind === 'info') content = { text: body };
    else if (kind === 'composite') { try { content = { blocks: JSON.parse(body) }; } catch { setMsg('组合块 JSON 解析失败'); return; } }
    setMsg('提交中…');
    const res = await postJSON('/api/prototypes', { kind, name, en, desc, tags, content });
    if (res?.ok) onCreated(res.module); else setMsg('失败:' + (res?.error || ''));
  };
  return (
    <div className="tm-overlay" onClick={onClose}>
      <div className="cf" onClick={(e) => e.stopPropagation()}>
        <div className="tm-head"><h2>新建原型</h2><span className="spacer" /><span className="closex" onClick={onClose}>×</span></div>
        <div className="cf-body">
          <label>类型<div className="seg">{KINDS.map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div></label>
          <label>名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="如:库存管理" /></label>
          <div className="cf-row"><label>英文名<input value={en} onChange={(e) => setEn(e.target.value)} /></label><label>标签(逗号分隔)<input value={tags} onChange={(e) => setTags(e.target.value)} /></label></div>
          <label>描述<input value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          <label>{label[kind]}<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={kind === 'html' ? 12 : 7} /></label>
          <div><button className="save" onClick={submit}>创建</button> <span className="muted" style={{ marginLeft: 10 }}>{msg}</span></div>
        </div>
      </div>
    </div>
  );
}
