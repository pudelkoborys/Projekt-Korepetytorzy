import './load-env.js'
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { initializeStorage, readCsv, updateCsv } from './storage.js'
import {
  createZoomMeeting,
  exchangeZoomCode,
  hasZoomConnection,
  saveZoomConnection,
  zoomAuthorizationUrl,
  zoomConfigured,
} from './zoom.js'

const scrypt = promisify(scryptCallback)
const port = Number(process.env.API_PORT ?? 3001)
const cookieName = 'tutorland_session'
const sessionDuration = 14 * 24 * 60 * 60 * 1000
const lessonDuration = 40
const loginAttempts = new Map()
const levels = new Set(['primary', 'secondary', 'tertiary'])
const lessonSubjects = new Set([
  'Matematyka', 'Fizyka', 'Chemia', 'Informatyka', 'Angielski', 'Biologia',
  'Polski', 'Historia', 'Geografia', 'WOS', 'Filozofia', 'Ekonomia',
])

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeReturnTo(value, fallback = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback
  }
  const target = new URL(value, 'http://localhost')
  return `${target.pathname}${target.search}${target.hash}`
}

function plDateTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.ZOOM_TIMEZONE ?? 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  }
}

function timeToMinutes(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value ?? '')) return NaN
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function getWeekday(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay()
}

function isBookingPast(booking) {
  const now = plDateTime()
  if (booking.date < now.date) return true
  if (booking.date > now.date) return false
  return timeToMinutes(booking.endTime) <= now.minutes
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie ?? '').split(';')
    .map((part) => part.trim().split(/=(.*)/s).slice(0, 2))
    .filter(([key, value]) => key && value !== undefined)
    .map(([key, value]) => [key, decodeURIComponent(value)]))
}

function setSessionCookie(response, token, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader(
    'Set-Cookie',
    `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  )
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader(
    'Set-Cookie',
    `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  )
}

function send(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1024 * 1024) throw new HttpError(413, 'Żądanie jest zbyt duże.')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Treść żądania musi być poprawnym JSON-em.')
  }
}

function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    tutorId: user.tutorId || '',
  }
}

async function currentUser(request) {
  const token = parseCookies(request)[cookieName]
  if (!token) return null
  const tokenHash = hash(token)
  const sessions = await readCsv('sessions')
  const session = sessions.find((item) => item.tokenHash === tokenHash)
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null
  const users = await readCsv('users')
  return users.find((user) => user.id === session.userId) ?? null
}

async function requireUser(request) {
  const user = await currentUser(request)
  if (!user) throw new HttpError(401, 'Zaloguj się, aby kontynuować.')
  return user
}

function requireRole(user, role) {
  if (user.role !== role) throw new HttpError(403, 'Ta funkcja jest dostępna dla innej roli konta.')
}

async function createSession(userId, response) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + sessionDuration).toISOString()
  await updateCsv('sessions', async (sessions) => ({
    records: [
      ...sessions.filter((session) => Date.parse(session.expiresAt) > Date.now()),
      { tokenHash: hash(token), userId, expiresAt },
    ],
    result: null,
  }))
  setSessionCookie(response, token, Math.floor(sessionDuration / 1000))
}

async function tutorById(tutorId) {
  const tutors = await readCsv('tutors')
  return tutors.find((tutor) => tutor.tutorId === tutorId)
}

async function ownedTutor(user) {
  requireRole(user, 'tutor')
  const tutor = await tutorById(user.tutorId)
  if (!tutor) throw new HttpError(404, 'Nie znaleziono profilu korepetytora.')
  return tutor
}

function tutorPublic(tutor, reviews) {
  const tutorReviews = reviews.filter((review) => review.tutorId === tutor.tutorId)
  const rating = tutorReviews.length
    ? tutorReviews.reduce((sum, review) => sum + Number(review.rating), 0) / tutorReviews.length
    : Number(tutor.rating || 0)
  const { email: _email, ...publicProfile } = tutor
  return {
    ...publicProfile,
    rating: Math.round(rating * 10) / 10,
    reviewCount: tutorReviews.length,
    subjects: String(tutor.subjects ?? '').split('|').filter(Boolean),
    levels: String(tutor.levels ?? '').split('|').filter(Boolean),
    pricePerLesson: Number(tutor.pricePerLesson),
    teachingSinceYear: Number(tutor.teachingSinceYear),
    age: Number(tutor.age || 0),
  }
}

