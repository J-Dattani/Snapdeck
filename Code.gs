/**
 * Google Apps Script Web App backend.
 * Stores all data in a single JSON file in Google Drive.
 *
 * Endpoints (via query param op):
 *  - GET  ?op=get
 *  - POST ?op=save    Body: { data: <json> }
 *
 * Note: Apps Script Web Apps do not support PUT/DELETE verbs consistently
 * from browsers due to routing/CORS; we route CRUD through JSON + op.
 */

const DATA_FILE_NAME = "dashboard.json";

// Minimal CORS support for browser fetch (localhost/GitHub Pages, etc.).
// Apps Script Web Apps will send a CORS preflight (OPTIONS) for certain requests.
function doOptions(e) {
  // Respond to preflight requests.
  return cors_(ContentService.createTextOutput(""));
}

function doGet(e) {
  return route_("GET", e);
}

function doPost(e) {
  return route_("POST", e);
}

function route_(method, e) {
  try {
    const op = (e && e.parameter && e.parameter.op) ? String(e.parameter.op) : "";

    if (method === "GET" && op === "get") {
      const data = readOrInit_();
      return jsonOk_({ data });
    }

    if (method === "POST" && op === "save") {
      const body = parseJsonBody_(e);
      if (!body || typeof body !== 'object' || !body.data) {
        return jsonErr_("Missing body.data");
      }

      // Basic validation: enforce expected shape
      const cleaned = normalizeData_(body.data);
      write_(cleaned);
      return jsonOk_({ ok: true });
    }

    return jsonErr_("Not found");
  } catch (err) {
    return jsonErr_(String(err && err.message ? err.message : err));
  }
}

function parseJsonBody_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : "";
  if (!raw) return null;
  // Accept JSON sent as application/json or text/plain (stringified JSON).
  return JSON.parse(String(raw));
}

function jsonOk_(payload) {
  return json_({ ok: true, ...payload });
}

function jsonErr_(message) {
  return json_({ ok: false, error: String(message || "Error") });
}

function json_(obj) {
  // Always return JSON payload. Web Apps use 200 for ContentService responses.
  // The client should rely on { ok: true/false }.
  const out = ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  return cors_(out);
}

function cors_(output) {
  // Use '*' to keep it simple for a personal dashboard.
  // If you want to lock it down later, replace '*' with your GitHub Pages origin.
  return output
    .setHeader("Access-Control-Allow-Origin", "*")
    .setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    .setHeader("Access-Control-Allow-Headers", "Content-Type")
    .setHeader("Access-Control-Max-Age", "3600");
}

function readOrInit_() {
  const file = getOrCreateFile_();
  const text = file.getBlob().getDataAsString("utf-8");

  if (!text || !text.trim()) {
    const init = defaultData_();
    write_(init);
    return init;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    // If file is corrupted, do not overwrite automatically.
    throw new Error("Data file is not valid JSON.");
  }

  return normalizeData_(data);
}

function write_(data) {
  const file = getOrCreateFile_();
  file.setContent(JSON.stringify(data));
}

function defaultData_() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    sections: []
  };
}

function normalizeData_(data) {
  const out = {
    version: 1,
    updatedAt: (data && data.updatedAt) ? String(data.updatedAt) : new Date().toISOString(),
    sections: []
  };

  const sections = (data && Array.isArray(data.sections)) ? data.sections : [];

  out.sections = sections.map(s => ({
    id: String(s.id || ""),
    name: String(s.name || "").slice(0, 60),
    links: (Array.isArray(s.links) ? s.links : []).map(l => ({
      id: String(l.id || ""),
      name: String(l.name || "").slice(0, 80),
      url: String(l.url || "")
    })).filter(l => l.id && l.name && l.url)
  })).filter(s => s.id && s.name);

  return out;
}

function getOrCreateFile_() {
  const files = DriveApp.getFilesByName(DATA_FILE_NAME);
  if (files.hasNext()) {
    return files.next();
  }

  // Create new file in the root of Drive
  const init = defaultData_();
  return DriveApp.createFile(DATA_FILE_NAME, JSON.stringify(init), MimeType.PLAIN_TEXT);
}
