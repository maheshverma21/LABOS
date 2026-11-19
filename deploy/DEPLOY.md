# Putting LabOS online on one server

This runs everything on a single Linux server: the database, Redis, the API, the web app, HTTPS and nightly backups. It works on a **Hostinger VPS**, **AWS Lightsail**, DigitalOcean, or any provider that gives you an Ubuntu server.

You need about 30 minutes.

## What you need

| | |
|---|---|
| A server | Ubuntu 24.04 (or 22.04), at least **2 CPU and 4 GB RAM**. Pick an **India (Mumbai)** location if offered; it's patient data. Hostinger: a KVM VPS plan. AWS: Lightsail, region Mumbai (ap-south-1). |
| A domain | e.g. `yourlab.in`, from any registrar (Hostinger, GoDaddy...). You'll use a subdomain like `app.yourlab.in`. |
| An email account to send from | For "forgot password" emails, e.g. `no-reply@yourlab.in` from your domain's email (Hostinger includes it) or AWS SES. |

## 1. Create the server

- **Hostinger:** VPS → choose a KVM plan → operating system **Ubuntu 24.04** → location India if offered → set a root password or add your SSH key.
- **AWS Lightsail:** Create instance → region **Mumbai** → Linux/Unix → **OS only → Ubuntu 24.04** → the 4 GB plan → create. Then Networking → attach a **static IP**, and in the IPv4 firewall add **HTTPS (443)**.

Note the server's **public IP address**.

## 2. Point your domain at it

In your domain's DNS settings add an **A record**:

| Type | Name | Value |
|---|---|---|
| A | `app` | your server's IP |

(Name `app` gives `app.yourlab.in`.) It can take a few minutes to an hour to work. Check with `ping app.yourlab.in`.

## 3. Copy the project to the server

Connect with SSH (`ssh root@YOUR_IP`, or Lightsail's "Connect" button), then either:

- **from GitHub:** `git clone https://github.com/YOU/lms.git && cd lms`, or
- **from your PC:** zip the project folder *without* `node_modules`, upload it (e.g. `scp lms.zip root@YOUR_IP:`), then `apt-get install -y unzip && unzip lms.zip && cd lms`.

## 4. Run the setup script

```bash
cd deploy
sudo bash setup.sh
```

It asks for your domain, an email for HTTPS notices, and later your email and name for the admin console. It then:

1. installs Docker,
2. turns on a firewall allowing only SSH, HTTP and HTTPS,
3. creates `deploy/.env` with new random passwords and secrets,
4. builds and starts everything (the first build takes 5 to 10 minutes),
5. creates your platform admin and prints a **one-time password**. Save it.

When it finishes:

- labs sign up at `https://app.yourlab.in/signup`
- your admin console is at `https://app.yourlab.in/admin`. On first sign-in you'll set up **two-step sign-in** with an authenticator app (Google Authenticator, Microsoft Authenticator...). Keep the recovery codes it shows.

## 5. Turn on password-reset emails

Edit `deploy/.env` (`nano .env`) and set `SMTP_URL` and `MAIL_FROM`. Examples are in the file. For Hostinger email:

```
SMTP_URL=smtps://no-reply%40yourlab.in:YOUR_EMAIL_PASSWORD@smtp.hostinger.com:465
MAIL_FROM=LabOS <no-reply@yourlab.in>
```

Then apply it:

```bash
docker compose up -d
```

Test it: on the sign-in page click **Forgot password?** with a real account.

## 6. WhatsApp (optional, later)

Each lab can enter its own AiSensy details in **Settings → Lab profile**. To offer your own shared account, set `AISENSY_API_KEY` and `AISENSY_CAMPAIGN` in `.env` and run `docker compose up -d`.

## Everyday tasks

All from the `deploy/` folder:

| Task | Command |
|---|---|
| See what's running | `docker compose ps` |
| Watch the API's log | `docker compose logs -f api` |
| Restart everything | `docker compose restart` |
| Update to a new version | `git pull` (or upload the new files), then `docker compose up -d --build` (database changes apply automatically) |
| Add another platform admin | in the admin console: **Admins → Add admin** |
| Disk space | `df -h` |

## Backups

A copy of the database is saved every night at about 2:30 am IST in `deploy/backups/`, and kept for 14 days. **They're on the same server**, so also copy them somewhere else regularly. For example, download them to your PC weekly:

```bash
scp root@YOUR_IP:lms/deploy/backups/*.sql.gz .
```

or sync them to cloud storage (AWS S3, Backblaze B2) with `rclone`. Many providers also offer whole-server snapshots (Hostinger and Lightsail both do), which are worth turning on.

**Restoring** a backup replaces all current data:

```bash
docker compose stop api
gunzip -c backups/labos-2026-10-18.sql.gz | docker compose exec -T postgres psql -U labos -d labos
docker compose start api
```

Practise this once on a test server before you need it.

## If something goes wrong

- **The site doesn't load / no HTTPS:** check the DNS A record points at the server (`ping app.yourlab.in`), then `docker compose logs caddy`.
- **"Something went wrong" errors:** `docker compose logs api --tail 100`.
- **The server rebooted:** everything restarts by itself.
- **Locked out of the admin console** (lost phone and recovery codes): another super admin can reset your two-step sign-in in **Admins**. If you're the only one, create a second super admin from the server: `docker compose exec api npx tsx scripts/create-admin.ts you2@yourlab.in "Your Name"`.

## Keep these safe

`deploy/.env` holds the database password and the keys that protect sign-ins and saved WhatsApp keys. Keep a copy somewhere safe (a password manager). If you move servers, copy it along with a backup. Never commit it to git or share it.
