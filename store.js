import { boot, esc, money, $, $$, toast, errMsg, debounce, loadWilayas, DELIVERY, STATUS, fmtDate } from './common.js';

const { sb, cfg } = await boot();

const S = { settings: {}, cats: [], prods: [], rates: new Map(), wilayas: [], cat: null, q: '', onlyAvail: false, min: '', max: '', sort: 'new' };
const LOW = 3; // أقل من هذا العدد نكتب "آخر القطع"

/* ---------- التخزين المحلي (للسلة وبيانات الزبون فقط؛ الطلبات في قاعدة البيانات) ---------- */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* التخزين غير متاح */ } },
};
let cart = store.get('shop.cart.v1', []);
let form = store.get('shop.form.v1', { name: '', phone: '', wilaya: '', commune: '', address: '', delivery_type: 'home' });

/* ---------- أدوات ---------- */
const avail = (p) => Math.max(p.stock - p.reserved, 0);
const pstate = (p) => p.status === 'unavailable' ? { k: 'off', t: 'غير متاح' } : avail(p) <= 0 ? { k: 'out', t: 'نفد من المخزون' } : { k: 'ok', t: 'متوفر' };
const norm = (s) => String(s || '').toLowerCase().replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const prod = (id) => S.prods.find((p) => p.id === id);
const hasOpts = (p) => (p.colors?.length || 0) + (p.sizes?.length || 0) > 0;
const shareUrl = (id) => cfg.shareViaFunction ? `${location.origin}/p/${id}` : `${location.origin}/?p=${id}`;
const optText = (l) => [l.color && `اللون: ${l.color}`, l.size && `المقاس: ${l.size}`].filter(Boolean).join('، ');
const imgTag = (src, alt, extra = '') => src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" ${extra}>` : '';
function saveCart() { store.set('shop.cart.v1', cart); renderBadge(); }
function renderBadge() {
  const n = cart.reduce((a, i) => a + i.qty, 0);
  const b = $('#cartCount'); b.hidden = n === 0; b.textContent = n;
}

