# Productivity Workspace

Single-page productivity web app with:
- Switchable, persistent themes (Matrix, Dark, Aurora)
- Theme-aware inspirational quote (LLM-generated on demand)
- Model picker (OpenAI GPT-5.6 Sol, with optional dynamically fetched OpenRouter models)
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
    - GET  /api/models
    - GET  /api/news?category=national|world|local&city=..&state=..
  - Providers:
    - OpenAI (GPT-5.6 Sol, Terra, and Luna)
    - OpenRouter (optional, dynamically discovered chat models)
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

## LangGraph Shell Agent

The Agent is a dedicated, full-width workspace with its own navigation tab, separate from Chat and other tools. A LangGraph-backed ReAct agent on the Express server streams user-visible progress through SSE and uses one approval-gated `execute_shell` tool. The project root is the initial working directory, but approved commands may specify another working directory.

> **WARNING: Every approved command runs with the full permissions of the user account running the server. The Agent is not sandboxed or process-isolated. Approval is a review step, not a security boundary: a command can read or delete files, install software, access credentials, or send data elsewhere.**

Run and approval behavior:
- Only one run may be active at a time, including a run paused for approval. Completed, failed, cancelled, and paused runs remain available in history.
- Every proposed shell command requires an `approve`, `edit`, or `reject` decision before execution. Approve runs the original command; edit runs the validated replacement; reject does not execute the command and may provide feedback to the Agent.
- Stop cancels the run. If approval is pending, the command is never executed. If a command is running, Stop terminates its process tree; cancelled runs do not resume automatically.
- Commands run non-interactively in the host platform's default shell (`cmd.exe` on Windows and `/bin/sh` on Unix-like systems) with the server process environment.
- Each command has a configurable hard timeout, defaulting to 10 minutes. Timeout and Stop terminate the complete process tree using the platform-appropriate mechanism.
- Command output is bounded and marked when truncated. Configured API-key values receive best-effort redaction, but arbitrary stdout or stderr can still expose sensitive data and redaction is not guaranteed to catch every secret.

Persistence and model behavior:
- A local SQLite database stores run metadata, pending approvals, LangGraph checkpoints, and bounded event history. SSE provides live events and replays persisted events after reconnects.
- Browser reloads and server restarts can recover history and resume a checkpoint paused for approval. A shell process interrupted by a server crash cannot be resumed; its run is marked orphaned or failed instead.
- SQLite state remains on the server machine and is intended for a trusted, single-user deployment, not horizontal scaling.
- The provider and model selected when a run starts are snapshotted for the full run. Later model-picker changes affect only new runs, and Agent runs do not silently fall back to another provider or model.
- A selected model must be recognized as supporting tool calling, and the selected provider must have its required API key configured. Unsupported selections are rejected rather than substituted.
- The first version is local-only: only clients on the server machine can use the Agent control plane. CORS is not authentication, and remote or multi-user Agent access is outside this plan.

Agent endpoints:
- `POST /api/agent/runs` - start a run.
- `GET /api/agent/runs` - list recent runs.
- `GET /api/agent/runs/:runId` - load a run and its current approval state.
- `GET /api/agent/runs/:runId/events` - stream live events and replay persisted events.
- `POST /api/agent/runs/:runId/approval` - submit approve, edit, or reject decisions and resume a paused run.
- `POST /api/agent/runs/:runId/stop` - stop a run.

## Prerequisites

