// End-to-end encryption for the application. Runs in the browser (and in Node for tests).
// The server only ever stores encrypted answers and wrapped keys. It never sees a password.
//
// Each section has its own random data key. That key is stored "wrapped" (encrypted) three ways:
//   - with the section password (for the person filling it in)
//   - with the client admin's password (so the admin can see everything)
//   - with the broker's public key (so the broker can read the finished application)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SecureBox = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const subtle = globalThis.crypto.subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const PBKDF2_ITERATIONS = 310000;

  function toB64u(bytes) {
    const b = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64u(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function randomBytes(n) {
    return globalThis.crypto.getRandomValues(new Uint8Array(n));
  }

  function randomId(nBytes) {
    return toB64u(randomBytes(nBytes || 24));
  }

  async function sha256(str) {
    return toB64u(await subtle.digest('SHA-256', enc.encode(str)));
  }

  // Letters that are easy to tell apart: no b/d/p/q, i/l/1, o/0, 8.
  const PASS_ALPHABET = 'acefghjkmnrstuvwxyz2345679';
  function generatePassword() {
    const groups = [];
    for (let g = 0; g < 4; g++) {
      let s = '';
      for (const b of randomBytes(4)) s += PASS_ALPHABET[b % PASS_ALPHABET.length];
      groups.push(s);
    }
    return groups.join('-');
  }

  // Passwords are compared as typed, except case and spaces at the ends.
  function normalisePassword(p) {
    return String(p).trim().toLowerCase();
  }

  async function deriveKey(password, saltB64u) {
    const base = await subtle.importKey('raw', enc.encode(normalisePassword(password)), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64u(saltB64u), iterations: PBKDF2_ITERATIONS },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function seal(key, bytes, aad) {
    const iv = randomBytes(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad || '') }, key, bytes);
    return { iv: toB64u(iv), ct: toB64u(ct) };
  }

  // Returns null if the key is wrong or the data was changed.
  async function open(key, box, aad) {
    try {
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(box.iv), additionalData: enc.encode(aad || '') }, key, fromB64u(box.ct));
      return new Uint8Array(pt);
    } catch (e) {
      return null;
    }
  }

  function newDataKey() {
    return randomBytes(32);
  }

  function importDataKey(raw) {
    return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  async function encryptJson(rawKey, obj, aad) {
    return seal(await importDataKey(rawKey), enc.encode(JSON.stringify(obj)), aad);
  }

  async function decryptJson(rawKey, box, aad) {
    const pt = await open(await importDataKey(rawKey), box, aad);
    return pt ? JSON.parse(dec.decode(pt)) : null;
  }

  // Anyone who can unlock a section can also save it. The server keeps only a hash of this token.
  async function writeToken(rawKey) {
    const k = await subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return toB64u(await subtle.sign('HMAC', k, enc.encode('section-write')));
  }

  // Broker key pair. The private key is kept on the server, encrypted with the broker's password.
  async function createBrokerKeys(password, saltB64u) {
    const pair = await subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt']);
    const publicKey = await subtle.exportKey('jwk', pair.publicKey);
    const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
    const privateKeyBox = await seal(await deriveKey(password, saltB64u), pkcs8, 'broker-private-key');
    return { publicKey, privateKeyBox };
  }

  async function unlockBrokerKey(password, saltB64u, privateKeyBox) {
    const pkcs8 = await open(await deriveKey(password, saltB64u), privateKeyBox, 'broker-private-key');
    if (!pkcs8) return null;
    return subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  }

  async function wrapForBroker(publicJwk, rawKey) {
    const pub = await subtle.importKey('jwk', publicJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    return toB64u(await subtle.encrypt({ name: 'RSA-OAEP' }, pub, rawKey));
  }

  async function unwrapForBroker(privateKey, wrapped) {
    try {
      return new Uint8Array(await subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromB64u(wrapped)));
    } catch (e) {
      return null;
    }
  }

  return {
    toB64u, fromB64u, randomId, sha256, generatePassword, normalisePassword,
    deriveKey, seal, open, newDataKey, encryptJson, decryptJson, writeToken,
    createBrokerKeys, unlockBrokerKey, wrapForBroker, unwrapForBroker, PBKDF2_ITERATIONS
  };
});