/* ---------- تحميل البيانات ---------- */
async function load() {
  const [s, c, p, r] = await Promise.all([
    sb.from('settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('categories').select('*').eq('active', true).order('sort').order('id'),
    sb.from('products').select('*').neq('status', 'hidden').order('created_at', { ascending: false }),
    sb.from('delivery_rates').select('wilaya_code,enabled,desk_fee'),
  ]);
  const bad = [s, c, p, r].find((x) => x.error);
  if (bad) throw bad.error;
  S.settings = s.data || {};
  S.cats = c.data;
  S.prods = p.data;
  S.rates = new Map(r.data.map((x) => [x.wilaya_code, x]));
}

function applySettings() {
  const s = S.settings;
  const name = s.store_name || 'المتجر';
  if (/^#[0-9a-f]{6}$/i.test(s.primary_color || '')) {
    document.documentElement.style.setProperty('--brand', s.primary_color);
    $('meta[name="theme-color"]').content = s.primary_color;
  }
  document.title = s.tagline ? `${name} — ${s.tagline}` : name;
  $('#storeName').textContent = name;
  const logo = $('#logo');
  if (s.logo_url) { logo.src = s.logo_url; logo.alt = name; logo.hidden = false; $('#storeName').classList.add('sr'); logo.title = name; }
  const ann = $('#ann'); ann.hidden = !s.announcement; ann.textContent = s.announcement || '';
  $('#closedNote').hidden = s.orders_open !== false;
  const links = [];
  const wa = String(s.whatsapp || '').replace(/\D/g, '');
  if (wa) { links.push(`<a href="https://wa.me/${wa}" target="_blank" rel="noopener">واتساب</a>`); const f = $('#waFloat'); f.href = `https://wa.me/${wa}`; f.hidden = false; }
  if (s.phone) links.push(`<a href="tel:${esc(s.phone.replace(/\s/g, ''))}">اتصل: ${esc(s.phone)}</a>`);
  const soc = (u) => /^https?:\/\//.test(u || '') ? esc(u) : '';
  if (soc(s.facebook)) links.push(`<a href="${soc(s.facebook)}" target="_blank" rel="noopener">فيسبوك</a>`);
  if (soc(s.instagram)) links.push(`<a href="${soc(s.instagram)}" target="_blank" rel="noopener">إنستغرام</a>`);
  if (soc(s.tiktok)) links.push(`<a href="${soc(s.tiktok)}" target="_blank" rel="noopener">تيك توك</a>`);
  $('#footLinks').innerHTML = links.join('');
  $('#footNote').textContent = `${name} — الدفع عند الاستلام · التوصيل إلى كل ولايات الجزائر`;
}

/* ---------- القائمة والتصفية ---------- */
function filtered() {
  const q = norm(S.q.trim());
  const min = S.min === '' ? null : Number(S.min), max = S.max === '' ? null : Number(S.max);
  let list = S.prods.filter((p) =>
    (S.cat == null || p.category_id === S.cat) &&
    (!q || norm(p.name).includes(q) || norm(p.description).includes(q)) &&
    (!S.onlyAvail || pstate(p).k === 'ok') &&
    (min == null || p.price >= min) && (max == null || p.price <= max));
  if (S.sort === 'asc') list.sort((a, b) => a.price - b.price);
  if (S.sort === 'desc') list.sort((a, b) => b.price - a.price);
  return list;
}
const filtersActive = () => S.cat != null || S.q.trim() || S.onlyAvail || S.min !== '' || S.max !== '';

function card(p) {
  const st = pstate(p);
  const disc = p.old_price ? Math.round((1 - p.price / p.old_price) * 100) : 0;
  const quick = st.k === 'ok' && !hasOpts(p) ? `<button class="btn btn-sm qa" data-add="${p.id}" type="button">أضف إلى السلة</button>` : '';
  return `<article class="card ${st.k !== 'ok' ? 'is-off' : ''}">
    <div data-open="${p.id}" role="button" tabindex="0" aria-label="${esc(p.name)}، ${money(p.price)}">
      <div class="ph">${imgTag(p.images?.[0], p.name) || `<span class="noimg" aria-hidden="true">${esc([...p.name][0])}</span>`}
        ${disc > 0 ? `<span class="tag">-${disc}%</span>` : ''}
        ${st.k !== 'ok' ? `<span class="badge off ribbon">${st.t}</span>` : ''}</div>
      <div class="cb"><h3>${esc(p.name)}</h3>
        <div class="pr"><b>${money(p.price)}</b>${p.old_price ? `<s>${money(p.old_price)}</s>` : ''}</div></div>
    </div>${quick}</article>`;
}

function render() {
  const act = filtersActive();
  const list = filtered();
  const feat = act ? [] : list.filter((p) => p.featured).slice(0, 8);
  const featIds = new Set(feat.map((p) => p.id));
  $('#featWrap').hidden = feat.length === 0;
  $('#feat').innerHTML = feat.map(card).join('');
  const rest = list.filter((p) => !featIds.has(p.id));
  $('#gridTitle').textContent = act ? `النتائج (${list.length})` : (feat.length ? 'كل المنتجات' : 'المنتجات');
  $('#gridTitle').hidden = rest.length === 0 && feat.length > 0;
  $('#grid').innerHTML = rest.map(card).join('');
  const e = $('#empty');
  if (list.length === 0) {
    e.hidden = false;
    e.innerHTML = S.prods.length === 0
      ? '<h3>المتجر قيد التجهيز</h3><p>سنضيف المنتجات قريباً. عد لاحقاً.</p>'
      : '<h3>لا توجد منتجات مطابقة</h3><p>جرّب كلمة أخرى أو امسح التصفية.</p><button class="btn btn-ghost" id="clearF" type="button">مسح التصفية</button>';
  } else e.hidden = true;
}

function renderChips() {
  const used = new Set(S.prods.map((p) => p.category_id));
  const cats = S.cats.filter((c) => used.has(c.id));
  const nav = $('#chips');
  nav.hidden = cats.length === 0;
  nav.innerHTML = [`<button class="chip" data-cat="" aria-pressed="${S.cat == null}">الكل</button>`,
    ...cats.map((c) => `<button class="chip" data-cat="${c.id}" aria-pressed="${S.cat === c.id}">${esc(c.name)}</button>`)].join('');
}

/* ---------- نافذة المنتج ---------- */
const dlgP = $('#dlgProduct');
let sel = { id: null, color: '', size: '', qty: 1, img: 0 };

function openProduct(id, push = true) {
  const p = prod(id);
  if (!p) { toast('هذا المنتج غير متوفر', 'bad'); return; }
  sel = { id, color: '', size: '', qty: 1, img: 0 };
  drawProduct();
  if (!dlgP.open) dlgP.showModal();
  if (push) history.pushState({ p: id }, '', `?p=${id}`);
}

function drawProduct() {
  const p = prod(sel.id); if (!p) return;
  const st = pstate(p), av = avail(p), imgs = p.images || [];
  const disc = p.old_price ? Math.round((1 - p.price / p.old_price) * 100) : 0;
  const canBuy = st.k === 'ok' && S.settings.orders_open !== false;
  sel.qty = Math.min(Math.max(sel.qty, 1), Math.max(av, 1));
  const optBlock = (label, key, arr) => arr?.length ? `<div class="opt-lbl">${label}</div><div class="opts" role="group" aria-label="${label}">${arr.map((v) => `<button type="button" class="opt" data-opt="${key}" data-v="${esc(v)}" aria-pressed="${sel[key] === v}">${esc(v)}</button>`).join('')}</div>` : '';
  dlgP.innerHTML = `
    <div class="dlg-head"><h2>تفاصيل المنتج</h2><button class="x" data-close aria-label="إغلاق">×</button></div>
    <div class="dlg-body"><div class="pd">
      <div>
        <div class="gal-main">${imgTag(imgs[sel.img], p.name) || `<div class="ph" style="height:100%"><span class="noimg">${esc([...p.name][0])}</span></div>`}</div>
        ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, i) => `<button type="button" data-img="${i}" aria-current="${i === sel.img}" aria-label="صورة ${i + 1}">${imgTag(u, '')}</button>`).join('')}</div>` : ''}
      </div>
      <div>
        <h3>${esc(p.name)}</h3>
        <div class="pr"><span class="big">${money(p.price)}</span>${p.old_price ? `<s>${money(p.old_price)}</s><span class="badge sale">وفّر ${disc}%</span>` : ''}</div>
        <p style="margin:.5rem 0"><span class="badge ${st.k === 'ok' ? 'ok' : 'off'}">${st.t}</span>
          ${st.k === 'ok' && av <= LOW ? `<span class="stock-note"> آخر ${av} قطع</span>` : ''}</p>
        ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
        ${optBlock('اللون', 'color', p.colors)}${optBlock('المقاس', 'size', p.sizes)}
        ${canBuy ? `<div class="buy">
            <div class="step" role="group" aria-label="الكمية"><button type="button" data-q="-1" aria-label="أنقص" ${sel.qty <= 1 ? 'disabled' : ''}>−</button><output>${sel.qty}</output><button type="button" data-q="1" aria-label="زِد" ${sel.qty >= av ? 'disabled' : ''}>+</button></div>
            <button class="btn btn-ghost" data-addp type="button">أضف إلى السلة</button>
            <button class="btn" data-buy type="button">اطلب الآن</button></div>` : `<p class="stock-note" style="margin-top:1rem">${S.settings.orders_open === false ? 'استقبال الطلبات متوقف مؤقتاً.' : 'هذا المنتج غير متوفر للطلب حالياً.'}</p>`}
        <div class="share"><span class="lbl">شارك هذا المنتج</span>
          <div class="share-row">
            <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${p.name} — ${money(p.price)}\n${shareUrl(p.id)}`)}">واتساب</a>
            <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl(p.id))}">فيسبوك</a>
            <a class="btn btn-ghost btn-sm" href="fb-messenger://share/?link=${encodeURIComponent(shareUrl(p.id))}" data-msgr>ماسنجر</a>
            <button class="btn btn-ghost btn-sm" type="button" data-copy>نسخ الرابط</button>
            ${navigator.share ? '<button class="btn btn-ghost btn-sm" type="button" data-native>مشاركة (إنستغرام، تيك توك…)</button>' : ''}
          </div></div>
      </div></div></div>`;
}

