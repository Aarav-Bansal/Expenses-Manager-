# Expenses-Manager-


A 2D arcade horror game where every demon is an unreviewed expense. A terrifying specter labelled `AMAZON.COM $42.19` drifts down the haunted manor. Blast it with the **Work**, **Personal** or **Unknown** spell, and your choice becomes the real categorisation, written back to your expense ledger in the background while you play.

## What really happens
- Each story choice tags the expense: Work is marked **Submitted**, Personal is marked **Personal - not reimbursed**, Unknown is marked **Flagged** for a human to review.
- **Google Sheets mode:** connect a sheet with the columns `Merchant`, `Amount`, `Category`, `Status` (optional: `Date`, `Note`, `Reviewed At`). Rows with a blank Status become demons. As you play, choices are batched and written back to the Category, Status and Reviewed At columns.
- **No-sheet mode:** upload a CSV (`merchant,amount` plus optional `date,note`) or play the sample ledger, then download the finished report as a CSV.

## Game rules
- Move with `←/→` or `A/D`, pick a spell with `1` Work, `2` Personal, `3` Unknown, hold `Space` to cast, `P` to pause. Touch screens get on-screen Left, Cast and Right buttons plus tappable spell buttons.
- **The first spell that hits a demon decides its category.** Other spells are resisted. Bigger charges raise bigger demons: they take more hits and fall slower.
- A demon crossing the **Ledger Line** costs 1 Sanity (you have 5). It retreats into the ledger and returns once; if it slips twice it stays unreviewed, and nothing is written for it.
- The grimoire's **omen** (Gemini, with keyword rules as fallback) glows around a demon as it nears the line. Matching it earns bonus points, but **your choice is always what gets saved**.
- Win by banishing everything. If Sanity hits 0 or you finish early, everything already banished stays filed and the rest stays untouched, so you can play again to finish the job.
- Calm mode slows the game and removes flashes and screen shake. `prefers-reduced-motion` is respected too.

## Google services
- **Gemini** (`@google/genai`) suggests a category and writes each demon's eerie one-liner (one batched call per ledger). On Cloud Run it uses Vertex AI via the service account, with no API key in code. Without credentials, rules and story templates take over.
- **Google Sheets API** is the expense system the story writes to (service account, no user sign-in).
- **Cloud Run** hosts the app (Dockerfile included).

## Run locally
```bash
npm install
npm test
GEMINI_API_KEY=your-key npm start   # key is optional
# open http://localhost:8080
```

## Connect Google Sheets
1. In Google Cloud, enable the **Google Sheets API**.
2. Pick the service account the app runs as. **Cloud Run:** by default this is the Compute Engine default service account. **Locally or with a key:** create a service account key and set `SHEETS_SA_KEY_JSON` to the key JSON (use Secret Manager in production).
3. Set `SHEETS_SERVICE_ACCOUNT=that-account@PROJECT.iam.gserviceaccount.com` (shown to players so they know who to share with; derived automatically when you use `SHEETS_SA_KEY_JSON`).
4. Share your Google Sheet with that email as **Editor**.
5. In the game choose "Connect a Google Sheet", paste the sheet link, and set the tab name (default `Expenses`).

Example sheet:

| Date | Merchant | Amount | Category | Status | Reviewed At |
|---|---|---|---|---|---|
| 2026-10-02 | AMAZON.COM | 42.19 | | | |
| 2026-10-03 | GitHub | 4.00 | | | |

## Deploy to Cloud Run
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com aiplatform.googleapis.com artifactregistry.googleapis.com sheets.googleapis.com

gcloud run deploy expense-exorcist --source . --region us-central1 --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,GOOGLE_CLOUD_LOCATION=us-central1,SHEETS_SERVICE_ACCOUNT=YOUR_RUN_SERVICE_ACCOUNT_EMAIL

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```
If Sheets returns a "insufficient scopes" error on Cloud Run, use a service account key instead: store it in Secret Manager and add `--set-secrets SHEETS_SA_KEY_JSON=sheets-sa-key:latest`.

## Quality notes
- **Security:** helmet headers + CSP, rate limiting, 1 MB body cap, strict validation of every request (sheet id, tab name, row numbers, categories), CSV formula-injection guard on exports, `RAW` writes to Sheets, `textContent` only in the UI, AI output validated before use, non-root container, no secrets in the repo.
- **Testing:** `npm test` covers CSV parsing, omens, story tiers, reports, the game engine (`public/engine.js` is pure logic: spawning, hits, slips, win and lose), the Sheets client (mocked) and the API.
- **Accessibility:** full keyboard play, pause (also automatic when the tab is hidden), labelled spell buttons with `aria-pressed`, a live-region narration of every banish and slip, visible focus rings, spells and demons distinguished by shape and letter as well as colour, calm mode and `prefers-reduced-motion` support.
- **Efficiency:** one batched Gemini call per ledger, background Sheets writes are debounced and batched (one request for up to 100 rows), no client framework.

