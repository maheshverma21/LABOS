# Hosting LabOS on Hostinger (Node.js Web App hosting)

## Read this first

LabOS needs **Node.js + PostgreSQL + Redis**. Hostinger Node.js hosting gives you only Node.js (and MySQL, which LabOS can't use). So:

| Need | Where it lives |
| --- | --- |
| Web + API (one Node process, via `hostinger/server.js`) | Hostinger Node.js app |
| PostgreSQL | External: **Neon** or **Supabase** (free tier OK to start) |
| Redis | External: **Upstash** (free tier OK to start) |
| Email | Hostinger mailbox (SMTP) |

Requirements on your Hostinger plan: **Business Web Hosting or Cloud** (has "Node.js Web Apps"; Node 20+ must be selectable). Plain Single/Premium shared plans don't have it.

Be aware: shared Node hosting has limited RAM (the build and PDF rendering are memory hungry) and the DB/Redis are remote, so it is fine for a pilot or a small lab. For many labs, or if the build is killed for memory, use a **Hostinger VPS** with `deploy/DEPLOY.md` (Docker, everything included).

## Step 1: Create the database (Neon)

1. Sign up at https://neon.tech, create a project (pick the region nearest your Hostinger server, e.g. Singapore/Mumbai).
2. Copy the **connection string**. Use the **direct** one (host without `-pooler`). Keep `?sslmode=require`.
3. This is your `DATABASE_URL` and `DIRECT_URL`.

## Step 2: Create Redis (Upstash)

1. Sign up at https://upstash.com, create a Redis database (same region).
2. Copy the `rediss://default:PASSWORD@HOST:6379` URL (the TLS one). This is `REDIS_URL`.

## Step 3: Make secrets

On any PC with Node:

```
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Run it twice: one value for `JWT_ACCESS_SECRET`, one for `SECRETS_KEY`. Save them somewhere safe.

## Step 4: Make the upload zip

On your PC, in `C:\LabOS\labos`:

```
powershell -ExecutionPolicy Bypass -File hostinger\make-zip.ps1
```

This creates `C:\LabOS\labos-hostinger.zip` (source only, no node_modules).
(Alternative: push the folder to a private GitHub repo and import that in hPanel.)

## Step 5: Create the Node.js app in hPanel

1. hPanel > **Websites** > your site > **Node.js** (Web Apps) > **Add website / Import**.
2. Upload `labos-hostinger.zip` (or connect the GitHub repo).
3. Settings:
   - **Node version:** 22 (or 20)
   - **Framework:** Other / Custom
   - **Root directory:** the folder containing `package.json`. If the zip unpacks into a subfolder, set that subfolder.
   - **Install command:** `npm ci --no-audit --no-fund`
   - **Build command:** `npm run build`
   - **Start command:** `node hostinger/server.js`
   - **Entry file** (if asked instead of a start command): `hostinger/server.js`

## Step 6: Environment variables

In the app's **Environment variables** section add everything from `hostinger/.env.example`, plus:

- `API_URL=http://127.0.0.1:4000` (needed at **build** time and run time)
- `WEB_ORIGIN=https://your-domain` (your real https address, no trailing slash)
- `NODE_VERSION`/`NODE_ENV` are handled by the launcher; no need to set them.

Do not set `PORT`; Hostinger sets it and the launcher uses it.

## Step 7: Domain and SSL

Point your domain/subdomain to the app in hPanel and enable the free SSL. Sign-in cookies are HTTPS-only in production, so the site must be opened over `https://`.

## Step 8: Deploy and check

1. Click **Deploy / Build**. Watch the build log. On start you should see "Applying database migrations..." (first run creates all tables, ~1 min) then the app comes up.
2. Open `https://your-domain/api/health`. It should return OK.
3. Open `https://your-domain`, click **Create an account** to create your lab and owner login.

## Step 9: Platform admin (optional)

To create the platform admin for `/admin`, run once from a machine that can reach the DB (your PC):

```
cd apps/api
set DATABASE_URL=<your neon url>
set DIRECT_URL=<your neon url>
npx tsx scripts/create-admin.ts
```

(Admins must set up an authenticator app on first sign-in.)

## Updating later

Rebuild a zip (or push to GitHub), redeploy in hPanel. Migrations apply automatically at start.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Build killed / out of memory | Plan too small. Upgrade or use a VPS (`deploy/DEPLOY.md`). |
| "Missing environment variables" in log | Add them in hPanel and redeploy. |
| Migration fails | Use the direct (non-pooled) Neon URL for `DIRECT_URL`; check `sslmode=require`. |
| Login works then logs out | Site not on https, or `WEB_ORIGIN` doesn't exactly match the address you open. |
| 502 / app doesn't start | Check logs; confirm start command is `node hostinger/server.js` and Node is 20+. |
| Redis errors | Use the `rediss://` (TLS) URL from Upstash. |
| Backups | Neon/Supabase keep point-in-time backups on paid plans; export regularly with `pg_dump`. |
