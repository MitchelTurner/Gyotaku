const KEY = 'gyotaku_session_id'
const AFFILIATE_KEY = 'gyotaku_affiliate_code'

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function getSessionId(): string {
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = makeId()
    localStorage.setItem(KEY, id)
  }
  return id
}

/** Persist captain referral from QR (?ref=CODE). */
export function setAffiliateCode(code: string) {
  const cleaned = code.trim().toLowerCase()
  if (!cleaned) return
  localStorage.setItem(AFFILIATE_KEY, cleaned)
}

export function getAffiliateCode(): string | null {
  return localStorage.getItem(AFFILIATE_KEY)
}

export function clearAffiliateCode() {
  localStorage.removeItem(AFFILIATE_KEY)
}
