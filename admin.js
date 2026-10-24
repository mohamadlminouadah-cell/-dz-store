import { boot, esc, money, $, $$, toast, errMsg, STATUS, DELIVERY, fmtDate, loadWilayas } from '../js/common.js';

const { sb } = await boot({ persist: true });

const A = { settings: {}, cats: [], prods: [], costs: {}, orders: [], rates: [], wilayas: [] };
const must = (r) => { if (r.error) throw r.error; return r.data; };
const guard = async (fn) => { try { return await fn(); } catch (e) { console.error(e); toast(errMsg(e), 'bad'); } };
const avail = (p) => Math.max(p.stock - p.reserved, 0);
const todayDZ = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Algiers' });
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const int = (v, d = 0) => { const n = Math.round(Number(String(v).replace(/\s/g, ''))); return Number.isFinite(n) ? n : d; };
const dlg = $('#dlg');
const openDlg = (html) => { dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); };
const head = (t) => `<div class="dlg-head"><h2>${t}</h2><button class="x" data-x aria-label="إغلاق">×</button></div>`;
dlg.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) dlg.close(); });
dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) dlg.close(); });

/* ================= الدخول ================= */
function showLogin(msg = '') { $('#app').hidden = true; $('#login').hidden = false; $('#loginErr').textContent = msg; }
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  const { data: ok, error } = await sb.rpc('is_admin');
  if (error || !ok) { await sb.auth.signOut(); return showLogin('هذا الحساب ليس مديراً. نفّذ ملف 04_make_admin.sql ببريدك.'); }
  await guard(async () => { await loadAll(); $('#login').hidden = true; $('#app').hidden = false; route(); });
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
  if (error) return ($('#loginErr').textContent = errMsg(error));
  $('#pw').value = '';
  start();
});
$('#logout').addEventListener('click', async () => { await sb.auth.signOut(); showLogin(); });

async function loadAll() {
  const [s, c, p, pc, r, o, w] = await Promise.all([
    sb.from('settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('categories').select('*').order('sort').order('id'),
    sb.from('products').select('*').order('created_at', { ascending: false }),
    sb.from('product_costs').select('*'),
    sb.from('delivery_rates').select('*').order('wilaya_code'),
    sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(1000),
    loadWilayas(),
  ]);
  A.settings = must(s) || {}; A.cats = must(c); A.prods = must(p);
  A.costs = Object.fromEntries(must(pc).map((x) => [x.product_id, x.cost]));
  A.rates = must(r); A.orders = must(o); A.wilayas = w;
  if (A.settings.primary_color) document.documentElement.style.setProperty('--brand', A.settings.primary_color);
  $('#aName').textContent = `إدارة ${A.settings.store_name || 'المتجر'}`;
}

/* ================= التبويبات ================= */
const TABS = [['dash', 'الرئيسية'], ['orders', 'الطلبات'], ['products', 'المنتجات'], ['cats', 'التصنيفات'], ['ship', 'التوصيل'], ['coupons', 'الكوبونات'], ['settings', 'الإعدادات'], ['backup', 'نسخ احتياطي']];
const VIEWS = {};
let tab = 'dash';
function drawTabs() {
  const n = A.orders.filter((o) => o.status === 'new').length;
  $('#tabs').innerHTML = TABS.map(([k, t]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === tab}">${t}${k === 'orders' && n ? `<span class="n">${n}</span>` : ''}</button>`).join('');
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) location.hash = b.dataset.tab; });
window.addEventListener('hashchange', route);
function route() {
  const k = location.hash.slice(1);
  tab = VIEWS[k] ? k : 'dash';
  drawTabs();
  guard(() => VIEWS[tab]());
}
const panel = (html) => { $('#panel').innerHTML = html; };

