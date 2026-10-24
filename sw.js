// خدمة بسيطة تجعل المتجر قابلاً للتثبيت كتطبيق. الشبكة أولاً دائماً (تحديثاتك تظهر فوراً)، والنسخة المخزنة تُستعمل فقط عند انقطاع الاتصال.
const V = 'store-shell-v1';
const SHELL = ['./', 'css/base.css', 'css/store.css', 'js/common.js', 'js/store.js', 'data/wilayas.json', 'icons/icon-192.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/p/')) return; // لا نتدخل في طلبات قاعدة البيانات أو الصور الخارجية
  e.respondWith(
    fetch(r).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put(r, copy)); } return res; })
      .catch(() => caches.match(r).then((m) => m || caches.match(r.mode === 'navigate' ? './' : r)))
  );
});
