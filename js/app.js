/* Minimal, single-user dashboard.
   Storage: Google Apps Script Web App (Drive JSON file). */

(() => {
  "use strict";

  // 1) CONFIG (you will paste your Apps Script Web App URL here)
  // Example: https://script.google.com/macros/s/AKfycb....../exec
  const API_BASE_URL = "https://script.google.com/macros/s/AKfycbyt-59yAqJ3kwXDnb4Q7BkjTeDCtMab3NfuvM0MvrIWReM9mH0cAcYEfw_riU2LlfDn/exec";

  function normalizeApiBaseUrl_(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    // Prevent accidental pastes like /exec?op=get which would break path concatenation.
    return s.split("?")[0].split("#")[0];
  }

  // 2) Theme (UI state only)
  const THEME_KEY = "dash_theme";
  const defaultTheme = "dark";

  // 3) In-memory state
  let state = null; // {version, updatedAt, auth:{pin, trustedDevices:[]}, sections:[]}
  let authenticated = false;
  let pinBuffer = "";
  const SESSION_AUTH_KEY = "snapdeck_auth_session";
  
  let dirty = false;
  let isLoaded = false;
  let statusRevertTimer = null;
  let inactivityTimer = null;
  const INACTIVITY_LIMIT = 60000; // 1 minute

  // 4) Bootstrap helpers
  const bs = {
    sectionModal: null,
    linkModal: null,
    confirmModal: null,
    settingsModal: null,
  };

  // DOM
  const el = {
    statusBar: document.getElementById("statusBar"),
    sectionsRoot: document.getElementById("sectionsRoot"),
    emptyState: document.getElementById("emptyState"),

    btnTheme: document.getElementById("btnTheme"),
    btnSettings: document.getElementById("btnSettings"),
    btnRefresh: document.getElementById("btnRefresh"),
    btnAddSection: document.getElementById("btnAddSection"),
    btnAddSectionEmpty: document.getElementById("btnAddSectionEmpty"),

    modalSection: document.getElementById("modalSection"),
    modalSectionTitle: document.getElementById("modalSectionTitle"),
    formSection: document.getElementById("formSection"),
    sectionId: document.getElementById("sectionId"),
    sectionName: document.getElementById("sectionName"),

    modalLink: document.getElementById("modalLink"),
    modalLinkTitle: document.getElementById("modalLinkTitle"),
    formLink: document.getElementById("formLink"),
    linkSectionId: document.getElementById("linkSectionId"),
    linkId: document.getElementById("linkId"),
    linkName: document.getElementById("linkName"),
    linkUrl: document.getElementById("linkUrl"),

    modalConfirm: document.getElementById("modalConfirm"),
    modalConfirmTitle: document.getElementById("modalConfirmTitle"),
    modalConfirmBody: document.getElementById("modalConfirmBody"),
    btnConfirmDanger: document.getElementById("btnConfirmDanger"),
    btnConfirmCancel: document.getElementById("btnConfirmCancel"),

    // Auth & Security
    authScreen: document.getElementById("authScreen"),
    authSubtitle: document.getElementById("authSubtitle"),
    pinView: document.getElementById("pinView"),
    pinInput: document.getElementById("pinInput"),
    btnBioAuth: document.getElementById("btnBioAuth"),
    btnPinDel: document.getElementById("btnPinDel"),
    setupView: document.getElementById("setupView"),
    setupPin: document.getElementById("setupPin"),
    setupPinConfirm: document.getElementById("setupPinConfirm"),
    btnSaveSetup: document.getElementById("btnSaveSetup"),
    
    modalSettings: document.getElementById("modalSettings"),
    switchTheme: document.getElementById("switchTheme"),
    btnRegisterBio: document.getElementById("btnRegisterBio"),
    btnChangePin: document.getElementById("btnChangePin"),
    btnLockNow: document.getElementById("btnLockNow"),
    deviceCount: document.getElementById("deviceCount"),
    deviceList: document.getElementById("deviceList"),
  };

  const headerUi = {
    greetingLine: document.getElementById("greetingLine"),
    metaSections: document.getElementById("metaSections"),
    metaLinks: document.getElementById("metaLinks"),
  };

  // ----------------------------
  // Utilities
  // ----------------------------

  function nowIso() {
    return new Date().toISOString();
  }

  function uid(prefix) {
    // short, collision-resistant enough for single-user
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function driveIconSvg_() {
    // Simple, brand-adjacent Drive triangle (inline SVG, no external assets).
    return `<svg class="status-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M9.6 3.2h4.8l6 10.4-2.4 4.2H6l-2.4-4.2L9.6 3.2Z" fill="none"/>
      <path d="M9.6 3.2 3.6 13.6 6 17.8h12l2.4-4.2-6-10.4H9.6Z" fill="none"/>
      <path d="M9.6 3.2 3.6 13.6 6 17.8h12l2.4-4.2-6-10.4H9.6Z" fill="currentColor" opacity=".08"/>
      <path d="M9.6 3.2h4.8l6 10.4-2.4 4.2H6l-2.4-4.2L9.6 3.2Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" opacity=".85"/>
      <path d="M3.6 13.6h12.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".65"/>
    </svg>`;
  }

  function formatTime_(d) {
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  function greetingText_() {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return "Good morning, Jaymin";
    if (h >= 12 && h < 17) return "Good afternoon, Jaymin";
    if (h >= 17 && h < 22) return "Good evening, Jaymin";
    return "Hello, Jaymin";
  }

  function haptic(type = "light") {
    if (!navigator.vibrate) return;
    
    const patterns = {
      light: 10,
      medium: 20,
      success: [10, 40, 10],
      error: [50, 40, 50, 40, 80],
      warning: 40
    };

    navigator.vibrate(patterns[type] || type);
  }

  function updateHeaderMeta_() {
    if (headerUi.greetingLine) {
      const greetingTextEl = headerUi.greetingLine.querySelector(".greeting-text");
      if (greetingTextEl) {
        greetingTextEl.textContent = greetingText_();
      } else {
        headerUi.greetingLine.textContent = greetingText_();
      }
    }

    const sections = state && Array.isArray(state.sections) ? state.sections.length : 0;
    const links = state && Array.isArray(state.sections)
      ? state.sections.reduce((sum, s) => sum + ((s && Array.isArray(s.links)) ? s.links.length : 0), 0)
      : 0;

    if (headerUi.metaSections) headerUi.metaSections.textContent = `Sections: ${sections}`;
    if (headerUi.metaLinks) headerUi.metaLinks.textContent = `Links: ${links}`;
  }

  function setStatus(text, meta) {
    const t = String(text || "").trim();
    if (!t) {
      el.statusBar.innerHTML = "";
      return;
    }

    const ts = meta && meta.ts ? String(meta.ts) : "";
    const showDrive = meta && meta.drive === true;
    const variant = meta && meta.variant ? String(meta.variant) : "";
    const label = escapeHtml_(t);
    const time = ts ? `<span class="status-sep" aria-hidden="true">•</span><span class="status-time">${escapeHtml_(ts)}</span>` : "";
    const drive = showDrive ? `<span class="status-drive" title="Google Drive" aria-label="Google Drive">${driveIconSvg_()}</span>` : "";

    el.statusBar.innerHTML = `
      <span class="status-pill" ${variant ? `data-variant="${escapeHtml_(variant)}"` : ""}>
        <span class="status-dot" aria-hidden="true"></span>
        ${drive}
        <span class="status-text">${label}</span>
        ${time}
      </span>`;
  }

  function setConnectedStatus_() {
    setStatus("Synced to Google Drive", {
      drive: true,
      ts: formatTime_(new Date()),
      variant: dirty ? "syncing" : "ok",
    });
  }

  function setTransientStatus_(text, meta, revertMs) {
    if (statusRevertTimer) {
      clearTimeout(statusRevertTimer);
      statusRevertTimer = null;
    }
    setStatus(text, meta);
    const ms = Number.isFinite(revertMs) ? revertMs : 1200;
    statusRevertTimer = setTimeout(() => {
      statusRevertTimer = null;
      setConnectedStatus_();
    }, Math.max(250, ms));
  }

  function escapeHtml_(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function assertApiConfigured() {
    if (!API_BASE_URL) {
      setStatus("Set API_BASE_URL in js/app.js to your Apps Script Web App URL.");
      return false;
    }
    return true;
  }

  function normalizeUrl(raw) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return "";
    // If user omits scheme, do not guess. Keep strict.
    return trimmed;
  }

  function getDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }

  function faviconUrl(url) {
    const domain = getDomain(url);
    if (!domain) return "";
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  }

  function base64ToUint8Array(base64) {
    const binary = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // ----------------------------
  // API
  // ----------------------------

  async function apiRequest(method, path, body) {
    if (!assertApiConfigured()) throw new Error("API not configured");

    const base = normalizeApiBaseUrl_(API_BASE_URL);
    const url = `${base}${path}`;
    const opts = { method };

    console.log(`[API] ${method} ${url}`);

    if (body !== undefined) {
      // Send as text/plain to avoid CORS preflight from static hosts (GitHub Pages).
      // Server still parses JSON from the raw string.
      opts.headers = { "Content-Type": "text/plain;charset=utf-8" };
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg = data && data.error ? data.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }

    // Apps Script Web Apps often return 200 even for app-level failures.
    if (data && typeof data === "object" && data.ok === false) {
      throw new Error(data.error || "Request failed");
    }

    return data;
  }

  async function loadState() {
    setStatus("Loading…");
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) overlay.classList.add("show");
    try {
      const res = await apiRequest("GET", "?op=get", undefined);
      state = res && res.data ? res.data : res;
      
      // Ensure auth object exists
      if (!state.auth) {
        state.auth = { pin: "", trustedDevices: [] };
      }
      
      dirty = false;
      setConnectedStatus_();
      updateHeaderMeta_();
      isLoaded = true;
    } finally {
      if (overlay) overlay.classList.remove("show");
    }
  }

  async function saveState() {
    if (!isLoaded) {
      console.warn("Save aborted: Data not yet loaded from Drive.");
      return;
    }
    if (!state) return;
    state.updatedAt = nowIso();
    dirty = true;

    setTransientStatus_("Syncing to Drive…", { drive: true, ts: formatTime_(new Date()), variant: "syncing" }, 1200);

    // Optimistic UI: we already rendered based on local state.
    try {
      await apiRequest("POST", "?op=save", { data: state });
      dirty = false;
      setTransientStatus_("Synced", { drive: true, ts: formatTime_(new Date()), variant: "ok" }, 1100);
      updateHeaderMeta_();
    } catch (err) {
      dirty = true;
      setTransientStatus_("Sync failed", { drive: true, ts: formatTime_(new Date()), variant: "err" }, 2200);
      throw err;
    }

    setConnectedStatus_();
  }

  // ----------------------------
  // Security Logic
  // ----------------------------

  function checkAuth() {
    if (!state || !state.auth || !state.auth.pin) {
      showSetup();
    } else {
      showLock();
    }
  }

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (authenticated) {
      inactivityTimer = setTimeout(() => {
        console.log("Auto-locking due to inactivity.");
        showLock();
      }, INACTIVITY_LIMIT);
    }
  }

  function showLock() {
    authenticated = false;
    el.authScreen.classList.add("show");
    el.pinView.classList.remove("d-none");
    el.setupView.classList.add("d-none");
    el.authSubtitle.textContent = "Locked for your privacy";
    pinBuffer = "";
    el.pinInput.value = "";
    
    // Auto-trigger biometrics if first device exists
    if (state?.auth?.trustedDevices?.length > 0) {
      authenticateBiometric();
    }
  }

  function showSetup() {
    el.authScreen.classList.add("show");
    el.pinView.classList.add("d-none");
    el.setupView.classList.remove("d-none");
    el.authSubtitle.textContent = "Welcome! Let's get secured.";
  }

  function unlockDashboard() {
    authenticated = true;
    resetInactivityTimer();
    el.authScreen.classList.remove("show");
    render();
  }

  function onPinInput(digit) {
    haptic("light");
    if (pinBuffer.length >= 4) return;
    pinBuffer += digit;
    el.pinInput.value = "•".repeat(pinBuffer.length);
    
    if (pinBuffer.length === 4) {
      verifyPin();
    }
  }

  function onPinDelete() {
    haptic("medium");
    pinBuffer = pinBuffer.slice(0, -1);
    el.pinInput.value = "•".repeat(pinBuffer.length);
  }

  function verifyPin() {
    if (pinBuffer === state.auth.pin) {
      haptic("success");
      unlockDashboard();
    } else {
      haptic("error");
      el.authScreen.classList.add("shake");
      setTimeout(() => el.authScreen.classList.remove("shake"), 400);
      pinBuffer = "";
      el.pinInput.value = "";
    }
  }

  async function onSaveSetup() {
    const p1 = el.setupPin.value;
    const p2 = el.setupPinConfirm.value;
    
    if (p1.length !== 4 || isNaN(p1)) {
      alert("PIN must be 4 digits.");
      return;
    }
    if (p1 !== p2) {
      alert("PINs do not match.");
      return;
    }
    
    if (!state) {
      state = { version: 1, updatedAt: nowIso(), auth: { pin: "", trustedDevices: [] }, sections: [] };
    }
    if (!state.auth) {
      state.auth = { pin: "", trustedDevices: [] };
    }
    // Also ensure sections array exists
    if (!Array.isArray(state.sections)) {
      state.sections = [];
    }
    
    state.auth.pin = p1;
    try {
      await saveState();
      unlockDashboard();
    } catch (err) {
      alert("Failed to save PIN: " + err.message);
    }
  }

  // WebAuthn Biometrics
  async function registerBiometric() {
    if (!window.PublicKeyCredential) {
      alert("Biometrics not supported on this browser.");
      return;
    }

    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    const rpId = window.location.hostname;
    const isIP = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(rpId);

    if (isIP) {
      alert("Biometric Security (Windows Hello/Fingerprint) does not work on IP addresses like 127.0.0.1.\n\nPlease open the app using 'http://localhost:5500' instead of '127.0.0.1'.");
      return;
    }

    const userID = uid("user");
    const options = {
      publicKey: {
        challenge,
        rp: { name: "Snapdeck", id: rpId },
        user: {
          id: Uint8Array.from(userID, c => c.charCodeAt(0)),
          name: "Jaymin",
          displayName: "Jaymin Dattani"
        },
        pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
        authenticatorSelection: { userVerification: "required" },
        timeout: 60000
      }
    };

    try {
      const cred = await navigator.credentials.create(options);
      const newDevice = {
        id: cred.id,
        name: navigator.userAgent.includes("Android") ? "Phone (Samsung)" : "Laptop (Windows Hello)",
        publicKey: bufferToBase64(cred.rawId) // Simplified for single-user
      };
      
      state.auth.trustedDevices.push(newDevice);
      await saveState();
      updateSecurityMeta();
      alert("Device registered successfully!");
    } catch (err) {
      console.error(err);
      alert("Registration failed: " + err.message);
    }
  }

  async function authenticateBiometric() {
    if (!state?.auth?.trustedDevices?.length) return;
    
    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    const options = {
      publicKey: {
        challenge,
        allowCredentials: state.auth.trustedDevices.map(d => ({
          id: base64ToUint8Array(d.id),
          type: "public-key"
        })),
        userVerification: "required",
        timeout: 60000
      }
    };

    try {
      await navigator.credentials.get(options);
      haptic("success");
      unlockDashboard();
    } catch (err) {
      console.warn("Biometric failed or cancelled", err);
    }
  }

  function updateSecurityMeta() {
    const devices = state?.auth?.trustedDevices || [];
    const count = devices.length;
    el.deviceCount.textContent = `${count} trusted device${count === 1 ? "" : "s"} registered`;

    // Render Device List
    if (el.deviceList) {
      el.deviceList.innerHTML = "";
      devices.forEach(d => {
        const item = document.createElement("div");
        item.className = "device-item";
        item.innerHTML = `
          <span>${d.name || "Unknown Device"}</span>
          <button class="btn-remove" title="Remove device">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        `;
        item.querySelector(".btn-remove").addEventListener("click", () => removeDevice(d.id));
        el.deviceList.appendChild(item);
      });
    }
  }

  async function removeDevice(deviceId) {
    if (!confirm("Are you sure you want to remove this trusted device? You will need to use your PIN to log in next time on that device.")) {
      return;
    }

    state.auth.trustedDevices = state.auth.trustedDevices.filter(d => d.id !== deviceId);
    try {
      await saveState();
      updateSecurityMeta();
    } catch (err) {
      alert("Failed to remove device: " + err.message);
    }
  }

  async function pinSection(sectionId) {
    const section = state.sections.find(s => s.id === sectionId);
    if (!section) return;

    const isSelf = section.isPinned;

    if (isSelf) {
      // Unpin it
      section.isPinned = false;
    } else {
      // Check if another section is already pinned
      const alreadyPinned = state.sections.find(s => s.isPinned);
      if (alreadyPinned) {
        const ok = confirm(`"${alreadyPinned.name}" is currently pinned.\n\nUnpin it and pin "${section.name}" instead?`);
        if (!ok) return;
        alreadyPinned.isPinned = false;
      }
      section.isPinned = true;
    }

    render();
    try {
      await saveState();
    } catch (err) {
      alert("Failed to save pin: " + err.message);
    }
  }

  // ----------------------------
  // Rendering
  // ----------------------------

  function render() {
    el.sectionsRoot.innerHTML = "";

    const hasSections = state && Array.isArray(state.sections) && state.sections.length > 0;
    el.emptyState.classList.toggle("d-none", hasSections);

    updateHeaderMeta_();

    if (!hasSections) return;

    // Sort: pinned section first, rest alphabetically
    const sorted = [...state.sections].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const section of sorted) {
      el.sectionsRoot.appendChild(renderSection(section));
    }
  }

  function renderSection(section) {
    const wrap = document.createElement("section");
    wrap.className = "section" + (section.isPinned ? " section--pinned" : "");
    wrap.dataset.sectionId = section.id;

    const header = document.createElement("div");
    header.className = "section-header d-flex align-items-center gap-2";

    const title = document.createElement("h2");
    title.className = "section-title fs-6 me-auto d-flex align-items-center gap-1";
    title.innerHTML = `${section.name}${section.isPinned ? ' <span class="pin-badge" title="Pinned">📌</span>' : ""}`;

    const actions = document.createElement("div");
    actions.className = "section-actions d-flex align-items-center gap-1";

    const btnAdd = document.createElement("button");
    btnAdd.type = "button";
    btnAdd.className = "btn btn-sm btn-outline-secondary";
    btnAdd.textContent = "Add link";
    btnAdd.addEventListener("click", () => openLinkModal("create", section.id));

    const dropdown = document.createElement("div");
    dropdown.className = "dropdown";

    const kebab = document.createElement("button");
    kebab.className = "kebab";
    kebab.type = "button";
    kebab.setAttribute("data-bs-toggle", "dropdown");
    kebab.setAttribute("aria-expanded", "false");
    kebab.setAttribute("aria-label", "Section menu");
    kebab.textContent = "⋮";

    const menu = document.createElement("ul");
    menu.className = "dropdown-menu dropdown-menu-end";

    const miEdit = document.createElement("li");
    miEdit.innerHTML = `<button class="dropdown-item" type="button">Edit section</button>`;
    miEdit.querySelector("button").addEventListener("click", () => openSectionModal("edit", section.id));

    const miPin = document.createElement("li");
    miPin.innerHTML = `<button class="dropdown-item" type="button">${section.isPinned ? "📌 Unpin section" : "📌 Pin section"}</button>`;
    miPin.querySelector("button").addEventListener("click", () => pinSection(section.id));

    const miDelete = document.createElement("li");
    miDelete.innerHTML = `<button class="dropdown-item danger" type="button">Delete section</button>`;
    miDelete.querySelector("button").addEventListener("click", () => confirmDeleteSection(section.id));

    menu.appendChild(miEdit);
    menu.appendChild(miPin);
    menu.appendChild(miDelete);

    dropdown.appendChild(kebab);
    dropdown.appendChild(menu);

    actions.appendChild(btnAdd);
    actions.appendChild(dropdown);

    header.appendChild(title);
    header.appendChild(actions);

    const grid = document.createElement("div");
    grid.className = "shortcut-grid";

    const row = document.createElement("div");
    row.className = "row g-2";

    for (const link of section.links || []) {
      const col = document.createElement("div");
      col.className = "col-12 col-sm-6 col-md-4 col-lg-3";
      col.appendChild(renderShortcut(section.id, link));
      row.appendChild(col);
    }

    grid.appendChild(row);

    wrap.appendChild(header);
    wrap.appendChild(grid);

    return wrap;
  }

  function renderShortcut(sectionId, link) {
    const card = document.createElement("div");
    card.className = "shortcut";
    card.dataset.linkId = link.id;
    // Keyboard affordance (UI-only): allow focus ring on the whole tile.
    card.tabIndex = 0;
    card.setAttribute("role", "link");
    card.setAttribute("aria-label", `${link.name || "Link"} — ${link.url || ""}`.trim());

    const icon = document.createElement("div");
    icon.className = "shortcut-icon";

    const fav = faviconUrl(link.url);
    if (fav) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = fav;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => {
        img.remove();
        icon.appendChild(fallbackLetter(link.name));
      };
      icon.appendChild(img);
    } else {
      icon.appendChild(fallbackLetter(link.name));
    }

    const main = document.createElement("div");
    main.className = "shortcut-main";

    const name = document.createElement("p");
    name.className = "shortcut-name";
    name.textContent = link.name;

    const url = document.createElement("p");
    url.className = "shortcut-url";
    url.textContent = link.url;

    main.appendChild(name);
    main.appendChild(url);

    const dropdown = document.createElement("div");
    dropdown.className = "dropdown";

    const kebab = document.createElement("button");
    kebab.className = "kebab";
    kebab.type = "button";
    kebab.setAttribute("data-bs-toggle", "dropdown");
    kebab.setAttribute("aria-expanded", "false");
    kebab.setAttribute("aria-label", "Link menu");
    kebab.textContent = "⋮";

    const menu = document.createElement("ul");
    menu.className = "dropdown-menu dropdown-menu-end";

    const miEdit = document.createElement("li");
    miEdit.innerHTML = `<button class="dropdown-item" type="button">Edit</button>`;
    miEdit.querySelector("button").addEventListener("click", (e) => {
      e.preventDefault();
      openLinkModal("edit", sectionId, link.id);
    });

    const miDelete = document.createElement("li");
    miDelete.innerHTML = `<button class="dropdown-item danger" type="button">Delete</button>`;
    miDelete.querySelector("button").addEventListener("click", (e) => {
      e.preventDefault();
      confirmDeleteLink(sectionId, link.id);
    });

    menu.appendChild(miEdit);
    menu.appendChild(miDelete);

    dropdown.appendChild(kebab);
    dropdown.appendChild(menu);

    // Click to open new tab: only when clicking main area/icon
    icon.addEventListener("click", () => window.open(link.url, "_blank", "noopener"));
    main.addEventListener("click", () => window.open(link.url, "_blank", "noopener"));

    card.appendChild(icon);
    card.appendChild(main);
    card.appendChild(dropdown);

    return card;
  }

  function fallbackLetter(name) {
    const span = document.createElement("span");
    span.className = "shortcut-fallback";
    const s = (name || "").trim();
    span.textContent = s ? s[0].toUpperCase() : "•";
    return span;
  }

  // ----------------------------
  // Section CRUD
  // ----------------------------

  function openSectionModal(mode, sectionId) {
    el.sectionId.value = "";
    el.sectionName.value = "";

    if (mode === "create") {
      el.modalSectionTitle.textContent = "Add section";
    } else {
      const sec = state.sections.find(s => s.id === sectionId);
      if (!sec) return;
      el.modalSectionTitle.textContent = "Edit section";
      el.sectionId.value = sec.id;
      el.sectionName.value = sec.name;
    }

    bs.sectionModal.show();
    setTimeout(() => el.sectionName.focus(), 50);
  }

  async function onSaveSection(e) {
    e.preventDefault();

    const name = (el.sectionName.value || "").trim();
    if (!name) return;

    const id = (el.sectionId.value || "").trim();

    if (!id) {
      state.sections.push({ id: uid("sec"), name, links: [] });
    } else {
      const sec = state.sections.find(s => s.id === id);
      if (!sec) return;
      sec.name = name;
    }

    bs.sectionModal.hide();
    render();

    try {
      await saveState();
      setStatus("");
    } catch (err) {
      setStatus(`Save failed: ${err.message}`);
      // Keep local state; user can refresh manually.
    }
  }

  function confirmDeleteSection(sectionId) {
    const sec = state.sections.find(s => s.id === sectionId);
    if (!sec) return;

    el.modalConfirmTitle.textContent = "Delete section";
    el.modalConfirmBody.textContent = `Delete “${sec.name}” and all its links?`;

    el.btnConfirmDanger.onclick = async () => {
      bs.confirmModal.hide();
      state.sections = state.sections.filter(s => s.id !== sectionId);
      render();
      try {
        await saveState();
      } catch (err) {
        setStatus(`Save failed: ${err.message}`);
      }
    };

    bs.confirmModal.show();
  }

  // ----------------------------
  // Link CRUD
  // ----------------------------

  function openLinkModal(mode, sectionId, linkId) {
    el.linkSectionId.value = sectionId;
    el.linkId.value = "";
    el.linkName.value = "";
    el.linkUrl.value = "";

    if (mode === "create") {
      el.modalLinkTitle.textContent = "Add link";
    } else {
      const sec = state.sections.find(s => s.id === sectionId);
      const link = sec?.links?.find(l => l.id === linkId);
      if (!link) return;
      el.modalLinkTitle.textContent = "Edit link";
      el.linkId.value = link.id;
      el.linkName.value = link.name;
      el.linkUrl.value = link.url;
    }

    bs.linkModal.show();
    setTimeout(() => el.linkName.focus(), 50);
  }

  async function onSaveLink(e) {
    e.preventDefault();

    const sectionId = (el.linkSectionId.value || "").trim();
    const sec = state.sections.find(s => s.id === sectionId);
    if (!sec) return;

    const name = (el.linkName.value || "").trim();
    const url = normalizeUrl(el.linkUrl.value);

    if (!name || !url) return;

    let parsed;
    try {
      parsed = new URL(url);
      if (!parsed.protocol || !/^https?:$/.test(parsed.protocol)) {
        setStatus("URL must start with http:// or https://");
        return;
      }
    } catch {
      setStatus("Invalid URL");
      return;
    }

    const linkId = (el.linkId.value || "").trim();
    if (!linkId) {
      sec.links = sec.links || [];
      sec.links.push({ id: uid("lnk"), name, url });
    } else {
      const link = sec.links.find(l => l.id === linkId);
      if (!link) return;
      link.name = name;
      link.url = url;
    }

    bs.linkModal.hide();
    render();

    try {
      await saveState();
      setStatus("");
    } catch (err) {
      setStatus(`Save failed: ${err.message}`);
    }
  }

  function confirmDeleteLink(sectionId, linkId) {
    const sec = state.sections.find(s => s.id === sectionId);
    const link = sec?.links?.find(l => l.id === linkId);
    if (!sec || !link) return;

    el.modalConfirmTitle.textContent = "Delete link";
    el.modalConfirmBody.textContent = `Delete “${link.name}”?`;

    el.btnConfirmDanger.onclick = async () => {
      bs.confirmModal.hide();
      sec.links = (sec.links || []).filter(l => l.id !== linkId);
      render();
      try {
        await saveState();
      } catch (err) {
        setStatus(`Save failed: ${err.message}`);
      }
    };

    bs.confirmModal.show();
  }

  // ----------------------------
  // Theme
  // ----------------------------

  function applyTheme(theme) {
    const t = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    // Keep Bootstrap theme aligned (affects dropdown, inputs)
    document.documentElement.setAttribute("data-bs-theme", t);
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved || defaultTheme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || defaultTheme;
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  }

  function openSettings() {
    updateSecurityMeta();
    el.switchTheme.checked = document.documentElement.getAttribute("data-theme") === "dark";
    bs.settingsModal.show();
  }

  function lockNow() {
    bs.settingsModal.hide();
    showLock();
  }

  // ----------------------------
  // Init
  // ----------------------------

  async function init() {
    initTheme();

    if (window.bootstrap) {
      bs.sectionModal = new bootstrap.Modal(el.modalSection, { backdrop: "static" });
      bs.linkModal = new bootstrap.Modal(el.modalLink, { backdrop: "static" });
      bs.confirmModal = new bootstrap.Modal(el.modalConfirm, { backdrop: "static" });
      bs.settingsModal = new bootstrap.Modal(el.modalSettings);
    } else {
      console.error("Bootstrap not found. Modals will not work.");
      setStatus("Error: UI Library (Bootstrap) blocked. Check your connection or tracking blockers.", { variant: "err" });
    }

    if (el.btnTheme) {
      el.btnTheme.addEventListener("click", toggleTheme);
    }
    if (el.btnSettings) {
      el.btnSettings.addEventListener("click", openSettings);
    }

    // Inactivity Tracking
    ["mousemove", "keydown", "scroll", "touchstart"].forEach(evt => {
      window.addEventListener(evt, resetInactivityTimer, { passive: true });
    });
    
    // PIN Pad Digit buttons
    document.querySelectorAll(".pin-btn[data-val]").forEach(btn => {
      btn.addEventListener("click", () => onPinInput(btn.dataset.val));
    });

    // Keyboard Entry for PIN
    window.addEventListener("keydown", (e) => {
      if (authenticated) return; // Don't intercept when unlocked
      
      // Digits 0-9
      if (e.key >= "0" && e.key <= "9") {
        onPinInput(e.key);
      }
      // Backspace
      else if (e.key === "Backspace") {
        onPinDel();
      }
    });
    el.btnPinDel.addEventListener("click", onPinDelete);
    el.btnBioAuth.addEventListener("click", authenticateBiometric);
    el.btnSaveSetup.addEventListener("click", onSaveSetup);

    // Settings
    el.switchTheme.addEventListener("change", toggleTheme);
    el.btnRegisterBio.addEventListener("click", registerBiometric);
    el.btnLockNow.addEventListener("click", lockNow);
    el.btnChangePin.addEventListener("click", () => {
      bs.settingsModal.hide();
      showSetup();
    });

    const openCreateSection = () => {
      if (!state) return;
      openSectionModal("create");
    };

    el.btnAddSection.addEventListener("click", openCreateSection);
    el.btnAddSectionEmpty.addEventListener("click", openCreateSection);

    el.formSection.addEventListener("submit", onSaveSection);
    el.formLink.addEventListener("submit", onSaveLink);

    el.btnRefresh.addEventListener("click", async () => {
      try {
        await loadState();
        render();
      } catch (err) {
        setStatus(`Load failed: ${err.message}`);
      }
    });

    // Load initial state
    try {
      await loadState();
      checkAuth(); // Added auth check
      render();

      if (!assertApiConfigured()) {
        // If API not configured, still allow UI edits but warn.
        // Create local empty state so UI works for layout.
      }
    } catch (err) {
      // If API not configured or unavailable, show empty state.
      setStatus(assertApiConfigured() ? `Load failed: ${err.message}` : el.statusBar.textContent);
      state = { 
        version: 1, 
        updatedAt: nowIso(), 
        auth: { pin: "", trustedDevices: [] },
        sections: [] 
      };
      checkAuth();
      render();
    }

    // Warn user if leaving while changes are pending
    // Intentionally no beforeunload confirmation prompt.
  }

  document.addEventListener("DOMContentLoaded", init);
})();