/* ================= الرئيسية ================= */
let range = '30';
VIEWS.dash = async function () {
  const to = todayDZ();
  const from = range === 'today' ? to : range === 'all' ? '2000-01-01' : addDays(to, -(+range - 1));
  const st = must(await sb.rpc('admin_stats', { p_from: from, p_to: to }));
  const profit = st.revenue - st.cost;
  const low = A.prods.filter((p) => p.status !== 'hidden' && avail(p) <= (A.settings.low_stock_threshold ?? 5)).sort((a, b) => avail(a) - avail(b));
  const max = Math.max(1, ...st.daily.map((d) => d.orders));
  const sOrder = ['new', 'confirming', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'returned'];
  panel(`
    <div class="ph1"><h2>الرئيسية</h2>
      <div class="tools"><select class="in" id="rng" aria-label="الفترة">
        ${[['today', 'اليوم'], ['7', 'آخر 7 أيام'], ['30', 'آخر 30 يوماً'], ['90', 'آخر 90 يوماً'], ['all', 'كل الفترات']].map(([v, t]) => `<option value="${v}" ${v === range ? 'selected' : ''}>${t}</option>`).join('')}
      </select></div></div>
    ${st.missing_cost ? `<div class="warnbox">${st.missing_cost} بنداً مُسلَّماً بدون سعر تكلفة، لذلك الربح غير دقيق. أدخل «سعر الشراء» في كل منتج.</div>` : ''}
    <div class="kpis">
      <div class="kpi"><span>عدد الطلبات</span><b>${st.orders_total}</b></div>
      <div class="kpi main"><span>المبيعات المكتملة (تم التسليم)</span><b>${money(st.revenue)}</b></div>
      <div class="kpi"><span>تكلفة البضاعة المباعة</span><b>${money(st.cost)}</b></div>
      <div class="kpi main"><span>الربح التقديري</span><b>${money(profit)}</b></div>
      <div class="kpi"><span>قيد التنفيذ (لم يُسلَّم بعد)</span><b>${money(st.pending_value)}</b></div>
      <div class="kpi"><span>طلبات مسلّمة</span><b>${st.delivered_count}</b></div>
    </div>
    <p class="muted" style="margin-top:-.4rem">المبيعات والأرباح تحسب الطلبات «تم التسليم» فقط، وبدون رسوم التوصيل. الملغى والمرتجع لا يُحتسب.</p>
    <div class="box"><h3>الطلبات حسب الحالة</h3><div class="chips2">${sOrder.map((k) => `<span class="badge ${STATUS[k][1]}">${STATUS[k][0]}: ${st.by_status[k] || 0}</span>`).join('')}</div></div>
    <div class="box"><h3>الطلبات يومياً</h3>${st.daily.length ? `<div class="bars" role="img" aria-label="رسم الطلبات اليومية">${st.daily.slice(-45).map((d) => `<div title="${d.day}: ${d.orders} طلب" style="height:${Math.round((d.orders / max) * 100)}%"></div>`).join('')}</div>
      <div class="bars-lbl"><span>${st.daily.slice(-45)[0].day}</span><span>${st.daily[st.daily.length - 1].day}</span></div>` : '<p class="muted">لا توجد طلبات في هذه الفترة.</p>'}</div>
    <div class="box"><h3>الأكثر مبيعاً</h3>${st.top.length ? `<table class="tbl"><tr><th>المنتج</th><th>الكمية</th><th>المبيعات</th></tr>${st.top.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.qty}</td><td>${money(t.revenue)}</td></tr>`).join('')}</table>` : '<p class="muted">لا توجد مبيعات مكتملة بعد.</p>'}</div>
    <div class="box"><h3>تنبيه المخزون المنخفض</h3>${low.length ? `<table class="tbl"><tr><th>المنتج</th><th>المتاح</th></tr>${low.map((p) => `<tr><td>${esc(p.name)}</td><td>${avail(p) === 0 ? '<span class="badge sale">نفد</span>' : `<span class="badge warn">${avail(p)}</span>`}</td></tr>`).join('')}</table>` : '<p class="muted">كل المنتجات فوق حد التنبيه.</p>'}</div>`);
  $('#rng').addEventListener('change', (e) => { range = e.target.value; route(); });
};

/* ================= الطلبات ================= */
const oState = { q: '', status: '' };
const NEXT = { new: ['confirmed', 'تأكيد الطلب'], confirming: ['confirmed', 'تأكيد الطلب'], confirmed: ['preparing', 'بدء التجهيز'], preparing: ['shipped', 'تم الشحن'], shipped: ['delivered', 'تم التسليم'] };
const orderItemsText = (o) => (o.order_items || []).map((i) => `${i.product_name}${i.options ? ` (${i.options})` : ''} × ${i.quantity}`).join(' + ');

VIEWS.orders = async function () {
  const { data, error } = await sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  A.orders = data; drawTabs();
  panel(`
    <div class="ph1"><h2>الطلبات</h2><div class="tools">
      <input id="oq" class="in" type="search" placeholder="رقم الطلب / الاسم / الهاتف" value="${esc(oState.q)}">
      <select id="os" class="in" aria-label="الحالة"><option value="">كل الحالات</option>${Object.entries(STATUS).map(([k, [t]]) => `<option value="${k}" ${oState.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button class="btn btn-ghost btn-sm" id="oCsv" type="button">تصدير Excel / CSV</button></div></div>
    <div id="olist" class="olist"></div>`);
  drawOrders();
  $('#oq').addEventListener('input', (e) => { oState.q = e.target.value; drawOrders(); });
  $('#os').addEventListener('change', (e) => { oState.status = e.target.value; drawOrders(); });
  $('#oCsv').addEventListener('click', () => exportOrdersCsv(filteredOrders()));
};
function filteredOrders() {
  const q = oState.q.trim().toLowerCase().replace(/[\s-]/g, '');
  return A.orders.filter((o) => (!oState.status || o.status === oState.status) &&
    (!q || [o.order_number, o.customer_name, o.phone].some((v) => String(v).toLowerCase().replace(/[\s-]/g, '').includes(q))));
}
function drawOrders() {
  const list = filteredOrders();
  $('#olist').innerHTML = list.length ? list.map((o) => {
    const [t, c] = STATUS[o.status]; const nx = NEXT[o.status];
    return `<article class="ocard ${o.status === 'new' ? 'is-new' : ''}" data-o="${o.id}" tabindex="0" role="button" aria-label="طلب ${esc(o.order_number)}">
      <div class="top2"><span class="num">${esc(o.order_number)}</span><span class="badge ${c}">${t}</span></div>
      <div><b>${esc(o.customer_name)}</b> · <span dir="ltr">${esc(o.phone)}</span></div>
      <div class="meta">${esc(o.wilaya_name)} - ${esc(o.commune_name)} · ${DELIVERY[o.delivery_type]} · ${fmtDate(o.created_at)}</div>
      <div class="meta">${esc(orderItemsText(o))}</div>
      <div class="top2"><b>${money(o.total)}</b>${nx ? `<div class="acts"><button class="btn btn-sm" data-next="${o.id}" type="button">${nx[1]}</button></div>` : ''}</div></article>`;
  }).join('') : '<div class="box muted">لا توجد طلبات مطابقة.</div>';
}
$('#panel').addEventListener('click', (e) => {
  const nx = e.target.closest('[data-next]');
  if (nx) { e.stopPropagation(); const o = A.orders.find((x) => x.id == nx.dataset.next); return setStatus(o.id, NEXT[o.status][0]); }
  const card = e.target.closest('[data-o]');
  if (card) openOrder(card.dataset.o);
});
$('#panel').addEventListener('keydown', (e) => { const c = e.target.closest('[data-o]'); if (c && e.key === 'Enter') openOrder(c.dataset.o); });

async function setStatus(id, status) {
  await guard(async () => {
    must(await sb.rpc('admin_set_order_status', { p_id: id, p_status: status }));
    toast(`الحالة الآن: ${STATUS[status][0]}`, 'good');
    const { data } = await sb.from('products').select('*'); if (data) A.prods = data;
    await VIEWS.orders();
    if (dlg.open) openOrder(id);
  });
}

function openOrder(id) {
  const o = A.orders.find((x) => x.id == id); if (!o) return;
  const [t, c] = STATUS[o.status];
  openDlg(`${head(`طلب <span dir="ltr">${esc(o.order_number)}</span>`)}
    <div class="dlg-body">
      <p><span class="badge ${c}">${t}</span> <span class="muted">${fmtDate(o.created_at)}</span></p>
      <dl class="kv"><dt>الاسم</dt><dd>${esc(o.customer_name)}</dd>
        <dt>الهاتف</dt><dd><a href="tel:${esc(o.phone)}" dir="ltr">${esc(o.phone)}</a> · <a target="_blank" rel="noopener" href="https://wa.me/213${esc(o.phone.replace(/^0/, ''))}">واتساب</a></dd>
        <dt>الولاية / البلدية</dt><dd>${esc(o.wilaya_name)} - ${esc(o.commune_name)}</dd>
        <dt>الاستلام</dt><dd>${DELIVERY[o.delivery_type]}</dd>
        ${o.address ? `<dt>العنوان</dt><dd>${esc(o.address)}</dd>` : ''}${o.notes ? `<dt>ملاحظات الزبون</dt><dd>${esc(o.notes)}</dd>` : ''}</dl>
      <table class="tbl"><tr><th>المنتج</th><th>الكمية</th><th>السعر</th></tr>
        ${o.order_items.map((i) => `<tr><td>${esc(i.product_name)}${i.options ? `<br><small class="muted">${esc(i.options)}</small>` : ''}</td><td>${i.quantity}</td><td>${money(i.unit_price * i.quantity)}</td></tr>`).join('')}</table>
      <dl class="kv" style="margin-top:.8rem"><dt>المنتجات</dt><dd>${money(o.subtotal)}</dd><dt>التوصيل</dt><dd>${o.delivery_fee ? money(o.delivery_fee) : 'مجاني'}</dd>
        ${o.discount ? `<dt>الخصم (${esc(o.coupon_code)})</dt><dd>− ${money(o.discount)}</dd>` : ''}<dt>الإجمالي</dt><dd><b>${money(o.total)}</b></dd></dl>
      <div class="lbl" style="margin-bottom:.4rem">تغيير الحالة</div>
      <div class="statusbar">${Object.entries(STATUS).map(([k, [tt]]) => `<button type="button" data-st="${k}" aria-pressed="${k === o.status}">${tt}</button>`).join('')}</div>
      <p class="muted" style="font-size:.88rem">المخزون: ${{ reserved: 'الكمية محجوزة (لم تُخصم بعد)', deducted: 'الكمية مخصومة من المخزون', released: 'الكمية عادت للمخزون' }[o.stock_state]}. تُخصم عند «تم التأكيد» وتعود عند «ملغى» أو «مرتجع».</p>
      <div class="field" style="margin-top:.8rem"><label for="an">ملاحظاتك (لا يراها الزبون)</label><textarea id="an" class="in">${esc(o.admin_notes)}</textarea></div>
      <div class="sticky-save"><button class="btn" data-savenote="${o.id}" type="button">حفظ الملاحظة</button>
        <button class="btn btn-ghost" data-print="${o.id}" type="button">طباعة</button>
        <button class="btn btn-danger" data-delo="${o.id}" type="button" style="margin-inline-start:auto">حذف الطلب</button></div>
    </div>`);
}
dlg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.st) { const id = A.orders.find((x) => x.id == $('[data-savenote]', dlg).dataset.savenote).id; setStatus(id, b.dataset.st); }
  else if (b.dataset.savenote) guard(async () => { must(await sb.from('orders').update({ admin_notes: $('#an').value }).eq('id', b.dataset.savenote).select()); A.orders.find((x) => x.id == b.dataset.savenote).admin_notes = $('#an').value; toast('تم الحفظ', 'good'); });
  else if (b.dataset.print) printOrder(A.orders.find((x) => x.id == b.dataset.print));
  else if (b.dataset.delo) { if (confirm('حذف هذا الطلب نهائياً؟ ستعود كميته إلى المخزون. (يُستعمل للطلبات التجريبية فقط)')) guard(async () => { must(await sb.rpc('admin_delete_order', { p_id: +b.dataset.delo })); dlg.close(); toast('تم حذف الطلب', 'good'); const { data } = await sb.from('products').select('*'); if (data) A.prods = data; VIEWS.orders(); }); }
});

