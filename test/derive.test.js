// Run with:  node --test webapp/test/derive.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../derive.js');

let n = 0;
const ev = (type, time, extra) => Object.assign({ id: 'test-' + (++n), type, time: new Date(time).toISOString(), source: 'app-sam' }, extra || {});

test('feed_start then feed: nothing running, next side flips', () => {
  const s0 = ev('feed_start', '2026-01-10T10:00:00Z', { side: 'left' });
  const f = ev('feed', '2026-01-10T10:00:00Z', { ref: s0.id, sides: [{ side: 'left', minutes: 18 }], minutes: 18 });
  const running = O.deriveState([s0], { now: Date.parse('2026-01-10T10:05:00Z') });
  assert.equal(running.feedRunning.side, 'left');
  assert.equal(running.feedRunning.minutesSoFar, 5);
  const st = O.deriveState([s0, f], { now: Date.parse('2026-01-10T11:00:00Z') });
  assert.equal(st.feedRunning, null);
  assert.equal(st.nextSide, 'right');
  assert.equal(st.lastFeed.id, f.id);
});

test('a feed on both sides: next side is the one you finished on', () => {
  const f = ev('feed', '2026-01-10T10:00:00Z', { sides: [{ side: 'left', minutes: 12 }, { side: 'right', minutes: 8 }], minutes: 20 });
  const st = O.deriveState([f], { now: Date.parse('2026-01-10T11:00:00Z') });
  assert.equal(st.nextSide, 'right');
});

test('changing the next side by hand wins over an earlier feed', () => {
  const f = ev('feed', '2026-01-10T10:00:00Z', { sides: [{ side: 'left', minutes: 10 }] });
  const set = ev('side_set', '2026-01-10T10:30:00Z', { side: 'left' });
  assert.equal(O.deriveState([f, set], { now: Date.parse('2026-01-10T11:00:00Z') }).nextSide, 'left');
});

test('a bottle feed does not change the next side', () => {
  const f = ev('feed', '2026-01-10T10:00:00Z', { sides: [{ side: 'left', minutes: 10 }] });
  const b = ev('feed', '2026-01-10T12:00:00Z', { kind: 'bottle', ml: 90, minutes: 10 });
  const st = O.deriveState([f, b], { now: Date.parse('2026-01-10T13:00:00Z') });
  assert.equal(st.nextSide, 'right');
  assert.equal(st.lastFeed.kind, 'bottle');
  assert.equal(st.today.bottleMl, 90);
});

test('switching sides mid-feed records both sides', () => {
  const s0 = ev('feed_start', '2026-01-10T10:00:00Z', { side: 'left' });
  const sw = ev('feed_switch', '2026-01-10T10:12:00Z', { side: 'right' });
  const st = O.deriveState([s0, sw], { now: Date.parse('2026-01-10T10:20:00Z') });
  assert.equal(st.feedRunning.side, 'right');
  const done = O.finishFeed(st.feedRunning, Date.parse('2026-01-10T10:20:00Z'));
  assert.deepEqual(done.sides, [{ side: 'left', minutes: 12 }, { side: 'right', minutes: 8 }]);
  assert.equal(done.minutes, 20);
});

test('a second feed start while one is running is ignored', () => {
  const a = ev('feed_start', '2026-01-10T10:00:00Z', { side: 'left' });
  const b = ev('feed_start', '2026-01-10T10:01:00Z', { side: 'right' });
  const st = O.deriveState([a, b], { now: Date.parse('2026-01-10T10:05:00Z') });
  assert.equal(st.feedRunning.id, a.id);
});

test('the same feed finished on two phones counts once', () => {
  const s0 = ev('feed_start', '2026-01-10T10:00:00Z', { side: 'left' });
  const f1 = ev('feed', '2026-01-10T10:00:00Z', { ref: s0.id, sides: [{ side: 'left', minutes: 90 }], minutes: 90 });
  const f2 = ev('feed', '2026-01-10T10:00:00Z', { ref: s0.id, sides: [{ side: 'left', minutes: 90 }], minutes: 90 });
  const st = O.deriveState([s0, f1, f2], { now: Date.parse('2026-01-10T12:00:00Z') });
  assert.equal(st.today.feeds, 1);
  assert.equal(st.feedRunning, null);
});

test('a feed running for 90 minutes is flagged as overdue', () => {
  const a = ev('feed_start', '2026-01-10T10:00:00Z', { side: 'left' });
  assert.equal(O.deriveState([a], { now: Date.parse('2026-01-10T11:31:00Z') }).feedRunning.overdue, true);
});

