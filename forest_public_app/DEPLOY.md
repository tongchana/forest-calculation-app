# Deploy Guide

This project is deployed as two separate services:

1. `backend` on Render
2. `frontend` on Vercel

## 1. Deploy the backend on Render

The repository already includes a root-level `render.yaml`.

### Click path

1. Open Render
2. Click `New +`
3. Click `Blueprint`
4. Connect the GitHub repository `tongchana/forest-calculation-app`
5. Render will detect `render.yaml`
6. Click `Apply`

### What Render will create

- Service name: `forest-calculation-api`
- Runtime: `Python`
- Build command:

```bash
pip install -r forest_public_app/backend/requirements.txt
```

- Start command:

```bash
uvicorn forest_public_app.backend.app.main:app --host 0.0.0.0 --port $PORT
```

### After deploy

Open:

```text
https://your-render-domain/api/health
```

If it returns:

```json
{"status":"ok"}
```

the backend is ready.

### Important environment variable

After the frontend is deployed on Vercel, come back to Render and set:

```bash
CORS_ORIGINS=https://your-vercel-domain.vercel.app
```

If you want to allow more than one origin, separate them with commas:

```bash
https://site-a.vercel.app,https://site-b.vercel.app
```

## 2. Deploy the frontend on Vercel

The frontend already includes `forest_public_app/frontend/vercel.json`.

### Click path

1. Open Vercel
2. Click `Add New...`
3. Click `Project`
4. Import the GitHub repository `tongchana/forest-calculation-app`
5. In project settings, set `Root Directory` to:

```text
forest_public_app/frontend
```

6. Add this environment variable:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-render-domain
```

7. Click `Deploy`

### What Vercel will use

- Framework: `Next.js`
- Install command:

```bash
pnpm install
```

- Build command:

```bash
pnpm build
```

## 3. Final connection step

After Vercel gives you the frontend URL:

1. Copy the Vercel domain
2. Go back to Render
3. Update `CORS_ORIGINS`
4. Redeploy or wait for Render to restart the service

Example:

```bash
CORS_ORIGINS=https://forest-public-app.vercel.app
```

## 4. Files used for deployment

- [render.yaml](C:/tong/work/cal_Biomass/render.yaml)
- [forest_public_app/frontend/vercel.json](C:/tong/work/cal_Biomass/forest_public_app/frontend/vercel.json)
- [forest_public_app/backend/app/main.py](C:/tong/work/cal_Biomass/forest_public_app/backend/app/main.py)
- [forest_public_app/README.md](C:/tong/work/cal_Biomass/forest_public_app/README.md)