function needOpts(p) {
  if (p.colors?.length && !sel.color) { toast('اختر اللون أولاً', 'bad'); return true; }
  if (p.sizes?.length && !sel.size) { toast('اختر المقاس أولاً', 'bad'); return true; }
  return false;
}

function addToCart(id, color = '', size = '', qty = 1) {
  const p = prod(id); if (!p) return false;
  const inCart = cart.filter((i) => i.id === id).reduce((a, i) => a + i.qty, 0);
  if (inCart + qty > avail(p)) { toast(`المتوفر من هذا المنتج ${avail(p)} فقط`, 'bad'); return false; }
  const line = cart.find((i) => i.id === id && i.color === color && i.size === size);
  if (line) line.qty += qty; else cart.push({ id, color, size, qty });
  saveCart();
  return true;
}

dlgP.addEventListener('click', async (e) => {
  const t = e.target.closest('button,a'); if (!t) return;
  const p = prod(sel.id);
  if (t.matches('[data-close]')) dlgP.close();
  else if (t.dataset.img != null) { sel.img = +t.dataset.img; drawProduct(); }
  else if (t.dataset.opt) { sel[t.dataset.opt] = sel[t.dataset.opt] === t.dataset.v ? '' : t.dataset.v; drawProduct(); }
  else if (t.dataset.q) { sel.qty += +t.dataset.q; drawProduct(); }
  else if (t.matches('[data-addp]')) { if (!needOpts(p) && addToCart(p.id, sel.color, sel.size, sel.qty)) { toast('تمت الإضافة إلى السلة', 'good'); dlgP.close(); } }
  else if (t.matches('[data-buy]')) { if (!needOpts(p) && addToCart(p.id, sel.color, sel.size, sel.qty)) { dlgP.close(); openCart('checkout'); } }
  else if (t.matches('[data-copy]')) { try { await navigator.clipboard.writeText(shareUrl(p.id)); toast('تم نسخ الرابط', 'good'); } catch { prompt('انسخ الرابط:', shareUrl(p.id)); } }
  else if (t.matches('[data-native]')) { try { await navigator.share({ title: p.name, text: `${p.name} — ${money(p.price)}`, url: shareUrl(p.id) }); } catch { /* ألغى المستخدم */ } }
  else if (t.matches('[data-msgr]') && !/Android|iPhone|iPad/i.test(navigator.userAgent)) { e.preventDefault(); try { await navigator.clipboard.writeText(shareUrl(p.id)); toast('تم نسخ الرابط — الصقه في ماسنجر', 'good'); } catch { /* */ } }
});
dlgP.addEventListener('close', () => { if (history.state?.p) history.back(); });

