# Gyotaku Web

Mobile-first React app: upload → size → generate → preview → order. Also hosts the **operator console** at `/operator`.

See also:

- [Root README](../README.md)
- [Deployment](../docs/DEPLOYMENT.md)
- [Operator](../docs/OPERATOR.md)
- [Affiliates](../docs/AFFILIATES.md)

## Dev

```bash
# API + worker + docker compose should be running
cd web
npm install
npm run dev
```

Vite proxies `/api` → `http://localhost:3000`.

## Customer flow

1. Upload (client downscales to 2048 long edge)
2. Enter fish length (life-size) or fit to paper
3. Create rendition, poll honest processing stages
4. Preview — density / ink / species / side; compare strategies; share `/?p=`
5. Order — fine art print or framed; gift note; Stripe checkout
6. Stripe return: `/?order=success|cancel&orderId=…` (paid unlock for clean preview + SVG)

Captain QR entry: `/?ref=<code>` (sticky in localStorage for checkout attribution).

## Operator

`/operator` — paste `OPERATOR_TOKEN`. Tabs: Fulfillment, Captains, Waitlist, Failed jobs, Metrics.

## Railway

Create a **separate** service (not the worker):

1. Root Directory = `web`
2. **Do not set** `VITE_API_URL` (use same-origin `/api`)
3. Public domain: `gyotaku.up.railway.app`
4. Delete `RAILPACK_SPA_OUTPUT_DIR` if set; optional `API_PROXY_TARGET=https://gyotaku-api.up.railway.app`
5. Deploy → open https://gyotaku.up.railway.app

Production builds talk to `https://gyotaku-api.up.railway.app` directly. `npm start` (`server.mjs`) serves the SPA.

Set API `PUBLIC_WEB_URL=https://gyotaku.up.railway.app` for Stripe redirects.