test('undo of a nappy falls back to the previous one; undoing the undo restores it', () => {
  const a = ev('nappy', '2026-01-10T09:00:00Z', { detail: 'wet' });
  const b = ev('nappy', '2026-01-10T10:00:00Z', { detail: 'dirty' });
  const u = ev('undo', '2026-01-10T10:01:00Z', { ref: b.id });
  const now = Date.parse('2026-01-10T11:00:00Z');
  assert.equal(O.deriveState([a, b, u], { now }).lastNappy.id, a.id);
  assert.equal(O.deriveState([a, b, u], { now }).today.nappies, 1);
  const uu = ev('undo', '2026-01-10T10:02:00Z', { ref: u.id });
  assert.equal(O.deriveState([a, b, u, uu], { now }).lastNappy.id, b.id);
});

test('both counts as wet and dirty', () => {
  const a = ev('nappy', '2026-01-10T09:00:00Z', { detail: 'both' });
  const st = O.deriveState([a], { now: Date.parse('2026-01-10T11:00:00Z') });
  assert.deepEqual([st.today.nappies, st.today.wet, st.today.dirty], [1, 1, 1]);
});

test('an edit changes the time of an event', () => {
  const a = ev('nappy', '2026-01-10T09:00:00Z', { detail: 'wet' });
  const e = ev('edit', '2026-01-10T10:00:00Z', { ref: a.id, patch: { time: '2026-01-10T08:30:00Z', detail: 'dirty' } });
  const st = O.deriveState([a, e], { now: Date.parse('2026-01-10T11:00:00Z') });
  assert.equal(st.lastNappy.t, Date.parse('2026-01-10T08:30:00Z'));
  assert.equal(st.lastNappy.detail, 'dirty');
  assert.equal(st.lastNappy.edited, true);
});

test('sleep 23:30 to 02:00 is split across two days (winter)', () => {
  const a = ev('asleep', '2026-01-10T23:30:00Z');
  const b = ev('awake', '2026-01-11T02:00:00Z');
  assert.equal(O.deriveState([a, b], { now: Date.parse('2026-01-10T23:59:59Z') }).today.sleepMinutes, 30);
  assert.equal(O.deriveState([a, b], { now: Date.parse('2026-01-11T08:00:00Z') }).today.sleepMinutes, 120);
});

test('sleep split uses London midnight in summer time (BST)', () => {
  // 23:30 BST = 22:30 UTC
  const a = ev('asleep', '2026-07-10T22:30:00Z');
  const b = ev('awake', '2026-07-11T01:00:00Z');
  assert.equal(O.deriveState([a, b], { now: Date.parse('2026-07-11T07:00:00Z') }).today.sleepMinutes, 120);
});

test('ongoing sleep counts up to now', () => {
  const a = ev('asleep', '2026-01-10T10:00:00Z');
  const st = O.deriveState([a], { now: Date.parse('2026-01-10T11:15:00Z') });
  assert.equal(st.sleep.asleep, true);
  assert.equal(st.today.sleepMinutes, 75);
});

test('medicine: minimum gap between doses', () => {
  const meds = [{ name: 'Calpol', gapHours: 4, maxPer24: 4 }];
  const d = ev('meds', '2026-01-10T10:00:00Z', { name: 'Calpol' });
  const early = O.deriveState([d], { now: Date.parse('2026-01-10T12:00:00Z'), meds }).meds[0];
  assert.equal(early.status, 'wait');
  assert.equal(early.okFrom, Date.parse('2026-01-10T14:00:00Z'));
  assert.equal(O.deriveState([d], { now: Date.parse('2026-01-10T14:00:00Z'), meds }).meds[0].status, 'ok');
});

test('medicine: maximum doses in 24 hours', () => {
  const meds = [{ name: 'Calpol', gapHours: 4, maxPer24: 4 }];
  const doses = ['00:00', '04:00', '08:00', '12:00'].map(h => ev('meds', '2026-01-10T' + h + ':00Z', { name: 'calpol' }));
  const st = O.deriveState(doses, { now: Date.parse('2026-01-10T17:00:00Z'), meds }).meds[0];
  assert.equal(st.status, 'wait');
  assert.equal(st.okFrom, Date.parse('2026-01-11T00:00:00Z'));
});

test('medicine: once a day', () => {
  const meds = [{ name: 'Vitamin D', daily: true }];
  const d = ev('meds', '2026-01-10T08:00:00Z', { name: 'Vitamin D' });
  assert.equal(O.deriveState([d], { now: Date.parse('2026-01-10T20:00:00Z'), meds }).meds[0].status, 'done');
  assert.equal(O.deriveState([d], { now: Date.parse('2026-01-11T07:00:00Z'), meds }).meds[0].status, 'due');
});

