# a quiet room

A portal to my innerworld — a small, still, dark-and-atmospheric personal site.
Built with [Eleventy](https://www.11ty.dev/), a dark ambient design, and a
[Decap CMS](https://decapcms.org/) back office for writing without touching code.

## Writing a post

**The easy way (the back office):** go to
[/admin/](https://vermilionhereafter.com/admin/), log in with GitHub, write,
and publish. See [`DECAP-SETUP.md`](./DECAP-SETUP.md) for the one-time auth setup.

**By hand:** add a Markdown file to `src/writing/posts/` with front matter:

```markdown
---
title: The title of the entry
date: 2026-07-23
description: One-line summary (used in the list and RSS).
lede: An optional italic opening line.
---
Your writing, in Markdown.
```

## Structure

```
src/
  index.njk              → the portal / landing page
  about.njk              → about / bio
  projects.njk           → projects & work
  404.njk                → the "lost" page
  writing/
    index.njk            → writing index (auto-lists posts)
    posts/*.md           → individual entries (Markdown + front matter)
  _includes/
    base.njk             → shared page shell (head, nav, footer)
    post.njk             → per-post layout (date, reading time, prev/next)
  feed.njk               → generates /feed.xml from posts
  sitemap.njk            → generates /sitemap.xml
  admin/                 → Decap CMS (the back office)
  css/style.css          → the whole look
  js/main.js             → ambient drifting-dust canvas + gentle reveals
  favicon.svg, og-image.png, CNAME, robots.txt, uploads/
eleventy.config.js       → build config (passthrough, date/reading-time filters)
oauth-worker.js          → Cloudflare Worker for the CMS GitHub login
```

## Running locally

```
npm install
npm run serve      # live-reloading dev server
# or: npm run build  → outputs the static site to _site/
```

## Deploying

`.github/workflows/deploy.yml` builds with Eleventy and publishes `_site/` to
GitHub Pages on every push to `main` — which is also how a CMS "Publish"
becomes a live page. Served at the custom domain **vermilionhereafter.com**
(via the `CNAME` file).
