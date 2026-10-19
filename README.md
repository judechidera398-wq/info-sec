# Library Management System

A secure library operations app for book catalogue management, member records, circulation, and staff access. The Next.js server handles passwords, MFA, sessions, Google sign-in, and role checks. Supabase Postgres stores accounts, books, members, loans, and security events. The browser never connects directly to the database.

See [the system security and CIA Triad documentation](docs/system-security-and-cia-triad.md) for the architecture, authentication and role flows, data handling, threats, information-security principles, operational guidance, and limitations.

## Expo mobile app

The Expo app lives in [`mobile/`](mobile/). It supports password and authenticator MFA sign-in, catalogue search, and staff views for members and loans. It uses the same API and server-side role enforcement as the web app.

From the `mobile` folder, run `npm install`, copy `.env.example` to `.env` if you want to change the API URL, then run `npx expo start` and open the project in Expo Go. Expo Go targets the SDK 57 project template. Set `EXPO_PUBLIC_API_URL` to the deployed HTTPS origin for normal use. For local phone development, start Next.js from the repository root with `npm run dev:lan`, set the URL to `http://<your-computer-LAN-IP>:3000`, and keep both devices on the same trusted Wi-Fi. `localhost` on the phone refers to the phone itself; regular `npm run dev` remains loopback-only.

Mobile Google sign-in is not wired yet; the existing Google OAuth callback is for the web app. Never put OAuth client secrets or server-side keys in Expo public environment variables.

## Requirements

- Node.js 24 LTS recommended (Next.js 16 requires Node.js 20.9 or newer)
- npm
- A Supabase project
- Windows, macOS, or Linux

## Set up Supabase

1. Create a project in Supabase.
2. In the project dashboard, select **Connect**, then copy a Postgres connection string. For a local Node server, use the **Session pooler** string if the direct endpoint is unreachable on your network. Replace its password placeholder with your database password and URL-encode reserved characters.
3. Copy `.env.example` to `.env.local` if you do not already have `.env.local`. Keep the existing `AUTH_PEPPER` and `MFA_ENCRYPTION_KEY` values when importing the existing SQLite accounts; do not regenerate them.
4. Set `DATABASE_URL` in `.env.local` to the connection string. `DATABASE_CA_CERT_PATH` can point to the database CA certificate downloaded from Supabase Database Settings for explicit certificate verification.
5. Stop the running Next.js server before importing, so no local sign-ins change while the data is copied.

## Initialize and import

The schema includes an idempotent upgrade for existing installations: it adds library tables and maps the former computer administrator role to manager while preserving existing admin, manager, and reader accounts. Run `supabase/schema.sql` in the Supabase SQL Editor (or run `npm.cmd run db:init` locally) before using the library features. Existing records remain in place.

If you installed Node.js system-wide, run these commands from the project folder after installing dependencies. On this computer Node.js is available in the project’s `.tools` folder, so in PowerShell you can use:

```powershell
$env:Path = "$PWD\.tools\node\node-v24.20.0-win-x64;$PWD\.tools\corepack\v1\npm\11.6.2\bin;$env:Path"
npm.cmd install
npm.cmd run db:init
npm.cmd run db:import-sqlite
```

The app can then be started from that same PowerShell window with `npm.cmd run dev`.

For a normal Node.js installation, run:

```powershell
node scripts/init-db.mjs
node scripts/migrate-sqlite-to-supabase.mjs
```

The importer requires an empty Supabase database. It copies accounts, password hashes, Google subject IDs, encrypted MFA seeds, pending sessions, recovery codes, failed-login counters, and audit events in one transaction. It leaves the SQLite file unchanged and prints counts only. Keep `AUTH_PEPPER` and `MFA_ENCRYPTION_KEY` unchanged so existing passwords and encrypted authenticator seeds remain usable.

If the imported database does not contain an active admin, create one in an interactive terminal:

```powershell
node scripts/create-admin.mjs admin
```

The password is entered without being displayed. Start the app with `npm run dev`, open <http://127.0.0.1:3000>, and sign in. The database schema enables Row Level Security on all tables without public Data API policies; only the server's database connection is intended to access account data. Never put `DATABASE_URL` or a Supabase secret/service-role key in client-side code.

The `.env.local` file is git-ignored. Store it and the Supabase database password privately. Back up the pepper, MFA key, backup encryption key, and database separately; losing a key can make accounts or backups inaccessible.

For encrypted in-app backups, generate a separate 32-byte key in PowerShell and add it as `BACKUP_ENCRYPTION_KEY` in `.env.local` and the hosting provider's server-side environment:

```powershell
$backupKeyBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($backupKeyBytes)
[Convert]::ToBase64String($backupKeyBytes)
```

Keep this key separately from downloaded backup files. Losing it prevents backup decryption.

## Optional Google sign-in

1. In Google Cloud Console, configure the OAuth consent screen and create an OAuth client with application type **Web application**.
2. Add this exact authorized redirect URI: `http://127.0.0.1:3000/api/auth/google/callback`.
3. Put the client ID and client secret in `.env.local` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart the local server.
4. Use **Continue with Google** on the sign-in or registration screen. Google identities are verified server-side and receive the basic user role. All Google sign-ins must also enroll or verify this app's authenticator MFA.

Google accounts are keyed by Google's stable subject identifier. The app does not automatically link a Google identity to an existing password account by matching email. It requests only the `openid email` scopes and does not store Google access tokens.

## Deploy to Vercel

