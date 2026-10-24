export async function api(path, options = {}) {
  const response = await fetch(path.startsWith('/api/') ? path : `/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : options.body,
  })

  const payload = response.status === 204 ? {} : await response.json()
  if (!response.ok) throw new Error(payload.error || `Żądanie nie powiodło się (${response.status}).`)
  return payload
}

export function formatDate(date, options = { day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Intl.DateTimeFormat('pl-PL', options).format(new Date(`${date}T12:00:00`))
}

export function formatTime(totalMinutes) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}
