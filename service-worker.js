/**
 * ============================================================
 * service-worker.js — يجعل واجهة التطبيق تعمل دون إنترنت
 * ============================================================
 * ما يخزّنه: ملفات الواجهة فقط (الصفحة، التصميم، الكود، الأيقونات، الخط، html2canvas).
 * ما لا يلمسه أبدًا: طلبات الـ API (script.google.com) — تذهب دائمًا مباشرة للإنترنت،
 * فلا يمكن أن تُرسَل بيانات قديمة أو يُخزَّن تقرير بالخطأ.
 *
 * عند تحديث أي ملف في GitHub: غيّر رقم VERSION أدناه ليُجبر الأجهزة على تحميل الجديد.
 */

const VERSION = 'v1';
const CACHE_NAME = 'daily-report-' + VERSION;

const SHELL_FILES = [
  './',
  'index.html',
  'style.css',
  'config.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

// مصادر خارجية مسموح بتخزينها (الخط وأداة التقاط الصورة)
const EXTERNAL_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

// أقصى انتظار للشبكة قبل الرجوع للنسخة المخزّنة (للملفات المحلية)
const NETWORK_TIMEOUT_MS = 3000;


/** ---------------- التثبيت: تخزين ملفات الواجهة مسبقًا ---------------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(SHELL_FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});


/** ---------------- التفعيل: حذف النسخ القديمة من التخزين ---------------- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});


/** ---------------- اعتراض الطلبات ---------------- */
self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // ملفات الواجهة: الشبكة أولاً (لتصلك التحديثات)، وإن تأخرت أو انقطعت فالنسخة المخزّنة
    event.respondWith(networkFirstWithTimeout(request));
  } else if (EXTERNAL_HOSTS.indexOf(url.hostname) !== -1) {
    // الخط وhtml2canvas: المخزّن فوراً ثم تحديثه بصمت
    event.respondWith(staleWhileRevalidate(request));
  }
  // أي شيء آخر (ومنه script.google.com): لا نتدخل، يذهب للإنترنت مباشرة
});


/** ---------------- استراتيجية: الشبكة أولاً مع مهلة ---------------- */
function networkFirstWithTimeout(request) {
  return new Promise(function (resolve) {
    let settled = false;

    const timer = setTimeout(function () {
      caches.match(request, { ignoreSearch: true }).then(function (cached) {
        if (cached && !settled) {
          settled = true;
          resolve(cached);
        }
      });
    }, NETWORK_TIMEOUT_MS);

    fetch(request)
      .then(function (response) {
        clearTimeout(timer);
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
        }
        if (!settled) {
          settled = true;
          resolve(response);
        }
      })
      .catch(function () {
        clearTimeout(timer);
        caches.match(request, { ignoreSearch: true }).then(function (cached) {
          if (!settled) {
            settled = true;
            resolve(cached || caches.match('index.html'));
          }
        });
      });
  });
}


/** ---------------- استراتيجية: المخزّن فوراً ثم التحديث بصمت ---------------- */
function staleWhileRevalidate(request) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(request).then(function (cached) {
      const networkFetch = fetch(request)
        .then(function (response) {
          cache.put(request, response.clone());
          return response;
        })
        .catch(function () { return cached; });

      return cached || networkFetch;
    });
  });
}
