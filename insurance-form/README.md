# Secure application form

An insurance application form where **each section has its own password**. A colleague only sees the sections their password opens. This avoids giving everyone delegated access to the whole application.

## Try it

```bash
cd insurance-form
npm start        # http://localhost:8790
npm test
```

No dependencies. Needs Node 20 or newer. This is a server app, so it does **not** run on GitHub Pages.

## How it works

1. **Broker** opens `/`. Enters the client, country, industry, and whether to ask for extra **risk and analytics data**. Sets a broker password. Gets two links:
   - a **client admin link** (`/a/<id>#admin=<secret>`) to send to the client
   - a **broker link** (`/a/<id>#broker`) to read the answers later
2. **Client admin** opens their link. Checks country, industry and the analytics tag (these choose the questions). Sets their own admin password, and a password for each section. Gets a sharing sheet: one link for colleagues, and the password for each section.
3. **Colleagues** (for example InfoSec) open the colleague link and enter their password. Only their sections unlock. They save drafts or mark a section as finished.
4. **Client admin** sees every section with the admin password, and sends the application once every section is finished. After that it cannot be changed.
5. **Broker** opens the broker link, enters the broker password, reads the answers, and downloads them as JSON.

## Security

- Answers are **encrypted in the browser** (AES-256-GCM) before they are saved. The server never sees answers or passwords.
- Each section has its own random key. That key is stored locked three ways: with the section password, with the admin password, and with the broker's public key (RSA-OAEP 3072).
- Passwords are stretched with PBKDF2-SHA256 (310,000 rounds).
- Only someone who can open a section can save it (the server checks a write token made from the section key).
- Secrets live after the `#` in links, so they are never sent to the server or logs. Pages send `Referrer-Policy: no-referrer` and a strict Content Security Policy.
- Links expire (14 to 90 days, set by the broker).
- Set `BROKER_ACCESS_CODE` to stop anyone else creating applications.

Limits to know about:
- Anyone with the colleague link can download the **encrypted** data and try to guess passwords offline. Use the "Make one for me" passwords (about 75 bits).
- Forgotten passwords cannot be recovered. The admin can give a section a new password. A forgotten admin or broker password means starting again.
- Data is stored as JSON files in `data/`. For production, put it behind HTTPS and use a proper database and broker login.

## Form definitions

Forms live in `schemas/*.json` and are checked when the server starts. See `schemas/cyber.json`.

- **Sections** have `id`, `title`, `audience` (who usually fills it in), `description`, `questions`, and optional `showIf`.
- **Question types**: `text`, `textarea`, `number`, `currency`, `percent`, `date`, `select`, `multiselect`, `yesno`, `checkbox`.
- **`showIf`** (all parts must match):
  - `country`: list of country codes
  - `region`: list of regions (from the `countries` list)
  - `industry`: list of industry codes
  - `analytics`: `true` to show only when the client agreed to share risk and analytics data
  - `answer`: `{ "question": "id", "equals": "yes" }`, for an earlier question in the same section

## Files

| File | What it is |
|---|---|
| `server.js` | Web server and API. Stores only encrypted data. |
| `public/app.js` | The screens. |
| `public/crypto.js` | Encryption. Shared with the tests. |
| `public/schema.js` | Which questions show, and answer checks. Shared with the server and tests. |
| `schemas/cyber.json` | Sample cyber form. |
| `test/` | Tests for the schema logic, encryption and the full API journey. |
