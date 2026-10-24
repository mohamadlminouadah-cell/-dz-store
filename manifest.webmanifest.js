// يجعل اسم التطبيق المثبّت ولونه هما اسم متجرك ولونه من الإعدادات
import cfg from '../web/config.json';

export async function onRequest(ctx) {
  const res = await ctx.next();
  try {
    const m = await res.clone().json();
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/settings?id=eq.1&select=store_name,primary_color`, {
      headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` } });
    const s = (await r.json())?.[0];
    if (s?.store_name) { m.name = s.store_name; m.short_name = s.store_name.slice(0, 12); }
    if (/^#[0-9a-f]{6}$/i.test(s?.primary_color || '')) m.theme_color = s.primary_color;
    return new Response(JSON.stringify(m), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  } catch { return res; }
}
