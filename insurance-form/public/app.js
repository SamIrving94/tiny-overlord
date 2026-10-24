// Screens for the secure application form.
//   /                 broker creates an application
//   /a/<id>#admin=…   client admin sets passwords, follows progress, sends to the broker
//   /a/<id>           colleagues unlock their sections with a password and fill them in
//   /a/<id>#broker    broker reads the answers with their broker password
(function () {
  'use strict';
  const S = window.SecureBox;
  const F = window.FormSchema;
  const main = document.getElementById('main');

  const state = {
    schema: null, app: null, mode: 'contributor', adminSecret: '',
    keys: {},      // section id -> raw data key, only for sections unlocked on this device
    answers: {},   // section id -> decrypted answers
    viaAdmin: false
  };

  // ---------- small helpers ----------

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }

  function show(...nodes) {
    main.replaceChildren(...nodes.flat(Infinity).filter(n => n !== null && n !== undefined && n !== false));
    main.focus();
    window.scrollTo(0, 0);
  }

  async function api(method, path, body) {
    const res = await fetch('/api' + path, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store'
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Something went wrong');
    return json;
  }

  function message(kind, text) {
    return h('p', { class: 'msg ' + kind, role: kind === 'error' ? 'alert' : 'status' }, text);
  }

  // Runs an async action, showing the error under the button if it fails.
  function busy(button, slot, fn) {
    return async (e) => {
      if (e) e.preventDefault();
      const label = button.textContent;
      button.disabled = true;
      button.textContent = 'Working…';
      slot.replaceChildren();
      try { await fn(); }
      catch (err) { slot.replaceChildren(message('error', err.message)); }
      finally { button.disabled = false; button.textContent = label; }
    };
  }

  function copyButton(text, label) {
    const b = h('button', { type: 'button', class: 'secondary small' }, label || 'Copy');
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; }
      catch (e) { b.textContent = 'Select and copy it'; }
      setTimeout(() => { b.textContent = label || 'Copy'; }, 2000);
    });
    return b;
  }

  function linkBox(url, label) {
    return h('div', { class: 'linkbox' },
      h('label', {}, label),
      h('div', { class: 'row' }, h('input', { type: 'text', readonly: true, value: url, onfocus: e => e.target.select() }), copyButton(url)));
  }

  function passwordField(id, label, hint) {
    const input = h('input', { id, type: 'text', autocomplete: 'off', spellcheck: 'false', class: 'pw', minlength: 10 });
    const gen = h('button', { type: 'button', class: 'secondary small', onclick: () => { input.value = S.generatePassword(); input.dispatchEvent(new Event('input')); } }, 'Make one for me');
    return { input, el: h('div', { class: 'field' }, h('label', { for: id }, label), hint ? h('p', { class: 'hint' }, hint) : null, h('div', { class: 'row' }, input, gen)) };
  }

  function checkPassword(p) {
    if (S.normalisePassword(p).length < 10) throw new Error('Passwords need at least 10 characters. Use "Make one for me" for a strong one.');
  }

  const fmtDate = iso => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const countryOf = code => state.schema.countries.find(c => c.code === code) || {};
  const industryOf = code => state.schema.industries.find(i => i.code === code) || {};
  const aad = (sid, kind) => state.app.id + ':' + sid + ':' + kind;

  function contextLine() {
    const c = state.app.context;
    return h('p', { class: 'context' },
      h('span', { class: 'pill' }, countryOf(c.country).name),
      h('span', { class: 'pill' }, industryOf(c.industry).name),
      c.analytics ? h('span', { class: 'pill tag' }, 'Risk and analytics data: yes') : h('span', { class: 'pill muted' }, 'Risk and analytics data: no'));
  }

  // ---------- broker: create ----------

  async function brokerCreate() {
    const [config, list] = await Promise.all([api('GET', '/config'), api('GET', '/schemas')]);
    const slot = h('div');
    const formPick = h('select', { id: 'schema' }, list.map(s => h('option', { value: s.id }, s.title)));
    const country = h('select', { id: 'country' });
    const industry = h('select', { id: 'industry' });
    const analytics = h('input', { type: 'checkbox', id: 'analytics' });
    const clientName = h('input', { id: 'client', type: 'text', required: true });
    const adminEmail = h('input', { id: 'adminEmail', type: 'email' });
    const brokerName = h('input', { id: 'bname', type: 'text', required: true });
    const brokerEmail = h('input', { id: 'bemail', type: 'email' });
    const expires = h('select', { id: 'expires' }, [14, 30, 60, 90].map(d => h('option', { value: d, selected: d === 30 }, d + ' days')));
    const code = h('input', { id: 'code', type: 'password', autocomplete: 'off' });
    const pw = passwordField('bpw', 'Your broker password', 'You need this to read the answers. Keep it to yourself. It cannot be reset.');

    async function loadSchema() {
      state.schema = await api('GET', '/schemas/' + formPick.value);
      country.replaceChildren(h('option', { value: '' }, 'Choose…'), ...state.schema.countries.map(c => h('option', { value: c.code }, c.name)));
      industry.replaceChildren(h('option', { value: '' }, 'Choose…'), ...state.schema.industries.map(i => h('option', { value: i.code }, i.name)));
    }
    formPick.addEventListener('change', loadSchema);
    await loadSchema();

    const submit = h('button', { type: 'submit' }, 'Create the secure link');
    const form = h('form', { class: 'card' },
      h('h2', {}, 'The client'),
      field('client', 'Client company name', clientName),
      field('adminEmail', 'Client admin email (optional)', adminEmail, 'Only used to start an email to them. Not saved.'),
      field('schema', 'Application form', formPick),
      field('country', 'Country', country, 'The client admin can change this.'),
      field('industry', 'Industry', industry, 'The client admin can change this.'),
      h('div', { class: 'field check' }, analytics, h('label', { for: 'analytics' }, 'Ask for extra risk and analytics data (exposure information)')),
      h('h2', {}, 'You'),
      field('bname', 'Your name', brokerName),
      field('bemail', 'Your email (optional)', brokerEmail),
      pw.el,
      field('expires', 'Link stops working after', expires),
      config.brokerCodeRequired ? field('code', 'Broker access code', code) : null,
      submit, slot);

    form.addEventListener('submit', busy(submit, slot, async () => {
      if (!clientName.value.trim() || !brokerName.value.trim()) throw new Error('Please fill in the client name and your name.');
      if (!country.value || !industry.value) throw new Error('Please choose a country and an industry.');
      checkPassword(pw.input.value);
      const adminSecret = S.randomId(24);
      const brokerSalt = S.randomId(16);
      const keys = await S.createBrokerKeys(pw.input.value, brokerSalt);
      const out = await api('POST', '/applications', {
        schemaId: state.schema.id, clientName: clientName.value.trim(), brokerName: brokerName.value.trim(), brokerEmail: brokerEmail.value.trim(),
        context: { country: country.value, industry: industry.value, analytics: analytics.checked },
        kdfSalt: S.randomId(16), adminSecretHash: await S.sha256(adminSecret),
        broker: { publicKey: keys.publicKey, privateKeyBox: keys.privateKeyBox, salt: brokerSalt },
        expiresDays: Number(expires.value), brokerCode: code.value
      });
      brokerCreated(out.id, adminSecret, clientName.value.trim(), adminEmail.value.trim(), brokerName.value.trim());
    }));

    show(h('h1', {}, 'New application'),
      h('p', { class: 'lead' }, 'Create a secure link for your client. Their admin sets a password for each section, so each colleague only sees the part they need to fill in.'),
      form);
  }

  function field(id, label, input, hint) {
    return h('div', { class: 'field' }, h('label', { for: id }, label), hint ? h('p', { class: 'hint' }, hint) : null, input);
  }

  function brokerCreated(id, adminSecret, client, adminEmail, brokerName) {
    const adminUrl = location.origin + '/a/' + id + '#admin=' + adminSecret;
    const brokerUrl = location.origin + '/a/' + id + '#broker';
    const body = 'Hello,\n\nHere is the secure link for your ' + state.schema.title.toLowerCase() + '.\n\n' + adminUrl +
      '\n\nThis link is only for you. When you open it, you will set a password for each section, then share a separate link with colleagues.\n\nThanks,\n' + brokerName;
    const mailto = 'mailto:' + encodeURIComponent(adminEmail) + '?subject=' + encodeURIComponent('Secure application for ' + client) + '&body=' + encodeURIComponent(body);
    show(h('h1', {}, 'Link created'),
      h('div', { class: 'card' },
        h('h2', {}, '1. Send this to the client admin'),
        linkBox(adminUrl, 'Client admin link'),
        h('p', {}, h('a', { class: 'button', href: mailto }, 'Start an email')),
        h('p', { class: 'hint' }, 'Anyone with this link can set up the sections, so send it only to the client admin.')),
      h('div', { class: 'card' },
        h('h2', {}, '2. Keep this for yourself'),
        linkBox(brokerUrl, 'Your link to read the answers'),
        h('p', { class: 'hint' }, 'Open it any time to see progress. You will need your broker password.')));
  }

  // ---------- load an application ----------

  async function loadApp(id) {
    state.app = await api('GET', '/applications/' + id);
    if (!state.schema || state.schema.id !== state.app.schemaId) state.schema = await api('GET', '/schemas/' + state.app.schemaId);
  }

  function sectionsInPlay() {
    return F.visibleSections(state.schema, state.app.context).filter(s => !state.app.keys || state.app.keys[s.id]);
  }

  function header() {
    return [
      h('h1', {}, state.app.clientName),
      h('p', { class: 'sub' }, state.schema.title + ' · from ' + state.app.brokerName),
      contextLine()
    ];
  }

  // ---------- client admin: set up ----------

  function adminSetup() {
    const ctx = Object.assign({}, state.app.context);
    const slot = h('div');
    const list = h('div');
    const rows = {};
    const adminPw = passwordField('adminpw', 'Your admin password', 'This opens every section. Keep it to yourself. It cannot be reset.');

    const country = h('select', { id: 'country', onchange: () => { ctx.country = country.value; drawSections(); } },
      state.schema.countries.map(c => h('option', { value: c.code, selected: c.code === ctx.country }, c.name)));
    const industry = h('select', { id: 'industry', onchange: () => { ctx.industry = industry.value; drawSections(); } },
      state.schema.industries.map(i => h('option', { value: i.code, selected: i.code === ctx.industry }, i.name)));
    const analytics = h('input', { type: 'checkbox', id: 'analytics', checked: ctx.analytics, onchange: () => { ctx.analytics = analytics.checked; drawSections(); } });

    function drawSections() {
      list.replaceChildren(...F.visibleSections(state.schema, ctx).map(s => {
        if (!rows[s.id]) {
          const pw = passwordField('pw-' + s.id, 'Password for this section');
          const who = h('input', { type: 'text', id: 'who-' + s.id, placeholder: 'For example: Priya, IT security' });
          const mine = h('input', { type: 'checkbox', id: 'mine-' + s.id });
          mine.addEventListener('change', () => { pw.el.hidden = mine.checked; });
          rows[s.id] = { pw, who, mine, el: null };
          rows[s.id].el = h('div', { class: 'card section-setup' },
            h('h3', {}, s.title), h('p', { class: 'hint' }, 'Usually: ' + (s.audience || 'anyone') + '. ' + (s.description || '')),
            h('div', { class: 'field check' }, mine, h('label', { for: 'mine-' + s.id }, 'I will fill this in myself (use my admin password)')),
            field('who-' + s.id, 'Who will fill it in? (only shown on your sharing sheet)', who),
            pw.el);
        }
        return rows[s.id].el;
      }));
    }
    drawSections();

    const submit = h('button', { type: 'submit' }, 'Lock the sections');
    const form = h('form', {},
      h('div', { class: 'card' },
        h('h2', {}, '1. Check the details'),
        h('p', { class: 'hint' }, 'These choose which questions are asked.'),
        field('country', 'Country', country), field('industry', 'Industry', industry),
        h('div', { class: 'field check' }, analytics, h('label', { for: 'analytics' }, 'We will share extra risk and analytics data'))),
      h('div', { class: 'card' }, h('h2', {}, '2. Your password'), adminPw.el),
      h('h2', {}, '3. A password for each section'),
      h('p', { class: 'hint' }, 'Give the same password to sections that the same person fills in.'),
      list, submit, slot);

    form.addEventListener('submit', busy(submit, slot, async () => {
      checkPassword(adminPw.input.value);
      const sections = F.visibleSections(state.schema, ctx);
      for (const s of sections) if (!rows[s.id].mine.checked) {
        try { checkPassword(rows[s.id].pw.input.value); } catch (e) { throw new Error(s.title + ': ' + e.message); }
      }
      const adminKey = await S.deriveKey(adminPw.input.value, state.app.kdfSalt);
      const kekCache = {};
      const out = {};
      const sheet = [];
      for (const s of sections) {
        const r = rows[s.id];
        const pass = r.mine.checked ? adminPw.input.value : r.pw.input.value;
        const norm = S.normalisePassword(pass);
        kekCache[norm] = kekCache[norm] || await S.deriveKey(pass, state.app.kdfSalt);
        const raw = S.newDataKey();
        out[s.id] = {
          wrap: await S.seal(kekCache[norm], raw, aad(s.id, 'wrap')),
          adminWrap: await S.seal(adminKey, raw, aad(s.id, 'admin')),
          brokerWrap: await S.wrapForBroker(state.app.broker.publicKey, raw),
          writeHash: await S.sha256(await S.writeToken(raw))
        };
        state.keys[s.id] = raw;
        sheet.push({ title: s.title, who: r.mine.checked ? 'You' : r.who.value.trim(), password: r.mine.checked ? '(your admin password)' : pass });
      }
      state.app = await api('POST', '/applications/' + state.app.id + '/setup', { adminSecret: state.adminSecret, context: ctx, sections: out });
      state.viaAdmin = true;
      sharingSheet(sheet);
    }));

    show(...header(), h('p', { class: 'lead' }, 'Set a password for each section. Then share one link with your colleagues and give each person only the password they need.'), form);
  }

  function sharingSheet(sheet) {
    const url = location.origin + '/a/' + state.app.id;
    show(h('h1', {}, 'Sections locked'),
      h('div', { class: 'card' },
        h('h2', {}, 'Share this link with your colleagues'),
        linkBox(url, 'Link for colleagues'),
        h('p', { class: 'hint' }, 'The link alone shows nothing. Each person also needs a password.')),
      h('div', { class: 'card' },
        h('h2', {}, 'Passwords'),
        message('warn', 'This is the only time these passwords are shown. Write them down or print this page now. Send each password separately from the link, for example by phone or chat.'),
        h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Section'), h('th', {}, 'Who'), h('th', {}, 'Password'))),
          h('tbody', {}, sheet.map(r => h('tr', {}, h('td', {}, r.title), h('td', {}, r.who || '—'), h('td', { class: 'mono' }, r.password))))),
        h('p', {}, h('button', { type: 'button', class: 'secondary', onclick: () => window.print() }, 'Print'))),
      h('p', {}, h('button', { type: 'button', onclick: () => workspace() }, 'Go to the application')));
  }

  // ---------- unlocking ----------

  async function unlockWith(password) {
    const kek = await S.deriveKey(password, state.app.kdfSalt);
    let found = 0;
    for (const [sid, k] of Object.entries(state.app.keys)) {
      let raw = await S.open(kek, k.wrap, aad(sid, 'wrap'));
      if (!raw) {
        raw = await S.open(kek, k.adminWrap, aad(sid, 'admin'));
        if (raw) state.viaAdmin = true;
      }
      if (raw) { if (!state.keys[sid]) found++; state.keys[sid] = raw; }
    }
    await decryptAll();
    return found;
  }

  async function decryptAll() {
    for (const sid of Object.keys(state.keys)) {
      const a = state.app.answers[sid];
      state.answers[sid] = a ? (await S.decryptJson(state.keys[sid], a.box, aad(sid, 'answers'))) || {} : {};
    }
  }

  function statusOf(sid) {
    const a = state.app.answers[sid];
    if (!a) return { text: 'Not started', cls: 'todo' };
    if (a.complete) return { text: 'Finished', cls: 'done' };
    return { text: 'In progress', cls: 'doing' };
  }

  // ---------- workspace: everyone after setup ----------

  function workspace() {
    const slot = h('div');
    const pwInput = h('input', { id: 'unlock', type: 'password', autocomplete: 'off', spellcheck: 'false' });
    const unlockBtn = h('button', { type: 'submit' }, 'Unlock');
    const unlockForm = h('form', { class: 'card unlock' },
      h('label', { for: 'unlock' }, state.mode === 'admin' ? 'Enter your admin password, or a section password' : 'Enter the password you were given'),
      h('div', { class: 'row' }, pwInput, unlockBtn), slot);
    unlockForm.addEventListener('submit', busy(unlockBtn, slot, async () => {
      const n = await unlockWith(pwInput.value);
      if (!n && !Object.keys(state.keys).length) throw new Error('That password did not open any section. Check it and try again.');
      workspace();
    }));

    const sections = sectionsInPlay();
    const submitted = state.app.status === 'submitted';
    const allDone = sections.every(s => statusOf(s.id).cls === 'done');

    const cards = sections.map(s => {
      const st = statusOf(s.id);
      const open = Boolean(state.keys[s.id]);
      const a = state.app.answers[s.id];
      return h('div', { class: 'card section ' + (open ? 'open' : 'locked') },
        h('div', { class: 'section-head' },
          h('h3', {}, (open ? '🔓 ' : '🔒 ') + s.title),
          h('span', { class: 'status ' + st.cls }, st.text)),
        h('p', { class: 'hint' }, 'For: ' + (s.audience || 'anyone') + (a ? ' · last saved ' + fmtDate(a.updatedAt) : '')),
        open
          ? h('div', { class: 'row' },
            h('button', { type: 'button', onclick: () => sectionForm(s) }, submitted ? 'View answers' : (st.cls === 'todo' ? 'Start' : 'Open')),
            state.mode === 'admin' && state.viaAdmin && !submitted ? h('button', { type: 'button', class: 'secondary', onclick: () => changePassword(s) }, 'Change password') : null)
          : h('p', { class: 'muted' }, 'Locked. Needs the password for this section.'));
    });

    const adminBar = state.mode === 'admin' ? adminSubmitBar(sections, allDone, submitted) : null;

    show(...header(),
      submitted ? message('ok', 'Sent to ' + state.app.brokerName + ' on ' + fmtDate(state.app.submittedAt) + '. Answers can no longer be changed.') : null,
      Object.keys(state.keys).length < sections.length ? unlockForm : null,
      h('h2', {}, 'Sections'),
      h('p', { class: 'hint' }, sections.filter(s => statusOf(s.id).cls === 'done').length + ' of ' + sections.length + ' finished'),
      cards, adminBar,
      h('p', { class: 'hint' }, 'This link stops working on ' + fmtDate(state.app.expiresAt) + '.'));
  }

  function adminSubmitBar(sections, allDone, submitted) {
    if (submitted) return null;
    const slot = h('div');
    const btn = h('button', { type: 'button', disabled: !allDone }, 'Send to ' + state.app.brokerName);
    btn.addEventListener('click', busy(btn, slot, async () => {
      if (!confirm('Send the application to ' + state.app.brokerName + '? After this, answers cannot be changed.')) return;
      state.app = await api('POST', '/applications/' + state.app.id + '/submit', { adminSecret: state.adminSecret });
      workspace();
    }));
    btn.disabled = !allDone;
    return h('div', { class: 'card' },
      h('h2', {}, 'Send to your broker'),
      h('p', { class: 'hint' }, allDone ? 'Every section is finished. Check the answers, then send.' : 'You can send once every section is marked as finished.'),
      btn, slot);
  }

  function changePassword(s) {
    const slot = h('div');
    const pw = passwordField('newpw', 'New password for ' + s.title);
    const btn = h('button', { type: 'submit' }, 'Save new password');
    const form = h('form', { class: 'card' }, pw.el, btn, slot,
      h('p', {}, h('button', { type: 'button', class: 'secondary', onclick: () => workspace() }, 'Back')));
    form.addEventListener('submit', busy(btn, slot, async () => {
      checkPassword(pw.input.value);
      const kek = await S.deriveKey(pw.input.value, state.app.kdfSalt);
      const wrap = await S.seal(kek, state.keys[s.id], aad(s.id, 'wrap'));
      state.app = await api('POST', '/applications/' + state.app.id + '/sections/' + s.id + '/password', { adminSecret: state.adminSecret, wrap });
      show(h('h1', {}, 'Password changed'),
        h('div', { class: 'card' }, h('p', {}, 'The new password for ' + s.title + ' is:'), h('p', { class: 'mono big' }, pw.input.value),
          message('warn', 'The old password no longer works. Share the new one separately from the link.')),
        h('p', {}, h('button', { type: 'button', onclick: () => workspace() }, 'Back to the application')));
    }));
    show(...header(), h('h2', {}, 'Change a section password'), form);
  }

  // ---------- one section's questions ----------

  function sectionForm(section) {
    const ctx = state.app.context;
    const answers = Object.assign({}, state.answers[section.id] || {});
    const readOnly = state.app.status !== 'open';
    const currency = countryOf(ctx.country).currency || '';
    const slot = h('div');
    const body = h('div');
    let dirty = false;
    let errors = {};

    function setVal(q, v) { answers[q.id] = v; dirty = true; if (q.id in errors) { delete errors[q.id]; } draw(); }

    function input(q) {
      const v = answers[q.id];
      const id = 'q-' + q.id;
      const common = { id, disabled: readOnly, 'aria-invalid': errors[q.id] ? 'true' : false };
      switch (q.type) {
        case 'textarea':
          return h('textarea', Object.assign({ rows: 4, oninput: e => { answers[q.id] = e.target.value; dirty = true; } }, common), v || '');
        case 'number': case 'currency': case 'percent': {
          const el = h('input', Object.assign({ type: 'number', inputmode: 'decimal', step: 'any', value: v === undefined ? '' : v, min: q.type === 'percent' ? 0 : q.min, max: q.type === 'percent' ? 100 : q.max,
            oninput: e => { answers[q.id] = e.target.value === '' ? '' : Number(e.target.value); dirty = true; } }, common));
          const pre = q.type === 'currency' ? h('span', { class: 'affix' }, currency) : null;
          const post = q.type === 'percent' ? h('span', { class: 'affix' }, '%') : null;
          return h('div', { class: 'row affixed' }, pre, el, post);
        }
        case 'date':
          return h('input', Object.assign({ type: 'date', value: v || '', onchange: e => { answers[q.id] = e.target.value; dirty = true; } }, common));
        case 'select':
          return h('select', Object.assign({ onchange: e => setVal(q, e.target.value) }, common),
            h('option', { value: '' }, 'Choose…'), q.options.map(o => h('option', { value: o, selected: o === v }, o)));
        case 'multiselect':
          return h('div', { class: 'choices', id }, q.options.map((o, i) => h('label', { class: 'choice' },
            h('input', { type: 'checkbox', disabled: readOnly, checked: Array.isArray(v) && v.includes(o),
              onchange: e => { const cur = new Set(answers[q.id] || []); e.target.checked ? cur.add(o) : cur.delete(o); setVal(q, q.options.filter(x => cur.has(x))); } }), ' ' + o)));
        case 'yesno':
          return h('div', { class: 'choices inline', id, role: 'radiogroup' }, ['yes', 'no'].map(o => h('label', { class: 'choice' },
            h('input', { type: 'radio', name: id, value: o, disabled: readOnly, checked: v === o, onchange: () => setVal(q, o) }), o === 'yes' ? ' Yes' : ' No')));
        case 'checkbox':
          return null; // drawn with its label below
        default:
          return h('input', Object.assign({ type: 'text', value: v || '', oninput: e => { answers[q.id] = e.target.value; dirty = true; } }, common));
      }
    }

    function draw() {
      body.replaceChildren(...F.visibleQuestions(state.schema, section, ctx, answers).map(q => {
        const err = errors[q.id] ? h('p', { class: 'field-error' }, errors[q.id]) : null;
        if (q.type === 'checkbox') {
          return h('div', { class: 'field check' + (err ? ' has-error' : '') },
            h('input', { type: 'checkbox', id: 'q-' + q.id, disabled: readOnly, checked: answers[q.id] === true, onchange: e => setVal(q, e.target.checked) }),
            h('label', { for: 'q-' + q.id }, q.label + (q.required ? '' : ' (optional)')), err);
        }
        return h('div', { class: 'field' + (err ? ' has-error' : '') },
          h('label', { for: 'q-' + q.id }, q.label, q.required ? null : h('span', { class: 'muted' }, ' (optional)')),
          q.help ? h('p', { class: 'hint' }, q.help) : null, input(q), err);
      }));
    }

    async function saveSection(complete) {
      const clean = F.cleanAnswers(state.schema, section, ctx, answers);
      if (complete) {
        const problems = F.checkAnswers(state.schema, section, ctx, answers);
        errors = Object.fromEntries(problems.map(p => [p.question, p.error]));
        draw();
        if (problems.length) {
          const first = document.getElementById('q-' + problems[0].question);
          if (first) first.focus();
          throw new Error(problems.length === 1 ? '1 question needs an answer or a fix.' : problems.length + ' questions need an answer or a fix.');
        }
      }
      const raw = state.keys[section.id];
      const box = await S.encryptJson(raw, clean, aad(section.id, 'answers'));
      const out = await api('PUT', '/applications/' + state.app.id + '/sections/' + section.id, { writeToken: await S.writeToken(raw), box, complete });
      state.app.answers[section.id] = { box, complete, updatedAt: out.updatedAt };
      state.answers[section.id] = clean;
      dirty = false;
    }

    const saveBtn = h('button', { type: 'button', class: 'secondary' }, 'Save for later');
    const doneBtn = h('button', { type: 'button' }, 'Save and mark as finished');
    saveBtn.addEventListener('click', busy(saveBtn, slot, async () => { await saveSection(false); slot.replaceChildren(message('ok', 'Saved.')); }));
    doneBtn.addEventListener('click', busy(doneBtn, slot, async () => { await saveSection(true); workspace(); }));
    const back = h('button', { type: 'button', class: 'link', onclick: () => { if (!dirty || confirm('Leave without saving your changes?')) workspace(); } }, '← All sections');

    draw();
    show(back, h('h1', {}, section.title), section.description ? h('p', { class: 'lead' }, section.description) : null,
      h('form', { class: 'card', onsubmit: e => e.preventDefault() }, body,
        readOnly ? null : h('div', { class: 'row actions' }, saveBtn, doneBtn), slot));
  }

  // ---------- broker: read answers ----------

  function brokerView() {
    const slot = h('div');
    const pw = h('input', { id: 'bpw', type: 'password', autocomplete: 'off', spellcheck: 'false' });
    const btn = h('button', { type: 'submit' }, 'Unlock');
    const form = h('form', { class: 'card unlock' }, h('label', { for: 'bpw' }, 'Your broker password'), h('div', { class: 'row' }, pw, btn), slot);
    form.addEventListener('submit', busy(btn, slot, async () => {
      const b = state.app.broker;
      const key = await S.unlockBrokerKey(pw.value, b.salt, b.privateKeyBox);
      if (!key) throw new Error('That is not the broker password for this application.');
      if (!state.app.keys) { brokerSummary(); return; }
      for (const [sid, k] of Object.entries(state.app.keys)) {
        const raw = await S.unwrapForBroker(key, k.brokerWrap);
        if (raw) state.keys[sid] = raw;
      }
      await decryptAll();
      brokerSummary();
    }));
    show(...header(), form);
  }

  function display(q, v) {
    if (v === undefined || v === '' || v === null) return h('span', { class: 'muted' }, 'No answer');
    if (q.type === 'yesno') return v === 'yes' ? 'Yes' : 'No';
    if (q.type === 'checkbox') return v ? 'Confirmed' : 'Not confirmed';
    if (q.type === 'multiselect') return v.join(', ');
    if (q.type === 'currency') return (countryOf(state.app.context.country).currency || '') + ' ' + Number(v).toLocaleString('en-GB');
    if (q.type === 'percent') return v + '%';
    if (q.type === 'number') return Number(v).toLocaleString('en-GB');
    return String(v);
  }

  function exportJson() {
    const ctx = state.app.context;
    const out = {
      form: state.schema.id, formVersion: state.app.schemaVersion, applicationId: state.app.id,
      client: state.app.clientName, status: state.app.status, submittedAt: state.app.submittedAt,
      context: { country: ctx.country, industry: ctx.industry, riskAnalyticsData: ctx.analytics, currency: countryOf(ctx.country).currency },
      sections: {}
    };
    for (const s of sectionsInPlay()) out.sections[s.id] = { complete: statusOf(s.id).cls === 'done', answers: state.answers[s.id] || {} };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: state.app.clientName.replace(/[^\w-]+/g, '-') + '-' + state.schema.id + '.json' });
    document.body.append(a);
    a.click();
    a.remove();
  }

  function brokerSummary() {
    const sections = sectionsInPlay();
    const st = state.app.status;
    const banner = st === 'submitted' ? message('ok', 'Sent by the client on ' + fmtDate(state.app.submittedAt) + '.')
      : st === 'draft' ? message('warn', 'The client admin has not set up the sections yet.')
        : message('warn', 'Still in progress. The client has not sent this yet, so answers may change.');
    show(...header(), banner,
      sections.length && st !== 'draft' ? h('p', { class: 'row' },
        h('button', { type: 'button', onclick: exportJson }, 'Download answers (JSON)'),
        h('button', { type: 'button', class: 'secondary', onclick: () => window.print() }, 'Print')) : null,
      st === 'draft' ? null : sections.map(s => {
        const status = statusOf(s.id);
        const ans = state.answers[s.id] || {};
        return h('div', { class: 'card' },
          h('div', { class: 'section-head' }, h('h2', {}, s.title), h('span', { class: 'status ' + status.cls }, status.text)),
          h('dl', { class: 'answers' }, F.visibleQuestions(state.schema, s, state.app.context, ans).flatMap(q => [h('dt', {}, q.label), h('dd', {}, display(q, ans[q.id]))])));
      }));
  }

  // ---------- start ----------

  async function start() {
    try {
      const m = location.pathname.match(/^\/a\/([A-Za-z0-9_-]{32})\/?$/);
      if (!m) return await brokerCreate();
      const hash = new URLSearchParams(location.hash.slice(1));
      if (hash.has('admin')) { state.mode = 'admin'; state.adminSecret = hash.get('admin'); }
      else if (location.hash === '#broker') state.mode = 'broker';
      await loadApp(m[1]);
      if (state.mode === 'broker') return brokerView();
      if (state.app.status === 'draft') {
        if (state.mode === 'admin') return adminSetup();
        return show(...header(), message('warn', 'This application is not ready yet. The client admin still needs to set it up. Try again later.'));
      }
      workspace();
    } catch (e) {
      show(h('h1', {}, 'Cannot open this'), message('error', e.message));
    }
  }

  // The part after # says who you are, so start again if it changes.
  window.addEventListener('hashchange', () => location.reload());

  start();
})();
