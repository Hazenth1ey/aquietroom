const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

module.exports = function (eleventyConfig) {
  // --- Passthrough static assets (copied verbatim to the site root) ---
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.svg": "favicon.svg" });
  eleventyConfig.addPassthroughCopy({ "src/og-image.png": "og-image.png" });
  eleventyConfig.addPassthroughCopy({ "src/CNAME": "CNAME" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });
  eleventyConfig.addPassthroughCopy({ "src/admin": "admin" });
  eleventyConfig.addPassthroughCopy({ "src/uploads": "uploads" });

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
