/*
 * mri-share service worker.
 *
 * Every patient file in the encrypted build lives on the static host only as
 * AES-256-GCM ciphertext under blobs/<random>.bin.  The viewer (OHIF), the
 * notes pages and the 3D page request ordinary-looking URLs such as
 *   vault/studies.json, vault/dicom/st0/se03/im001.dcm, notes/index.html, 3d/...
 * This worker answers those requests by looking the path up in the encrypted
 * manifest (vault.bin), fetching the ciphertext blob(s), decrypting them with
 * the key that the landing page derived from the password, and returning the
 * plaintext as a normal Response.
 *
 * The landing page derives the AES key from the password and gives it to this
 * worker twice: as raw bytes in IndexedDB (so the unlocked state survives worker
 * restarts) and directly by postMessage (Safari/iOS cannot always read stored
 * CryptoKeys inside a service worker).  "Lock" deletes both.
 */
'use strict';

const DB_NAME = 'mri-share';
const DB_STORE = 'kv';
const SCOPE = self.registration.scope;               // ends with '/'
const SCOPE_PATH = new URL(SCOPE).pathname;
const SESSION_KEY = 'session:' + SCOPE;
const PROTECTED_PREFIXES = ['vault/', 'notes/', '3d/'];
const LANDING_GATED_PREFIXES = ['vault/', 'notes/', '3d/', 'ohif/'];

let state = null;          // {key, manifest, salt}
let memKey = null;         // {raw, salt, expires} handed over by the page
let statePromise = null;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'key-updated' || msg.type === 'lock') {
    state = null;
    statePromise = null;
    memKey = (msg.type === 'key-updated' && msg.raw) ? { raw: msg.raw, salt: msg.salt, expires: msg.expires } : null;
  }
  if (msg.type === 'claim') {
    event.waitUntil(self.clients.claim());
  }
  if (event.ports && event.ports[0]) {
    event.ports[0].postMessage({ ok: true, type: msg.type });
  }
});

/* ---------------- IndexedDB helpers ---------------- */
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(k) {
  const db = await idbOpen();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const r = tx.objectStore(DB_STORE).get(k);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally { db.close(); }
}
async function idbDel(k) {
  const db = await idbOpen();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

/* ---------------- crypto helpers ---------------- */
const enc = new TextEncoder();
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function decryptBytes(key, buf, aad) {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 12 + 16) throw new Error('ciphertext too short');
  const iv = bytes.subarray(0, 12);
  const ct = bytes.subarray(12);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad), tagLength: 128 }, key, ct);
  return new Uint8Array(pt);
}

async function readSession() {
  let rec = null;
  try { rec = await idbGet(SESSION_KEY); } catch (e) { console.warn('[mri-share sw] stored key unreadable', e); }
  if ((!rec || !(rec.raw || rec.key)) && memKey) rec = memKey;
  return rec && (rec.raw || rec.key) ? rec : null;
}
async function keyOf(rec) {
  return rec.raw ? crypto.subtle.importKey('raw', rec.raw, { name: 'AES-GCM' }, false, ['decrypt']) : rec.key;
}

async function loadState() {
  // attempt 0 uses normal revalidation; attempt 1 bypasses any stale CDN copy right after a deploy
  for (let attempt = 0; attempt < 2; attempt++) {
    const bust = attempt ? '?r=' + Date.now() : '';
    let rec = await readSession();
    if (!rec) return null;
    if (rec.expires && Date.now() > rec.expires) {
      try { await idbDel(SESSION_KEY); } catch (e) { /* ignore */ }
      memKey = null;
      return null;
    }
    let key;
    try { key = await keyOf(rec); } catch (e) {
      if (!memKey || rec === memKey) throw e;
      rec = memKey; key = await keyOf(rec);
    }
    const site = await (await fetch(SCOPE + 'site.json' + bust, { cache: attempt ? 'reload' : 'no-cache' })).json();
    if (!site.encrypted) return null;
    if (rec.salt !== site.kdf.salt) { if (attempt === 0) continue; return null; }   // key from another build
    try {
      const vaultResp = await fetch(SCOPE + site.vault + bust, { cache: attempt ? 'reload' : 'no-cache' });
      if (!vaultResp.ok) throw new Error('vault manifest missing: ' + vaultResp.status);
      const manifestBytes = await decryptBytes(key, await vaultResp.arrayBuffer(), site.vault);
      return { key, manifest: JSON.parse(new TextDecoder().decode(manifestBytes)), salt: rec.salt };
    } catch (e) {
      if (attempt === 0) continue;
      throw e;
    }
  }
  return null;
}

