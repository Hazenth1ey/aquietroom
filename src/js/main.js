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

    let w, h, dpr, stars;

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
      const count = Math.min(
        460,
        Math.round((innerWidth * innerHeight) / 4200)
      );
      stars = Array.from({ length: count }, () => spawn(true));
    }

    // depth 0 = far/small/dim, 1 = near/big/bright
    function spawn(scatterY) {
      const depth = Math.random();
      const white = Math.random() > 0.24;
      const tint = white
        ? "255,255,255"
        : Math.random() > 0.5
        ? "175,192,230"
        : "206,178,206";
      return {
        x: Math.random() * w,
        y: scatterY ? Math.random() * h : h + 6,
        depth: depth,
        r: (0.35 + depth * 1.4) * dpr,
        baseA: 0.16 + Math.random() * 0.4,
        tw: Math.random() * Math.PI * 2,
        twSpeed: 0.004 + Math.random() * 0.012,
        // a real upward current — nearer stars rise faster, with variance
        vy: -(0.06 + depth * 0.26 + Math.random() * 0.05) * dpr,
        tint: tint,
      };
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);
      par.x += (par.tx - par.x) * 0.05;
      par.y += (par.ty - par.y) * 0.05;

      for (const s of stars) {
        s.y += s.vy * (1 + audioLevel * 1.6); // the current quickens with the music
        s.tw += s.twSpeed * (1 + audioLevel * 1.2);
        if (s.y < -6) {
          s.y = h + 6;
          s.x = Math.random() * w;
        }

        // nearer stars parallax more
        const ox = par.x * s.depth * 18 * dpr;
        const oy = par.y * s.depth * 18 * dpr;
        const twinkle = 0.5 + 0.5 * Math.sin(s.tw);
        let a = s.baseA * (0.32 + 0.68 * twinkle) * (1 + audioLevel * 0.75);
        if (a > 1) a = 1;
        const r = s.r * (1 + audioLevel * 0.5);
        const x = s.x + ox;
        const y = s.y + oy;

        // faint halo, only on the very nearest stars
        if (s.depth > 0.92) {
          const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
          halo.addColorStop(0, "rgba(" + s.tint + "," + (a * 0.22).toFixed(3) + ")");
          halo.addColorStop(1, "rgba(" + s.tint + ",0)");
          ctx.beginPath();
          ctx.arc(x, y, r * 4, 0, Math.PI * 2);
          ctx.fillStyle = halo;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(" + s.tint + "," + a.toFixed(3) + ")";
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
     Tracks come from the CMS-managed list injected in #soundtrack. Playback
     uses a plain <audio> element so the music keeps playing on mobile when
     the screen locks (Web Audio gets suspended there; media elements don't),
     and the lock screen gets play/pause controls via the Media Session API.
     The reactive visuals read a loudness envelope precomputed from the same
     downloaded bytes — no live audio graph needed. */
  function soundscape() {
    const btn = document.getElementById("sound-toggle");
    if (!btn) return;
    const AC = window.AudioContext || window.webkitAudioContext;

    let tracks = [];
    try {
      const el = document.getElementById("soundtrack");
      if (el) tracks = (JSON.parse(el.textContent) || []).filter((t) => t && t.src);
    } catch (e) {}

    if (!tracks.length) { btn.remove(); return; }

    const LEVEL = 0.6; // ceiling volume
    const ENV_HZ = 10; // envelope samples per second
    let audio = null, playing = false, idx = 0, fadeTimer = null;
    const cache = {}; // src -> { url (blob), env (Float32Array|null) }

    // One download per track: bytes become both the playable blob URL and
    // the loudness envelope that drives the stars/EQ.
    function load(src) {
      if (cache[src]) return Promise.resolve(cache[src]);
      return fetch(src)
        .then((r) => r.arrayBuffer())
        .then((ab) => {
          const entry = (cache[src] = {
            url: URL.createObjectURL(new Blob([ab], { type: "audio/mpeg" })),
            env: null,
          });
          if (!AC) return entry;
          const actx = new AC();
          return actx
            .decodeAudioData(ab.slice(0))
            .then((buf) => {
              const ch = buf.getChannelData(0);
              const step = Math.floor(buf.sampleRate / ENV_HZ);
              const env = new Float32Array(Math.ceil(ch.length / step));
              for (let i = 0; i < env.length; i++) {
                let sum = 0, n = 0;
                const end = Math.min((i + 1) * step, ch.length);
                for (let j = i * step; j < end; j += 32) { sum += ch[j] * ch[j]; n++; }
                env[i] = Math.min(1, Math.sqrt(sum / Math.max(1, n)) * 3.2);
              }
              entry.env = env;
              if (actx.close) actx.close();
              return entry;
            })
            .catch(() => entry);
        });
    }

    // Volume fade via the element (iOS ignores volume writes; harmless there).
    function fadeTo(to, dur) {
      clearInterval(fadeTimer);
      if (!audio) return;
      const from = audio.volume, t0 = Date.now();
      fadeTimer = setInterval(() => {
        const k = Math.min(1, (Date.now() - t0) / (dur * 1000));
        try { audio.volume = Math.max(0, Math.min(1, from + (to - from) * k)); } catch (e) {}
        if (k >= 1) clearInterval(fadeTimer);
      }, 50);
    }

    // Drive audioLevel from the precomputed envelope at the playhead.
    (function meter() {
      let target = 0;
      if (playing && audio && !audio.paused) {
        const entry = cache[tracks[idx] && tracks[idx].src];
        if (entry && entry.env) {
          const i = Math.floor(audio.currentTime * ENV_HZ);
          target = entry.env[Math.min(i, entry.env.length - 1)] || 0;
        }
      }
      audioLevel += (target - audioLevel) * 0.12;
      requestAnimationFrame(meter);
    })();

    // Lock-screen metadata + controls.
    function mediaSession(title) {
      if (!("mediaSession" in navigator)) return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title || "ambient",
          artist: "a quiet room",
          artwork: [{ src: "/og-image.png", sizes: "1200x630", type: "image/png" }],
        });
        navigator.mediaSession.setActionHandler("play", play);
        navigator.mediaSession.setActionHandler("pause", stop);
      } catch (e) {}
    }

    // Show the current track's title as a continuous right-to-left ticker.
    function setTitle(text) {
      const ticker = document.getElementById("sk-ticker");
      if (!ticker) return;
      const label = text || "";
      ticker.classList.remove("is-scrolling");
      ticker.style.transform = "";
      ticker.innerHTML = "";
      const first = document.createElement("span");
      first.className = "sk-title";
      first.id = "sk-title";
      first.textContent = label;
      ticker.appendChild(first);
      if (reduceMotion || !label) return;
      requestAnimationFrame(() => {
        const wrap = ticker.parentElement;
        const copyW = first.getBoundingClientRect().width;
        if (!copyW) return;
        // enough copies that one full loop never shows a gap
        while (ticker.getBoundingClientRect().width < wrap.clientWidth + copyW) {
          const clone = first.cloneNode(true);
          clone.removeAttribute("id");
          clone.setAttribute("aria-hidden", "true");
          ticker.appendChild(clone);
        }
        ticker.style.setProperty("--sk-loop", "-" + copyW + "px");
        ticker.style.setProperty("--sk-dur", Math.max(5, copyW / 22) + "s");
        ticker.classList.add("is-scrolling");
      });
    }

    function playIndex(i) {
      setTitle(tracks[i].title);
      mediaSession(tracks[i].title);
      return load(tracks[i].src).then((entry) => {
        if (!playing) return;
        if (!audio) audio = new Audio();
        audio.src = entry.url;
        audio.loop = tracks.length === 1;
        audio.onended =
          tracks.length > 1
            ? () => {
                if (playing) {
                  idx = (idx + 1) % tracks.length;
                  playIndex(idx);
                }
              }
            : null;
        try { audio.volume = 0; } catch (e) {}
        const p = audio.play();
        if (p && p.catch) p.catch(() => armRetry());
        fadeTo(LEVEL, 3);
        // preload the next track for a smoother handoff
        if (tracks.length > 1) load(tracks[(i + 1) % tracks.length].src).catch(() => {});
      });
    }

    function play() {
      playing = true;
      btn.setAttribute("aria-pressed", "true");
      try { localStorage.setItem("qr_sound", "on"); } catch (e) {}
      // resume the paused element if it already holds this track
      if (audio && audio.src && audio.paused) {
        const p = audio.play();
        if (p && p.catch) p.catch(() => armRetry());
        fadeTo(LEVEL, 2);
        return Promise.resolve();
      }
      if (audio && !audio.paused) return Promise.resolve();
      return playIndex(idx).catch(() => {
        playing = false;
        btn.setAttribute("aria-pressed", "false");
      });
    }

    function stop() {
      playing = false;
      btn.setAttribute("aria-pressed", "false");
      try { localStorage.setItem("qr_sound", "off"); } catch (e) {}
      if (audio && !audio.paused) {
        fadeTo(0, 1.2);
        setTimeout(() => { if (!playing && audio) try { audio.pause(); } catch (e) {} }, 1350);
      }
    }

    // If autoplay was blocked, retry on the first real interaction.
    function armRetry() {
      const once = () => {
        window.removeEventListener("pointerdown", once);
        window.removeEventListener("keydown", once);
        if (playing) play();
      };
      window.addEventListener("pointerdown", once);
      window.addEventListener("keydown", once);
    }

    btn.addEventListener("click", () => (playing ? stop() : play()));

    // Measure/animate the server-rendered first title.
    setTitle(tracks[0].title);

    // Let the router (or anything) start/stop the sound within a user gesture.
    window.__qrSound = { play: play, stop: stop, isPlaying: () => playing, level: () => audioLevel };

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
    if (entered || wasOn) play();
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
