export async function getJSON<T = any>(url: string): Promise<T> {
  // no-store → always hit the network, never a stale browser-cached copy (library.json etc.)
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}
export async function postJSON<T = any>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}
export function fmtTime(s?: string | null) {
  if (!s) return '';
  return String(s).replace('T', ' ').slice(5, 16);
}
