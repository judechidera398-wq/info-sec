# Library Management System

## System and information-security design

**Project:** Library Management System (`info-sec`)
**Document purpose:** Describe the implemented library, authentication, and account-administration system and relate its controls to information-security principles.
**Implementation:** Next.js 16 application, Node.js server routes, and Supabase PostgreSQL.
**Status:** Educational project / security design documentation. This document is not a certification or independent security audit.

## 1. Executive summary

The Library Management System (LMS) is a web application for book cataloguing, member records, loan checkout and returns, account sign-in, two-factor authentication (2FA), and role-based administration. The browser communicates with the Next.js application server. The server verifies credentials, applies authorization rules, and connects to Supabase PostgreSQL using server-only configuration. It supports password sign-in and optional Google OpenID Connect sign-in. Both sign-in paths create a **pending** session; users must enroll in or verify an authenticator before that session becomes an **active** session.

The implementation applies several defense-in-depth controls: Argon2id password hashing with a server-side pepper, encrypted TOTP secrets, one-time recovery codes, short-lived opaque sessions, backend role checks, login throttling, parameterized SQL, TLS certificate validation, origin checks for state-changing requests, and audit events. These controls reduce risk, but they do not make the application invulnerable. Production use still requires operational safeguards, independent security review, and testing against a defined threat model.

## 2. Scope and architecture

```text
Reader, inputer, manager, or admin browser
     │ HTTPS in hosted deployment; local HTTP only for loopback development
     ▼
Next.js UI and Node.js route handlers
     ├── password / Google identity verification
     ├── TOTP and recovery-code verification
     ├── catalogue, member, and circulation workflows
     ├── session and role enforcement
     └── parameterized SQL over verified TLS
             ▼
       Supabase PostgreSQL
```

The application server is the security boundary between the web and mobile clients and the database. The clients do not receive the database connection string, pepper, MFA encryption key, backup encryption key, or Google client secret. The database schema contains authentication tables (`users`, `sessions`, `mobile_oauth_tickets`, `pending_mfa`, `recovery_codes`, `login_attempts`, `audit_events`), library tables (`books`, `library_members`, `loans`), and configuration tables (`system_settings`, `system_config_snapshots`). Foreign keys and indexes support referential integrity and common lookups. Row Level Security (RLS) is enabled on all tables, with no public Data API policies defined in the project schema. The application connects through its server-side PostgreSQL connection.

Supabase PostgreSQL is hosted, so the current Supabase-backed application is not an offline or air-gapped system; the server needs network access to the database. The repository also contains a SQLite-to-Supabase migration tool, but there is no automatic offline database fallback in the deployed application.

### Main components

| Component | Responsibility |
| --- | --- |
| `src/app` | Login and account-management interface and server route handlers. |
| `src/lib/security.ts` | Password peppering and hashing, session-token digests, and authenticated encryption helpers. |
| `src/lib/auth.ts` | Session lifecycle, attempt throttling, recovery codes, audit writes, and role checks. |
| `src/lib/mfa.ts` | TOTP creation, verification, encrypted setup state, and QR provisioning. |
| `src/lib/db.ts` | Server-only PostgreSQL pool, parameterized query helpers, and transactions. |
| `src/lib/backup.ts` and `src/app/api/admin/backup` | Authenticated AES-256-GCM encrypted database exports and transactional restores. |
| `src/app/api/settings` | Admin-managed library settings and configuration-only restore points. |
| `src/components/library-console.tsx` | Interactive catalogue, member, circulation, and staff screens. |
| `src/app/api/books`, `members`, `loans` | Protected catalogue, member, and circulation APIs. |
| `supabase/schema.sql` | PostgreSQL tables, constraints, indexes, and RLS enablement. |
| `scripts/migrate-sqlite-to-supabase.mjs` | Read-only SQLite source migration into an empty Supabase schema, using a transaction. |
| `scripts/create-admin.mjs` | Interactive initial administrator creation; the entered password is not echoed. |
| `scripts/seed-demo-users.mjs` | Test-only creation of four role examples with generated passwords and salted hashes. |

## 3. Identity, authentication, and account lifecycle

### Password registration and storage

