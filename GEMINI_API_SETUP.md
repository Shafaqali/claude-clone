# How to Set Up a Gemini API Key

## 1. Create an API key

1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Select **Get API Key**.
4. Select **Create API key in new project**.
5. Copy the generated key.

## 2. Update the local environment

Add the key to your local `.env` file. Do not commit the real value:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

The `.env.example` file contains only a safe placeholder and can be committed.

## 3. Test the key

1. Restart the server with `node server.js`.
2. Open `http://localhost:3000/api/test-key`.
3. A working key returns a successful response.

## Troubleshooting

- Generate a new key if the existing key is suspended or revoked.
- Confirm that you copied the complete key without spaces.
- Never paste a real API key into documentation, source code, or Git history.
