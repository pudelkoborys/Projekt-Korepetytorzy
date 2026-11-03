import './load-env.js'
import {
  createHash,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { createServer } from 'node:http'
import { initializeStorage, readCsv, updateCsv } from './storage.js'
import { removeZoomConnection } from './zoom.js'
import { DEFAULT_SUBJECTS, formatSubjectName, subjectKey } from '../src/subjects.js'

const port = Number(process.env.API_PORT ?? 3001)
const cookieName = 'tutorland_session'
const sessionDuration = 14 * 24 * 60 * 60 * 1000
const passwordIterations = 310_000
const dummyPasswordHash = 'pbkdf2-sha256$310000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const lessonDuration = 40
const levels = new Set(['primary', 'secondary', 'tertiary'])
class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function makePasswordHash(password) {
  const salt = randomBytes(16)
  const derivedKey = pbkdf2Sync(password, salt, passwordIterations, 32, 'sha256')
  return `pbkdf2-sha256$${passwordIterations}$${salt.toString('base64')}$${derivedKey.toString('base64')}`
}

function verifyPassword(password, storedHash = '') {
  const parts = storedHash.split('$')
  const iterations = Number(parts[1])
  const salt = parts[0] === 'pbkdf2-sha256' && iterations === passwordIterations
    ? Buffer.from(parts[2] ?? '', 'base64')
    : Buffer.alloc(0)
  const expected = parts[0] === 'pbkdf2-sha256' && iterations === passwordIterations
    ? Buffer.from(parts[3] ?? '', 'base64')
    : Buffer.alloc(0)
  const validHash = salt.length === 16 && expected.length === 32
  const selectedSalt = validHash ? salt : Buffer.alloc(16)
  const selectedExpected = validHash ? expected : Buffer.alloc(32)
  const derivedKey = pbkdf2Sync(password, selectedSalt, passwordIterations, 32, 'sha256')
  return validHash && timingSafeEqual(selectedExpected, derivedKey)
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
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

function cleanSubjectName(value) {
  const name = formatSubjectName(value)
  if (name.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,'’+/#()&-]*$/u.test(name)) {
    throw new HttpError(400, 'Nazwa tagu może zawierać litery, cyfry i podstawowe znaki interpunkcyjne.')
  }
  return name
}

async function cleanSubjects(value) {
  if (!Array.isArray(value) || !value.length || value.length > 20
    || value.some((subject) => typeof subject !== 'string')) {
    throw new HttpError(400, 'Wybierz od 1 do 20 przedmiotów.')
  }
  const catalog = await readCsv('subjects')
  const subjectByKey = new Map(catalog.map(({ name }) => [subjectKey(name), formatSubjectName(name)]))
  const subjects = [...new Set(value.map(cleanSubjectName))]
  if (subjects.some((subject) => !subjectByKey.has(subjectKey(subject)))) {
    throw new HttpError(400, 'Utwórz nowy tag przed dodaniem go do profilu.')
  }
  return subjects.map((subject) => subjectByKey.get(subjectKey(subject)))
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

  const dayOffByDate = new Map()
  const today = plDateTime().date
  for (const item of daysOff) {
    const dayOff = typeof item === 'string' ? { date: item } : item
    if (!dayOff || typeof dayOff !== 'object' || !isValidDate(dayOff.date) || dayOff.date < today) {
      throw new HttpError(400, 'Dni wolne muszą być prawidłowymi datami bieżącymi lub przyszłymi.')
    }
    const startTime = dayOff.startTime ?? ''
    const endTime = dayOff.endTime ?? ''
    if ((startTime || endTime)
      && (!Number.isFinite(timeToMinutes(startTime))
        || !Number.isFinite(timeToMinutes(endTime))
        || timeToMinutes(endTime) - timeToMinutes(startTime) < lessonDuration)) {
      throw new HttpError(400, 'Dostępność w dniu wolnym musi obejmować co najmniej jedną lekcję 40-minutową.')
    }
    dayOffByDate.set(dayOff.date, { date: dayOff.date, startTime, endTime })
  }
  return { weekly: normalized, daysOff: [...dayOffByDate.values()] }
}

function validateBookingSlot(tutor, date, startTime, subject, level, availability, daysOff, bookings) {
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
  if (!levels.has(level) || !String(tutor.levels).split('|').includes(level)) {
    throw new HttpError(400, 'Wybierz poziom nauczania z oferty korepetytora.')
  }
  const dayOff = daysOff.find((day) => day.tutorId === tutor.tutorId && day.date === date)
  if (dayOff && (!dayOff.startTime || !dayOff.endTime)) {
    throw new HttpError(409, 'Korepetytor oznaczył ten dzień jako wolny.')
  }
  const weekday = String(getWeekday(date))
  const ranges = dayOff
    ? [dayOff]
    : availability.filter((range) => range.tutorId === tutor.tutorId && range.weekday === weekday)
  const allowed = ranges.some((range) => {
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

async function serve(request, response) {
  const url = new URL(request.url, 'http://localhost')
  const { pathname } = url
  if (!pathname.startsWith('/api/')) throw new HttpError(404, 'Nie znaleziono strony API.')
  const method = request.method ?? 'GET'

  if (method === 'GET' && pathname === '/api/auth/me') {
    return send(response, 200, { user: publicUser(await currentUser(request)) })
  }

  if (method === 'GET' && pathname === '/api/auth/providers') {
    return send(response, 200, { password: true, google: false })
  }

  if (method === 'GET' && pathname === '/api/subjects') {
    const subjects = await readCsv('subjects')
    return send(response, 200, {
      subjects: [...new Set([...DEFAULT_SUBJECTS, ...subjects.map(({ name }) => formatSubjectName(name))])]
        .sort((a, b) => a.localeCompare(b, 'pl')),
    })
  }

  if (method === 'POST' && pathname === '/api/subjects') {
    const user = await requireUser(request)
    requireRole(user, 'tutor')
    const body = await readBody(request)
    const name = cleanSubjectName(body.name)
    let subject
    await updateCsv('subjects', async (subjects) => {
      subject = subjects.find((item) => subjectKey(item.name) === subjectKey(name))?.name ?? name
      return {
        records: subjects.some((item) => subjectKey(item.name) === subjectKey(name))
          ? subjects
          : [...subjects, { name }],
        result: null,
      }
    })
    return send(response, 201, { subject: formatSubjectName(subject) })
  }

  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = await readBody(request)
    const role = body.role
    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : ''
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = body.password
    if (!['student', 'tutor'].includes(role)
      || !isValidName(firstName) || !isValidName(lastName) || !isValidEmail(email)
      || typeof password !== 'string' || password.length < 8 || password.length > 256) {
      throw new HttpError(400, 'Sprawdź imię, nazwisko, adres e-mail, rolę i hasło (co najmniej 8 znaków).')
    }

    const tutorId = role === 'tutor'
      ? `${firstName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomBytes(5).toString('hex')}`
      : ''
    const user = {
      id: randomUUID(),
      role,
      firstName,
      lastName,
      email,
      passwordHash: makePasswordHash(password),
      tutorId,
      createdAt: new Date().toISOString(),
    }
    await updateCsv('users', async (users) => {
      if (users.some((item) => item.email.toLowerCase() === email)) {
        throw new HttpError(409, 'Konto z tym adresem e-mail już istnieje.')
      }
      return { records: [...users, user], result: null }
    })
    if (role === 'tutor') {
      await updateCsv('tutors', async (tutors) => ({
        records: [...tutors, {
          tutorId,
          firstName,
          lastName,
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
    return send(response, 201, { user: publicUser(user) })
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(request)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const user = isValidEmail(email)
      ? (await readCsv('users')).find((item) => item.email.toLowerCase() === email)
      : null
    const passwordMatches = verifyPassword(
      password.length <= 256 ? password : '',
      user?.passwordHash ?? dummyPasswordHash,
    )
    if (!passwordMatches || !user || password.length > 256) {
      throw new HttpError(401, 'Nieprawidłowy adres e-mail lub hasło.')
    }
    await createSession(user.id, response)
    return send(response, 200, { user: publicUser(user) })
  }

  if (method === 'GET' && pathname === '/api/student/profile') {
    const user = await requireUser(request)
    requireRole(user, 'student')
    return send(response, 200, { profile: publicUser(user) })
  }

  if (method === 'PUT' && pathname === '/api/student/profile') {
    const user = await requireUser(request)
    requireRole(user, 'student')
    const body = await readBody(request)
    if (!isValidName(body.firstName) || !isValidName(body.lastName)) {
      throw new HttpError(400, 'Podaj prawidłowe imię i nazwisko.')
    }
    const firstName = body.firstName.trim()
    const lastName = body.lastName.trim()
    await updateCsv('users', async (users) => ({
      records: users.map((item) => item.id === user.id ? { ...item, firstName, lastName } : item),
      result: null,
    }))
    return send(response, 200, { success: true })
  }

  if (method === 'POST' && pathname === '/api/auth/delete-account') {
    const user = await requireUser(request)
    if (user.role === 'tutor') {
      await removeZoomConnection(user.id)
      await updateCsv('tutors', async (tutors) => ({
        records: tutors.filter((tutor) => tutor.tutorId !== user.tutorId),
        result: null,
      }))
      await updateCsv('availability', async (ranges) => ({
        records: ranges.filter((range) => range.tutorId !== user.tutorId),
        result: null,
      }))
      await updateCsv('daysOff', async (daysOff) => ({
        records: daysOff.filter((day) => day.tutorId !== user.tutorId),
        result: null,
      }))
      await updateCsv('bookings', async (bookings) => ({
        records: bookings.filter((booking) => booking.tutorId !== user.tutorId && booking.studentId !== user.id),
        result: null,
      }))
      await updateCsv('reviews', async (reviews) => ({
        records: reviews.filter((review) => review.tutorId !== user.tutorId && review.studentId !== user.id),
        result: null,
      }))
    } else {
      await updateCsv('bookings', async (bookings) => ({
        records: bookings.filter((booking) => booking.studentId !== user.id),
        result: null,
      }))
      await updateCsv('reviews', async (reviews) => ({
        records: reviews.filter((review) => review.studentId !== user.id),
        result: null,
      }))
    }
    await updateCsv('oauthStates', async (states) => ({
      records: states.filter((state) => state.userId !== user.id),
      result: null,
    }))
    await updateCsv('sessions', async (sessions) => ({
      records: sessions.filter((session) => session.userId !== user.id),
      result: null,
    }))
    await updateCsv('users', async (users) => ({
      records: users.filter((item) => item.id !== user.id),
      result: null,
    }))
    clearSessionCookie(response)
    return send(response, 200, { success: true })
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
      daysOff: daysOff
        .filter((day) => day.tutorId === tutorId && (!datePrefix || day.date.startsWith(datePrefix)))
        .map(({ date, startTime, endTime }) => ({ date, startTime: startTime ?? '', endTime: endTime ?? '' })),
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
    const level = String(body.level ?? '')
    let booking

    await updateCsv('bookings', async (bookings) => {
      validateBookingSlot(tutor, date, startTime, subject, level, availability, daysOff, bookings)
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
        level,
        zoomStatus: 'pending',
        zoomJoinUrl: '',
        zoomStartUrl: '',
      }
      return { records: [...bookings, booking], result: null }
    })

    return send(response, 201, {
      booking: {
        id: booking.id,
        tutorId: booking.tutorId,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        durationMinutes: booking.durationMinutes,
        subject: booking.subject,
        level: booking.level,
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
    const subjects = await cleanSubjects(body.subjects)
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
      daysOff: daysOff.filter((day) => day.tutorId === tutor.tutorId)
        .map(({ date, startTime, endTime }) => ({ date, startTime: startTime ?? '', endTime: endTime ?? '' })),
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
        ...daysOff.map((day) => ({ ...day, tutorId: tutor.tutorId })),
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

  if (pathname.startsWith('/api/zoom/')) {
    throw new HttpError(410, 'Integracja Zoom została wyłączona.')
  }

  throw new HttpError(404, 'Nie znaleziono endpointu API.')
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
