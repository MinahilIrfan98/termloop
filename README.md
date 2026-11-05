# Termloop

Termloop is a school-safe AI term explainer for students. It turns an AI term into a short explanation, mental model, three learning steps, example, and quiz, then tracks practice with XP, levels, streaks, badges, daily goals, and history.

## Project layout

- `api/`: FastAPI + LangChain `create_agent` + SQLModel/SQLite
- `api/data/glossary.json`: attached AI glossary used by the local lookup tool
- `web/`: Next.js + Tailwind claymorphism learning UI

## Requirements

- Python 3.13+
- `uv`
- Node.js 20.9+
- Ollama installed and serving `north-mini-code-1.0`, or another LangChain-supported model configured below

## Run locally

Terminal 1:

```powershell
cd api
uv sync
uv run fastapi dev
```

Terminal 2:

```powershell
cd web
npm install
npm run dev
```

Open `http://localhost:3000`. The API is at `http://localhost:8000`; interactive API docs are at `/docs`. SQLite data is created at `api/data/termloop.db`.

## Model and web search configuration

The default model retains the starter code's Ollama setting:

```powershell
$env:TERMLOOP_MODEL = "ollama:north-mini-code-1.0"
```

To use a Google Gemini model, set `TERMLOOP_MODEL=google_genai:gemini-2.5-flash` and provide `GOOGLE_API_KEY`. `TERMLOOP_MODEL` is passed to LangChain's `init_chat_model`.

Web search is off by default. To enable the integration, configure an adult-approved search proxy endpoint that accepts `POST {"query":"..."}` and set `TERMLOOP_ENABLE_WEB_SEARCH=true` and `TERMLOOP_SEARCH_URL=http://localhost:9000/search`.

When a term is absent from the local glossary, the learner can request adult approval. Search execution requires approval of the matching one-time token. The endpoint itself should enforce safe-search and return vetted results; retrieved pages are treated as untrusted factual context by the tutor.

## API overview

- `GET /api/health`
- `GET /api/glossary?q=transformer`
- `POST /api/explain/stream` — Server-Sent Events (`status`, `explanation`, `stats`, `done`)
- `POST /api/explain` — non-streaming alternative
- `POST /api/quiz/grade` — structured 0–3 grade and feedback
- `POST /api/search-approval` — create a pending adult approval
- `POST /api/search-approval/{token}/decision?approved=true&learner_id=...`
- `GET /api/stats/{learner_id}` and `GET /api/history/{learner_id}`
- `POST /api/goal`
- `POST /api/streak-freeze/{learner_id}`

## Tests and checks

Backend tests use a fake model, so they do not need a model server or network access:

```powershell
cd api
uv run pytest
```

Web checks:

```powershell
cd web
npm run lint
npm run build
```

## Safety and prototype limits

The API bounds term, quiz, and learner identifier lengths; applies a per-learner in-memory rate limit; limits LangGraph recursion; screens input/output for prompt injection, common PII formats, and a small set of unsafe content; and caps the response text passed to the model. Search is disabled until configured and requires a one-time explicit approval. This prototype is not an account or identity system: learner IDs are client-supplied, approvals live in server memory, and the keyword filters are not a substitute for production moderation. Before use with real students, add authenticated school-managed identities, durable adult approval records, a managed search provider with safe-search, stronger age-appropriate moderation, privacy review, abuse monitoring, and secure deployment controls.
