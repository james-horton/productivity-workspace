/**
 * newsService: client wrapper for GET /api/news
 */

/**
 * Fetch news items
 * @param {'national'|'world'|'local'} category
 * @param {{lat?:number, lon?:number}} [geo]
 * @returns {Promise<{ category:string, items:Array<{title:string,summary:string,url:string,source:string}> }>}
 */
export async function fetchNews(category = 'national', geo = {}) {
  const params = new URLSearchParams({ category });
  if (category === 'local' && typeof geo.lat === 'number' && typeof geo.lon === 'number') {
    params.set('lat', String(geo.lat));
    params.set('lon', String(geo.lon));
  }
  const url = `/api/news?${params.toString()}`;

  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    let info = '';
    try { info = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`News failed (${res.status}): ${info}`);
  }
  return res.json();
}