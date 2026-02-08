const CACHE_NAME = "our-day-cache-v11";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/love-cover.svg",
  "./icons/love-cover-180.png",
  "./icons/love-cover-192.png",
  "./icons/love-cover-512.png",
  "./icons/love-cover-maskable-512.png",
  "./icons/love-launch-1290x2796.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS))
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          }

          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});

self.addEventListener("push", (event) => {
  let payload = {};

  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_error) {
      payload = {};
    }
  }

  const title = typeof payload.title === "string" && payload.title ? payload.title : "Our Daily Milestones";
  const body = typeof payload.body === "string" && payload.body ? payload.body : "Open your shared board.";
  const url = typeof payload.url === "string" && payload.url ? payload.url : "/";
  const tag = typeof payload.tag === "string" && payload.tag ? payload.tag : "our-day-notification";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: "./icons/love-cover-192.png",
      badge: "./icons/love-cover-192.png",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i += 1) {
        const client = windowClients[i];
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return null;
    })
  );
});
