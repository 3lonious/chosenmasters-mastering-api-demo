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
   PARENT_BASE_URL=https://chosenmasters.com
   NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL=https://d2ojxa09qsr6gy.cloudfront.net
   LOCAL_TESTING_LIMIT_ENABLED=false
   LOCAL_TESTING_MAX_REQUESTS_PER_HOUR=60
   LOCAL_TESTING_MAX_SETUPS_PER_DAY=25
   ```

   - `CM_API_KEY` – Your private API key. Keep this secret and only reference it from server-side code.
   - `PARENT_BASE_URL` – The base domain for live API requests. Leave at the default unless you are targeting a staging stack.
   - `NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL` – Public CloudFront distribution used for streaming mastered previews.
   - `LOCAL_TESTING_LIMIT_ENABLED` – Enables local/dev request safeguards when set to `true`.
   - `LOCAL_TESTING_MAX_REQUESTS_PER_HOUR` – Maximum API setup/testing requests accepted per hour (default: `60`).
   - `LOCAL_TESTING_MAX_SETUPS_PER_DAY` – Maximum setup flow requests accepted per day (default: `25`).

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) to view the demo. The interactive documentation is available at `/mastering-docs` and reflects the current production flow.

## Useful scripts

| Command        | Description                                      |
| -------------- | ------------------------------------------------ |
| `npm run dev`  | Starts the development server with hot reloading. |
| `npm run build`| Creates an optimized production build.           |
| `npm run start`| Runs the built app in production mode.           |

## Additional resources

- [Chosen Masters](https://chosenmasters.com/ai-mastering-api) – Request access to the B2B mastering program.
- [Next.js documentation](https://nextjs.org/docs) – Framework reference used by this project.



## Migration update

- `domain` is now the canonical web field for mastering setup requests.
- Legacy `website` is still accepted for backwards compatibility.
- If both are provided, `domain` takes precedence and is echoed back as both `domain` and `website` in API responses.
- Domain values are normalized server-side (trimmed + lowercased) and invalid values return 4xx validation errors.
- Local testing safeguards can be enabled in non-production environments with the `LOCAL_TESTING_*` env vars above.
