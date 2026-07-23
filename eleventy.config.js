const markdownIt = require("markdown-it");

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const mdLib = markdownIt({ html: true, linkify: true, typographer: false });

module.exports = function (eleventyConfig) {
  // Render Markdown coming from data files (e.g. the CMS-edited About body).
  eleventyConfig.addFilter("md", (s) => (s ? mdLib.render(String(s)) : ""));
  eleventyConfig.addFilter("mdInline", (s) => (s ? mdLib.renderInline(String(s)) : ""));

  // --- Passthrough static assets (copied verbatim to the site root) ---
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.svg": "favicon.svg" });
  eleventyConfig.addPassthroughCopy({ "src/og-image.png": "og-image.png" });
  eleventyConfig.addPassthroughCopy({ "src/CNAME": "CNAME" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });
  eleventyConfig.addPassthroughCopy({ "src/admin": "admin" });
  eleventyConfig.addPassthroughCopy({ "src/studio": "studio" });
  eleventyConfig.addPassthroughCopy({ "src/uploads": "uploads" });

  // --- Posts collection: exclude drafts, oldest→newest (for prev/next) ---
  eleventyConfig.addCollection("posts", (api) =>
    api
      .getFilteredByGlob("src/writing/posts/*.md")
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
