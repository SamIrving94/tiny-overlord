/* =====================================================================
   The Tiny Overlord — local store and sync
   Every press is saved on this phone first, shown at once, then sent.
   What you see = the events we have from the server + our unsent ones.
   ===================================================================== */
(function () {
  'use strict';

  const K = { settings: 'tto.settings', events: 'tto.events', queue: 'tto.queue', seq: 'tto.seq', cursor: 'tto.cursor' };
  const KEEP_DAYS = 45;          // how much history this phone keeps when connected
  const POLL_MS = 20000;

  const DEFAULT_SETTINGS = {
    who: '',
    babyName: '',
    birthDate: '',
    theme: 'auto',               // auto | day | night
    apiUrl: '',
    token: '',
    lastSeen: 0,
    meds: [
      { name: 'Vitamin D', daily: true },
      { name: 'Calpol', gapHours: 4, maxPer24: 4 },
    ],
  };

  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }

  const listeners = new Set();
  let settings = Object.assign({}, DEFAULT_SETTINGS, read(K.settings, {}));
  let events = read(K.events, []);    // confirmed by the server (or everything, in demo mode)
  let queue = read(K.queue, []);      // not yet confirmed
  let status = { online: navigator.onLine, syncing: false, error: '', lastSync: 0 };
  let pollTimer = null;

  function connected() { return !!(settings.apiUrl && settings.token); }

  function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

  // ---------- Reading ----------

  function allEvents() {
    const seen = new Set(events.map(e => e.id));
    return events.concat(queue.filter(e => !seen.has(e.id)));
  }

  // ---------- Writing ----------

  function slug(name) { return String(name || 'phone').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'phone'; }

  function newId() {
    const seq = (read(K.seq, 0) || 0) + 1;
    write(K.seq, seq);
    const rand = Math.random().toString(36).slice(2, 6);
    return 'app-' + slug(settings.who) + '-' + Math.floor(Date.now() / 1000) + '-' + seq + '-' + rand;
  }

  // Adds one event (or several) and starts sending. Returns the event(s).
  function log(partial) {
    const list = Array.isArray(partial) ? partial : [partial];
    const made = list.map(p => {
      const e = Object.assign({ id: newId(), time: new Date().toISOString(), source: 'app-' + slug(settings.who) }, p);
      if (typeof e.time === 'number') e.time = new Date(e.time).toISOString();
      return e;
    });
    if (connected()) { queue = queue.concat(made); write(K.queue, queue); }
    else { events = events.concat(made); write(K.events, events); }
    emit();
    if (connected()) flush();
    return Array.isArray(partial) ? made : made[0];
  }

  // ---------- Talking to the backend ----------

  function apiUrl(params) {
    const u = new URL(settings.apiUrl);
    Object.keys(params).forEach(k => u.searchParams.set(k, params[k]));
    return u.toString();
  }

  async function call(params, body) {
    const opts = { redirect: 'follow', cache: 'no-store' };
    if (body) {
      opts.method = 'POST';
      opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };  // avoids a CORS preflight
      opts.body = JSON.stringify(Object.assign({ token: settings.token }, body));
    }
    const res = await fetch(apiUrl(Object.assign({ token: settings.token }, params)), opts);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'The backend said no');
    return data;
  }

  let flushing = null;
  function flush() {
    if (!connected() || !queue.length) return Promise.resolve();
    if (flushing) return flushing;
    flushing = (async () => {
      try {
        const batch = queue.slice(0, 50);
        const data = await call({ a: 'log' }, { events: batch });
        const done = new Set([].concat(data.accepted || [], data.duplicate || [], (data.rejected || []).map(r => r.id)));
        (data.rejected || []).forEach(r => console.warn('Rejected by backend', r));
        const sent = batch.filter(e => done.has(e.id) && !(data.rejected || []).some(r => r.id === e.id));
        events = mergeEvents(events, sent);
        queue = queue.filter(e => !done.has(e.id));
        write(K.events, events); write(K.queue, queue);
        status.error = '';
      } catch (err) {
        status.error = navigator.onLine ? 'Could not reach the backend' : '';
      } finally {
        flushing = null;
        emit();
      }
      if (queue.length && !status.error) return flush();
    })();
    return flushing;
  }

  function mergeEvents(base, extra) {
    const map = new Map(base.map(e => [e.id, e]));
    extra.forEach(e => map.set(e.id, e));
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    return Array.from(map.values()).filter(e => Date.parse(e.time) >= cutoff || e.type === 'undo' || e.type === 'edit');
  }

  async function pull() {
    if (!connected()) return;
    status.syncing = true; emit();
    try {
      const cursor = read(K.cursor, 0) || 0;
      const params = { a: 'events', since: cursor };
      if (!cursor) params.from = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
      const data = await call(params);
      if (cursor && (data.cursor || 0) < cursor) {
        // The backend is newer than what we remember (e.g. a fresh sheet): start again from it
        write(K.cursor, 0);
        status.syncing = false;
        return pull();
      }
      events = cursor ? mergeEvents(events, data.events || []) : mergeEvents([], data.events || []);
      write(K.events, events);
      write(K.cursor, data.cursor || cursor);
      const have = new Set(events.map(e => e.id));
      queue = queue.filter(e => !have.has(e.id));
      write(K.queue, queue);
      status.error = ''; status.lastSync = Date.now();
    } catch (err) {
      status.error = navigator.onLine ? 'Could not reach the backend' : '';
    } finally {
      status.syncing = false; emit();
    }
  }

  async function sync() { await flush(); await pull(); }

  function startPolling() {
    stopPolling();
    if (!connected()) return;
    sync();
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') sync(); }, POLL_MS);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && connected()) sync(); });
  window.addEventListener('online', () => { status.online = true; emit(); if (connected()) sync(); });
  window.addEventListener('offline', () => { status.online = false; emit(); });

  // ---------- Settings ----------

  function setSettings(patch) {
    const wasConnected = connected();
    const oldUrl = settings.apiUrl;
    settings = Object.assign({}, settings, patch);
    write(K.settings, settings);
    if (connected() && (!wasConnected || oldUrl !== settings.apiUrl)) {
      // Moving from demo to a real backend: start fresh from the server
      write(K.cursor, 0);
      events = []; write(K.events, events);
      startPolling();
    }
    if (!connected() && wasConnected) stopPolling();
    emit();
  }

  // Setup link: <app url>#setup=<base64 of {url, token}>
  function setupLink() {
    const payload = btoa(JSON.stringify({ url: settings.apiUrl, token: settings.token }));
    return location.origin + location.pathname + '#setup=' + encodeURIComponent(payload);
  }
  function readSetupLink(text) {
    const m = String(text || '').match(/setup=([^&\s]+)/);
    if (!m) return null;
    try {
      const v = JSON.parse(atob(decodeURIComponent(m[1])));
      return v && v.url ? { apiUrl: v.url, token: v.token || '' } : null;
    } catch (e) { return null; }
  }

  function clearLocal() {
    events = []; queue = [];
    write(K.events, events); write(K.queue, queue); write(K.cursor, 0);
    emit();
  }

  window.Store = {
    get settings() { return settings; },
    get status() { return status; },
    get queueLength() { return queue.length; },
    mySource() { return 'app-' + slug(settings.who); },
    connected, allEvents, log, setSettings, sync, startPolling, setupLink, readSetupLink, clearLocal,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