- Node.js >= 22
- API keys:
  - OpenAI (for GPT-5.6) — private
  - Tavily — private
  - OpenRouter — private and optional
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
  "openrouter": {
    "apiKey": "YOUR_OPENROUTER_API_KEY_OPTIONAL",
    "defaultModel": "openai/gpt-5.5",
    "favoriteModels": ["openai/gpt-5.5", "anthropic/claude-sonnet-4.5"]
  },
  "cors": {
    "allowedOrigins": [
      "http://localhost:8787",
      "http://localhost:3000",
      "http://localhost:5173"
    ]
  },
  "server": {
    "port": 8787,
    "https": {
      "enabled": false,
      "port": 8443,
      "key": "./ssl/private.key",
      "cert": "./ssl/certificate.crt"
    }
  }
}
```

Notes:
- Only public API keys (if truly public) are safe to expose. Treat the above keys as private and keep them in secrets.json.
- .gitignore already excludes secrets.json.
- OpenRouter is optional. When configured, the backend fetches model names from OpenRouter and sorts `openrouter.favoriteModels` first.
- You can also set OpenRouter with environment variables: `OPENROUTER_API_KEY`, `OPENROUTER_DEFAULT_MODEL`, and comma-separated `OPENROUTER_FAVORITE_MODELS`.

2) Install server dependencies

```
cd ./server
npm install
```

3) Run the server

```
npm start
```

The server starts on HTTP (default http://localhost:8787) and optionally HTTPS (default https://localhost:8443) if configured.

Open http://localhost:8787 in your browser (or https://localhost:8443 if HTTPS is enabled).

## HTTPS Configuration (Optional)

To enable HTTPS support, set up SSL certificates and configure the server:

1. **Generate SSL certificates** (for development):
   ```bash
   # Create ssl directory
   mkdir -p ssl

   # Generate self-signed certificate (Linux/Mac)
   openssl req -x509 -newkey rsa:4096 -keyout ssl/private.key -out ssl/certificate.crt -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

   # Or for Windows, you can use:
   # openssl req -x509 -newkey rsa:4096 -keyout ssl/private.key -out ssl/certificate.crt -days 365 -nodes
   ```

2. **Enable HTTPS in secrets.json**:
   ```json
   {
     "server": {
       "port": 8787,
       "https": {
         "enabled": true,
         "port": 8443,
         "key": "./ssl/private.key",
         "cert": "./ssl/certificate.crt"
       }
     }
   }
   ```

3. **Environment variables** (alternative to secrets.json):
   ```bash
   export HTTPS_ENABLED=true
   export HTTPS_PORT=8443
   export HTTPS_KEY_PATH=./ssl/private.key
   export HTTPS_CERT_PATH=./ssl/certificate.crt
   ```

4. **Restart the server** - HTTPS will be available alongside HTTP.

**Note**: For production, use certificates from a trusted Certificate Authority (CA) instead of self-signed certificates.

## Usage Overview

- Theme switcher (Matrix/Dark/Aurora): persists in localStorage. Matrix adds a subtle code-rain accent.
- Model picker: GPT-5.6 Sol (OpenAI) plus OpenRouter models when `OPENROUTER_API_KEY` or `openrouter.apiKey` is configured. Direct OpenAI chat modes route to Sol, Terra, or Luna based on workload. If discovery fails, the static OpenAI option remains available.
- Quote widget: LLM-generated. Matrix theme prompts a cyberpunk/Matrix vibe; others use modern, non-cheesy inspiration.
- Chat modes:
  - Medical Doctor (high reasoning; supportive, not a diagnosis; disclaimer added)
  - Therapist (high reasoning; supportive; disclaimer added)
  - Web Search (GPT-5.6 Terra with low reasoning; performs web search by default and cites sources)
  - Basic Info (GPT-5.6 Sol; user-selectable reasoning with medium as the default; no search)
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

- GET /api/models
  - Returns: { models: [{ key, label, provider, model, tier }], providers }
  - OpenRouter models are fetched server-side so the browser never receives your OpenRouter API key.

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
- Pin OpenRouter models by setting `openrouter.favoriteModels` in secrets.json or `OPENROUTER_FAVORITE_MODELS` in the environment.
- Add chat modes by updating app/scripts/state.js (MODES) and adjusting server/routes/chat.js behavior if needed.
- To enable additional providers later, add them in app/scripts/services/modelRegistry.js and server/routes/chat.js.

## Scripts

In /server/package.json:
- npm start — runs the Express server on configured port
