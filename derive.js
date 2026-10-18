/* =====================================================================
   The Tiny Overlord — shared state logic
   Pure functions, no DOM, no network. The web app uses this file as-is,
   and the Apps Script backend should use a copy, so every client agrees
   on "what's true now" from the same event log.
   ===================================================================== */
(function (root) {
  'use strict';

  const TZ = 'Europe/London';
  const FEED_AUTO_CLOSE_MIN = 90;
  const MIN = 60000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  const TYPES = ['feed_start', 'feed_switch', 'feed', 'side_set', 'nappy', 'asleep', 'awake', 'meds', 'note', 'undo', 'edit'];

  function opposite(side) { return side === 'left' ? 'right' : 'left'; }

  // ---------- London time helpers (handles BST) ----------
  let partsFmt = null;
  try {
    partsFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    partsFmt.formatToParts(new Date(0));
  } catch (e) { partsFmt = null; }

  function londonParts(ms) {
    if (!partsFmt) {
      // Apps Script fallback, in case its Intl has no time zone data
      const s = Utilities.formatDate(new Date(ms), TZ, 'yyyy,MM,dd,HH,mm,ss').split(',').map(Number);
      return { year: s[0], month: s[1], day: s[2], hour: s[3], minute: s[4], second: s[5] };
    }
    const p = {};
    partsFmt.formatToParts(new Date(ms)).forEach(x => { if (x.type !== 'literal') p[x.type] = Number(x.value); });
    if (p.hour === 24) p.hour = 0;
    return p;
  }

  // Minutes London is ahead of UTC at this moment (0 in winter, 60 in summer)
  function londonOffset(ms) {
    const p = londonParts(ms);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MIN);
  }

  // Midnight London time on the day containing ms
  function londonDayStart(ms) {
    const p = londonParts(ms);
    const midUtc = Date.UTC(p.year, p.month - 1, p.day);
    const guess = midUtc - londonOffset(midUtc) * MIN;
    return midUtc - londonOffset(guess) * MIN;
  }

  function londonDayKey(ms) {
    const p = londonParts(ms);
    return p.year + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
  }

  function londonHour(ms) { return londonParts(ms).hour; }

  // ---------- Event log → effective events ----------

  // Applies undo and edit events. Returns the events that still count,
  // oldest first, each with a numeric `t` (ms) added.
  function effectiveEvents(events) {
    const byId = new Map();
    events.forEach(e => byId.set(e.id, e));

    const undosOf = new Map();
    events.forEach(e => {
      if (e.type === 'undo' && e.ref) {
        if (!undosOf.has(e.ref)) undosOf.set(e.ref, []);
        undosOf.get(e.ref).push(e);
      }
    });

    // An event is cancelled if an undo that is not itself cancelled points at it
    const memo = new Map();
    function cancelled(id, depth) {
      if (memo.has(id)) return memo.get(id);
      if ((depth || 0) > 20) return false;
      const res = (undosOf.get(id) || []).some(u => !cancelled(u.id, (depth || 0) + 1));
      memo.set(id, res);
      return res;
    }

    // Edits, applied oldest first
    const patches = new Map();
    events
      .filter(e => e.type === 'edit' && e.ref && e.patch && !cancelled(e.id))
      .sort(byTime)
      .forEach(e => {
        patches.set(e.ref, Object.assign(patches.get(e.ref) || {}, e.patch));
      });

    const out = [];
    events.forEach(e => {
      if (e.type === 'undo' || e.type === 'edit') return;
      if (cancelled(e.id)) return;
      const patch = patches.get(e.id);
      const ev = Object.assign({}, e, patch || {}, { id: e.id, type: e.type });
      if (patch) ev.edited = true;
      ev.t = Date.parse(ev.time);
      if (!isFinite(ev.t)) return;
      out.push(ev);
    });
    out.sort(byTime);

    // Two phones may both finish (or auto-close) the same running feed: keep the first
    const finished = new Set();
    return out.filter(e => {
      if (e.type !== 'feed' || !e.ref) return true;
      if (finished.has(e.ref)) return false;
      finished.add(e.ref);
      return true;
    });
  }

  function byTime(a, b) {
    const ta = a.t != null ? a.t : Date.parse(a.time);
    const tb = b.t != null ? b.t : Date.parse(b.time);
    return ta - tb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  // ---------- Feeds ----------

  function feedMinutes(feed) {
    if (feed.minutes != null && feed.minutes !== '') return Number(feed.minutes);
    return (feed.sides || []).reduce((s, x) => s + (Number(x.minutes) || 0), 0);
  }

  function feedEnd(feed) { return feed.t + feedMinutes(feed) * MIN; }

  // Turns a running feed into the `sides` list for its finished feed event
  function finishFeed(running, endMs) {
    const segs = running.segments;
    const sides = [];
    segs.forEach((s, i) => {
      const to = i + 1 < segs.length ? segs[i + 1].from : endMs;
      const mins = Math.max(0, (to - s.from) / MIN);
      const last = sides[sides.length - 1];
      if (last && last.side === s.side) last.minutes += mins;
      else sides.push({ side: s.side, minutes: mins });
    });
    sides.forEach(s => { s.minutes = Math.round(s.minutes); });
    const kept = sides.filter((s, i) => s.minutes > 0 || i === sides.length - 1);
    const total = Math.max(1, Math.round((endMs - running.start) / MIN));
    return { sides: kept, minutes: total };
  }

  // ---------- Medicines ----------

  // med config: { name, gapHours, maxPer24, daily }
  function medStatus(med, doses, now) {
    const mine = doses.filter(d => sameName(d.name, med.name)).sort(byTime);
    const last = mine[mine.length - 1] || null;
    const res = { name: med.name, last: last, daily: !!med.daily, status: 'ok', okFrom: null, inLast24: 0 };

    if (med.daily) {
      const start = londonDayStart(now);
      const today = mine.filter(d => d.t >= start && d.t <= now);
      res.givenToday = today.length;
      res.status = today.length ? 'done' : 'due';
      return res;
    }

    const recent = mine.filter(d => d.t > now - DAY && d.t <= now);
    res.inLast24 = recent.length;
    let okFrom = 0;
    if (last && med.gapHours) okFrom = Math.max(okFrom, last.t + med.gapHours * HOUR);
    if (med.maxPer24 && recent.length >= med.maxPer24) {
      // The oldest dose in the window has to drop out first
      const oldest = recent[recent.length - med.maxPer24];
      okFrom = Math.max(okFrom, oldest.t + DAY);
    }
    if (okFrom > now) { res.status = 'wait'; res.okFrom = okFrom; }
    return res;
  }

  function sameName(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }

  // ---------- Sleep ----------

  // Sleep periods as [{from, to, open}], `to` = now for an ongoing sleep
  function sleepPeriods(evs, now) {
    const out = [];
    let since = null;
    evs.forEach(e => {
      if (e.t > now) return;
      if (e.type === 'asleep' && since == null) since = e.t;
      if (e.type === 'awake' && since != null) { out.push({ from: since, to: e.t, open: false }); since = null; }
    });
    if (since != null) out.push({ from: since, to: now, open: true });
    return out;
  }

  function minutesInside(periods, from, to) {
    let m = 0;
    periods.forEach(p => {
      const s = Math.max(p.from, from), e = Math.min(p.to, to);
      if (e > s) m += (e - s) / MIN;
    });
    return Math.round(m);
  }

  // ---------- The derived state ----------

  function deriveState(events, opts) {
    opts = opts || {};
    const now = opts.now != null ? opts.now : Date.now();
    const meds = opts.meds || [];
    const evs = effectiveEvents(events).filter(e => e.t <= now + 5 * MIN);

    let running = null;
    let lastFeed = null;
    let nextSide = { side: 'left', at: 0, why: 'default' };
    let lastNappy = null;
    let lastSleepEvent = null;
    const doses = [];
    const closed = new Set();
    evs.forEach(e => { if (e.type === 'feed' && e.ref) closed.add(e.ref); });

    evs.forEach(e => {
      switch (e.type) {
        case 'feed_start':
          if (closed.has(e.id)) break;
          if (running) break; // someone else already started one: keep the first
          running = { id: e.id, start: e.t, source: e.source, segments: [{ side: e.side || 'left', from: e.t }] };
          break;
        case 'feed_switch':
          if (running && e.t >= running.start) running.segments.push({ side: e.side, from: e.t });
          break;
        case 'feed': {
          if (running && e.ref === running.id) running = null;
          if (!lastFeed || e.t >= lastFeed.t) lastFeed = e;
          const sides = e.sides || [];
          if ((e.kind || 'breast') === 'breast' && sides.length) {
            const at = feedEnd(e);
            if (at >= nextSide.at) nextSide = { side: opposite(sides[0].side), at: at, why: 'feed' };
          }
          break;
        }
        case 'side_set':
          if (e.t >= nextSide.at) nextSide = { side: e.side, at: e.t, why: 'set' };
          break;
        case 'nappy': lastNappy = e; break;
        case 'asleep': case 'awake': lastSleepEvent = e; break;
        case 'meds': doses.push(e); break;
      }
    });

    if (running) {
      const cur = running.segments[running.segments.length - 1];
      running.side = cur.side;
      running.minutesSoFar = Math.max(0, Math.floor((now - running.start) / MIN));
      running.overdue = running.minutesSoFar >= FEED_AUTO_CLOSE_MIN;
    }

    // Today, London calendar day
    const dayStart = londonDayStart(now);
    const today = { feeds: 0, feedMinutes: 0, bottleMl: 0, nappies: 0, wet: 0, dirty: 0, sleepMinutes: 0, meds: 0 };
    evs.forEach(e => {
      if (e.t < dayStart || e.t > now) return;
      if (e.type === 'feed') { today.feeds++; today.feedMinutes += feedMinutes(e); today.bottleMl += Number(e.ml) || 0; }
      if (e.type === 'nappy') {
        today.nappies++;
        if (e.detail === 'wet' || e.detail === 'both') today.wet++;
        if (e.detail === 'dirty' || e.detail === 'both') today.dirty++;
      }
      if (e.type === 'meds') today.meds++;
    });
    const periods = sleepPeriods(evs, now);
    today.sleepMinutes = minutesInside(periods, dayStart, now);

    const sleep = lastSleepEvent
      ? { asleep: lastSleepEvent.type === 'asleep', since: lastSleepEvent.t, by: lastSleepEvent.source }
      : { asleep: false, since: null };

    return {
      now: now,
      feedRunning: running,
      nextSide: running ? opposite(running.side) : nextSide.side,
      nextSideWhy: nextSide.why,
      lastFeed: lastFeed,
      lastNappy: lastNappy,
      sleep: sleep,
      meds: meds.map(m => medStatus(m, doses, now)),
      lastMeds: doses[doses.length - 1] || null,
      today: today,
      count: evs.length,
    };
  }

  // What happened since `since` (for the "while you were away" card)
  function summarySince(events, since, opts) {
    opts = opts || {};
    const now = opts.now != null ? opts.now : Date.now();
    const evs = effectiveEvents(events).filter(e => e.t > since && e.t <= now);
    const out = { since: since, feeds: [], nappies: { total: 0, wet: 0, dirty: 0 }, meds: [], notes: [], sleepMinutes: 0, events: evs.length };
    evs.forEach(e => {
      if (e.type === 'feed') out.feeds.push(e);
      if (e.type === 'nappy') {
        out.nappies.total++;
        if (e.detail === 'wet' || e.detail === 'both') out.nappies.wet++;
        if (e.detail === 'dirty' || e.detail === 'both') out.nappies.dirty++;
      }
      if (e.type === 'meds') out.meds.push(e);
      if (e.type === 'note') out.notes.push(e);
    });
    out.sleepMinutes = minutesInside(sleepPeriods(effectiveEvents(events), now), since, now);
    return out;
  }

  // ---------- Day by day (for "Your week" and the health visitor summary) ----------

  // One summary per London day, oldest first, for the `days` days ending with
  // the day that contains `end` (default: now). Nothing after `now` is counted.
  function daySummaries(events, opts) {
    opts = opts || {};
    const now = opts.now != null ? opts.now : Date.now();
    const days = opts.days || 7;
    const lastDay = londonDayStart(Math.min(opts.end != null ? opts.end : now, now));
    const evs = effectiveEvents(events).filter(e => e.t <= now);
    const periods = sleepPeriods(evs, now);
    const finished = new Set(evs.filter(e => e.type === 'feed' && e.ref).map(e => e.ref));

    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const start = londonDayStart(lastDay - i * DAY + 12 * HOUR);
      const end = londonDayStart(start + 36 * HOUR);
      const inDay = evs.filter(e => e.t >= start && e.t < end);
      const d = {
        key: londonDayKey(start), start: start, end: end,
        feeds: 0, breastFeeds: 0, bottleFeeds: 0, bottleMl: 0, feedMinutes: 0,
        nappies: 0, wet: 0, dirty: 0,
        sleepMinutes: 0, longestSleep: 0,
        feedBlocks: [], sleepBlocks: [], meds: [], notes: [],
        logged: inDay.length > 0,
      };
      inDay.forEach(e => {
        if (e.type === 'feed') {
          d.feeds++;
          if ((e.kind || 'breast') === 'bottle') { d.bottleFeeds++; d.bottleMl += Number(e.ml) || 0; } else d.breastFeeds++;
          const m = feedMinutes(e);
          d.feedMinutes += m;
          d.feedBlocks.push({ from: e.t, to: e.t + Math.max(m, 1) * MIN, kind: e.kind || 'breast' });
        }
        if (e.type === 'feed_start' && !finished.has(e.id)) d.feedBlocks.push({ from: e.t, to: now, running: true, kind: 'breast' });
        if (e.type === 'nappy') {
          d.nappies++;
          if (e.detail === 'wet' || e.detail === 'both') d.wet++;
          if (e.detail === 'dirty' || e.detail === 'both') d.dirty++;
        }
        if (e.type === 'meds') d.meds.push({ t: e.t, name: e.name || 'Medicine', source: e.source });
        if (e.type === 'note') d.notes.push({ t: e.t, note: e.note || '', source: e.source });
      });
      periods.forEach(p => {
        const s = Math.max(p.from, start), f = Math.min(p.to, end);
        if (f <= s) return;
        d.sleepBlocks.push({ from: s, to: f, open: p.open && f === p.to });
        const m = (f - s) / MIN;
        d.sleepMinutes += m;
        if (m > d.longestSleep) d.longestSleep = m;
      });
      d.sleepMinutes = Math.round(d.sleepMinutes);
      d.longestSleep = Math.round(d.longestSleep);
      if (d.sleepBlocks.length) d.logged = true;
      out.push(d);
    }
    return out;
  }

  // The longest single sleep that overlaps [from, to), measured in full
  // (a sleep from 23:00 to 03:00 counts as 4 hours, not split at midnight)
  function longestSleep(events, from, to, now) {
    now = now != null ? now : Date.now();
    let best = null;
    sleepPeriods(effectiveEvents(events), now).forEach(p => {
      if (p.to <= from || p.from >= to) return;
      const minutes = Math.round((p.to - p.from) / MIN);
      if (!best || minutes > best.minutes) best = { from: p.from, to: p.to, minutes: minutes, open: p.open };
    });
    return best;
  }

  // Checks an incoming event. Returns an error message or null.
  function validateEvent(e, now) {
    if (!e || typeof e !== 'object') return 'not an event';
    if (!e.id || typeof e.id !== 'string') return 'missing id';
    if (TYPES.indexOf(e.type) < 0) return 'unknown type: ' + e.type;
    const t = Date.parse(e.time);
    if (!isFinite(t)) return 'bad time';
    if (t > (now || Date.now()) + DAY) return 'time is more than 24 hours ahead';
    if (['feed_start', 'feed_switch', 'side_set'].indexOf(e.type) >= 0 && e.side !== 'left' && e.side !== 'right') return 'bad side';
    if (e.type === 'nappy' && ['wet', 'dirty', 'both'].indexOf(e.detail) < 0) return 'bad nappy detail';
    if ((e.type === 'undo' || e.type === 'edit') && !e.ref) return 'missing ref';
    return null;
  }

  const api = {
    TZ, FEED_AUTO_CLOSE_MIN, TYPES,
    opposite, londonParts, londonOffset, londonDayStart, londonDayKey, londonHour,
    effectiveEvents, deriveState, finishFeed, feedMinutes, feedEnd, medStatus,
    sleepPeriods, summarySince, validateEvent, daySummaries, longestSleep,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Overlord = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
