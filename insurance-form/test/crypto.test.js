const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/crypto.js');

test('a section key opens with the right password only', async () => {
  const salt = S.randomId(16);
  const raw = S.newDataKey();
  const box = await S.seal(await S.deriveKey('green-river-lamp', salt), raw, 'app:infosec:wrap');
  assert.deepEqual(await S.open(await S.deriveKey(' Green-River-Lamp ', salt), box, 'app:infosec:wrap'), raw);
  assert.equal(await S.open(await S.deriveKey('wrong-password', salt), box, 'app:infosec:wrap'), null);
  // A wrapped key moved to another section does not open.
  assert.equal(await S.open(await S.deriveKey('green-river-lamp', salt), box, 'app:exposure:wrap'), null);
});

test('answers round-trip and cannot be read with another key', async () => {
  const raw = S.newDataKey();
  const box = await S.encryptJson(raw, { revenue_total: 5000000 }, 'a');
  assert.deepEqual(await S.decryptJson(raw, box, 'a'), { revenue_total: 5000000 });
  assert.equal(await S.decryptJson(S.newDataKey(), box, 'a'), null);
});

test('the broker key pair opens section keys with the broker password', async () => {
  const salt = S.randomId(16);
  const keys = await S.createBrokerKeys('broker-pass-123', salt);
  const raw = S.newDataKey();
  const wrapped = await S.wrapForBroker(keys.publicKey, raw);
  const priv = await S.unlockBrokerKey('broker-pass-123', salt, keys.privateKeyBox);
  assert.deepEqual(await S.unwrapForBroker(priv, wrapped), raw);
  assert.equal(await S.unlockBrokerKey('not-the-password', salt, keys.privateKeyBox), null);
});

test('generated passwords are long and avoid letters that look alike', () => {
  for (let i = 0; i < 50; i++) {
    const p = S.generatePassword();
    assert.match(p, /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    assert.doesNotMatch(p, /[bdpqilo018]/);
  }
});
