# Deployment Setup (GitHub + Vercel + Render + Supabase)

This repository is configured so pushes to GitHub can update all connected services.

## What is already configured in this repo

- `vercel.json` for Vercel builds (`npm install && npm run build`, output `build`)
- `render.yaml` Blueprint for Render static deploy
- `.github/workflows/supabase-deploy.yml` for Supabase migrations + edge function deploy on `main`
- `.gitignore` entries for local-only deployment files

## 1) Connect GitHub from this folder

Run these commands in this directory:

```bash
git init
git branch -M main
git add .
git commit -m "chore: setup github/vercel/render/supabase deployment wiring"
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

If this repo already exists remotely, use your existing remote URL.

## 2) Connect Vercel to GitHub repo

1. In Vercel, click "Add New Project".
2. Import this GitHub repository.
3. Framework preset: `Vite`.
4. Keep build/output defaults from `vercel.json`.
5. Deploy.

After this, every push to GitHub triggers a Vercel deploy.

## 3) Connect Render to GitHub repo

1. Open: `https://dashboard.render.com/blueprint/new?repo=https://github.com/<your-user>/<your-repo>`
2. Confirm the detected Blueprint from `render.yaml`.
3. Click "Apply".

After this, pushes to GitHub update the Render static service.

## 4) Connect Supabase deploy pipeline via GitHub Actions

In GitHub repo settings, add these secrets:

- `SUPABASE_ACCESS_TOKEN` (from Supabase account settings)
- `SUPABASE_DB_PASSWORD` (database password for project `mligzafrdckazvagqeht`)

Then push to `main` with changes under `supabase/**`; GitHub Actions will:

1. link the project,
2. run `supabase db push`,
3. deploy `make-server-f118884a`.

## 5) One-time provider auth

- Vercel: connect GitHub account/org and authorize repo access
- Render: connect GitHub account/org and authorize repo access
- Supabase: generate personal access token and set GitHub secrets

Once these are done, your normal workflow is only:

```bash
git add .
git commit -m "your update"
git push
```
