/* The Tiny Overlord — offline support
   The app's own files come from the network when it's quick, otherwise from the saved copy,
   so it always opens, even with no signal.
   Calls to the backend always go to the network (the app queues them itself). */
const VERSION = 'tto-v4';
const FILES = ['./', 'index.html', 'styles.css', 'derive.js', 'store.js', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Backend: never cache
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  // Fonts: cache after first use
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(VERSION + '-fonts').then(c => c.match(req).then(hit => hit || fetch(req).then(res => { c.put(req, res.clone()); return res; })))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // App files: the network if it answers within 2 seconds (so updates arrive), otherwise the saved copy
  event.respondWith(
    caches.open(VERSION).then(c => {
      const fresh = fetch(req, { cache: 'no-cache' }).then(res => { if (res.ok) c.put(req, res.clone()); return res; });
      const fallback = () => c.match(req, { ignoreSearch: true }).then(hit => hit || fresh);
      const slow = new Promise(resolve => setTimeout(resolve, 2000)).then(fallback);
      return Promise.race([fresh.catch(fallback), slow]);
    })
  );
});
