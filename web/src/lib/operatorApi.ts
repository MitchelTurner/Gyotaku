const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api'

const TOKEN_KEY = 'gyotaku.operatorToken'

export function getOperatorToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) || ''
}

export function setOperatorToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearOperatorToken() {
  sessionStorage.removeItem(TOKEN_KEY)
}

export type OperatorStatus =
  | 'PAID'
  | 'PLOTTING'
  | 'PRINTING'
  | 'PACKED'
  | 'SHIPPED'
  | 'CANCELLED'

export type OperatorOrder = {
  id: string
  productType: 'PLOTTED_ORIGINAL' | 'GICLEE'
  status: OperatorStatus | string
  amountCents: number
  currency: string
  fishLengthIn: number | null
  editionNumber: number | null
  editionSize: number | null
  email: string | null
  shipping: {
    name: string | null
    line1: string | null
    line2: string | null
    city: string | null
    state: string | null
    postal: string | null
    country: string | null
  }
  trackingNumber: string | null
  shippingLabelUrl: string | null
  shippingCarrier: string | null
  shippingService: string | null
  fulfillmentNote: string | null
  paidAt: string | null
  createdAt: string
  estPlotSeconds: number | null
  paperWidthMm: number | null
  paperHeightMm: number | null
  renditionId: string
  seed: number
  svgUrl: string | null
  previewUrl: string | null
  previewCleanUrl: string | null
  printUrl: string | null
  hasPrint: boolean
}

export type PlottedAvailability = {
  productType: 'PLOTTED_ORIGINAL'
  open: boolean
  reason: string | null
  queueEtaDays: number
  maxDays: number
  editionNext: number
  editionSize: number
}

export type OperatorQueueResponse = {
  availability: PlottedAvailability
  orders: OperatorOrder[]
}

async function operatorRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getOperatorToken()
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-operator-token': token,
        ...(init?.headers || {}),
      },
    })
  } catch {
    throw new Error('Failed to reach API')
  }
  if (res.status === 401) {
    throw new Error('Invalid operator token')
  }
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = await res.json()
      message = body.message || body.error || message
      if (Array.isArray(message)) message = message.join(', ')
    } catch {
      /* ignore */
    }
    throw new Error(typeof message === 'string' ? message : 'Request failed')
  }
  return res.json() as Promise<T>
}

export function listOperatorOrders(status?: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : ''
  return operatorRequest<OperatorQueueResponse>(`/operator/orders${q}`)
}

export function patchOperatorOrder(
  id: string,
  body: {
    status: OperatorStatus
    trackingNumber?: string
    fulfillmentNote?: string
  },
) {
  return operatorRequest<OperatorOrder>(`/operator/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function createOperatorLabel(id: string) {
  return operatorRequest<OperatorOrder>(`/operator/orders/${id}/label`, {
    method: 'POST',
  })
}

export function requestOperatorPrint(id: string) {
  return operatorRequest<OperatorOrder>(`/operator/orders/${id}/print`, {
    method: 'POST',
  })
}