/* ---------- السلة والطلب ---------- */
const dlgC = $('#dlgCart');
let view = 'cart', quote = null, quoteSeq = 0, coupon = '', result = null;

function cleanCart() {
  let changed = false;
  cart = cart.filter((l) => { const p = prod(l.id); if (!p || pstate(p).k !== 'ok') { changed = true; return false; } return true; });
  const used = {};
  for (const l of cart) {
    const p = prod(l.id), left = avail(p) - (used[l.id] || 0);
    if (l.qty > left) { l.qty = left; changed = true; }
    used[l.id] = (used[l.id] || 0) + l.qty;
  }
  cart = cart.filter((l) => l.qty > 0);
  if (changed) { saveCart(); toast('تم تحديث السلة حسب المتوفر', ''); }
}
const lines = () => cart.map((l) => ({ ...l, p: prod(l.id) }));
const localSubtotal = () => lines().reduce((a, l) => a + l.p.price * l.qty, 0);

function openCart(v = 'cart') {
  cleanCart();
  view = cart.length ? v : 'cart'; quote = null;
  drawCart();
  if (!dlgC.open) dlgC.showModal();
  if (view === 'checkout') refreshQuote();
}

function head(title, back) {
  return `<div class="dlg-head">${back ? `<button class="x" data-go="${back}" aria-label="رجوع">›</button>` : ''}<h2>${title}</h2><button class="x" data-close aria-label="إغلاق" style="margin-inline-start:auto">×</button></div>`;
}

function drawCart() {
  if (view === 'cart') {
    const ls = lines();
    dlgC.innerHTML = head('سلة المشتريات') + (ls.length ? `
      <div class="dlg-body">${ls.map((l, i) => `<div class="line">
        <div class="t">${imgTag(l.p.images?.[0], l.p.name)}</div>
        <div><h4>${esc(l.p.name)}</h4>${optText(l) ? `<small>${esc(optText(l))}</small>` : ''}<small>${money(l.p.price)}</small>
          <button class="rm" data-rm="${i}" type="button">حذف</button></div>
        <div class="step"><button data-ql="${i}" data-d="-1" aria-label="أنقص">−</button><output>${l.qty}</output><button data-ql="${i}" data-d="1" aria-label="زِد" ${l.qty >= avail(l.p) ? 'disabled' : ''}>+</button></div>
      </div>`).join('')}</div>
      <div class="dlg-foot"><div class="sum"><div><span>مجموع المنتجات</span><b>${money(localSubtotal())}</b></div><div class="hint"><span>تكلفة التوصيل تُحسب في الخطوة التالية</span></div></div>
        <button class="btn btn-block" style="margin-top:.8rem" data-go="checkout" ${S.settings.orders_open === false ? 'disabled' : ''}>إتمام الطلب</button></div>`
      : `<div class="dlg-body"><div class="empty"><h3>سلتك فارغة</h3><p>أضف منتجاً لتبدأ.</p><button class="btn" data-close>تصفّح المنتجات</button></div></div>`);
  } else if (view === 'checkout') drawCheckout();
  else if (view === 'review') drawReview();
  else if (view === 'done') drawDone();
}

