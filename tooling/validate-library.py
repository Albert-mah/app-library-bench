#!/usr/bin/env python3
"""
Validate app-library/library.json — the pipeline single source of truth.

Checks (hand-rolled, no external deps; also runs jsonschema if installed):
  - required fields per module; unique num/id/slug
  - slug starts with "<num>-"
  - stages present + valid enums; stages.built==built, stages.tested==test (mirror)
  - stages.proto=='done'  <=>  <slug>.html exists on disk
  - stages.spec matches what's embedded in the HTML (machine nb-spec / human nb-decomp)
  - series in {v1,v2}; cross-file: oss-urls.json slugs <=> stages.published=='oss'
Exit 0 = PASS, 1 = FAIL.  Usage: python3 scripts/validate-library.py
"""
import json, os, sys, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB  = os.path.join(ROOT, 'web/library.json')
DIR  = os.path.join(ROOT, 'web')
OSS  = os.path.join(ROOT, 'tooling/oss-urls.json')
SCHEMA = os.path.join(ROOT, 'tooling/library.schema.json')

REQ = ['id','num','slug','tag','cn','name','en','desc','built','test','prompt','stages']
ENUM = {
  'built':  {'done','building','todo'},
  'test':   {'none','r1pass','r2pass','r1review','r2review','r3review'},
  's.proto':{'done','todo'},
  's.spec': {'none','machine','human','full'},
  's.published':{'no','oss','cms'},
  'series': {'v1','v2'},
}
errs=[]; warns=[]
def err(m): errs.append(m)
def warn(m): warns.append(m)

lib=json.load(open(LIB, encoding='utf-8'))
mods=lib.get('modules',[])

# top-level
for k in ('project','updated','ossBase','modules'):
    if k not in lib: err(f"top-level missing '{k}'")
if not re.match(r'^\d{4}-\d{2}-\d{2}$', str(lib.get('updated',''))): err("top-level 'updated' not YYYY-MM-DD")

def spec_state(slug):
    f=os.path.join(DIR, slug+'.html')
    if not os.path.exists(f): return 'none', False
    h=open(f,encoding='utf-8',errors='ignore').read()
    mach='application/nb-spec+json' in h
    hum=('id="nb-decomp"' in h) and ('specbtn' in h or 'specBtn' in h)
    return ('full' if mach and hum else 'machine' if mach else 'human' if hum else 'none'), True

seen_num=set(); seen_id=set(); seen_slug=set()
for m in mods:
    tag=m.get('num','?')
    for k in REQ:
        if k not in m: err(f"#{tag} missing '{k}'")
    num=m.get('num'); _id=m.get('id'); slug=m.get('slug','')
    if num in seen_num: err(f"duplicate num '{num}'")
    seen_num.add(num)
    if _id in seen_id: err(f"duplicate id '{_id}'")
    seen_id.add(_id)
    if slug in seen_slug: err(f"duplicate slug '{slug}'")
    seen_slug.add(slug)
    if _id!=num: warn(f"#{tag} id!=num ({_id}!={num})")
    if slug and not slug.startswith(str(num)+'-'): err(f"#{tag} slug '{slug}' does not start with '{num}-'")
    if m.get('built') not in ENUM['built']: err(f"#{tag} built '{m.get('built')}' invalid")
    if m.get('test') not in ENUM['test']: err(f"#{tag} test '{m.get('test')}' invalid")
    if 'series' in m and m['series'] not in ENUM['series']: err(f"#{tag} series '{m['series']}' invalid")
    st=m.get('stages',{})
    if not isinstance(st,dict): err(f"#{tag} stages not object"); continue
    for k in ('proto','spec','built','tested','published'):
        if k not in st: err(f"#{tag} stages missing '{k}'")
    if st.get('proto') not in ENUM['s.proto']: err(f"#{tag} stages.proto '{st.get('proto')}' invalid")
    if st.get('spec') not in ENUM['s.spec']: err(f"#{tag} stages.spec '{st.get('spec')}' invalid")
    if st.get('published') not in ENUM['s.published']: err(f"#{tag} stages.published '{st.get('published')}' invalid")
    # mirrors
    if st.get('built')!=m.get('built'): err(f"#{tag} stages.built!={m.get('built')} (mirror drift)")
    if st.get('tested')!=m.get('test'): err(f"#{tag} stages.tested!=test (mirror drift)")
    # reality: proto + spec
    real_spec, exists = spec_state(slug)
    want_proto='done' if exists else 'todo'
    if st.get('proto')!=want_proto: err(f"#{tag} stages.proto={st.get('proto')} but file exists={exists}")
    if st.get('spec')!=real_spec: err(f"#{tag} stages.spec={st.get('spec')} but HTML has '{real_spec}'")

# cross-file: oss-urls.json <=> stages.published=='oss'
if os.path.exists(OSS):
    oss=set(json.load(open(OSS, encoding='utf-8')).keys())
    pub={m['slug'] for m in mods if m.get('stages',{}).get('published')=='oss'}
    if oss-pub: err(f"oss-urls.json has slugs not marked published=='oss': {sorted(oss-pub)[:5]}")
    if pub-oss: err(f"modules published=='oss' missing from oss-urls.json: {sorted(pub-oss)[:5]}")

# optional: jsonschema
try:
    import jsonschema
    jsonschema.validate(lib, json.load(open(SCHEMA, encoding='utf-8')))
    schema_note='jsonschema: PASS'
except ImportError:
    schema_note='jsonschema: (not installed — skipped; hand checks ran)'
except Exception as e:
    err(f"jsonschema: {str(e).splitlines()[0]}")
    schema_note='jsonschema: FAIL'

print(f"modules: {len(mods)} | {schema_note}")
for w in warns: print("  WARN:", w)
if errs:
    print(f"FAIL — {len(errs)} error(s):")
    for e in errs: print("  ✗", e)
    sys.exit(1)
print("PASS — library.json is consistent.")
