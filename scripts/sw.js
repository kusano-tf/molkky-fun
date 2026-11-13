// Built with a content version and the complete application asset list.
const CACHE_PREFIX = `molkky-fun:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}__VERSION__`;
const APP_FILES = __FILES__;
const appUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES.map(appUrl))));
  // Let an existing game finish before activating an updated application.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)),
  )));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || !url.href.startsWith(self.registration.scope)) return;
  const appPath = new URL(self.registration.scope).pathname;
  if (request.mode === "navigate" && (url.pathname === appPath || url.pathname === `${appPath}index.html`)) {
    event.respondWith(caches.open(CACHE_NAME).then((cache) => cache.match(appUrl("index.html")))
      .then((cached) => cached || fetch(request)));
  } else if (APP_FILES.some((file) => appUrl(file) === url.href)) {
    event.respondWith(caches.open(CACHE_NAME).then((cache) => cache.match(request))
      .then((cached) => cached || fetch(request)));
  }
});
