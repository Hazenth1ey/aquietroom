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

  /* ---- Optional ambient soundscape (a looping track, off by default) ---- */
  function soundscape() {
    const btn = document.getElementById("sound-toggle");
    if (!btn) return;
    const AC = window.AudioContext || window.webkitAudioContext;

    const TRACK = "/audio/ambient.mp3";
    const LEVEL = 0.55; // ceiling volume

    let ctx, gain, audio, started = false, playing = false, fadeTimer = null;

    function build() {
      audio = new Audio(TRACK);
      audio.loop = true;
      audio.preload = "auto";
      // Web Audio gives us reliable cross-browser fades (element.volume is
      // read-only on iOS). Same-origin file, so no CORS tainting.
      if (AC) {
        ctx = new AC();
        const srcNode = ctx.createMediaElementSource(audio);
        gain = ctx.createGain();
        gain.gain.value = 0.0001;
        srcNode.connect(gain);
        gain.connect(ctx.destination);
      } else {
        audio.volume = 0;
      }
      started = true;
    }

    function ramp(to, dur) {
      if (gain) {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.linearRampToValueAtTime(Math.max(to, 0.0001), now + dur);
        return;
      }
      // Fallback: fade element volume with an interval.
      clearInterval(fadeTimer);
      const from = audio.volume, t0 = Date.now();
      fadeTimer = setInterval(() => {
        const k = Math.min(1, (Date.now() - t0) / (dur * 1000));
        audio.volume = Math.max(0, Math.min(1, from + (to - from) * k));
        if (k >= 1) clearInterval(fadeTimer);
      }, 40);
    }

    function play() {
      if (!started) build();
      if (ctx && ctx.state === "suspended") ctx.resume();
      const p = audio.play();
      if (p && p.catch) p.catch(() => {});
      ramp(LEVEL, 3);
      playing = true;
      btn.setAttribute("aria-pressed", "true");
      try { localStorage.setItem("qr_sound", "on"); } catch (e) {}
    }
    function stop() {
      ramp(0.0001, 1.3);
      playing = false;
      btn.setAttribute("aria-pressed", "false");
      try { localStorage.setItem("qr_sound", "off"); } catch (e) {}
      setTimeout(() => { if (!playing && audio) try { audio.pause(); } catch (e) {} }, 1500);
    }

    btn.addEventListener("click", () => (playing ? stop() : play()));

    // If it was on last visit, resume on the first interaction (autoplay rules).
    let wasOn = false;
    try { wasOn = localStorage.getItem("qr_sound") === "on"; } catch (e) {}
    if (wasOn) {
      const once = () => {
        play();
        window.removeEventListener("pointerdown", once);
        window.removeEventListener("keydown", once);
      };
      window.addEventListener("pointerdown", once);
      window.addEventListener("keydown", once);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    reveal();
    ambient();
    cursorGlow();
    soundscape();
  });
})();
