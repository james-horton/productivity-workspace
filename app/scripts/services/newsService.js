/**
 * newsService: client wrapper for GET /api/news
 */

/**
 * Fetch news items
 * @param {'national'|'world'|'local'} category
 * @param {{city?:string, state?:string}} [location]
 * @returns {Promise<{ category:string, items:Array<{title:string,summary:string,url:string,source:string}> }>}
 */
export async function fetchNews(category = 'national', location = {}) {
  const params = new URLSearchParams({ category });
  if (category === 'local' && location.city && location.state) {
    params.set('city', String(location.city));
    params.set('state', String(location.state));
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