1. Import `judechidera398-wq/info-sec` as a Next.js project in Vercel. Add Production environment variables before deploying because the app validates its pepper and MFA encryption key at startup/build time. Add `BACKUP_ENCRYPTION_KEY` too if admins should download or restore encrypted system backups.
2. Set `DATABASE_URL` to the Supabase **Transaction pooler** URI from the project Connect panel; this is the pooler mode intended for serverless functions. Do not use the local Session pooler URL for the hosted deployment.
3. Add `DATABASE_CA_CERT` with the PEM contents of the Supabase root certificate (`prod-ca-2021.crt`). The server still verifies the certificate. Keep `DATABASE_CA_CERT_PATH` for local use; do not depend on a certificate file being present in the deployment bundle.
4. Set `AUTH_PEPPER` and `MFA_ENCRYPTION_KEY` to the same values as `.env.local`. Set `BACKUP_ENCRYPTION_KEY` to the backup key you generated. Set `GOOGLE_CLIENT_ID`, a newly rotated `GOOGLE_CLIENT_SECRET`, and `APP_ORIGIN` to the final HTTPS Vercel production origin, for example `https://your-project.vercel.app`.
5. In Google Cloud, add that origin under **Authorized JavaScript origins** and `https://your-project.vercel.app/api/auth/google/callback` under **Authorized redirect URIs**. The callback URI must exactly match `APP_ORIGIN` plus `/api/auth/google/callback`.
6. Use Vercel's Node.js runtime. Deploy, then test a password sign-in, MFA, Google sign-in, and role-restricted pages.

Keep production values in Vercel's environment variable settings as secrets. Never add `.env.local`, database connection URLs, peppers, encryption keys, or OAuth client secrets to Git. Only configure Preview variables if preview deployments should be allowed to access the production database and OAuth client.

## Roles and permissions

- **Admin:** manage staff accounts and roles; add, edit, and delete books; manage members and loans; view recent audit events. The last active admin cannot be demoted, disabled, or deleted, and an admin cannot change or delete their own account.
- **Manager:** add and edit books, manage member records, check books out and record returns, and view circulation status. Cannot manage staff roles or permanently delete books.
- **Inputer:** routine catalogue, member, checkout, and return entry. Cannot manage staff accounts or delete books.
- **Reader (`user`):** read-only access to search and view the catalogue. Public registration and new Google accounts receive only this role; only an admin can grant staff roles.

All role permissions are checked in the backend for each API request. Interface controls are not treated as security boundaries.

## Library features

- Search the catalogue by title, author, ISBN, or category. Store publisher/year and track total versus available copies.
- Register members with a unique member number and contact details. Members can be deactivated; active loans must be returned first.
- Check out available copies to active members with a due date. Database transactions lock inventory rows so concurrent checkouts cannot overspend available copies.
- Record returns once, update available inventory, and view active, overdue, and returned loans.
- Books with loan history cannot be permanently deleted, preserving circulation records. Only admins can delete books without loan history.
- Admins can create accounts with any role, assign roles, disable accounts, and review recent audit events. Deletion marks an account as deleted, revokes sessions, and retains its row for history; an admin can restore it.
- Admins can change the library name, default loan period, and active-loan limit. The limit is enforced by the server when checking out books.
- Configuration restore points store settings only. Restoring one never changes catalogue, members, circulation, or accounts.
- Admins can download and restore full-system backups encrypted with `BACKUP_ENCRYPTION_KEY`. They include account hashes and MFA ciphertext as well as library data. Restore replaces current rows and invalidates sessions; use only a backup and cryptographic keys from the same system.

The current starter does not include reservations, fines/payments, barcode scanning, email reminders, member self-service accounts, or multi-branch inventory.

For a demonstration database, first apply `supabase/schema.sql` in Supabase SQL Editor, then run `supabase/demo-seed.sql` against a **test/staging database** for fictional books, members, and loans. To create four demo accounts with different roles and unique one-time passwords, set `DEMO_USERS_ENABLED=true` only for a disposable database and run `npm.cmd run demo:users`; the generated passwords are printed once, and each account must enroll in MFA. Never enable this on production. Do not load sample data into a live library database.

The application currently runs on Vercel with Supabase. Admins can download an encrypted backup file and store it separately (for example, in a private S3 bucket with public access blocked and versioning enabled). Automatic AWS uploads are not configured. Create and secure your own AWS account before storing backups there; enable MFA on the AWS root account and use a separate least-privilege identity for routine work.

## Security design

- Passwords are HMACed with `AUTH_PEPPER`, then hashed with Argon2id. Argon2 creates a unique random salt per password and includes it in the encoded hash. Passwords and raw salts are not stored.
- TOTP seeds are encrypted with AES-256-GCM under the separate `MFA_ENCRYPTION_KEY`. Recovery codes are shown once, stored as keyed hashes, and can only be used once.
- The browser receives a random opaque session token in an HttpOnly, SameSite=Strict cookie. The mobile app stores its active token with Expo SecureStore. Supabase stores only the token's SHA-256 digest. Sessions expire after 30 minutes. Password changes and account status changes invalidate existing sessions.
- Browser mutations must include the exact same origin configured by `APP_ORIGIN` (default `http://127.0.0.1:3000`); mobile mutations require a valid bearer session. Login failures and MFA verification failures are throttled by account name and written to Postgres. Audit events omit passwords, MFA codes, recovery codes, and session tokens.
- Database statements are parameterized, TLS certificate verification is enabled, and RLS is enabled on every app table with no public policies. The `DATABASE_URL` is read only by the server.

The default server binds to loopback for local use. For access from other devices, use a properly configured HTTPS reverse proxy, set `APP_ORIGIN` to the HTTPS origin, bind only to the required private interface, and configure firewall rules. Do not expose the Next.js development server to the public internet.

This is an educational starter. Add a security review, operational monitoring, protected backup and recovery procedures, and deployment hardening before using it for sensitive or regulated information.
