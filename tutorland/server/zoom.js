import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readPrivateJson, writePrivateJson } from './storage.js'

const TOKEN_FILE = 'zoom-connections.enc'
const ZOOM_API = 'https://api.zoom.us/v2'

export function zoomConfigured() {
  return Boolean(
    process.env.ZOOM_CLIENT_ID
    && process.env.ZOOM_CLIENT_SECRET
    && /^[\da-f]{64}$/i.test(process.env.ZOOM_TOKEN_ENCRYPTION_KEY ?? ''),
  )
}

function tokenKey() {
  const key = process.env.ZOOM_TOKEN_ENCRYPTION_KEY
  if (!key || !/^[\da-f]{64}$/i.test(key)) {
    throw new Error('ZOOM_TOKEN_ENCRYPTION_KEY musi być kluczem hex o długości 64 znaków.')
  }
  return Buffer.from(key, 'hex')
}

function encrypt(value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  }
}

function decrypt(value) {
  const decipher = createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(value.iv, 'hex'))
  decipher.setAuthTag(Buffer.from(value.tag, 'hex'))
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'hex')),
    decipher.final(),
  ]).toString('utf8'))
}

async function readConnections() {
  return readPrivateJson(TOKEN_FILE)
}

async function writeConnection(userId, tokens) {
  const connections = await readConnections()
  connections[userId] = encrypt(tokens)
  await writePrivateJson(TOKEN_FILE, connections)
}

export async function saveZoomConnection(userId, tokens) {
  await writeConnection(userId, tokens)
}

async function getTokens(userId) {
  const connections = await readConnections()
  return connections[userId] ? decrypt(connections[userId]) : null
}

export async function hasZoomConnection(userId) {
  return Boolean(await getTokens(userId))
}

export function zoomRedirectUri() {
  const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173'
  return new URL('/api/zoom/callback', origin).href
}

export function zoomAuthorizationUrl(state) {
  if (!zoomConfigured()) {
    throw new Error('Brakuje ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET lub ZOOM_TOKEN_ENCRYPTION_KEY.')
  }
  const url = new URL('https://zoom.us/oauth/authorize')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', process.env.ZOOM_CLIENT_ID)
  url.searchParams.set('redirect_uri', zoomRedirectUri())
  url.searchParams.set('state', state)
  return url.href
}

async function tokenRequest(parameters) {
  const credentials = Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')
  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(parameters),
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`Zoom OAuth nie powiódł się: ${payload.error_description ?? payload.reason ?? response.statusText}`)
  }
  return payload
}

export async function exchangeZoomCode(code, userId = '') {
  if (!zoomConfigured()) throw new Error('Integracja Zoom wymaga konfiguracji danych aplikacji.')
  const payload = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: zoomRedirectUri(),
  })
  const tokens = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + Number(payload.expires_in) * 1000,
  }
  if (userId) await writeConnection(userId, tokens)
  const profileResponse = await fetch(`${ZOOM_API}/users/me`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  })
  if (!profileResponse.ok) {
    throw new Error('Nie udało się pobrać profilu konta Zoom.')
  }
  const profile = await profileResponse.json()
  const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Konto Zoom nie udostępniło prawidłowego adresu e-mail.')
  }
  return {
    tokens,
    email,
    imageUrl: typeof profile.pic_url === 'string' && /^https:\/\//i.test(profile.pic_url)
      ? profile.pic_url
      : '',
  }
}

async function freshAccessToken(userId) {
  const tokens = await getTokens(userId)
  if (!tokens) throw new Error('Korepetytor nie połączył jeszcze konta Zoom.')
  if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken
  if (!tokens.refreshToken) throw new Error('Połączenie z Zoom wygasło. Połącz konto ponownie.')
  const refreshed = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
  })
  const nextTokens = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + Number(refreshed.expires_in) * 1000,
  }
  await writeConnection(userId, nextTokens)
  return nextTokens.accessToken
}

export async function createZoomMeeting(userId, booking, tutor) {
  const accessToken = await freshAccessToken(userId)
  const response = await fetch(`${ZOOM_API}/users/me/meetings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic: `Tutorland — ${booking.subject} z ${tutor.firstName} ${tutor.lastName}`,
      type: 2,
      start_time: `${booking.date}T${booking.startTime}:00`,
      duration: 40,
      timezone: process.env.ZOOM_TIMEZONE ?? 'Europe/Warsaw',
      settings: { waiting_room: true },
    }),
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`Zoom nie utworzył spotkania: ${payload.message ?? response.statusText}`)
  }
  if (typeof payload.join_url !== 'string' || typeof payload.start_url !== 'string') {
    throw new Error('Zoom zwrócił spotkanie bez wymaganych linków.')
  }
  return { joinUrl: payload.join_url, startUrl: payload.start_url }
}