function printOrder(o) {
  $('#printArea').innerHTML = `<h1>${esc(A.settings.store_name || 'المتجر')} — طلب ${esc(o.order_number)}</h1>
    <p>التاريخ: ${fmtDate(o.created_at)}</p>
    <p><b>الزبون:</b> ${esc(o.customer_name)} — <b>الهاتف:</b> <span dir="ltr">${esc(o.phone)}</span><br>
    <b>الولاية:</b> ${esc(o.wilaya_name)} — <b>البلدية:</b> ${esc(o.commune_name)}<br>
    <b>الاستلام:</b> ${DELIVERY[o.delivery_type]}${o.address ? `<br><b>العنوان:</b> ${esc(o.address)}` : ''}${o.notes ? `<br><b>ملاحظات:</b> ${esc(o.notes)}` : ''}</p>
    <table><tr><th>المنتج</th><th>الكمية</th><th>السعر</th></tr>${o.order_items.map((i) => `<tr><td>${esc(i.product_name)}${i.options ? ` (${esc(i.options)})` : ''}</td><td>${i.quantity}</td><td>${money(i.unit_price * i.quantity)}</td></tr>`).join('')}</table>
    <p>المنتجات: ${money(o.subtotal)}<br>التوصيل: ${o.delivery_fee ? money(o.delivery_fee) : 'مجاني'}${o.discount ? `<br>الخصم: − ${money(o.discount)}` : ''}<br>
    <b style="font-size:15pt">المبلغ المطلوب عند الاستلام: ${money(o.total)}</b></p>`;
  window.print();
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function download(name, text, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
function exportOrdersCsv(list) {
  const head = ['رقم الطلب', 'التاريخ', 'الاسم', 'الهاتف', 'الولاية', 'البلدية', 'العنوان', 'الاستلام', 'المنتجات', 'مجموع المنتجات', 'التوصيل', 'الخصم', 'الإجمالي', 'الحالة', 'ملاحظات الزبون', 'ملاحظاتي'];
  const rows = list.map((o) => [o.order_number, fmtDate(o.created_at), o.customer_name, `="${o.phone}"`, o.wilaya_name, o.commune_name, o.address, DELIVERY[o.delivery_type], orderItemsText(o), o.subtotal, o.delivery_fee, o.discount, o.total, STATUS[o.status][0], o.notes, o.admin_notes]);
  const csv = '﻿' + [head, ...rows].map((r) => r.map((v, i) => (i === 3 ? v : csvCell(v))).join(',')).join('\r\n');
  download(`orders-${todayDZ()}.csv`, csv);
  toast(`تم تصدير ${list.length} طلب`, 'good');
}

/* ================= المنتجات ================= */
const pState = { q: '' };
VIEWS.products = async function () {
  const { data } = await sb.from('products').select('*').order('created_at', { ascending: false }); if (data) A.prods = data;
  panel(`<div class="ph1"><h2>المنتجات (${A.prods.length})</h2><div class="tools">
      <input id="pq" class="in" type="search" placeholder="بحث في المنتجات" value="${esc(pState.q)}">
      <button class="btn" id="addP" type="button">+ إضافة منتج</button></div></div><div id="plist" class="plist"></div>`);
  drawProducts();
  $('#pq').addEventListener('input', (e) => { pState.q = e.target.value; drawProducts(); });
  $('#addP').addEventListener('click', () => openProductEditor());
};
const STATUS_P = { available: ['متاح', 'ok'], unavailable: ['غير متاح', 'off'], hidden: ['مخفي', 'warn'] };
function drawProducts() {
  const q = pState.q.trim().toLowerCase();
  const list = A.prods.filter((p) => !q || p.name.toLowerCase().includes(q));
  $('#plist').innerHTML = list.length ? list.map((p) => {
    const cat = A.cats.find((c) => c.id === p.category_id);
    return `<article class="pcard"><div class="t">${p.images?.[0] ? `<img src="${esc(p.images[0])}" alt="" loading="lazy">` : esc([...p.name][0])}</div>
      <div><h4>${esc(p.name)}</h4><div class="meta"><b>${money(p.price)}</b>${p.old_price ? `<s>${money(p.old_price)}</s>` : ''}<span class="badge ${STATUS_P[p.status][1]}">${STATUS_P[p.status][0]}</span>${p.featured ? '<span class="badge">مميز</span>' : ''}</div>
        <div class="meta"><span>المتاح: <b>${avail(p)}</b>${p.reserved ? ` (محجوز ${p.reserved})` : ''}</span>${cat ? `<span>${esc(cat.name)}</span>` : ''}${A.costs[p.id] ? `<span>التكلفة: ${money(A.costs[p.id])}</span>` : ''}</div></div>
      <div class="acts"><button class="btn btn-sm" data-edit="${p.id}" type="button">تعديل</button>
        <button class="btn btn-ghost btn-sm" data-tgl="${p.id}" type="button">${p.status === 'hidden' ? 'إظهار' : 'إخفاء مؤقت'}</button>
        <button class="btn btn-ghost btn-sm" data-feat="${p.id}" type="button">${p.featured ? 'إلغاء التمييز' : 'تمييز'}</button>
        <button class="btn btn-ghost btn-sm" data-dup="${p.id}" type="button">نسخ</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--sale)" data-delp="${p.id}" type="button">حذف</button></div></article>`;
  }).join('') : `<div class="box muted">${A.prods.length ? 'لا نتائج.' : 'لم تضف منتجات بعد. اضغط «إضافة منتج».'}</div>`;
}
$('#panel').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const p = (k) => A.prods.find((x) => x.id === b.dataset[k]);
  if (b.dataset.edit) openProductEditor(p('edit'));
  else if (b.dataset.dup) { const s = p('dup'); openProductEditor({ ...s, id: null, name: s.name + ' (نسخة)', stock: 0, reserved: 0 }, A.costs[s.id]); }
  else if (b.dataset.tgl) guard(async () => { const s = p('tgl'); must(await sb.from('products').update({ status: s.status === 'hidden' ? 'available' : 'hidden' }).eq('id', s.id).select()); toast('تم', 'good'); VIEWS.products(); });
  else if (b.dataset.feat) guard(async () => { const s = p('feat'); must(await sb.from('products').update({ featured: !s.featured }).eq('id', s.id).select()); toast('تم', 'good'); VIEWS.products(); });
  else if (b.dataset.delp) { const s = p('delp'); if (confirm(`حذف «${s.name}» نهائياً؟\n(لإخفائه مؤقتاً استعمل «إخفاء مؤقت». الطلبات السابقة تبقى محفوظة.)`)) guard(async () => { await removeImages(s.images || []); must(await sb.from('products').delete().eq('id', s.id).select()); toast('تم الحذف', 'good'); VIEWS.products(); }); }
});

