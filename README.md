# Lab Management System

A cloud, multi-tenant LIS for diagnostic and pathology labs. Many labs share one deployment, and each lab only sees its own data.

| Part | Stack |
| --- | --- |
| `apps/web` | Next.js 16 (App Router), shadcn/ui, Tailwind 4, TanStack Query, React Hook Form |
| `apps/api` | Node.js, Express 5, Prisma 6 (PostgreSQL), Redis (ioredis), JWT |
| `packages/shared` | Zod schemas, permission list and API types used by both apps |

## What works today

- **Lab signup** creates the lab, its main branch, 6 standard roles and the owner account in one transaction.
- **One sign-in page** for lab staff, B2B clients and platform admins: staff go to the dashboard, B2B clients to their portal, admins (after their authenticator code) to the console. The old `/admin/login` address redirects here.
- **Login** with email and password: bcrypt hashing, rate limiting (10 tries per 15 minutes) and the same error whether or not the email exists.
- **Sessions**: a 15-minute JWT access token kept in memory, plus a 30-day refresh token in an httpOnly cookie. The refresh token rotates on every use.
  - Replaying an old refresh token ends that device's session (theft detection).
  - Two tabs refreshing at the same moment is handled safely.
- **Sign out of one device** from Settings → Security. That device's access token stops working straight away (Redis deny-list).
- **RBAC**: 22 permissions grouped into roles (owner, branch manager, front desk, phlebotomist, technician, pathologist). Roles can be limited to one branch.
- **Lab isolation**: route handlers use `req.db`, a Prisma client that adds `tenantId` to every query automatically.
- **Audit log** of signups, logins, staff creation and token-reuse alerts.
- **Web app**: signup, login, a dashboard, staff management (list and add users with roles) and active devices, with light and dark themes.
- **Test List** (Setup → Test List):
  - Departments, and tests with sample type, container, method, turnaround time, base price and report notes.
  - Parameters: number, free text or pick-from-list; units; decimal places; and formulas such as `TCHOL - HDL - TG / 5`, checked against the test's own parameter codes.
  - Reference ranges by sex and age band (days, months or years), with critical low and high limits or a text range like "Negative".
  - Panels and packages that group tests in report order, with their own price.
  - Removing a parameter deactivates it rather than deleting it, so past results keep their meaning. A test can't be deactivated while a panel still uses it.
  - **Starter catalog**: one click imports about 20 common tests (CBC, LFT, KFT, lipid, thyroid, urine routine and more) plus a health checkup panel. It's safe to run again.
- **Price lists** (Setup → Price lists): special rates per client. Tests without an override use the base price.
- **Patients**:
  - Registration starts with the mobile number and shows everyone already registered on it, since families often share one number.
  - Age can be entered in years, months or days (stored as an estimated date of birth), or as an exact date of birth.
  - Titles such as Mr, Mrs or Master fill in the sex.
  - Consent is recorded as the DPDP Act requires, and ABHA numbers are optional.
  - Each patient gets a lab-wide ID (P000001…) from a per-lab counter, safe when several people register at once.
  - A likely duplicate (same phone or birth date with a similar name) asks before creating a second record.
  - Search works by name, mobile or patient ID. Edits are audited field by field, and opening a record is logged.
- **Referring doctors** (Setup → Referring doctors): duplicates are caught however the name is written ("Dr. A. K. Sharma" = "A K Sharma").
- **Branch switcher**: users with several branches pick where they're working. Registrations record the branch, and the API checks the user has access to it.
- **Orders and billing** (Lab → Orders & billing):
  - The new-order screen covers the patient (or register on the spot), referring doctor, price list, and keyboard test entry.
  - Every order gets a lab number per day (`261004-0007`) and a bill number per financial year (`B/2026-27/000123`).
  - Panels can't double-bill: adding one removes the tests it contains, and a test already inside a chosen panel is refused.
  - Tests with no price can't be billed.
  - Discounts are for managers and owners only (`billing:discount`) and need a reason.
  - Split payments in cash, UPI, card or online, and dues collected later. Two cashiers can't collect the same due.
  - Cancelling with a refund is for managers only.
  - Bills are printable **bills of supply** (diagnostic services are generally GST-exempt; confirm with your CA), with GSTIN, branch address and the amount in words.
- **Finance** (Finance → Finance Dashboard, Export, Bill List, MIS Reports, Financial Reports): totals by payment mode, refunds, discounts and dues, per branch or for all branches.
- **Lab profile** (Settings → Lab profile): lab name, GSTIN, contact details and branches (addresses print on bills).
- **Samples** (Lab → Samples):
  - Each order is split into tubes: one per sample type and container, with panels expanded into their tests.
  - Every tube gets a barcode: the lab number plus a tube number, e.g. `261004000701`.
  - Labels print at 50 × 25 mm, the common thermal label size.
  - Tubes move from to collect, to collected, to received in lab. Scan with any USB barcode scanner; "receive on scan" checks a tube in with one scan.
  - A rejected tube (haemolysed, clotted…) is replaced by a new barcode, and its tests wait for recollection.
  - Cancelling an order cancels its tubes. An order with approved results can't be cancelled.