function drawCheckout() {
  const wopts = S.wilayas.map((w) => {
    const r = S.rates.get(+w.c), off = !r || !r.enabled;
    return `<option value="${+w.c}" ${off ? 'disabled' : ''} ${String(form.wilaya) === String(+w.c) ? 'selected' : ''}>${w.c} - ${esc(w.n)}${off ? ' (التوصيل غير متاح)' : ''}</option>`;
  }).join('');
  dlgC.innerHTML = head('معلومات الطلب', 'cart') + `
    <form id="co" novalidate class="dlg-body" autocomplete="on">
      <div class="hp" aria-hidden="true"><label>لا تملأ هذا الحقل <input name="hp" tabindex="-1" autocomplete="off"></label></div>
      <div class="field"><label for="f-name">الاسم واللقب</label><input id="f-name" name="name" class="in" autocomplete="name" value="${esc(form.name)}" required><span class="err" data-e="name"></span></div>
      <div class="field"><label for="f-phone">رقم الهاتف</label><input id="f-phone" name="phone" class="in" type="tel" inputmode="tel" autocomplete="tel" placeholder="0550123456" value="${esc(form.phone)}" required dir="ltr" style="text-align:right"><span class="err" data-e="phone"></span></div>
      <div class="row">
        <div class="field"><label for="f-wilaya">الولاية</label><select id="f-wilaya" name="wilaya" class="in" required><option value="">اختر الولاية</option>${wopts}</select><span class="err" data-e="wilaya"></span></div>
        <div class="field"><label for="f-commune">البلدية</label><select id="f-commune" name="commune" class="in" required></select><span class="err" data-e="commune"></span></div>
      </div>
      <div class="field"><span class="lbl">طريقة الاستلام</span><div class="radios">
        <label class="radio"><input type="radio" name="delivery_type" value="home" ${form.delivery_type !== 'desk' ? 'checked' : ''}> ${DELIVERY.home}</label>
        <label class="radio"><input type="radio" name="delivery_type" value="desk" ${form.delivery_type === 'desk' ? 'checked' : ''}> ${DELIVERY.desk}</label></div></div>
      <div class="field"><label for="f-addr">العنوان بالتفصيل <small id="addrHint">(الحي، الشارع، رقم المنزل…)</small></label><textarea id="f-addr" name="address" class="in" autocomplete="street-address">${esc(form.address)}</textarea><span class="err" data-e="address"></span></div>
      <div class="field"><label for="f-notes">ملاحظات للتوصيل (اختياري)</label><input id="f-notes" name="notes" class="in" maxlength="500" placeholder="مثال: اتصل بي قبل الوصول"></div>
      <div class="field"><label for="f-coupon">رمز الخصم (اختياري)</label><div class="coupon"><input id="f-coupon" class="in" value="${esc(coupon)}" autocomplete="off" dir="ltr" style="text-align:right"><button type="button" class="btn btn-ghost" id="applyCoupon">تطبيق</button></div><span class="err" data-e="coupon"></span></div>
      <div id="summary" class="sum" aria-live="polite"></div>
      <div class="err" id="formErr" role="alert" style="margin-top:.6rem"></div>
    </form>
    <div class="dlg-foot"><button class="btn btn-block" id="toReview" type="button">مراجعة الطلب</button></div>`;
  fillCommunes();
  syncDeskState();
  drawSummary();
}

function fillCommunes() {
  const w = S.wilayas.find((x) => +x.c === +form.wilaya);
  const sel = $('#f-commune');
  sel.innerHTML = `<option value="">${w ? 'اختر البلدية' : 'اختر الولاية أولاً'}</option>` +
    (w ? w.m.map(([id, n]) => `<option value="${id}" ${String(form.commune) === String(id) ? 'selected' : ''}>${esc(n)}</option>`).join('') : '');
  sel.disabled = !w;
}
function syncDeskState() {
  const r = S.rates.get(+form.wilaya);
  const desk = $('input[value="desk"]', dlgC);
  const noDesk = !!form.wilaya && r && r.desk_fee == null;
  desk.disabled = noDesk;
  if (noDesk && form.delivery_type === 'desk') { form.delivery_type = 'home'; $('input[value="home"]', dlgC).checked = true; }
  $('#addrHint').textContent = form.delivery_type === 'desk' ? '(اختياري عند الاستلام من المكتب)' : '(الحي، الشارع، رقم المنزل…)';
}

function readForm() {
  const f = $('#co'); if (!f) return;
  form.name = f.name.value.trim(); form.phone = f.phone.value.trim();
  form.wilaya = f.wilaya.value; form.commune = f.commune.value;
  form.address = f.address.value.trim(); form.delivery_type = f.delivery_type.value || 'home';
  form.notes = f.notes.value.trim();
}

const refreshQuote = debounce(async () => {
  if (view !== 'checkout') return;
  const my = ++quoteSeq;
  const items = cart.map((i) => ({ id: i.id, qty: i.qty, color: i.color || null, size: i.size || null }));
  const { data, error } = await sb.rpc('quote_order', {
    p_items: items, p_wilaya: form.wilaya ? +form.wilaya : null, p_commune: form.commune ? +form.commune : null,
    p_delivery: form.delivery_type || 'home', p_coupon: coupon || null });
  if (my !== quoteSeq) return;
  if (error) {
    const code = (error.message || '').split('|')[0];
    if (code === 'BAD_COUPON') { setErr('coupon', errMsg(error)); coupon = ''; return refreshQuote(); }
    quote = null; drawSummary(errMsg(error));
    if (['INSUFFICIENT_STOCK', 'PRODUCT_UNAVAILABLE'].includes(code)) { await load(); cleanCart(); }
    return;
  }
  quote = data; if (coupon && data.coupon) setErr('coupon', '');
  drawSummary();
}, 200);

