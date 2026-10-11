# Link Shortener

A small, self-hosted alternative to hosted link shorteners such as Bitly. Create short links on your own domain, see click statistics, and keep the data in one SQLite file. It runs as a single Node.js process with no Redis, PostgreSQL, Docker, or external account required.

## Features

- Short links with generated or custom slugs, titles, expiry dates, and click limits
- Click statistics: totals, unique visitors, clicks per day for 30 days, referrers, browsers, operating systems, devices
- Privacy-friendly: IP addresses are never stored; unique visitors are counted with a daily-rotating hash
- QR code for every link
- 302 redirects by default so every click is counted, or 301 with caching
- Dashboard with search, enable/disable, edit, delete
- API token for creating links from scripts and other tools
- Admin sign-in with password plus optional TOTP two-factor authentication
- Configurable click retention, systemd unit, Docker image

## Requirements

Node.js 22 or newer and npm.

## Quick start

```sh
git clone https://github.com/TunarJamalov/link-shortener.git
cd link-shortener
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3200/dashboard` and create the first link. Set `BASE_URL` to the public address of the service (for example `https://go.example.com`) so the dashboard shows the links visitors will use.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run from TypeScript sources |
| `npm run build` / `npm start` | Compile to `dist/` and run the build |
| `npm test` | Run the test suite |
| `npm run lint` | Type-check and verify formatting |
| `npm run format` | Format sources with Prettier |

## How it works

A request to `/<slug>` looks up the link, records the click (timestamp, referrer host, browser family, operating system, device class, and a visitor hash), and redirects to the destination. Disabled, expired, and exhausted links answer with HTTP 410 and a short page. Unknown slugs answer with 404.

The visitor hash is `sha256(day + IP + user agent)` truncated, so unique visitors can be counted per day without keeping IP addresses. Click rows older than `CLICK_RETENTION_DAYS` are deleted once a day; the total click counter on each link is kept.

Slugs are case-insensitive. The words `api`, `dashboard`, `login`, `healthz`, `status`, `assets`, `favicon.ico`, and `robots.txt` are reserved.

## API

All endpoints are under `/api/admin`, return JSON, and accept either a dashboard session or `Authorization: Bearer <API_TOKEN>`.

| Method and path | Description |
| --- | --- |
| `GET /links?q=` | List links, optionally filtered by slug, title, or destination |
| `POST /links` | Create a link: `target` (required), `slug`, `title`, `expiresAt` (ms timestamp), `maxClicks`, `enabled` |
| `GET /links/:id` | Link with full statistics |
| `GET /links/:id/qr.png` | QR code image |
| `PUT /links/:id` | Update a link (same fields as create) |
| `DELETE /links/:id` | Delete a link and its clicks |
| `GET /overview` | Totals for the dashboard |

Example:

```sh
curl -s -X POST https://go.example.com/api/admin/links \
  -H "Authorization: Bearer $API_TOKEN" -H "content-type: application/json" \
  -d '{"target":"https://example.com/launch","slug":"launch"}'
```

## Admin authentication

Set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `AUTH_ENCRYPTION_KEY` together to require sign-in for `/dashboard` and `/api/admin/*`. Generate the key with `openssl rand -base64 48`. Sessions last 8 hours, state-changing requests need the CSRF token the dashboard sends automatically, and failed sign-ins are rate limited. Enable TOTP on `/dashboard/security` and keep the recovery codes offline. Redirects are always public.

Without admin credentials the dashboard is open. Only run it that way on a private network.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3200` | HTTP port |
| `HOST` | `0.0.0.0` | Listen address |
| `TRUST_PROXY` | `loopback` | Express `trust proxy` setting; `true` behind a remote reverse proxy |
| `DATABASE_PATH` | `./data/links.db` | SQLite database file |
| `BASE_URL` | request host | Public base URL shown for short links |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | empty | Admin credentials; both required to enable sign-in |
| `AUTH_ENCRYPTION_KEY` | empty | Required with admin credentials; encrypts the TOTP secret |
| `API_TOKEN` | empty | Bearer token for the API; empty disables token access |
| `REDIRECT_STATUS` | `302` | `302` counts every click; `301` lets browsers cache the redirect for an hour |
| `CLICK_RETENTION_DAYS` | `365` | Days of click rows to keep; `0` keeps them forever |

## Docker

```sh
cp .env.example .env   # edit it, then:
docker compose up -d --build
```

The container stores the database in `./data` and listens on port 3200.

## Production deployment

```sh
sudo useradd --system --home /opt/link-shortener shortener
sudo git clone https://github.com/TunarJamalov/link-shortener.git /opt/link-shortener
cd /opt/link-shortener
sudo -u shortener npm ci && sudo -u shortener npm run build
sudo cp .env.example .env   # then edit .env
sudo cp systemd/link-shortener.service /etc/systemd/system/
sudo systemctl enable --now link-shortener
```

Put a reverse proxy with TLS in front of the service on your short domain and set `NODE_ENV=production` so session cookies are marked `Secure`.

## Limitations

- No geographic statistics; there is no IP-to-country database.
- Browser and device detection is a small built-in heuristic, not a full user-agent parser.
- One domain per instance.
- No link-in-bio pages or UTM builders.

## License

MIT. See `LICENSE`.
