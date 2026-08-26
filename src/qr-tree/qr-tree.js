/* =========================================================
   QR Tree — a scannable landscape, as a reusable module.
   Ported from the standalone builder: the sidebar UI is gone;
   what remains is the scene plus a small API.

     QRTree.mount(container, { link, settings, seed }, opts)
       -> { update, setFlat, toggleFlat, isFlat, downloadPNG, destroy }
     QRTree.SCHEMA / PRESETS / BASE  — for form generators (the studio)
     QRTree.contrastRatio(a, b)     — scannability check
     QRTree.randomPalette()         — a palette that hangs together

   Needs window.THREE (r128) and window.qrcode (qrcode-generator),
   both served from /qr-tree/vendor/.
   ========================================================= */
(function () {
  "use strict";

  /* ---------------- settings schema ---------------- */
  // `rebuild` = the 3D scene must be regenerated when this changes;
  // otherwise a cheap re-colour / re-light is enough.
  const SCHEMA = [
    { group: "Palette", key: "leaf",     label: "Leaves",      type: "color" },
    { group: "Palette", key: "tint1",    label: "Leaf tint 1", type: "color" },
    { group: "Palette", key: "tint2",    label: "Leaf tint 2", type: "color" },
    { group: "Palette", key: "tint3",    label: "Leaf tint 3", type: "color" },
    { group: "Palette", key: "trunk",    label: "Trunk",       type: "color" },
    { group: "Palette", key: "code",     label: "Code (flat)", type: "color" },
    { group: "Palette", key: "stone",    label: "Dark tiles",  type: "color" },
    { group: "Palette", key: "light",    label: "Light tiles", type: "color" },
    { group: "Palette", key: "grass",    label: "Grass",       type: "color" },
    { group: "Palette", key: "particle", label: "Particles",   type: "color" },

    { group: "Sky & light", key: "skyTop",        label: "Sky top",           type: "color" },
    { group: "Sky & light", key: "skyBottom",     label: "Sky bottom",        type: "color" },
    { group: "Sky & light", key: "ambientSky",    label: "Light from sky",    type: "color" },
    { group: "Sky & light", key: "ambientGround", label: "Light from ground", type: "color" },
    { group: "Sky & light", key: "sunColor",      label: "Sun colour",        type: "color" },
    { group: "Sky & light", key: "sunIntensity",  label: "Sun strength",      type: "range", min: 0, max: 2, step: 0.05 },
    { group: "Sky & light", key: "ambient",       label: "Ambient light",     type: "range", min: 0, max: 2, step: 0.05 },
    { group: "Sky & light", key: "sunAngle",      label: "Sun direction",     type: "range", min: 0, max: 360, step: 1 },
    { group: "Sky & light", key: "sunHeight",     label: "Sun height",        type: "range", min: 10, max: 85, step: 1 },
    { group: "Sky & light", key: "shadows",       label: "Shadows",           type: "toggle" },
    { group: "Sky & light", key: "vignette",      label: "Vignette",          type: "range", min: 0, max: 0.4, step: 0.01 },

    { group: "Weather & motion", key: "particleStyle", label: "Particles",  type: "select", options: ["petals", "leaves", "fireflies", "snow", "none"] },
    { group: "Weather & motion", key: "particleCount", label: "Amount",     type: "range", min: 0, max: 250, step: 5 },
    { group: "Weather & motion", key: "particleSpeed", label: "Fall speed", type: "range", min: 0, max: 3, step: 0.1 },
    { group: "Weather & motion", key: "wind",          label: "Wind in leaves", type: "range", min: 0, max: 3, step: 0.1 },
    { group: "Weather & motion", key: "sway",          label: "Camera sway",    type: "range", min: 0, max: 8, step: 0.5 },

    { group: "Tree", key: "treeType",  label: "Tree type",       type: "select", options: ["cherry", "oak", "willow", "pine", "maple"], rebuild: true },
    { group: "Tree", key: "height",    label: "Height",          type: "range", min: 0.15, max: 0.55, step: 0.01, rebuild: true },
    { group: "Tree", key: "branching", label: "Branch splits",   type: "range", min: 0, max: 1, step: 0.05, rebuild: true },
    { group: "Tree", key: "spread",    label: "Spread",          type: "range", min: 0.2, max: 1.2, step: 0.05, rebuild: true },
    { group: "Tree", key: "canopy",    label: "Canopy size",     type: "range", min: 1, max: 4, step: 0.1, rebuild: true },
    { group: "Tree", key: "fullness",  label: "Leaf density",    type: "range", min: 0.2, max: 1, step: 0.05, rebuild: true },
    { group: "Tree", key: "leafSize",  label: "Leaf size",       type: "range", min: 0.4, max: 1.2, step: 0.05, rebuild: true },
    { group: "Tree", key: "thickness", label: "Trunk thickness", type: "range", min: 0.5, max: 1.8, step: 0.05, rebuild: true },

    { group: "Ground", key: "darkH",       label: "Dark tile height",  type: "range", min: 0.2, max: 2, step: 0.05, rebuild: true },
    { group: "Ground", key: "lightH",      label: "Light tile height", type: "range", min: 0.1, max: 1, step: 0.05, rebuild: true },
    { group: "Ground", key: "gap",         label: "Tile gap",          type: "range", min: 0, max: 0.2, step: 0.01, rebuild: true },
    { group: "Ground", key: "grassAmount", label: "Grass amount",      type: "range", min: 0, max: 1, step: 0.05, rebuild: true },
    { group: "Ground", key: "grassHeight", label: "Grass height",      type: "range", min: 0.2, max: 1.5, step: 0.05, rebuild: true },
    // scannability: the quiet zone never drops below 4 modules
    { group: "Ground", key: "quiet",       label: "Border (quiet zone)", type: "range", min: 4, max: 8, step: 1, rebuild: true },
  ];

  const BASE = {
    sunIntensity: 0.85, ambient: 0.95, sunAngle: 58, sunHeight: 60, shadows: true, vignette: 0.10, sunColor: "#fff4e0",
    particleCount: 60, particleSpeed: 1, wind: 1, sway: 3,
    treeType: "cherry", height: 0.32, branching: 0.75, spread: 0.6, canopy: 2.6, fullness: 0.7, leafSize: 0.9, thickness: 1.2,
    darkH: 0.55, lightH: 0.35, gap: 0.04, grassAmount: 0.28, grassHeight: 0.8, quiet: 4,
  };
  const PRESETS = {
    spring: { ...BASE, leaf: "#f6b9cd", tint1: "#ffe6ee", tint2: "#f9c4d6", tint3: "#ffffff", trunk: "#7a5540", code: "#b94c78", stone: "#dcd5c6", light: "#f4efe4",
      grass: "#8fc06a", particle: "#fbd0dd", skyTop: "#fbe9ee", skyBottom: "#f6f1e7", ambientSky: "#ffe4ec", ambientGround: "#dfe6c9", particleStyle: "petals" },
    summer: { ...BASE, leaf: "#5aa650", tint1: "#9fd88b", tint2: "#4b9a45", tint3: "#c8ea9a", trunk: "#5c4030", code: "#2c5e2b", stone: "#d5d8c6", light: "#f2f2e2",
      grass: "#5fae4f", particle: "#fff2a8", skyTop: "#e4f0f7", skyBottom: "#f6f1e7", ambientSky: "#dcefff", ambientGround: "#c9deae", particleStyle: "fireflies", particleSpeed: 0.4, treeType: "oak" },
    autumn: { ...BASE, leaf: "#e6842f", tint1: "#f3b04c", tint2: "#c9402b", tint3: "#f9d58b", trunk: "#5a3d2b", code: "#a5461c", stone: "#dccbb0", light: "#f5e9d2",
      grass: "#c9a15a", particle: "#e8923c", skyTop: "#fbe6cf", skyBottom: "#f6f1e7", ambientSky: "#ffe2c4", ambientGround: "#e6cfa8", particleStyle: "leaves", treeType: "maple" },
    winter: { ...BASE, leaf: "#e9eef2", tint1: "#ffffff", tint2: "#cfdbe6", tint3: "#f4f7fa", trunk: "#4b4a52", code: "#2d3e57", stone: "#cfd6dd", light: "#f7f8fa",
      grass: "#b8c4cf", particle: "#ffffff", skyTop: "#dfe7f0", skyBottom: "#f2f4f6", ambientSky: "#e6eef8", ambientGround: "#c9d3dd",
      particleStyle: "snow", particleSpeed: 0.5, sunIntensity: 0.6, fullness: 0.5, grassAmount: 0.1, treeType: "pine" },
    night: { ...BASE, leaf: "#7a5fb5", tint1: "#b39ddb", tint2: "#5e4a9c", tint3: "#e1d5ff", trunk: "#2b2438", code: "#2a1f4d", stone: "#3d3552", light: "#c9c2dd",
      grass: "#4e6b62", particle: "#fff3b0", skyTop: "#1c1b33", skyBottom: "#3a3358", ambientSky: "#5c5aa8", ambientGround: "#2a2540",
      particleStyle: "fireflies", particleSpeed: 0.3, sunColor: "#c8d4ff", sunIntensity: 0.5, ambient: 0.7, vignette: 0.3, treeType: "willow" },
  };

  const TREE_TYPES = {
    cherry: { depth: 4, kids: [2, 3], lift: 0.55, taperL: 0.62, cloud: 0.75, flat: 1.4, trunkLen: 1.0 },
    oak:    { depth: 4, kids: [3, 4], lift: 0.35, taperL: 0.6,  cloud: 0.85, flat: 1.8, trunkLen: 0.7 },
    willow: { depth: 4, kids: [2, 3], lift: 0.5,  taperL: 0.75, cloud: 0.6,  flat: 1.0, trunkLen: 1.2, droop: true },
    pine:   { depth: 2, kids: [5, 7], lift: 0.05, taperL: 0.55, cloud: 0.6,  flat: 3.0, trunkLen: 1.6, whorls: true },
    maple:  { depth: 4, kids: [2, 4], lift: 0.7,  taperL: 0.66, cloud: 0.7,  flat: 1.3, trunkLen: 0.9 },
  };

  /* ---------------- small helpers ---------------- */
  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function makeRandom(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function relLuminance(hex) {
    const c = new THREE.Color(hex);
    const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrastRatio(a, b) {
    const la = relLuminance(a), lb = relLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  // one hue, tints and a dark code colour built from it — always hangs together
  function randomPalette() {
    const h = Math.random();
    const hsl = (hh, s, l) => "#" + new THREE.Color().setHSL(((hh % 1) + 1) % 1, s, l).getHexString();
    return {
      leaf: hsl(h, 0.6, 0.7), tint1: hsl(h, 0.5, 0.88), tint2: hsl(h + 0.05, 0.65, 0.6), tint3: hsl(h - 0.04, 0.4, 0.95),
      code: hsl(h, 0.55, 0.32), trunk: hsl(h + 0.5, 0.25, 0.28), grass: hsl(h + 0.3, 0.45, 0.55), particle: hsl(h, 0.6, 0.85),
      stone: hsl(h + 0.5, 0.12, 0.82), light: hsl(h + 0.5, 0.25, 0.95),
      skyTop: hsl(h + 0.1, 0.5, 0.93), skyBottom: hsl(h + 0.5, 0.3, 0.95),
      ambientSky: hsl(h + 0.1, 0.6, 0.9), ambientGround: hsl(h + 0.3, 0.3, 0.8),
    };
  }

  // The sky follows the visitor's clock: the composed look holds through the
  // day, dawn and dusk blush warm, and after sunset the same palette settles
  // into night — only light-and-sky keys change, never the built scene.
  function computeTimeLook(S, h) {
    const mix = (a, b, k) => {
      k = Math.min(1, Math.max(0, k));
      return "#" + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
    };
    const daylight = (h > 6 && h < 18) ? Math.max(0, Math.sin(Math.PI * (h - 6) / 12)) : 0;
    const dark = Math.min(1, Math.max(0, 1 - daylight * 1.6));
    const dusk = Math.exp(-Math.pow((h - 6.3) / 1.1, 2)) + Math.exp(-Math.pow((h - 17.7) / 1.1, 2));
    return {
      skyTop: mix(S.skyTop, "#10101f", dark * 0.92),
      skyBottom: mix(mix(S.skyBottom, "#262644", dark * 0.88), "#e0975f", Math.min(1, dusk) * 0.35 * (1 - dark * 0.5)),
      ambientSky: mix(S.ambientSky, "#3c3c68", dark * 0.85),
      ambientGround: mix(S.ambientGround, "#1d1d31", dark * 0.85),
      sunColor: mix(mix(S.sunColor, "#c8d4ff", dark * 0.8), "#ffb98a", Math.min(1, dusk) * 0.5),
      sunIntensity: S.sunIntensity * (0.35 + 0.65 * daylight),
      ambient: S.ambient * (0.55 + 0.45 * daylight),
      sunHeight: 18 + (S.sunHeight - 18) * daylight,
      vignette: Math.min(0.4, (S.vignette || 0) + dark * 0.12),
    };
  }

  /* ---------------- shared styles (injected once) ---------------- */
  function ensureStyle() {
    if (document.getElementById("qrt-style")) return;
    const st = document.createElement("style");
    st.id = "qrt-style";
    st.textContent =
      ".qrt-stage{position:relative;width:100%;height:100%;overflow:hidden;cursor:pointer;}" +
      ".qrt-stage canvas{display:block;width:100%;height:100%;}" +
      ".qrt-vignette{position:absolute;inset:0;pointer-events:none;}" +
      ".qrt-hint{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);font-family:Inter,system-ui,sans-serif;" +
      "font-size:11px;letter-spacing:0.12em;color:rgba(20,20,30,0.75);background:rgba(255,255,255,0.7);" +
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:7px 14px;border-radius:999px;pointer-events:none;" +
      "white-space:nowrap;transition:opacity 0.6s;}" +
      ".qrt-hint.qrt-dark{color:rgba(240,238,250,0.85);background:rgba(20,20,32,0.55);}";
    document.head.appendChild(st);
  }

  /* ---------------- the scene, one instance per mount ---------------- */
  function mount(container, config, opts) {
    opts = opts || {};
    ensureStyle();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let S = { ...PRESETS.spring, ...((config && config.settings) || {}) };
    S.quiet = Math.max(4, S.quiet || 4); // never let the quiet zone shrink below spec
    let link = (config && config.link) || "https://example.com";
    let seedShift = (config && config.seed) || 0;
    let followClock = !!(config && config.daynight);
    let hourOverride = null;
    let EFF = S; // effective look: S, time-shifted when the clock is followed
    function refreshEff() {
      if (!followClock) { EFF = S; return; }
      const now = new Date();
      const h = hourOverride != null ? hourOverride : now.getHours() + now.getMinutes() / 60;
      EFF = Object.assign({}, S, computeTimeLook(S, h));
    }

    const stage = document.createElement("div");
    stage.className = "qrt-stage";
    const vignette = document.createElement("div");
    vignette.className = "qrt-vignette";
    stage.appendChild(vignette);
    let hint = null;
    if (opts.hint !== false) {
      hint = document.createElement("p");
      hint.className = "qrt-hint";
      hint.textContent = opts.hintGrow || "tap the tree to see the code";
      stage.appendChild(hint);
    }
    container.appendChild(stage);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    stage.insertBefore(renderer.domElement, vignette);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xcccccc, 1);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const box = new THREE.BoxGeometry(1, 1, 1);
    function petalGeometry() {
      const sh = new THREE.Shape();
      sh.moveTo(0, -0.5); sh.bezierCurveTo(0.55, -0.35, 0.55, 0.3, 0, 0.5); sh.bezierCurveTo(-0.55, 0.3, -0.55, -0.35, 0, -0.5);
      const g = new THREE.ShapeGeometry(sh, 6), pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); pos.setZ(i, 0.12 * (1 - (x * x * 4 + y * y * 2))); }
      g.computeVertexNormals();
      return g;
    }
    const petal = petalGeometry();
    const mk = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mat = {
      dark: mk(), light: mk(), trunk: mk(),
      leaf: new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      grass: mk(), particle: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    };
    let groundGroup, trunkMesh, leafMesh, grassMesh, particles;
    let leaves = [], trunkParts = [], particleData = [], gridSize = 29, growth = 1, leafDirty = true;

    function makeGrid(text) {
      const qr = qrcode(0, "M"); qr.addData(text); qr.make();
      const n = qr.getModuleCount(), Q = Math.max(4, S.quiet), size = n + Q * 2, grid = [];
      for (let r = 0; r < size; r++) {
        const row = [];
        for (let c = 0; c < size; c++) {
          const inside = r >= Q && r < n + Q && c >= Q && c < n + Q;
          row.push(inside ? qr.isDark(r - Q, c - Q) : false);
        }
        grid.push(row);
      }
      return grid;
    }

    function growTree(random, height) {
      const T = TREE_TYPES[S.treeType] || TREE_TYPES.cherry, cubes = [];
      function cloud(x, y, z) {
        const r = S.canopy * T.cloud * (0.9 + random() * 0.5), R = Math.ceil(r);
        for (let ox = -R; ox <= R; ox++) for (let oy = -R; oy <= R; oy++) for (let oz = -R; oz <= R; oz++) {
          const d = Math.sqrt(ox * ox + oy * oy * T.flat + oz * oz), e = d / r;
          const chance = e > 0.6 ? S.fullness : S.fullness * 0.25;
          if (d <= r && random() < chance) cubes.push({ x: x + ox, y: y + oy, z: z + oz, type: "leaf", edge: e, ox, oy, oz, r });
        }
      }
      function branch(x, y, z, dx, dy, dz, length, depth) {
        for (let i = 0; i < length; i++) {
          x += dx; y += dy; z += dz;
          cubes.push({ x, y, z, type: "trunk", depth: Math.min(3, depth) });
          if (T.droop && depth <= 1) { dy -= 0.12; const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l; if (y < 3) break; }
        }
        if (depth === 0) { cloud(x, y, z); return; }
        const kids = T.kids[0] + Math.floor(random() * (T.kids[1] - T.kids[0] + 1)) + (random() < S.branching ? 1 : 0) + (random() < S.branching * 0.5 ? 1 : 0);
        for (let k = 0; k < kids; k++) {
          const ang = (k / kids) * Math.PI * 2 + random() * 1.2, spread = S.spread * (0.7 + random() * 0.6);
          const lift = (T.droop && depth <= 2) ? 0.05 : T.lift;
          const ndx = dx * 0.4 + Math.cos(ang) * spread, ndz = dz * 0.4 + Math.sin(ang) * spread, ndy = lift + random() * 0.35;
          const len = Math.hypot(ndx, ndy, ndz);
          branch(x, y, z, ndx / len, ndy / len, ndz / len, Math.max(2, Math.round(length * T.taperL)), depth - 1);
        }
      }
      if (T.whorls) {
        const H = Math.round(height * T.trunkLen);
        for (let i = 0; i < H; i++) cubes.push({ x: 0, y: i, z: 0, type: "trunk", depth: i < H * 0.4 ? 3 : 2 });
        for (let level = Math.round(H * 0.25); level < H; level += 2) {
          const n = 5 + Math.floor(random() * 3), reach = Math.max(2, Math.round((H - level) * 0.55 * S.spread * 2));
          for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + random() * 0.6; branch(0, level, 0, Math.cos(a), 0.05, Math.sin(a), reach, 1); }
        }
        cloud(0, H + 1, 0);
      } else {
        branch(0, 0, 0, 0, 1, 0, Math.round(height * T.trunkLen), T.depth);
      }
      return cubes;
    }

    function instanced(list, material, o = {}) {
      const mesh = new THREE.InstancedMesh(box, material, Math.max(1, list.length));
      const m = new THREE.Matrix4(), color = new THREE.Color();
      list.forEach((p, i) => {
        m.makeScale(p.sx !== undefined ? p.sx : p.s, p.sy !== undefined ? p.sy : p.s, p.sz !== undefined ? p.sz : p.s);
        m.setPosition(p.x, p.y, p.z); mesh.setMatrixAt(i, m);
        color.set("#ffffff").multiplyScalar(1 - (p.v || 0) * (o.vary !== undefined ? o.vary : 0.12));
        mesh.setColorAt(i, color);
      });
      mesh.castShadow = o.castShadow !== undefined ? o.castShadow : true;
      mesh.receiveShadow = true;
      if (!list.length) mesh.visible = false;
      return mesh;
    }

    function rebuild() {
      const text = (link || "").trim() || "https://example.com";
      const grid = makeGrid(text);
      gridSize = grid.length;
      const half = (gridSize - 1) / 2, random = makeRandom(hashString(text)), tile = 1 - S.gap;

      const darkList = [], lightList = [], darkCells = [];
      for (let r = 0; r < gridSize; r++) for (let c = 0; c < gridSize; c++) {
        const d = grid[r][c], h = d ? S.darkH : S.lightH;
        const item = { x: c - half, y: h / 2, z: r - half, sx: tile, sy: h, sz: tile, v: random() };
        if (d) { darkList.push(item); darkCells.push({ x: c - half, z: r - half }); } else lightList.push(item);
      }
      if (groundGroup) scene.remove(groundGroup);
      groundGroup = new THREE.Group();
      groundGroup.add(instanced(darkList, mat.dark, { vary: 0.08 }));
      groundGroup.add(instanced(lightList, mat.light, { vary: 0.05 }));
      scene.add(groundGroup);

      const tr = makeRandom((hashString(text) ^ 0x9e3779b9) + seedShift * 7919);
      const cubes = growTree(tr, Math.round(gridSize * S.height));
      const unit = 0.7, taper = { 4: 1.2, 3: 1.1, 2: 0.85, 1: 0.65, 0: 0.5 };
      const inner = darkCells.slice().sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
      const rawTrunk = cubes.filter((c) => c.type === "trunk").sort((a, b) => a.y - b.y);
      trunkParts = rawTrunk.map((c, i) => {
        const home = inner[i % inner.length];
        return {
          tx: c.x * unit, ty: S.darkH + c.y * unit, tz: c.z * unit, ts: taper[c.depth] * unit * S.thickness,
          hx: home.x + (tr() - 0.5) * 0.2, hy: S.darkH + 0.25, hz: home.z + (tr() - 0.5) * 0.2, hs: tile * 0.9,
          v: tr(), phase: tr() * Math.PI * 2, delay: tr() * 0.3,
        };
      });
      if (trunkMesh) scene.remove(trunkMesh);
      trunkMesh = new THREE.InstancedMesh(box, mat.trunk, Math.max(1, trunkParts.length));
      trunkMesh.castShadow = true; trunkMesh.receiveShadow = true; scene.add(trunkMesh);

      const raw = cubes.filter((c) => c.type === "leaf"), byAngle = (a) => Math.atan2(a.z, a.x);
      raw.sort((a, b) => byAngle(a) - byAngle(b));
      const cells = darkCells.slice().sort((a, b) => byAngle(a) - byAngle(b));
      leaves = [];
      const Z = new THREE.Vector3(0, 0, 1), dir = new THREE.Vector3(), qt = new THREE.Quaternion(), eu = new THREE.Euler();
      raw.forEach((c, i) => {
        const home = cells[Math.floor(i / raw.length * cells.length)];
        dir.set(c.ox, c.oy * 0.6, c.oz);
        if (dir.lengthSq() < 0.01) dir.set(tr() - 0.5, 0.5, tr() - 0.5);
        dir.normalize();
        const shade = 0.72 + 0.28 * THREE.MathUtils.clamp((c.oy / c.r + 1) / 2, 0, 1);
        const n = c.edge > 0.6 ? 3 : 1;
        for (let k = 0; k < n; k++) {
          qt.setFromUnitVectors(Z, dir); eu.setFromQuaternion(qt);
          leaves.push({
            shade: shade * (c.edge > 0.6 ? 1 : 0.85),
            tx: (c.x + (tr() - 0.5) * 1.2) * unit, ty: S.darkH + (c.y + (tr() - 0.5) * 1.2) * unit, tz: (c.z + (tr() - 0.5) * 1.2) * unit,
            hx: home.x + (tr() - 0.5) * 0.5, hy: S.darkH + 0.9 + tr() * 0.5, hz: home.z + (tr() - 0.5) * 0.5,
            ts: unit * S.leafSize * (1.5 + tr() * 0.9), hs: tile * (0.95 + tr() * 0.3),
            rx: eu.x + (tr() - 0.5) * 0.9, ry: eu.y + (tr() - 0.5) * 0.9, rz: eu.z + tr() * Math.PI * 2,
            yaw: tr() * Math.PI * 2,
            tintIdx: Math.floor(tr() * 4), v: tr(), phase: tr() * Math.PI * 2, delay: tr() * 0.35,
          });
        }
      });
      if (leafMesh) scene.remove(leafMesh);
      leafMesh = new THREE.InstancedMesh(petal, mat.leaf, Math.max(1, leaves.length));
      leafMesh.castShadow = true; leafMesh.receiveShadow = true;
      if (!leaves.length) leafMesh.visible = false;
      scene.add(leafMesh);
      leafDirty = true;

      const gr = makeRandom(hashString(text) ^ 0x1234567), grass = [];
      darkCells.forEach((cell) => {
        if (Math.hypot(cell.x, cell.z) < 5 || gr() > S.grassAmount) return;
        for (let i = 0, n = 2 + Math.floor(gr() * 3); i < n; i++)
          grass.push({ x: cell.x + (gr() - 0.5) * 0.7, y: S.darkH, z: cell.z + (gr() - 0.5) * 0.7, sx: 0.14, sy: S.grassHeight * (0.6 + gr() * 0.8), sz: 0.14, v: gr() });
      });
      if (grassMesh) scene.remove(grassMesh);
      grassMesh = instanced(grass, mat.grass, { vary: 0.3, castShadow: false });
      scene.add(grassMesh);

      buildParticles();
      growth = 0;
      applyLook();
      fitCamera();
    }

    function buildParticles() {
      if (particles) scene.remove(particles);
      particleData = [];
      const count = (reduceMotion || S.particleStyle === "none") ? 0 : S.particleCount;
      for (let i = 0; i < count; i++) particleData.push({
        x: (Math.random() - 0.5) * gridSize * 0.9, y: Math.random() * gridSize * 0.6, z: (Math.random() - 0.5) * gridSize * 0.9,
        phase: Math.random() * Math.PI * 2, speed: 0.02 + Math.random() * 0.03, size: 0.15 + Math.random() * 0.2,
      });
      particles = new THREE.InstancedMesh(box, mat.particle, Math.max(1, count));
      particles.castShadow = false;
      if (!count) particles.visible = false;
      scene.add(particles);
    }

    const trunkCol = new THREE.Color(), grassCol = new THREE.Color();
    const stoneCol = new THREE.Color(), codeCol = new THREE.Color(), leafCol = new THREE.Color();
    const tints = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()], tmp = new THREE.Color();
    function applyLook() {
      refreshEff();
      leafCol.set(S.leaf); codeCol.set(S.code); stoneCol.set(S.stone);
      tints[0].set(S.tint1); tints[1].set(S.tint2); tints[2].set(S.tint3); tints[3].set(S.leaf);
      mat.light.color.set(S.light); trunkCol.set(S.trunk); grassCol.set(S.grass); mat.particle.color.set(S.particle);
      hemi.color.set(EFF.ambientSky); hemi.groundColor.set(EFF.ambientGround); hemi.intensity = EFF.ambient;
      sun.color.set(EFF.sunColor); sun.intensity = EFF.sunIntensity; sun.castShadow = S.shadows;
      stage.style.background = "linear-gradient(180deg," + EFF.skyTop + " 0%," + EFF.skyBottom + " 78%)";
      vignette.style.background = "radial-gradient(ellipse at 50% 55%, transparent 55%, rgba(0,0,0," + (EFF.vignette || 0) + ") 100%)";
      const darkSky = relLuminance(EFF.skyBottom) < 0.35;
      if (hint) hint.classList.toggle("qrt-dark", darkSky);
      container.classList.toggle("qrt-sky-dark", darkSky);
      if (particleData.length !== ((S.particleStyle === "none") ? 0 : S.particleCount) && !reduceMotion) buildParticles();
      leafDirty = true;
    }

    /* ---- animation ---- */
    let flatness = 0, flatTarget = 0, clock = 0, lastEase = -1, raf = 0, disposed = false;
    const DIST = 200, center = new THREE.Vector3(0, 0, 0), smooth = (t) => t * t * (3 - 2 * t);
    const M = new THREE.Matrix4(), E = new THREE.Euler(), V = new THREE.Vector3();

    function placeCamera(ease, sway) {
      const el = THREE.MathUtils.lerp(35.264, 89.9, ease) * Math.PI / 180;
      const az = (THREE.MathUtils.lerp(45, 0, ease) + sway * (1 - ease)) * Math.PI / 180;
      camera.position.set(Math.cos(el) * Math.sin(az) * DIST, Math.sin(el) * DIST, Math.cos(el) * Math.cos(az) * DIST);
      camera.lookAt(center);
    }
    function updateLeaves(ease, g, wind) {
      if (!leafMesh) return;
      mat.dark.color.copy(stoneCol).lerp(codeCol, ease);
      const moving = (ease > 0.001 && ease < 0.999) || g < 1;
      if (!moving && !leafDirty && ease === lastEase && (ease > 0.999 || wind === 0)) return;
      leaves.forEach((L, i) => {
        const t = smooth(THREE.MathUtils.clamp((ease - L.delay * 0.4) / 0.86, 0, 1));
        const w = wind * (1 - t);
        const x = THREE.MathUtils.lerp(L.tx, L.hx, t) + Math.sin(clock * 1.4 + L.phase) * 0.09 * w;
        const y = THREE.MathUtils.lerp(L.ty * g, L.hy, t) + Math.sin(t * Math.PI) * 1.5 + Math.sin(clock * 1.1 + L.phase * 2) * 0.05 * w;
        const z = THREE.MathUtils.lerp(L.tz, L.hz, t) + Math.cos(clock * 1.2 + L.phase) * 0.09 * w;
        const s = THREE.MathUtils.lerp(L.ts, L.hs, t), flutter = Math.sin(clock * 1.6 + L.phase) * 0.25 * w;
        E.set(
          THREE.MathUtils.lerp(L.rx + flutter, -Math.PI / 2, t),
          THREE.MathUtils.lerp(L.ry, 0, t) + Math.sin(t * Math.PI) * 3,
          THREE.MathUtils.lerp(L.rz + flutter * 0.5, L.yaw, t)
        );
        M.makeRotationFromEuler(E); M.scale(V.set(s, s, s)); M.setPosition(x, y, z); leafMesh.setMatrixAt(i, M);
        tmp.copy(tints[L.tintIdx]).lerp(leafCol, 0.3).multiplyScalar(1.12 * THREE.MathUtils.lerp(L.shade, 1, t)).lerp(codeCol, t * 0.85).multiplyScalar(1 - L.v * 0.08);
        leafMesh.setColorAt(i, tmp);
      });
      leafMesh.instanceMatrix.needsUpdate = true;
      leafMesh.instanceColor.needsUpdate = true;
      mat.trunk.color.copy(trunkCol).lerp(codeCol, ease);
      mat.grass.color.copy(grassCol).lerp(codeCol, ease * 0.9);
      trunkParts.forEach((T, i) => {
        const t = smooth(THREE.MathUtils.clamp((ease - T.delay * 0.4) / 0.88, 0, 1));
        const x = THREE.MathUtils.lerp(T.tx, T.hx, t);
        const y = THREE.MathUtils.lerp(T.ty * g, T.hy, t) + Math.sin(t * Math.PI) * 0.8;
        const z = THREE.MathUtils.lerp(T.tz, T.hz, t);
        const sz = THREE.MathUtils.lerp(T.ts, T.hs, t), spin = Math.sin(t * Math.PI) * T.phase;
        E.set(spin * 0.5, spin, 0); M.makeRotationFromEuler(E);
        M.scale(V.set(sz, t > 0.98 ? sz * 0.45 : sz, sz)); M.setPosition(x, y, z); trunkMesh.setMatrixAt(i, M);
        tmp.set("#ffffff").multiplyScalar(1 - T.v * 0.2 * (1 - t)); trunkMesh.setColorAt(i, tmp);
      });
      trunkMesh.instanceMatrix.needsUpdate = true;
      if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
      leafDirty = false;
      lastEase = ease;
    }
    function updateParticles(ease) {
      if (!particles || !particleData.length) return;
      particles.visible = ease < 0.97;
      const st = S.particleStyle, top = gridSize * 0.6, span = gridSize * 0.45, up = st === "fireflies";
      particleData.forEach((p, i) => {
        p.y += (up ? 0.3 : -1) * p.speed * S.particleSpeed;
        p.x += Math.sin(clock * 0.7 + p.phase) * 0.012 * (st === "snow" ? 0.5 : 1);
        p.z += Math.cos(clock * 0.5 + p.phase) * 0.012;
        if (p.y < S.lightH || p.y > top) { p.y = up ? S.lightH + 0.1 : top; p.x = (Math.random() - 0.5) * span * 2; p.z = (Math.random() - 0.5) * span * 2; }
        const spin = clock * 1.5 + p.phase;
        E.set(st === "snow" || st === "fireflies" ? 0 : spin, spin * 0.7, 0); M.makeRotationFromEuler(E);
        const sz = st === "fireflies" ? p.size * 0.5 * (0.7 + 0.3 * Math.sin(clock * 4 + p.phase)) : p.size;
        M.scale(V.set(sz, st === "leaves" ? sz * 0.25 : st === "petals" ? sz * 0.35 : sz, st === "leaves" ? sz * 1.6 : sz));
        M.setPosition(p.x, p.y, p.z); particles.setMatrixAt(i, M);
      });
      particles.instanceMatrix.needsUpdate = true;
    }
    function fitCamera() {
      const w = stage.clientWidth || 300, h = stage.clientHeight || 300, aspect = w / h;
      let halfH = gridSize * 0.64, halfW = halfH * aspect;
      if (halfW < gridSize * 0.75) { halfW = gridSize * 0.75; halfH = halfW / aspect; }
      camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH;
      camera.updateProjectionMatrix();
      const sc = sun.shadow.camera, r = gridSize * 0.9;
      sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 1; sc.far = 300;
      sc.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    function frame(ease, g, sway, wind) {
      placeCamera(ease, sway);
      const a = (EFF.sunAngle != null ? EFF.sunAngle : S.sunAngle) * Math.PI / 180;
      const e = THREE.MathUtils.lerp(EFF.sunHeight != null ? EFF.sunHeight : S.sunHeight, 88, ease) * Math.PI / 180;
      sun.position.set(Math.cos(e) * Math.sin(a) * 80, Math.sin(e) * 80, Math.cos(e) * Math.cos(a) * 80);
      if (grassMesh) grassMesh.scale.y = Math.max(0.001, g);
      updateLeaves(ease, g, wind);
    }
    function animate() {
      if (disposed) return;
      raf = requestAnimationFrame(animate);
      clock += 0.016;
      flatness = reduceMotion ? flatTarget : flatness + (flatTarget - flatness) * 0.05;
      if (Math.abs(flatTarget - flatness) < 0.0015) flatness = flatTarget;
      growth = reduceMotion ? 1 : Math.min(1, growth + 0.016);
      const g = 1 - Math.pow(1 - growth, 3), ease = smooth(flatness);
      frame(ease, g, reduceMotion ? 0 : Math.sin(clock * 0.25) * S.sway, reduceMotion ? 0 : S.wind);
      updateParticles(ease);
      renderer.render(scene, camera);
    }

    /* ---- interaction & lifecycle ---- */
    function setFlat(on) {
      flatTarget = on ? 1 : 0;
      if (hint) hint.textContent = on
        ? (opts.hintTree || "tap to grow the tree back")
        : (opts.hintGrow || "tap the tree to see the code");
    }
    function onTap() { setFlat(!flatTarget); }
    if (opts.interactive !== false) stage.addEventListener("click", onTap);

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fitCamera) : null;
    if (ro) ro.observe(stage);
    else window.addEventListener("resize", fitCamera);

    // the sky keeps time: re-light once a minute while the clock is followed
    const clockTimer = setInterval(() => { if (followClock && !disposed) applyLook(); }, 60000);
    function setFollowClock(on) { followClock = !!on; applyLook(); }
    function setHour(h) { hourOverride = (h == null ? null : +h); applyLook(); }

    function downloadPNG(filename) {
      frame(1, 1, 0, 0);
      if (particles) particles.visible = false;
      renderer.setClearColor(new THREE.Color(S.light), 1);
      renderer.render(scene, camera);
      const a = document.createElement("a");
      a.href = renderer.domElement.toDataURL("image/png");
      a.download = filename || "qr-tree.png";
      a.click();
      renderer.setClearColor(0x000000, 0);
      leafDirty = true;
    }

    function update(next, force) {
      next = next || {};
      let needRebuild = !!force;
      if (next.link !== undefined && next.link !== link) { link = next.link; needRebuild = true; }
      if (next.seed !== undefined && next.seed !== seedShift) { seedShift = next.seed; needRebuild = true; }
      if (next.settings) {
        SCHEMA.forEach((s) => {
          const v = next.settings[s.key];
          if (v !== undefined && v !== S[s.key]) { S[s.key] = v; if (s.rebuild) needRebuild = true; }
        });
        S.quiet = Math.max(4, S.quiet || 4);
      }
      if (needRebuild) rebuild(); else applyLook();
    }

    function destroy() {
      disposed = true;
      clearInterval(clockTimer);
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else window.removeEventListener("resize", fitCamera);
      stage.removeEventListener("click", onTap);
      renderer.dispose();
      if (stage.parentNode) stage.parentNode.removeChild(stage);
    }

    rebuild();
    animate();
    return {
      update, setFlat, toggleFlat: onTap, isFlat: () => flatTarget === 1,
      setFollowClock, setHour,
      downloadPNG, destroy,
      get settings() { return S; }, get container() { return container; },
    };
  }

  window.QRTree = { SCHEMA, PRESETS, BASE, mount, contrastRatio, randomPalette };
})();
