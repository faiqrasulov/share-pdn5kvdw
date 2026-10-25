/* mri-share landing page: unlock (encrypted build) and list what can be opened. */
'use strict';
(function () {
  const DB_NAME = 'mri-share';
  const DB_STORE = 'kv';
  const SCOPE = new URL('./', location.href).href;
  const SESSION_KEY = 'session:' + SCOPE;
  const VERIFIER_TEXT = 'mri-share-verifier-v1';
  const HOURS = 3600 * 1000;

  const $ = (id) => document.getElementById(id);
  const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
  let site = null;

  /* ---------------- IndexedDB ---------------- */
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbTx(mode, fn) {
    const db = await idbOpen();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, mode);
        const r = fn(tx.objectStore(DB_STORE));
        tx.oncomplete = () => resolve(r && r.result);
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  const idbGet = (k) => idbTx('readonly', (s) => s.get(k));
  const idbPut = (k, v) => idbTx('readwrite', (s) => s.put(v, k));
  const idbDel = (k) => idbTx('readwrite', (s) => s.delete(k));

  /* ---------------- crypto ---------------- */
  const enc = new TextEncoder();
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function deriveKey(password) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: site.kdf.hash, iterations: site.kdf.iterations, salt: b64ToBytes(site.kdf.salt) },
      base, { name: 'AES-GCM', length: 256 }, true /* exported once, for the worker */, ['decrypt']);
  }
  async function checkKey(key) {
    const blob = b64ToBytes(site.verifier);
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: blob.subarray(0, 12), additionalData: enc.encode('verifier') }, key, blob.subarray(12));
      return new TextDecoder().decode(pt) === VERIFIER_TEXT;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- service worker ---------------- */
  async function messageSW(msg) {
    const reg = await navigator.serviceWorker.getRegistration(SCOPE);
    const target = (reg && reg.active) || navigator.serviceWorker.controller;
    if (!target) return;
    await new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      target.postMessage(msg, [ch.port2]);
      setTimeout(resolve, 1500);
    });
  }

  async function ensureServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      throw new Error('This browser does not support Service Workers, which are needed to decrypt the images. ' +
        'Please use a current Chrome, Edge, Firefox or Safari (not a private/incognito window in Firefox).');
    }
    if (!window.isSecureContext) {
      throw new Error('This page must be opened over https:// (or on localhost) so that the decryption service worker can run.');
    }
    await navigator.serviceWorker.register('sw.js?v=' + encodeURIComponent(site.build), { scope: './' });
    const reg = await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    // First visit: the worker just activated. It calls clients.claim(); wait for it to take control.
    if (reg.active) reg.active.postMessage({ type: 'claim' });
    await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      setTimeout(resolve, 5000);
    });
    if (navigator.serviceWorker.controller) return;
    // Still not controlled (e.g. the page was opened with a hard reload). Reload once.
    if (!sessionStorage.getItem('mri-share-reloaded')) {
      sessionStorage.setItem('mri-share-reloaded', '1');
      location.reload();
      await new Promise(() => {});
    }
    throw new Error('The decryption service worker could not take control of this page. Please reload the page (normal reload, not a hard reload).');
  }

  /* ---------------- flow ---------------- */
  function fail(err) {
    console.error(err);
    show('loading', false); show('unlock', false); show('content', false);
    $('error-text').textContent = (err && err.message) || String(err);
    show('error', true);
  }

  let session = null;     // {raw, salt, expires} (raw = key bytes) or a legacy {key: CryptoKey}

  async function storedSession() {
    try {
      const rec = await idbGet(SESSION_KEY);
      if (!rec || !(rec.raw || rec.key)) return null;
      if (rec.salt !== site.kdf.salt || (rec.expires && Date.now() > rec.expires)) {
        await idbDel(SESSION_KEY);
        return null;
      }
      const key = rec.raw ? await crypto.subtle.importKey('raw', rec.raw, { name: 'AES-GCM' }, false, ['decrypt']) : rec.key;
      if (!(await checkKey(key))) return null;
      session = rec;
      if (rec.raw) await messageSW({ type: 'key-updated', raw: rec.raw, salt: rec.salt, expires: rec.expires });
      return rec;
    } catch (e) {
      console.warn('stored session unusable', e);
      return null;
    }
  }

  async function onUnlockSubmit(ev) {
    ev.preventDefault();
    const pw = $('pw').value;
    const btn = $('unlock-btn');
    const msg = $('unlock-msg');
    if (!pw) return;
    btn.disabled = true;
    msg.className = 'msg';
    msg.textContent = 'Checking password…';
    try {
      const key = await deriveKey(pw);
      if (!(await checkKey(key))) {
        msg.className = 'msg bad';
        msg.textContent = 'Wrong password. Please check it and try again (it is case-sensitive).';
        const form = $('unlock-form');
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
        $('pw').select();
        return;
      }
      const remember = $('remember').checked;
      const raw = await crypto.subtle.exportKey('raw', key);
      session = { raw, salt: site.kdf.salt, created: Date.now(), expires: Date.now() + (remember ? 30 * 24 : 12) * HOURS };
      try { await idbPut(SESSION_KEY, session); } catch (e) { console.warn('could not store the key', e); }
      await messageSW({ type: 'key-updated', raw, salt: session.salt, expires: session.expires });
      $('pw').value = '';
      msg.className = 'msg good';
      msg.textContent = 'Unlocked.';
      await afterUnlock();
    } catch (e) {
      msg.className = 'msg bad';
      msg.textContent = 'Could not unlock: ' + (e.message || e);
    } finally {
      btn.disabled = false;
    }
  }

  async function lock() {
    try { await idbDel(SESSION_KEY); } catch (e) { console.warn(e); }
    await messageSW({ type: 'lock' });
    try { await caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))); } catch (e) { /* none */ }
    location.replace(SCOPE);
  }

  function safeNext() {
    const next = new URLSearchParams(location.search).get('next');
    if (!next) return null;
    try {
      const u = new URL(next, SCOPE);
      if (u.origin !== location.origin || !u.href.startsWith(SCOPE) || u.href === SCOPE) return null;
      return u.href;
    } catch (e) { return null; }
  }

  function fmtDate(d) {
    if (!d || d.length !== 8) return d || '';
    return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
  }
  function fmtSize(n) {
    return n > 1e6 ? (n / 1048576).toFixed(0) + ' MB' : (n / 1024).toFixed(0) + ' KB';
  }
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
    }
    for (const kid of kids) e.append(kid);
    return e;
  }

  function viewerHref(info, study) {
    const jsonUrl = new URL((study && study.json) || info.viewer.studiesJson, SCOPE).href;
    let href = info.viewer.path + '?url=' + encodeURIComponent(jsonUrl);
    if (study) href += '&StudyInstanceUIDs=' + encodeURIComponent(study.uid);
    return href;
  }

  async function downloadZip(ev, info) {
    ev.preventDefault();
    const a = $('download-zip');
    if (a.dataset.busy) return;
    a.dataset.busy = '1';
    const prog = $('zip-progress');
    const status = $('zip-status');
    show('zip-progress', true);
    status.textContent = 'Preparing download…';
    try {
      const resp = await fetch(info.zip.path, { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const total = info.zip.size;
      const reader = resp.body.getReader();
      const parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        prog.value = got / total;
        status.textContent = 'Decrypting and downloading… ' + fmtSize(got) + ' / ' + fmtSize(total);
      }
      if (got !== total) throw new Error('incomplete download (' + got + ' of ' + total + ' bytes)');
      const blob = new Blob(parts, { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = el('a', { href: url, download: info.zip.name });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 120000);
      status.textContent = 'Saved as ' + info.zip.name + ' (' + fmtSize(total) + ').';
    } catch (e) {
      status.textContent = 'Download failed: ' + (e.message || e);
    } finally {
      delete a.dataset.busy;
      show('zip-progress', false);
    }
  }

  function render(info) {
    const p = info.patient;
    $('patient-name').textContent = p.name || 'Patient';
    const meta = $('patient-meta');
    meta.textContent = '';
    const add = (k, v) => { if (v) meta.append(el('div', {}, k + ': ', el('b', { text: v }))); };
    add('Patient ID', p.id);
    add('Sex', p.sex);
    add('Birth date', fmtDate(p.birthDate));
    add('Age at scan', /^\d{3}Y$/.test(p.age || '') ? parseInt(p.age, 10) + ' years' : p.age);
    add('Institution', info.institution);
    add('Scanner', info.scanner);
    add('Exam date', fmtDate(info.studies[0] && info.studies[0].date));
    document.title = 'MRI ' + fmtDate(info.studies[0] && info.studies[0].date);

    $('open-viewer').href = viewerHref(info, null);
    const za = $('download-zip');
    za.href = info.zip.path;
    $('zip-desc').textContent = 'Exact copy of both CDs (' + info.zip.files + ' files, ' + fmtSize(info.zip.size) +
      ' compressed): all images with DICOMDIR plus the disc\'s own Windows viewer, eFilm Lite (unzip, then double-click ' +
      'MRI1 or MRI2 \\ eFilmLite \\ eFilmLt.exe). Also opens in Horos, OsiriX, RadiAnt or any PACS.';
    za.onclick = (ev) => downloadZip(ev, info);
    if (info.threeD) { $('open-3d').href = info.threeD; show('open-3d', true); }
    if (info.notes) { $('open-notes').href = info.notes; show('open-notes', true); }
    $('ohif-version').textContent = info.viewer.version || '';

    const box = $('studies');
    box.textContent = '';
    for (const s of info.studies) {
      const head = el('div', { class: 'study-head' },
        el('div', {}, el('strong', { text: s.label }), ' ',
          el('span', { class: 'muted', text: '— ' + fmtDate(s.date) + ' ' + (s.time || '').slice(0, 5) +
            ' — ' + s.description + ' — ' + s.series.length + ' series, ' + s.numInstances + ' images' })),
        el('a', { href: viewerHref(info, s), text: 'Open this study' }));
      const ul = el('ul', { class: 'series' });
      for (const se of s.series) {
        ul.append(el('li', {}, el('code', { text: '#' + se.number + ' ' + se.description }),
          ' ' + se.count + ' images, ' + se.cols + '×' + se.rows + (se.pixel ? ', ' + se.pixel : '')));
      }
      box.append(el('div', { class: 'study' }, head, ul));
    }
    show('loading', false); show('unlock', false); show('error', false); show('content', true);
  }

  async function afterUnlock() {
    const next = safeNext();
    if (next) { location.replace(next); return; }
    const get = () => fetch('vault/info.json', { cache: 'no-store' });
    let resp = await get();
    if (site.encrypted && !resp.ok) {
      // the worker may have restarted without the key, or caught the site mid-update: hand it over and retry
      if (session && session.raw) await messageSW({ type: 'key-updated', raw: session.raw, salt: session.salt, expires: session.expires });
      for (let k = 0; k < 3 && !resp.ok; k++) { await new Promise((r) => setTimeout(r, 600 * (k + 1))); resp = await get(); }
      if (!resp.ok) {
        // still locked for the worker: start over with the password instead of a dead end
        session = null;
        try { await idbDel(SESSION_KEY); } catch (e) { /* ignore */ }
        await messageSW({ type: 'lock' });
        show('loading', false); show('content', false); show('error', false); show('unlock', true);
        const m = $('unlock-msg');
        m.className = 'msg';
        m.textContent = 'Please enter the password again (the site was updated or this browser forgot it).';
        $('pw').focus();
        return;
      }
    }
    if (!resp.ok) throw new Error('Could not load the study list (HTTP ' + resp.status + ').');
    render(await resp.json());
    if (site.encrypted) show('lock-btn', true);
  }

  async function main() {
    show('error', false); show('loading', true);
    const r = await fetch('site.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('site.json missing (HTTP ' + r.status + ')');
    site = await r.json();
    if (!site.encrypted) {
      $('enc-badge').textContent = '(unencrypted local test build)';
      await afterUnlock();
      return;
    }
    $('enc-badge').textContent = '— encrypted';
    await ensureServiceWorker();
    sessionStorage.removeItem('mri-share-reloaded');
    if (await storedSession()) {
      await afterUnlock();
      return;
    }
    show('loading', false);
    show('unlock', true);
    $('pw').focus();
  }

  $('unlock-form').addEventListener('submit', (ev) => onUnlockSubmit(ev).catch(fail));
  $('lock-btn').addEventListener('click', () => lock());
  $('retry-btn').addEventListener('click', () => location.reload());
  main().catch(fail);
})();
