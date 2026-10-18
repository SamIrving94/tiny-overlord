/* =====================================================================
   The Tiny Overlord — screens
   One question per screen: "what do I do now?" Everything else is a tap away.
   ===================================================================== */
(function () {
  'use strict';

  const O = window.Overlord;
  const S = window.Store;
  const MIN = 60000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const UNDO_MS = 8000;
  const HANDOVER_AFTER = 45 * MIN;

  const $ = sel => document.querySelector(sel);

  // ---------- Icons (always shown next to words) ----------

  const svg = body => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  const ICONS = {
    home: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
    list: svg('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    feed: svg('<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/>'),
    bottle: svg('<path d="M10 2h4M9 5h6l-1-3h-4zM8 9a3 3 0 0 1 3-4h2a3 3 0 0 1 3 4v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/><path d="M8 13h8"/>'),
    nappy: svg('<path d="M3 7h18v3a9 9 0 0 1-18 0z"/><path d="M8 7v3M16 7v3"/>'),
    moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    meds: svg('<rect x="3" y="9" width="18" height="7" rx="3.5" transform="rotate(-35 12 12.5)"/><path d="M9.5 8.5l5 7"/>'),
    note: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    week: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h4M7 17h8"/>'),
    print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>'),
    swap: svg('<path d="M7 7h13l-4-4M17 17H4l4 4"/>'),
  };
  const icon = name => '<span class="ico" aria-hidden="true">' + (ICONS[name] || '') + '</span>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Words for times ----------

  const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: O.TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const weekdayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: O.TZ, weekday: 'long' });
  const longDateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: O.TZ, weekday: 'long', day: 'numeric', month: 'long' });

  const dayNumFmt = new Intl.DateTimeFormat('en-GB', { timeZone: O.TZ, weekday: 'long', day: 'numeric' });
  const monthFmt = new Intl.DateTimeFormat('en-GB', { timeZone: O.TZ, month: 'long' });
  const fullDateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: O.TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const clock = ms => clockFmt.format(new Date(ms));

  // "Today", "Yesterday", "Wednesday 14"
  function dayLabel(dayStart, now) {
    const w = dayWord(dayStart + HOUR, now);
    return w === 'Today' || w === 'Yesterday' ? w : dayNumFmt.format(new Date(dayStart + HOUR));
  }

  // "Monday 12 to Sunday 18 October", "Monday 28 September to Sunday 4 October"
  function rangeText(fromDay, toDay) {
    const a = new Date(fromDay + HOUR), b = new Date(toDay + HOUR);
    const sameMonth = monthFmt.format(a) === monthFmt.format(b);
    return dayNumFmt.format(a) + (sameMonth ? '' : ' ' + monthFmt.format(a)) + ' to ' + dayNumFmt.format(b) + ' ' + monthFmt.format(b);
  }

  function dayWord(ms, now) {
    const k = O.londonDayKey(ms);
    if (k === O.londonDayKey(now)) return 'Today';
    if (k === O.londonDayKey(O.londonDayStart(now) - 1)) return 'Yesterday';
    return now - ms < 6 * DAY ? weekdayFmt.format(new Date(ms)) : longDateFmt.format(new Date(ms));
  }

  // "14:05", "yesterday at 23:10", "Saturday at 14:05"
  function when(ms, now) {
    const d = dayWord(ms, now);
    if (d === 'Today') return clock(ms);
    return (d === 'Yesterday' ? 'yesterday' : d) + ' at ' + clock(ms);
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  function duration(mins) {
    mins = Math.max(0, Math.floor(mins));
    if (mins < 60) return mins + ' min';
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h >= 48) return Math.floor(h / 24) + ' days';
    const hs = h + (h === 1 ? ' hour' : ' hours');
    return m ? hs + ' ' + m + ' min' : hs;
  }

  function ago(ms, now) {
    const m = (now - ms) / MIN;
    return m < 1 ? 'just now' : duration(m) + ' ago';
  }

  const sideName = s => (s === 'left' ? 'Left' : 'Right');
  const nappyWord = d => ({ wet: 'Wet', dirty: 'Dirty', both: 'Wet and dirty' }[d] || 'Nappy');

  function feedText(f) {
    if ((f.kind || 'breast') === 'bottle') return 'Bottle' + (f.ml ? ', ' + f.ml + ' ml' : '') + (f.minutes ? ', ' + f.minutes + ' min' : '');
    return (f.sides || []).map(x => sideName(x.side) + ' ' + x.minutes + ' min').join(', then ');
  }

  function whoName(source) {
    if (!source) return '';
    if (source === S.mySource()) return 'you';
    if (source === 'device') return 'the Overlord';
    const s = source.replace(/^app-/, '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // London clock time "HH:MM" on the same London day as refMs → ms
  function londonTimeOn(refMs, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const p = O.londonParts(refMs);
    const naive = Date.UTC(p.year, p.month - 1, p.day, h, m);
    return naive - O.londonOffset(naive - O.londonOffset(naive) * MIN) * MIN;
  }

  function buzz() { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} }

  // ---------- App state ----------

  let view = 'now';
  let st = null;
  let dayOffset = 0;               // Today screen: 0 = today, 1 = yesterday...
  let weekOffset = 0;              // Week screen: 0 = the last 7 days, 1 = the 7 before...
  let printDays = 7;
  let handoverSince = S.settings.lastSeen || 0;
  let handoverShowing = false;
  let lastMain = '';
  let lastSheet = '';
  let sheetDraw = null;
  let draft = {};
  let toastTimer = null;
  const autoClosed = new Set();

  function derive(now) {
    return O.deriveState(S.allEvents(), { now: now || Date.now(), meds: S.settings.meds || [] });
  }

  // ---------- Theme ----------

  function applyTheme() {
    const pref = S.settings.theme;
    const h = O.londonHour(Date.now());
    const t = pref === 'day' || pref === 'night' ? pref : (h >= 19 || h < 7 ? 'night' : 'day');
    if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
    $('#theme-color').setAttribute('content', t === 'night' ? '#15110E' : '#FAF6F0');
  }

  // ---------- Header ----------

  function babyAge(now) {
    const b = S.settings.birthDate;
    if (!b) return '';
    const born = Date.parse(b + 'T12:00:00Z');
    if (!isFinite(born)) return '';
    const days = Math.floor((O.londonDayStart(now) - O.londonDayStart(born)) / DAY + 0.5);
    if (days < 0) return '';
    if (days <= 60) return 'Day ' + (days + 1);
    return Math.floor(days / 7) + ' weeks old';
  }

  function drawHeader(now) {
    const name = S.settings.babyName;
    const age = babyAge(now);
    $('#top-title').textContent = name ? name + (age ? ' · ' + age : '') : (age || 'The Tiny Overlord');

    const el = $('#sync');
    const q = S.queueLength;
    let cls = '', text = 'All saved';
    if (!S.connected()) { cls = 'demo'; text = 'On this phone only'; }
    else if (q) { cls = 'pending'; text = q + ' to send'; }
    else if (S.status.error || !S.status.online) { cls = 'pending'; text = 'Offline, saved here'; }
    el.className = 'sync ' + cls;
    el.innerHTML = '<span class="dot"></span>' + esc(text);
  }

  // ---------- Now ----------

  function viewNow(now) {
    const handover = handoverCard(now);
    handoverShowing = !!handover;
    return handover + feedCard(now) + '<div class="rows">' + nappyRow(now) + sleepRow(now) + medsRow(now) + '</div>';
  }

  function handoverCard(now) {
    if (!handoverSince || now - handoverSince < HANDOVER_AFTER) return '';
    const sum = O.summarySince(S.allEvents(), handoverSince, { now });
    const evs = O.effectiveEvents(S.allEvents()).filter(e => e.t > handoverSince && e.t <= now);
    if (!evs.some(e => e.source !== S.mySource())) return '';

    const items = [];
    if (sum.feeds.length) {
      const last = sum.feeds[sum.feeds.length - 1];
      items.push('<b>' + sum.feeds.length + (sum.feeds.length === 1 ? ' feed' : ' feeds') + '</b>, last at ' + clock(last.t) + ': ' + esc(feedText(last)));
    }
    if (sum.nappies.total) {
      const bits = [];
      if (sum.nappies.wet) bits.push(sum.nappies.wet + ' wet');
      if (sum.nappies.dirty) bits.push(sum.nappies.dirty + ' dirty');
      items.push('<b>' + sum.nappies.total + (sum.nappies.total === 1 ? ' nappy' : ' nappies') + '</b>: ' + bits.join(', '));
    }
    sum.meds.forEach(m => items.push('<b>' + esc(m.name || 'Medicine') + '</b> at ' + clock(m.t) + ' (' + esc(whoName(m.source)) + ')'));
    if (sum.sleepMinutes) items.push('<b>Slept ' + duration(sum.sleepMinutes) + '</b>');
    sum.notes.forEach(n => items.push('Note: ' + esc(n.note)));
    if (!items.length) return '';

    return '<section class="card handover">' +
      '<p class="eyebrow">While you were away</p>' +
      '<p class="line">Since ' + esc(when(handoverSince, now)) + '</p>' +
      '<ul>' + items.map(i => '<li>' + i + '</li>').join('') + '</ul>' +
      '<div class="stack"><button class="btn secondary small" data-action="handover-done">Got it</button></div>' +
      '</section>';
  }

  function feedCard(now) {
    const r = st.feedRunning;
    if (r) {
      const segs = r.segments.length > 1
        ? '<p class="sub">' + r.segments.map((s, i) => {
            const to = i + 1 < r.segments.length ? r.segments[i + 1].from : now;
            return sideName(s.side) + ' ' + Math.floor((to - s.from) / MIN) + ' min';
          }).join(', then ') + '</p>'
        : '';
      const long = r.minutesSoFar >= 60
        ? '<p class="note">Still going? That\'s fine. Tap Finish when you\'re done.</p>' : '';
      return '<section class="card hero running">' +
        '<p class="eyebrow"><span class="pulse"></span>Feeding now · ' + esc(whoName(r.source) === 'you' ? 'started by you' : 'started by ' + whoName(r.source)) + '</p>' +
        '<h1 class="big">' + sideName(r.side) + ' side</h1>' +
        '<p class="timer">' + (r.minutesSoFar < 1 ? 'Just started' : duration(r.minutesSoFar)) + '</p>' +
        '<p class="sub">Started at ' + clock(r.start) + '</p>' + segs + long +
        '<div class="stack">' +
          '<button class="btn primary" data-action="feed-finish">Finish feed</button>' +
          '<button class="btn secondary" data-action="feed-switch">' + icon('swap') + 'Switch to ' + sideName(O.opposite(r.side)) + '</button>' +
          '<div class="pair">' +
            '<button class="btn quiet" data-action="feed-earlier">Started earlier?</button>' +
            '<button class="btn quiet" data-action="feed-cancel">Started by mistake</button>' +
          '</div>' +
        '</div></section>';
    }

    const f = st.lastFeed;
    const next = st.nextSide;
    let lines;
    if (f) {
      lines = '<p class="line">Last feed started <b>' + ago(f.t, now) + '</b></p>' +
        '<p class="sub">' + esc(cap(when(f.t, now))) + ' · ' + esc(feedText(f)) + (whoName(f.source) && whoName(f.source) !== 'you' ? ' · ' + esc(whoName(f.source)) : '') + '</p>';
    } else {
      lines = '<p class="line">No feeds logged yet.</p>';
    }
    let check = '';
    if (f && f.check) {
      check = '<div class="note"><b>This feed was left running.</b> How long was it really?' +
        '<div class="triple" style="margin-top:10px">' +
        [10, 15, 20, 30, 40, 60].map(m => '<button class="btn secondary small" data-action="fix-feed" data-mins="' + m + '">' + m + ' min</button>').join('') +
        '</div></div>';
    }
    return '<section class="card hero">' +
      '<p class="eyebrow">' + icon('feed') + 'Next feed</p>' +
      '<h1 class="big">' + sideName(next) + ' side</h1>' + lines + check +
      '<div class="stack">' +
        '<button class="btn primary" data-action="feed-start" data-side="' + next + '">Start feed on ' + sideName(next) + '</button>' +
        '<div class="pair">' +
          '<button class="btn secondary small" data-action="feed-start" data-side="' + O.opposite(next) + '">Start on ' + sideName(O.opposite(next)) + '</button>' +
          '<button class="btn secondary small" data-action="feed-add">Bottle or past feed</button>' +
        '</div>' +
      '</div></section>';
  }

  function nappyRow(now) {
    const n = st.lastNappy;
    const status = n ? ago(n.t, now) : 'None logged yet';
    const sub = n ? nappyWord(n.detail) + ' at ' + esc(when(n.t, now)) : '';
    const t = st.today;
    const todayLine = t.nappies ? 'Today: ' + t.wet + ' wet, ' + t.dirty + ' dirty' : '';
    return '<section class="row">' + icon('nappy') +
      '<div class="row-body"><p class="row-title">Nappy</p><p class="row-status">' + status + '</p>' +
      (sub ? '<p class="row-sub">' + sub + '</p>' : '') +
      (todayLine ? '<p class="row-sub">' + todayLine + '</p>' : '') + '</div>' +
      '<button class="btn secondary" data-action="nappy-open">Log a nappy</button></section>';
  }

  function sleepRow(now) {
    const s = st.sleep;
    let status, sub, btn;
    if (s.asleep) {
      status = 'Asleep for ' + duration((now - s.since) / MIN);
      sub = 'Fell asleep at ' + esc(when(s.since, now));
      btn = '<button class="btn secondary" data-action="sleep" data-type="awake">' + icon('sun') + 'Woke up</button>';
    } else {
      status = s.since ? 'Awake for ' + duration((now - s.since) / MIN) : 'No sleep logged yet';
      sub = s.since ? 'Woke at ' + esc(when(s.since, now)) : '';
      btn = '<button class="btn secondary" data-action="sleep" data-type="asleep">' + icon('moon') + 'Fell asleep</button>';
    }
    return '<section class="row' + (s.asleep ? ' asleep' : '') + '">' + icon('moon') +
      '<div class="row-body"><p class="row-title">Sleep</p><p class="row-status">' + status + '</p>' +
      (sub ? '<p class="row-sub">' + sub + '</p>' : '') +
      (st.today.sleepMinutes ? '<p class="row-sub">Today: ' + duration(st.today.sleepMinutes) + '</p>' : '') + '</div>' +
      btn + '</section>';
  }

  function medPill(m, now) {
    if (m.daily) return m.status === 'done'
      ? '<span class="pill ok">Done today</span>'
      : '<span class="pill">Not yet today</span>';
    return m.status === 'wait'
      ? '<span class="pill wait">Not before ' + clock(m.okFrom) + (O.londonDayKey(m.okFrom) !== O.londonDayKey(now) ? ' tomorrow' : '') + '</span>'
      : '<span class="pill ok">OK to give</span>';
  }

  function medsRow(now) {
    const meds = st.meds;
    let body;
    if (meds.length) {
      body = meds.map(m => '<div class="medline"><span class="row-status" style="font-size:20px">' + esc(m.name) + '</span>' + medPill(m, now) + '</div>' +
        (m.last ? '<p class="row-sub">Last ' + esc(when(m.last.t, now)) + ' (' + esc(whoName(m.last.source)) + ')</p>' : '')).join('');
    } else if (st.lastMeds) {
      body = '<p class="row-status">' + esc(st.lastMeds.name || 'Medicine') + '</p><p class="row-sub">' + ago(st.lastMeds.t, now) + '</p>';
    } else {
      body = '<p class="row-status">None logged yet</p>';
    }
    return '<section class="row">' + icon('meds') +
      '<div class="row-body"><p class="row-title">Medicine</p>' + body + '</div>' +
      '<button class="btn secondary" data-action="meds-open">Give medicine</button></section>';
  }

  // ---------- Today ----------

  function eventLine(e) {
    switch (e.type) {
      case 'feed': return { icon: (e.kind === 'bottle' ? 'bottle' : 'feed'), text: 'Feed: ' + feedText(e) + (e.check ? ' (please check)' : '') };
      case 'feed_start': return { icon: 'feed', text: 'Feed started on ' + sideName(e.side) + ' (still going)' };
      case 'side_set': return { icon: 'swap', text: 'Next side set to ' + sideName(e.side) };
      case 'nappy': return { icon: 'nappy', text: nappyWord(e.detail) + ' nappy' };
      case 'asleep': return { icon: 'moon', text: 'Fell asleep' };
      case 'awake': return { icon: 'sun', text: 'Woke up' };
      case 'meds': return { icon: 'meds', text: (e.name || 'Medicine') + ' given' };
      case 'note': return { icon: 'note', text: e.note || 'Note' };
      default: return null;
    }
  }

  function viewToday(now) {
    const dayStart = O.londonDayStart(O.londonDayStart(now) - dayOffset * DAY + 12 * HOUR);
    const dayEnd = O.londonDayStart(dayStart + 36 * HOUR);
    const at = Math.min(now, dayEnd - 1);
    const t = O.deriveState(S.allEvents(), { now: at, meds: S.settings.meds }).today;
    const running = st.feedRunning ? st.feedRunning.id : null;
    const evs = O.effectiveEvents(S.allEvents())
      .filter(e => e.t >= dayStart && e.t < dayEnd)
      .filter(e => e.type !== 'feed_switch' && (e.type !== 'feed_start' || e.id === running))
      .reverse();

    const title = dayOffset === 0 ? 'Today' : dayOffset === 1 ? 'Yesterday' : longDateFmt.format(new Date(dayStart + HOUR));
    const totals = [
      [t.feeds, t.feeds === 1 ? 'feed' : 'feeds', t.feedMinutes ? duration(t.feedMinutes) + (t.bottleMl ? ', ' + t.bottleMl + ' ml' : '') : ''],
      [duration(t.sleepMinutes), 'sleep', ''],
      [t.wet, 'wet nappies', ''],
      [t.dirty, 'dirty nappies', ''],
    ];

    const list = evs.length
      ? '<ul class="timeline">' + evs.map(e => {
          const l = eventLine(e);
          if (!l) return '';
          const who = whoName(e.source);
          return '<li><button data-action="event-open" data-id="' + esc(e.id) + '">' +
            '<span class="when">' + clock(e.t) + '</span>' + icon(l.icon) +
            '<span class="what">' + esc(l.text) + '<span class="who">' + esc(who ? 'by ' + who : '') + (e.edited ? ' · changed' : '') + '</span></span>' +
            '</button></li>';
        }).join('') + '</ul>'
      : '<p class="empty">Nothing logged ' + (dayOffset === 0 ? 'yet today' : 'on this day') + '.</p>';

    return '<div class="daybar">' +
        '<button data-action="day" data-step="1" aria-label="Day before">‹</button>' +
        '<h1>' + esc(title) + '</h1>' +
        '<button data-action="day" data-step="-1" aria-label="Day after"' + (dayOffset === 0 ? ' disabled' : '') + '>›</button>' +
      '</div>' +
      '<div class="totals">' + totals.map(x => '<div class="total"><div class="n">' + esc(x[0]) + '</div><div class="l">' + esc(x[1]) + (x[2] ? ' · ' + esc(x[2]) : '') + '</div></div>').join('') + '</div>' +
      '<button class="btn secondary small" data-action="note-open">' + icon('note') + 'Add a note</button>' +
      '<section class="card" style="padding:6px 14px">' + list + '</section>';
  }

  // ---------- Your week ----------
  // The baby compared only with their own days. No norms, no scores, no streaks.
  // A day with nothing logged says so, rather than showing zero.

  const pct = (x, total) => Math.max(0, Math.min(100, x / total * 100)).toFixed(2) + '%';

  function countRows(days, now, parts, valueText) {
    const max = Math.max(1, ...days.map(d => parts.reduce((s, p) => s + d[p.key], 0)));
    return days.map(d => {
      const head = '<div class="chead"><span class="clabel">' + esc(dayLabel(d.start, now)) + '</span>' +
        '<span class="cval">' + (d.logged ? esc(valueText(d)) : 'Nothing logged') + '</span></div>';
      const bar = d.logged
        ? '<div class="cbar">' + parts.map(p => d[p.key] ? '<span class="seg ' + p.cls + '" style="width:' + pct(d[p.key], max) + '"></span>' : '').join('') + '</div>'
        : '<div class="cbar empty"></div>';
      return '<div class="crow">' + head + bar + '</div>';
    }).join('');
  }

  function legend(items) {
    return '<p class="legend">' + items.map(i => '<span><span class="key ' + i[0] + '"></span>' + esc(i[1]) + '</span>').join('') + '</p>';
  }

  // One row per day, midnight to midnight: sleep shaded, feeds marked
  function dayBars(days, now, dated) {
    const axis = '<div class="axis" aria-hidden="true">' + ['00:00', '06:00', '12:00', '18:00'].map((t, i) =>
      '<span style="left:' + (i * 25) + '%">' + t + '</span>').join('') + '</div>';
    const rows = days.map(d => {
      const len = d.end - d.start;
      const blocks =
        d.sleepBlocks.map(b => '<span class="blk sleep" style="left:' + pct(b.from - d.start, len) + ';width:' + pct(b.to - b.from, len) + '"></span>').join('') +
        d.feedBlocks.map(b => '<span class="blk feed' + (b.kind === 'bottle' ? ' bottle' : '') + '" style="left:' + pct(b.from - d.start, len) + ';width:' + pct(b.to - b.from, len) + '"></span>').join('');
      const future = now < d.end ? '<span class="blk future" style="left:' + pct(now - d.start, len) + ';right:0"></span>' : '';
      const sleepText = d.sleepMinutes ? duration(d.sleepMinutes) + ' asleep' : (d.logged ? 'No sleep logged' : 'Nothing logged');
      return '<div class="drow"><div class="chead"><span class="clabel">' + esc(dated ? dayNumFmt.format(new Date(d.start + HOUR)) : dayLabel(d.start, now)) + '</span><span class="cval">' + esc(sleepText) + '</span></div>' +
        '<div class="track">' + blocks + future + '</div></div>';
    }).join('');
    return axis + rows;
  }

  // `dated`: always name the day ("Wednesday 14"), for the printed summary
  function longestSleepText(best, now, dated) {
    if (!best) return null;
    const day = O.londonDayStart(best.from);
    const from = (dated ? dayNumFmt.format(new Date(day + HOUR)) : dayLabel(day, now)) + ', ' + clock(best.from);
    return {
      big: duration(best.minutes),
      sub: best.open ? from + ', still asleep' : from + ' to ' + clock(best.to),
    };
  }

  function viewWeek(now) {
    const end = O.londonDayStart(now) - weekOffset * 7 * DAY + 12 * HOUR;
    const days = O.daySummaries(S.allEvents(), { now: now, end: end, days: 7 });
    const newestFirst = days.slice().reverse();
    const first = days[0], last = days[days.length - 1];
    const title = weekOffset === 0 ? 'Your week' : weekOffset === 1 ? 'The week before' : weekOffset + ' weeks before';
    const best = longestSleepText(O.longestSleep(S.allEvents(), first.start, last.end, now), now);

    const feedsText = d => d.feeds + (d.feeds === 1 ? ' feed' : ' feeds') +
      (d.bottleFeeds ? ' (' + d.bottleFeeds + (d.bottleFeeds === 1 ? ' bottle' : ' bottles') + (d.bottleMl ? ', ' + d.bottleMl + ' ml' : '') + ')' : '');

    return '<div class="daybar">' +
        '<button data-action="week" data-step="1" aria-label="The week before">‹</button>' +
        '<h1>' + esc(title) + '</h1>' +
        '<button data-action="week" data-step="-1" aria-label="The week after"' + (weekOffset === 0 ? ' disabled' : '') + '>›</button>' +
      '</div>' +
      '<p class="sub" style="text-align:center;margin-top:-6px">' + esc(rangeText(first.start, last.start)) + '</p>' +

      '<section class="card"><p class="eyebrow">' + icon('moon') + 'Longest sleep</p>' +
        (best ? '<p class="big" style="font-size:34px">' + esc(best.big) + '</p><p class="sub">' + esc(best.sub) + '</p>'
              : '<p class="line">No sleep logged in these days.</p>') +
      '</section>' +

      '<section class="card chart"><h2>Nappies each day</h2>' + legend([['wet', 'Wet'], ['dirty', 'Dirty']]) +
        countRows(newestFirst, now, [{ key: 'wet', cls: 'wet' }, { key: 'dirty', cls: 'dirty' }],
          d => d.wet + ' wet, ' + d.dirty + ' dirty') +
      '</section>' +

      '<section class="card chart"><h2>Sleep and feeds through the day</h2>' + legend([['sleep', 'Asleep'], ['feed', 'Breastfeed'], ['bottle', 'Bottle']]) +
        dayBars(newestFirst, now) +
      '</section>' +

      '<section class="card chart"><h2>Feeds each day</h2>' + legend([['feed', 'Breastfeed'], ['bottle', 'Bottle']]) +
        countRows(newestFirst, now, [{ key: 'breastFeeds', cls: 'feed' }, { key: 'bottleFeeds', cls: 'bottle' }], feedsText) +
      '</section>' +

      '<section class="card"><h2>For the health visitor</h2>' +
        '<p>A short summary of feeds, nappies, sleep, medicine and notes. Print it, or save it as a PDF to show on your phone.</p>' +
        '<div class="field"><span class="label">How many days?</span><div class="choice">' +
          [7, 14].map(n => '<button data-action="print-days" data-days="' + n + '" aria-pressed="' + (printDays === n) + '">Last ' + n + ' days</button>').join('') +
        '</div></div>' +
        '<div class="stack"><button class="btn primary" data-action="print">' + icon('print') + 'Print or save as PDF</button></div>' +
      '</section>';
  }

  // ---------- Health visitor summary (printed) ----------

  function printSummary(n) {
    const now = Date.now();
    const events = S.allEvents();
    const days = O.daySummaries(events, { now: now, days: n });
    while (days.length > 1 && !days[0].logged) days.shift();   // don't start with empty days from before the app was used
    n = days.length;
    const first = days[0], last = days[days.length - 1];
    const s = S.settings;
    const name = s.babyName || 'Baby';
    const born = s.birthDate ? Date.parse(s.birthDate + 'T12:00:00Z') : NaN;
    const best = longestSleepText(O.longestSleep(events, first.start, last.end, now), now, true);
    const fullDay = d => fullDateFmt.format(new Date(d.start + HOUR)).replace(/ \d{4}$/, '');

    const rows = days.map(d => d.logged
      ? '<tr><th scope="row">' + esc(fullDay(d)) + '</th>' +
          '<td>' + d.feeds + (d.bottleFeeds ? ' (' + d.bottleFeeds + ' bottle' + (d.bottleFeeds === 1 ? '' : 's') + (d.bottleMl ? ', ' + d.bottleMl + ' ml' : '') + ')' : '') + '</td>' +
          '<td>' + d.wet + '</td><td>' + d.dirty + '</td>' +
          '<td>' + (d.sleepMinutes ? esc(duration(d.sleepMinutes)) : '–') + '</td>' +
          '<td>' + (d.longestSleep ? esc(duration(d.longestSleep)) : '–') + '</td></tr>'
      : '<tr><th scope="row">' + esc(fullDay(d)) + '</th><td colspan="5">Nothing logged</td></tr>').join('');

    const meds = days.filter(d => d.meds.length).map(d => {
      const byName = {};
      d.meds.forEach(m => { (byName[m.name] = byName[m.name] || []).push(clock(m.t)); });
      return '<li><b>' + esc(fullDay(d)) + ':</b> ' + Object.keys(byName).map(k => esc(k) + ' at ' + byName[k].join(', ')).join('; ') + '</li>';
    }).join('');
    const notes = days.reduce((a, d) => a.concat(d.notes.map(x => Object.assign({ day: d }, x))), [])
      .map(x => '<li><b>' + esc(fullDay(x.day)) + ', ' + clock(x.t) + ':</b> ' + esc(x.note) + (x.source ? ' <span class="p-who">(' + esc(whoName(x.source) === 'you' ? S.settings.who : whoName(x.source)) + ')</span>' : '') + '</li>').join('');

    return '<header class="p-head">' +
        '<h1>' + esc(name) + ': feeds, nappies and sleep</h1>' +
        '<p>' + (isFinite(born) ? 'Born ' + esc(fullDateFmt.format(new Date(born))) + ' · ' + esc(babyAge(now).replace(/^Day/, 'day')) + ' · ' : '') +
          esc(n) + ' days: ' + esc(rangeText(first.start, last.start)) + '</p>' +
      '</header>' +
      '<table class="p-table"><thead><tr><th scope="col">Day</th><th scope="col">Feeds</th><th scope="col">Wet nappies</th><th scope="col">Dirty nappies</th><th scope="col">Sleep</th><th scope="col">Longest sleep</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
      (best ? '<p><b>Longest sleep in these days:</b> ' + esc(best.big) + ' (' + esc(best.sub) + ').</p>' : '') +
      '<h2>Sleep and feeds through the day</h2>' + legend([['sleep', 'Asleep'], ['feed', 'Breastfeed'], ['bottle', 'Bottle']]) +
      '<div class="p-bars">' + dayBars(days, now, true) + '</div>' +
      '<h2>Medicine given</h2>' + (meds ? '<ul>' + meds + '</ul>' : '<p>None logged.</p>') +
      '<h2>Notes</h2>' + (notes ? '<ul>' + notes + '</ul>' : '<p>None.</p>') +
      '<footer class="p-foot">Logged at home by ' + esc(name === 'Baby' ? 'the' : name + '\'s') + ' parents with The Tiny Overlord. UK times. Made ' + esc(fullDateFmt.format(new Date(now))) + ' at ' + clock(now) + '.</footer>';
  }

  function printNow() {
    const el = $('#print');
    el.innerHTML = printSummary(printDays);
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }

  // ---------- Settings ----------

  function viewSettings() {
    const s = S.settings;
    const who = ['Sam', 'Beth'];
    const isOther = s.who && who.indexOf(s.who) < 0;
    const meds = (s.meds || []).map((m, i) =>
      '<div class="med-edit" data-med="' + i + '">' +
        '<div class="field"><label for="med-name-' + i + '">Name</label><input type="text" id="med-name-' + i + '" data-med-field="name" value="' + esc(m.name) + '"></div>' +
        '<div class="field"><span class="label">How often</span><div class="choice">' +
          '<button data-action="med-kind" data-i="' + i + '" data-kind="daily" aria-pressed="' + !!m.daily + '">Once a day</button>' +
          '<button data-action="med-kind" data-i="' + i + '" data-kind="gap" aria-pressed="' + !m.daily + '">Every few hours</button>' +
        '</div></div>' +
        (m.daily ? '' :
        '<div class="inline">' +
          '<div class="field"><label for="med-gap-' + i + '">Hours between doses</label><input type="number" min="0" step="0.5" inputmode="decimal" id="med-gap-' + i + '" data-med-field="gapHours" value="' + esc(m.gapHours || '') + '"></div>' +
          '<div class="field"><label for="med-max-' + i + '">Most doses in 24 hours</label><input type="number" min="0" step="1" inputmode="numeric" id="med-max-' + i + '" data-med-field="maxPer24" value="' + esc(m.maxPer24 || '') + '"></div>' +
        '</div>') +
        '<button class="btn quiet" data-action="med-remove" data-i="' + i + '">Remove ' + esc(m.name || 'this medicine') + '</button>' +
      '</div>').join('');

    const connected = S.connected();
    return '<section class="card"><h2>This phone</h2>' +
        '<div class="field"><span class="label">Who uses this phone?</span><div class="choice">' +
          who.map(w => '<button data-action="set-who" data-who="' + w + '" aria-pressed="' + (s.who === w) + '">' + w + '</button>').join('') +
          '<button data-action="set-who-other" aria-pressed="' + !!isOther + '">Someone else</button>' +
        '</div></div>' +
        (isOther ? '<div class="field"><label for="who-other">Name</label><input type="text" id="who-other" data-setting="who" value="' + esc(s.who) + '"></div>' : '') +
        '<div class="field"><span class="label">Look</span><div class="choice">' +
          [['auto', 'Night from 19:00 to 07:00'], ['day', 'Always day'], ['night', 'Always night']].map(x =>
            '<button data-action="set-theme" data-theme="' + x[0] + '" aria-pressed="' + (s.theme === x[0]) + '">' + x[1] + '</button>').join('') +
        '</div></div>' +
      '</section>' +

      '<section class="card"><h2>Baby</h2>' +
        '<div class="field"><label for="baby-name">Name</label><input type="text" id="baby-name" data-setting="babyName" value="' + esc(s.babyName) + '" autocomplete="off"></div>' +
        '<div class="field"><label for="baby-born">Date of birth</label><input type="date" id="baby-born" data-setting="birthDate" value="' + esc(s.birthDate) + '"></div>' +
      '</section>' +

      '<section class="card"><h2>Medicines</h2>' +
        '<p class="hint">Use the numbers on the packet, or what your pharmacist or GP told you. The app only reminds you of them.</p>' +
        meds +
        '<div class="stack"><button class="btn secondary small" data-action="med-add">Add a medicine</button></div>' +
      '</section>' +

      '<section class="card"><h2>Sharing between phones</h2>' +
        (connected
          ? '<p>Connected. Everything is shared with the other phone and the Overlord.</p>' +
            '<div class="stack"><button class="btn secondary small" data-action="copy-setup">Copy setup link for the other phone</button>' +
            '<button class="btn quiet" data-action="disconnect">Stop sharing on this phone</button></div>'
          : '<p>Right now everything stays on this phone. To share, paste the setup link, or the backend address and key.</p>' +
            '<div class="field"><label for="setup-paste">Setup link</label><input type="url" id="setup-paste" placeholder="Paste the link here"></div>' +
            '<div class="field"><label for="api-url">Backend address</label><input type="url" id="api-url" value="' + esc(s.apiUrl) + '" placeholder="https://script.google.com/macros/s/…/exec"></div>' +
            '<div class="field"><label for="api-token">Key</label><input type="password" id="api-token" value="' + esc(s.token) + '"></div>' +
            '<div class="stack"><button class="btn primary" data-action="connect">Connect</button></div>') +
      '</section>' +

      '<section class="card"><h2>Try it out</h2>' +
        '<p>Fill this phone with an example week to see how it looks, then clear it before real use.</p>' +
        '<div class="stack">' +
          (connected ? '' : '<button class="btn secondary small" data-action="seed">Add an example week</button>') +
          '<button class="btn quiet" data-action="clear">Clear everything on this phone</button>' +
        '</div>' +
      '</section>';
  }

  function viewWelcome() {
    return '<section class="card">' +
      '<p class="eyebrow">Hello</p>' +
      '<h1 class="big" style="font-size:34px">The Tiny Overlord is watching.</h1>' +
      '<p class="line">Feeds, nappies, sleep and medicine, for both of you, at any hour.</p>' +
      '<div class="field"><span class="label">Who uses this phone?</span></div>' +
      '<div class="stack">' +
        '<button class="btn secondary" data-action="set-who" data-who="Sam">Sam</button>' +
        '<button class="btn secondary" data-action="set-who" data-who="Beth">Beth</button>' +
        '<div class="field"><label for="who-new">Someone else</label><input type="text" id="who-new" placeholder="Their name"></div>' +
        '<button class="btn quiet" data-action="set-who-new">Continue</button>' +
      '</div></section>';
  }

  // ---------- Drawing ----------

  function render(opts) {
    const now = Date.now();
    applyTheme();
    st = derive(now);
    drawHeader(now);
    autoCloseFeed(now);

    if (opts && opts.headerOnly) return;
    const main = $('#view');
    let html;
    if (!S.settings.who) { html = viewWelcome(); $('#tabs').hidden = true; }
    else {
      $('#tabs').hidden = false;
      html = view === 'today' ? viewToday(now) : view === 'week' ? viewWeek(now) : view === 'settings' ? viewSettings() : viewNow(now);
    }
    if (lastMain !== html) { main.innerHTML = html; lastMain = html; }
    document.querySelectorAll('#tabs button').forEach(b => {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-icon]').forEach(el => { if (!el.innerHTML) el.innerHTML = ICONS[el.dataset.icon]; });
    if (sheetDraw) drawSheet();
  }

  function go(v) {
    view = v;
    if (v === 'today') dayOffset = 0;
    if (v === 'week') weekOffset = 0;
    render();
    window.scrollTo(0, 0);
  }

  // A feed left running for 90 minutes is closed for you, and flagged to check
  function autoCloseFeed(now) {
    const r = st.feedRunning;
    if (!r || !r.overdue || autoClosed.has(r.id)) return;
    autoClosed.add(r.id);
    const end = r.start + O.FEED_AUTO_CLOSE_MIN * MIN;
    const done = O.finishFeed(r, end);
    // After this draw finishes, so we don't redraw in the middle of drawing
    setTimeout(() => S.log({ type: 'feed', ref: r.id, time: r.start, kind: 'breast', sides: done.sides, minutes: done.minutes, check: true, detail: 'auto-closed' }), 0);
  }

  // ---------- Logging with a friendly receipt ----------

  function logAndTell(partial, message) {
    buzz();
    const e = S.log(partial);
    toast(message + ' · ' + clock(Date.parse(e.time)), [
      { label: 'Undo', fn: () => { S.log({ type: 'undo', ref: e.id }); toast('Undone'); } },
      { label: 'Change time', fn: () => openEvent(e.id) },
    ]);
    return e;
  }

  function toast(message, actions) {
    const el = $('#toast');
    clearTimeout(toastTimer);
    el.innerHTML = '<span class="msg">' + esc(message) + '</span>' + (actions || []).map((a, i) => '<button data-toast="' + i + '">' + esc(a.label) + '</button>').join('');
    el.hidden = false;
    el.onclick = ev => {
      const b = ev.target.closest('[data-toast]');
      if (!b) return;
      el.hidden = true;
      actions[Number(b.dataset.toast)].fn();
    };
    toastTimer = setTimeout(() => { el.hidden = true; }, actions && actions.length ? UNDO_MS : 3000);
  }

  // ---------- Bottom sheets ----------

  function openSheet(draw, initialDraft) {
    draft = initialDraft || {};
    sheetDraw = draw;
    $('#sheet-backdrop').hidden = false;
    $('#sheet').hidden = false;
    drawSheet();
    const first = $('#sheet').querySelector('button, input');
    if (first) first.focus({ preventScroll: true });
  }
  function drawSheet() {
    const el = $('#sheet');
    const html = '<div class="grab"></div>' + sheetDraw(Date.now());
    if (lastSheet !== html) { el.innerHTML = html; lastSheet = html; }
  }
  function closeSheet() {
    sheetDraw = null; draft = {}; lastSheet = '';
    $('#sheet').hidden = true;
    $('#sheet-backdrop').hidden = true;
  }

  // "When?" chips shared by several sheets. draft.ago is minutes ago (0 = now)
  function whenChips(options) {
    return '<div class="section"><span class="label">When?</span><div class="choice" style="margin-top:8px">' +
      options.map(m => '<button data-action="draft" data-key="ago" data-value="' + m + '" aria-pressed="' + ((draft.ago || 0) === m) + '">' +
        (m === 0 ? 'Now' : duration(m) + ' ago') + '</button>').join('') +
      '</div></div>';
  }
  const draftTime = () => Date.now() - (draft.ago || 0) * MIN;

  function nappySheet() {
    return '<h2>Log a nappy</h2>' + whenChips([0, 10, 30, 60]) +
      '<div class="section stack">' +
        ['wet', 'dirty', 'both'].map(d => '<button class="btn primary" data-action="nappy" data-detail="' + d + '">' + nappyWord(d) + '</button>').join('') +
      '</div>' +
      '<button class="btn quiet" data-action="sheet-close">Cancel</button>';
  }

  function medsSheet(now) {
    const meds = st.meds;
    const rows = meds.map(m => {
      let line, btn;
      if (m.daily) {
        line = m.status === 'done' ? 'Given today at ' + clock(m.last.t) + ' (' + esc(whoName(m.last.source)) + ')' : 'Not given yet today';
        btn = m.status === 'done'
          ? '<button class="btn secondary small" data-action="med-give" data-name="' + esc(m.name) + '" data-force="1">Log another dose</button>'
          : '<button class="btn primary" data-action="med-give" data-name="' + esc(m.name) + '">Given now</button>';
      } else if (m.status === 'wait') {
        line = '<b>Not yet.</b> OK from ' + esc(when(m.okFrom, now)) + '.';
        const confirming = draft.confirm === m.name;
        btn = confirming
          ? '<button class="btn confirm" data-action="med-give" data-name="' + esc(m.name) + '" data-force="1">Tap again to log it anyway</button>'
          : '<button class="btn wait" data-action="draft" data-key="confirm" data-value="' + esc(m.name) + '">It\'s too soon. Log anyway?</button>';
      } else {
        line = 'OK to give now.';
        btn = '<button class="btn primary" data-action="med-give" data-name="' + esc(m.name) + '">Given now</button>';
      }
      const last = m.last && !m.daily
        ? '<p class="sub">Last given ' + esc(when(m.last.t, now)) + ' by ' + esc(whoName(m.last.source)) + ' · ' + m.inLast24 + ' in the last 24 hours</p>' : '';
      return '<div class="section"><p class="row-status">' + esc(m.name) + '</p><p class="line">' + line + '</p>' + last + '<div class="stack">' + btn + '</div></div>';
    }).join('');
    return '<h2>Medicine</h2>' + rows +
      '<div class="section"><div class="field"><label for="med-other">Something else</label><input type="text" id="med-other" placeholder="Name of the medicine"></div>' +
      '<div class="stack"><button class="btn secondary small" data-action="med-give-other">Log it</button></div></div>' +
      '<p class="sub" style="margin-top:14px">Always check the dose on the packet. Ask a pharmacist or call 111 if you\'re unsure.</p>' +
      '<button class="btn quiet" data-action="sheet-close">Close</button>';
  }

  function feedAddSheet() {
    const kind = draft.kind || 'breast';
    let body = '';
    if (kind === 'breast') {
      body += '<div class="section"><span class="label">Which side?</span><div class="choice" style="margin-top:8px">' +
        [['left', 'Left'], ['right', 'Right'], ['left-right', 'Left, then Right'], ['right-left', 'Right, then Left']].map(x =>
          '<button data-action="draft" data-key="sides" data-value="' + x[0] + '" aria-pressed="' + ((draft.sides || 'left') === x[0]) + '">' + x[1] + '</button>').join('') +
        '</div></div>';
      body += '<div class="section"><span class="label">How long in total?</span><div class="choice" style="margin-top:8px">' +
        [5, 10, 15, 20, 30, 45].map(m => '<button data-action="draft" data-key="mins" data-value="' + m + '" aria-pressed="' + ((draft.mins || 15) === m) + '">' + m + ' min</button>').join('') +
        '</div></div>';
    } else {
      body += '<div class="section"><span class="label">How much?</span><div class="choice" style="margin-top:8px">' +
        [30, 60, 90, 120, 150, 180].map(m => '<button data-action="draft" data-key="ml" data-value="' + m + '" aria-pressed="' + ((draft.ml || 90) === m) + '">' + m + ' ml</button>').join('') +
        '</div></div>';
    }
    body += '<div class="section"><span class="label">When did it start?</span><div class="choice" style="margin-top:8px">' +
      [0, 15, 30, 60, 120].map(m => '<button data-action="draft" data-key="ago" data-value="' + m + '" aria-pressed="' + ((draft.ago || 0) === m) + '">' + (m === 0 ? 'Just now' : duration(m) + ' ago') + '</button>').join('') +
      '</div></div>';
    return '<h2>Add a feed</h2>' +
      '<div class="section choice">' +
        '<button data-action="draft" data-key="kind" data-value="breast" aria-pressed="' + (kind === 'breast') + '">' + icon('feed') + ' Breast</button>' +
        '<button data-action="draft" data-key="kind" data-value="bottle" aria-pressed="' + (kind === 'bottle') + '">' + icon('bottle') + ' Bottle</button>' +
      '</div>' + body +
      '<div class="section stack"><button class="btn primary" data-action="feed-add-save">Add this feed</button>' +
      '<button class="btn quiet" data-action="sheet-close">Cancel</button></div>';
  }

  function feedEarlierSheet() {
    return '<h2>When did the feed really start?</h2>' +
      '<div class="section stack">' +
      [5, 10, 15, 20, 30].map(m => '<button class="btn secondary small" data-action="feed-earlier-set" data-mins="' + m + '">' + m + ' min earlier</button>').join('') +
      '</div><button class="btn quiet" data-action="sheet-close">Cancel</button>';
  }

  function noteSheet() {
    return '<h2>Add a note</h2>' +
      '<div class="field"><label for="note-text">What happened?</label><input type="text" id="note-text" placeholder="For example: big spit-up after the feed"></div>' +
      '<div class="section stack"><button class="btn primary" data-action="note-save">Save note</button>' +
      '<button class="btn quiet" data-action="sheet-close">Cancel</button></div>';
  }

  function openEvent(id) {
    openSheet(eventSheet, { id: id });
  }

  function eventSheet(now) {
    const e = O.effectiveEvents(S.allEvents()).find(x => x.id === draft.id);
    if (!e) return '<h2>That entry was removed</h2><button class="btn secondary" data-action="sheet-close">Close</button>';
    const l = eventLine(e) || { text: e.type };
    const shift = [-30, -15, -5, 5, 15];
    let extra = '';
    if (e.type === 'nappy') {
      extra = '<div class="section"><span class="label">What kind?</span><div class="choice" style="margin-top:8px">' +
        ['wet', 'dirty', 'both'].map(d => '<button data-action="event-detail" data-detail="' + d + '" aria-pressed="' + (e.detail === d) + '">' + nappyWord(d) + '</button>').join('') +
        '</div></div>';
    }
    if (e.type === 'feed' && (e.kind || 'breast') === 'breast') {
      extra = '<div class="section"><span class="label">How long in total?</span><div class="choice" style="margin-top:8px">' +
        [5, 10, 15, 20, 30, 45].map(m => '<button data-action="event-mins" data-mins="' + m + '" aria-pressed="' + (O.feedMinutes(e) === m) + '">' + m + ' min</button>').join('') +
        '</div></div>';
    }
    return '<h2>' + esc(l.text) + '</h2>' +
      '<p class="line">' + esc(when(e.t, now)) + (e.source ? ' · by ' + esc(whoName(e.source)) : '') + '</p>' +
      '<div class="section"><span class="label">Move the time</span><div class="choice" style="margin-top:8px">' +
        shift.map(m => '<button data-action="event-shift" data-mins="' + m + '">' + (m < 0 ? m + ' min' : '+' + m + ' min') + '</button>').join('') +
      '</div></div>' +
      '<div class="section field"><label for="event-time">Or set the time</label>' +
        '<input type="time" id="event-time" value="' + clock(e.t) + '"></div>' +
      '<div class="stack"><button class="btn secondary small" data-action="event-time-save">Save this time</button></div>' +
      extra +
      '<div class="section stack">' +
        (draft.removing
          ? '<button class="btn confirm" data-action="event-remove">Tap again to remove it</button>'
          : '<button class="btn wait" data-action="draft" data-key="removing" data-value="1">Remove this entry</button>') +
        '<button class="btn quiet" data-action="sheet-close">Done</button>' +
      '</div>';
  }

  function editEvent(id, patch, message) {
    S.log({ type: 'edit', ref: id, patch: patch });
    buzz();
    toast(message || 'Changed');
  }

  // ---------- Example week (demo mode) ----------

  function seedExample() {
    const now = Date.now();
    const list = [];
    const src = ['app-sam', 'app-beth', 'device'];
    let seed = 7;
    const r = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

    // Seven days of feeds every 2–4 hours, nappies after most feeds, sleep in between.
    // Night gaps slowly get longer through the week, like a real baby's might.
    let t = O.londonDayStart(now) - 6 * DAY + 30 * MIN;
    let side = 'left';
    let i = 0;
    while (t < now - 45 * MIN) {
      const daysAgo = Math.floor((now - t) / DAY);
      const bottle = r() < 0.1;
      const mins = 12 + Math.round(r() * 14);
      if (bottle) {
        list.push({ type: 'feed', time: t, kind: 'bottle', ml: 60 + 30 * Math.floor(r() * 3), minutes: 15, source: src[i % 3] });
      } else {
        const first = Math.round(mins * 0.6);
        const sides = r() < 0.5 ? [{ side: side, minutes: first }, { side: O.opposite(side), minutes: mins - first }] : [{ side: side, minutes: mins }];
        list.push({ type: 'feed', time: t, kind: 'breast', sides: sides, minutes: mins, source: src[i % 3] });
        side = O.opposite(side);
      }
      const fed = t + (mins + 5) * MIN;
      if (r() < 0.85) list.push({ type: 'nappy', time: fed, detail: r() < 0.6 ? 'wet' : r() < 0.5 ? 'dirty' : 'both', source: src[(i + 1) % 3] });
      const hour = O.londonHour(t);
      const night = hour >= 21 || hour < 6;
      const gap = (night ? 165 + (6 - daysAgo) * 12 : 130) + Math.round(r() * 50);
      const sleepFrom = fed + 10 * MIN;
      const sleepTo = t + (gap - 12) * MIN;
      if (sleepTo - sleepFrom > 25 * MIN && sleepTo < now) {
        list.push({ type: 'asleep', time: sleepFrom, source: src[(i + 2) % 3] });
        list.push({ type: 'awake', time: sleepTo, source: src[i % 3] });
      }
      t += gap * MIN;
      i++;
    }
    for (let d = 0; d < 7; d++) {
      const at = O.londonDayStart(now - d * DAY) + 8 * HOUR + 15 * MIN;
      if (at < now) list.push({ type: 'meds', time: at, name: 'Vitamin D', source: 'app-sam' });
    }
    const jabs = O.londonDayStart(now - 2 * DAY);
    list.push({ type: 'note', time: jabs + 10 * HOUR, note: 'Eight-week jabs today. A bit unsettled after.', source: 'app-beth' });
    list.push({ type: 'meds', time: jabs + 13 * HOUR, name: 'Calpol', source: 'app-beth' });
    list.push({ type: 'meds', time: jabs + 18 * HOUR, name: 'Calpol', source: 'app-sam' });
    list.push({ type: 'note', time: now - 5 * HOUR, note: 'Big spit-up after the feed, seemed fine after', source: 'app-beth' });
    S.log(list);
    S.setSettings({ lastSeen: now - 6 * HOUR });
    handoverSince = now - 6 * HOUR;
  }

  // ---------- Handling taps ----------

  const actions = {
    'go': b => go(b.dataset.view),
    'sheet-close': () => closeSheet(),
    'handover-done': () => { handoverSince = 0; handoverShowing = false; S.setSettings({ lastSeen: Date.now() }); },

    'feed-start': b => logAndTell({ type: 'feed_start', side: b.dataset.side }, 'Feed started on ' + sideName(b.dataset.side)),
    'feed-switch': () => {
      const side = O.opposite(st.feedRunning.side);
      logAndTell({ type: 'feed_switch', side: side }, 'Switched to ' + sideName(side));
    },
    'feed-finish': () => {
      const r = st.feedRunning;
      if (!r) return;
      const done = O.finishFeed(r, Date.now());
      const e = S.log({ type: 'feed', ref: r.id, time: r.start, kind: 'breast', sides: done.sides, minutes: done.minutes });
      buzz();
      toast('Feed logged: ' + duration(done.minutes) + '. Next: ' + sideName(O.opposite(done.sides[0].side)), [
        { label: 'Undo', fn: () => { S.log({ type: 'undo', ref: e.id }); toast('Feed is running again'); } },
      ]);
    },
    'feed-cancel': () => {
      const r = st.feedRunning;
      if (!r) return;
      S.log({ type: 'undo', ref: r.id });
      buzz();
      toast('Feed removed', [{ label: 'Bring it back', fn: () => { /* undo the undo */
        const last = S.allEvents().filter(e => e.type === 'undo' && e.ref === r.id).pop();
        if (last) S.log({ type: 'undo', ref: last.id });
      } }]);
    },
    'feed-earlier': () => openSheet(feedEarlierSheet),
    'feed-earlier-set': b => {
      const r = st.feedRunning;
      if (!r) return closeSheet();
      editEvent(r.id, { time: new Date(r.start - Number(b.dataset.mins) * MIN).toISOString() }, 'Start time moved');
      closeSheet();
    },
    'feed-add': () => openSheet(feedAddSheet, { kind: 'breast', sides: st.nextSide, mins: 15, ml: 90, ago: 0 }),
    'feed-add-save': () => {
      const start = Date.now() - (draft.ago || 0) * MIN - (draft.kind === 'breast' && !draft.ago ? (draft.mins || 15) * MIN : 0);
      let e;
      if (draft.kind === 'bottle') {
        e = { type: 'feed', time: start, kind: 'bottle', ml: draft.ml || 90 };
      } else {
        const mins = draft.mins || 15;
        const order = String(draft.sides || 'left').split('-');
        const each = Math.round(mins / order.length);
        e = { type: 'feed', time: start, kind: 'breast', minutes: mins, sides: order.map((s, i) => ({ side: s, minutes: i === order.length - 1 ? mins - each * (order.length - 1) : each })) };
      }
      closeSheet();
      logAndTell(e, e.kind === 'bottle' ? 'Bottle feed added' : 'Feed added');
    },
    'fix-feed': b => {
      const f = st.lastFeed;
      if (!f) return;
      const m = Number(b.dataset.mins);
      const side = (f.sides && f.sides[0] && f.sides[0].side) || 'left';
      editEvent(f.id, { minutes: m, sides: [{ side: side, minutes: m }], check: false }, 'Thanks, feed set to ' + m + ' min');
    },

    'nappy-open': () => openSheet(nappySheet, { ago: 0 }),
    'nappy': b => {
      const time = draftTime();
      closeSheet();
      logAndTell({ type: 'nappy', detail: b.dataset.detail, time: time }, nappyWord(b.dataset.detail) + ' nappy logged');
    },

    'sleep': b => logAndTell({ type: b.dataset.type }, b.dataset.type === 'asleep' ? 'Asleep' : 'Awake'),

    'meds-open': () => openSheet(medsSheet, {}),
    'med-give': b => {
      const name = b.dataset.name;
      closeSheet();
      logAndTell({ type: 'meds', name: name }, name + ' logged');
    },
    'med-give-other': () => {
      const name = ($('#med-other').value || '').trim();
      if (!name) { $('#med-other').focus(); return; }
      closeSheet();
      logAndTell({ type: 'meds', name: name }, name + ' logged');
    },

    'note-open': () => openSheet(noteSheet),
    'note-save': () => {
      const text = ($('#note-text').value || '').trim();
      if (!text) { $('#note-text').focus(); return; }
      closeSheet();
      logAndTell({ type: 'note', note: text }, 'Note saved');
    },

    'event-open': b => openEvent(b.dataset.id),
    'event-shift': b => {
      const e = O.effectiveEvents(S.allEvents()).find(x => x.id === draft.id);
      if (!e) return;
      const t = Math.min(Date.now(), e.t + Number(b.dataset.mins) * MIN);
      editEvent(e.id, { time: new Date(t).toISOString() }, 'Moved to ' + clock(t));
    },
    'event-time-save': () => {
      const e = O.effectiveEvents(S.allEvents()).find(x => x.id === draft.id);
      const v = $('#event-time').value;
      if (!e || !v) return;
      let t = londonTimeOn(e.t, v);
      if (t > Date.now()) t -= DAY;   // e.g. 23:50 typed just after midnight
      editEvent(e.id, { time: new Date(t).toISOString() }, 'Moved to ' + clock(t));
    },
    'event-detail': b => editEvent(draft.id, { detail: b.dataset.detail }, 'Changed to ' + nappyWord(b.dataset.detail).toLowerCase()),
    'event-mins': b => {
      const e = O.effectiveEvents(S.allEvents()).find(x => x.id === draft.id);
      if (!e) return;
      const m = Number(b.dataset.mins);
      const sides = e.sides || [];
      const total = O.feedMinutes(e) || 1;
      const scaled = sides.map(s => ({ side: s.side, minutes: Math.round(s.minutes * m / total) }));
      if (scaled.length) scaled[scaled.length - 1].minutes = m - scaled.slice(0, -1).reduce((a, s) => a + s.minutes, 0);
      editEvent(e.id, { minutes: m, sides: scaled, check: false }, 'Feed set to ' + m + ' min');
    },
    'event-remove': () => {
      const id = draft.id;
      S.log({ type: 'undo', ref: id });
      closeSheet();
      buzz();
      toast('Removed', [{ label: 'Bring it back', fn: () => {
        const last = S.allEvents().filter(e => e.type === 'undo' && e.ref === id).pop();
        if (last) S.log({ type: 'undo', ref: last.id });
      } }]);
    },

    'draft': b => {
      const v = b.dataset.value;
      draft[b.dataset.key] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
      drawSheet();
    },

    'day': b => { dayOffset = Math.max(0, dayOffset + Number(b.dataset.step)); render(); },
    'week': b => { weekOffset = Math.max(0, weekOffset + Number(b.dataset.step)); render(); },
    'print-days': b => { printDays = Number(b.dataset.days); render(); },
    'print': () => printNow(),

    'set-who': b => S.setSettings({ who: b.dataset.who }),
    'set-who-new': () => {
      const v = ($('#who-new').value || '').trim();
      if (v) S.setSettings({ who: v }); else $('#who-new').focus();
    },
    'set-who-other': () => S.setSettings({ who: 'Someone' }),
    'set-theme': b => S.setSettings({ theme: b.dataset.theme }),
    'med-kind': b => {
      const meds = (S.settings.meds || []).slice();
      const m = Object.assign({}, meds[b.dataset.i]);
      if (b.dataset.kind === 'daily') { m.daily = true; delete m.gapHours; delete m.maxPer24; }
      else { m.daily = false; m.gapHours = m.gapHours || 4; m.maxPer24 = m.maxPer24 || 4; }
      meds[b.dataset.i] = m;
      S.setSettings({ meds: meds });
    },
    'med-add': () => S.setSettings({ meds: (S.settings.meds || []).concat([{ name: 'New medicine', gapHours: 4, maxPer24: 4 }]) }),
    'med-remove': b => {
      const meds = (S.settings.meds || []).slice();
      meds.splice(Number(b.dataset.i), 1);
      S.setSettings({ meds: meds });
    },
    'connect': () => {
      const fromLink = S.readSetupLink($('#setup-paste').value);
      const patch = fromLink || { apiUrl: ($('#api-url').value || '').trim(), token: ($('#api-token').value || '').trim() };
      if (!/^(https:\/\/|http:\/\/localhost[:/])/.test(patch.apiUrl || '') || !patch.token) { toast('Please paste the setup link, or both the address and the key'); return; }
      S.setSettings(patch);
      toast('Connected. Fetching everything…');
    },
    'disconnect': () => { S.setSettings({ apiUrl: '', token: '' }); S.clearLocal(); toast('This phone is no longer sharing'); },
    'copy-setup': async () => {
      const link = S.setupLink();
      try { await navigator.clipboard.writeText(link); toast('Link copied. Send it to the other phone.'); }
      catch (e) { window.prompt('Copy this link', link); }
    },
    'seed': () => { seedExample(); go('now'); toast('Example week added'); },
    'clear': () => {
      if (!window.confirm('Clear everything saved on this phone? Anything already shared stays on the backend.')) return;
      S.clearLocal();
      toast('Cleared');
    },
  };

  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-action]');
    if (!b || b.disabled) return;
    const fn = actions[b.dataset.action];
    if (fn) { ev.preventDefault(); fn(b); }
  });

  // Settings text fields save when you leave them
  document.addEventListener('change', ev => {
    const el = ev.target;
    if (el.dataset.setting) {
      const v = el.value.trim();
      if (el.dataset.setting === 'who' && !v) return;
      S.setSettings({ [el.dataset.setting]: v });
    }
    if (el.dataset.medField) {
      const i = Number(el.closest('[data-med]').dataset.med);
      const meds = (S.settings.meds || []).slice();
      const m = Object.assign({}, meds[i]);
      m[el.dataset.medField] = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value.trim();
      meds[i] = m;
      S.setSettings({ meds: meds });
    }
  });

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && sheetDraw) closeSheet();
    if (ev.key === 'Enter' && ev.target.id === 'who-new') actions['set-who-new']();
    if (ev.key === 'Enter' && ev.target.id === 'note-text') actions['note-save']();
  });
  $('#sheet-backdrop').addEventListener('click', closeSheet);

  // Remember when this phone was last looked at, for "while you were away"
  document.addEventListener('visibilitychange', () => {
    // While the "while you were away" card is up, keep its start time until "Got it"
    if (handoverShowing) return;
    if (document.visibilityState === 'hidden') S.setSettings({ lastSeen: Date.now() });
    else { handoverSince = S.settings.lastSeen || 0; render(); }
  });

  // Redraw when data changes; on Settings, only the header (so typing isn't interrupted)
  S.subscribe(() => render(view === 'settings' && document.activeElement && document.activeElement.matches('input') ? { headerOnly: true } : undefined));

  // Keep times fresh
  setInterval(() => {
    const typing = document.activeElement && document.activeElement.matches('input');
    render(view === 'settings' || typing ? { headerOnly: true } : undefined);
  }, 15000);

  // Setup link opened directly: #setup=…
  const fromHash = S.readSetupLink(location.hash);
  if (fromHash) {
    S.setSettings(fromHash);
    history.replaceState(null, '', location.pathname);
  }

  if (!handoverSince) S.setSettings({ lastSeen: Date.now() });
  render();
  S.startPolling();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