async function getState() {
  if (state) return state;
  if (!statePromise) {
    statePromise = loadState().then((s) => { state = s; statePromise = null; return s; },
                                    (e) => { statePromise = null; throw e; });
  }
  return statePromise;
}

/* ---------------- request routing ---------------- */
function relPath(url) {
  if (!url.pathname.startsWith(SCOPE_PATH)) return null;
  let rel = url.pathname.slice(SCOPE_PATH.length);
  try { rel = decodeURIComponent(rel); } catch (e) { /* keep raw */ }
  return rel;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const rel = relPath(url);
  if (rel === null) return;

  const isProtected = PROTECTED_PREFIXES.some((p) => rel.startsWith(p));
  const isGated = LANDING_GATED_PREFIXES.some((p) => rel.startsWith(p));
  if (!isProtected && !(isGated && req.mode === 'navigate')) return;  // public file: network
  event.respondWith(handle(req, url, rel, isProtected));
});

function landingRedirect(rel, url) {
  const next = rel + (url.search || '');
  return Response.redirect(SCOPE + '?next=' + encodeURIComponent(next), 302);
}

async function handle(req, url, rel, isProtected) {
  let st = null;
  try {
    st = await getState();
  } catch (e) {
    console.error('[mri-share sw] unlock state error', e);
    st = null;
  }
  if (!st) {
    if (req.mode === 'navigate') return landingRedirect(rel, url);
    return new Response('Locked: open the landing page and enter the password.',
      { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  if (!isProtected) {
    // unlocked navigation into ohif/: plain network, with SPA fallback to index.html
    const resp = await fetch(req);
    if (resp.status === 404) return fetch(SCOPE + 'ohif/index.html');
    return resp;
  }

  const files = st.manifest.files;
  let entry = files[rel];
  if (!entry && (rel === '' || rel.endsWith('/'))) entry = files[rel + 'index.html'];
  if (!entry && files[rel + '/index.html']) {
    // directory without trailing slash: redirect so relative links resolve
    return Response.redirect(url.href.replace(/(\?|#|$)/, '/$1'), 301);
  }
  if (!entry) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }

  const headers = {
    'Content-Type': entry.t || 'application/octet-stream',
    'Content-Length': String(entry.n),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (entry.d) headers['Content-Disposition'] = 'attachment; filename="' + entry.d + '"';
  if (req.method === 'HEAD') return new Response(null, { status: 200, headers });

  const blobs = entry.b;
  const fetchPlain = async (blob) => {
    // ?v=<build> so a stale CDN copy of a changed file is never mixed with the new manifest
    const u = SCOPE + 'blobs/' + blob + '.bin?v=' + encodeURIComponent(st.manifest.build || '');
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(attempt ? u + '&r=' + Date.now() : u, attempt ? { cache: 'reload' } : undefined);
      try {
        if (!r.ok) throw new Error('blob fetch failed ' + r.status);
        return await decryptBytes(st.key, await r.arrayBuffer(), blob);
      } catch (e) {
        if (attempt >= 1) throw e;
      }
    }
  };

  if (blobs.length === 1) {
    const body = await fetchPlain(blobs[0]);
    return new Response(body, { status: 200, headers });
  }
  // multi-chunk file (e.g. the ZIP): stream chunk by chunk, prefetching one ahead
  let i = 0;
  let pending = fetchPlain(blobs[0]);
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const chunk = await pending;
        i += 1;
        if (i < blobs.length) pending = fetchPlain(blobs[i]);
        controller.enqueue(chunk);
        if (i >= blobs.length) controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return new Response(stream, { status: 200, headers });
}
