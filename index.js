// يضع اسم المتجر وشعاره في معاينة الرابط الرئيسي عند مشاركته
import cfg from '../web/config.json';

export async function onRequest(ctx) {
  const res = await ctx.next();
  try {
    if (!(res.headers.get('content-type') || '').includes('text/html')) return res;
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/settings?id=eq.1&select=store_name,tagline,logo_url`, {
      headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` } });
    const s = (await r.json())?.[0];
    if (!s) return res;
    const title = s.tagline ? `${s.store_name} — ${s.tagline}` : s.store_name;
    const set = (v) => ({ element(e) { e.setAttribute('content', v); } });
    let rw = new HTMLRewriter()
      .on('title', { element(e) { e.setInnerContent(title); } })
      .on('meta[property="og:title"]', set(title))
      .on('meta[property="og:image"]', s.logo_url ? set(s.logo_url) : { element(e) { e.remove(); } });
    const out = rw.transform(res);
    const h = new Headers(out.headers); h.set('cache-control', 'public, max-age=120');
    return new Response(out.body, { status: out.status, headers: h });
  } catch { return res; }
}
