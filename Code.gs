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

      // 1) Read existing data from Drive
      const existing = readOrInit_();
      const incoming = body.data;

      // 2) Merge Auth (PIN/Devices)
      if (incoming.auth) {
        existing.auth = {
          pin: (incoming.auth.pin) ? String(incoming.auth.pin).slice(0, 4) : existing.auth.pin,
          trustedDevices: (incoming.auth.trustedDevices && incoming.auth.trustedDevices.length > 0) 
            ? incoming.auth.trustedDevices 
            : existing.auth.trustedDevices
        };
      }

      // 3) Merge Sections (Only if incoming has data, preserve existing if not)
      if (incoming.sections && incoming.sections.length > 0) {
        existing.sections = incoming.sections;
      }
      
      // Update timestamp
      existing.updatedAt = new Date().toISOString();

      // 4) Normalize and Write
      const cleaned = normalizeData_(existing);
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
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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
    auth: {
      pin: "",
      trustedDevices: []
    },
    sections: []
  };
}

function normalizeData_(data) {
  const out = {
    version: 1,
    updatedAt: (data && data.updatedAt) ? String(data.updatedAt) : new Date().toISOString(),
    auth: {
      pin: (data && data.auth && data.auth.pin) ? String(data.auth.pin).slice(0, 4) : "",
      trustedDevices: (data && data.auth && Array.isArray(data.auth.trustedDevices)) ? data.auth.trustedDevices.map(d => ({
        id: String(d.id || ""),
        name: String(d.name || "").slice(0, 50),
        publicKey: String(d.publicKey || "")
      })).filter(d => d.id && d.publicKey) : []
    },
    sections: []
  };

  const sections = (data && Array.isArray(data.sections)) ? data.sections : [];

  out.sections = sections.map(s => {
    const sId = String(s.id || "sec_" + Math.random().toString(36).slice(2, 9));
    return {
      id: sId,
      name: String(s.name || "Untitled Section").slice(0, 60),
      links: (Array.isArray(s.links) ? s.links : []).map(l => ({
        id: String(l.id || "lnk_" + Math.random().toString(36).slice(2, 9)),
        name: String(l.name || "Untitled Link").slice(0, 80),
        url: String(l.url || "")
      })).filter(l => l.url)
    };
  }).filter(s => s.name);

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