function setErr(k, msg) { const e = $(`[data-e="${k}"]`, dlgC); if (e) e.textContent = msg || ''; const i = e?.previousElementSibling; }

function summaryHtml(q, err) {
  if (err) return `<div class="err" style="justify-content:flex-start">${esc(err)}</div>`;
  if (!q) return '<div class="hint"><span>جارٍ حساب المبلغ…</span></div>';
  return `<div><span>مجموع المنتجات</span><b>${money(q.subtotal)}</b></div>
    <div><span>التوصيل</span>${q.delivery_pending ? '<span>اختر الولاية</span>' : q.delivery_fee === 0 ? '<b class="free">مجاني</b>' : `<b>${money(q.delivery_fee)}</b>`}</div>
    ${q.discount ? `<div><span>الخصم (${esc(q.coupon)})</span><b class="free">− ${money(q.discount)}</b></div>` : ''}
    <div class="tot"><span>المبلغ الإجمالي</span><span>${money(q.total)}</span></div>
    <div class="hint"><span>الدفع عند الاستلام</span></div>`;
}
function drawSummary(err) { const s = $('#summary'); if (s) s.innerHTML = summaryHtml(quote, err); }

function validate() {
  readForm();
  let ok = true;
  const bad = (k, m) => { setErr(k, m); ok = false; };
  ['name', 'phone', 'wilaya', 'commune', 'address'].forEach((k) => setErr(k, ''));
  if (form.name.replace(/\s/g, '').length < 2) bad('name', 'اكتب الاسم واللقب.');
  const ph = form.phone.replace(/[\s.\-()]/g, '').replace(/^(\+213|00213|213)/, '0');
  if (!/^0[567]\d{8}$/.test(ph) && !/^0[234]\d{7,8}$/.test(ph)) bad('phone', 'رقم الهاتف غير صحيح. مثال: 0550123456');
  if (!form.wilaya) bad('wilaya', 'اختر الولاية.');
  if (!form.commune) bad('commune', 'اختر البلدية.');
  if (form.delivery_type === 'home' && form.address.length < 4) bad('address', 'اكتب عنوان التوصيل بالتفصيل.');
  if (!ok) { const first = $('.err:not(:empty)', dlgC); first?.previousElementSibling?.focus?.(); first?.scrollIntoView({ block: 'center' }); }
  return ok;
}

function drawReview() {
  const q = quote, w = S.wilayas.find((x) => +x.c === +form.wilaya);
  dlgC.innerHTML = head('تأكيد الطلب', 'checkout') + `
    <div class="dlg-body review">
      <p style="margin-top:0">راجع بياناتك قبل الإرسال:</p>
      <dl><dt>الاسم</dt><dd>${esc(form.name)}</dd><dt>الهاتف</dt><dd dir="ltr" style="text-align:right">${esc(form.phone)}</dd>
        <dt>الولاية</dt><dd>${esc(w?.n || '')}</dd><dt>البلدية</dt><dd>${esc(q.commune_name || '')}</dd>
        <dt>الاستلام</dt><dd>${DELIVERY[form.delivery_type]}</dd>${form.address ? `<dt>العنوان</dt><dd>${esc(form.address)}</dd>` : ''}
        ${form.notes ? `<dt>ملاحظات</dt><dd>${esc(form.notes)}</dd>` : ''}</dl>
      ${q.lines.map((l) => `<div class="line" style="grid-template-columns:1fr auto"><div><h4>${esc(l.name)} × ${l.qty}</h4>${optText(l) ? `<small>${esc(optText(l))}</small>` : ''}</div><b>${money(l.line_total)}</b></div>`).join('')}
      <div class="sum" style="margin-top:.8rem">${summaryHtml(q)}</div>
      <div class="err" id="formErr" role="alert" style="margin-top:.6rem"></div></div>
    <div class="dlg-foot actions"><button class="btn btn-block" id="send" type="button">تأكيد وإرسال الطلب</button><button class="btn btn-ghost btn-block" data-go="checkout" type="button">تعديل البيانات</button></div>`;
}