- **B2B labs** (Setup → B2B Labs): hospitals, clinics, companies and labs that send samples and pay from a prepaid wallet.
  - **B2B Labs tab**: every lab with its credit limit, wallet balance, on hold, net balance and an active switch. Search by name or code; sort by any amount; **Edit**, **Price List** and **Delete** per lab; **Exports** (all labs, or labs with a negative balance) to CSV; **Bulk Upload** from a CSV template; **Bulk Price Edit** (a percentage off or on base prices, or fixed prices, for many labs at once).
  - **Wallet**: *Add Money* records money received (cash, UPI, card or online, with a reference). Net balance = wallet − on hold. A lab can keep ordering while net balance + credit limit stays at or above zero (blank limit = no limit).
  - **Hold, then charge**: an order billed to a lab is *held* when it is placed, taken from the wallet when the lab's first tube is received (Accession), and given back if the order is cancelled. Adding tests to an order adjusts the hold or charge.
  - **Own rates**: *Price List* sets a price per test or package for that lab (download or upload as CSV). A lab-wide *discount %* (on the lab's page) comes off the base price of tests its price list doesn't set.
  - **Lab page** (New B2B Lab / Edit): lab details (name, city, phone, email, active state, center code, address); an optional *B2B letterhead* (full-page background image with header and footer heights and left and right margins, with a sample-report preview) that the lab's reports print on; credit limit, discount, GSTIN; *Permissions and Security* switches; payment methods; the lab's login; and bank details. Switches that change behaviour today: registration below credit limit at B2B lab (off = limit not enforced), report download below credit limit (off = never locked), barcode edit, allow add referral doctor and hide B2B rate from billing (all on the client's order screens). The other switches are stored for the lab.
  - **Wallet History** (every entry, all labs or one), **Ledger** (one lab's statement: opening balance, entries with running balance, closing balance; print or CSV), **Balance (Day Wise)** (money in, out and the combined closing balance per day) and **Balance (B2B Wise)** (each lab's opening, in, out and closing for a period).
  - **Credit/Debit Note**: numbered CN/ and DN/ notes with a reason that add to or take from a lab's wallet, and show in its ledger.
  - **Invoices**: a statement of the orders already taken from a lab's wallet in a period (INV/2026-27/000001; last month in one click), printable. It takes nothing more from the wallet. A wrong invoice can be voided and its orders re-invoiced.
  - A lab with orders or wallet history can't be deleted (switch it off instead). Switching a lab off signs its people out at once.
  - Every wallet change is audited. Credit limits, holds and charges are applied in one database step, so two orders at the same moment can't both squeeze under the limit.
- **B2B client portal** (`/portal`): a lab's own people sign in at the normal sign-in page (add them under Edit → Portal logins; they choose their own password at first sign-in). They see only their own lab:
  - Dashboard (wallet, on hold, net balance, what they can still order, orders today, reports pending and ready), **New order** (register or pick a patient, pick tests at the lab's own rates, place the order; barcode labels print as a PDF), **Orders & reports** (status, labels, report PDF once approved, cancel until the lab receives the sample), **Wallet**, **Ledger**, **Invoices** and **My rates**.
  - Their login has one permission (`b2b:portal`) and none of the lab staff's, so every staff screen and API answers 403. They only ever see patients they registered and orders for their own lab; the lab id comes from their login, never from the request.
- **Results** (Lab → Results):
  - Worklists: to enter (tests whose tube is in the lab), awaiting approval, and approved. Filter by department; oldest orders come first.
  - The entry sheet works by keyboard: Enter moves to the next box. Each value is checked against the patient's reference range (by age and sex) as it's typed: low and high are marked, critical values turn the row red.
  - Calculated values (LDL, A/G ratio…) update live, and each parameter shows the patient's previous result.
  - Technicians save and submit; pathologists approve (one test or all at once), send back with a note, or reopen approved results with a reason.
  - Results keep the unit and range they were entered with, so a later catalog change doesn't alter old reports.
  - Rejecting a tube clears the results taken from it.
  - Every save, approval and reopen is in the audit log.
- **Reports** (Lab → Reports, and the Report panel on each order):
  - A4 PDF with the lab header, patient details, results grouped by department, high and low flags in red, reference ranges, remarks and test notes.
  - Only approved tests print. If some are still pending, the report says **Partial**; results reopened and re-approved are marked **amended**.
  - Signed electronically by the approving pathologist, with qualification and registration number (set them in Settings → Users & roles).
  - A QR code on every page links to the patient's report page.
  - **Patient link** (`/r/<token>`): no sign-in, valid for 90 days, shows only the first name until the PDF is opened. It picks up tests approved later.
  - **WhatsApp through AiSensy**: each lab chooses its own AiSensy account (key stored encrypted) or the platform's shared one (Settings → Lab profile). Every attempt, sent or failed, is kept on the order.

- **Passwords and staff access:**
  - "Forgot password?" on the sign-in page emails a one-time link (30 minutes). It doesn't reveal whether an email has an account, and using it signs out every device.
  - Settings → Security: change your own password (other devices are signed out).
  - Settings → Users & roles, per user: edit details, change roles and branch (applies at once), email a reset link, set a temporary password (they must choose their own at next sign-in), disable or enable. A lab always keeps at least one active owner, and only owners manage owners.
  - Emails go out through any SMTP service (`SMTP_URL`). Locally they're saved in `.local-mail/` instead.
- **Platform admin console** (`/admin`, for the team that runs the SaaS, not lab staff):
  - Overview: labs by plan and status, new labs, active users, orders, and renewals or trials ending within 30 days.
  - Labs: plan, subscription status and end date, owner contact, users, branches, usage (patients, orders, billing, reports sent), how long they've been a customer, last activity.
  - Users across every lab: roles, branch scope, the full permission map, active devices, recent activity, tenure.
  - Super admins can change a lab's plan, end date or status (suspending signs everyone out at once), disable or re-enable a user, and sign a user out everywhere. Each needs a reason, goes in the platform audit log, and shows in the lab's own audit log.
  - **Access and permissions per lab** (on each lab's page): switch modules off (B2B labs, WhatsApp delivery, multiple branches), adjust what each role can do in that lab (including the owner) in a role-by-permission grid, and set user and branch limits. Changes apply to signed-in users at once and are logged with a reason.
  - For any user (owners included): change roles and branch, email a reset link or set a temporary password.
  - Support admins can look but not change anything.
  - Admins have their own accounts and tokens, kept apart from lab logins. Sessions last 12 hours, and sign-in is limited to 5 attempts per 15 minutes.
  - **Two-step sign-in** with an authenticator app (Google or Microsoft Authenticator...), with 8 one-time recovery codes. Required in production (`ADMIN_MFA_REQUIRED`): until it's set up, the console only shows the setup. A super admin can reset someone's two-step sign-in if they lose their phone.
  - Create the first admin with `npm run admin:create -w api -- you@company.com "Your Name"`. It prints a one-time password. Locally, `npm run dev:local` seeds `admin@platform.test` and `support@platform.test`.
  - New labs start on a 14-day trial (`TRIAL_DAYS` in `apps/api/src/modules/tenants/tenant.service.ts`).

> The starter catalog's reference ranges are typical adult textbook values, not validated ones. Each lab's pathologist must review them and add paediatric ranges before reporting. See `apps/api/src/modules/catalog/starter-catalog.ts`.

## Analyzers (machine results)

Settings → Analyzers sets up lab machines that send results over the network (ASTM E1381/E1394 or HL7 v2, TCP).

- **The interface program** (`tools/interface/interface.mjs`, `interface.bat` on Windows) runs on a PC on the analyzers' network. It listens on each analyzer's port (or connects to it), handles the low-level framing (ENQ/STX/ETB/ETX with checksums, or HL7 MLLP with ACKs) and posts the message text to `POST /api/interface/messages` with a per-PC key (Settings → Analyzers → Create key). Messages are written to a disk queue first, so nothing is lost while LabOS is unreachable. It works the same whether LabOS runs on that PC or online.
- **LabOS reads the message** (`apps/api/src/modules/instruments/parse.ts`), finds the tube by barcode, links each analyzer code to a test parameter (linked codes, else the same code; suggestions for common ones such as HGB → HB) and saves the values as *entered* through the normal results path, marked with the analyzer's name. Tests already submitted or approved are never changed. Every message is logged with what happened to each value, and can be retried.
- **Trying it without a machine:** `npm run interface:simulate -- --port 5100 --barcode <barcode> [--protocol astm|astm-plain|hl7] [--values "GLU=96"]`.

## Try it on this computer (no cloud services)

```bash
npm install
npm run dev:local
```

This runs everything locally. Postgres is [PGlite](https://pglite.dev) (Postgres compiled to WebAssembly), saved in `.local-db/`, and Redis is a small in-memory stand-in. A demo lab is created on first run.

Stop it with Ctrl+C, or `npm run dev:stop` from another terminal. Always stop it cleanly: a hard kill can leave the local database unreadable.

Open http://localhost:3000 and sign in as `owner@demo-lab.test` (the password is at the top of `apps/api/prisma/seed.ts`). Delete `.local-db/` to start again. Use the real setup below for anything beyond trying things out.

## First-time setup

You need Node.js 20.9+ and two free cloud services:

1. **PostgreSQL** at [neon.tech](https://neon.tech) (or Supabase). Create a project and copy two connection strings:
   - the **pooled** one, for `DATABASE_URL`;
   - the **direct** one, for `DIRECT_URL`. On Neon that's the same URL without `-pooler` in the host.
2. **Redis** at [upstash.com](https://upstash.com). Create a database and copy the `rediss://…` URL into `REDIS_URL`.

Then:

```bash
npm install
cp apps/api/.env.example apps/api/.env      # fill in the URLs above
npm run secret -w api                       # paste the output into JWT_ACCESS_SECRET
npm run db:migrate                          # creates the tables
npm run db:seed                             # optional: a demo lab with 4 users, the starter catalog and sample prices
npm run dev                                 # API on :4000, web on :3000
```

To send reports on WhatsApp, set `PUBLIC_BASE_URL` to the web app's public address (AiSensy fetches the PDF from there), and optionally `AISENSY_API_KEY` and `AISENSY_CAMPAIGN` for the shared account. In AiSensy, create a Live API campaign whose approved template has a document header and two variables: {{1}} patient name, {{2}} lab name.

Open http://localhost:3000 and create a lab, or sign in with a demo account. The emails and password are at the top of `apps/api/prisma/seed.ts`.

## How the pieces connect

The browser only talks to the Next.js app. Next.js forwards `/api/*` to the Express API (see `apps/web/next.config.ts`), so the refresh cookie is first-party and there's no CORS in normal use. In production, set `API_URL` on the web app to the API's internal address.

```
apps/api/src
  config/env.ts          validated environment variables
  lib/                   prisma, redis, tokens, passwords, tenant-scoped db, access cache, audit, rate limit
  middleware/            authenticate + requirePermission, body validation, error handler
  modules/auth           signup, login, refresh, logout, sessions
  modules/users          list roles, list and create users
  modules/tenants        create a lab with its defaults
  modules/catalog        departments, tests, parameters, ranges, panels, price lists, starter catalog
  modules/patients       patients (UHIDs, duplicates, search) and referring doctors
  modules/orders         orders, bills, payments, refunds, day-end collections
  modules/lab            lab profile and branches
  modules/samples        tubes, barcodes, collection, receiving, rejection
  modules/results        result entry, flags, formulas, approval, worklists
  modules/reports        report PDF (react-pdf), patient links, WhatsApp via AiSensy
  modules/accounts       B2B labs: wallets, ledger, notes, price lists, invoices, and the client portal API (/api/b2b)
  modules/admin          platform admin console: its own sign-in, labs, users, subscriptions, audit
apps/web/src
  app/(auth)             login, signup
  app/(app)              signed-in pages: dashboard, catalog, orders, samples, results, reports, settings
  app/r/[token]          the patient's report page (no sign-in)
  app/admin              the platform admin console (signs in at /login like everyone else)
  components/app-shell   sidebar (filtered by permission), user menu
  components/inputs      number, money (₹ ↔ paise) and age (days) inputs
  lib/api.ts             fetch wrapper: attaches the token, refreshes once on 401
  providers/             auth context
```

### Adding a protected endpoint

```ts
router.get("/patients", authenticate, requirePermission("patients:read"), async (req, res) => {
  const { db } = ctx(req);                       // tenant-scoped Prisma client
  res.json(await db.patient.findMany());         // tenantId is added for you
});
```

For a new tenant-owned model, add a `tenantId` column and add the model name to `TENANT_MODELS` in `apps/api/src/lib/tenant-db.ts`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API and web together, with reload |
| `npm run dev:local` | The same, on a local PGlite database with no cloud services |
| `npm run test:api` | API tests against a fresh in-memory database (`-- samples` to run one file) |
| `npm run build` | Production builds of both apps |
| `npm run typecheck` | TypeScript across all packages |
| `npm run db:migrate` | Create and apply a migration after editing `schema.prisma` |
| `npm run db:seed` | Add the demo lab |
| `npm run db:studio` | Browse the database |

## Putting it online

See **[deploy/DEPLOY.md](deploy/DEPLOY.md)**: one Ubuntu server (Hostinger VPS, AWS Lightsail...), one setup script. It runs Postgres, Redis, the API and the web app in Docker, with automatic HTTPS (Caddy) and nightly database backups.

`npm run test:api -- --prod` runs the whole API test suite against the production builds, through the web app's `/api` proxy, as deployed.

## Next steps

1. Postgres row-level security as a second isolation layer (planned in the design doc).
2. B2B extras: emailing invoices and reports to the account, a client login for hospitals to see their patients' reports.
4. Inventory (reagents, kits, consumables) and quality control (Levey-Jennings, Westgard rules).
5. Analyzer integration (ASTM / HL7) for the lab's machines.
