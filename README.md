# Local Access

A Next.js sign-in and account administration app. The app server handles passwords, MFA, sessions, Google sign-in, and role checks. Supabase Postgres stores accounts and security events. The browser never connects to the database.

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

The `.env.local` file is git-ignored. Store it and the Supabase database password privately. Back up the pepper, MFA key, and database separately; losing either key can make existing accounts inaccessible.

## Optional Google sign-in

1. In Google Cloud Console, configure the OAuth consent screen and create an OAuth client with application type **Web application**.
2. Add this exact authorized redirect URI: `http://127.0.0.1:3000/api/auth/google/callback`.
3. Put the client ID and client secret in `.env.local` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart the local server.
4. Use **Continue with Google** on the sign-in or registration screen. Google identities are verified server-side and receive the basic user role. All Google sign-ins must also enroll or verify this app's authenticator MFA.

Google accounts are keyed by Google's stable subject identifier. The app does not automatically link a Google identity to an existing password account by matching email. It requests only the `openid email` scopes and does not store Google access tokens.

## Roles and permissions

- **Admin:** account list, create, disable, re-enable, role changes, permanent deletion, and security audit events. The last active admin cannot be demoted, disabled, or deleted. An admin cannot disable or delete their own signed-in account.
- **Computer administrator:** view accounts, create basic users, and enable or disable basic users and managers. Cannot alter administrator accounts or assign roles. This is an application role; it does not grant Windows or host operating-system privileges.
- **Manager:** read-only view of the basic-user roster. Team-specific data scoping is not included because this starter has no business-record model.
- **User:** sign in, use MFA, and change their own password after confirming the current password and MFA.

All role permissions are checked in the backend for each API request. Interface controls are not treated as security boundaries.

## Security design

- Passwords are HMACed with `AUTH_PEPPER`, then hashed with Argon2id. Argon2 creates a unique random salt per password and includes it in the encoded hash. Passwords and raw salts are not stored.
- TOTP seeds are encrypted with AES-256-GCM under the separate `MFA_ENCRYPTION_KEY`. Recovery codes are shown once, stored as keyed hashes, and can only be used once.
- The browser receives a random opaque session token in an HttpOnly, SameSite=Strict cookie. Supabase stores only its SHA-256 digest. Sessions expire after 30 minutes. Password changes and account status changes invalidate existing sessions.
- Mutating API requests must include the exact same origin configured by `APP_ORIGIN` (default `http://127.0.0.1:3000`). Login failures and MFA verification failures are throttled by account name and written to Postgres. Audit events omit passwords, MFA codes, recovery codes, and session tokens.
- Database statements are parameterized, TLS certificate verification is enabled, and RLS is enabled on every app table with no public policies. The `DATABASE_URL` is read only by the server.

The default server binds to loopback for local use. For access from other devices, use a properly configured HTTPS reverse proxy, set `APP_ORIGIN` to the HTTPS origin, bind only to the required private interface, and configure firewall rules. Do not expose the Next.js development server to the public internet.

This is an educational starter. Add a security review, operational monitoring, protected backup and recovery procedures, and deployment hardening before using it for sensitive or regulated information.