/* --- الصور --- */
async function compress(file, max = 1000) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let type = 'image/webp', blob = await new Promise((r) => c.toBlob(r, type, 0.82));
  if (!blob || blob.type !== 'image/webp') { type = 'image/jpeg'; blob = await new Promise((r) => c.toBlob(r, type, 0.85)); }
  return { blob, type };
}
async function uploadImage(file, folder) {
  let r; try { r = await compress(file); } catch { throw new Error('تعذّر قراءة الصورة. جرّب صورة JPG أو PNG.'); }
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${r.type === 'image/webp' ? 'webp' : 'jpg'}`;
  const { error } = await sb.storage.from('shop').upload(path, r.blob, { contentType: r.type, cacheControl: '31536000' });
  if (error) throw error;
  return sb.storage.from('shop').getPublicUrl(path).data.publicUrl;
}
const pathOf = (url) => { const m = String(url).match(/\/object\/public\/shop\/(.+)$/); return m ? decodeURIComponent(m[1]) : null; };
async function removeImages(urls) { const paths = urls.map(pathOf).filter(Boolean); if (paths.length) await sb.storage.from('shop').remove(paths).catch(() => {}); }
function pickFiles(multiple = true) {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.multiple = multiple;
    i.onchange = () => res([...i.files]); i.oncancel = () => res([]); i.click();
  });
}

/* --- محرر المنتج --- */
let E = null;
function openProductEditor(p = null, cost = null) {
  const isNew = !p || !p.id;
  E = { id: isNew ? null : p.id, images: [...(p?.images || [])], original: isNew ? [] : [...(p?.images || [])] };
  const v = p || { name: '', description: '', price: '', old_price: '', stock: 0, status: 'available', featured: false, colors: [], sizes: [], category_id: null };
  const costVal = cost ?? (p?.id ? A.costs[p.id] : '') ?? '';
  openDlg(`${head(isNew ? 'إضافة منتج' : 'تعديل المنتج')}
    <form id="pf" class="dlg-body" novalidate>
      <div class="field"><label for="p-name">اسم المنتج *</label><input id="p-name" name="name" class="in" value="${esc(v.name)}" required></div>
      <div class="field"><label for="p-desc">الوصف</label><textarea id="p-desc" name="description" class="in" rows="4">${esc(v.description)}</textarea></div>
      <div class="field"><span class="lbl">الصور (الأولى هي الصورة الأساسية)</span><div class="imgs" id="imgs"></div></div>
      <div class="row">
        <div class="field"><label for="p-price">سعر البيع (دج) *</label><input id="p-price" name="price" class="in" type="number" min="0" inputmode="numeric" value="${v.price}" required></div>
        <div class="field"><label for="p-old">السعر القديم قبل التخفيض (اختياري)</label><input id="p-old" name="old_price" class="in" type="number" min="0" inputmode="numeric" value="${v.old_price ?? ''}"><small>إذا كتبته يظهر السعر القديم مشطوباً ونسبة التخفيض. يجب أن يكون أكبر من سعر البيع.</small></div>
      </div>
      <div class="row">
        <div class="field"><label for="p-cost">سعر الشراء/التكلفة (دج)</label><input id="p-cost" name="cost" class="in" type="number" min="0" inputmode="numeric" value="${costVal ?? ''}"><small>لا يراه الزبائن. يُستعمل لحساب الربح.</small></div>
        <div class="field"><label for="p-stock">الكمية في المخزون</label><input id="p-stock" name="stock" class="in" type="number" min="0" inputmode="numeric" value="${v.stock}">${p?.reserved ? `<small>محجوز لطلبات جديدة: ${p.reserved}</small>` : ''}</div>
      </div>
      <div class="row">
        <div class="field"><label for="p-cat">التصنيف</label><select id="p-cat" name="category_id" class="in"><option value="">بدون تصنيف</option>${A.cats.map((c) => `<option value="${c.id}" ${c.id === v.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="p-status">الحالة</label><select id="p-status" name="status" class="in">
          <option value="available" ${v.status === 'available' ? 'selected' : ''}>متاح للبيع</option><option value="unavailable" ${v.status === 'unavailable' ? 'selected' : ''}>غير متاح (يظهر ولا يُطلب)</option><option value="hidden" ${v.status === 'hidden' ? 'selected' : ''}>مخفي (لا يظهر للزبائن)</option></select></div>
      </div>
      <div class="row">
        <div class="field"><label for="p-colors">الألوان (اختياري)</label><input id="p-colors" name="colors" class="in" placeholder="أحمر، أزرق، أسود" value="${esc((v.colors || []).join('، '))}"><small>افصل بفاصلة. الكمية واحدة لكل المنتج.</small></div>
        <div class="field"><label for="p-sizes">الأحجام/المقاسات (اختياري)</label><input id="p-sizes" name="sizes" class="in" placeholder="S، M، L أو 40، 41، 42" value="${esc((v.sizes || []).join('، '))}"></div>
      </div>
      <label class="chk2"><input type="checkbox" name="featured" ${v.featured ? 'checked' : ''}> منتج مميز (يظهر أولاً في الصفحة الرئيسية)</label>
      <div id="pErr" class="err" role="alert" style="margin-top:.6rem"></div>
      <div class="sticky-save"><button class="btn" type="submit" id="pSave">${isNew ? 'إضافة المنتج' : 'حفظ التعديلات'}</button><button class="btn btn-ghost" type="button" data-x>إلغاء</button></div>
    </form>`);
  drawImgs();
}
function drawImgs() {
  $('#imgs').innerHTML = E.images.map((u, i) => `<div class="im"><img src="${esc(u)}" alt=""><div>
      ${i > 0 ? `<button type="button" data-imain="${i}">أساسية</button>` : '<span style="font-size:.8rem;padding:.2rem .4rem">أساسية</span>'}<button type="button" class="del" data-idel="${i}">حذف</button></div></div>`).join('')
    + '<button type="button" class="addimg" data-iadd>+ إضافة<br>صور</button>';
}
dlg.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b || !E || !$('#pf', dlg)) return;
  if (b.dataset.imain) { const [u] = E.images.splice(+b.dataset.imain, 1); E.images.unshift(u); drawImgs(); }
  else if (b.dataset.idel) { E.images.splice(+b.dataset.idel, 1); drawImgs(); }
  else if (b.dataset.iadd != null) {
    const files = await pickFiles(); if (!files.length) return;
    b.textContent = 'جارٍ الرفع…'; b.disabled = true;
    try { for (const f of files) E.images.push(await uploadImage(f, 'products')); } catch (err) { toast(errMsg(err), 'bad'); }
    drawImgs();
  }
});
dlg.addEventListener('submit', (e) => {
  if (e.target.id !== 'pf') return;
  e.preventDefault();
  const f = e.target, err = $('#pErr');
  const list = (s) => [...new Set(String(s).split(/[,،\n]/).map((x) => x.trim()).filter(Boolean))];
  const price = int(f.price.value, -1), old = f.old_price.value === '' ? null : int(f.old_price.value, -1);
  if (!f.name.value.trim()) return (err.textContent = 'اكتب اسم المنتج.');
  if (price < 0 || f.price.value === '') return (err.textContent = 'اكتب سعر البيع.');
  if (old != null && old <= price) return (err.textContent = 'السعر القديم يجب أن يكون أكبر من سعر البيع (أو اتركه فارغاً).');
  const row = { name: f.name.value.trim(), description: f.description.value.trim(), price, old_price: old, stock: Math.max(0, int(f.stock.value)),
    category_id: f.category_id.value ? +f.category_id.value : null, status: f.status.value, featured: f.featured.checked,
    colors: list(f.colors.value), sizes: list(f.sizes.value), images: E.images };
  err.textContent = ''; $('#pSave').disabled = true;
  guard(async () => {
    try {
      let id = E.id;
      if (id) must(await sb.from('products').update(row).eq('id', id).select());
      else id = must(await sb.from('products').insert(row).select().single()).id;
      const cost = f.cost.value === '' ? 0 : Math.max(0, int(f.cost.value));
      must(await sb.from('product_costs').upsert({ product_id: id, cost }, { onConflict: 'product_id' }).select());
      await removeImages(E.original.filter((u) => !E.images.includes(u)));
      toast('تم حفظ المنتج', 'good'); dlg.close(); E = null; VIEWS.products();
    } finally { const s = $('#pSave'); if (s) s.disabled = false; }
  });
});

