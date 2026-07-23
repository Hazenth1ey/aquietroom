/* a quiet room — ambient dust + gentle reveals */

(function () {
  "use strict";

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

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
        m.tw += 0.008;

        if (m.x < -5) m.x = w + 5;
        if (m.x > w + 5) m.x = -5;
        if (m.y < -5) m.y = h + 5;
        if (m.y > h + 5) m.y = -5;

        // deeper (larger) motes parallax more
        const ox = par.x * m.r * 5;
        const oy = par.y * m.r * 5;
        const alpha = m.a * (0.55 + 0.45 * Math.sin(m.tw));
        ctx.beginPath();
        ctx.arc(m.x + ox, m.y + oy, m.r, 0, Math.PI * 2);
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

  /* ---- A soft light that trails the cursor on the portal ---- */
  function cursorGlow() {
    if (reduceMotion) return;
    if (!document.querySelector(".portal")) return; // portal + 404 only
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

  /* ---- Optional ambient soundscape (a looping track, off by default) ----
     Decode the whole file into a buffer and play that — clean and glitch-free,
     unlike streaming a media element through Web Audio. */
  function soundscape() {
    const btn = document.getElementById("sound-toggle");
    if (!btn) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { btn.remove(); return; }

    const TRACK = "/audio/ambient.mp3";
    const LEVEL = 0.6; // ceiling volume

    let ctx, gain, source = null, buffer = null, loading = null, playing = false;

    function ensureCtx() {
      if (ctx) return;
      ctx = new AC();
      gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.connect(ctx.destination);
    }

    function load() {
      if (buffer) return Promise.resolve(buffer);
      if (loading) return loading;
      ensureCtx();
      loading = fetch(TRACK)
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => { buffer = buf; return buf; });
      return loading;
    }

    function ramp(to, dur) {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      gain.gain.linearRampToValueAtTime(Math.max(to, 0.0001), now + dur);
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

    function play() {
      ensureCtx();
      playing = true;
      btn.setAttribute("aria-pressed", "true");
      try { localStorage.setItem("qr_sound", "on"); } catch (e) {}
      return load()
        .then(() => {
          if (!playing) return; // toggled off while loading
          if (ctx.state === "suspended") ctx.resume().catch(() => {});
          if (source) return; // already sounding
          source = ctx.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          source.connect(gain);
          source.start(0);
          ramp(LEVEL, 3);
        })
        .catch(() => {
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
        setTimeout(() => { try { s.stop(); } catch (e) {} }, 1500);
      }
    }

    btn.addEventListener("click", () => (playing ? stop() : play()));

    // Clicking through the splash arms the sound for the room we enter.
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
        if (ctx && ctx.state === "suspended") armResume(); // autoplay blocked → first move starts it
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    reveal();
    ambient();
    cursorGlow();
    soundscape();
  });
})();
