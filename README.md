# Productivity Workspace

Single-page productivity web app with:
- Switchable, persistent themes (Matrix, Dark, Aurora)
- Theme-aware inspirational quote (LLM-generated on demand)
- Model picker (GPT-5)
- Multi-mode chat (Doctor, Therapist, Web Search, Basic Info, Excuse Generator) with in-session history
- News panel (National, World, Local via Settings city/state) via Tavily web search + LLM summarization
- Clock and current date
- Mobile-first responsive UI

Backend keeps all private API keys in a local secrets.json (never sent to the browser).

## Architecture

- Backend: Express server
  - Serves SPA from ./app
  - Endpoints:
    - POST /api/chat
    - POST /api/quote
    - GET  /api/news?category=national|world|local&city=..&state=..
  - Providers:
    - OpenAI (GPT-5)
    - Tavily (web search)
  - CORS allowlist and basic IP rate limiting
  - Reads keys from ./secrets.json (one level above /server)

- Frontend: Vanilla JS SPA
  - Theme switcher with localStorage persistence
  - Model picker
  - Quote widget with refresh
  - Chat with selectable modes and in-session history
  - News tabs with refresh. Local uses city/state from Settings.
  - Clock and date

## Prerequisites

- Node.js >= 18
- API keys:
  - OpenAI (for GPT-5) — private
  - Tavily — private
- Optional: Update CORS origins as needed

## Setup

1) Copy the example secrets file and fill in your keys
- From root of project (productivity-workspace):

```
cp secrets.example.json secrets.json
```

Then edit secrets.json:

```json
{
  "openai": { "apiKey": "YOUR_OPENAI_API_KEY" },
  "tavily": { "apiKey": "YOUR_TAVILY_API_KEY" },
  "cors": {
    "allowedOrigins": [
      "http://localhost:8787",
      "http://localhost:3000",
      "http://localhost:5173"
    ]
  },
  "server": { "port": 8787 }
}
```

Notes:
- Only public API keys (if truly public) are safe to expose. Treat the above keys as private and keep them in secrets.json.
- .gitignore already excludes secrets.json.

2) Install server dependencies

```
cd ./server
npm install
```

3) Run the server

```
npm start
```

The server starts (default http://localhost:8787) and serves the SPA from ../app.

Open http://localhost:8787 in your browser.

## Usage Overview

- Theme switcher (Matrix/Dark/Aurora): persists in localStorage. Matrix adds a subtle code-rain accent.
- Model picker: GPT-5 (OpenAI).
- Quote widget: LLM-generated. Matrix theme prompts a cyberpunk/Matrix vibe; others use modern, non-cheesy inspiration.
- Chat modes:
  - Medical Doctor (high reasoning; supportive, not a diagnosis; disclaimer added)
  - Therapist (high reasoning; supportive; disclaimer added)
  - Web Search (medium; performs web search by default and cites sources)
  - Basic Info (low; fast answers, no search)
  - Excuse Generator (medium; tactful and safe)
  - In-session history is maintained per mode for follow-ups (not persisted across reloads).
- News: National, World, Local. Local uses geolocation (if permitted) to tailor results. Not auto-refreshed; use the Refresh button.

## Security

- The client never receives your private keys. All external API calls happen from the backend.
- secrets.json stays only on your machine; never commit it. The server has a guard that never serves secrets.json even if it is misplaced.

## Endpoints (high level)

- POST /api/chat
  - Body: { mode, messages: [{role, content}], provider?, model? }
  - Returns: { message, modelUsed, providerUsed, disclaimer?, sources? }

- POST /api/quote
  - Body: { theme: 'matrix' | 'dark' | 'aurora' }
  - Returns: { quote, providerUsed, modelUsed }

- GET /api/news?category=<cat>&city=<city>&state=<state>
  - category: national | world | local
  - Returns: { category, items: [{ title, summary, url, source }] }

## Troubleshooting

- 400 with “API key missing”:
  - Ensure secrets.json is present at the project root and filled.
  - Restart the server after editing secrets.json.
- CORS errors:
  - Add your frontend origin to secrets.json.cors.allowedOrigins.
- Local news not showing:
  - Enter your city and state in Settings (gear icon), then refresh the Local tab.
- Quote too long/short:
  - The prompt enforces concise quotes, but creativity varies. Click Refresh.

## Notes for Customization

- Add more themes by extending CSS variables in app/styles/themes.css and setting data-theme on <body>.
- Extend model options by editing app/scripts/services/modelRegistry.js.
- Add chat modes by updating app/scripts/state.js (MODES) and adjusting server/routes/chat.js behavior if needed.
- To enable additional providers later, re-add them in app/scripts/services/modelRegistry.js and server/routes/chat.js.

## Scripts

In /server/package.json:
- npm start — runs the Express server on configured port
