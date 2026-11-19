# Running LabOS on a Windows PC

This runs the whole app on one PC: no cloud accounts, no Docker. Good for one lab, a pilot, or a demo. For many labs online, use [deploy/DEPLOY.md](deploy/DEPLOY.md) instead.

## What you need

- Windows 10 or 11, 8 GB RAM or more.
- **Node.js 20 or newer.** Download the **LTS** version from https://nodejs.org and install it with the default options.
- Internet during setup (to download packages). After that it runs offline.

## 1. Set up (once)

1. Unzip the LabOS zip somewhere permanent, e.g. `C:\LabOS`. (Not in Downloads, and not in a OneDrive-synced folder.)
2. Double-click **`setup.bat`**. It installs packages and builds the app. It takes 5 to 15 minutes. Wait for "Setup finished".

## 2. Start

Double-click one of:

- **`start.bat`**: your own data. On the first run, the browser opens: click **Create an account** to set up your lab and your owner login.
- **`start-demo.bat`**: also adds a demo lab to try things out. Sign in as `owner@demo-lab.test` with password `Demo@12345` (other demo users: `frontdesk@`, `tech@`, `pathologist@`, `phleb@demo-lab.test`).

The browser opens at http://localhost:3000. **Keep the black window open** while you use LabOS; closing it stops the app.

## Using it from other devices

Phones, tablets and other PCs on the **same Wi-Fi or network** can use it too. The start window shows the address, e.g. `http://192.168.1.20:3000`.

If they can't connect, allow Node.js through Windows Firewall: when Windows asks "Allow access?" the first time, tick **Private networks** and click Allow. Or: Windows Security → Firewall → Allow an app → Node.js → Private.

## Connecting analyzers

LabOS can read results straight from lab machines (haematology, biochemistry, immunoassay, electrolytes...) over the network. Almost every analyzer speaks ASTM or HL7, and LabOS reads both.

1. In LabOS, go to **Settings → Analyzers** and click **Add analyzer**. Give it a name and a port (e.g. 5100; use a different port for each analyzer). Leave "The analyzer connects to this PC" unless its manual says it acts as the server.
2. On the same page, click **Create key**. Copy the command it shows.
3. On the PC the analyzers are connected to, open the LabOS folder, type `cmd` in the address bar, press Enter and paste the command (`interface.bat --url ... --key ...`). After the first time, just double-click **`interface.bat`**. Keep its window open.
4. When Windows asks "Allow access?" for Node.js, tick **Private networks** and click Allow (the analyzers need to reach this PC).
5. On each analyzer, open its **LIS / host communication** settings: enter this PC's IP address (shown by `ipconfig`, e.g. 192.168.1.20) and the analyzer's port from step 1, and turn on sending results. Your service engineer can help with this.
6. Run a sample. Its values appear in **Results** marked "From <analyzer>". The technician checks them and submits as usual. Nothing is approved automatically.

The first time, some of the analyzer's test codes may not match LabOS's (e.g. HGB for Haemoglobin). Open the analyzer in **Settings → Analyzers → Results log & codes**, go to **Test codes**, click **Link all suggested** (or link them by hand), save, then **Retry** the earlier results.

To try it without a machine: with the interface running, `npm run interface:simulate -- --port 5100 --barcode <a received tube's barcode>` sends a sample blood count.

If LabOS or the network is down, the interface program keeps the results on disk (`.local-data\interface-queue.jsonl`) and sends them when it can.

## Your data and backups

Everything is in the **`.local-data`** folder inside the LabOS folder:

- `db\`: the database,
- `secrets.json`: the keys that protect sign-ins (keep it private),
- `mail\`: emails such as password resets, saved as files (see below).

**To back up:** stop LabOS (close the window), then copy the whole `.local-data` folder to a USB drive or cloud storage. Do this daily if you use it for real work. **To restore:** stop LabOS and put the copy back.

## Password-reset emails

By default emails aren't sent; they're saved in `.local-data\mail`. To send them for real, set the `SMTP_URL` and `MAIL_FROM` environment variables before starting (see `deploy/.env.example` for examples).

## Updating to a new version

1. Stop LabOS.
2. Unzip the new version **over** the old folder (keep `.local-data`).
3. Run `setup.bat` again, then `start.bat`. Database changes apply by themselves.

## If something goes wrong

- **"Port 3000 is in use"**: another program uses it. Close it, or restart the PC.
- **The browser shows an error right after starting**: wait 10 seconds and refresh; the app takes a moment to start.
- **Strange errors after an update**: run `npm run start:local -- --rebuild` in this folder (open it in File Explorer, type `cmd` in the address bar, press Enter).

## Good to know

- The admin console is at http://localhost:3000/admin. With LabOS running, open a command prompt in this folder and create your login: `npm run admin:local -- you@example.com "Your Name"`. It prints a password once. (With start-demo.bat, `admin@platform.test` / `Demo@12345` also works.)
- WhatsApp report sending needs the app to be reachable from the internet, so it doesn't work in this one-PC setup. Reports can still be printed, downloaded and shared as links on your network.
