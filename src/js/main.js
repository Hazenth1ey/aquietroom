/* a quiet room — ambient dust + gentle reveals */

(function () {
  "use strict";

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  // Live loudness of the ambient track (0..1), shared with the dust.
  let audioLevel = 0;

  /* ---- Reveal elements as they settle in ---- */
  function reveal() {
    const items = document.querySelectorAll("[data-reveal]");
    if (!("IntersectionObserver" in window) || reduceMotion) {
      items.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const delay = e.target.dataset.reveal || 0;
            setTimeout(() => e.target.classList.add("is-in"), delay * 90);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    items.forEach((el) => io.observe(el));
  }

  /* ---- Drifting dust motes ---- */
  function ambient() {
    if (reduceMotion) return;
    const canvas = document.getElementById("ambient");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let w, h, dpr, motes;

    // Pointer parallax — the field drifts gently as you move.
    const par = { x: 0, y: 0, tx: 0, ty: 0 };
    if (window.matchMedia("(pointer: fine)").matches) {
      window.addEventListener(
        "pointermove",
        (e) => {
          par.tx = (e.clientX / innerWidth - 0.5) * 2;
          par.ty = (e.clientY / innerHeight - 0.5) * 2;
        },
        { passive: true }
      );
    }

    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.width = Math.floor(innerWidth * dpr);
      h = canvas.height = Math.floor(innerHeight * dpr);
      canvas.style.width = innerWidth + "px";
      canvas.style.height = innerHeight + "px";
    }

    function seed() {
      const count = Math.round((innerWidth * innerHeight) / 26000);
      motes = Array.from({ length: count }, () => spawn());
    }

    function spawn() {
      const tint = Math.random() > 0.5 ? "157,176,216" : "201,169,200";
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: (Math.random() * 1.4 + 0.3) * dpr,
        vx: (Math.random() - 0.5) * 0.12 * dpr,
        vy: (Math.random() - 0.5) * 0.12 * dpr,
        a: Math.random() * 0.4 + 0.1,
        tw: Math.random() * Math.PI * 2, // twinkle phase
        tint: tint,
      };
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);
      par.x += (par.tx - par.x) * 0.05;
      par.y += (par.ty - par.y) * 0.05;
      for (const m of motes) {
        m.x += m.vx;
        m.y += m.vy;
        m.tw += 0.008 * (1 + audioLevel * 1.4);

        if (m.x < -5) m.x = w + 5;
        if (m.x > w + 5) m.x = -5;
        if (m.y < -5) m.y = h + 5;
        if (m.y > h + 5) m.y = -5;

        // deeper (larger) motes parallax more
        const ox = par.x * m.r * 5;
        const oy = par.y * m.r * 5;
        // dust breathes with the music
        const twSpeedApplied = m.tw; // (twinkle already advanced above)
        let alpha = m.a * (0.55 + 0.45 * Math.sin(twSpeedApplied)) * (1 + audioLevel * 0.9);
        if (alpha > 1) alpha = 1;
        const r = m.r * (1 + audioLevel * 0.6);
        ctx.beginPath();
        ctx.arc(m.x + ox, m.y + oy, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(" + m.tint + "," + alpha.toFixed(3) + ")";
        ctx.fill();
      }
      requestAnimationFrame(frame);
    }

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        size();
        seed();
      }, 200);
    });

    size();
    seed();
    frame();
  }

  /* ---- Reflect whether the current view is a portal page (splash/home/404) ---- */
  function setPortalState() {
    document.body.classList.toggle("is-portal", !!document.querySelector(".portal"));
  }

  /* ---- A soft light that trails the cursor on the portal ---- */
  function cursorGlow() {
    if (reduceMotion) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const glow = document.createElement("div");
    glow.className = "cursor-glow";
    document.body.appendChild(glow);

    let tx = innerWidth / 2,
      ty = innerHeight / 2,
      x = tx,
      y = ty,
      awake = false;

    window.addEventListener(
      "pointermove",
      (e) => {
        tx = e.clientX;
        ty = e.clientY;
        if (!awake) {
          awake = true;
          glow.classList.add("is-awake");
        }
      },
      { passive: true }
    );

    (function trail() {
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      glow.style.transform = "translate(" + x + "px," + y + "px)";
      requestAnimationFrame(trail);
    })();
  }

  /* ---- Optional ambient soundscape (a playlist, off by default) ----
     Tracks come from the CMS-managed list injected in #soundtrack. Each is
     decoded into a buffer and played through a gain node; an analyser feeds
     the dust. Multiple tracks play in sequence and loop. */
  function soundscape() {
    const btn = document.getElementById("sound-toggle");
    if (!btn) return;
    const AC = window.AudioContext || window.webkitAudioContext;

    let tracks = [];
    try {
      const el = document.getElementById("soundtrack");
      if (el) tracks = (JSON.parse(el.textContent) || []).filter((t) => t && t.src);
    } catch (e) {}

    if (!AC || !tracks.length) { btn.remove(); return; }

    const LEVEL = 0.6; // ceiling volume
    let ctx, gain, analyser, source = null, playing = false, idx = 0;
    const buffers = {};

    function ensureCtx() {
      if (ctx) return;
      ctx = new AC();
      gain = ctx.createGain();
      gain.gain.value = 0.0001;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      gain.connect(ctx.destination);
      gain.connect(analyser); // tap for the reactive dust
      meter();
    }

    // Continuously translate the track's loudness into audioLevel (0..1).
    function meter() {
      const data = new Uint8Array(analyser.fftSize);
      (function tick() {
        let target = 0;
        if (playing) {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          target = Math.min(1, Math.sqrt(sum / data.length) * 3.2);
        }
        audioLevel += (target - audioLevel) * 0.12;
        requestAnimationFrame(tick);
      })();
    }

    function loadBuffer(src) {
      if (buffers[src]) return Promise.resolve(buffers[src]);
      return fetch(src)
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => (buffers[src] = buf));
    }

    function ramp(to, dur) {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      gain.gain.linearRampToValueAtTime(Math.max(to, 0.0001), now + dur);
    }

    function playIndex(i, fadeIn) {
      const src = tracks[i].src;
      return loadBuffer(src).then((buf) => {
        if (!playing) return;
        source = ctx.createBufferSource();
        source.buffer = buf;
        source.loop = tracks.length === 1;
        source.connect(gain);
        source.onended = () => {
          if (playing && tracks.length > 1) {
            idx = (idx + 1) % tracks.length;
            playIndex(idx, false);
          }
        };
        source.start(0);
        if (fadeIn) ramp(LEVEL, 3);
        // preload the next track for a smoother handoff
        if (tracks.length > 1) loadBuffer(tracks[(i + 1) % tracks.length].src).catch(() => {});
      });
    }

    function play() {
      ensureCtx();
      playing = true;
      btn.setAttribute("aria-pressed", "true");
      try { localStorage.setItem("qr_sound", "on"); } catch (e) {}
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      if (source) return Promise.resolve();
      return playIndex(idx, true).catch(() => {
        playing = false;
        btn.setAttribute("aria-pressed", "false");
      });
    }

    function stop() {
      playing = false;
      btn.setAttribute("aria-pressed", "false");
      try { localStorage.setItem("qr_sound", "off"); } catch (e) {}
      if (ctx && source) {
        ramp(0.0001, 1.3);
        const s = source;
        source = null;
        s.onended = null;
        setTimeout(() => { try { s.stop(); } catch (e) {} }, 1500);
      }
    }

    function armResume() {
      const once = () => {
        if (ctx && ctx.state === "suspended") ctx.resume();
        window.removeEventListener("pointerdown", once);
        window.removeEventListener("keydown", once);
      };
      window.addEventListener("pointerdown", once);
      window.addEventListener("keydown", once);
    }

    btn.addEventListener("click", () => (playing ? stop() : play()));

    // Let the router (or anything) start/stop the sound within a user gesture.
    window.__qrSound = { play: play, stop: stop, isPlaying: () => playing };

    // Full-load fallback: clicking through the splash arms the sound.
    const splash = document.querySelector(".splash");
    if (splash) {
      splash.addEventListener("click", () => {
        try { sessionStorage.setItem("qr_enter", "1"); } catch (e) {}
      });
    }

    // Autostart when arriving from the splash, or if it was on last visit.
    let entered = false, wasOn = false;
    try {
      entered = sessionStorage.getItem("qr_enter") === "1";
      if (entered) sessionStorage.removeItem("qr_enter");
    } catch (e) {}
    try { wasOn = localStorage.getItem("qr_sound") === "on"; } catch (e) {}
    if (entered || wasOn) {
      play().then(() => {
        if (ctx && ctx.state === "suspended") armResume();
      });
    }
  }

  /* ---- In-place navigation, so the shell (and the music) never reloads ---- */
  function router() {
    if (!window.history || !window.fetch || !window.DOMParser) return;
    if (!document.getElementById("swup")) return;

    let busy = false;

    function internal(a) {
      if (!a || (a.target && a.target !== "_self")) return false;
      if (a.hasAttribute("download") || a.dataset.noRouter !== undefined) return false;
      const href = a.getAttribute("href") || "";
      if (!href || href[0] === "#" || /^(mailto|tel|https?:\/\/(?!)|javascript):/i.test(href)) return false;
      let url;
      try { url = new URL(a.href); } catch (e) { return false; }
      if (url.origin !== location.origin) return false;
      if (/^\/(studio|admin)\//.test(url.pathname)) return false;
      if (/\.(xml|mp3|png|jpe?g|svg|gif|pdf|zip|webp)$/i.test(url.pathname)) return false;
      return url;
    }

    function fetchText(url) {
      return fetch(url, { headers: { "X-Router": "1" } })
        .then((r) => (r.ok ? r.text() : Promise.reject()))
        .catch(() => null);
    }

    async function go(href, push) {
      if (busy) return;
      busy = true;
      const root = document.documentElement;
      root.classList.add("is-navigating");
      const [html] = await Promise.all([
        fetchText(href),
        new Promise((r) => setTimeout(r, 300)),
      ]);
      if (html == null) { location.href = href; return; }
      const doc = new DOMParser().parseFromString(html, "text/html");
      const next = doc.getElementById("swup");
      const container = document.getElementById("swup");
      if (!next || !container) { location.href = href; return; }

      container.innerHTML = next.innerHTML;
      document.title = doc.title;
      if (push) history.pushState({}, "", href);
      window.scrollTo(0, 0);

      reveal();
      setPortalState();
      root.classList.remove("is-navigating");
      busy = false;
    }

    document.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest("a");
      const url = internal(a);
      if (!url) return;
      if (url.pathname === location.pathname && url.hash) return; // in-page anchor
      e.preventDefault();
      // Entering from the splash starts the music in the same gesture.
      if (a.classList.contains("splash") && window.__qrSound && !window.__qrSound.isPlaying()) {
        window.__qrSound.play();
      }
      if (url.href === location.href) return;
      go(url.href, true);
    });

    window.addEventListener("popstate", () => go(location.href, false));
  }

  document.addEventListener("DOMContentLoaded", function () {
    reveal();
    ambient();
    cursorGlow();
    soundscape();
    setPortalState();
    router();
  });
})();
