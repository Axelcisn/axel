# Axel

A Next.js application ready for deployment on Vercel.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Trading212 API Setup

This project integrates with Trading212's API for real trade data and account information.

### Setup Instructions

1. **Copy the example environment file:**
   ```bash
   cp .env.local.example .env.local
   ```

2. **Get your API credentials from Trading212:**
   - Log in to [Trading212](https://app.trading212.com/)
   - Go to Settings → API (beta)
   - Generate a new API key
   - Copy the `API KEY ID` and `SECRET KEY`

3. **Fill in your `.env.local`:**
   ```bash
   T212_API_KEY_ID=<paste your API Key ID here>
   T212_API_SECRET=<paste your Secret Key here>
   T212_BASE_URL=https://live.trading212.com
   ```

4. **⚠️ Security Warning:**
   - **Never commit `.env.local` to Git** (it's already in `.gitignore`)
   - **Never paste secrets into chat, issues, or PRs**
   - If you accidentally expose a key, delete it in Trading212 and create a new one

### Smoke Test

Run the integration smoke test to verify everything is working:

```bash
npm run smoke:test
```

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.

See Momentum Timing docs: /docs/momentum-timing/01-goals-scope.md