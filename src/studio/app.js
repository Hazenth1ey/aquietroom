/* =========================================================
   a quiet room — Studio
   A custom back office. Signs in with the existing GitHub
   OAuth worker, then reads/writes Markdown posts straight
   through the GitHub Contents API. No backend, no database.
   ========================================================= */
(function () {
  "use strict";

  const CONFIG = {
    repo: "Hazenth1ey/aquietroom",
    branch: "main",
    postsDir: "src/journal/posts",
    uploadsDir: "src/uploads",
    soundtrackPath: "src/_data/soundtrack.json",
    pagesPath: "src/_data/sitepages.json",
    aboutPath: "src/_data/about.json",
    journalPath: "src/_data/journal.json",
    projectsPath: "src/_data/projects.json",
    sitePath: "src/_data/site.json",
    authBase: "https://aquietroom-auth.ivankolly.workers.dev",
  };
  const TOKEN_KEY = "qr_studio_token";
  // slugs the site already owns — a page can't take these addresses
  const RESERVED_SLUGS = ["home", "journal", "projects", "about", "studio", "admin", "css", "js", "audio", "uploads", "feed.xml", "sitemap.xml", "404"];

  const state = {
    token: null, file: null, sha: null, cover: "", editor: null,
    sound: { sha: null, tracks: [] },
    pages: { sha: null, list: [], editing: null, draft: null },
  };

  const $ = (sel) => document.querySelector(sel);

  /* ---------------- utilities ---------------- */
  const b64encode = (str) => btoa(unescape(encodeURIComponent(str)));
  const b64decode = (b64) => decodeURIComponent(escape(atob(String(b64).replace(/\n/g, ""))));
  const todayISO = () => new Date().toISOString().slice(0, 10);

  function slugify(s) {
    return (
      String(s || "")
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80) || "untitled"
    );
  }

  function toast(msg, isErr) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "toast" + (isErr ? " err" : "");
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.hidden = true), 3200);
  }

  function setStatus(msg, cls) {
    const el = $("#save-status");
    el.textContent = msg || "";
    el.className = "save-status" + (cls ? " " + cls : "");
  }

  function parseFrontMatter(text) {
    const m = String(text).match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!m) return { data: {}, body: String(text) };
    let data = {};
    try { data = window.jsyaml.load(m[1]) || {}; } catch (e) { data = {}; }
    return { data, body: m[2] };
  }

  function buildFrontMatter(data) {
    const clean = {};
    Object.keys(data).forEach((k) => {
      const v = data[k];
      if (v === "" || v == null) return;
      if (Array.isArray(v) && v.length === 0) return;
      clean[k] = v;
    });
    const yaml = window.jsyaml.dump(clean, { lineWidth: -1 }).trim();
    return "---\n" + yaml + "\n---\n\n";
  }

  /* ---------------- GitHub API ---------------- */
  async function gh(path, options) {
    options = options || {};
    const res = await fetch("https://api.github.com" + path, {
      ...options,
      headers: {
        Authorization: "token " + state.token,
        Accept: "application/vnd.github+json",
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      logout();
      throw new Error("Session expired — please sign in again.");
    }
    return res;
  }

  async function getUser() {
    const res = await gh("/user");
    if (!res.ok) throw new Error("Could not load your GitHub account.");
    return res.json();
  }

  async function listFiles() {
    const res = await gh(
      `/repos/${CONFIG.repo}/contents/${CONFIG.postsDir}?ref=${CONFIG.branch}`
    );
    if (!res.ok) return [];
    const files = await res.json();
    return files.filter((f) => f.type === "file" && f.name.endsWith(".md"));
  }

  async function getFile(path) {
    const res = await gh(`/repos/${CONFIG.repo}/contents/${path}?ref=${CONFIG.branch}`);
    if (!res.ok) throw new Error("Could not open that entry.");
    const json = await res.json();
    return { sha: json.sha, raw: b64decode(json.content) };
  }

  // Returns the sha of an existing file, or null if it doesn't exist.
  async function shaOf(path) {
    const res = await gh(`/repos/${CONFIG.repo}/contents/${path}?ref=${CONFIG.branch}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const json = await res.json();
    return json.sha;
  }

  async function putFile(path, contentStr, message, sha) {
    const body = {
      message,
      content: b64encode(contentStr),
      branch: CONFIG.branch,
    };
    if (sha) body.sha = sha;
    const res = await gh(`/repos/${CONFIG.repo}/contents/${path}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Save failed.");
    }
    return res.json();
  }

  async function deleteFile(path, sha, message) {
    const res = await gh(`/repos/${CONFIG.repo}/contents/${path}`, {
      method: "DELETE",
      body: JSON.stringify({ message, sha, branch: CONFIG.branch }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Delete failed.");
    }
    return res.json();
  }

  /* ---------------- auth ---------------- */
  function login() {
    $("#login-error").hidden = true;
    const w = 620, h = 720;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const authOrigin = new URL(CONFIG.authBase).origin;
    const popup = window.open(
      `${CONFIG.authBase}/auth?provider=github&scope=repo&site_id=${location.hostname}`,
      "qr-oauth",
      `width=${w},height=${h},left=${left},top=${top}`
    );
    if (!popup) {
      loginError("Please allow pop-ups for this site, then try again.");
      return;
    }

    function receive(e) {
      if (!e.data || typeof e.data !== "string") return;
      if (e.data === "authorizing:github") {
        // Handshake: reply so the worker sends the token.
        popup.postMessage(e.data, authOrigin);
        return;
      }
      const okPrefix = "authorization:github:success:";
      const errPrefix = "authorization:github:error:";
      if (e.data.indexOf(okPrefix) === 0) {
        cleanup();
        let payload = {};
        try { payload = JSON.parse(e.data.slice(okPrefix.length)); } catch (x) {}
        if (payload.token) finishLogin(payload.token);
        else loginError("No token received. Please try again.");
      } else if (e.data.indexOf(errPrefix) === 0) {
        cleanup();
        loginError(e.data.slice(errPrefix.length) || "Sign-in failed.");
      }
    }
    function cleanup() {
      window.removeEventListener("message", receive);
      try { popup.close(); } catch (x) {}
    }
    window.addEventListener("message", receive);
  }

  function loginError(msg) {
    const el = $("#login-error");
    el.textContent = msg;
    el.hidden = false;
  }

  async function finishLogin(token) {
    state.token = token;
    localStorage.setItem(TOKEN_KEY, token);
    await start();
  }

  function logout() {
    state.token = null;
    localStorage.removeItem(TOKEN_KEY);
    $("#app").hidden = true;
    $("#login").hidden = false;
  }

  /* ---------------- views ---------------- */
  function switchView(name) {
    document.querySelectorAll(".nav-item").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.view === name)
    );
    $("#view-write").hidden = name !== "write";
    $("#view-list").hidden = name !== "list";
    $("#view-sound").hidden = name !== "sound";
    $("#view-pages").hidden = name !== "pages";
    $("#crumb").textContent =
      name === "list" ? "My content"
      : name === "sound" ? "Soundtrack"
      : name === "pages" ? "Pages"
      : "Write";
    if (name === "write") { resizeEditor(); syncFieldHeights(); }
    if (name === "list") renderList();
    if (name === "sound") loadSoundtrack();
    if (name === "pages") { showPagesList(); loadPages(); }
  }

  /* ---------------- soundtrack ---------------- */
  async function loadSoundtrack() {
    const box = $("#track-list");
    box.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const sha = await shaOf(CONFIG.soundtrackPath);
      if (sha) {
        const { raw } = await getFile(CONFIG.soundtrackPath);
        const data = JSON.parse(raw || "{}");
        state.sound.sha = sha;
        state.sound.tracks = Array.isArray(data.tracks) ? data.tracks : [];
      } else {
        state.sound.sha = null;
        state.sound.tracks = [];
      }
      renderTracks();
    } catch (e) {
      box.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
    }
  }

  // Reorder a track and re-render; play order is the list order.
  function moveTrack(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.sound.tracks.length) return;
    const t = state.sound.tracks.splice(i, 1)[0];
    state.sound.tracks.splice(j, 0, t);
    renderTracks();
  }

  function renderTracks() {
    const box = $("#track-list");
    if (!state.sound.tracks.length) {
      box.innerHTML = '<p class="muted">No tracks yet. Add one to give the room a sound.</p>';
      return;
    }
    box.innerHTML = "";
    const chevron = (dir) =>
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${dir < 0 ? "M5 14.5 12 8l7 6.5" : "M5 9.5 12 16l7-6.5"}"/></svg>`;
    state.sound.tracks.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "track-row";
      row.innerHTML =
        `<span class="track-ord">${i + 1}</span>` +
        `<input class="track-title" value="${escapeHtml(t.title || "")}" placeholder="Track title" />` +
        `<span class="track-src" title="${escapeHtml(t.src || "")}">${escapeHtml((t.src || "").split("/").pop())}</span>` +
        `<span class="track-move">` +
        `<button type="button" class="tr-up" title="Move up" aria-label="Move up"${i === 0 ? " disabled" : ""}>${chevron(-1)}</button>` +
        `<button type="button" class="tr-down" title="Move down" aria-label="Move down"${i === state.sound.tracks.length - 1 ? " disabled" : ""}>${chevron(1)}</button>` +
        `</span>` +
        `<button class="pr-del" title="Remove">✕</button>`;
      row.querySelector(".track-title").addEventListener("input", (e) => {
        state.sound.tracks[i].title = e.target.value;
      });
      row.querySelector(".tr-up").addEventListener("click", () => moveTrack(i, -1));
      row.querySelector(".tr-down").addEventListener("click", () => moveTrack(i, 1));
      row.querySelector(".pr-del").addEventListener("click", () => {
        state.sound.tracks.splice(i, 1);
        renderTracks();
      });
      box.appendChild(row);
    });
  }

  async function addTrack(file) {
    try {
      setStatus("Uploading track…");
      const ext = (file.name.split(".").pop() || "mp3").toLowerCase();
      const base = slugify(file.name.replace(/\.[^.]+$/, ""));
      const name = `${Date.now()}-${base}.${ext}`;
      const path = `${CONFIG.uploadsDir}/${name}`;
      const b64 = await fileToB64(file);
      const res = await gh(`/repos/${CONFIG.repo}/contents/${path}`, {
        method: "PUT",
        body: JSON.stringify({ message: `Upload track ${name}`, content: b64, branch: CONFIG.branch }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Upload failed.");
      }
      const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
      state.sound.tracks.push({ title: title || name, src: `/uploads/${name}` });
      renderTracks();
      setStatus("Track added — remember to Save", "ok");
      toast("Track uploaded. Click Save soundtrack to publish.");
    } catch (e) {
      setStatus("");
      toast(e.message, true);
    }
  }

  async function saveSoundtrack() {
    try {
      setStatus("Saving…");
      $("#track-save").disabled = true;
      const content = JSON.stringify({ tracks: state.sound.tracks }, null, 2) + "\n";
      const res = await putFile(
        CONFIG.soundtrackPath,
        content,
        "Update soundtrack",
        state.sound.sha
      );
      state.sound.sha = res.content && res.content.sha;
      setStatus("Saved", "ok");
      toast("Soundtrack saved — live in about a minute.");
    } catch (e) {
      setStatus("Save failed", "err");
      toast(e.message, true);
    } finally {
      $("#track-save").disabled = false;
    }
  }

  /* ---------------- pages (block builder) ---------------- */
  const BLOCK_LABELS = { hero: "Hero", prose: "Prose", image: "Image", quote: "Quote", divider: "Divider" };

  function showPagesList() {
    $("#pages-list-card").hidden = false;
    $("#page-editor").hidden = true;
    $("#core-editor").hidden = true;
    state.pages.editing = null;
    state.pages.draft = null;
  }

  async function loadPages() {
    const box = $("#pages-list");
    box.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const sha = await shaOf(CONFIG.pagesPath);
      if (sha) {
        const { raw } = await getFile(CONFIG.pagesPath);
        state.pages.sha = sha;
        const data = JSON.parse(raw || "[]");
        state.pages.list = Array.isArray(data) ? data : [];
      } else {
        state.pages.sha = null;
        state.pages.list = [];
      }
      renderPagesList();
    } catch (e) {
      box.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
    }
  }

  function renderPagesList() {
    const box = $("#pages-list");
    box.innerHTML = "";

    // Core pages — always present, editable, never deletable.
    const CORE = [
      { key: "journal", title: "Journal", meta: "/journal/ · page header — entries live in My content" },
      { key: "projects", title: "Projects", meta: "/projects/ · intro + project cards" },
      { key: "about", title: "About", meta: "/about/ · who keeps this room" },
      { key: "site", title: "Site identity", meta: "browser-tab icon · studio logo" },
    ];
    CORE.forEach((c) => {
      const row = document.createElement("div");
      row.className = "post-row";
      row.innerHTML =
        `<div class="pr-main"><h4>${c.title}<span class="badge">core</span></h4>` +
        `<div class="pr-meta">${c.meta}</div></div>`;
      row.querySelector(".pr-main").addEventListener("click", () => openCore(c.key));
      box.appendChild(row);
    });

    if (!state.pages.list.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.style.padding = "1rem 0.4rem 0";
      p.textContent = "No custom pages yet. Create one and it appears on the site at its own address.";
      box.appendChild(p);
      return;
    }
    state.pages.list.forEach((pg, i) => {
      const row = document.createElement("div");
      row.className = "post-row";
      row.innerHTML =
        `<div class="pr-main"><h4>${escapeHtml(pg.title || "Untitled")}` +
        (pg.nav ? '<span class="badge">in navigation</span>' : "") +
        `</h4><div class="pr-meta">/${escapeHtml(pg.slug || "")}/ · ${(pg.blocks || []).length} block${(pg.blocks || []).length === 1 ? "" : "s"}</div></div>` +
        `<button class="pr-del" title="Delete">✕</button>`;
      row.querySelector(".pr-main").addEventListener("click", () => openPageEditor(i));
      row.querySelector(".pr-del").addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (!confirm(`Delete the page “${pg.title}”? Its address /${pg.slug}/ will stop working.`)) return;
        state.pages.list.splice(i, 1);
        await savePagesFile(`Delete page: ${pg.title}`);
        renderPagesList();
      });
      box.appendChild(row);
    });
  }

  function openPageEditor(index) {
    state.pages.editing = index;
    state.pages.draft =
      index == null
        ? { title: "", slug: "", description: "", nav: false, blocks: [{ type: "hero", eyebrow: "", heading: "", lede: "" }] }
        : JSON.parse(JSON.stringify(state.pages.list[index]));
    $("#pages-list-card").hidden = true;
    $("#core-editor").hidden = true;
    $("#page-editor").hidden = false;
    $("#pg-title").value = state.pages.draft.title || "";
    $("#pg-slug").value = state.pages.draft.slug || "";
    if (index == null) delete $("#pg-slug").dataset.touched;
    else $("#pg-slug").dataset.touched = "1";
    $("#pg-desc").value = state.pages.draft.description || "";
    $("#pg-nav").checked = !!state.pages.draft.nav;
    $("#pg-delete").hidden = index == null;
    renderBlocks();
    if (index == null) $("#pg-title").focus();
  }

  function blockField(labelText, value, oninput, textarea) {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const span = document.createElement("span");
    span.textContent = labelText;
    const input = document.createElement(textarea ? "textarea" : "input");
    input.value = value || "";
    if (textarea) input.rows = 6;
    input.addEventListener("input", (e) => oninput(e.target.value));
    wrap.appendChild(span);
    wrap.appendChild(input);
    return wrap;
  }

  function renderBlocks() {
    const box = $("#pg-blocks");
    box.innerHTML = "";
    const blocks = state.pages.draft.blocks;
    blocks.forEach((b, i) => {
      const card = document.createElement("div");
      card.className = "card block-card";
      const head = document.createElement("div");
      head.className = "block-head";
      head.innerHTML =
        `<span class="block-type">${BLOCK_LABELS[b.type] || b.type}</span>` +
        `<span class="block-tools">` +
        `<button class="blk-btn" data-act="up" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>` +
        `<button class="blk-btn" data-act="down" title="Move down" ${i === blocks.length - 1 ? "disabled" : ""}>↓</button>` +
        `<button class="blk-btn blk-del" data-act="del" title="Remove">✕</button>` +
        `</span>`;
      head.querySelectorAll(".blk-btn").forEach((btn) =>
        btn.addEventListener("click", () => {
          const act = btn.dataset.act;
          if (act === "del") blocks.splice(i, 1);
          if (act === "up" && i > 0) blocks.splice(i - 1, 0, blocks.splice(i, 1)[0]);
          if (act === "down" && i < blocks.length - 1) blocks.splice(i + 1, 0, blocks.splice(i, 1)[0]);
          renderBlocks();
        })
      );
      card.appendChild(head);

      if (b.type === "hero") {
        card.appendChild(blockField("Eyebrow (small label, optional)", b.eyebrow, (v) => (b.eyebrow = v)));
        card.appendChild(blockField("Heading", b.heading, (v) => (b.heading = v)));
        card.appendChild(blockField("Lede (optional)", b.lede, (v) => (b.lede = v)));
      } else if (b.type === "prose") {
        card.appendChild(blockField("Text (Markdown)", b.body, (v) => (b.body = v), true));
      } else if (b.type === "image") {
        const preview = document.createElement("img");
        preview.className = "cover-preview";
        preview.hidden = !b.src;
        if (b.src) preview.src = b.src;
        card.appendChild(preview);
        const pick = document.createElement("button");
        pick.className = "btn btn-soft";
        pick.textContent = b.src ? "Replace image" : "Choose image";
        const file = document.createElement("input");
        file.type = "file";
        file.accept = "image/*";
        file.hidden = true;
        pick.addEventListener("click", () => file.click());
        file.addEventListener("change", async (e) => {
          if (!e.target.files || !e.target.files[0]) return;
          const url = await uploadAsset(e.target.files[0], "image");
          if (url) { b.src = url; renderBlocks(); }
          e.target.value = "";
        });
        card.appendChild(pick);
        card.appendChild(file);
        card.appendChild(blockField("Caption (optional)", b.caption, (v) => (b.caption = v)));
      } else if (b.type === "quote") {
        card.appendChild(blockField("Quote", b.text, (v) => (b.text = v), true));
        card.appendChild(blockField("Attribution (optional)", b.attribution, (v) => (b.attribution = v)));
      }
      // divider: no fields

      box.appendChild(card);
    });
    if (!blocks.length) box.innerHTML = '<p class="muted" style="padding: 0 0.3rem;">No blocks yet — add one below.</p>';
  }

  /* ---- core page editors (About / Projects) ---- */
  const ICONS = ["email", "github", "twitter", "instagram", "linkedin", "facebook", "rss", "link"];
  const core = { kind: null, sha: null, data: null };

  async function openCore(kind) {
    const box = $("#core-editor");
    $("#pages-list-card").hidden = true;
    $("#page-editor").hidden = true;
    box.hidden = false;
    box.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
    const path =
      kind === "about" ? CONFIG.aboutPath
      : kind === "site" ? CONFIG.sitePath
      : kind === "journal" ? CONFIG.journalPath
      : CONFIG.projectsPath;
    try {
      const sha = await shaOf(path);
      core.kind = kind;
      core.sha = sha;
      if (sha) {
        const { raw } = await getFile(path);
        core.data = JSON.parse(raw || "{}");
      } else {
        core.data = {};
      }
      if (kind === "about") renderCoreAbout();
      else if (kind === "site") renderCoreSite();
      else if (kind === "journal") renderCoreJournal();
      else renderCoreProjects();
    } catch (e) {
      box.innerHTML = `<div class="card"><p class="muted">${escapeHtml(e.message)}</p></div>`;
    }
  }

  function coreShell(title, bodyEl) {
    const box = $("#core-editor");
    box.innerHTML = "";
    const card = document.createElement("div");
    card.className = "card";
    const head = document.createElement("div");
    head.className = "list-head";
    head.innerHTML = `<h3 class="panel-title">${title}<span class="badge">core</span></h3>`;
    card.appendChild(head);
    card.appendChild(bodyEl);
    box.appendChild(card);

    const actions = document.createElement("div");
    actions.className = "card publish-card";
    actions.style.marginTop = "1.3rem";
    const save = document.createElement("button");
    save.className = "btn btn-primary btn-block";
    save.id = "core-save";
    save.textContent = "Publish changes";
    save.addEventListener("click", saveCore);
    const back = document.createElement("button");
    back.className = "btn btn-soft btn-block";
    back.textContent = "← All pages";
    back.addEventListener("click", () => { showPagesList(); renderPagesList(); });
    actions.appendChild(save);
    actions.appendChild(back);
    box.appendChild(actions);
  }

  function renderCoreAbout() {
    const d = core.data;
    d.links = Array.isArray(d.links) ? d.links : [];
    const body = document.createElement("div");
    body.appendChild(blockField("Eyebrow (small label)", d.eyebrow, (v) => (d.eyebrow = v)));
    body.appendChild(blockField("Heading", d.heading, (v) => (d.heading = v)));
    body.appendChild(blockField("Lede (opening line)", d.lede, (v) => (d.lede = v), true));
    body.appendChild(blockField("Body (Markdown)", d.body, (v) => (d.body = v), true));
    body.appendChild(blockField("Links heading (optional)", d.links_heading, (v) => (d.links_heading = v)));
    body.appendChild(blockField("Links intro (optional)", d.links_intro, (v) => (d.links_intro = v)));

    const label = document.createElement("span");
    label.className = "field-label";
    label.textContent = "Links";
    body.appendChild(label);
    const linksBox = document.createElement("div");
    body.appendChild(linksBox);

    function renderLinks() {
      linksBox.innerHTML = "";
      d.links.forEach((l, i) => {
        const row = document.createElement("div");
        row.className = "track-row";
        const lab = document.createElement("input");
        lab.className = "track-title";
        lab.placeholder = "label";
        lab.value = l.label || "";
        lab.addEventListener("input", (e) => (l.label = e.target.value));
        const url = document.createElement("input");
        url.className = "track-title";
        url.placeholder = "https://… or mailto:…";
        url.value = l.url || "";
        url.addEventListener("input", (e) => (l.url = e.target.value));
        const icon = document.createElement("select");
        icon.className = "core-select";
        ICONS.forEach((ic) => {
          const o = document.createElement("option");
          o.value = ic;
          o.textContent = ic;
          if ((l.icon || "link") === ic) o.selected = true;
          icon.appendChild(o);
        });
        icon.addEventListener("change", (e) => (l.icon = e.target.value));
        const del = document.createElement("button");
        del.className = "pr-del";
        del.title = "Remove";
        del.textContent = "✕";
        del.addEventListener("click", () => { d.links.splice(i, 1); renderLinks(); });
        row.appendChild(lab);
        row.appendChild(url);
        row.appendChild(icon);
        row.appendChild(del);
        linksBox.appendChild(row);
      });
      const add = document.createElement("button");
      add.className = "btn btn-soft";
      add.style.marginTop = "0.8rem";
      add.textContent = "＋ Add link";
      add.addEventListener("click", () => { d.links.push({ label: "", url: "", icon: "link" }); renderLinks(); });
      linksBox.appendChild(add);
    }
    renderLinks();
    coreShell("About page", body);
  }

  function renderCoreJournal() {
    const d = core.data;
    const body = document.createElement("div");
    body.appendChild(blockField("Eyebrow (small label)", d.eyebrow, (v) => (d.eyebrow = v)));
    body.appendChild(blockField("Heading", d.heading, (v) => (d.heading = v)));
    body.appendChild(blockField("Lede (opening line)", d.lede, (v) => (d.lede = v), true));

    const note = document.createElement("p");
    note.className = "muted";
    note.style.margin = "0.4rem 0 0.9rem";
    note.textContent = "This is the journal page's header. The entries below it are written in the studio:";
    body.appendChild(note);
    const jump = document.createElement("button");
    jump.className = "btn btn-soft";
    jump.textContent = "▤ Open My content";
    jump.addEventListener("click", () => switchView("list"));
    body.appendChild(jump);

    coreShell("Journal page", body);
  }

  // Reusable image-set editor: thumbnails + captions + reorder + multi-upload.
  // Mutates `arr` ({src, caption} entries) in place.
  function galleryEditor(arr) {
    const grid = document.createElement("div");
    grid.className = "gallery-grid";

    function render() {
      grid.innerHTML = "";
      arr.forEach((g, i) => {
        const cell = document.createElement("div");
        cell.className = "gallery-cell";
        const img = document.createElement("img");
        img.src = g.src;
        img.alt = "";
        cell.appendChild(img);
        const cap = document.createElement("input");
        cap.placeholder = "caption (optional)";
        cap.value = g.caption || "";
        cap.className = "gallery-cap";
        cap.addEventListener("input", (e) => (g.caption = e.target.value));
        cell.appendChild(cap);
        const tools = document.createElement("div");
        tools.className = "gallery-tools";
        [["←", () => { if (i > 0) { arr.splice(i - 1, 0, arr.splice(i, 1)[0]); render(); } }],
         ["→", () => { if (i < arr.length - 1) { arr.splice(i + 1, 0, arr.splice(i, 1)[0]); render(); } }],
         ["✕", () => { if (confirm("Remove this image?")) { arr.splice(i, 1); render(); } }]]
          .forEach(([txt, fn]) => {
            const b = document.createElement("button");
            b.className = "blk-btn" + (txt === "✕" ? " blk-del" : "");
            b.textContent = txt;
            b.addEventListener("click", fn);
            tools.appendChild(b);
          });
        cell.appendChild(tools);
        grid.appendChild(cell);
      });

      const addWrap = document.createElement("div");
      addWrap.className = "gallery-cell gallery-add";
      const add = document.createElement("button");
      add.className = "btn btn-soft";
      add.textContent = "＋ Add images";
      const file = document.createElement("input");
      file.type = "file";
      file.accept = "image/*";
      file.multiple = true;
      file.hidden = true;
      add.addEventListener("click", () => file.click());
      file.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        for (const f of files) {
          const url = await uploadAsset(f, "image");
          if (url) arr.push({ src: url, caption: "" });
        }
        render();
        if (files.length) toast(`${files.length} image${files.length > 1 ? "s" : ""} added — remember to Publish changes.`);
        e.target.value = "";
      });
      addWrap.appendChild(add);
      addWrap.appendChild(file);
      grid.appendChild(addWrap);
    }
    render();
    return grid;
  }

  function renderCoreProjects() {
    const d = core.data;
    d.items = Array.isArray(d.items) ? d.items : [];
    d.gallery = Array.isArray(d.gallery) ? d.gallery : [];
    const body = document.createElement("div");
    body.appendChild(blockField("Intro (the italic line under the heading)", d.intro, (v) => (d.intro = v), true));

    /* ---- portfolio gallery ---- */
    const gLabel = document.createElement("span");
    gLabel.className = "field-label";
    gLabel.textContent = "Portfolio gallery (masonry grid; click to view large)";
    body.appendChild(gLabel);
    body.appendChild(galleryEditor(d.gallery));

    const label = document.createElement("span");
    label.className = "field-label";
    label.style.marginTop = "1.4rem";
    label.textContent = "Projects";
    body.appendChild(label);
    const itemsBox = document.createElement("div");
    body.appendChild(itemsBox);

    function renderItems() {
      itemsBox.innerHTML = "";
      d.items.forEach((it, i) => {
        const card = document.createElement("div");
        card.className = "card block-card";
        const head = document.createElement("div");
        head.className = "block-head";
        head.innerHTML =
          `<span class="block-type">${escapeHtml(it.title || "Project")}</span>` +
          `<span class="block-tools">` +
          `<button class="blk-btn" data-act="up" ${i === 0 ? "disabled" : ""}>↑</button>` +
          `<button class="blk-btn" data-act="down" ${i === d.items.length - 1 ? "disabled" : ""}>↓</button>` +
          `<button class="blk-btn blk-del" data-act="del">✕</button></span>`;
        head.querySelectorAll(".blk-btn").forEach((btn) =>
          btn.addEventListener("click", () => {
            const act = btn.dataset.act;
            if (act === "del") { if (confirm("Remove this project card?")) d.items.splice(i, 1); }
            if (act === "up" && i > 0) d.items.splice(i - 1, 0, d.items.splice(i, 1)[0]);
            if (act === "down" && i < d.items.length - 1) d.items.splice(i + 1, 0, d.items.splice(i, 1)[0]);
            renderItems();
          })
        );
        card.appendChild(head);
        card.appendChild(blockField("Title", it.title, (v) => (it.title = v)));
        card.appendChild(blockField("Year (optional)", it.year, (v) => (it.year = v)));
        card.appendChild(blockField("Description", it.description, (v) => (it.description = v), true));
        card.appendChild(blockField("Tags (comma separated)", (it.tags || []).join(", "), (v) => (it.tags = v.split(",").map((t) => t.trim()).filter(Boolean))));
        card.appendChild(blockField("Link (optional)", it.url, (v) => (it.url = v)));
        it.images = Array.isArray(it.images) ? it.images : [];
        const imLabel = document.createElement("span");
        imLabel.className = "field-label";
        imLabel.textContent = "Images (shown on this project's card)";
        card.appendChild(imLabel);
        card.appendChild(galleryEditor(it.images));
        itemsBox.appendChild(card);
      });
      const add = document.createElement("button");
      add.className = "btn btn-soft";
      add.textContent = "＋ Add project";
      add.addEventListener("click", () => { d.items.push({ title: "", year: "", description: "", tags: [], url: "" }); renderItems(); });
      itemsBox.appendChild(add);
    }
    renderItems();
    coreShell("Projects page", body);
  }

  // Apply the identity to the studio chrome: favicon → tab icon,
  // studioLogo → the sidebar/login marks (empty = the default ✦ orb).
  function applyBrand(data) {
    if (!data) return;
    const link = document.querySelector('link[rel="icon"]');
    if (link && data.favicon) link.href = data.favicon;
    const touch = document.querySelector('link[rel="apple-touch-icon"]');
    if (touch && data.touchIcon) touch.href = data.touchIcon;
    document.querySelectorAll(".brand-mark, .login-mark").forEach((el) => {
      el.innerHTML = data.studioLogo
        ? '<img src="' + data.studioLogo + '" alt="" />'
        : "✦";
    });
  }

  function renderCoreSite() {
    const d = core.data;
    const body = document.createElement("div");

    // One reusable section: label + hint + preview + choose/restore.
    function identSection(labelText, hintText, getUrl, setUrl, restoreText, restoreValue, emptyMark, uploadKind) {
      const label = document.createElement("span");
      label.className = "field-label";
      label.textContent = labelText;
      body.appendChild(label);

      const hint = document.createElement("p");
      hint.className = "muted";
      hint.style.margin = "-0.3rem 0 0.9rem";
      hint.textContent = hintText;
      body.appendChild(hint);

      const preview = document.createElement("div");
      function paint() {
        const url = getUrl();
        if (url) {
          preview.innerHTML = '<img class="logo-preview" src="' + url + '" alt="" />';
        } else {
          preview.innerHTML = '<div class="logo-preview logo-preview--mark">' + (emptyMark || "✦") + "</div>";
        }
      }
      paint();
      body.appendChild(preview);

      const row = document.createElement("div");
      row.style.cssText = "display:flex; gap:0.75rem; margin:1rem 0 1.8rem; flex-wrap:wrap; align-items:center;";
      const pick = document.createElement("button");
      pick.className = "btn btn-soft";
      pick.textContent = "Choose image";
      const file = document.createElement("input");
      file.type = "file";
      file.accept = "image/svg+xml,image/png,image/jpeg,image/webp,image/x-icon";
      file.hidden = true;
      pick.addEventListener("click", () => file.click());
      file.addEventListener("change", async (e) => {
        if (!e.target.files || !e.target.files[0]) return;
        const url = await uploadAsset(e.target.files[0], uploadKind || "logo");
        if (url) {
          setUrl(url);
          paint();
          toast("Image uploaded — click Publish changes to make it live.");
        }
        e.target.value = "";
      });
      const reset = document.createElement("button");
      reset.className = "btn btn-link";
      reset.textContent = restoreText;
      reset.addEventListener("click", () => { setUrl(restoreValue); paint(); });
      row.appendChild(pick);
      row.appendChild(file);
      row.appendChild(reset);
      body.appendChild(row);
    }

    identSection(
      "Browser tab icon",
      "The favicon shown in browser tabs — for the site and the studio. Square SVG or PNG, ideally 128px or larger.",
      () => d.favicon,
      (v) => (d.favicon = v),
      "Restore the moon",
      "/favicon.svg"
    );

    identSection(
      "Studio logo",
      "The mark shown in the studio's sidebar and sign-in screen. Leave it on the default ✦ orb, or use your own.",
      () => d.studioLogo,
      (v) => (d.studioLogo = v),
      "Restore the ✦ orb",
      "",
      "✦"
    );

    identSection(
      "Home Screen icon",
      "Shown when someone saves the site to their phone's Home Screen. Square image, 360px or larger — the phone rounds the corners itself. Saved as PNG.",
      () => d.touchIcon,
      (v) => (d.touchIcon = v),
      "Restore the glowing star",
      "",
      "✦",
      "icon"
    );

    coreShell("Site identity", body);
  }

  async function saveCore() {
    const path =
      core.kind === "about" ? CONFIG.aboutPath
      : core.kind === "site" ? CONFIG.sitePath
      : core.kind === "journal" ? CONFIG.journalPath
      : CONFIG.projectsPath;
    const label =
      core.kind === "about" ? "About"
      : core.kind === "site" ? "Site identity"
      : core.kind === "journal" ? "Journal"
      : "Projects";
    try {
      setStatus("Publishing…");
      $("#core-save").disabled = true;
      const res = await putFile(path, JSON.stringify(core.data, null, 2) + "\n", `Update ${label}`, core.sha);
      core.sha = res.content && res.content.sha;
      if (core.kind === "site") applyBrand(core.data);
      setStatus("Published", "ok");
      toast(`${label} updated — live in about a minute.`);
    } catch (e) {
      setStatus("Save failed", "err");
      toast(e.message, true);
    } finally {
      const b = $("#core-save");
      if (b) b.disabled = false;
    }
  }

  /* ---------------- image optimization ----------------
     Camera and AI images arrive as multi-MB files. Before anything is
     committed to the repo it is decoded, downscaled to a sane edge and
     re-encoded — WebP where the browser can write it, JPEG/PNG where it
     can't. SVGs and GIFs pass through untouched, and if the "optimized"
     file somehow comes out bigger, the original wins. */
  const IMG_MAX_EDGE = 1600; // photos, covers, gallery pieces
  const LOGO_MAX_EDGE = 512; // brand marks never need more

  function fmtSize(n) {
    return n >= 1048576
      ? (n / 1048576).toFixed(1) + " MB"
      : Math.max(1, Math.round(n / 1024)) + " KB";
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function optimizeImage(file, kind) {
    if (!/^image\//.test(file.type)) return { file: file };
    if (file.type === "image/svg+xml" || file.type === "image/gif") return { file: file };
    try {
      let bmp;
      if (window.createImageBitmap) {
        bmp = await createImageBitmap(file);
      } else {
        bmp = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = URL.createObjectURL(file);
        });
      }
      const w = bmp.width || bmp.naturalWidth;
      const h = bmp.height || bmp.naturalHeight;
      if (!w || !h) return { file: file };
      const maxEdge = kind === "logo" || kind === "icon" ? LOGO_MAX_EDGE : IMG_MAX_EDGE;
      const k = Math.min(1, maxEdge / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * k));
      canvas.height = Math.max(1, Math.round(h * k));
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      if (bmp.close) bmp.close();

      // Home Screen icons must stay PNG — iOS won't take WebP there.
      if (kind === "icon") {
        const png = await canvasBlob(canvas, "image/png");
        if (!png || (k >= 1 && png.size >= file.size && file.type === "image/png")) return { file: file };
        return { file: png, ext: "png", note: ` · ${fmtSize(file.size)} → ${fmtSize(png.size)}` };
      }
      let out = await canvasBlob(canvas, "image/webp", 0.82);
      if (!out || out.type !== "image/webp") {
        // no WebP encoder here (older Safari): keep alpha in PNG, else JPEG
        const keepAlpha = file.type === "image/png" || file.type === "image/webp";
        out = keepAlpha
          ? await canvasBlob(canvas, "image/png")
          : await canvasBlob(canvas, "image/jpeg", 0.85);
      }
      if (!out || (k >= 1 && out.size >= file.size)) return { file: file };
      const ext = out.type === "image/webp" ? "webp" : out.type === "image/png" ? "png" : "jpg";
      return { file: out, ext: ext, note: ` · ${fmtSize(file.size)} → ${fmtSize(out.size)}` };
    } catch (e) {
      return { file: file }; // never let optimization block an upload
    }
  }
  window.__qrOptimize = optimizeImage; // reachable from the console for checks

  // Generic upload (covers, image blocks, galleries, logos, editor images):
  // images are optimized first; returns a /uploads/… url.
  async function uploadAsset(file, kind) {
    try {
      const rawName = file.name || "image";
      let ext = (rawName.split(".").pop() || "bin").toLowerCase();
      let note = "";
      if (/^image\//.test(file.type || "")) {
        setStatus("Optimizing…");
        const opt = await optimizeImage(file, kind);
        file = opt.file;
        if (opt.ext) ext = opt.ext;
        if (opt.note) note = opt.note;
      }
      setStatus("Uploading…");
      const base = slugify(rawName.replace(/\.[^.]+$/, "")) || "image";
      const name = `${Date.now()}-${base}.${ext}`;
      const path = `${CONFIG.uploadsDir}/${name}`;
      const b64 = await fileToB64(file);
      const res = await gh(`/repos/${CONFIG.repo}/contents/${path}`, {
        method: "PUT",
        body: JSON.stringify({ message: `Upload ${kind} ${name}`, content: b64, branch: CONFIG.branch }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Upload failed.");
      }
      setStatus("Uploaded" + note, "ok");
      return `/uploads/${name}`;
    } catch (e) {
      setStatus("");
      toast(e.message, true);
      return null;
    }
  }

  async function savePagesFile(message) {
    const content = JSON.stringify(state.pages.list, null, 2) + "\n";
    const res = await putFile(CONFIG.pagesPath, content, message, state.pages.sha);
    state.pages.sha = res.content && res.content.sha;
  }

  async function savePage() {
    const d = state.pages.draft;
    d.title = $("#pg-title").value.trim();
    d.slug = slugify($("#pg-slug").value.trim() || d.title);
    d.description = $("#pg-desc").value.trim();
    d.nav = $("#pg-nav").checked;
    if (!d.title) { toast("Give the page a title.", true); $("#pg-title").focus(); return; }
    if (!d.slug) { toast("The page needs an address.", true); $("#pg-slug").focus(); return; }
    if (RESERVED_SLUGS.indexOf(d.slug) !== -1) {
      toast(`“/${d.slug}/” is reserved by the site — pick another address.`, true);
      $("#pg-slug").focus();
      return;
    }
    const clash = state.pages.list.findIndex((p, i) => p.slug === d.slug && i !== state.pages.editing);
    if (clash !== -1) { toast(`Another page already lives at /${d.slug}/.`, true); return; }

    try {
      setStatus("Publishing…");
      $("#pg-save").disabled = true;
      if (state.pages.editing == null) state.pages.list.push(d);
      else state.pages.list[state.pages.editing] = d;
      await savePagesFile(`${state.pages.editing == null ? "Create" : "Update"} page: ${d.title}`);
      state.pages.editing = state.pages.list.indexOf(d);
      $("#pg-slug").value = d.slug;
      $("#pg-delete").hidden = false;
      setStatus("Published", "ok");
      toast(`Page published — live at /${d.slug}/ in about a minute.`);
    } catch (e) {
      setStatus("Save failed", "err");
      toast(e.message, true);
    } finally {
      $("#pg-save").disabled = false;
    }
  }

  async function deletePage() {
    if (state.pages.editing == null) return;
    const pg = state.pages.list[state.pages.editing];
    if (!confirm(`Delete the page “${pg.title}”? Its address /${pg.slug}/ will stop working.`)) return;
    try {
      state.pages.list.splice(state.pages.editing, 1);
      await savePagesFile(`Delete page: ${pg.title}`);
      toast("Page deleted.");
      showPagesList();
      renderPagesList();
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* ---------------- write ---------------- */
  function resetForm() {
    state.file = null;
    state.sha = null;
    state.cover = "";
    $("#f-title").value = "";
    $("#f-excerpt").value = "";
    $("#f-lede").value = "";
    $("#f-tags").value = "";
    $("#f-date").value = todayISO();
    $("#cover-preview").hidden = true;
    $("#cover-preview").src = "";
    $("#cover-clear").hidden = true;
    $("#delete-btn").hidden = true;
    if (state.editor) state.editor.setMarkdown("");
    syncFieldHeights();
    setStatus("");
  }

  function newEntry() {
    clearLocalDraft();
    resetForm();
    switchView("write");
    $("#f-title").focus();
  }

  async function openEntry(path) {
    try {
      setStatus("Opening…");
      const { sha, raw } = await getFile(path);
      const { data, body } = parseFrontMatter(raw);
      state.file = path;
      state.sha = sha;
      state.cover = data.cover || "";
      $("#f-title").value = data.title || "";
      $("#f-excerpt").value = data.description || "";
      $("#f-lede").value = data.lede || "";
      $("#f-tags").value = Array.isArray(data.tags) ? data.tags.join(", ") : (data.tags || "");
      $("#f-date").value = data.date ? String(data.date).slice(0, 10) : todayISO();
      setCoverPreview(state.cover);
      $("#delete-btn").hidden = false;
      state.editor.setMarkdown(body.trim());
      syncFieldHeights();
      markCleanDraft();
      setStatus("");
      switchView("write");
    } catch (e) {
      toast(e.message, true);
    }
  }

  function collect() {
    const tags = $("#f-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
    const line = (v) => v.replace(/\s*\n\s*/g, " ").trim(); // pasted newlines flatten
    return {
      title: line($("#f-title").value),
      description: line($("#f-excerpt").value),
      lede: line($("#f-lede").value),
      date: $("#f-date").value || todayISO(),
      tags,
      cover: state.cover,
      body: state.editor.getMarkdown().trim(),
    };
  }

  /* ---------------- local draft safety net ----------------
     Whatever is in the write form is mirrored into localStorage every
     few seconds, so a closed tab, dead battery or stray back-swipe
     never loses writing. Cleared on publish/save and on "new entry";
     restored silently the next time the studio opens. */
  const DRAFT_KEY = "qr_studio_draft";
  let lastDraftJson = "";

  function draftSnapshot() {
    if (!state.editor) return null;
    try {
      return {
        file: state.file,
        title: $("#f-title").value,
        excerpt: $("#f-excerpt").value,
        lede: $("#f-lede").value,
        tags: $("#f-tags").value,
        date: $("#f-date").value,
        cover: state.cover,
        body: state.editor.getMarkdown(),
      };
    } catch (e) {
      return null;
    }
  }

  function autosaveTick() {
    if ($("#view-write").hidden) return;
    const snap = draftSnapshot();
    if (!snap) return;
    const json = JSON.stringify(snap);
    if (json === lastDraftJson) return;
    lastDraftJson = json;
    const empty = !snap.title && !snap.body.trim() && !snap.excerpt && !snap.lede && !snap.cover;
    try {
      if (empty) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, json);
    } catch (e) {}
  }

  function clearLocalDraft() {
    lastDraftJson = "";
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  // The form's current content is committed (or freshly opened): drop the
  // stored draft and baseline the ticker so it only re-arms on a real edit.
  function markCleanDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    const snap = draftSnapshot();
    lastDraftJson = snap ? JSON.stringify(snap) : "";
  }

  function restoreLocalDraft() {
    let snap = null;
    try { snap = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) {}
    if (!snap || (!snap.title && !(snap.body || "").trim())) return false;
    state.file = snap.file || null;
    state.sha = null; // looked up fresh at save time, in case it moved on
    state.cover = snap.cover || "";
    $("#f-title").value = snap.title || "";
    $("#f-excerpt").value = snap.excerpt || "";
    $("#f-lede").value = snap.lede || "";
    $("#f-tags").value = snap.tags || "";
    $("#f-date").value = snap.date || todayISO();
    setCoverPreview(state.cover);
    $("#delete-btn").hidden = !state.file;
    try { state.editor.setMarkdown(snap.body || ""); } catch (e) {}
    syncFieldHeights();
    lastDraftJson = JSON.stringify(snap);
    return true;
  }

  async function save(isDraft) {
    const f = collect();
    if (!f.title) { toast("Give it a title first.", true); $("#f-title").focus(); return; }

    const fm = {
      title: f.title,
      date: f.date,
      description: f.description,
      lede: f.lede,
      tags: f.tags,
      cover: f.cover,
    };
    if (isDraft) fm.draft = true;

    const content = buildFrontMatter(fm) + f.body + "\n";
    const path = state.file || `${CONFIG.postsDir}/${slugify(f.title)}.md`;

    try {
      setStatus("Saving…");
      $("#publish-btn").disabled = $("#draft-btn").disabled = true;

      // Upsert by slug: if a file already lives at this path, update it.
      let sha = state.sha;
      if (!sha) sha = await shaOf(path);

      const verb = isDraft ? "Draft" : "Publish";
      const res = await putFile(path, content, `${verb}: ${f.title}`, sha);

      state.file = path;
      state.sha = res.content && res.content.sha;
      $("#delete-btn").hidden = false;
      markCleanDraft();
      setStatus(isDraft ? "Draft saved" : "Published", "ok");
      toast(isDraft ? "Draft saved." : "Published — live in about a minute.");
    } catch (e) {
      setStatus("Save failed", "err");
      toast(e.message, true);
    } finally {
      $("#publish-btn").disabled = $("#draft-btn").disabled = false;
    }
  }

  async function removeEntry() {
    if (!state.file || !state.sha) return;
    if (!confirm("Delete this entry? This can't be undone from here.")) return;
    try {
      await deleteFile(state.file, state.sha, `Delete: ${$("#f-title").value.trim()}`);
      toast("Entry deleted.");
      newEntry();
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* ---------------- cover image ---------------- */
  function setCoverPreview(url) {
    const img = $("#cover-preview");
    if (url) {
      img.src = url;
      img.hidden = false;
      $("#cover-clear").hidden = false;
    } else {
      img.hidden = true;
      img.src = "";
      $("#cover-clear").hidden = true;
    }
  }

  function fileToB64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function uploadCover(file) {
    const url = await uploadAsset(file, "cover");
    if (!url) return;
    state.cover = url;
    setCoverPreview(url);
    toast("Cover image uploaded.");
  }

  /* ---------------- list ---------------- */
  // Entry metadata is cached by git sha, so reopening "My content" costs
  // one listing call — a post's content is only re-fetched when it changed.
  const META_KEY = "qr_studio_postmeta";

  async function renderList() {
    const box = $("#post-list");
    box.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const files = await listFiles();
      if (!files.length) { box.innerHTML = '<p class="muted">No entries yet. Start writing.</p>'; return; }
      let cache = {};
      try { cache = JSON.parse(localStorage.getItem(META_KEY) || "{}"); } catch (e) {}
      const entries = await Promise.all(
        files.map(async (f) => {
          const hit = cache[f.path];
          if (hit && hit.sha === f.sha) {
            return { path: f.path, sha: f.sha, title: hit.title, date: hit.date, draft: !!hit.draft };
          }
          try {
            const { raw } = await getFile(f.path);
            const { data } = parseFrontMatter(raw);
            const iso = data.date instanceof Date ? data.date.toISOString() : String(data.date || "");
            cache[f.path] = { sha: f.sha, title: data.title || f.name, date: iso.slice(0, 10), draft: !!data.draft };
            const m = cache[f.path];
            return { path: f.path, sha: f.sha, title: m.title, date: m.date, draft: m.draft };
          } catch (e) {
            return { path: f.path, sha: f.sha, title: f.name, date: "", draft: false };
          }
        })
      );
      // keep the cache to files that still exist
      const live = {};
      files.forEach((f) => { if (cache[f.path]) live[f.path] = cache[f.path]; });
      try { localStorage.setItem(META_KEY, JSON.stringify(live)); } catch (e) {}
      entries.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      box.innerHTML = "";
      entries.forEach((e) => {
        const row = document.createElement("div");
        row.className = "post-row";
        row.innerHTML =
          `<div class="pr-main"><h4>${escapeHtml(e.title)}` +
          (e.draft ? '<span class="badge">draft</span>' : "") +
          `</h4><div class="pr-meta">${escapeHtml(String(e.date) || "—")}</div></div>` +
          `<button class="pr-del" title="Delete">✕</button>`;
        row.querySelector(".pr-main").addEventListener("click", () => openEntry(e.path));
        row.querySelector(".pr-del").addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (!confirm(`Delete “${e.title}”?`)) return;
          try {
            await deleteFile(e.path, e.sha, `Delete: ${e.title}`);
            toast("Entry deleted.");
            renderList();
          } catch (err) { toast(err.message, true); }
        });
        box.appendChild(row);
      });
    } catch (e) {
      box.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  /* ---------------- boot ---------------- */
  async function start() {
    try {
      const user = await getUser();
      $("#user-name").textContent = user.name || user.login;
      $("#user-avatar").src = user.avatar_url || "";
    } catch (e) {
      loginError(e.message);
      logout();
      return;
    }

    $("#login").hidden = true;
    $("#app").hidden = false;

    if (!state.editor) buildEditor("");
    resetForm();
    if (restoreLocalDraft()) toast("Unsaved writing restored.");
    if (!state.autosaveTimer) state.autosaveTimer = setInterval(autosaveTick, 2500);
    switchView("write");
  }

  /* ---------------- theme ---------------- */
  function currentTheme() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  // The writing box fills whatever screen it's on instead of a fixed frame:
  // from the editor's own top edge down to the bottom of the viewport,
  // minus breathing room (and the tab bar on mobile).
  function editorHeight() {
    const el = $("#editor");
    const top = el ? el.getBoundingClientRect().top : 260;
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    return Math.max(340, window.innerHeight - top - (mobile ? 92 : 36)) + "px";
  }

  function resizeEditor() {
    if (state.editor && !$("#view-write").hidden) {
      try { state.editor.setHeight(editorHeight()); } catch (e) {}
    }
  }

  // If the editor library is missing (blocked script, broken cache), fall
  // back to a plain markdown textarea so writing is never impossible.
  function fallbackEditor(el, initialMd) {
    const ta = document.createElement("textarea");
    ta.className = "editor-fallback";
    ta.placeholder = "Write in Markdown…";
    ta.value = initialMd || "";
    el.appendChild(ta);
    return {
      getMarkdown: () => ta.value,
      setMarkdown: (v) => { ta.value = v == null ? "" : v; },
      setHeight: (h) => { ta.style.height = h; },
      destroy: () => { el.innerHTML = ""; },
    };
  }

  // (Re)create the Toast UI editor in the active theme, preserving content.
  function buildEditor(initialMd) {
    if (state.editor) {
      try { state.editor.destroy(); } catch (e) {}
      state.editor = null;
      $("#editor").innerHTML = "";
    }
    if (!(window.toastui && window.toastui.Editor)) {
      state.editor = fallbackEditor($("#editor"), initialMd);
      state.editor.setHeight(editorHeight());
      return;
    }
    const compact = window.matchMedia("(max-width: 760px)").matches;
    const opts = {
      el: $("#editor"),
      height: editorHeight(),
      initialEditType: "wysiwyg",
      previewStyle: "tab",
      usageStatistics: false,
      placeholder: "Write…",
      initialValue: initialMd || "",
      // phones get the essentials so the toolbar fits one thumb-width
      toolbarItems: compact
        ? [
            ["heading", "bold", "italic"],
            ["quote"],
            ["ul", "ol"],
            ["link", "image"],
          ]
        : [
            ["heading", "bold", "italic", "strike"],
            ["hr", "quote"],
            ["ul", "ol"],
            ["link", "image"],
            ["code", "codeblock"],
          ],
      // Editor images would otherwise be embedded as huge base64 strings
      // inside the markdown — route them through the optimizing uploader.
      hooks: {
        addImageBlobHook: (blob, callback) => {
          uploadAsset(blob, "image").then((url) => {
            if (url) callback(url, blob.name || "image");
          });
        },
      },
    };
    if (currentTheme() === "dark") opts.theme = "dark";
    state.editor = new window.toastui.Editor(opts);
  }

  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("qr_studio_theme", t); } catch (e) {}
    const btn = $("#theme-toggle");
    if (btn) {
      btn.textContent = t === "light" ? "☾" : "☀";
      btn.title = t === "light" ? "Switch to dark" : "Switch to light";
    }
    // the rich editor only re-skins on rebuild — keep the draft intact
    if (state.editor && window.toastui) {
      let md = "";
      try { md = state.editor.getMarkdown(); } catch (e) {}
      buildEditor(md);
    }
  }

  /* Title / excerpt / lede are single-value fields rendered as auto-growing
     textareas, so a long line wraps into view instead of hiding. Enter moves
     on to the next field — these fields hold no newlines. */
  const FLOW_FIELDS = ["#f-title", "#f-excerpt", "#f-lede"];

  function growField(el) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  function syncFieldHeights() {
    FLOW_FIELDS.forEach((sel) => {
      const el = $(sel);
      if (el) growField(el);
    });
  }

  function wireFlowFields() {
    FLOW_FIELDS.forEach((sel, i) => {
      const el = $(sel);
      if (!el) return;
      el.addEventListener("input", () => growField(el));
      el.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const next = FLOW_FIELDS[i + 1] && $(FLOW_FIELDS[i + 1]);
        if (next) next.focus();
        else if (state.editor && state.editor.focus) { try { state.editor.focus(); } catch (err) {} }
      });
    });
  }

  function wire() {
    wireFlowFields();
    $("#login-btn").addEventListener("click", login);
    $("#logout").addEventListener("click", logout);
    $("#new-btn").addEventListener("click", newEntry);
    document.querySelectorAll("[data-view]").forEach((b) =>
      b.addEventListener("click", () => switchView(b.dataset.view))
    );
    let rsTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(rsTimer);
      rsTimer = setTimeout(resizeEditor, 150);
    });
    $("#publish-btn").addEventListener("click", () => save(false));
    $("#draft-btn").addEventListener("click", () => save(true));
    $("#delete-btn").addEventListener("click", removeEntry);
    $("#cover-btn").addEventListener("click", () => $("#cover-file").click());
    $("#cover-file").addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) uploadCover(e.target.files[0]);
      e.target.value = "";
    });
    $("#cover-clear").addEventListener("click", () => { state.cover = ""; setCoverPreview(""); });
    $("#track-add").addEventListener("click", () => $("#track-file").click());
    $("#track-file").addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) addTrack(e.target.files[0]);
      e.target.value = "";
    });
    $("#track-save").addEventListener("click", saveSoundtrack);

    // pages
    $("#page-new").addEventListener("click", () => openPageEditor(null));
    $("#pg-back").addEventListener("click", () => { showPagesList(); renderPagesList(); });
    $("#pg-save").addEventListener("click", savePage);
    $("#pg-delete").addEventListener("click", deletePage);
    $("#pg-title").addEventListener("input", (e) => {
      // auto-suggest the address until the user edits it by hand
      const slugEl = $("#pg-slug");
      if (!slugEl.dataset.touched) slugEl.value = slugify(e.target.value);
    });
    $("#pg-slug").addEventListener("input", (e) => { e.target.dataset.touched = "1"; });
    document.querySelectorAll("[data-add-block]").forEach((b) =>
      b.addEventListener("click", () => {
        const type = b.dataset.addBlock;
        const fresh =
          type === "hero" ? { type: "hero", eyebrow: "", heading: "", lede: "" }
          : type === "prose" ? { type: "prose", body: "" }
          : type === "image" ? { type: "image", src: "", caption: "" }
          : type === "quote" ? { type: "quote", text: "", attribution: "" }
          : { type: "divider" };
        state.pages.draft.blocks.push(fresh);
        renderBlocks();
      })
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    wire();
    $("#theme-toggle").addEventListener("click", () =>
      applyTheme(currentTheme() === "light" ? "dark" : "light")
    );
    applyTheme(currentTheme()); // sync the toggle icon with the saved theme
    // adopt the site's logo for the tab icon + studio marks
    fetch("/site.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) applyBrand(d); })
      .catch(() => {});
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) { state.token = saved; start(); }
  });
})();
