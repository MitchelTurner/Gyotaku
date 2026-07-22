const KEY = 'gyotaku_session_id'

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
