const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api'

function friendlyFetchError(err: unknown, what: string): Error {
  if (err instanceof TypeError) {
    return new Error(
      `${what} failed to fetch — check VITE_API_URL points at the API, CORS_ORIGINS allows this site, and the API is online.`,
    )
  }
  return err instanceof Error ? err : new Error(String(err))
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })
  } catch (err) {
    throw friendlyFetchError(err, path)
  }
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = await res.json()
      message = body.message || body.error || JSON.stringify(body)
      if (Array.isArray(message)) message = message.join(', ')
    } catch {
      /* ignore */
    }
    throw new Error(typeof message === 'string' ? message : 'Request failed')
  }
  return res.json() as Promise<T>
}

export type PresignResponse = {
  uploadId: string
  uploadUrl: string
  s3Key: string
  expiresInSeconds: number
  uploadMode?: 'api' | 's3'
}

export type CompleteResponse = {
  id: string
  sessionId: string
  s3Key: string
  imageHash: string
  width: number
  height: number
}

export type RenditionResponse = {
  id: string
  uploadId: string
  seed: number
  styleParams: Record<string, unknown>
  status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'REJECTED'
  stage: string | null
  matteScore: number | null
  estPlotSeconds: number | null
  paperWidthMm: number | null
  paperHeightMm: number | null
  fishLengthIn: number | null
  failureReason: string | null
  previewUrl: string | null
  createdAt: string
  completedAt: string | null
}

export type ShareRenditionResponse = {
  id: string
  status: string
  seed: number
  previewUrl: string
  estPlotSeconds: number | null
  paperWidthMm: number | null
  paperHeightMm: number | null
  fishLengthIn: number | null
  styleParams: { strategy: string | null }
}

export function presignUpload(body: {
  sessionId: string
  filename: string
  contentType: string
  contentLength?: number
}) {
  return request<PresignResponse>('/uploads/presign', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function completeUpload(uploadId: string, sessionId: string) {
  return request<CompleteResponse>(`/uploads/${uploadId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  })
}

export function createRendition(body: {
  uploadId: string
  sessionId: string
  styleParams?: Record<string, unknown>
  seed?: number
}) {
  return request<RenditionResponse>('/renditions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getRendition(id: string) {
  return request<RenditionResponse>(`/renditions/${id}`)
}

export function getShareRendition(id: string) {
  return request<ShareRenditionResponse>(`/share/renditions/${id}`)
}

export type ProductType = 'PLOTTED_ORIGINAL' | 'GICLEE' | 'GICLEE_FRAMED'

export type QuoteResponse = {
  productType: ProductType
  fishLengthIn: number | null
  band?: string
  sku?: string
  skuLabel?: string
  amountCents: number
  shippingCents?: number
  totalCents?: number
  currency: string
  label: string
  available?: boolean
  unavailableReason?: string | null
  queueEtaDays?: number | null
  waitlistOpen?: boolean
}

export type CheckoutResponse = {
  orderId: string
  checkoutUrl: string
  amountCents: number
  productAmountCents?: number
  shippingCents?: number
  sku?: string
  currency: string
  productType: ProductType
}

export type WaitlistResponse = {
  id: string
  email: string
  productType: ProductType
  sku: string | null
  fishLengthIn: number | null
  reason: string | null
  message: string
}

export type ReorderRecipe = {
  renditionId: string
  uploadId: string
  seed: number
  styleParams: Record<string, unknown>
}

export type OrderResponse = {
  id: string
  renditionId: string
  productType: ProductType
  status: string
  amountCents: number
  currency: string
  fishLengthIn: number | null
  editionNumber: number | null
  editionSize: number | null
  email: string | null
  trackingNumber: string | null
  paidAt: string | null
  createdAt: string
  previewUrl: string | null
  estPlotSeconds: number | null
  paperWidthMm: number | null
  paperHeightMm: number | null
  paid: boolean
  reorder: ReorderRecipe | null
}

export type OrderArtifactsResponse = {
  orderId: string
  productType: ProductType
  status: string
  editionNumber: number | null
  editionSize: number | null
  previewCleanUrl: string | null
  svgUrl: string | null
  paperWidthMm: number | null
  paperHeightMm: number | null
  estPlotSeconds: number | null
  seed: number
  styleParams: Record<string, unknown>
  renditionId: string
}

export function quoteOrder(productType: ProductType, fishLengthIn?: number | null) {
  const q = new URLSearchParams({ productType })
  if (fishLengthIn != null) q.set('fishLengthIn', String(fishLengthIn))
  return request<QuoteResponse>(`/orders/quote?${q}`)
}

export function createCheckout(body: {
  sessionId: string
  renditionId: string
  productType: ProductType
  fishLengthIn?: number | null
  email?: string
  giftNote?: string
}) {
  return request<CheckoutResponse>('/orders/checkout', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function joinWaitlist(body: {
  email: string
  sessionId?: string
  renditionId?: string
  fishLengthIn?: number | null
  productType?: ProductType
  note?: string
}) {
  return request<WaitlistResponse>('/orders/waitlist', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getOrder(orderId: string, sessionId: string) {
  const q = new URLSearchParams({ sessionId })
  return request<OrderResponse>(`/orders/${orderId}?${q}`)
}

export function getOrderArtifacts(orderId: string, sessionId: string) {
  const q = new URLSearchParams({ sessionId })
  return request<OrderArtifactsResponse>(`/orders/${orderId}/artifacts?${q}`)
}

/** Upload bytes via the API proxy (preferred) or a direct presigned S3 URL. */
export async function putUploadBytes(
  uploadId: string,
  uploadUrl: string,
  blob: Blob,
  contentType: string,
) {
  const viaApi =
    uploadUrl.startsWith('/') ||
    (uploadUrl.includes('/uploads/') && uploadUrl.endsWith('/content')) ||
    uploadUrl.includes('localhost') ||
    uploadUrl.includes('127.0.0.1')

  const url = viaApi
    ? `${API_BASE}/uploads/${uploadId}/content`
    : uploadUrl

  let res: Response
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
    })
  } catch (err) {
    throw friendlyFetchError(err, 'upload')
  }
  if (!res.ok) {
    let message = `Upload failed (${res.status})`
    try {
      const body = await res.json()
      message = body.message || body.error || message
      if (Array.isArray(message)) message = message.join(', ')
    } catch {
      /* ignore */
    }
    throw new Error(typeof message === 'string' ? message : 'Upload failed')
  }
}
