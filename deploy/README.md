# Deployment

Public topology:

| Host                | Hosted on    | Serves                                  |
| ------------------- | ------------ | --------------------------------------- |
| `rozhlas.org`       | GitHub Pages | Astro static frontend (`packages/web`)  |
| `api.rozhlas.org`   | this server  | Hono JSON API (`packages/api`)          |
| `admin.rozhlas.org` | this server  | Bull Board dashboard, login-gated       |
| `ipfs.rozhlas.org`  | this server  | self-hosted IPFS Kubo gateway (`:8080`) |

DNS is on Cloudflare (proxied/orange-cloud). Set the zone SSL/TLS mode to
**Full (strict)** so Cloudflare trusts the origin's Let's Encrypt certificate.

## Frontend (GitHub Pages)

Built and deployed by `.github/workflows/pages.yml` on push to `main`. The custom
domain comes from `packages/web/public/CNAME`. It calls `https://api.rozhlas.org`
at runtime (`PUBLIC_API_BASE`), so the static build never carries DB content.

## Server services

Caddy terminates TLS and reverse-proxies to the local services. Certificates are
issued by Let's Encrypt via the **Cloudflare DNS-01** challenge (the `caddy-dns/cloudflare`
plugin), which works even while records are proxied.

Install (run as root on the server):

```sh
# 1. Caddy binary with the cloudflare DNS plugin
curl -fsSL -o /usr/local/bin/caddy \
  "https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com/caddy-dns/cloudflare"
chmod +x /usr/local/bin/caddy
useradd --system --home /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy

# 2. Config
install -D -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
# Cloudflare token for the DNS-01 challenge (from .env: CLOUDFLARE_API):
install -d -m 750 /etc/caddy
printf 'CLOUDFLARE_API_TOKEN=%s\n' "$CLOUDFLARE_API" > /etc/caddy/cloudflare.env
chmod 600 /etc/caddy/cloudflare.env

# 3. systemd units
cp deploy/caddy.service /etc/systemd/system/caddy.service
cp deploy/rozhlas-api.service deploy/rozhlas-worker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now rozhlas-api rozhlas-worker caddy
```

The API/worker read secrets from `/root/rozhlas.org/.env`. Required for production:

```
NODE_ENV=production
IPFS_GATEWAY_URL=https://ipfs.rozhlas.org   # so the API hands out public audio URLs
CORS_ORIGINS=https://rozhlas.org,https://www.rozhlas.org
ADMIN_PASSWORD=...                          # admin login
SESSION_SECRET=...                          # openssl rand -hex 32
```

The IPFS daemon runs with `--offline` (serves only locally-pinned content and
never fetches from the network), so the public gateway is not an open relay.
