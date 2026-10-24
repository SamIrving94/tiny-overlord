// Small web server for the secure application form. No dependencies: run with `node server.js`.
// It stores only encrypted answers and wrapped keys. Passwords never reach it.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const FormSchema = require('./public/schema.js');

const PORT = Number(process.env.PORT) || 8790;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const SCHEMA_DIR = path.join(__dirname, 'schemas');
// If set, brokers must enter this code to create an application.
const BROKER_CODE = process.env.BROKER_ACCESS_CODE || '';
const MAX_BODY = 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{32}$/;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  // Stops the link (and its secret part) leaking to other sites.
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

// ---------- schemas ----------

function loadSchemas() {
  const out = {};
  for (const f of fs.readdirSync(SCHEMA_DIR).filter(f => f.endsWith('.json'))) {
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf8'));
    const errors = FormSchema.validateSchema(schema);
    if (errors.length) throw new Error('Schema ' + f + ' is not valid:\n  ' + errors.join('\n  '));
    out[schema.id] = schema;
  }
  return out;
}

// ---------- storage ----------

const locks = new Map();
function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(id, next.catch(() => {}));
  return next;
}

function filePath(id) {
  if (!ID_RE.test(id)) throw httpError(404, 'Not found');
  return path.join(DATA_DIR, id + '.json');
}

async function load(id) {
  try {
    return JSON.parse(await fsp.readFile(filePath(id), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw httpError(404, 'Not found');
    throw e;
  }
}

async function save(app) {
  const p = filePath(app.id);
  const tmp = p + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(app), { mode: 0o600 });
  await fsp.rename(tmp, p);
}

// ---------- helpers ----------

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function hash(str) {
  return crypto.createHash('sha256').update(String(str)).digest('base64url');
}

function sameHash(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function isBox(b) {
  return b && typeof b.iv === 'string' && typeof b.ct === 'string' && b.iv.length < 64 && b.ct.length < 600000;
}

function str(v, max) {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function checkContext(schema, ctx) {
  if (!ctx || !schema.countries.some(c => c.code === ctx.country)) throw httpError(400, 'Pick a country');
  if (!schema.industries.some(i => i.code === ctx.industry)) throw httpError(400, 'Pick an industry');
  return { country: ctx.country, industry: ctx.industry, analytics: Boolean(ctx.analytics) };
}

function notExpired(app) {
  if (Date.parse(app.expiresAt) < Date.now()) throw httpError(410, 'This link has expired. Ask your broker for a new one.');
}

// What anyone with the link may see: everything is either public metadata or encrypted.
function publicView(app) {
  const sections = {};
  for (const [sid, s] of Object.entries((app.setup && app.setup.sections) || {})) {
    sections[sid] = { wrap: s.wrap, adminWrap: s.adminWrap, brokerWrap: s.brokerWrap };
  }
  return {
    id: app.id, schemaId: app.schemaId, schemaVersion: app.schemaVersion,
    clientName: app.clientName, brokerName: app.brokerName, brokerEmail: app.brokerEmail,
    createdAt: app.createdAt, expiresAt: app.expiresAt, submittedAt: app.submittedAt || null,
    status: app.status, context: app.context, kdfSalt: app.kdfSalt,
    broker: app.broker, keys: app.setup ? sections : null, answers: app.answers
  };
}

// Tiny per-address rate limit: 120 requests a minute.
const hits = new Map();
function rateLimit(req) {
  const ip = req.socket.remoteAddress || '?';
  const now = Date.now();
  const h = hits.get(ip) || { start: now, n: 0 };
  if (now - h.start > 60000) { h.start = now; h.n = 0; }
  h.n++;
  hits.set(ip, h);
  if (h.n > 120) throw httpError(429, 'Too many requests. Wait a minute and try again.');
}
setInterval(() => { const cut = Date.now() - 60000; for (const [k, v] of hits) if (v.start < cut) hits.delete(k); }, 60000).unref();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(httpError(413, 'Too much data')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(httpError(400, 'Bad JSON')); }
    });
    req.on('error', reject);
  });
}

// ---------- API ----------