test('summary since: counts what happened while you were away', () => {
  const evs = [
    ev('nappy', '2026-01-10T01:00:00Z', { detail: 'wet', source: 'app-beth' }),
    ev('feed', '2026-01-10T02:00:00Z', { sides: [{ side: 'left', minutes: 15 }] }),
    ev('meds', '2026-01-10T03:00:00Z', { name: 'Calpol' }),
    ev('nappy', '2026-01-09T20:00:00Z', { detail: 'dirty' }),
  ];
  const s = O.summarySince(evs, Date.parse('2026-01-10T00:00:00Z'), { now: Date.parse('2026-01-10T06:00:00Z') });
  assert.equal(s.feeds.length, 1);
  assert.equal(s.nappies.total, 1);
  assert.equal(s.meds.length, 1);
});

test('validation', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  assert.equal(O.validateEvent(ev('nappy', '2026-01-10T10:00:00Z', { detail: 'wet' }), now), null);
  assert.match(O.validateEvent(ev('party', '2026-01-10T10:00:00Z'), now), /unknown type/);
  assert.match(O.validateEvent(ev('nappy', '2026-01-10T10:00:00Z', { detail: 'green' }), now), /nappy/);
  assert.match(O.validateEvent(ev('feed_start', '2026-01-10T10:00:00Z', { side: 'L' }), now), /side/);
  assert.match(O.validateEvent(ev('nappy', '2026-01-12T10:00:00Z', { detail: 'wet' }), now), /ahead/);
});

test('day summaries: one per London day, oldest first, nothing logged is not the same as zero', () => {
  const evs = [
    ev('nappy', '2026-01-09T09:00:00Z', { detail: 'both' }),
    ev('nappy', '2026-01-09T10:00:00Z', { detail: 'wet' }),
    ev('feed', '2026-01-09T11:00:00Z', { sides: [{ side: 'left', minutes: 20 }], minutes: 20 }),
    ev('feed', '2026-01-09T14:00:00Z', { kind: 'bottle', ml: 90 }),
    ev('meds', '2026-01-09T15:00:00Z', { name: 'Calpol' }),
    ev('note', '2026-01-09T16:00:00Z', { note: 'rash' }),
  ];
  const days = O.daySummaries(evs, { now: Date.parse('2026-01-10T12:00:00Z'), days: 3 });
  assert.deepEqual(days.map(d => d.key), ['2026-01-08', '2026-01-09', '2026-01-10']);
  const d = days[1];
  assert.deepEqual([d.nappies, d.wet, d.dirty], [2, 2, 1]);
  assert.deepEqual([d.feeds, d.breastFeeds, d.bottleFeeds, d.bottleMl], [2, 1, 1, 90]);
  assert.equal(d.meds.length, 1);
  assert.equal(d.notes[0].note, 'rash');
  assert.equal(days[0].logged, false);
  assert.equal(days[2].logged, false);
});

test('day summaries: sleep split at midnight; longest sleep measured in full', () => {
  const evs = [ev('asleep', '2026-01-09T23:00:00Z'), ev('awake', '2026-01-10T03:00:00Z')];
  const now = Date.parse('2026-01-10T12:00:00Z');
  const days = O.daySummaries(evs, { now, days: 2 });
  assert.equal(days[0].sleepMinutes, 60);
  assert.equal(days[1].sleepMinutes, 180);
  assert.equal(days[1].sleepBlocks.length, 1);
  const best = O.longestSleep(evs, Date.parse('2026-01-04T00:00:00Z'), now, now);
  assert.equal(best.minutes, 240);
});

test('day summaries: a running feed shows as a block up to now', () => {
  const s0 = ev('feed_start', '2026-01-10T11:40:00Z', { side: 'left' });
  const d = O.daySummaries([s0], { now: Date.parse('2026-01-10T12:00:00Z'), days: 1 })[0];
  assert.equal(d.feedBlocks.length, 1);
  assert.equal(d.feedBlocks[0].running, true);
  assert.equal(d.feeds, 0);
});

test('day summaries: an earlier week, across the clocks going back', () => {
  // Clocks went back on 25 October 2026: that day has 25 hours
  const evs = [ev('nappy', '2026-10-25T23:30:00Z', { detail: 'wet' })];   // 23:30 GMT, still the 25th
  const days = O.daySummaries(evs, { now: Date.parse('2026-11-05T12:00:00Z'), end: Date.parse('2026-10-26T12:00:00Z'), days: 2 });
  assert.deepEqual(days.map(d => d.key), ['2026-10-25', '2026-10-26']);
  assert.equal(days[0].end - days[0].start, 25 * 3600000);
  assert.equal(days[0].nappies, 1);
});