/* ================= التصنيفات ================= */
VIEWS.cats = async function () {
  A.cats = must(await sb.from('categories').select('*').order('sort').order('id'));
  panel(`<div class="ph1"><h2>التصنيفات</h2></div>
    <form id="addCat" class="box tools"><input class="in" name="n" placeholder="اسم تصنيف جديد" required style="flex:1"><button class="btn" type="submit">إضافة</button></form>
    <div class="box">${A.cats.length ? `<table class="tbl"><tr><th>الاسم</th><th>الترتيب</th><th>ظاهر</th><th>المنتجات</th><th></th></tr>
      ${A.cats.map((c) => `<tr><td><input class="in" data-cn="${c.id}" value="${esc(c.name)}" aria-label="اسم التصنيف"></td>
        <td><input class="in num-in" type="number" data-cs="${c.id}" value="${c.sort}" aria-label="الترتيب"></td>
        <td><input type="checkbox" data-ca="${c.id}" ${c.active ? 'checked' : ''} aria-label="ظاهر" style="width:20px;height:20px;accent-color:var(--brand)"></td>
        <td>${A.prods.filter((p) => p.category_id === c.id).length}</td>
        <td><button class="btn btn-ghost btn-sm" style="color:var(--sale)" data-cd="${c.id}" type="button">حذف</button></td></tr>`).join('')}</table>
      <p class="muted">عدّل الاسم أو الترتيب مباشرة، ويُحفظ تلقائياً. الأصغر ترتيباً يظهر أولاً.</p>` : '<p class="muted">لا توجد تصنيفات. أضف أول تصنيف أعلاه.</p>'}</div>`);
  $('#addCat').addEventListener('submit', (e) => { e.preventDefault(); guard(async () => { must(await sb.from('categories').insert({ name: e.target.n.value.trim(), sort: A.cats.length + 1 }).select()); toast('تمت الإضافة', 'good'); VIEWS.cats(); }); });
  const upd = (id, patch) => guard(async () => { must(await sb.from('categories').update(patch).eq('id', id).select()); toast('تم الحفظ', 'good'); });
  $$('[data-cn]').forEach((i) => i.addEventListener('change', () => i.value.trim() ? upd(i.dataset.cn, { name: i.value.trim() }) : VIEWS.cats()));
  $$('[data-cs]').forEach((i) => i.addEventListener('change', () => upd(i.dataset.cs, { sort: int(i.value) })));
  $$('[data-ca]').forEach((i) => i.addEventListener('change', () => upd(i.dataset.ca, { active: i.checked })));
  $$('[data-cd]').forEach((b) => b.addEventListener('click', () => { if (confirm('حذف التصنيف؟ منتجاته تبقى بدون تصنيف.')) guard(async () => { must(await sb.from('categories').delete().eq('id', b.dataset.cd).select()); toast('تم الحذف', 'good'); VIEWS.cats(); }); }));
};

