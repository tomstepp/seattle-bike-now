# Deploying to bike.tomstepp.com (GitHub Pages)

The site is static: the page fetches traffic, weather, closures, construction
and routes itself. GitHub Actions builds it and publishes it to GitHub Pages
([.github/workflows/deploy.yml](../.github/workflows/deploy.yml)) on every push to
`main`, and every Monday morning with freshly rebuilt city data.

tomstepp.com stays where it is. The only DNS change is one new `bike` record.

## 1. Repository visibility (you)

GitHub Pages is free for **public** repositories; a **private** one needs a paid
plan (GitHub Pro or higher). Pick one:

- **Make it public:** Settings → General → Danger Zone → Change visibility.
  The history has been checked: no keys or `.env` files were ever committed.
- **Or keep it private** and upgrade to GitHub Pro.

Either way the site itself is public, and so are the two keys inside it (see step 5).

## 2. Keys as repository secrets (you)

Settings → Secrets and variables → Actions → **New repository secret**, twice:

| Name | Value |
|---|---|
| `TOMTOM_KEY` | the `VITE_TOMTOM_KEY` value from `.env` |
| `ORS_KEY` | the `VITE_ORS_KEY` value from `.env` |

The workflow passes them to the build as `VITE_TOMTOM_KEY` and `VITE_ORS_KEY`.

## 3. Turn on Pages (you)

Settings → Pages → Build and deployment → Source: **GitHub Actions**.

Then push (or Actions → Deploy → **Run workflow**). When it finishes, the site is
at `https://tomstepp.github.io/seattle-bike-now/`. It works at that address too,
so you can check it before the domain is set up.

## 4. bike.tomstepp.com (you)

1. Namecheap → Domain List → tomstepp.com → Manage → **Advanced DNS** → Add New Record:

   | Type | Host | Value | TTL |
   |---|---|---|---|
   | CNAME | `bike` | `tomstepp.github.io.` | Automatic |

2. GitHub: Settings → Pages → Custom domain: `bike.tomstepp.com` → Save.
   GitHub checks the DNS (minutes, occasionally an hour), then issues HTTPS.
3. Tick **Enforce HTTPS** once it's offered.

Optional but recommended: verify tomstepp.com in your GitHub account
(Settings → Pages → Add a verified domain) so no one else can claim a
subdomain of it on GitHub Pages.

## 5. Lock down the keys (you)

Both keys ship inside the page; that's how a static site calls these services.

- **TomTom:** developer.tomtom.com → Dashboard → Keys → edit the key →
  allowed domains: `bike.tomstepp.com, tomstepp.github.io, localhost`
  (keep `localhost` for `npm run dev`). Other websites can then no longer use it.
- **OpenRouteService** has no domain restriction. The free quota (2,000 routes and
  1,000 searches a day) is the only thing at risk; if it's ever abused, make a new
  key in the dashboard and update the `ORS_KEY` secret.

## Day to day

- **Deploy:** push to `main`.
- **Fresh city data:** automatic every Monday. To refresh now, Actions → Deploy →
  Run workflow. Scheduled runs publish the new data without committing it; run
  `npm run data` locally and commit when you want the repo's copy updated too.
- **If a deploy fails:** the Actions tab shows which step. Tests run before every
  build, so a failing test stops a broken deploy.

## Not used

The `worker/` folder and `wrangler.jsonc` are an earlier Cloudflare Worker setup
that refreshed traffic on a server. The site doesn't need them.
