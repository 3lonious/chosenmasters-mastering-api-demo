# Chosen Masters Mastering API Demo

This repository hosts the demo application for the Chosen Masters B2B mastering API. It showcases the end-to-end workflow for requesting a signed upload URL, submitting a mastering job, and streaming mastered intensities with the same stack that powers the production dashboard.

## Prerequisites

- Node.js 18 or newer (the project is built with the Next.js App Router)
- npm 9+ (or an alternative package manager configured for Next.js projects)

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env.local` file in the project root with the required configuration:

   ```env
   CM_API_KEY=
   # Optional: override the domain signal sent by the server proxy.
   # If omitted, the proxy infers the current demo app origin.
   # CM_API_DOMAIN=http://localhost:3000
   PARENT_BASE_URL=https://chosenmasters.com
   NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL=https://d2ojxa09qsr6gy.cloudfront.net
   ```

   - `CM_API_KEY` – Your private API key. Keep this secret and only reference it from server-side code.
   - `CM_API_DOMAIN` – Optional domain override sent by the server proxy for domain verification. Use `http://localhost:3000` for local testing if you want to force localhost binding, or your deployed app domain in production. If omitted, the proxy infers the current request origin/host.
   - `PARENT_BASE_URL` – The base domain for live API requests. Leave at the default unless you are targeting a staging stack.
   - `NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL` – Public CloudFront distribution used for streaming mastered previews.

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) to view the demo. The interactive documentation is available at `/mastering-docs` and reflects the current production flow.

## Domain verification and local limits

Users set their allowed API domain in the Chosen Masters web portal. Browser
integrations are verified with the browser `Origin`/`Referer`, so frontend code
does not need to send `x-api-domain`. This demo uses server-side proxy routes to
keep `CM_API_KEY` private; those proxy routes send a domain signal upstream
automatically, using `CM_API_DOMAIN` when configured or the incoming request
origin/host when it is not.

For local testing, set the portal domain to `localhost` or configure
`CM_API_DOMAIN=http://localhost:3000`. Localhost calls are limited by the live
API to 50 requests per month per endpoint, API key, and public IP address. This
is not a global per-account mastering limit and does not replace purchased
credits.

## Useful scripts

| Command        | Description                                      |
| -------------- | ------------------------------------------------ |
| `npm run dev`  | Starts the development server with hot reloading. |
| `npm run build`| Creates an optimized production build.           |
| `npm run start`| Runs the built app in production mode.           |

## Additional resources

- [Chosen Masters](https://chosenmasters.com/ai-mastering-api) – Request access to the B2B mastering program.
- [Next.js documentation](https://nextjs.org/docs) – Framework reference used by this project.