/* ================= التوصيل ================= */
VIEWS.ship = async function () {
  A.rates = must(await sb.from('delivery_rates').select('*').order('wilaya_code'));
  A.settings = must(await sb.from('settings').select('*').eq('id', 1).maybeSingle());
  panel(`<div class="ph1"><h2>أسعار التوصيل</h2></div>
    <div class="box"><h3>التوصيل المجاني للطلبات الكبيرة</h3>
      <div class="tools"><input id="fsm" class="in num-in" type="number" min="0" inputmode="numeric" value="${A.settings.free_shipping_min || 0}" aria-label="الحد الأدنى"> <span>دج فأكثر = توصيل مجاني (اكتب 0 لتعطيل الخاصية)</span>
      <button class="btn btn-sm" id="fsmSave" type="button">حفظ</button></div></div>
    <div class="box"><h3>تطبيق سعر موحّد على كل الولايات</h3>
      <div class="tools"><input id="bh" class="in num-in" type="number" min="0" inputmode="numeric" placeholder="المنزل"><input id="bd" class="in num-in" type="number" min="0" inputmode="numeric" placeholder="المكتب">
      <button class="btn btn-sm" id="bulk" type="button">تطبيق على الـ58 ولاية</button></div>
      <p class="muted" style="margin:.5rem 0 0">اترك خانة المكتب فارغة لإلغاء الاستلام من المكتب في كل الولايات. يمكنك بعدها تعديل أي ولاية على حدة.</p></div>
    <div class="box"><h3>سعر كل ولاية</h3><div style="overflow-x:auto"><table class="tbl" id="rt"><tr><th>الولاية</th><th>المنزل (دج)</th><th>المكتب (دج)</th><th>التوصيل مفعّل</th><th>أسعار البلديات</th></tr>
      ${A.rates.map((r) => `<tr data-w="${r.wilaya_code}"><td><b>${String(r.wilaya_code).padStart(2, '0')}</b> ${esc(r.wilaya_name)}</td>
        <td><input class="in num-in" data-f="home_fee" type="number" min="0" inputmode="numeric" value="${r.home_fee}" aria-label="سعر المنزل"></td>
        <td><input class="in num-in" data-f="desk_fee" type="number" min="0" inputmode="numeric" placeholder="غير متاح" value="${r.desk_fee ?? ''}" aria-label="سعر المكتب"></td>
        <td><input type="checkbox" data-f="enabled" ${r.enabled ? 'checked' : ''} aria-label="مفعّل" style="width:20px;height:20px;accent-color:var(--brand)"></td>
        <td><button class="btn btn-ghost btn-sm" data-cm="${r.wilaya_code}" type="button">البلديات</button></td></tr>`).join('')}</table></div>
      <p class="muted">0 دج = توصيل مجاني لتلك الولاية. تُحفظ التغييرات تلقائياً عند تعديل أي خانة.</p></div>`);
  $('#fsmSave').addEventListener('click', () => guard(async () => { must(await sb.from('settings').update({ free_shipping_min: Math.max(0, int($('#fsm').value)) }).eq('id', 1).select()); toast('تم الحفظ', 'good'); }));
  $('#bulk').addEventListener('click', () => {
    if (!$('#bh').value) return toast('اكتب سعر التوصيل للمنزل', 'bad');
    if (!confirm('سيُغيَّر سعر كل الولايات. متابعة؟')) return;
    guard(async () => {
      const rows = A.rates.map((r) => ({ ...r, home_fee: Math.max(0, int($('#bh').value)), desk_fee: $('#bd').value === '' ? null : Math.max(0, int($('#bd').value)) }));
      must(await sb.from('delivery_rates').upsert(rows, { onConflict: 'wilaya_code' }).select()); toast('تم تطبيق الأسعار', 'good'); VIEWS.ship();
    });
  });
  $('#rt').addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-w]'); if (!tr) return;
    const r = A.rates.find((x) => x.wilaya_code == tr.dataset.w);
    const row = { wilaya_code: r.wilaya_code, wilaya_name: r.wilaya_name,
      home_fee: Math.max(0, int($('[data-f=home_fee]', tr).value)), desk_fee: $('[data-f=desk_fee]', tr).value === '' ? null : Math.max(0, int($('[data-f=desk_fee]', tr).value)),
      enabled: $('[data-f=enabled]', tr).checked };
    guard(async () => { must(await sb.from('delivery_rates').upsert(row, { onConflict: 'wilaya_code' }).select()); Object.assign(r, row); toast(`تم حفظ ${r.wilaya_name}`, 'good'); });
  });
  $('#rt').addEventListener('click', (e) => { const b = e.target.closest('[data-cm]'); if (b) openCommunes(+b.dataset.cm); });
};
async function openCommunes(code) {
  const w = A.wilayas.find((x) => +x.c === code), r = A.rates.find((x) => x.wilaya_code === code);
  const ids = w.m.map((m) => m[0]);
  const cr = must(await sb.from('commune_rates').select('*').in('commune_id', ids));
  const map = Object.fromEntries(cr.map((x) => [x.commune_id, x.home_fee]));
  openDlg(`${head(`بلديات ${esc(w.n)}`)}<div class="dlg-body"><p class="muted">اكتب سعراً لبلدية تختلف عن سعر الولاية (${money(r.home_fee)} للمنزل). اتركها فارغة لتتبع سعر الولاية. هذا السعر خاص بالتوصيل إلى المنزل.</p>
    <table class="tbl" id="ct">${w.m.map(([id, n]) => `<tr><td>${esc(n)}</td><td><input class="in num-in" data-c="${id}" type="number" min="0" inputmode="numeric" placeholder="${r.home_fee}" value="${map[id] ?? ''}" aria-label="سعر ${esc(n)}"></td></tr>`).join('')}</table></div>`);
  $('#ct').addEventListener('change', (e) => {
    const i = e.target.closest('[data-c]'); if (!i) return;
    guard(async () => {
      if (i.value === '') must(await sb.from('commune_rates').delete().eq('commune_id', i.dataset.c).select());
      else must(await sb.from('commune_rates').upsert({ commune_id: +i.dataset.c, home_fee: Math.max(0, int(i.value)) }, { onConflict: 'commune_id' }).select());
      toast('تم الحفظ', 'good');
    });
  });
}

