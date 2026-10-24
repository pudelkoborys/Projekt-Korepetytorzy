import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseCsv } from './csv.js'

const projectDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))

async function freePort() {
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const { port } = listener.address()
  await new Promise((resolveClose, reject) => listener.close((error) => error ? reject(error) : resolveClose()))
  return port
}

async function waitForApi(baseUrl, child) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited early with code ${child.exitCode}`)
    try {
      const response = await fetch(`${baseUrl}/api/auth/me`)
      if (response.ok) return
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 40))
    }
  }
  throw new Error('API did not become ready')
}

async function request(baseUrl, path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { response, payload: await response.json() }
}

test('API creates role-based accounts and persists a private booking flow', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'tutorland-api-'))
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, [resolve(projectDirectory, 'server/index.js')], {
    cwd: projectDirectory,
    env: { ...process.env, API_PORT: String(port), TUTORLAND_DATA_DIR: dataDirectory },
    stdio: 'ignore',
  })

  try {
    await waitForApi(baseUrl, child)
    const unauthenticated = await request(baseUrl, '/api/auth/me')
    assert.equal(unauthenticated.payload.user, null)
    const authProviders = await request(baseUrl, '/api/auth/providers')
    assert.equal(authProviders.payload.zoom, false)
    const zoomLoginUnavailable = await request(baseUrl, '/api/zoom/login?role=student')
    assert.equal(zoomLoginUnavailable.response.status, 503)
    const zoomLoginInvalidRole = await request(baseUrl, '/api/zoom/login?role=admin')
    assert.equal(zoomLoginInvalidRole.response.status, 400)

    const catalog = await request(baseUrl, '/api/tutors')
    assert.deepEqual(catalog.payload.tutors, [])
    const publicProfile = await request(baseUrl, '/api/tutors/jan-kowalski')
    assert.equal(publicProfile.response.status, 404)
    assert.deepEqual(parseCsv(await readFile(join(dataDirectory, 'tutors.csv'), 'utf8')), [])
    assert.deepEqual(parseCsv(await readFile(join(dataDirectory, 'availability.csv'), 'utf8')), [])
    assert.deepEqual(parseCsv(await readFile(join(dataDirectory, 'users.csv'), 'utf8')), [])
    assert.deepEqual(parseCsv(await readFile(join(dataDirectory, 'bookings.csv'), 'utf8')), [])
    assert.deepEqual(parseCsv(await readFile(join(dataDirectory, 'reviews.csv'), 'utf8')), [])

    const studentSignup = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        role: 'student',
        firstName: 'Testowa',
        lastName: 'Uczennica',
        email: 'student-test@example.com',
        password: 'bardzo-bezpieczne-haslo',
      },
    })
    assert.equal(studentSignup.response.status, 201)
    assert.equal('passwordHash' in studentSignup.payload.user, false)
    const studentCookie = studentSignup.response.headers.get('set-cookie').split(';')[0]
    assert.match(studentSignup.response.headers.get('set-cookie'), /HttpOnly/)

    const duplicate = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        role: 'student',
        firstName: 'Inna',
        lastName: 'Osoba',
        email: 'student-test@example.com',
        password: 'bardzo-bezpieczne-haslo',
      },
    })
    assert.equal(duplicate.response.status, 409)

    const tutorSignup = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        role: 'tutor',
        firstName: 'Testowy',
        lastName: 'Korepetytor',
        email: 'tutor-test@example.com',
        password: 'bardzo-bezpieczne-haslo',
      },
    })
    assert.equal(tutorSignup.response.status, 201)
    assert.equal(tutorSignup.payload.zoomConfigured, false)
    const tutorCookie = tutorSignup.response.headers.get('set-cookie').split(';')[0]
    const zoomStatus = await request(baseUrl, '/api/zoom/status', { cookie: tutorCookie })
    assert.equal(zoomStatus.response.status, 200)
    assert.equal(zoomStatus.payload.configured, false)
    assert.equal(zoomStatus.payload.connected, false)
    const zoomConnect = await request(baseUrl, '/api/zoom/connect', { cookie: tutorCookie })
    assert.equal(zoomConnect.response.status, 503)
    assert.match(zoomConnect.payload.error, /ZOOM_CLIENT_ID.*ZOOM_CLIENT_SECRET.*ZOOM_TOKEN_ENCRYPTION_KEY/)
    const tutorLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { role: 'tutor', email: 'tutor-test@example.com', password: 'bardzo-bezpieczne-haslo' },
    })
    assert.equal(tutorLogin.response.status, 200)
    assert.equal(tutorLogin.payload.zoomConfigured, false)
    assert.equal(tutorLogin.payload.zoomConnected, false)
    const tutorProfile = await request(baseUrl, '/api/tutor/profile', { cookie: tutorCookie })
    assert.equal(tutorProfile.response.status, 200)
    assert.equal(tutorProfile.payload.tutor.firstName, 'Testowy')
    const profileUpdate = await request(baseUrl, '/api/tutor/profile', {
      method: 'PUT',
      cookie: tutorCookie,
      body: {
        firstName: 'Testowy',
        lastName: 'Korepetytor',
        description: 'Pomagam uczniom z matematyką i przygotowuję ich do sprawdzianów.',
        pricePerLesson: 120,
        teachingSinceYear: new Date().getFullYear() - 3,
        subjects: ['Matematyka', 'Fizyka'],
        levels: ['primary', 'secondary'],
      },
    })
    assert.equal(profileUpdate.response.status, 200)
    const updatedProfile = await request(baseUrl, '/api/tutor/profile', { cookie: tutorCookie })
    assert.equal(updatedProfile.payload.tutor.pricePerLesson, 120)
    assert.deepEqual(updatedProfile.payload.tutor.subjects, ['Matematyka', 'Fizyka'])

    const wrongRoleLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { role: 'tutor', email: 'student-test@example.com', password: 'bardzo-bezpieczne-haslo' },
    })
    assert.equal(wrongRoleLogin.response.status, 401)
    const correctRoleLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { role: 'student', email: 'student-test@example.com', password: 'bardzo-bezpieczne-haslo' },
    })
    assert.equal(correctRoleLogin.response.status, 200)
    const studentLoginCookie = correctRoleLogin.response.headers.get('set-cookie').split(';')[0]

    const scheduleDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    const date = scheduleDate.toISOString().slice(0, 10)
    const weekday = scheduleDate.getUTCDay()
    const schedule = await request(baseUrl, '/api/tutor/availability', {
      method: 'PUT',
      cookie: tutorCookie,
      body: {
        weekly: [{ weekday, startTime: '09:00', endTime: '10:20' }],
        daysOff: [],
      },
    })
    assert.equal(schedule.response.status, 200)

    const bookingsBefore = await request(baseUrl, '/api/bookings', { cookie: studentCookie })
    assert.equal(bookingsBefore.response.status, 200)
    const deniedTutorDashboard = await request(baseUrl, '/api/tutor/profile', { cookie: studentCookie })
    assert.equal(deniedTutorDashboard.response.status, 403)
    const createdBooking = await request(baseUrl, '/api/bookings', {
      method: 'POST',
      cookie: studentCookie,
      body: {
        tutorId: tutorProfile.payload.tutor.tutorId,
        date,
        startTime: '09:00',
        subject: 'Matematyka',
      },
    })
    assert.equal(createdBooking.response.status, 201)
    assert.equal(createdBooking.payload.booking.durationMinutes, '40')
    assert.equal(createdBooking.payload.booking.zoomStatus, 'pending')
    assert.equal('studentEmail' in createdBooking.payload.booking, false)
    assert.equal('zoomStartUrl' in createdBooking.payload.booking, false)

    const duplicateBooking = await request(baseUrl, '/api/bookings', {
      method: 'POST',
      cookie: studentCookie,
      body: {
        tutorId: tutorProfile.payload.tutor.tutorId,
        date,
        startTime: '09:00',
        subject: 'Matematyka',
      },
    })
    assert.equal(duplicateBooking.response.status, 409)

    const deniedReview = await request(baseUrl, '/api/reviews', {
      method: 'POST',
      cookie: studentCookie,
      body: {
        bookingId: createdBooking.payload.booking.id,
        rating: 5,
        comment: 'Bardzo dobra lekcja.',
      },
    })
    assert.equal(deniedReview.response.status, 403)

    const loggedOut = await request(baseUrl, '/api/auth/logout', { method: 'POST', cookie: studentLoginCookie })
    assert.equal(loggedOut.response.status, 200)
    const afterLogout = await request(baseUrl, '/api/auth/me', { cookie: studentLoginCookie })
    assert.equal(afterLogout.payload.user, null)
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await once(child, 'exit')
    }
    await rm(dataDirectory, { recursive: true, force: true })
  }
})

test('Zoom login uses role-bound, single-use OAuth state and rejects unsafe return paths', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'tutorland-zoom-login-'))
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, [resolve(projectDirectory, 'server/index.js')], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      API_PORT: String(port),
      APP_ORIGIN: baseUrl,
      TUTORLAND_DATA_DIR: dataDirectory,
      ZOOM_CLIENT_ID: 'test-client-id',
      ZOOM_CLIENT_SECRET: 'test-client-secret',
      ZOOM_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
    },
    stdio: 'ignore',
  })

  try {
    await waitForApi(baseUrl, child)
    const login = await fetch(`${baseUrl}/api/zoom/login?role=student&returnTo=https%3A%2F%2Fevil.example`, {
      redirect: 'manual',
    })
    assert.equal(login.status, 302)
    const authorizationUrl = new URL(login.headers.get('location'))
    assert.equal(authorizationUrl.origin, 'https://zoom.us')
    assert.equal(authorizationUrl.searchParams.get('client_id'), 'test-client-id')
    assert.equal(authorizationUrl.searchParams.get('redirect_uri'), `${baseUrl}/api/zoom/callback`)

    const state = authorizationUrl.searchParams.get('state')
    const savedStates = parseCsv(await readFile(join(dataDirectory, 'oauthStates.csv'), 'utf8'))
    assert.equal(savedStates.length, 1)
    assert.notEqual(savedStates[0].stateHash, state)
    assert.equal(savedStates[0].purpose, 'login')
    assert.equal(savedStates[0].role, 'student')
    assert.equal(savedStates[0].returnTo, '/')

    const cancelled = await fetch(
      `${baseUrl}/api/zoom/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    )
    assert.equal(cancelled.status, 302)
    assert.equal(cancelled.headers.get('location'), '/login?zoomError=cancelled')
    const replay = await fetch(
      `${baseUrl}/api/zoom/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    )
    assert.equal(replay.status, 400)
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await once(child, 'exit')
    }
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
