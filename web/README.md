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

## Railway (live site)

Create a **separate** service (not the worker):

1. New service → same GitHub repo  
2. **Root Directory** = `web`  
3. **Do not set** `VITE_API_URL` (leave empty so the app uses `/api`)  
4. Runtime variable: `API_PROXY_TARGET=https://gyotaku.up.railway.app`  
5. Deploy → open **this** service’s public URL (`gyotaku-web.up.railway.app`)

Caddy proxies `/api/*` → the API (avoids CORS). The worker URL is not the frontend.

## Flow

1. Upload (client downscales to 2048 long edge)
2. Enter fish length (life-size) or fit to paper
3. Create rendition, poll stages
4. Preview with style / density / ink / length controls
5. **Order this print** → plotted original or giclée → Stripe Checkout
6. Return URLs: `/?order=success|cancel&orderId=…`

Set API `PUBLIC_WEB_URL` to this site’s origin so Stripe redirects work.
