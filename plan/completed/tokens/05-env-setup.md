# Environment Variable Setup

## Required Variable

```env
GEMINI_API_KEY=AIzaSy...
```

This is the **platform's** Gemini API key — paid by the company, never exposed to users.

## Where to Get It

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Click **Create API key**
3. Select a Google Cloud project (or create a new one)
4. Copy the generated key (`AIzaSy...`)

## Development Setup

Add to your `.env` file at the project root:

```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
GEMINI_API_KEY=AIzaSy...       # <-- add this
APP_URL=http://localhost:5000
```

## Production Setup (Vercel)

1. Dashboard → your project → **Settings** → **Environment Variables**
2. Add `GEMINI_API_KEY` with the production key value
3. Redeploy

## Security Notes

- Never commit `.env` to version control
- Never expose `GEMINI_API_KEY` to the client (it is only used server-side)
- Rotate the key if it is ever accidentally exposed
- Monitor usage in Google AI Studio to detect unexpected spikes