Registration accepts usernames of 3–64 permitted characters and passwords of 12–256 characters. New public registrations are assigned the basic `user` role; they cannot choose a privileged role. Before Argon2id hashing, the server applies HMAC-SHA-256 using `AUTH_PEPPER` and a password-specific purpose label. Argon2id generates and encodes a unique random salt for each password, along with the algorithm parameters and derived hash. The plaintext password and a separately managed salt are not stored. The pepper is stored separately from the database in server environment configuration. Password changes require the current password and a valid MFA code or unused recovery code.

The current Argon2id parameters are 64 MiB memory, 3 iterations, and 2 lanes/parallelism. They should be benchmarked on the production runtime and periodically reviewed. Losing or changing `AUTH_PEPPER` without a planned rehash migration prevents verification of existing password hashes.

### Two-factor authentication

The app uses a password plus a time-based one-time password from an authenticator application. TOTP is configured for a 6-digit code with a 30-second period. A newly created account begins MFA enrollment after password authentication; Google-created accounts are also assigned the basic role and must enroll in MFA. Users with an enrolled factor must verify it at each new password or Google sign-in before the session becomes active. The TOTP seed is encrypted at rest with AES-256-GCM using the separate `MFA_ENCRYPTION_KEY`; the key must be a base64-encoded 32-byte value and must be backed up securely.

The app creates eight random recovery codes during enrollment. It returns the plaintext codes once and stores purpose-keyed HMAC digests. A code is marked used inside a database transaction when redeemed, and cannot be used again. Losing both the authenticator and the recovery codes currently has no self-service recovery flow; an administrator must handle account recovery through an operational procedure that is not implemented here.

TOTP is a possession-based second factor, but it is not phishing-resistant: a real-time phishing proxy may capture a code. This implementation is an educational MFA baseline, not a claim of conformance to a particular assurance level.

### Google sign-in

Google sign-in uses the OpenID Connect authorization-code flow with PKCE (S256), state and nonce values, short-lived HttpOnly cookies, and server-side ID-token verification against Google's signing keys. The callback validates issuer, audience, signature algorithm, nonce, verified email, and subject. Google accounts are identified by the stable `sub`; the application does not automatically link a Google identity to an existing local account by email. Google access tokens are not stored. Google identity proves the external account; the application still requires its own TOTP enrollment or challenge before granting an active local session. The mobile app opens this same hosted flow in the system browser. After callback validation, the server sends the app a two-minute, single-use ticket; only its SHA-256 digest is stored, and exchanging it rotates the pending session token. Native Google OAuth requires a development build with the `vaultofvalue://` scheme; Expo Go cannot receive that callback.

### Session management

After the first factor, the server creates a random 256-bit opaque token. The browser receives it in an HttpOnly cookie; the mobile app receives it after MFA and stores it in Expo SecureStore. The database stores only the SHA-256 digest of the token. The initial session is marked `pending`; successful MFA rotates the token and changes the session to `active`. Sessions expire after 30 minutes. The cookie uses `SameSite=Strict`, `Path=/`, and is marked `Secure` when `APP_ORIGIN` is HTTPS. Logout removes the server-side session. Password changes and account disablement increment a session version; old sessions no longer match the account version and are rejected. A successful activation also removes other sessions for that user.

## 4. Authorization and role model

Authorization is enforced in server route handlers on every protected request. Hiding a button in the user interface is not considered permission enforcement. The implemented roles and permissions are:

| Role | Implemented access |
| --- | --- |
| **Admin** | Create accounts in any role; disable, re-enable, soft-delete, and restore accounts; modify library configuration; create configuration restore points; export and restore encrypted backups; manage books and members; issue and return books; delete books without loan history; view audit events. Cannot change/delete own signed-in account. The final active admin cannot be demoted, disabled, or soft-deleted. |
| **Manager** | Add/edit books; manage member records; check out books and record returns; review overdue and circulation status. Cannot manage staff roles or permanently delete books. |
| **Inputer** | Routine book, member, checkout, and return data entry. Cannot manage staff accounts or delete books. |
| **Reader (`user`)** | Search and read the catalogue only; no member-contact, loan, or staff-management access. Public registration and new Google accounts receive this role. |

New registration and Google-created accounts always receive `user`. Only the admin route can assign staff roles. The schema migration maps former `computer_admin` accounts to `manager`; existing admins and managers remain in their roles. If a session is absent or still pending, protected routes deny access. Invalid roles and IDs are rejected. The last-active-admin checks reduce the risk of accidental administrative lockout.

### Library data lifecycle

