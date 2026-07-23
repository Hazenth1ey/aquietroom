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
