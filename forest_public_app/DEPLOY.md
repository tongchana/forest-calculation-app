# Deploy Guide

This project is deployed as two separate services:

1. `backend` on Render
2. `frontend` on Vercel

## 1. Deploy the backend on Render

The deployment config now lives at `web_apps/render.yaml`.

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

This is still useful when you call the Render backend directly from a browser or another tool.
The frontend app now prefers a same-origin `/api/...` rewrite on Vercel, which helps preview deployments avoid browser CORS failures.

## 2. Deploy the frontend on Vercel

The frontend already includes `web_apps/forest_public_app/frontend/vercel.json`.

### Click path

1. Open Vercel
2. Click `Add New...`
3. Click `Project`
4. Import the GitHub repository `tongchana/forest-calculation-app`
5. In project settings, set `Root Directory` to:

```text
web_apps/forest_public_app/frontend
```

6. Add this environment variable:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-render-domain
```

The frontend uses this value as the Vercel rewrite target for `/api/:path*`.
Browser requests stay on the Vercel origin first, and Vercel forwards them to Render.

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

If you mainly use the Vercel frontend, the rewrite layer means preview URLs do not have to call Render directly from the browser.
Still keep the production Vercel domain in `CORS_ORIGINS` so direct backend access remains safe and explicit.

## 4. Files used for deployment

- [render.yaml](C:/tong/work/cal_Biomass/web_apps/render.yaml)
- [forest_public_app/frontend/vercel.json](C:/tong/work/cal_Biomass/web_apps/forest_public_app/frontend/vercel.json)
- [forest_public_app/backend/app/main.py](C:/tong/work/cal_Biomass/web_apps/forest_public_app/backend/app/main.py)
- [forest_public_app/README.md](C:/tong/work/cal_Biomass/web_apps/forest_public_app/README.md)