Staff can search and add books with ISBN, title, author, category, publisher, year, and copy counts. Updates lock the selected inventory row and preserve the number of copies already checked out. Checkout locks the book and member rows in one transaction, confirms an active member and an available copy, reduces availability, and creates the loan. Return locks the loan, refuses duplicate returns, marks it returned, and restores one available copy in the same transaction. This protects inventory counts during concurrent requests.

Member contact details are restricted to admin, manager, and inputer roles. A member with an open loan cannot be deactivated. Loan history is preserved: books referenced by loans cannot be deleted, and member records have no hard-delete route. User deletion is a soft delete: it sets the account inactive, increments the session version, and keeps the row and relationships for history. Admins can restore deleted accounts. Readers only receive catalogue data. This starter has no reservations, fines, barcode scanning, multi-branch stock, email reminders, or patron self-service borrowing history.

## 5. Mapping to information-security principles

### CIA Triad

| Principle | Meaning | Controls in this system | Remaining concern |
| --- | --- | --- | --- |
| **Confidentiality** | Prevent disclosure to unauthorized parties. | Argon2id password hashes; separate pepper; encrypted TOTP seeds; hashed session tokens and recovery codes; HttpOnly cookies; server-only database connection; role checks restrict member contacts and loans to staff; verified TLS to PostgreSQL; limited Google scopes (`openid email`). | A compromised application server, leaked environment secrets, privileged database credential, browser malware, or misconfigured hosting can expose data. Backups and secrets need protected storage and access controls. |
| **Integrity** | Prevent or detect unauthorized/incorrect changes. | Parameterized SQL; role checks for mutations; same-origin check on state-changing routes; MFA confirmation for password changes; database constraints/foreign keys; row locks and transactions for checkout, return, and inventory edits; audit events for selected authentication and library actions. | The application database credential can make writes directly; RLS has no public policies but is not a substitute for application authorization. Audit rows live in the same database and are not tamper-proof against a sufficiently privileged database operator. |
| **Availability** | Ensure authorized users can access the service and data when needed. | Login throttling; short DB connection timeout; indexes for catalogue/member/loan/security queries; transaction-safe copy tracking; Supabase-hosted database; admin lockout protections; encrypted export and restore. | Backup restoration has not been independently rehearsed; no high-availability target, incident response, alerting, resource quotas, automated offsite backup, or distributed IP-based rate limiting. A database/provider outage or denial-of-service can prevent sign-in and circulation. |

### Other principles and how they appear

| Principle | Application |
| --- | --- |
| **Authentication vs. authorization** | Authentication establishes which account is signing in; role authorization independently decides which requested operation that account may perform. A successful login does not imply administrator access. |
| **Least privilege** | Public sign-ups and Google registrations receive read-only `user`; inputers can enter routine records but cannot delete books or manage accounts; managers handle library operations but cannot change roles; only admins control staff roles and destructive book operations. |
| **Deny by default** | Protected handlers require an active session and an explicitly allowed role. Pending MFA sessions are not treated as signed-in active sessions. |
| **Defense in depth** | Password hashing, MFA, short sessions, role checks, origin validation, throttling, TLS, secret separation, database constraints, and audit events are layered controls; no single one is the whole security model. |
| **Separation of duties / privilege separation** | Reader, inputer, manager, and admin permissions differ. This provides a basic separation, but there is no approval workflow or independent review for high-impact actions. |
| **Accountability and traceability** | Authentication and account-administration events are written to `audit_events`; login and MFA attempts are recorded and old attempts are pruned. Audit visibility is admin-only and limited to the latest 200 records through the API. |
| **Data minimization** | Google scopes are restricted to identity and email; no Google access token is stored. Passwords, MFA codes, recovery codes, and raw session tokens are not intended to be written to audit events. |
| **Secure defaults / fail closed** | Server-only environment validation rejects short or absent pepper/key settings; database TLS requires certificate verification; unknown roles and invalid requests are rejected; the database has no public RLS policies. |
| **Non-repudiation (limited)** | Audit events provide an application record of some actions, but do not provide strong non-repudiation: an administrator or database operator may alter database records, and there is no external append-only log or digital signature. |
| **Privacy** | Reader accounts only access book-catalogue data; member contacts are restricted to staff roles. Audit retention and member privacy notice/consent processes are not fully specified in the implementation. |

