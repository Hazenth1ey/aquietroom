# a quiet room

A portal to my innerworld — a small, still, dark-and-atmospheric personal site.
Hand-built with plain HTML, CSS, and a little JavaScript. No framework, no build step.

## Structure

```
index.html              → the portal / landing page
about.html              → about / bio
projects.html           → projects & work
writing/index.html      → writing index (list of entries)
writing/posts/*.html    → individual posts
css/style.css           → shared stylesheet (the whole look lives here)
js/main.js              → ambient drifting-dust canvas + gentle reveals
```

## Adding a new post

1. Copy `writing/posts/on-keeping-a-quiet-room.html` to a new file.
2. Update the `<title>`, the `<time>`, the `<h1>`, and the body.
3. Add a new `<li class="entry">` to the top of the list in `writing/index.html`.

## Running locally

It's static — open `index.html` directly, or serve the folder:

```
python3 -m http.server 8000
```

Then visit http://localhost:8000

## Deploying

A GitHub Actions workflow (`.github/workflows/deploy.yml`) publishes the site
to GitHub Pages on every push to `main`. To turn it on:

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Merge to `main` (or run the workflow manually via **Actions → Deploy → Run workflow**).

The site is served at the custom domain **vermilionhereafter.com** (set via the
`CNAME` file). The absolute URLs in `feed.xml`, `sitemap.xml`, and `robots.txt`
point there; `og:image` and other asset paths are relative and resolve
automatically.

## Other files

- `favicon.svg` — a small glowing moon, in-palette
- `og-image.png` — 1200×630 social-share card
- `404.html` — an in-theme "lost" page
