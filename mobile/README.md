# Vault of Value mobile app

This Expo app connects to the existing Next.js library API. It supports username/password and Google sign-in, authenticator-app MFA, catalogue search, and staff member/loan views. API authorization continues to enforce the user's server-side role.

## Run with Expo Go

1. From the repository root in PowerShell, add the project's Node.js to this terminal session: `$env:Path = "$PWD\.tools\node\node-v24.20.0-win-x64;$env:Path"`.
2. Run `Set-Location mobile`, then `npm.cmd install`.
3. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` if you need to change the API server.
4. Run `npx.cmd expo start` and scan the QR code with Expo Go. Password and MFA sign-in work in Expo Go; Google OAuth needs a development build with the app's custom URL scheme.

## Enable Google OAuth on mobile

1. Run `supabase/mobile-google-oauth.sql` in the Supabase SQL Editor.
2. Deploy the updated Next.js backend to Vercel and confirm its server-side `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `APP_ORIGIN` values are set.
3. Install Android Studio and an Android SDK, then from this folder run `npx.cmd expo run:android`. This builds and installs the development app with the `vaultofvalue://` callback scheme. Start Metro for the development client with `npx.cmd expo start --dev-client`.
4. Tap **Continue with Google**. The existing Google web client should keep its HTTPS redirect URI pointing to `APP_ORIGIN/api/auth/google/callback`; the server then returns a short-lived, single-use ticket to the app.

Expo Go cannot register the required custom app scheme for OAuth redirects. Rebuild the development app after changing the scheme in `app.json`.

For a local Next.js server on a physical phone, start it from the repository root with `npm run dev:lan`, set the URL to `http://<your-computer-LAN-IP>:3000`, and keep both devices on the same trusted Wi-Fi. `localhost` on the phone refers to the phone itself. Use the deployed HTTPS URL for normal use.

The mobile app stores only the active session token using Expo SecureStore. Pending password/MFA sessions stay in memory. The token itself is random and the backend stores only its SHA-256 digest. Never put database credentials, OAuth client secrets, pepper, or MFA encryption keys in `EXPO_PUBLIC_*` variables.

OAuth secrets remain on the server. Never put a Google client secret in `EXPO_PUBLIC_*` variables or the Expo app bundle.