## 6. Threats and controls

| Threat | Relevant mitigation | Residual risk / limitation |
| --- | --- | --- |
| Database dump exposes passwords | Per-password Argon2id salts plus a pepper held outside the database. | An attacker who obtains both database and pepper can perform offline guessing; weak user-selected passwords remain vulnerable. |
| Credential stuffing or password guessing | Mandatory 2FA for completing sign-in; per-username throttle after 8 failed attempts within 15 minutes; generic invalid-credential message. | The throttle is database-backed and keyed by username, not a distributed IP/device control; attackers can distribute attempts across names or cause targeted lockout. |
| Stolen or forged browser session | High-entropy random token; only token digest stored; HttpOnly/SameSite cookie; expiry; DB lookup, active-state and session-version checks; token rotation after MFA. | XSS or malware may still act as the user; no device binding or step-up policy exists for every administrative action. |
| Cross-site request forgery | State-changing handlers compare request `Origin` with configured `APP_ORIGIN`; session cookie uses `SameSite=Strict` (OAuth callback cookies use Lax). | Reverse proxies and deployment domains must be configured correctly; origin checks should be verified in the real deployment and supplemented as appropriate. |
| Privilege escalation / insecure direct object reference | Backend role checks on staff, books, members, and loans routes; IDs validated; staff role assignment is admin-only; readers cannot access member or loan APIs. | Requires continued review whenever a route or resource is added; no branch/tenant ownership model exists. |
| Theft of MFA seed from DB | Seed encrypted using AES-256-GCM under a separate key; authentication tag is verified on decryption. | Compromise of both database and encryption key reveals seeds. Key rotation/migration is not automated. |
| Abuse or replay of recovery codes | High-entropy random codes are stored as HMAC digests and consumed once under a transaction. | Codes must be protected by users; no notification on use or dedicated recovery/reset administration flow is implemented. |
| Google OAuth mix-up or forged identity token | State, nonce, PKCE verifier, signature/JWK validation, issuer/audience/algorithm checks, verified email and stable subject validation. | External Google availability and correct OAuth-console redirect configuration are required; account recovery and identity provider incidents remain external dependencies. |
| SQL injection | Values are supplied as query parameters; role-specific table/column choices are server-controlled. | Any future dynamic SQL identifiers must be allow-listed; review every new query. |
| Database network interception | PostgreSQL TLS uses `rejectUnauthorized: true` and optionally the configured Supabase CA certificate. | Host/cloud TLS and secret configuration must remain correct; certificate/connection failures can stop the service. |
| Destructive administrator error or compromise | Last-admin safeguards, inability to self-disable/delete, role separation, soft-delete recovery, encrypted backup restore, and audit entries. | No multi-person approval or immutable external audit sink. Admin accounts remain high-value targets. |

## 7. Security event logging and database records

`login_attempts` stores normalized usernames, timestamps, and success flags to apply throttling; records older than 24 hours are removed during an attempt write. `audit_events` records selected action names, actor IDs when known, target identifiers, outcome, and timestamp. The API exposes the most recent 200 events to admins only. The application intends to exclude secret values such as passwords, TOTP codes, recovery codes, and raw session tokens from logs. Audit retention, export, alerting, tamper-evidence, and operational log monitoring are not implemented as a complete service.

Principal sensitive data is handled as follows:

| Data | Stored form / location |
| --- | --- |
| Password | Never stored in plaintext; HMAC-derived material is hashed by Argon2id, including its random salt and work parameters in the encoded value. |
| Password pepper | `AUTH_PEPPER` server secret, separate from database. |
| MFA TOTP seed | AES-256-GCM ciphertext in PostgreSQL; decryption key in `MFA_ENCRYPTION_KEY`. Pending enrollment seeds are encrypted too. |
| Downloaded database backup | AES-256-GCM encrypted with a separate server key in `BACKUP_ENCRYPTION_KEY`; the encrypted file contains password hashes and MFA ciphertext. |
| Recovery code | Plaintext shown once; HMAC digest plus use timestamp stored in PostgreSQL. |
| Browser session | Random opaque token in HttpOnly cookie; SHA-256 digest stored in PostgreSQL. |
| Google credentials | Client ID and client secret in server environment; secret is never placed in client code. |
| OAuth access token | Not persisted by the app. |

## 8. Deployment and operational security

