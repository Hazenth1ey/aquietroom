/**
 * Decap CMS ↔ GitHub OAuth proxy — Cloudflare Worker.
 *
 * Decap can't talk to GitHub's OAuth directly from a static site (the token
 * exchange needs a secret). This tiny Worker does that handshake for it.
 *
 * Deploy it once (see DECAP-SETUP.md), set two secrets — GITHUB_CLIENT_ID and
 * GITHUB_CLIENT_SECRET — and point src/admin/config.yml `base_url` at its URL.
 *
 * It exposes:
 *   GET /auth      → sends you to GitHub to authorize
 *   GET /callback  → exchanges the code for a token, hands it back to Decap
 */

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    if (pathname === "/") {
      return new Response("a quiet room — Decap OAuth proxy is running.", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Step 1 — begin authorization
    if (pathname === "/auth") {
      const authUrl = new URL(GITHUB_AUTHORIZE);
      authUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", `${url.origin}/callback`);
      authUrl.searchParams.set("scope", searchParams.get("scope") || "repo");
      authUrl.searchParams.set("state", crypto.randomUUID());
      return Response.redirect(authUrl.toString(), 302);
    }

    // Step 2 — GitHub redirects back here with a code
    if (pathname === "/callback") {
      const code = searchParams.get("code");
      if (!code) return new Response("Missing ?code", { status: 400 });

      const tokenRes = await fetch(GITHUB_TOKEN, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "quietroom-oauth",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });

      const data = await tokenRes.json();
      const ok = !data.error && data.access_token;
      const status = ok ? "success" : "error";
      const content = ok
        ? { token: data.access_token, provider: "github" }
        : { error: data.error_description || data.error || "OAuth failed" };

      const page = `<!doctype html><html><body><script>
  (function () {
    function receiveMessage(e) {
      window.opener.postMessage(
        'authorization:github:${status}:${JSON.stringify(content)}',
        e.origin
      );
      window.removeEventListener('message', receiveMessage, false);
    }
    window.addEventListener('message', receiveMessage, false);
    window.opener.postMessage('authorizing:github', '*');
  })();
</script>
<p>Completing sign-in… you can close this window.</p></body></html>`;

      return new Response(page, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
