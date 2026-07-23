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

  /* ---- Optional ambient soundscape (synthesized, off by default) ---- */
  function soundscape() {
    const btn = document.getElementById("sound-toggle");
    if (!btn) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { btn.remove(); return; }

    let ctx, master, lfo, started = false, playing = false;

    function build() {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 640;
      filter.Q.value = 0.5;
      filter.connect(master);

      // a soft, low drone chord (A2 · E3 · A3 · C#4)
      const voices = [
        { f: 110.0, g: 0.5, t: "triangle" },
        { f: 164.81, g: 0.3, t: "sine" },
        { f: 220.0, g: 0.34, t: "triangle" },
        { f: 277.18, g: 0.16, t: "sine" },
      ];
      voices.forEach((v, i) => {
        const o = ctx.createOscillator();
        o.type = v.t;
        o.frequency.value = v.f;
        o.detune.value = (i - 1.5) * 4;
        const g = ctx.createGain();
        g.gain.value = v.g;
        o.connect(g);
        g.connect(filter);
        o.start();
      });

      // slow "breathing" on the master level
      lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.022;
      lfo.connect(lfoGain);
      lfoGain.connect(master.gain);
      lfo.start();

      started = true;
    }

    function ramp(to, dur) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
      master.gain.linearRampToValueAtTime(to, now + dur);
    }

    function play() {
      if (!started) build();
      if (ctx.state === "suspended") ctx.resume();
      ramp(0.08, 3.5);
      playing = true;
      btn.setAttribute("aria-pressed", "true");
      try { localStorage.setItem("qr_sound", "on"); } catch (e) {}
    }
    function stop() {
      if (started) ramp(0.0001, 1.4);
      playing = false;
      btn.setAttribute("aria-pressed", "false");
      try { localStorage.setItem("qr_sound", "off"); } catch (e) {}
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