For local development, run the Next.js server on loopback. Do not expose the development server directly to the public internet. For hosted deployment, use the production Node.js runtime, HTTPS, a stable `APP_ORIGIN`, and the Supabase Transaction Pooler connection URI appropriate for serverless deployment. Configure `DATABASE_CA_CERT` with the trusted certificate PEM if required by the database endpoint; TLS verification remains enabled. Put `DATABASE_URL`, `DATABASE_CA_CERT`, `AUTH_PEPPER`, `MFA_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` in the hosting provider's server-side environment settings. Never commit `.env.local`, certificates, connection strings, peppers, encryption keys, or OAuth secrets.

Google Cloud's authorized origin and redirect URI must match the deployed HTTPS domain exactly; the callback path is `/api/auth/google/callback`. After changing environment variables in Vercel, redeploy so the runtime receives the updated values. Production and preview environments should be isolated; preview builds should not receive access to production data unless that access is explicitly intended and protected.

The admin console can download and restore full-system data backups encrypted with AES-256-GCM. Configuration-only restore points are separate and affect only `system_settings`. Full backup restoration replaces current users, library data, configuration, and audit rows and deletes active sessions. The same `BACKUP_ENCRYPTION_KEY` decrypts the file; the matching `AUTH_PEPPER` and `MFA_ENCRYPTION_KEY` are also needed to use restored password hashes and MFA seeds. Keep keys separately from backup files. Automated AWS S3 upload, offsite retention, monitoring, and a rehearsed recovery plan are not implemented yet.

## 9. Current limitations and recommended next work

This is a learning/starter implementation. Before using it for sensitive or regulated data, prioritize:

1. Independent application and infrastructure security review; threat model and route-by-route access-control tests.
2. Distributed rate limiting, IP/device abuse controls, and alerting for suspicious authentication and administrator actions.
3. Automated protected offsite backups (for example, private AWS S3 storage), retention monitoring, and a tested recovery plan for database and key material; documented key rotation.
4. A secure MFA reset/account recovery process with identity proofing, audit, notifications, and protection from social engineering.
5. External append-only audit export, explicit retention rules, monitoring, and incident-response procedures.
6. A deployment security header policy (including a carefully tested Content Security Policy), dependency update process, vulnerability scanning, and production error handling that avoids disclosing internals.
7. Phishing-resistant MFA (for example WebAuthn/passkeys/security keys), especially for administrator accounts.
8. Confirm supported password policy, session and reauthentication requirements, member-data privacy notice and retention schedule, and availability objectives with the organization's needs.

This list describes work not established by the code reviewed for this document; it is not a statement that every item is required in every deployment.

## 10. Conclusion

The system demonstrates a library catalogue and circulation workflow alongside identity verification, layered authentication, role-based authorization, secure password storage, protected session handling, database transport security, and security-event recording. Its CIA Triad contribution is strongest as an educational design: role restrictions help preserve member-data confidentiality, transactional inventory updates help preserve integrity, and modest throttling/database practices support availability. Effective security also depends on secrets management, restrictive hosting configuration, backup and recovery, monitoring, access-control testing, and careful handling of privileged accounts.

## References

1. NIST, [FIPS PUB 199: Standards for Security Categorization of Federal Information and Information Systems](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.199.pdf) — confidentiality, integrity, availability objectives.
2. OWASP, [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — adaptive password hashing, salts, peppers, Argon2id.
3. OWASP, [Multifactor Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html) — factor independence, MFA enrollment and recovery considerations.
4. OWASP, [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) — least privilege, deny-by-default, and authorization enforcement.
5. OWASP, [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) — session identifiers, cookie protections, lifecycle management.
6. OWASP, [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) — security logging, sensitive-data exclusion, retention and monitoring.
7. NIST, [SP 800-63B Digital Identity Guidelines: Authentication and Authenticator Management](https://pages.nist.gov/800-63-4/sp800-63b.html) — authentication and authenticator guidance.
8. Supabase, [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — database row security concepts and policies.

---

**Implementation evidence in this repository:** `src/lib/security.ts`, `src/lib/auth.ts`, `src/lib/mfa.ts`, `src/lib/db.ts`, `src/lib/env.ts`, `src/app/api/`, `supabase/schema.sql`, and the migration/admin scripts. Re-check these files whenever implementation changes; this document is a description of the reviewed code, not an automatic guarantee that future code stays aligned.