function createApi(schemas) {
  return async function api(req, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
    const method = req.method;

    if (method === 'GET' && parts[0] === 'config') {
      return { brokerCodeRequired: Boolean(BROKER_CODE) };
    }

    if (method === 'GET' && parts[0] === 'schemas' && parts.length === 1) {
      return Object.values(schemas).map(s => ({ id: s.id, title: s.title, version: s.version }));
    }
    if (method === 'GET' && parts[0] === 'schemas' && parts.length === 2) {
      const s = schemas[parts[1]];
      if (!s) throw httpError(404, 'No such form');
      return s;
    }

    if (parts[0] !== 'applications') throw httpError(404, 'Not found');

    // Broker creates a new application.
    if (method === 'POST' && parts.length === 1) {
      const b = await readBody(req);
      if (BROKER_CODE && !sameHash(hash(b.brokerCode || ''), hash(BROKER_CODE))) throw httpError(403, 'Wrong broker access code');
      const schema = schemas[b.schemaId];
      if (!schema) throw httpError(400, 'Pick a form');
      if (!str(b.clientName, 200)) throw httpError(400, 'Enter the client name');
      if (!str(b.brokerName, 200)) throw httpError(400, 'Enter your name');
      if (!str(b.adminSecretHash, 100)) throw httpError(400, 'Missing admin secret');
      if (!str(b.kdfSalt, 64)) throw httpError(400, 'Missing salt');
      if (!b.broker || typeof b.broker.publicKey !== 'object' || !isBox(b.broker.privateKeyBox) || !str(b.broker.salt, 64)) throw httpError(400, 'Missing broker key');
      const days = Math.min(Math.max(Number(b.expiresDays) || 30, 1), 90);
      const id = crypto.randomBytes(24).toString('base64url');
      const app = {
        id, schemaId: schema.id, schemaVersion: schema.version,
        clientName: b.clientName, brokerName: b.brokerName, brokerEmail: typeof b.brokerEmail === 'string' ? b.brokerEmail.slice(0, 200) : '',
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
        status: 'draft', context: checkContext(schema, b.context), kdfSalt: b.kdfSalt,
        broker: { publicKey: b.broker.publicKey, privateKeyBox: b.broker.privateKeyBox, salt: b.broker.salt },
        adminSecretHash: b.adminSecretHash, setup: null, answers: {}
      };
      await save(app);
      return { id };
    }

    const id = parts[1];
    if (method === 'GET' && parts.length === 2) {
      const app = await load(id);
      notExpired(app);
      return publicView(app);
    }

    // Client admin confirms country and industry, and locks each section with a password.
    if (method === 'POST' && parts.length === 3 && parts[2] === 'setup') {
      const b = await readBody(req);
      return withLock(id, async () => {
        const app = await load(id);
        notExpired(app);
        if (!sameHash(hash(b.adminSecret || ''), app.adminSecretHash)) throw httpError(403, 'This is not the admin link');
        if (app.status !== 'draft') throw httpError(409, 'The sections are already locked');
        const schema = schemas[app.schemaId];
        const context = checkContext(schema, b.context);
        const wanted = FormSchema.visibleSections(schema, context).map(s => s.id);
        const sections = {};
        for (const sid of wanted) {
          const s = b.sections && b.sections[sid];
          if (!s || !isBox(s.wrap) || !isBox(s.adminWrap) || !str(s.brokerWrap, 2000) || !str(s.writeHash, 100)) throw httpError(400, 'Missing lock for section ' + sid);
          sections[sid] = { wrap: s.wrap, adminWrap: s.adminWrap, brokerWrap: s.brokerWrap, writeHash: s.writeHash };
        }
        app.context = context;
        app.setup = { sections, at: new Date().toISOString() };
        app.status = 'open';
        await save(app);
        return publicView(app);
      });
    }

    // Anyone who unlocked a section saves its (encrypted) answers.
    if (method === 'PUT' && parts.length === 4 && parts[2] === 'sections') {
      const sid = parts[3];
      const b = await readBody(req);
      return withLock(id, async () => {
        const app = await load(id);
        notExpired(app);
        if (app.status !== 'open') throw httpError(409, app.status === 'submitted' ? 'This application has been sent to the broker' : 'The admin has not set up the sections yet');
        const lock = app.setup.sections[sid];
        if (!lock) throw httpError(404, 'No such section');
        if (!sameHash(hash(b.writeToken || ''), lock.writeHash)) throw httpError(403, 'Not allowed to change this section');
        if (!isBox(b.box)) throw httpError(400, 'Missing answers');
        app.answers[sid] = { box: b.box, complete: Boolean(b.complete), updatedAt: new Date().toISOString() };
        await save(app);
        return { ok: true, updatedAt: app.answers[sid].updatedAt };
      });
    }

    // Client admin gives a section a new password (they unlock it with their own password first).
    if (method === 'POST' && parts.length === 5 && parts[2] === 'sections' && parts[4] === 'password') {
      const sid = parts[3];
      const b = await readBody(req);
      return withLock(id, async () => {
        const app = await load(id);
        notExpired(app);
        if (!sameHash(hash(b.adminSecret || ''), app.adminSecretHash)) throw httpError(403, 'Only the admin can change passwords');
        if (app.status !== 'open') throw httpError(409, 'Passwords cannot be changed now');
        const lock = app.setup.sections[sid];
        if (!lock) throw httpError(404, 'No such section');
        if (!isBox(b.wrap)) throw httpError(400, 'Missing lock');
        lock.wrap = b.wrap;
        await save(app);
        return publicView(app);
      });
    }

    // Client admin sends the finished application to the broker. After this it can't be changed.
    if (method === 'POST' && parts.length === 3 && parts[2] === 'submit') {
      const b = await readBody(req);
      return withLock(id, async () => {
        const app = await load(id);
        notExpired(app);
        if (!sameHash(hash(b.adminSecret || ''), app.adminSecretHash)) throw httpError(403, 'Only the admin can send the application');
        if (app.status !== 'open') throw httpError(409, 'This application cannot be sent now');
        const missing = Object.keys(app.setup.sections).filter(sid => !(app.answers[sid] && app.answers[sid].complete));
        if (missing.length) throw httpError(409, 'Some sections are not finished yet');
        app.status = 'submitted';
        app.submittedAt = new Date().toISOString();
        await save(app);
        return publicView(app);
      });
    }

    throw httpError(404, 'Not found');
  };
}

// ---------- static files ----------

async function serveStatic(res, pathname) {
  let rel = pathname === '/' || pathname.startsWith('/a/') ? 'index.html' : pathname.slice(1);
  const p = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!p.startsWith(PUBLIC_DIR + path.sep)) throw httpError(404, 'Not found');
  let body;
  try { body = await fsp.readFile(p); } catch (e) { throw httpError(404, 'Not found'); }
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(body);
}

function createServer() {
  const schemas = loadSchemas();
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const api = createApi(schemas);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        rateLimit(req);
        const out = await api(req, url);
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(out));
      } else if (req.method === 'GET') {
        await serveStatic(res, url.pathname);
      } else {
        throw httpError(405, 'Not allowed');
      }
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong' : e.message }));
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log('Application form running at http://localhost:' + PORT));
}

module.exports = { createServer };
