# Claude Clone

A Claude-inspired personal AI chat app built with Node.js, Express, vanilla HTML/CSS/JavaScript, and the Google Gemini API.

The app runs locally, serves a responsive chat UI, supports PWA installation, streams model responses, supports Supabase login, syncs conversations to a Supabase database, and keeps private API keys on the server.

## Features

- Claude-style responsive chat interface
- Google Gemini API integration with streaming responses
- Supabase email/password login
- Supabase database sync for user conversations
- Server-side API key handling through `.env`
- Local browser fallback when Supabase is not configured
- Markdown rendering for assistant responses and code blocks
- Claude-style code artifacts with side-by-side preview, code view, copy, and download
- File uploads for text files and images
- Image attachments sent to Gemini as inline multimodal input
- Voice input and optional read-aloud support through browser speech APIs
- Light, dark, and system themes
- Export conversations as Markdown
- PWA manifest and service worker support
- Built-in calculator and current-time tools

## Tech Stack

- Node.js 18+
- Express 5
- Google Generative AI SDK
- Supabase Auth and database sync
- `@supabase/server`
- `@supabase/supabase-js`
- Multer for uploads
- Vanilla JavaScript modules
- HTML/CSS frontend
- Progressive Web App assets

## Project Structure

```text
claude-clone/
|-- server.js
|-- package.json
|-- package-lock.json
|-- .env.example
|-- GEMINI_API_SETUP.md
|-- supabase/
|   `-- schema.sql
|-- public/
|   |-- index.html
|   |-- manifest.json
|   |-- sw.js
|   |-- icon.png
|   |-- css/
|   |   |-- styles.css
|   |   `-- themes.css
|   `-- js/
|       |-- api.js
|       |-- app.js
|       |-- markdown.js
|       |-- storage.js
|       |-- tools.js
|       `-- voice.js
`-- README.md
```

## Requirements

- Node.js 18 or newer
- Node.js 22 or newer recommended for the latest Supabase packages
- A Gemini API key from Google AI Studio
- A Supabase project with email/password auth enabled

## Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/Shafaqali/claude-clone.git
cd claude-clone
npm install
```

Create your local environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and add your keys:

```env
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000
GEMINI_MODEL=gemini-3.8-flash
GEMINI_MAX_OUTPUT_TOKENS=16384
GEMINI_RETRY_ATTEMPTS=3

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
SUPABASE_SECRET_KEY=sb_secret_your_key_here
SUPABASE_JWKS_URL=https://your-project.supabase.co/auth/v1/.well-known/jwks.json
```

Get a key from Google AI Studio:

```text
https://aistudio.google.com/app/apikey
```

## Supabase Database Setup

1. Open your Supabase project dashboard.
2. Go to SQL Editor.
3. Run the SQL in `supabase/schema.sql`.
4. In Authentication settings, enable email/password signups if you want users to create accounts from the app.
5. In Authentication URL Configuration, set the Site URL to your app URL, for example `http://localhost:3000` locally.
6. Add the same app URL to Redirect URLs so email confirmation and password reset links can return to the app.
7. If you do not want email verification during local testing, turn off email confirmation in Supabase Auth settings. Otherwise users must click the confirmation email before signing in.

The `SUPABASE_PUBLISHABLE_KEY` is safe for the browser. The `SUPABASE_SECRET_KEY` must stay in `.env` or your hosting provider's server-side environment variables only.

Chats are stored with a `(user_id, id)` primary key, so every user's conversations stay scoped to that Supabase account. Re-run `supabase/schema.sql` after pulling database-related updates.

## Run Locally

Start the server:

```bash
npm start
```

Open the app:

```text
http://localhost:3000
```

For development with Node's watch mode:

```bash
npm run dev
```

To test from another device on the same network, run with `HOST=0.0.0.0` and open `http://YOUR-IP:3000`.

PowerShell example:

```powershell
$env:HOST="0.0.0.0"; npm start
```

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Yes | none | Gemini API key used by the backend |
| `GEMINI_MODEL` | No | `gemini-3.8-flash` | Default Gemini model for chat requests |
| `GEMINI_MAX_OUTPUT_TOKENS` | No | `16384` | Maximum Gemini output tokens for longer code/file generations; values are clamped between `16384` and `32768` |
| `GEMINI_RETRY_ATTEMPTS` | No | `3` | Retry attempts for temporary Gemini overload/high-demand errors before moving to fallback models |
| `GEMINI_RETRY_BASE_DELAY_MS` | No | `900` | Initial retry delay in milliseconds; later retries use exponential backoff |
| `SUPABASE_URL` | Yes for login | none | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Yes for login | none | Browser-safe Supabase publishable key |
| `SUPABASE_SECRET_KEY` | Yes for database sync | none | Server-only Supabase secret key |
| `SUPABASE_JWKS_URL` | Yes for auth verification | derived from URL | Supabase Auth JWKS endpoint |
| `PORT` | No | `3000` | Local server port |
| `HOST` | No | `0.0.0.0` | Server bind host |

You can change `GEMINI_MODEL` to another Gemini model ID supported by your API key and SDK version. The server automatically retries temporary Gemini capacity errors and falls back through the built-in model list when a selected model is overloaded.

## Useful Endpoints

- `GET /api/health` - checks server status and API-key configuration
- `GET /api/config` - returns browser-safe Supabase config
- `GET /api/me` - returns the authenticated Supabase user
- `GET /api/chats` - loads authenticated user's synced chats
- `PUT /api/chats/:id` - saves one authenticated user's chat
- `DELETE /api/chats/:id` - deletes one authenticated user's chat
- `GET /api/models` - returns the app's model list
- `GET /api/test-key` - tests the configured Gemini API key
- `POST /api/chat` - streams chat responses
- `POST /api/upload` - processes text and image uploads
- `POST /api/tool` - runs simple local tools

## Security Notes

- Do not commit `.env` or real API keys.
- Rotate `SUPABASE_SECRET_KEY` if it is ever pasted into chat, logs, screenshots, or public files.
- API calls are made from the server, not directly from the browser.
- Supabase secret key is used only on server routes.
- Uploaded temporary files are removed after processing.
- Conversations are synced to Supabase after login and also cached locally in the browser.

## Deployment

This app can run on services that support Node.js, such as Render, Railway, Fly.io, or similar platforms.

Set these environment variables in your hosting dashboard:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash
GEMINI_MAX_OUTPUT_TOKENS=16384
GEMINI_RETRY_ATTEMPTS=3
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
SUPABASE_SECRET_KEY=sb_secret_your_key_here
SUPABASE_JWKS_URL=https://your-project.supabase.co/auth/v1/.well-known/jwks.json
```

Then deploy with:

```bash
npm install
npm start
```

## Troubleshooting

If the app says the API key is missing, confirm `.env` exists and restart the server.

If Gemini returns `503` or "high demand", keep `GEMINI_MODEL=gemini-3.8-flash` and redeploy/restart. The server will retry temporary spikes and then try fallback models automatically.

If Gemini returns a model-access error, try a model ID available to your account by changing `GEMINI_MODEL` in `.env`.

If sign in fails with `Email not confirmed`, confirm the user from the email Supabase sends, use the app's resend confirmation button, or disable email confirmation in Supabase Auth settings for local testing.

If uploads fail, confirm the file type is supported and the file is below the configured upload limit.

## License

MIT