async function sendOrder() {
  const btn = $('#send'); btn.disabled = true; btn.textContent = 'جارٍ الإرسال…';
  const payload = { name: form.name, phone: form.phone, wilaya: +form.wilaya, commune: +form.commune, address: form.address,
    notes: form.notes || '', delivery_type: form.delivery_type, coupon: coupon || null, hp: $('#co')?.hp?.value || '',
    items: cart.map((i) => ({ id: i.id, qty: i.qty, color: i.color || null, size: i.size || null })) };
  const { data, error } = await sb.rpc('create_order', { p: payload });
  if (error) {
    const code = (error.message || '').split('|')[0];
    $('#formErr').textContent = errMsg(error);
    btn.disabled = false; btn.textContent = 'تأكيد وإرسال الطلب';
    if (['INSUFFICIENT_STOCK', 'PRODUCT_UNAVAILABLE'].includes(code)) { await load(); render(); cleanCart(); setTimeout(() => openCart('cart'), 1800); }
    return;
  }
  result = data;
  store.set('shop.form.v1', { name: form.name, phone: form.phone, wilaya: form.wilaya, commune: form.commune, address: form.address, delivery_type: form.delivery_type });
  store.set('shop.last.v1', { number: data.order_number, phone: form.phone });
  cart = []; coupon = ''; saveCart();
  view = 'done'; drawCart();
  load().then(render).catch(() => {});
}

