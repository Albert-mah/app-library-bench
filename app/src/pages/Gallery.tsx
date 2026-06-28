import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJSON, postJSON } from '../lib/api';

type Mod = any;
const pad2 = (n: any) => String(n).padStart(2, '0');
const KINDS: [string, string][] = [['html', 'HTML 原型'], ['prompt', 'Prompt 原型'], ['info', '信息原型'], ['composite', '组合原型']];
const CAT: Record<string, string> = { build: '搭建', experiment: '实验', other: '其他' };

export default function Gallery() {
  const [mods, setMods] = useState<Mod[] | null>(null);
  const [user, setUser] = useState<Mod[]>([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<Mod | null>(null);
  const [creating, setCreating] = useState(false);
  const [dt, setDt] = useState(''); const [cat, setCat] = useState(''); const [tag, setTag] = useState('');

  const loadUser = () => getJSON<Mod[]>('/api/prototypes').then(setUser).catch(() => setUser([]));
  useEffect(() => { getJSON<{ modules: Mod[] }>('/library.json').then((d) => setMods(d.modules || [])).catch((e) => setErr(String(e))); loadUser(); }, []);

  const all = useMemo(() => [...(mods || []), ...user], [mods, user]);
  const tags = useMemo(() => [...new Set(all.flatMap((m) => m.tags || []))].filter(Boolean).sort(), [all]);
  const rows = useMemo(() => {
    const k = q.toLowerCase().trim();
    return all.filter((m) => {
      if (dt && (m.dataType || 'html') !== dt) return false;
      if (cat && (m.category || 'build') !== cat) return false;
      if (tag && !(m.tags || []).includes(tag)) return false;
      if (k && !(`${m.num || ''} ${m.cn || ''} ${m.name || ''} ${m.en || ''} ${m.desc || ''} ${(m.tags || []).join(' ')}`).toLowerCase().includes(k)) return false;
      return true;
    });
  }, [all, q, dt, cat, tag]);

  if (err) return <div className="loading">加载失败:{err}</div>;
  if (!mods) return <div className="loading">加载中…</div>;

  return (
    <>
      <div className="pagehead"><h1>原型库</h1><span className="sub">{all.length} 个原型 · 点卡片看详情(嵌入原型 / Prompt / 信息 + 侧栏)</span></div>
      <div className="bar">
        <input type="search" placeholder="搜索 名称 / 英文 / 描述 / 标签…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">全部场景</option><option value="build">搭建</option><option value="experiment">实验记录</option><option value="other">其他</option></select>
        <select value={dt} onChange={(e) => setDt(e.target.value)}><option value="">全部类型</option><option value="html">HTML</option><option value="prompt">Prompt/资料</option></select>
        <select value={tag} onChange={(e) => setTag(e.target.value)}><option value="">全部标签</option>{tags.map((t) => <option key={t}>{t}</option>)}</select>
        <button className="btn primary" onClick={() => setCreating(true)}>+ 新建原型</button>
        <span className="muted" style={{ marginLeft: 'auto' }}>显示 {rows.length} / {all.length}</span>
      </div>
      <div className="wrap">
        <div className="grid">
          {rows.map((m) => (
            <div className="card" key={m.slug} onClick={() => setSel(m)} style={{ cursor: 'pointer' }}>
              <div className="thumb" style={{ backgroundImage: `url(/thumbs/${pad2(m.num)}.jpg)` }}>
                {m.num != null && <span className="num">#{pad2(m.num)}</span>}
                <span className={'catbadge cb-' + (m.category || 'build')}>{CAT[m.category || 'build']}</span>
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
          <span className={'pill ' + (kind === 'html' ? 'pass' : 'fix')} style={{ marginRight: 6 }}>{kindLabel}</span>
          <div className="win-ctrls">
            <button className="win-btn" title={hideSide ? '显示侧栏' : '隐藏侧栏'} onClick={() => setHideSide(!hideSide)}>{hideSide ? '◧' : '◨'}</button>
            {m.test && m.test !== 'none' && <Link className="win-btn" title="该原型的测试记录" to={`/tests?mod=${m.num ?? m.slug}`} onClick={onClose}>📊</Link>}
            {kind === 'html' && <a className="win-btn" title="新窗口打开" href={url} target="_blank" rel="noopener">↗</a>}
            <button className="win-btn" title={full ? '退出全屏' : '全屏'} onClick={() => setFull(!full)}>{full ? '⤡' : '⤢'}</button>
            <button className="win-btn win-close" title="关闭" onClick={onClose}>✕</button>
          </div>
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
            {m.goal && <><div className="sect">🎯 目标</div><p style={{ fontSize: 13 }}>{m.goal}</p></>}
            {m.background && <><div className="sect">📚 背景 / 材料</div><p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{m.background}</p></>}
            {(m.successCriteria || []).length > 0 && <><div className="sect">✅ 成功标准</div><ul style={{ fontSize: 13, paddingLeft: 18 }}>{m.successCriteria.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul></>}
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
  const [cat, setCat] = useState('experiment');
  const [name, setName] = useState(''); const [en, setEn] = useState(''); const [desc, setDesc] = useState(''); const [tags, setTags] = useState('');
  const [goal, setGoal] = useState(''); const [background, setBackground] = useState(''); const [criteria, setCriteria] = useState('');
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
    const res = await postJSON('/api/prototypes', { kind, category: cat, name, en, desc, tags, content, goal, background, successCriteria: criteria });
    if (res?.ok) onCreated(res.module); else setMsg('失败:' + (res?.error || ''));
  };
  return (
    <div className="tm-overlay" onClick={onClose}>
      <div className="cf" onClick={(e) => e.stopPropagation()}>
        <div className="tm-head"><h2>新建原型</h2><span className="spacer" /><span className="closex" onClick={onClose}>×</span></div>
        <div className="cf-body">
          <div className="cf-prereq">🧱 NocoBase 搭建类实验前置物料:① 已装 <code>nb</code> CLI ② 已装 nocobase skills ③ 本地有 Docker 环境(搭建策略与跑测依赖这些)</div>
          <div className="cf-prereq" style={{ background: '#f6ffed', borderColor: '#b7eb8f', color: '#389e0d' }}>📋 实验平台:信息尽量填全。<b>AI 创建时请把能填的字段都填上</b>(目标/背景材料/成功标准等),便于后续派发与评审。</div>
          <label>资料类型<div className="seg">{KINDS.map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div></label>
          <label>场景<div className="seg">{[['build', '搭建'], ['experiment', '实验记录'], ['other', '其他']].map(([k, l]) => <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{l}</button>)}</div></label>
          <label>名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="如:库存管理" /></label>
          <div className="cf-row"><label>英文名<input value={en} onChange={(e) => setEn(e.target.value)} /></label><label>标签(逗号分隔)<input value={tags} onChange={(e) => setTags(e.target.value)} /></label></div>
          <label>描述<input value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          <label>目标 Goal<input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="这个实验/原型要达成什么" /></label>
          <label>背景 / 材料 Background<textarea value={background} onChange={(e) => setBackground(e.target.value)} rows={3} placeholder="背景、依赖材料、上下文…" /></label>
          <label>成功标准 Success criteria<textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={3} placeholder="每行一条;判定通过的标准" /></label>
          <label>{label[kind]}<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={kind === 'html' ? 12 : 7} /></label>
          <div><button className="save" onClick={submit}>创建</button> <span className="muted" style={{ marginLeft: 10 }}>{msg}</span></div>
        </div>
      </div>
    </div>
  );
}
