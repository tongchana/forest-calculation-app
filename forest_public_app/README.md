# Forest Public App

This folder contains a separate public-facing stack for the forest calculation workflow:

- `frontend/`: Next.js public website and calculator experience
- `backend/`: FastAPI service that reuses `../../run_forest_calculation.py`

The existing Streamlit apps remain untouched.

## Backend

From the repository root:

```bash
python -m pip install -r forest_public_app/backend/requirements.txt
python -m uvicorn forest_public_app.backend.app.main:app --reload --port 8000
```

## Frontend

Install dependencies inside `forest_public_app/frontend`, then run:

```bash
npm install
npm run dev
```

If your API is not on the default local port, set:

```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

before starting the frontend.