function drawDone() {
  const r = result, wa = String(S.settings.whatsapp || '').replace(/\D/g, '');
  const msg = `السلام عليكم، أرسلت الطلب رقم ${r.order_number}\nالاسم: ${form.name}\nالمبلغ الإجمالي: ${money(r.total)}`;
  dlgC.innerHTML = head('تم إرسال طلبك') + `<div class="dlg-body done">
    <div class="ok-mark"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.500"/></svg></div>
    <h3 style="margin:.2rem 0;font:700 1.4rem var(--f-display)">شكراً ${esc(form.name)}!</h3>
    <p style="margin:.2rem 0">رقم طلبك</p><div class="num">${esc(r.order_number)}</div>
    <p>المبلغ الإجمالي: <b>${money(r.total)}</b> — الدفع عند الاستلام.</p>
    <p style="color:var(--muted)">سنتصل بك على <b dir="ltr">${esc(form.phone)}</b> لتأكيد الطلب. احتفظ برقم الطلب لتتبّعه.</p>
    <div class="actions" style="margin-top:1rem">
      ${wa ? `<a class="btn" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}">أرسل تفاصيل الطلب عبر واتساب</a>` : ''}
      <button class="btn btn-ghost" data-close type="button">متابعة التسوق</button></div></div>`;
}

dlgC.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.matches('[data-close]')) return dlgC.close();
  if (t.dataset.go) {
    if (view === 'checkout') readForm();
    if (t.dataset.go === 'checkout') { cleanCart(); if (!cart.length) { view = 'cart'; return drawCart(); } }
    view = t.dataset.go; quote = null; drawCart();
    if (view === 'checkout') refreshQuote();
  } else if (t.dataset.rm != null) { cart.splice(+t.dataset.rm, 1); saveCart(); drawCart(); }
  else if (t.dataset.ql != null) { const l = cart[+t.dataset.ql]; l.qty = Math.max(1, l.qty + +t.dataset.d); cleanCart(); saveCart(); drawCart(); }
  else if (t.id === 'applyCoupon') { coupon = $('#f-coupon').value.trim().toUpperCase(); setErr('coupon', ''); if (!coupon) return; refreshQuote(); }
  else if (t.id === 'toReview') {
    if (!validate()) return;
    $('#formErr').textContent = ''; t.disabled = true;
    const items = cart.map((i) => ({ id: i.id, qty: i.qty, color: i.color || null, size: i.size || null }));
    const { data, error } = await sb.rpc('quote_order', { p_items: items, p_wilaya: +form.wilaya, p_commune: +form.commune, p_delivery: form.delivery_type, p_coupon: coupon || null });
    t.disabled = false;
    if (error) { $('#formErr').textContent = errMsg(error); return; }
    quote = data; view = 'review'; drawCart();
  } else if (t.id === 'send') sendOrder();
});
dlgC.addEventListener('change', (e) => {
  if (!$('#co')) return;
  if (e.target.id === 'f-wilaya') { form.wilaya = e.target.value; form.commune = ''; fillCommunes(); syncDeskState(); }
  readForm(); syncDeskState();
  store.set('shop.form.v1', { name: form.name, phone: form.phone, wilaya: form.wilaya, commune: form.commune, address: form.address, delivery_type: form.delivery_type });
  if (['f-wilaya', 'f-commune'].includes(e.target.id) || e.target.name === 'delivery_type') refreshQuote();
});
dlgC.addEventListener('input', (e) => { const er = e.target.closest('.field')?.querySelector('.err'); if (er && $('#co')) er.textContent = ''; });
dlgC.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'f-coupon') { e.preventDefault(); $('#applyCoupon').click(); } });

/* ---------- تتبع الطلب ---------- */
const dlgT = $('#dlgTrack');
function openTrack() {
  const last = store.get('shop.last.v1', {});
  dlgT.innerHTML = head('تتبّع طلبي') + `<form id="trk" class="dlg-body" novalidate>
    <div class="field"><label for="t-num">رقم الطلب</label><input id="t-num" class="in" dir="ltr" style="text-align:right" placeholder="261018-1001" value="${esc(last.number || '')}" required></div>
    <div class="field"><label for="t-phone">رقم الهاتف المستعمل في الطلب</label><input id="t-phone" class="in" type="tel" dir="ltr" style="text-align:right" value="${esc(last.phone || '')}" required></div>
    <button class="btn btn-block" type="submit">تتبّع</button><div id="trkRes" class="track-res" aria-live="polite"></div></form>`;
  dlgT.showModal();
}
dlgT.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) dlgT.close(); });
dlgT.addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#trkRes'); out.textContent = 'جارٍ البحث…';
  const { data, error } = await sb.rpc('track_order', { p_number: $('#t-num').value, p_phone: $('#t-phone').value });
  if (error) { out.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  if (!data) { out.innerHTML = '<p class="err">لم نجد طلباً بهذه البيانات. تأكد من الرقم والهاتف.</p>'; return; }
  const [label, cls] = STATUS[data.status] || [data.status, ''];
  out.innerHTML = `<p>الطلب <b dir="ltr">${esc(data.order_number)}</b> — <span class="badge ${cls}">${label}</span></p>
    <p style="margin:.2rem 0;color:var(--muted)">${fmtDate(data.created_at)} · ${esc(data.wilaya_name)} - ${esc(data.commune_name)}</p>
    <ul>${data.items.map((i) => `<li>${esc(i.name)}${i.options ? ` (${esc(i.options)})` : ''} × ${i.qty}</li>`).join('')}</ul>
    <p><b>الإجمالي: ${money(data.total)}</b></p>`;
});

/* ---------- ربط الأحداث ---------- */
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]'), add = e.target.closest('[data-add]'), chip = e.target.closest('[data-cat]');
  if (add) { if (addToCart(add.dataset.add)) toast('تمت الإضافة إلى السلة', 'good'); }
  else if (open) openProduct(open.dataset.open);
  else if (chip) { S.cat = chip.dataset.cat === '' ? null : +chip.dataset.cat; renderChips(); render(); }
  else if (e.target.id === 'clearF') { Object.assign(S, { cat: null, q: '', onlyAvail: false, min: '', max: '' }); $('#q').value = ''; $('#fAvail').checked = false; $('#fMin').value = ''; $('#fMax').value = ''; renderChips(); render(); }
});
document.addEventListener('keydown', (e) => { const o = e.target.closest?.('[data-open]'); if (o && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openProduct(o.dataset.open); } });
$('#btnCart').addEventListener('click', () => openCart());
$('#btnTrack').addEventListener('click', openTrack);
$('#q').addEventListener('input', debounce((e) => { S.q = e.target.value; render(); }, 150));
$('#fAvail').addEventListener('change', (e) => { S.onlyAvail = e.target.checked; render(); });
$('#fMin').addEventListener('input', debounce((e) => { S.min = e.target.value; render(); }, 250));
$('#fMax').addEventListener('input', debounce((e) => { S.max = e.target.value; render(); }, 250));
$('#fSort').addEventListener('change', (e) => { S.sort = e.target.value; render(); });
for (const d of [dlgP, dlgC, dlgT]) d.addEventListener('mousedown', (e) => { if (e.target === d) d.close(); });
window.addEventListener('popstate', (e) => {
  if (e.state?.p) openProduct(e.state.p, false);
  else if (dlgP.open) dlgP.close();
});

/* ---------- البدء ---------- */
$('#grid').innerHTML = Array.from({ length: 8 }, () => '<div class="skel"></div>').join('');
try {
  [S.wilayas] = await Promise.all([loadWilayas(), load()]);
  applySettings(); renderChips(); render(); renderBadge();
  const pid = new URLSearchParams(location.search).get('p');
  if (pid) { history.replaceState(null, '', location.pathname); history.pushState({ p: pid }, '', `?p=${pid}`); openProduct(pid, false); }
} catch (e) {
  $('#grid').innerHTML = '';
  $('#empty').hidden = false;
  $('#empty').innerHTML = `<h3>تعذّر تحميل المتجر</h3><p>${esc(errMsg(e))}</p><button class="btn" onclick="location.reload()">إعادة المحاولة</button>`;
}

/* ---------- التثبيت كتطبيق ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
{
  const btn = $('#btnInstall'); let deferred = null;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (!standalone) btn.hidden = false; });
  window.addEventListener('appinstalled', () => { btn.hidden = true; toast('تم تثبيت التطبيق', 'good'); });
  if (ios && !standalone) btn.hidden = false;
  btn.addEventListener('click', async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; btn.hidden = true; }
    else toast('في آيفون: اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»');
  });
}