/* ================= الكوبونات ================= */
VIEWS.coupons = async function () {
  const list = must(await sb.from('coupons').select('*').order('code'));
  panel(`<div class="ph1"><h2>رموز الخصم</h2></div>
    <form id="addCp" class="box"><h3>رمز جديد</h3><div class="row">
      <div class="field"><label>الرمز (حروف إنجليزية/أرقام)</label><input class="in" name="code" dir="ltr" required pattern="[A-Za-z0-9_\\-]{2,30}" placeholder="RAMADAN10"></div>
      <div class="field"><label>النوع</label><select class="in" name="kind"><option value="percent">نسبة مئوية %</option><option value="fixed">مبلغ ثابت (دج)</option></select></div>
      <div class="field"><label>القيمة</label><input class="in" name="value" type="number" min="1" inputmode="numeric" required></div>
      <div class="field"><label>حد أدنى لمجموع الطلب (دج)</label><input class="in" name="min_total" type="number" min="0" inputmode="numeric" value="0"></div>
      <div class="field"><label>أقصى عدد استعمالات (اختياري)</label><input class="in" name="max_uses" type="number" min="1" inputmode="numeric"></div>
      <div class="field"><label>ينتهي في (اختياري)</label><input class="in" name="expires_at" type="date"></div></div>
      <button class="btn" type="submit">إضافة الرمز</button></form>
    <div class="box">${list.length ? `<table class="tbl"><tr><th>الرمز</th><th>الخصم</th><th>الحد الأدنى</th><th>استُعمل</th><th>فعّال</th><th></th></tr>
      ${list.map((c) => `<tr><td dir="ltr"><b>${esc(c.code)}</b></td><td>${c.kind === 'percent' ? c.value + '%' : money(c.value)}</td><td>${money(c.min_total)}</td><td>${c.used}${c.max_uses ? ' / ' + c.max_uses : ''}</td>
        <td><input type="checkbox" data-ka="${esc(c.code)}" ${c.active ? 'checked' : ''} aria-label="فعّال" style="width:20px;height:20px;accent-color:var(--brand)"></td>
        <td><button class="btn btn-ghost btn-sm" style="color:var(--sale)" data-kd="${esc(c.code)}" type="button">حذف</button></td></tr>`).join('')}</table>` : '<p class="muted">لا توجد رموز خصم بعد.</p>'}</div>`);
  $('#addCp').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.target;
    guard(async () => {
      const row = { code: f.code.value.trim().toUpperCase(), kind: f.kind.value, value: int(f.value.value), min_total: int(f.min_total.value),
        max_uses: f.max_uses.value ? int(f.max_uses.value) : null, expires_at: f.expires_at.value ? new Date(f.expires_at.value + 'T23:59:59+01:00').toISOString() : null };
      if (row.kind === 'percent' && row.value > 100) throw new Error('النسبة لا تتجاوز 100.');
      must(await sb.from('coupons').insert(row).select()); toast('تمت إضافة الرمز', 'good'); VIEWS.coupons();
    });
  });
  $$('[data-ka]').forEach((i) => i.addEventListener('change', () => guard(async () => { must(await sb.from('coupons').update({ active: i.checked }).eq('code', i.dataset.ka).select()); toast('تم', 'good'); })));
  $$('[data-kd]').forEach((b) => b.addEventListener('click', () => { if (confirm('حذف الرمز؟')) guard(async () => { must(await sb.from('coupons').delete().eq('code', b.dataset.kd).select()); VIEWS.coupons(); }); }));
};

