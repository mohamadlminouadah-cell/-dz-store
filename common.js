// دوال مشتركة بين المتجر ولوحة الإدارة
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export async function boot({ persist = false } = {}) {
  let cfg;
  try {
    cfg = await (await fetch(new URL('../config.json', import.meta.url), { cache: 'no-cache' })).json();
  } catch { cfg = {}; }
  if (!cfg.supabaseUrl || !/^https?:\/\//.test(cfg.supabaseUrl) || !cfg.supabaseAnonKey || cfg.supabaseAnonKey.includes('ضع_')) {
    document.body.innerHTML = `<div class="setup-msg"><h2>المتجر غير مُعدّ بعد</h2>
      <p>افتح الملف <b>config.json</b> وضع فيه رابط مشروع Supabase والمفتاح العام (anon) كما في دليل النشر، ثم أعد رفعه.</p></div>`;
    throw new Error('config missing');
  }
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: persist, autoRefreshToken: persist, detectSessionInUrl: false },
  });
  return { sb, cfg };
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n) => `${Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} دج`;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function toast(msg, kind = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`; t.textContent = msg; box.append(t);
  setTimeout(() => t.remove(), 3800);
}

// ترجمة رموز أخطاء قاعدة البيانات إلى رسائل عربية واضحة
export function errMsg(e) {
  const raw = (e && (e.message || e.error_description || e.details)) || String(e || '');
  const [code, a, b] = raw.split('|');
  switch (code) {
    case 'EMPTY_CART': return 'السلة فارغة.';
    case 'CART_TOO_LARGE': return 'عدد المنتجات في السلة كبير جداً.';
    case 'BAD_ITEM': case 'BAD_QTY': return 'هناك خطأ في كمية أحد المنتجات.';
    case 'PRODUCT_UNAVAILABLE': return `المنتج «${a || ''}» لم يعد متاحاً. احذفه من السلة.`;
    case 'OPTION_REQUIRED': return `اختر اللون/المقاس للمنتج «${a || ''}».`;
    case 'INSUFFICIENT_STOCK': return `الكمية المتوفرة من «${a || ''}» هي ${b || 0} فقط.`;
    case 'NO_DELIVERY': return 'لا يتوفر التوصيل إلى هذه الولاية حالياً.';
    case 'NO_DESK': return 'الاستلام من المكتب غير متوفر في هذه الولاية.';
    case 'BAD_COMMUNE': return 'اختر الولاية ثم البلدية.';
    case 'BAD_DELIVERY': return 'طريقة الاستلام غير صحيحة.';
    case 'BAD_COUPON': return 'رمز الخصم غير صالح أو منتهٍ أو لا ينطبق على طلبك.';
    case 'ORDERS_CLOSED': return 'استقبال الطلبات متوقف مؤقتاً. حاول لاحقاً.';
    case 'BAD_NAME': return 'اكتب الاسم واللقب (حرفان على الأقل).';
    case 'BAD_PHONE': return 'رقم الهاتف غير صحيح. مثال: 0550123456';
    case 'BAD_ADDRESS': return 'اكتب عنوان التوصيل بالتفصيل.';
    case 'TOO_LONG': return 'النص المكتوب طويل جداً.';
    case 'TOO_MANY': return 'أرسلت عدة طلبات خلال وقت قصير. حاول بعد ساعة أو اتصل بنا.';
    case 'FORBIDDEN': return 'ليست لديك صلاحية لهذا الإجراء.';
    case 'BAD_REQUEST': return 'تعذّر إرسال الطلب. أعد المحاولة.';
    case 'BAD_STATUS': return 'حالة الطلب غير صحيحة.';
  }
  if (/Invalid login credentials/i.test(raw)) return 'البريد أو كلمة المرور غير صحيحة.';
  if (/Failed to fetch|NetworkError|network/i.test(raw)) return 'لا يوجد اتصال بالإنترنت أو الخادم لا يستجيب.';
  if (/row-level security|permission denied/i.test(raw)) return 'ليست لديك صلاحية لهذا الإجراء (سجّل الدخول كمدير).';
  if (/duplicate key/i.test(raw)) return 'هذه القيمة موجودة مسبقاً.';
  return 'حدث خطأ غير متوقع: ' + raw.slice(0, 160);
}

export const STATUS = {
  new: ['جديد', 'warn'], confirming: ['قيد التأكيد', 'warn'], confirmed: ['تم التأكيد', ''],
  preparing: ['قيد التجهيز', ''], shipped: ['تم الشحن', ''], delivered: ['تم التسليم', 'ok'],
  cancelled: ['ملغى', 'off'], returned: ['مرتجع', 'off'],
};
export const DELIVERY = { home: 'توصيل إلى المنزل', desk: 'استلام من مكتب شركة التوصيل' };
export const fmtDate = (d) => new Date(d).toLocaleString('fr-DZ', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Algiers' });
let wcache;
export async function loadWilayas() {
  wcache ??= await (await fetch(new URL('../data/wilayas.json', import.meta.url))).json();
  return wcache;
}
