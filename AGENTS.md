<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Engine architecture decisions

- The `hx_edge` edge container (Caddy or OpenResty) MUST run with `--network host` — no `-p` port mappings, no `host.docker.internal`. Why: the edge proxies ACME challenges to certbot standalone on host loopback `127.0.0.1:49180`, reads the host's live Let's Encrypt directory bind-mounted read-only at `/etc/letsencrypt` (plus `<edgeDir>/certs` at `/etc/hosterax-certs` for bootstrap/custom certs), and reaches the engine API and supervised app processes on `127.0.0.1`. Upstream proxies and the on-demand-TLS `ask` URL must therefore always target `127.0.0.1:<port>`, never `host.docker.internal` (that name is reserved for deployed app *containers* on bridge networking reaching host services).
- Certbot issuance: host `certbot` binary first; if absent (spawn error code -1), fall back to containerized `certbot/certbot:latest` with `--network host` and the host letsencrypt dir mounted at `/etc/letsencrypt`. Do not weaken this fallback.
- OpenResty site configs must use container paths: nginx `include /etc/nginx/conf.d/*.conf`, `lua_package_path /usr/local/openresty/lualib/hosterax/?.lua` (lua modules bind-mounted there), and `ssl_certificate` paths translated via `EdgeManager.toContainerPath()`. Never embed host filesystem paths in generated nginx/Caddy configs.
