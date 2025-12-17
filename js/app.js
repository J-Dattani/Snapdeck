/* Minimal, single-user dashboard.
   Storage: Google Apps Script Web App (Drive JSON file). */

(() => {
  "use strict";

  // 1) CONFIG (you will paste your Apps Script Web App URL here)
  // Example: https://script.google.com/macros/s/AKfycb....../exec
  const API_BASE_URL = "https://script.google.com/macros/s/AKfycbzI4vRvkVhZxrXm7H4U1EbwHcqdc3SbbA-pY6ZwniH-JHZApEJRDQBrnSj2chAEtQv7/exec";

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
  let state = null; // {version, updatedAt, sections:[]}
  let dirty = false;
  let statusRevertTimer = null;

  // 4) Bootstrap helpers
  const bs = {
    sectionModal: null,
    linkModal: null,
    confirmModal: null,
  };

  // DOM
  const el = {
    statusBar: document.getElementById("statusBar"),
    sectionsRoot: document.getElementById("sectionsRoot"),
    emptyState: document.getElementById("emptyState"),

    btnTheme: document.getElementById("btnTheme"),
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

  function updateHeaderMeta_() {
    if (headerUi.greetingLine) headerUi.greetingLine.textContent = greetingText_();

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

  // ----------------------------
  // API
  // ----------------------------

  async function apiRequest(method, path, body) {
    if (!assertApiConfigured()) throw new Error("API not configured");

    const base = normalizeApiBaseUrl_(API_BASE_URL);
    const url = `${base}${path}`;
    const opts = { method };

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
    const res = await apiRequest("GET", "?op=get", undefined);
    state = res && res.data ? res.data : res;
    dirty = false;
    setConnectedStatus_();
    if (overlay) overlay.classList.remove("show");
    updateHeaderMeta_();
  }

  async function saveState() {
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
  // Rendering
  // ----------------------------

  function render() {
    el.sectionsRoot.innerHTML = "";

    const hasSections = state && Array.isArray(state.sections) && state.sections.length > 0;
    el.emptyState.classList.toggle("d-none", hasSections);

    updateHeaderMeta_();

    if (!hasSections) return;

    for (const section of state.sections) {
      el.sectionsRoot.appendChild(renderSection(section));
    }
  }

  function renderSection(section) {
    const wrap = document.createElement("section");
    wrap.className = "section";
    wrap.dataset.sectionId = section.id;

    const header = document.createElement("div");
    header.className = "section-header d-flex align-items-center gap-2";

    const title = document.createElement("h2");
    title.className = "section-title fs-6 me-auto";
    title.textContent = section.name;

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

    const miDelete = document.createElement("li");
    miDelete.innerHTML = `<button class="dropdown-item danger" type="button">Delete section</button>`;
    miDelete.querySelector("button").addEventListener("click", () => confirmDeleteSection(section.id));

    menu.appendChild(miEdit);
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

  // ----------------------------
  // Init
  // ----------------------------

  async function init() {
    initTheme();

    bs.sectionModal = new bootstrap.Modal(el.modalSection, { backdrop: "static" });
    bs.linkModal = new bootstrap.Modal(el.modalLink, { backdrop: "static" });
    bs.confirmModal = new bootstrap.Modal(el.modalConfirm, { backdrop: "static" });

    el.btnTheme.addEventListener("click", toggleTheme);

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
      render();

      if (!assertApiConfigured()) {
        // If API not configured, still allow UI edits but warn.
        // Create local empty state so UI works for layout.
      }
    } catch (err) {
      // If API not configured or unavailable, show empty state.
      setStatus(assertApiConfigured() ? `Load failed: ${err.message}` : el.statusBar.textContent);
      state = { version: 1, updatedAt: nowIso(), sections: [] };
      render();
    }

    // Warn user if leaving while changes are pending
    // Intentionally no beforeunload confirmation prompt.
  }

  document.addEventListener("DOMContentLoaded", init);
})();
