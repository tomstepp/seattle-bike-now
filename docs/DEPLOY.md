# Deploying to bike.tomstepp.com

One-time setup. The order keeps tomstepp.com working the whole time: deploy to
a `workers.dev` URL first, move DNS second, attach the custom domain last.

## 1. Cloudflare account and Workers Paid (you)

1. Sign up at <https://dash.cloudflare.com/sign-up> and verify your email.
2. In the dashboard: **Workers & Pages → Plans**, choose **Workers Paid** ($5/month) and add a card.

Why paid: each refresh fetches 93 TomTom tiles and uses ~40–110 ms of CPU; the
free plan allows 50 fetches and 10 ms. Measured with `npm run bench`.

## 2. Log wrangler in (you)

```bash
cd ~/Documents/GitHub/seattle-bike-now
npx wrangler login
```

A browser tab opens; click **Allow**. Check with `npx wrangler whoami`.

## 3. First deploy and the TomTom secret

1. Deploy (builds the site, creates the KV namespace, uploads the Worker):
   ```bash
   npm run deploy
   ```
   It prints a URL like `https://seattle-bike-now.<your-subdomain>.workers.dev`.
2. Store the TomTom key as a Worker secret. Paste the key when prompted; it is
   never written to the repo:
   ```bash
   npx wrangler secret put TOMTOM_KEY
   ```
3. Within 10 minutes the cron runs. Check:
   ```bash
   curl -s https://seattle-bike-now.<your-subdomain>.workers.dev/api/traffic | head -c 200
   ```
   Live logs: `npx wrangler tail`.

## 4. Move tomstepp.com DNS to Cloudflare (you)

**Before you start, check email forwarding.** tomstepp.com has MX records for
Namecheap email forwarding, which stops working once DNS leaves Namecheap.
In Namecheap: **Domain List → tomstepp.com → Manage → Advanced DNS → Mail Settings**.
If any forwards are listed (e.g. `me@tomstepp.com → you@gmail.com`), recreate
them in Cloudflare under **Email → Email Routing** after step 4.3.

1. Cloudflare dashboard: **Add a domain** → `tomstepp.com` → **Free** plan.
2. Cloudflare imports the existing records. Make sure they match what
   tomstepp.com has today (checked 2026-10-24):

   | Type | Name | Value | Proxy |
   |---|---|---|---|
   | A | `@` | 185.199.108.153 | DNS only |
   | A | `@` | 185.199.109.153 | DNS only |
   | A | `@` | 185.199.110.153 | DNS only |
   | A | `@` | 185.199.111.153 | DNS only |
   | CNAME | `www` | tomstepp.github.io | DNS only |
   | MX | `@` | eforward1–5.registrar-servers.com | (only if you keep Namecheap forwarding; otherwise Email Routing replaces these) |
   | TXT | `@` | `v=spf1 include:spf.efwd.registrar-servers.com ~all` | |

   Set the GitHub Pages records to **DNS only** (grey cloud). GitHub needs to
   see requests directly to issue and renew the tomstepp.com HTTPS certificate.
3. Cloudflare shows two nameservers (like `ada.ns.cloudflare.com`). In Namecheap:
   **Domain List → tomstepp.com → Manage → Nameservers → Custom DNS**, paste both, save.
4. Wait for Cloudflare's "tomstepp.com is now active" email. Usually minutes,
   occasionally up to 24 hours. tomstepp.com keeps working during the switch.

DNSSEC was off when checked, so nothing to disable first.

## 5. Attach bike.tomstepp.com

Uncomment the `routes` block in `wrangler.jsonc`, then:

```bash
npm run deploy
```

Cloudflare creates the `bike` DNS record and HTTPS certificate itself. Check
<https://bike.tomstepp.com> after a minute or two.

## Later deploys

```bash
npm run deploy
```

After `npm run data` refreshes the SDOT network, deploy again so the Worker
picks up the new `worker/data/shared-segments.json`.
