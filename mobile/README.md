# Vault of Value mobile app

This Expo app connects to the existing Next.js library API. It supports username/password sign-in, authenticator-app MFA, catalogue search, and staff member/loan views. API authorization continues to enforce the user's server-side role.

## Run with Expo Go

1. From the repository root in PowerShell, add the project's Node.js to this terminal session: `$env:Path = "$PWD\.tools\node\node-v24.20.0-win-x64;$env:Path"`.
2. Run `Set-Location mobile`, then `npm.cmd install`.
3. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` if you need to change the API server.
4. Run `npx.cmd expo start` and scan the QR code with Expo Go.

For a local Next.js server on a physical phone, start it from the repository root with `npm run dev:lan`, set the URL to `http://<your-computer-LAN-IP>:3000`, and keep both devices on the same trusted Wi-Fi. `localhost` on the phone refers to the phone itself. Use the deployed HTTPS URL for normal use.

The mobile app stores only the active session token using Expo SecureStore. Pending password/MFA sessions stay in memory. The token itself is random and the backend stores only its SHA-256 digest. Never put database credentials, OAuth client secrets, pepper, or MFA encryption keys in `EXPO_PUBLIC_*` variables.

Google sign-in is not included in this first mobile version. The existing Google callback is web-cookie based; native OAuth needs its own app-scheme callback and provider configuration.
