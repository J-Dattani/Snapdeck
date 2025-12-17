# Personal Shortcut Dashboard (Drive JSON + Apps Script)

Minimal dashboard to create sections and Chrome-like shortcut tiles.

## Files
- `index.html`
- `css/style.css`
- `js/app.js`
- `manifest.json`
- `Code.gs` (Google Apps Script backend)

## What you must configure
### 1) Deploy Apps Script Web App
1. Go to https://script.google.com/
2. Create a new project
3. Create a file named `Code.gs` and paste in this repo’s `Code.gs`
4. Deploy as a Web App to get a URL (ends with `/exec`)

Google will prompt for permissions (Drive access) because the script reads/writes `dashboard.json` in your Drive.

### 2) Set API URL in the frontend
Open `js/app.js` and set:

- `API_BASE_URL = "https://script.google.com/macros/s/.../exec"`

This repo already has `API_BASE_URL` set to the URL you provided.

## Data storage
A single Drive file named `dashboard.json` is created automatically in the Drive root if missing.

Initial contents:

```json
{"version":1,"updatedAt":"...","sections":[]}
```

## Local viewing
This is a static site. You can open `index.html` directly, but some browsers restrict `fetch` from `file://`.

If you need a local static server, use any simple server you already trust.

### Included local server (Windows)
Run `serve.cmd` and open:

- `http://localhost:8000/`
