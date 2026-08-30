// Offline cache for Poof Poof.
//
// This file was previously strict cache-first over everything, including the
// navigation request. That is why shipped features were not reaching players:
// the old worker answered the navigation from cache, so the old index.html and
// its unversioned module graph loaded in full, and the new worker -- which had
// installed correctly -- only affected the NEXT visit. Every deploy was seen
// one visit late, and three further defects made it worse:
//
//   1. caches.match() was called without a cacheName, so it searched every
//      cache. While activate() purged the old one mid-load, some subresources
//      resolved from the old cache and some from the new: a single page load
//      with a mix of builds, which for an ES-module graph can also throw on a
//      renamed export.
//   2. cache.addAll() used default HTTP-cache semantics. GitHub Pages serves
//      Cache-Control: max-age=600, so reloading within ten minutes of a deploy
//      copied STALE bytes into the brand new cache -- permanently, since
//      cache-first never revalidates. Reloading promptly to check a deploy hit
//      this every time.
//   3. Responses were cached without checking response.ok, so a 404 served
//      during deploy propagation would be cached forever.
//
// The strategy below is therefore split by request type rather than uniform.

// Derived from BUILD_VERSION so the cache name can never be forgotten again.
// Keep in sync with js/constants.js BUILD_VERSION.
const BUILD_VERSION = '2026.08.28-13';
const CACHE_NAME = `poofpoof-${BUILD_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/constants.js',
  './js/platform.js',
  './js/audio.js',
  './js/music.js',
  './js/effects.js',
  './js/theme.js',
  './js/icons.js',
  './js/state.js',
  './js/physics.js',
  './js/render.js',
  './js/input.js',
  './js/shop.js',
  './js/main.js',
  './assets/fonts/fredoka-latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

// Assets that essentially never change and are the expensive ones to refetch.
// Everything else is treated as code and must always be fresh when online.
function isImmutable(url) {
  return /\.(png|jpg|jpeg|gif|svg|woff2?|ttf|mp3|ogg|wav)$/i.test(url.pathname)
    || url.pathname.endsWith('manifest.json');
}

const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // { cache: 'reload' } bypasses the HTTP cache so a fresh install can never
    // be seeded with stale bytes. This is the fix for defect 2 above and is
    // not optional.
    await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function fromCache(request) {
  // Always scoped to the current cache, so a purge in progress can never serve
  // a mixed set of builds (defect 1 above).
  const cached = await caches.match(request, { cacheName: CACHE_NAME });
  return cached || null;
}

async function putIfOk(request, response) {
  // Never cache errors or opaque cross-origin responses (defect 3 above).
  if (!response || !response.ok || response.type !== 'basic') return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

// Fresh-first with a bounded wait, falling back to cache. Used for the
// navigation and for code, so an online player always runs the current build
// while an offline one still gets a working game.
async function networkFirst(request) {
  let timer;
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('network timeout')), NETWORK_TIMEOUT_MS);
      }),
    ]);
    await putIfOk(request, response);
    return response;
  } catch {
    const cached = await fromCache(request);
    if (cached) return cached;
    // Explicit response rather than resolving undefined, which the spec treats
    // as a network error and surfaces as an opaque failure.
    return new Response('Offline and not cached.', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain' },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(request) {
  const cached = await fromCache(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    await putIfOk(request, response);
    return response;
  } catch {
    return new Response('Offline and not cached.', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin pass through

  // Navigations decide which build the whole app is, so they must never be
  // stale while online.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isImmutable(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Code (JS/CSS). Deliberately network-first rather than
  // stale-while-revalidate: with an unbundled ES-module graph, SWR can pair a
  // fresh index.html with a stale module and throw on a renamed export. These
  // files are tiny, so freshness costs almost nothing and buys atomicity.
  event.respondWith(networkFirst(request));
});

// Lets the page ask a waiting worker to take over immediately.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
