# Forest Public App

This folder contains a separate public-facing web stack for the forest calculation workflow.

- `frontend/`: Next.js + Tailwind CSS interface
- `backend/`: FastAPI service that reuses the existing Python calculation logic from the `web_apps` root

The original Streamlit apps remain untouched.

## Architecture

The frontend is responsible for:

- the public-facing layout and motion
- workbook upload and worksheet inspection
- grouped-component selection
- live result previews
- workbook download actions

The backend is responsible for:

- reading uploaded Excel files
- calling `run_forest_calculation.py`
- generating summary, detail, and component workbooks
- returning preview data and downloadable workbook payloads

## Local development

### Backend

From `web_apps`:

```bash
cd web_apps
python -m pip install -r forest_public_app/backend/requirements.txt
python -m uvicorn forest_public_app.backend.app.main:app --reload --port 8000
```

### Frontend

From `web_apps/forest_public_app/frontend`:

```bash
pnpm install
pnpm dev
```

Set the API base URL when needed:

```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

## Production build check

From `forest_public_app/frontend`:

```bash
pnpm build
```

## Deploy recommendation

### Frontend

Deploy `web_apps/forest_public_app/frontend` to Vercel.

- Framework preset: `Next.js`
- Root directory: `web_apps/forest_public_app/frontend`
- Environment variable:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-backend-domain.example.com
```

### Backend

Deploy `forest_public_app/backend` to Render, Railway, or Fly.io.

- Start command:

```bash
uvicorn forest_public_app.backend.app.main:app --host 0.0.0.0 --port $PORT
```

- Working directory:

```bash
web_apps
```

If your deployment platform asks for install steps, use:

```bash
pip install -r forest_public_app/backend/requirements.txt
```

For a click-by-click setup guide, see:

- [forest_public_app/DEPLOY.md](C:/tong/work/cal_Biomass/web_apps/forest_public_app/DEPLOY.md)

## Current behavior

- all uploaded worksheet names are visible to the user
- grouped components are optional
- plot area default is `0.100`
- the backend still uses the same existing calculation workflow
- the public UI is separated from Streamlit so the design can evolve more freely
