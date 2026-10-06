const CACHE = "callmemo-v3";
const SHARE_CACHE = "callmemo-share";
const ASSETS = [
  "./", "./index.html", "./style.css", "./app.js", "./whisper-worker.js", "./audio-utils.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// キャッシュ優先 + 裏で更新。共有ターゲットの ?text=... 付きURLも同じ画面として扱う。
// 共有ターゲット(POST): 音声ファイルは一時的にキャッシュへ置き、本文は URL パラメータに載せてアプリへ渡す。
async function handleShare(req) {
  const fd = await req.formData();
  const qs = new URLSearchParams();
  for (const k of ["title", "text", "url"]) {
    const v = fd.get(k);
    if (typeof v === "string" && v) qs.set(k, v);
  }
  const file = fd.getAll("audio").find((f) => f && typeof f !== "string" && f.size);
  const cache = await caches.open(SHARE_CACHE);
  await cache.delete("shared-audio");
  if (file) {
    await cache.put("shared-audio", new Response(file, {
      headers: { "Content-Type": file.type || "audio/mp4", "X-Filename": encodeURIComponent(file.name || "audio") },
    }));
    qs.set("audio", "1");
  }
  return Response.redirect(new URL("./?" + qs, self.registration.scope).href, 303);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method === "POST" && req.url.split("?")[0] === self.registration.scope) {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
