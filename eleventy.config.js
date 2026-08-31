const markdownIt = require("markdown-it");

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const mdLib = markdownIt({ html: true, linkify: true, typographer: false });

module.exports = function (eleventyConfig) {
  // Cache-buster stamped at build time — every deploy gets fresh asset URLs,
  // so browsers/CDNs can never serve a stale style.css or main.js again.
  eleventyConfig.addGlobalData("assetVersion", String(Date.now()));

  // Render Markdown coming from data files (e.g. the CMS-edited About body).
  eleventyConfig.addFilter("md", (s) => (s ? mdLib.render(String(s)) : ""));
  eleventyConfig.addFilter("mdInline", (s) => (s ? mdLib.renderInline(String(s)) : ""));

  // --- Passthrough static assets (copied verbatim to the site root) ---
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.svg": "favicon.svg" });
  eleventyConfig.addPassthroughCopy({ "src/apple-touch-icon.png": "apple-touch-icon.png" });
  eleventyConfig.addPassthroughCopy({ "src/audio": "audio" });
  eleventyConfig.addPassthroughCopy({ "src/og-image.png": "og-image.png" });
  eleventyConfig.addPassthroughCopy({ "src/CNAME": "CNAME" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });
  eleventyConfig.addPassthroughCopy({ "src/admin": "admin" });
  eleventyConfig.addPassthroughCopy({ "src/studio": "studio" });
  eleventyConfig.addPassthroughCopy({ "src/uploads": "uploads" });
  eleventyConfig.addPassthroughCopy({ "src/qr-tree": "qr-tree" });

  // Ship each track under a neutral .dat name as well. Download-manager
  // extensions intercept anything that looks like music (.mp3 URLs,
  // audio/mpeg responses) and hand the page truncated bytes; a .dat file
  // is served as plain data and passes through untouched. The player
  // prefers the .dat twin and falls back to the .mp3.
  eleventyConfig.on("eleventy.after", async ({ dir }) => {
    const fs = require("node:fs");
    const path = require("node:path");
    for (const sub of ["audio", "uploads"]) {
      const root = path.join(dir.output, sub);
      if (!fs.existsSync(root)) continue;
      for (const f of fs.readdirSync(root)) {
        if (f.endsWith(".mp3")) {
          fs.copyFileSync(path.join(root, f), path.join(root, f + ".dat"));
        }
      }
    }
  });

  // --- Posts collection: exclude drafts, oldest→newest (for prev/next) ---
  eleventyConfig.addCollection("posts", (api) =>
    api
      .getFilteredByGlob("src/journal/posts/*.md")
      .filter((p) => !p.data.draft)
      .sort((a, b) => a.date - b.date)
  );

  // --- Date filters (UTC, so a YYYY-MM-DD front-matter date never drifts) ---
  eleventyConfig.addFilter("readableDate", (d) => {
    const dt = new Date(d);
    return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
  });
  eleventyConfig.addFilter("htmlDate", (d) => new Date(d).toISOString().slice(0, 10));
  eleventyConfig.addFilter("rfc822", (d) => new Date(d).toUTCString());

  // --- Reading time from rendered HTML ---
  eleventyConfig.addFilter("readingTime", (html) => {
    const text = String(html).replace(/<[^>]+>/g, " ");
    const words = (text.match(/\S+/g) || []).length;
    return `${Math.max(1, Math.round(words / 200))} min read`;
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
};
