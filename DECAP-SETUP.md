# Setting up the back office (Decap CMS)

Your site now has a CMS. Once the one-time auth setup below is done, you write
and publish from **https://vermilionhereafter.com/admin/** — no code, no Git.

How it works: you log in with GitHub, write in a rich editor, hit **Publish**.
Decap commits a Markdown file to this repo, the deploy workflow rebuilds the
site, and your entry is live in ~1 minute.

The only thing that needs setup is a small **GitHub login proxy**, because a
static site can't safely do GitHub's OAuth on its own. You'll host it free on
your Cloudflare (a Worker). ~10 minutes, once.

---

## Step 1 — Deploy the Cloudflare Worker

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it something like `quietroom-auth`. Click **Deploy** (the default code
   is fine for now).
3. Click **Edit code**. Delete the sample, paste the entire contents of
   [`oauth-worker.js`](./oauth-worker.js) from this repo, then **Deploy**.
4. Note the Worker's URL — it looks like
   `https://quietroom-auth.<your-subdomain>.workers.dev`. You'll need it twice below.

## Step 2 — Create a GitHub OAuth App

1. GitHub → your **Settings** → **Developer settings** → **OAuth Apps** →
   **New OAuth App**. (Direct link: <https://github.com/settings/developers>)
2. Fill in:
   - **Application name:** `a quiet room`
   - **Homepage URL:** `https://vermilionhereafter.com`
   - **Authorization callback URL:** `https://quietroom-auth.<your-subdomain>.workers.dev/callback`
     (your Worker URL from Step 1, with `/callback` on the end)
3. **Register application.**
4. Copy the **Client ID**. Click **Generate a new client secret** and copy that too.

## Step 3 — Give the Worker its secrets

1. Back in the Worker → **Settings** → **Variables and Secrets**.
2. Add two **secrets** (encrypted), exactly these names:
   - `GITHUB_CLIENT_ID` → the Client ID from Step 2
   - `GITHUB_CLIENT_SECRET` → the Client Secret from Step 2
3. **Save and deploy.**

## Step 4 — Point the CMS at the Worker

In [`src/admin/config.yml`](./src/admin/config.yml), set `base_url` to your
Worker's URL (no trailing slash, no `/callback`):

```yaml
backend:
  name: github
  repo: Hazenth1ey/aquietroom
  branch: main
  base_url: https://quietroom-auth.<your-subdomain>.workers.dev
  auth_endpoint: auth
```

Commit that change (or tell me the Worker URL and I'll do it). The site
redeploys automatically.

## Step 5 — Use it

Open **https://vermilionhereafter.com/admin/** → **Login with GitHub** →
authorize once. You'll land in the editor. Create an entry under
**Journal / Writing**, write, and **Publish**.

---

## Notes

- **Where entries live:** each post is a Markdown file in
  `src/writing/posts/`. Decap creates/edits those; the Eleventy build turns
  them into styled pages. You can also still write posts by hand there if you
  ever want to.
- **Images:** the editor uploads to `src/uploads/`, served at `/uploads/`.
- **Fields** (set in `config.yml`): Title, Date, Summary (used in the list and
  RSS), an optional Lede (the italic opening line), and the Body.
- **Security:** only you (via your GitHub login) can publish. The Worker only
  brokers the login; it never stores anything.
