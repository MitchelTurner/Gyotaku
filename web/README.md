# Gyotaku Web — Phase 2

Mobile-first upload → generate → preview UI for fish artwork.

## Dev

```bash
# API must be running on :3000 (and worker + infra)
cd web
npm install
npm run dev
```

Vite proxies `/api` → `http://localhost:3000`.

Set `VITE_API_URL` for production (absolute API origin).

## Flow

1. Upload (client downscales to 2048 long edge)
2. Presign → S3 PUT → complete
3. Create rendition, poll stages
4. Preview with style / density / ink controls (each change enqueues a new rendition)
