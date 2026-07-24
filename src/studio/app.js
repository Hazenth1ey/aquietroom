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
    authBase: "https://aquietroom-auth.ivankolly.workers.dev",
  };
  const TOKEN_KEY = "qr_studio_token";

  const state = {
    token: null, file: null, sha: null, cover: "", editor: null,
    sound: { sha: null, tracks: [] },
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
    $("#crumb").textContent =
      name === "list" ? "My content" : name === "sound" ? "Soundtrack" : "Write";
    if (name === "list") renderList();
    if (name === "sound") loadSoundtrack();
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

  function renderTracks() {
    const box = $("#track-list");
    if (!state.sound.tracks.length) {
      box.innerHTML = '<p class="muted">No tracks yet. Add one to give the room a sound.</p>';
      return;
    }
    box.innerHTML = "";
    state.sound.tracks.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "track-row";
      row.innerHTML =
        `<span class="track-ord">${i + 1}</span>` +
        `<input class="track-title" value="${escapeHtml(t.title || "")}" placeholder="Track title" />` +
        `<span class="track-src" title="${escapeHtml(t.src || "")}">${escapeHtml((t.src || "").split("/").pop())}</span>` +
        `<button class="pr-del" title="Remove">✕</button>`;
      row.querySelector(".track-title").addEventListener("input", (e) => {
        state.sound.tracks[i].title = e.target.value;
      });
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
    setStatus("");
  }

  function newEntry() {
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
      setStatus("");
      switchView("write");
    } catch (e) {
      toast(e.message, true);
    }
  }

  function collect() {
    const tags = $("#f-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
    return {
      title: $("#f-title").value.trim(),
      description: $("#f-excerpt").value.trim(),
      lede: $("#f-lede").value.trim(),
      date: $("#f-date").value || todayISO(),
      tags,
      cover: state.cover,
      body: state.editor.getMarkdown().trim(),
    };
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
    try {
      setStatus("Uploading image…");
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const base = slugify(file.name.replace(/\.[^.]+$/, ""));
      const name = `${Date.now()}-${base}.${ext}`;
      const path = `${CONFIG.uploadsDir}/${name}`;
      const b64 = await fileToB64(file);
      const res = await gh(`/repos/${CONFIG.repo}/contents/${path}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `Upload image ${name}`,
          content: b64,
          branch: CONFIG.branch,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Image upload failed.");
      }
      state.cover = `/uploads/${name}`;
      setCoverPreview(state.cover);
      setStatus("Image added", "ok");
      toast("Cover image uploaded.");
    } catch (e) {
      setStatus("");
      toast(e.message, true);
    }
  }

  /* ---------------- list ---------------- */
  async function renderList() {
    const box = $("#post-list");
    box.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const files = await listFiles();
      if (!files.length) { box.innerHTML = '<p class="muted">No entries yet. Start writing.</p>'; return; }
      const entries = await Promise.all(
        files.map(async (f) => {
          try {
            const { raw } = await getFile(f.path);
            const { data } = parseFrontMatter(raw);
            return { path: f.path, sha: f.sha, title: data.title || f.name, date: data.date || "", draft: !!data.draft };
          } catch (e) {
            return { path: f.path, sha: f.sha, title: f.name, date: "", draft: false };
          }
        })
      );
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

    if (!state.editor) {
      state.editor = new window.toastui.Editor({
        el: $("#editor"),
        height: window.matchMedia("(max-width: 760px)").matches ? "400px" : "520px",
        initialEditType: "wysiwyg",
        previewStyle: "tab",
        theme: "dark",
        usageStatistics: false,
        placeholder: "Write…",
        toolbarItems: [
          ["heading", "bold", "italic", "strike"],
          ["hr", "quote"],
          ["ul", "ol"],
          ["link", "image"],
          ["code", "codeblock"],
        ],
      });
    }
    resetForm();
    switchView("write");
  }

  function wire() {
    $("#login-btn").addEventListener("click", login);
    $("#logout").addEventListener("click", logout);
    $("#new-btn").addEventListener("click", newEntry);
    document.querySelectorAll("[data-view]").forEach((b) =>
      b.addEventListener("click", () => switchView(b.dataset.view))
    );
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
  }

  document.addEventListener("DOMContentLoaded", () => {
    wire();
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) { state.token = saved; start(); }
  });
})();