function cleanReview(review, name = 'Uczeń') {
  return {
    id: review.id,
    tutorId: review.tutorId,
    bookingId: review.bookingId,
    rating: Number(review.rating),
    date: review.date,
    comment: review.comment,
    studentName: name,
  }
}

function isValidName(name) {
  return typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 80
}

function cleanSubjects(value) {
  if (!Array.isArray(value) || !value.length || value.length > 12) {
    throw new HttpError(400, 'Wybierz od 1 do 12 przedmiotów.')
  }
  const subjects = [...new Set(value)]
  if (subjects.some((subject) => typeof subject !== 'string' || !lessonSubjects.has(subject))) {
    throw new HttpError(400, 'Lista zawiera nieobsługiwany przedmiot.')
  }
  return subjects
}

function cleanLevels(value) {
  if (!Array.isArray(value) || !value.length || value.some((level) => !levels.has(level))) {
    throw new HttpError(400, 'Wybierz co najmniej jeden prawidłowy poziom nauczania.')
  }
  return [...new Set(value)]
}

function validateSchedule(weekly, daysOff) {
  if (!Array.isArray(weekly) || weekly.length > 14 || !Array.isArray(daysOff) || daysOff.length > 400) {
    throw new HttpError(400, 'Plan dostępności ma nieprawidłowy format.')
  }
  const normalized = weekly.map((range) => {
    const weekday = Number(range.weekday)
    const start = timeToMinutes(range.startTime)
    const end = timeToMinutes(range.endTime)
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isFinite(start)
      || !Number.isFinite(end) || end - start < lessonDuration) {
      throw new HttpError(400, 'Zakres godzin musi obejmować co najmniej jedną lekcję 40-minutową.')
    }
    return { weekday: String(weekday), startTime: range.startTime, endTime: range.endTime }
  })

  for (let index = 0; index < normalized.length; index += 1) {
    for (let other = index + 1; other < normalized.length; other += 1) {
      const current = normalized[index]
      const next = normalized[other]
      if (current.weekday === next.weekday
        && timeToMinutes(current.startTime) < timeToMinutes(next.endTime)
        && timeToMinutes(next.startTime) < timeToMinutes(current.endTime)) {
        throw new HttpError(400, 'Zakresy godzin w tym samym dniu nie mogą na siebie nachodzić.')
      }
    }
  }

  const uniqueDaysOff = [...new Set(daysOff)]
  const today = plDateTime().date
  if (uniqueDaysOff.some((date) => !isValidDate(date) || date < today)) {
    throw new HttpError(400, 'Dni wolne muszą być prawidłowymi datami bieżącymi lub przyszłymi.')
  }
  return { weekly: normalized, daysOff: uniqueDaysOff }
}

function validateBookingSlot(tutor, date, startTime, subject, availability, daysOff, bookings) {
  if (!isValidDate(date) || date < plDateTime().date) {
    throw new HttpError(400, 'Wybierz prawidłowy dzień w przyszłości.')
  }
  const start = timeToMinutes(startTime)
  if (!Number.isFinite(start) || date === plDateTime().date && start <= plDateTime().minutes) {
    throw new HttpError(400, 'Wybrana godzina już minęła.')
  }
  if (!String(tutor.subjects).split('|').includes(subject)) {
    throw new HttpError(400, 'Wybierz przedmiot z oferty korepetytora.')
  }
  if (daysOff.some((day) => day.tutorId === tutor.tutorId && day.date === date)) {
    throw new HttpError(409, 'Korepetytor oznaczył ten dzień jako wolny.')
  }
  const weekday = String(getWeekday(date))
  const allowed = availability.some((range) => {
    if (range.tutorId !== tutor.tutorId || range.weekday !== weekday) return false
    const rangeStart = timeToMinutes(range.startTime)
    const rangeEnd = timeToMinutes(range.endTime)
    return start >= rangeStart
      && start + lessonDuration <= rangeEnd
      && (start - rangeStart) % lessonDuration === 0
  })
  if (!allowed) throw new HttpError(409, 'Wybrany termin nie należy już do dostępnych godzin.')
  const overlaps = bookings.some((booking) => {
    if (booking.tutorId !== tutor.tutorId || booking.date !== date) return false
    const bookingStart = timeToMinutes(booking.startTime)
    const bookingEnd = timeToMinutes(booking.endTime)
    return start < bookingEnd && bookingStart < start + lessonDuration
  })
  if (overlaps) throw new HttpError(409, 'Ten termin został już zarezerwowany.')
}

function formatTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

async function provisionBooking(booking, tutor, userId) {
  const meeting = await createZoomMeeting(userId, booking, tutor)
  await updateCsv('bookings', async (bookings) => ({
    records: bookings.map((item) => item.id === booking.id
      ? { ...item, zoomStatus: 'ready', zoomJoinUrl: meeting.joinUrl, zoomStartUrl: meeting.startUrl }
      : item),
    result: null,
  }))
  return { ...booking, zoomStatus: 'ready', zoomJoinUrl: meeting.joinUrl, zoomStartUrl: meeting.startUrl }
}

async function provisionPendingBookings(tutor, userId) {
  const pending = (await readCsv('bookings')).filter((booking) => (
    booking.tutorId === tutor.tutorId
    && ['pending', 'failed'].includes(booking.zoomStatus)
    && !booking.zoomJoinUrl
  ))
  for (const booking of pending) {
    try {
      await provisionBooking(booking, tutor, userId)
    } catch (error) {
      console.error(`Nie udało się utworzyć spotkania Zoom dla rezerwacji ${booking.id}:`, error.message)
    }
  }
}

async function serve(request, response) {
  const url = new URL(request.url, 'http://localhost')
  const { pathname } = url
  if (!pathname.startsWith('/api/')) throw new HttpError(404, 'Nie znaleziono strony API.')
  const method = request.method ?? 'GET'

  if (method === 'GET' && pathname === '/api/auth/me') {
    return send(response, 200, { user: publicUser(await currentUser(request)) })
  }

  if (method === 'GET' && pathname === '/api/auth/providers') {
    return send(response, 200, { zoom: zoomConfigured() })
  }

  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = await readBody(request)
    if (!['student', 'tutor'].includes(body.role)) {
      throw new HttpError(400, 'Wybierz rolę ucznia lub korepetytora.')
    }
    if (!isValidName(body.firstName) || !isValidName(body.lastName)) {
      throw new HttpError(400, 'Podaj imię i nazwisko.')
    }
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new HttpError(400, 'Podaj prawidłowy adres e-mail.')
    }
    if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 128) {
      throw new HttpError(400, 'Hasło musi mieć od 10 do 128 znaków.')
    }

    const salt = randomBytes(16).toString('hex')
    const derivedKey = await scrypt(body.password, salt, 64, { N: 16384, maxmem: 64 * 1024 * 1024 })
    const tutorId = body.role === 'tutor'
      ? `${body.firstName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomBytes(5).toString('hex')}`
      : ''
    const user = {
      id: randomUUID(),
      role: body.role,
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      email,
      passwordHash: `${salt}:${derivedKey.toString('hex')}`,
      tutorId,
      createdAt: new Date().toISOString(),
    }

    const created = await updateCsv('users', async (users) => {
      if (users.some((item) => item.email.toLowerCase() === email)) {
        throw new HttpError(409, 'Konto z tym adresem e-mail już istnieje.')
      }
      return { records: [...users, user], result: true }
    })
    if (!created) throw new Error('Nie udało się utworzyć konta.')

    if (body.role === 'tutor') {
      await updateCsv('tutors', async (tutors) => ({
        records: [...tutors, {
          tutorId,
          firstName: user.firstName,
          lastName: user.lastName,
          age: '',
          teachingSinceYear: new Date().getFullYear(),
          description: 'Dodaj opis swojej oferty i doświadczenia.',
          rating: 0,
          pricePerLesson: 100,
          levels: 'primary',
          subjects: 'Matematyka',
          imagePath: '',
          email,
        }],
        result: null,
      }))
    }
    await createSession(user.id, response)
    return send(response, 201, {
      user: publicUser(user),
      zoomConfigured: body.role === 'tutor' && zoomConfigured(),
    })
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(request)
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!['student', 'tutor'].includes(body.role)) {
      throw new HttpError(400, 'Wybierz rolę ucznia lub korepetytora.')
    }
    const attemptKey = `${request.socket.remoteAddress}:${email}`
    const attempts = loginAttempts.get(attemptKey) ?? []
    const recentAttempts = attempts.filter((time) => Date.now() - time < 15 * 60 * 1000)
    if (recentAttempts.length >= 8) throw new HttpError(429, 'Zbyt wiele prób. Spróbuj ponownie za 15 minut.')
    recentAttempts.push(Date.now())
    loginAttempts.set(attemptKey, recentAttempts)

    const users = await readCsv('users')
    const user = users.find((item) => item.email.toLowerCase() === email)
    const [salt, passwordHash] = String(user?.passwordHash ?? ':').split(':')
    const candidate = await scrypt(String(body.password ?? ''), salt || 'invalid', 64, {
      N: 16384,
      maxmem: 64 * 1024 * 1024,
    })
    const expected = Buffer.from(passwordHash || '0'.repeat(128), 'hex')
    if (!user || user.role !== body.role || expected.length !== candidate.length || !timingSafeEqual(expected, candidate)) {
      throw new HttpError(401, 'Nieprawidłowy adres e-mail lub hasło.')
    }
    loginAttempts.delete(attemptKey)
    const tutorZoomConfigured = user.role === 'tutor' && zoomConfigured()
    const tutorZoomConnected = tutorZoomConfigured ? await hasZoomConnection(user.id) : false
    await createSession(user.id, response)
    return send(response, 200, {
      user: publicUser(user),
      zoomConfigured: tutorZoomConfigured,
      zoomConnected: tutorZoomConnected,
    })
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    const token = parseCookies(request)[cookieName]
    if (token) {
      await updateCsv('sessions', async (sessions) => ({
        records: sessions.filter((session) => session.tokenHash !== hash(token)),
        result: null,
      }))
    }
    clearSessionCookie(response)
    return send(response, 200, { success: true })
  }

  if (method === 'GET' && pathname === '/api/tutors') {
    const [tutors, reviews] = await Promise.all([readCsv('tutors'), readCsv('reviews')])
    return send(response, 200, { tutors: tutors.map((tutor) => tutorPublic(tutor, reviews)) })
  }

  const tutorAvailabilityMatch = pathname.match(/^\/api\/tutors\/([^/]+)\/availability$/)
  if (method === 'GET' && tutorAvailabilityMatch) {
    const tutorId = decodeURIComponent(tutorAvailabilityMatch[1])
    const [tutor, availability, daysOff, bookings] = await Promise.all([
      tutorById(tutorId),
      readCsv('availability'),
      readCsv('daysOff'),
      readCsv('bookings'),
    ])
    if (!tutor) throw new HttpError(404, 'Nie znaleziono korepetytora.')
    const month = url.searchParams.get('month') ?? ''
    const datePrefix = /^\d{4}-\d{2}$/.test(month) ? `${month}-` : ''
    return send(response, 200, {
      availability: availability.filter((range) => range.tutorId === tutorId),
      daysOff: daysOff.filter((day) => day.tutorId === tutorId && (!datePrefix || day.date.startsWith(datePrefix))),
      busy: bookings.filter((booking) => booking.tutorId === tutorId)
        .map(({ date, startTime, endTime }) => ({ date, startTime, endTime })),
    })
  }

  const tutorMatch = pathname.match(/^\/api\/tutors\/([^/]+)$/)
  if (method === 'GET' && tutorMatch) {
    const tutorId = decodeURIComponent(tutorMatch[1])
    const [tutors, reviews, users] = await Promise.all([
      readCsv('tutors'),
      readCsv('reviews'),
      readCsv('users'),
    ])
    const tutor = tutors.find((item) => item.tutorId === tutorId)
    if (!tutor) throw new HttpError(404, 'Nie znaleziono korepetytora.')
    const userNames = new Map(users.map((item) => [item.id, `${item.firstName} ${item.lastName}`]))
    const publicReviews = reviews.filter((review) => review.tutorId === tutorId)
      .map((review) => cleanReview(
        review,
        userNames.get(review.studentId) ?? 'Uczeń',
      ))
    return send(response, 200, { tutor: tutorPublic(tutor, reviews), reviews: publicReviews })
  }

  if (method === 'GET' && pathname === '/api/bookings') {
    const user = await requireUser(request)
    const bookings = await readCsv('bookings')
    const visible = user.role === 'student'
      ? bookings.filter((booking) => booking.studentId === user.id)
      : bookings.filter((booking) => booking.tutorId === user.tutorId)
    const [users, tutors] = await Promise.all([readCsv('users'), readCsv('tutors')])
    const userById = new Map(users.map((item) => [item.id, item]))
    const tutorByIdMap = new Map(tutors.map((tutor) => [tutor.tutorId, tutor]))
    return send(response, 200, {
      bookings: visible.map((booking) => {
        const student = userById.get(booking.studentId)
        const tutor = tutorByIdMap.get(booking.tutorId)
        const safeBooking = { ...booking }
        delete safeBooking.studentEmail
        delete safeBooking.studentId
        if (user.role !== 'tutor') delete safeBooking.zoomStartUrl
        return {
          ...safeBooking,
          studentName: student ? `${student.firstName} ${student.lastName}` : 'Uczeń',
          tutorName: tutor ? `${tutor.firstName} ${tutor.lastName}` : 'Korepetytor',
          isPast: isBookingPast(booking),
        }
      }),
    })
  }

  if (method === 'POST' && pathname === '/api/bookings') {
    const user = await requireUser(request)
    requireRole(user, 'student')
    const body = await readBody(request)
    const tutor = await tutorById(String(body.tutorId ?? ''))
    if (!tutor) throw new HttpError(404, 'Nie znaleziono korepetytora.')
    const availability = await readCsv('availability')
    const daysOff = await readCsv('daysOff')
    const date = String(body.date ?? '')
    const startTime = String(body.startTime ?? '')
    const subject = String(body.subject ?? '')
    let booking

    await updateCsv('bookings', async (bookings) => {
      validateBookingSlot(tutor, date, startTime, subject, availability, daysOff, bookings)
      const id = randomUUID()
      const endTime = formatTime(timeToMinutes(startTime) + lessonDuration)
      booking = {
        id,
        tutorId: tutor.tutorId,
        studentId: user.id,
        studentEmail: user.email,
        date,
        startTime,
        endTime,
        durationMinutes: String(lessonDuration),
        subject,
        zoomStatus: 'pending',
        zoomJoinUrl: '',
        zoomStartUrl: '',
      }
      return { records: [...bookings, booking], result: null }
    })

    if (await hasZoomConnection(await tutorAccountId(tutor.tutorId))) {
      try {
        booking = await provisionBooking(booking, tutor, await tutorAccountId(tutor.tutorId))
      } catch (error) {
        console.error(`Nie udało się utworzyć spotkania Zoom dla rezerwacji ${booking.id}:`, error.message)
        booking = { ...booking, zoomStatus: 'failed', zoomError: error.message }
        await updateCsv('bookings', async (bookings) => ({
          records: bookings.map((item) => item.id === booking.id ? booking : item),
          result: null,
        }))
      }
    } else {
      booking.zoomStatus = 'pending'
    }
    return send(response, 201, {
      booking: {
        id: booking.id,
        tutorId: booking.tutorId,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        durationMinutes: booking.durationMinutes,
        subject: booking.subject,
        zoomStatus: booking.zoomStatus,
        zoomJoinUrl: booking.zoomJoinUrl || '',
        ...(booking.zoomError ? { zoomError: booking.zoomError } : {}),
      },
    })
  }

  if (method === 'GET' && pathname === '/api/tutor/profile') {
    const user = await requireUser(request)
    const tutor = await ownedTutor(user)
    const reviews = await readCsv('reviews')
    return send(response, 200, { tutor: tutorPublic(tutor, reviews) })
  }

  if (method === 'PUT' && pathname === '/api/tutor/profile') {
    const user = await requireUser(request)
    const tutor = await ownedTutor(user)
    const body = await readBody(request)
    if (!isValidName(body.firstName) || !isValidName(body.lastName)) {
      throw new HttpError(400, 'Podaj prawidłowe imię i nazwisko.')
    }
    const description = String(body.description ?? '').trim()
    const price = Number(body.pricePerLesson)
    const teachingSinceYear = Number(body.teachingSinceYear)
    if (description.length < 20 || description.length > 2000
      || !Number.isInteger(price) || price < 20 || price > 1000
      || !Number.isInteger(teachingSinceYear) || teachingSinceYear < 1950 || teachingSinceYear > new Date().getFullYear()) {
      throw new HttpError(400, 'Sprawdź opis, cenę i rok rozpoczęcia nauczania.')
    }
    const subjects = cleanSubjects(body.subjects)
    const tutorLevels = cleanLevels(body.levels)
    await updateCsv('tutors', async (tutors) => ({
      records: tutors.map((item) => item.tutorId === tutor.tutorId ? {
        ...item,
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        description,
        pricePerLesson: String(price),
        teachingSinceYear: String(teachingSinceYear),
        subjects: subjects.join('|'),
        levels: tutorLevels.join('|'),
      } : item),
      result: null,
    }))
    await updateCsv('users', async (users) => ({
      records: users.map((item) => item.id === user.id
        ? { ...item, firstName: body.firstName.trim(), lastName: body.lastName.trim() }
        : item),
      result: null,
    }))
    return send(response, 200, { success: true })
  }

  if (method === 'GET' && pathname === '/api/tutor/availability') {
    const user = await requireUser(request)
    const tutor = await ownedTutor(user)
    const [availability, daysOff] = await Promise.all([readCsv('availability'), readCsv('daysOff')])
    return send(response, 200, {
      weekly: availability.filter((range) => range.tutorId === tutor.tutorId),
      daysOff: daysOff.filter((day) => day.tutorId === tutor.tutorId).map((day) => day.date),
    })
  }

  if (method === 'PUT' && pathname === '/api/tutor/availability') {
    const user = await requireUser(request)
    const tutor = await ownedTutor(user)
    const body = await readBody(request)
    const { weekly, daysOff } = validateSchedule(body.weekly, body.daysOff)
    await updateCsv('availability', async (ranges) => ({
      records: [
        ...ranges.filter((range) => range.tutorId !== tutor.tutorId),
        ...weekly.map((range) => ({ ...range, tutorId: tutor.tutorId })),
      ],
      result: null,
    }))
    await updateCsv('daysOff', async (entries) => ({
      records: [
        ...entries.filter((entry) => entry.tutorId !== tutor.tutorId),
        ...daysOff.map((date) => ({ tutorId: tutor.tutorId, date })),
      ],
      result: null,
    }))
    return send(response, 200, { success: true })
  }

  if (method === 'GET' && pathname === '/api/tutor/notifications') {
    const user = await requireUser(request)
    const tutor = await ownedTutor(user)
    const [bookings, reviews, users] = await Promise.all([
      readCsv('bookings'),
      readCsv('reviews'),
      readCsv('users'),
    ])
    const userById = new Map(users.map((item) => [item.id, item]))
    const tutorBookings = bookings.filter((booking) => booking.tutorId === tutor.tutorId)
      .map((booking) => {
        const safeBooking = { ...booking }
        delete safeBooking.studentEmail
        delete safeBooking.studentId
        delete safeBooking.zoomJoinUrl
        return {
          ...safeBooking,
          studentName: userById.has(booking.studentId)
            ? `${userById.get(booking.studentId).firstName} ${userById.get(booking.studentId).lastName}`
            : 'Uczeń',
          isPast: isBookingPast(booking),
        }
      })
    const tutorReviews = reviews.filter((review) => review.tutorId === tutor.tutorId)
      .map((review) => cleanReview(
        review,
        userById.has(review.studentId)
          ? `${userById.get(review.studentId).firstName} ${userById.get(review.studentId).lastName}`
          : 'Uczeń',
      ))
    return send(response, 200, { bookings: tutorBookings, reviews: tutorReviews })
  }

  if (method === 'GET' && pathname === '/api/reviews/mine') {
    const user = await requireUser(request)
    requireRole(user, 'student')
    const [reviews, tutors] = await Promise.all([readCsv('reviews'), readCsv('tutors')])
    const tutorNames = new Map(tutors.map((tutor) => [tutor.tutorId, `${tutor.firstName} ${tutor.lastName}`]))
    return send(response, 200, {
      reviews: reviews.filter((review) => review.studentId === user.id).map((review) => ({
        ...cleanReview(review, 'Ty'),
        tutorName: tutorNames.get(review.tutorId) ?? 'Korepetytor',
      })),
    })
  }

  if (method === 'POST' && pathname === '/api/reviews') {
    const user = await requireUser(request)
    requireRole(user, 'student')
    const body = await readBody(request)
    const bookingId = String(body.bookingId ?? '')
    const rating = Number(body.rating)
    const comment = String(body.comment ?? '').trim()
    if (!Number.isInteger(rating) || rating < 1 || rating > 5
      || comment.length < 3 || comment.length > 2000) {
      throw new HttpError(400, 'Ocena musi wynosić 1–5, a komentarz od 3 do 2000 znaków.')
    }
    const booking = (await readCsv('bookings')).find((item) => (
      item.id === bookingId && item.studentId === user.id
    ))
    if (!booking || !isBookingPast(booking)) {
      throw new HttpError(403, 'Opinię możesz dodać po zakończeniu własnej lekcji.')
    }
    const review = {
      id: randomUUID(),
      studentId: user.id,
      studentEmail: user.email,
      tutorId: booking.tutorId,
      bookingId,
      rating: String(rating),
      date: plDateTime().date,
      comment,
      updatedAt: new Date().toISOString(),
    }
    await updateCsv('reviews', async (reviews) => {
      if (reviews.some((item) => item.studentId === user.id && item.tutorId === booking.tutorId)) {
        throw new HttpError(409, 'Masz już opinię dla tego korepetytora. Możesz ją edytować lub usunąć.')
      }
      return { records: [...reviews, review], result: null }
    })
    return send(response, 201, { review: cleanReview(review, 'Ty') })
  }

  const reviewMatch = pathname.match(/^\/api\/reviews\/([^/]+)$/)
  if ((method === 'PUT' || method === 'DELETE') && reviewMatch) {
    const user = await requireUser(request)
    requireRole(user, 'student')
    const reviewId = decodeURIComponent(reviewMatch[1])
    const body = method === 'PUT' ? await readBody(request) : {}
    const rating = Number(body.rating)
    const comment = String(body.comment ?? '').trim()
    if (method === 'PUT' && (!Number.isInteger(rating) || rating < 1 || rating > 5
      || comment.length < 3 || comment.length > 2000)) {
      throw new HttpError(400, 'Ocena musi wynosić 1–5, a komentarz od 3 do 2000 znaków.')
    }
    let result
    await updateCsv('reviews', async (reviews) => {
      const target = reviews.find((item) => item.id === reviewId && item.studentId === user.id)
      if (!target) throw new HttpError(404, 'Nie znaleziono Twojej opinii.')
      const next = method === 'DELETE'
        ? reviews.filter((item) => item.id !== reviewId)
        : reviews.map((item) => item.id === reviewId ? {
          ...item,
          rating: String(rating),
          comment,
          updatedAt: new Date().toISOString(),
        } : item)
      result = method === 'PUT' ? next.find((item) => item.id === reviewId) : null
      return { records: next, result: null }
    })
    return send(response, 200, method === 'PUT' ? { review: cleanReview(result, 'Ty') } : { success: true })
  }

  if (method === 'GET' && pathname === '/api/zoom/status') {
    const user = await requireUser(request)
    const tutor = await ownedTutor(user)
    return send(response, 200, {
      connected: await hasZoomConnection(user.id),
      configured: zoomConfigured(),
      hasProfilePhoto: Boolean(tutor.imagePath),
    })
  }

  if (method === 'GET' && pathname === '/api/zoom/connect') {
    const user = await requireUser(request)
    requireRole(user, 'tutor')
    if (!zoomConfigured()) {
      throw new HttpError(503, 'Integracja Zoom wymaga ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET i ZOOM_TOKEN_ENCRYPTION_KEY.')
    }
    const state = randomBytes(32).toString('base64url')
    await updateCsv('oauthStates', async (states) => ({
      records: [
        ...states.filter((item) => Date.parse(item.expiresAt) > Date.now()),
        {
          stateHash: hash(state),
          userId: user.id,
          purpose: 'connect',
          role: 'tutor',
          returnTo: '/profile?zoom=connected',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        },
      ],
      result: null,
    }))
    response.writeHead(302, { Location: zoomAuthorizationUrl(state), 'Cache-Control': 'no-store' })
    return response.end()
  }

  if (method === 'GET' && pathname === '/api/zoom/login') {
    const role = url.searchParams.get('role') ?? ''
    if (!['student', 'tutor'].includes(role)) {
      throw new HttpError(400, 'Wybierz rolę ucznia lub korepetytora.')
    }
    if (!zoomConfigured()) {
      throw new HttpError(503, 'Logowanie Zoom wymaga ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET i ZOOM_TOKEN_ENCRYPTION_KEY.')
    }
    const state = randomBytes(32).toString('base64url')
    await updateCsv('oauthStates', async (states) => ({
      records: [
        ...states.filter((item) => Date.parse(item.expiresAt) > Date.now()),
        {
          stateHash: hash(state),
          userId: '',
          purpose: 'login',
          role,
          returnTo: safeReturnTo(url.searchParams.get('returnTo')),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        },
      ],
      result: null,
    }))
    response.writeHead(302, { Location: zoomAuthorizationUrl(state), 'Cache-Control': 'no-store' })
    return response.end()
  }

  if (method === 'GET' && pathname === '/api/zoom/callback') {
    const state = url.searchParams.get('state') ?? ''
    const code = url.searchParams.get('code') ?? ''
    const stateHash = hash(state)
    let savedState
    await updateCsv('oauthStates', async (states) => {
      savedState = states.find((item) => item.stateHash === stateHash
        && Date.parse(item.expiresAt) > Date.now())
      return { records: states.filter((item) => item.stateHash !== stateHash), result: null }
    })
    if (!savedState) throw new HttpError(400, 'Nieprawidłowy lub wygasły powrót z Zoom OAuth.')
    if (url.searchParams.has('error')) {
      const destination = savedState.purpose === 'login' ? '/login?zoomError=cancelled' : '/profile?zoomError=cancelled'
      response.writeHead(302, { Location: destination, 'Cache-Control': 'no-store' })
      return response.end()
    }
    if (!code) throw new HttpError(400, 'Nieprawidłowy lub wygasły powrót z Zoom OAuth.')
    const users = await readCsv('users')

    if (savedState.purpose === 'login') {
      const identity = await exchangeZoomCode(code)
      const user = users.find((item) => item.role === savedState.role
        && item.email.toLowerCase() === identity.email)
      if (!user) {
        response.writeHead(302, { Location: '/login?zoomError=account-not-found', 'Cache-Control': 'no-store' })
        return response.end()
      }
      if (user.role === 'tutor') {
        await saveZoomConnection(user.id, identity.tokens)
        if (identity.imageUrl) {
          await updateCsv('tutors', async (tutors) => ({
            records: tutors.map((tutor) => tutor.tutorId === user.tutorId
              ? { ...tutor, imagePath: identity.imageUrl }
              : tutor),
            result: null,
          }))
        }
        await provisionPendingBookings(await tutorById(user.tutorId), user.id)
      }
      await createSession(user.id, response)
      response.writeHead(302, {
        Location: safeReturnTo(savedState.returnTo, user.role === 'tutor' ? '/profile' : '/'),
        'Cache-Control': 'no-store',
      })
      return response.end()
    }

    const user = users.find((item) => item.id === savedState.userId)
    if (!user || user.role !== 'tutor') throw new HttpError(403, 'Nie znaleziono konta korepetytora.')
    const identity = await exchangeZoomCode(code, user.id)
    if (identity.imageUrl) {
      await updateCsv('tutors', async (tutors) => ({
        records: tutors.map((tutor) => tutor.tutorId === user.tutorId
          ? { ...tutor, imagePath: identity.imageUrl }
          : tutor),
        result: null,
      }))
    }
    await provisionPendingBookings(await tutorById(user.tutorId), user.id)
    response.writeHead(302, { Location: '/profile?zoom=connected', 'Cache-Control': 'no-store' })
    return response.end()
  }

  throw new HttpError(404, 'Nie znaleziono endpointu API.')
}

async function tutorAccountId(tutorId) {
  const users = await readCsv('users')
  return users.find((user) => user.role === 'tutor' && user.tutorId === tutorId)?.id
}

const server = createServer(async (request, response) => {
  try {
    await serve(request, response)
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error)
      return
    }
    if (error instanceof HttpError) {
      send(response, error.status, { error: error.message })
      return
    }
    console.error('Błąd API Tutorland:', error)
    send(response, 500, { error: 'Wystąpił błąd serwera. Spróbuj ponownie później.' })
  }
})

await initializeStorage()
server.listen(port, '127.0.0.1', () => {
  console.log(`Tutorland API działa na http://127.0.0.1:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
