// The whole journey through the API, doing the browser's encryption in Node.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appform-'));
process.env.DATA_DIR = dataDir;
const { createServer } = require('../server.js');
const S = require('../public/crypto.js');

let base;
const server = createServer();
test.before(() => new Promise(r => server.listen(0, () => { base = 'http://127.0.0.1:' + server.address().port; r(); })));
test.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

async function call(method, p, body) {
  const res = await fetch(base + '/api' + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
}

test('broker creates, admin locks sections, colleagues fill in, broker reads', async () => {
  // Broker
  const adminSecret = S.randomId(24);
  const brokerSalt = S.randomId(16);
  const brokerKeys = await S.createBrokerKeys('broker-secret-1', brokerSalt);
  const created = await call('POST', '/applications', {
    schemaId: 'cyber', clientName: 'Acme Ltd', brokerName: 'Sam',
    context: { country: 'GB', industry: 'retail', analytics: false },
    kdfSalt: S.randomId(16), adminSecretHash: await S.sha256(adminSecret),
    broker: { ...brokerKeys, salt: brokerSalt }
  });
  assert.equal(created.status, 200);
  const id = created.json.id;

  let app = (await call('GET', '/applications/' + id)).json;
  assert.equal(app.status, 'draft');
  assert.equal(app.keys, null);
  assert.equal(app.adminSecretHash, undefined, 'admin secret hash must not be shown');

  // Colleagues cannot set up; only the admin link can.
  assert.equal((await call('POST', '/applications/' + id + '/setup', { adminSecret: 'guess', context: app.context, sections: {} })).status, 403);

  // Admin turns on analytics and locks every section. InfoSec gets its own password.
  const context = { country: 'GB', industry: 'retail', analytics: true };
  const sids = ['company', 'exposure', 'infosec', 'privacy', 'claims', 'analytics', 'declaration'];
  const adminKek = await S.deriveKey('admin-pass-1', app.kdfSalt);
  const infosecKek = await S.deriveKey('infosec-pass-1', app.kdfSalt);
  const raws = {};
  const sections = {};
  for (const sid of sids) {
    raws[sid] = S.newDataKey();
    const kek = sid === 'infosec' || sid === 'analytics' ? infosecKek : adminKek;
    sections[sid] = {
      wrap: await S.seal(kek, raws[sid], id + ':' + sid + ':wrap'),
      adminWrap: await S.seal(adminKek, raws[sid], id + ':' + sid + ':admin'),
      brokerWrap: await S.wrapForBroker(app.broker.publicKey, raws[sid]),
      writeHash: await S.sha256(await S.writeToken(raws[sid]))
    };
  }
  const missing = { ...sections };
  delete missing.analytics;
  assert.equal((await call('POST', '/applications/' + id + '/setup', { adminSecret, context, sections: missing })).status, 400, 'every shown section needs a lock');
  const setup = await call('POST', '/applications/' + id + '/setup', { adminSecret, context, sections });
  assert.equal(setup.status, 200);
  assert.equal(setup.json.status, 'open');
  assert.equal(setup.json.keys.infosec.writeHash, undefined, 'write hashes stay on the server');
  assert.equal((await call('POST', '/applications/' + id + '/setup', { adminSecret, context, sections })).status, 409, 'cannot set up twice');

  // InfoSec person: the password opens their two sections and nothing else.
  app = (await call('GET', '/applications/' + id)).json;
  const opened = [];
  for (const sid of sids) if (await S.open(infosecKek, app.keys[sid].wrap, id + ':' + sid + ':wrap')) opened.push(sid);
  assert.deepEqual(opened, ['infosec', 'analytics']);

  // Saving needs the right write token.
  const box = await S.encryptJson(raws.infosec, { mfa_email: 'yes' }, id + ':infosec:answers');
  assert.equal((await call('PUT', '/applications/' + id + '/sections/infosec', { writeToken: 'nope', box, complete: true })).status, 403);
  assert.equal((await call('PUT', '/applications/' + id + '/sections/infosec', { writeToken: await S.writeToken(raws.exposure), box, complete: true })).status, 403);
  assert.equal((await call('PUT', '/applications/' + id + '/sections/infosec', { writeToken: await S.writeToken(raws.infosec), box, complete: true })).status, 200);

  // The server copy holds no readable answers.
  const onDisk = fs.readFileSync(path.join(dataDir, id + '.json'), 'utf8');
  assert.doesNotMatch(onDisk, /mfa_email/);

  // Cannot send until everything is finished.
  assert.equal((await call('POST', '/applications/' + id + '/submit', { adminSecret })).status, 409);
  for (const sid of sids.filter(s => s !== 'infosec')) {
    const b = await S.encryptJson(raws[sid], { note: sid }, id + ':' + sid + ':answers');
    await call('PUT', '/applications/' + id + '/sections/' + sid, { writeToken: await S.writeToken(raws[sid]), box: b, complete: true });
  }
  assert.equal((await call('POST', '/applications/' + id + '/submit', { adminSecret: 'x' })).status, 403);
  assert.equal((await call('POST', '/applications/' + id + '/submit', { adminSecret })).json.status, 'submitted');
  assert.equal((await call('PUT', '/applications/' + id + '/sections/infosec', { writeToken: await S.writeToken(raws.infosec), box, complete: true })).status, 409, 'locked after sending');

  // Broker reads everything with the broker password.
  app = (await call('GET', '/applications/' + id)).json;
  const priv = await S.unlockBrokerKey('broker-secret-1', app.broker.salt, app.broker.privateKeyBox);
  const raw = await S.unwrapForBroker(priv, app.keys.infosec.brokerWrap);
  assert.deepEqual(await S.decryptJson(raw, app.answers.infosec.box, id + ':infosec:answers'), { mfa_email: 'yes' });
});

test('admin can give a section a new password', async () => {
  const adminSecret = S.randomId(24);
  const brokerSalt = S.randomId(16);
  const brokerKeys = await S.createBrokerKeys('broker-secret-2', brokerSalt);
  const { json: { id } } = await call('POST', '/applications', {
    schemaId: 'cyber', clientName: 'Beta plc', brokerName: 'Sam', context: { country: 'US', industry: 'healthcare' },
    kdfSalt: S.randomId(16), adminSecretHash: await S.sha256(adminSecret), broker: { ...brokerKeys, salt: brokerSalt }
  });
  const app = (await call('GET', '/applications/' + id)).json;
  const kek = await S.deriveKey('admin-pass-2', app.kdfSalt);
  const sections = {};
  for (const sid of ['company', 'exposure', 'infosec', 'privacy', 'claims', 'declaration']) {
    const raw = S.newDataKey();
    sections[sid] = { wrap: await S.seal(kek, raw, 'w'), adminWrap: await S.seal(kek, raw, 'a'), brokerWrap: await S.wrapForBroker(app.broker.publicKey, raw), writeHash: await S.sha256(await S.writeToken(raw)) };
  }
  assert.equal((await call('POST', '/applications/' + id + '/setup', { adminSecret, context: app.context, sections })).status, 200);
  const newWrap = { iv: 'aaaa', ct: 'bbbb' };
  assert.equal((await call('POST', '/applications/' + id + '/sections/infosec/password', { adminSecret: 'x', wrap: newWrap })).status, 403);
  const out = await call('POST', '/applications/' + id + '/sections/infosec/password', { adminSecret, wrap: newWrap });
  assert.deepEqual(out.json.keys.infosec.wrap, newWrap);
});

test('bad ids and unknown paths are rejected', async () => {
  assert.equal((await call('GET', '/applications/../../etc/passwd')).status, 404);
  assert.equal((await call('GET', '/applications/short')).status, 404);
  const res = await fetch(base + '/../server.js');
  assert.equal(res.status, 404);
  const page = await fetch(base + '/a/' + 'x'.repeat(32));
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
});