/* ================= الإعدادات ================= */
VIEWS.settings = async function () {
  A.settings = must(await sb.from('settings').select('*').eq('id', 1).maybeSingle());
  const s = A.settings;
  panel(`<div class="ph1"><h2>إعدادات المتجر</h2></div>
    <form id="sf" class="box" novalidate>
      <div class="field"><label>اسم المتجر</label><input class="in" name="store_name" value="${esc(s.store_name)}" required></div>
      <div class="field"><label>عبارة تحت الاسم (اختياري)</label><input class="in" name="tagline" value="${esc(s.tagline)}"></div>
      <div class="field"><span class="lbl">الشعار</span><div class="tools">${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="" style="height:56px;border-radius:8px">` : '<span class="muted">لا يوجد شعار (يظهر الاسم)</span>'}
        <button class="btn btn-ghost btn-sm" type="button" id="logoUp">${s.logo_url ? 'تغيير الشعار' : 'رفع شعار'}</button>${s.logo_url ? '<button class="btn btn-ghost btn-sm" type="button" id="logoDel" style="color:var(--sale)">حذف الشعار</button>' : ''}</div></div>
      <div class="row"><div class="field"><label>رقم الهاتف للعرض</label><input class="in" name="phone" dir="ltr" style="text-align:right" value="${esc(s.phone)}" placeholder="0550 12 34 56"></div>
        <div class="field"><label>رقم واتساب</label><input class="in" name="whatsapp" dir="ltr" style="text-align:right" value="${esc(s.whatsapp)}" placeholder="0550123456"><small>اكتبه كما هو، وسيُحوَّل تلقائياً للصيغة الدولية (213…).</small></div></div>
      <div class="field"><label>رابط صفحة فيسبوك</label><input class="in" name="facebook" dir="ltr" style="text-align:right" value="${esc(s.facebook)}" placeholder="https://facebook.com/…"></div>
      <div class="field"><label>رابط إنستغرام</label><input class="in" name="instagram" dir="ltr" style="text-align:right" value="${esc(s.instagram)}" placeholder="https://instagram.com/…"></div>
      <div class="field"><label>رابط تيك توك</label><input class="in" name="tiktok" dir="ltr" style="text-align:right" value="${esc(s.tiktok)}" placeholder="https://tiktok.com/@…"></div>
      <div class="row"><div class="field"><label>لون المتجر</label><input class="in" type="color" name="primary_color" value="${esc(s.primary_color || '#0f6b5c')}" style="padding:4px"></div>
        <div class="field"><label>تنبيه المخزون عند وصول الكمية إلى</label><input class="in" type="number" min="0" name="low_stock_threshold" value="${s.low_stock_threshold}"></div></div>
      <div class="field"><label>شريط إعلان أعلى المتجر (اختياري)</label><input class="in" name="announcement" value="${esc(s.announcement)}" placeholder="مثال: توصيل مجاني للطلبات فوق 6000 دج"></div>
      <label class="chk2"><input type="checkbox" name="orders_open" ${s.orders_open ? 'checked' : ''}> استقبال الطلبات مفتوح (أزل العلامة لإيقافه مؤقتاً)</label>
      <div class="sticky-save"><button class="btn" type="submit">حفظ الإعدادات</button></div></form>
    <form id="pwf" class="box" novalidate><h3>تغيير كلمة المرور</h3>
      <div class="field"><label>كلمة المرور الجديدة (8 أحرف على الأقل)</label><input class="in" type="password" name="pw" autocomplete="new-password" minlength="8" dir="ltr" style="text-align:right"></div>
      <button class="btn btn-ghost" type="submit">تغيير كلمة المرور</button></form>`);
  $('#sf').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.target;
    if (!f.store_name.value.trim()) return toast('اكتب اسم المتجر', 'bad');
    let wa = f.whatsapp.value.replace(/\D/g, ''); if (wa.startsWith('0')) wa = '213' + wa.slice(1); if (wa.startsWith('00')) wa = wa.slice(2);
    const url = (v) => { v = v.trim(); return v && !/^https?:\/\//.test(v) ? 'https://' + v : v; };
    guard(async () => {
      must(await sb.from('settings').update({ store_name: f.store_name.value.trim(), tagline: f.tagline.value.trim(), phone: f.phone.value.trim(), whatsapp: wa,
        facebook: url(f.facebook.value), instagram: url(f.instagram.value), tiktok: url(f.tiktok.value), primary_color: f.primary_color.value,
        announcement: f.announcement.value.trim(), low_stock_threshold: Math.max(0, int(f.low_stock_threshold.value)), orders_open: f.orders_open.checked }).eq('id', 1).select());
      toast('تم حفظ الإعدادات', 'good'); await loadAll(); VIEWS.settings();
    });
  });
  $('#logoUp').addEventListener('click', async () => {
    const [f] = await pickFiles(false); if (!f) return;
    guard(async () => { const url = await uploadImage(f, 'branding'); const old = s.logo_url;
      must(await sb.from('settings').update({ logo_url: url }).eq('id', 1).select()); if (old) await removeImages([old]); toast('تم رفع الشعار', 'good'); VIEWS.settings(); });
  });
  $('#logoDel')?.addEventListener('click', () => guard(async () => { must(await sb.from('settings').update({ logo_url: null }).eq('id', 1).select()); await removeImages([s.logo_url]); VIEWS.settings(); }));
  $('#pwf').addEventListener('submit', (e) => {
    e.preventDefault(); const pw = e.target.pw.value;
    if (pw.length < 8) return toast('كلمة المرور 8 أحرف على الأقل', 'bad');
    guard(async () => { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error; e.target.reset(); toast('تم تغيير كلمة المرور', 'good'); });
  });
};

/* ================= النسخ الاحتياطي ================= */
const BK_TABLES = ['settings', 'categories', 'products', 'product_costs', 'delivery_rates', 'commune_rates', 'coupons', 'orders', 'order_items'];
const BK_KEY = { settings: 'id', categories: 'id', products: 'id', product_costs: 'product_id', delivery_rates: 'wilaya_code', commune_rates: 'commune_id', coupons: 'code', orders: 'id', order_items: 'id' };
async function fetchAll(t) {
  const out = []; for (let from = 0; ; from += 1000) {
    const d = must(await sb.from(t).select('*').order(BK_KEY[t]).range(from, from + 999)); out.push(...d); if (d.length < 1000) break;
  } return out;
}
VIEWS.backup = async function () {
  panel(`<div class="ph1"><h2>النسخ الاحتياطي والاستعادة</h2></div>
    <div class="box"><h3>1) تنزيل نسخة احتياطية كاملة</h3><p>ملف واحد (JSON) فيه المنتجات والتصنيفات والتوصيل والكوبونات والطلبات والإعدادات. (الصور تبقى في Supabase، والملف يحفظ روابطها.)</p>
      <button class="btn" id="bkDown" type="button">تنزيل النسخة الاحتياطية</button>
      <p class="muted" style="margin-bottom:0">نصيحة: نزّلها كل أسبوع واحفظها في Google Drive أو على هاتفك.</p></div>
    <div class="box"><h3>2) استعادة من نسخة</h3><p>اختر ملف النسخة الاحتياطية. الاستعادة <b>تدمج</b> النسخة مع الموجود: تُعيد ما حُذف وتُرجع القيم القديمة للصفوف الموجودة، ولا تحذف شيئاً جديداً.</p>
      <button class="btn btn-ghost" id="bkUp" type="button">اختيار ملف واستعادة</button><div id="bkMsg" class="muted" style="margin-top:.6rem"></div></div>
    <div class="box"><h3>3) تصدير الطلبات إلى Excel</h3><p>كل الطلبات في ملف CSV يفتحه Excel مباشرة.</p><button class="btn btn-ghost" id="bkCsv" type="button">تصدير كل الطلبات</button></div>`);
  $('#bkCsv').addEventListener('click', () => guard(async () => { const d = must(await sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false })); exportOrdersCsv(d); }));
  $('#bkDown').addEventListener('click', () => guard(async () => {
    const tables = {}; for (const t of BK_TABLES) tables[t] = await fetchAll(t);
    download(`backup-${todayDZ()}.json`, JSON.stringify({ app: 'dz-store', version: 1, created: new Date().toISOString(), tables }), 'application/json');
    toast('تم تنزيل النسخة الاحتياطية', 'good');
  }));
  $('#bkUp').addEventListener('click', async () => {
    const [f] = await pickFilesAny(); if (!f) return;
    guard(async () => {
      let b; try { b = JSON.parse(await f.text()); } catch { throw new Error('الملف ليس نسخة احتياطية صالحة.'); }
      if (b.app !== 'dz-store' || !b.tables) throw new Error('الملف ليس نسخة احتياطية من هذا المتجر.');
      const n = BK_TABLES.reduce((a, t) => a + (b.tables[t]?.length || 0), 0);
      if (!confirm(`سيتم استعادة ${n} سجلاً من نسخة بتاريخ ${fmtDate(b.created)}. متابعة؟`)) return;
      const msg = $('#bkMsg');
      for (const t of BK_TABLES) {
        const rows = b.tables[t] || [];
        for (let i = 0; i < rows.length; i += 200) {
          msg.textContent = `استعادة ${t}… ${Math.min(i + 200, rows.length)}/${rows.length}`;
          must(await sb.from(t).upsert(rows.slice(i, i + 200), { onConflict: BK_KEY[t] }).select());
        }
      }
      must(await sb.rpc('admin_resync_sequences'));
      msg.textContent = ''; toast('تمت الاستعادة بنجاح', 'good'); await loadAll(); drawTabs();
    });
  });
};
function pickFilesAny() {
  return new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.onchange = () => res([...i.files]); i.oncancel = () => res([]); i.click(); });
}

start();

if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
