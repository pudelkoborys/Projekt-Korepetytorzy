export async function api(path, options = {}) {
  const endpoint = path.startsWith('/api/') ? path : `/api${path}`
  const response = await fetch(endpoint, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : options.body,
  })

  let payload = {}
  if (response.status !== 204) {
    const body = await response.text()
    if (body) {
      try {
        payload = JSON.parse(body)
      } catch {
        const message = `Serwer zwrócił nieprawidłową odpowiedź dla ${endpoint} (HTTP ${response.status}).`
        throw new Error(response.ok ? message : `Serwer hostingu zwrócił stronę HTML zamiast JSON dla ${endpoint} (HTTP ${response.status}).`)
      }
    }
  }
  if (!response.ok) throw new Error(payload.error || `Żądanie nie powiodło się (${response.status}).`)
  return payload
}

export function formatDate(date, options = { day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Intl.DateTimeFormat('pl-PL', options).format(new Date(`${date}T12:00:00`))
}

export function formatTime(totalMinutes) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}
