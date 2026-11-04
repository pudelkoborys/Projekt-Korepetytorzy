import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseCsv, stringifyCsv } from './csv.js'
import { csvHeaders } from './storage.js'
import { availableSlotsForDate } from '../src/calendar.js'

const projectDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))

test('calendar keeps the last open lesson selectable after eight bookings that day', () => {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + 3)
  const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const weekday = new Date(`${dateString}T12:00:00Z`).getUTCDay()
  const busy = Array.from({ length: 8 }, (_, index) => {
    const startMinutes = 9 * 60 + index * 40
    const endMinutes = startMinutes + 40
    const format = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    return { date: dateString, startTime: format(startMinutes), endTime: format(endMinutes) }
  })
  const data = {
    availability: [{ weekday: String(weekday), startTime: '09:00', endTime: '15:00' }],
    daysOff: [],
    busy,
  }
  assert.deepEqual(availableSlotsForDate(dateString, data, new Date()), ['14:20'])
  assert.deepEqual(availableSlotsForDate(dateString, {
    ...data,
    availability: [{ weekday, startTime: '09:00', endTime: '15:00' }],
  }, new Date()), ['14:20'])
  assert.deepEqual(availableSlotsForDate(dateString, { ...data, daysOff: [{ date: dateString }] }, new Date()), [])
  assert.deepEqual(availableSlotsForDate(dateString, {
    ...data,
    daysOff: [{ date: '2099-12-31' }],
  }, new Date()), ['14:20'])
  assert.deepEqual(availableSlotsForDate(dateString, {
    ...data,
    busy: [],
    daysOff: [{ date: dateString, startTime: '16:00', endTime: '17:20' }],
  }, new Date()), ['16:00', '16:40'])
})

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

test('API supports password auth and persists a private booking flow', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'tutorland-api-'))
  const studentToken = 'student-test-session'
  const tutorToken = 'tutor-test-session'
  const outsiderToken = 'outsider-test-session'
  const sessionExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const studentCookie = `tutorland_session=${studentToken}`
  const tutorCookie = `tutorland_session=${tutorToken}`
  const outsiderCookie = `tutorland_session=${outsiderToken}`
  const studentId = 'student-test-id'
  const tutorAccountId = 'tutor-account-test-id'
  const outsiderId = 'outsider-test-id'
  const tutorId = 'test-tutor'
  const seed = {
    users: [
      { id: studentId, role: 'student', firstName: 'Testowa', lastName: 'Uczennica', email: 'student-test@example.com', passwordHash: '', tutorId: '', createdAt: new Date().toISOString() },
      { id: tutorAccountId, role: 'tutor', firstName: 'Testowy', lastName: 'Korepetytor', email: 'tutor-test@example.com', passwordHash: '', tutorId, createdAt: new Date().toISOString() },
      { id: outsiderId, role: 'student', firstName: 'Obca', lastName: 'Osoba', email: 'outsider-test@example.com', passwordHash: '', tutorId: '', createdAt: new Date().toISOString() },
    ],
    sessions: [
      { tokenHash: createHash('sha256').update(studentToken).digest('hex'), userId: studentId, expiresAt: sessionExpiresAt },
      { tokenHash: createHash('sha256').update(tutorToken).digest('hex'), userId: tutorAccountId, expiresAt: sessionExpiresAt },
      { tokenHash: createHash('sha256').update(outsiderToken).digest('hex'), userId: outsiderId, expiresAt: sessionExpiresAt },
    ],
    tutors: [{
      tutorId, firstName: 'Testowy', lastName: 'Korepetytor', age: '', teachingSinceYear: new Date().getFullYear() - 3,
      description: 'Pomagam uczniom z matematyką i przygotowuję ich do sprawdzianów.', pricePerLesson: 100,
      levels: 'primary', subjects: 'Matematyka', imagePath: '', email: 'tutor-test@example.com',
    }],
    availability: [],
    bookings: [],
    daysOff: [],
  }
  await Promise.all(Object.entries(seed).map(([name, records]) => (
    writeFile(join(dataDirectory, `${name}.csv`), stringifyCsv(csvHeaders[name], records))
  )))
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, [resolve(projectDirectory, 'server/index.js')], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      API_PORT: String(port),
      TUTORLAND_DATA_DIR: dataDirectory,
    },
    stdio: 'ignore',
  })

  try {
    await waitForApi(baseUrl, child)
    const unauthenticated = await request(baseUrl, '/api/auth/me')
    assert.equal(unauthenticated.payload.user, null)
    const authProviders = await request(baseUrl, '/api/auth/providers')
    assert.deepEqual(authProviders.payload, { password: true, google: false })
    const legacySignup = await request(baseUrl, '/api/auth/register', { method: 'POST', body: {} })
    assert.equal(legacySignup.response.status, 400)
    const mismatchedPasswordRegistration = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        role: 'student',
        firstName: 'Nowa',
        lastName: 'Użytkowniczka',
        email: 'mismatch@example.com',
        password: 'secure-password-123',
        passwordConfirmation: 'different-password',
      },
    })
    assert.equal(mismatchedPasswordRegistration.response.status, 400)
    const legacyLogin = await request(baseUrl, '/api/auth/login', { method: 'POST', body: {} })
    assert.equal(legacyLogin.response.status, 401)

    const registration = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        role: 'student',
        firstName: 'Nowa',
        lastName: 'Użytkowniczka',
        email: 'new-student@example.com',
        password: 'secure-password-123',
        passwordConfirmation: 'secure-password-123',
      },
    })
    assert.equal(registration.response.status, 201)
    assert.equal(registration.payload.user.role, 'student')
    const registrationCookie = registration.response.headers.get('set-cookie').split(';')[0]
    assert.equal((await request(baseUrl, '/api/auth/me', { cookie: registrationCookie })).payload.user.role, 'student')
    const registeredUsers = parseCsv(await readFile(join(dataDirectory, 'users.csv'), 'utf8'))
    const registeredUser = registeredUsers.find((item) => item.email === 'new-student@example.com')
    assert.match(registeredUser.passwordHash, /^pbkdf2-sha256\$/)
    assert.notEqual(registeredUser.passwordHash, 'secure-password-123')
    const duplicateRegistration = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        role: 'student',
        firstName: 'Nowa',
        lastName: 'Użytkowniczka',
        email: 'NEW-STUDENT@example.com',
        password: 'secure-password-123',
        passwordConfirmation: 'secure-password-123',
      },
    })
    assert.equal(duplicateRegistration.response.status, 409)
    const wrongPassword = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: 'new-student@example.com', password: 'wrong-password' },
    })
    assert.equal(wrongPassword.response.status, 401)
    const passwordLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: 'NEW-STUDENT@example.com', password: 'secure-password-123' },
    })
    assert.equal(passwordLogin.response.status, 200)
    const loginCookie = passwordLogin.response.headers.get('set-cookie').split(';')[0]
    assert.equal((await request(baseUrl, '/api/auth/me', { cookie: loginCookie })).payload.user.id, registration.payload.user.id)

    const tutorRegistration = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        role: 'tutor',
        firstName: 'Nowy',
        lastName: 'Korepetytor',
        email: 'new-tutor@example.com',
        password: 'secure-password-123',
        passwordConfirmation: 'secure-password-123',
      },
    })
    assert.equal(tutorRegistration.response.status, 201)
    assert.equal(tutorRegistration.payload.user.role, 'tutor')
    const tutorDashboard = await request(baseUrl, '/api/tutor/profile', {
      cookie: tutorRegistration.response.headers.get('set-cookie').split(';')[0],
    })
    assert.equal(tutorDashboard.response.status, 200)
    assert.equal('rating' in tutorDashboard.payload.tutor, false)
    assert.equal('reviewCount' in tutorDashboard.payload.tutor, false)
    assert.equal((await request(baseUrl, '/api/auth/delete-account', {
      method: 'POST',
      cookie: registrationCookie,
    })).response.status, 200)
    assert.equal((await request(baseUrl, '/api/auth/delete-account', {
      method: 'POST',
      cookie: tutorRegistration.response.headers.get('set-cookie').split(';')[0],
    })).response.status, 200)

    const catalog = await request(baseUrl, '/api/tutors')
    assert.equal(catalog.payload.tutors.length, 1)
    assert.equal('rating' in catalog.payload.tutors[0], false)
    assert.equal('reviewCount' in catalog.payload.tutors[0], false)
    const publicProfile = await request(baseUrl, `/api/tutors/${tutorId}`)
    assert.equal(publicProfile.response.status, 200)
    assert.equal('reviews' in publicProfile.payload, false)
    assert.deepEqual(parseCsv(await readFile(join(dataDirectory, 'availability.csv'), 'utf8')), [])
    assert.deepEqual(parseCsv(await readFile(join(dataDirectory, 'bookings.csv'), 'utf8')), [])

    const studentProfile = await request(baseUrl, '/api/student/profile', { cookie: studentCookie })
    assert.equal(studentProfile.payload.profile.firstName, 'Testowa')
    const profileImage = 'data:image/webp;base64,dGVzdA=='
    const studentPhoto = await request(baseUrl, '/api/profile/photo', {
      method: 'PUT',
      cookie: studentCookie,
      body: { profileImage },
    })
    assert.equal(studentPhoto.response.status, 200)
    assert.equal((await request(baseUrl, '/api/auth/me', { cookie: studentCookie })).payload.user.profileImage, profileImage)
    assert.equal((await request(baseUrl, '/api/student/profile', { cookie: studentCookie })).payload.profile.profileImage, profileImage)
    const invalidPhoto = await request(baseUrl, '/api/profile/photo', {
      method: 'PUT',
      cookie: studentCookie,
      body: { profileImage: 'data:image/png;base64,dGVzdA==' },
    })
    assert.equal(invalidPhoto.response.status, 400)
    const studentProfileUpdate = await request(baseUrl, '/api/student/profile', {
      method: 'PUT',
      cookie: studentCookie,
      body: { firstName: 'Anna', lastName: 'Testowa' },
    })
    assert.equal(studentProfileUpdate.response.status, 200)
    assert.equal((await request(baseUrl, '/api/auth/me', { cookie: studentCookie })).payload.user.firstName, 'Anna')
    const deniedStudentProfile = await request(baseUrl, '/api/student/profile', { cookie: tutorCookie })
    assert.equal(deniedStudentProfile.response.status, 403)

    const tutorProfile = await request(baseUrl, '/api/tutor/profile', { cookie: tutorCookie })
    assert.equal(tutorProfile.response.status, 200)
    assert.equal(tutorProfile.payload.tutor.firstName, 'Testowy')
    const tutorPhoto = await request(baseUrl, '/api/profile/photo', {
      method: 'PUT',
      cookie: tutorCookie,
      body: { profileImage },
    })
    assert.equal(tutorPhoto.response.status, 200)
    assert.equal((await request(baseUrl, '/api/tutor/profile', { cookie: tutorCookie })).payload.tutor.imagePath, profileImage)
    const publicSubjects = await request(baseUrl, '/api/subjects')
    assert.ok(publicSubjects.payload.subjects.includes('Matematyka'))
    assert.ok(publicSubjects.payload.subjects.includes('Język Polski Dla Obcokrajowców'))
    const createdSubject = await request(baseUrl, '/api/subjects', {
      method: 'POST',
      cookie: tutorCookie,
      body: { name: 'algebra liniowa' },
    })
    assert.equal(createdSubject.response.status, 201)
    assert.equal(createdSubject.payload.subject, 'Algebra Liniowa')
    const sharedSubjects = await request(baseUrl, '/api/subjects')
    assert.ok(sharedSubjects.payload.subjects.includes('Algebra Liniowa'))
    const profileUpdate = await request(baseUrl, '/api/tutor/profile', {
      method: 'PUT',
      cookie: tutorCookie,
      body: {
        firstName: 'Testowy',
        lastName: 'Korepetytor',
        description: 'Pomagam uczniom z matematyką i przygotowuję ich do sprawdzianów.',
        pricePerLesson: 120,
        teachingSinceYear: new Date().getFullYear() - 3,
        subjects: ['Matematyka', 'Fizyka', createdSubject.payload.subject],
        levels: ['primary', 'secondary'],
      },
    })
    assert.equal(profileUpdate.response.status, 200)
    const updatedProfile = await request(baseUrl, '/api/tutor/profile', { cookie: tutorCookie })
    assert.equal(updatedProfile.payload.tutor.pricePerLesson, 120)
    assert.deepEqual(updatedProfile.payload.tutor.subjects, ['Matematyka', 'Fizyka', 'Algebra Liniowa'])

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
    const available = await request(baseUrl, `/api/tutors/${tutorId}/availability?month=${date.slice(0, 7)}`)
    assert.deepEqual(available.payload.availability.map((range) => range.weekday), [String(weekday)])
    const fullDayOffSchedule = await request(baseUrl, '/api/tutor/availability', {
      method: 'PUT',
      cookie: tutorCookie,
      body: {
        weekly: [{ weekday, startTime: '09:00', endTime: '10:20' }],
        daysOff: [{ date }],
      },
    })
    assert.equal(fullDayOffSchedule.response.status, 200)
    const fullDayOff = await request(baseUrl, `/api/tutors/${tutorId}/availability?month=${date.slice(0, 7)}`)
    assert.deepEqual(fullDayOff.payload.daysOff, [{ date, startTime: '', endTime: '' }])
    const fullDayUnavailable = await request(baseUrl, '/api/bookings', {
      method: 'POST',
      cookie: studentCookie,
      body: {
        tutorId: tutorProfile.payload.tutor.tutorId,
        date,
        startTime: '09:00',
        subject: 'Matematyka',
        level: 'primary',
      },
    })
    assert.equal(fullDayUnavailable.response.status, 409)
    const specialHoursSchedule = await request(baseUrl, '/api/tutor/availability', {
      method: 'PUT',
      cookie: tutorCookie,
      body: {
        weekly: [{ weekday, startTime: '09:00', endTime: '10:20' }],
        daysOff: [{ date, startTime: '11:00', endTime: '12:20' }],
      },
    })
    assert.equal(specialHoursSchedule.response.status, 200)
    const specialHours = await request(baseUrl, `/api/tutors/${tutorId}/availability?month=${date.slice(0, 7)}`)
    assert.deepEqual(specialHours.payload.daysOff, [{ date, startTime: '11:00', endTime: '12:20' }])

    const bookingsBefore = await request(baseUrl, '/api/bookings', { cookie: studentCookie })
    assert.equal(bookingsBefore.response.status, 200)
    const deniedTutorDashboard = await request(baseUrl, '/api/tutor/profile', { cookie: studentCookie })
    assert.equal(deniedTutorDashboard.response.status, 403)
    const unsupportedLevel = await request(baseUrl, '/api/bookings', {
      method: 'POST',
      cookie: studentCookie,
      body: {
        tutorId: tutorProfile.payload.tutor.tutorId,
        date,
        startTime: '09:00',
        subject: 'Matematyka',
        level: 'tertiary',
      },
    })
    assert.equal(unsupportedLevel.response.status, 400)
    const regularDate = new Date(scheduleDate)
    regularDate.setDate(regularDate.getDate() + 7)
    const greenDayBooking = await request(baseUrl, '/api/bookings', {
      method: 'POST',
      cookie: studentCookie,
      body: {
        tutorId: tutorProfile.payload.tutor.tutorId,
        date: regularDate.toISOString().slice(0, 10),
        startTime: '09:00',
        subject: 'Matematyka',
        level: 'primary',
      },
    })
    assert.equal(greenDayBooking.response.status, 201)
    const outsideSpecialHours = await request(baseUrl, '/api/bookings', {
      method: 'POST',
      cookie: studentCookie,
      body: {
        tutorId: tutorProfile.payload.tutor.tutorId,
        date,
        startTime: '09:00',
        subject: 'Matematyka',
        level: 'primary',
      },
    })
    assert.equal(outsideSpecialHours.response.status, 409)
    const createdBooking = await request(baseUrl, '/api/bookings', {
      method: 'POST',
      cookie: studentCookie,
      body: {
        tutorId: tutorProfile.payload.tutor.tutorId,
        date,
        startTime: '11:00',
        subject: 'Matematyka',
        level: 'primary',
      },
    })
    assert.equal(createdBooking.response.status, 201)
    assert.equal(createdBooking.payload.booking.durationMinutes, '40')
    assert.equal(createdBooking.payload.booking.level, 'primary')
    assert.ok(createdBooking.payload.booking.chatId)
    assert.equal('studentEmail' in createdBooking.payload.booking, false)
    const studentBookings = await request(baseUrl, '/api/bookings', { cookie: studentCookie })
    assert.equal(studentBookings.payload.bookings[0].level, 'primary')
    const tutorNotifications = await request(baseUrl, '/api/tutor/notifications', { cookie: tutorCookie })
    assert.equal(tutorNotifications.payload.bookings[0].level, 'primary')
    assert.equal(tutorNotifications.payload.bookings[0].studentImage, profileImage)
    assert.equal('reviews' in tutorNotifications.payload, false)
    const tutorBookings = await request(baseUrl, '/api/bookings', { cookie: tutorCookie })
    assert.equal(tutorBookings.payload.bookings[0].studentImage, profileImage)
    assert.equal(greenDayBooking.payload.booking.chatId, createdBooking.payload.booking.chatId)
    const studentChats = await request(baseUrl, '/api/messages', { cookie: studentCookie })
    const tutorChats = await request(baseUrl, '/api/messages', { cookie: tutorCookie })
    assert.equal(studentChats.payload.chats.length, 1)
    assert.equal(tutorChats.payload.chats.length, 1)
    assert.equal(studentChats.payload.chats[0].id, createdBooking.payload.booking.chatId)
    assert.equal(tutorChats.payload.chats[0].studentName, 'Anna Testowa')
    assert.equal(tutorChats.payload.chats[0].studentImage, profileImage)
    assert.equal((await request(baseUrl, `/api/messages?chatId=${createdBooking.payload.booking.chatId}`)).response.status, 401)
    assert.equal((await request(baseUrl, '/api/messages', { cookie: outsiderCookie })).payload.chats.length, 0)
    assert.equal((await request(baseUrl, `/api/messages?chatId=${createdBooking.payload.booking.chatId}`, { cookie: outsiderCookie })).response.status, 404)
    const studentMessage = await request(baseUrl, '/api/messages', {
      method: 'POST',
      cookie: studentCookie,
      body: { chatId: createdBooking.payload.booking.chatId, content: 'Dzień dobry, mam pytanie do lekcji.' },
    })
    assert.equal(studentMessage.response.status, 201)
    const tutorMessage = await request(baseUrl, '/api/messages', {
      method: 'POST',
      cookie: tutorCookie,
      body: { chatId: createdBooking.payload.booking.chatId, content: 'Dzień dobry, proszę pytać.' },
    })
    assert.equal(tutorMessage.response.status, 201)
    const chatHistory = await request(baseUrl, `/api/messages?chatId=${createdBooking.payload.booking.chatId}`, { cookie: studentCookie })
    const bookingNotices = chatHistory.payload.messages.filter((message) => message.messageType === 'booking_notice')
    assert.equal(bookingNotices.length, 2)
    assert.ok(bookingNotices.every((message) => message.content.includes('sposób przeprowadzenia zajęć oraz sposób i termin płatności')))
    assert.deepEqual(chatHistory.payload.messages.filter((message) => message.messageType === 'user').map((message) => message.content), [
      'Dzień dobry, mam pytanie do lekcji.',
      'Dzień dobry, proszę pytać.',
    ])
    assert.equal(chatHistory.payload.messages.at(-1).senderName, 'Testowy Korepetytor')
    assert.equal(parseCsv(await readFile(join(dataDirectory, 'chats.csv'), 'utf8')).length, 1)
    assert.equal(parseCsv(await readFile(join(dataDirectory, 'chatMessages.csv'), 'utf8')).length, 4)
    const expiredDate = new Date()
    expiredDate.setUTCMonth(expiredDate.getUTCMonth() - 2)
    const messagesPath = join(dataDirectory, 'chatMessages.csv')
    const existingMessages = parseCsv(await readFile(messagesPath, 'utf8'))
    await writeFile(messagesPath, stringifyCsv(csvHeaders.chatMessages, [
      ...existingMessages,
      {
        id: 'expired-message',
        chatId: createdBooking.payload.booking.chatId,
        senderId: studentId,
        messageType: 'user',
        content: 'Ta wiadomość powinna wygasnąć.',
        createdAt: expiredDate.toISOString(),
      },
    ]))
    const retainedHistory = await request(baseUrl, `/api/messages?chatId=${createdBooking.payload.booking.chatId}`, { cookie: studentCookie })
    assert.equal(retainedHistory.payload.messages.some((message) => message.id === 'expired-message'), false)
    assert.equal(parseCsv(await readFile(messagesPath, 'utf8')).length, 4)
    const invalidMessage = await request(baseUrl, '/api/messages', {
      method: 'POST',
      cookie: studentCookie,
      body: { chatId: createdBooking.payload.booking.chatId, content: '   ' },
    })
    assert.equal(invalidMessage.response.status, 400)

    const duplicateBooking = await request(baseUrl, '/api/bookings', {
      method: 'POST',
      cookie: studentCookie,
      body: {
        tutorId: tutorProfile.payload.tutor.tutorId,
        date,
        startTime: '11:00',
        subject: 'Matematyka',
        level: 'primary',
      },
    })
    assert.equal(duplicateBooking.response.status, 409)

    const removedReviewEndpoint = await request(baseUrl, '/api/reviews', {
      method: 'POST',
      cookie: studentCookie,
      body: {},
    })
    assert.equal(removedReviewEndpoint.response.status, 404)

    const unauthenticatedDelete = await request(baseUrl, '/api/auth/delete-account', { method: 'POST' })
    assert.equal(unauthenticatedDelete.response.status, 401)
    const deletedStudent = await request(baseUrl, '/api/auth/delete-account', { method: 'POST', cookie: studentCookie })
    assert.equal(deletedStudent.response.status, 200)
    assert.equal((await request(baseUrl, '/api/auth/me', { cookie: studentCookie })).payload.user, null)
    assert.equal((await request(baseUrl, '/api/bookings', { cookie: studentCookie })).response.status, 401)
    assert.deepEqual(parseCsv(await readFile(join(dataDirectory, 'bookings.csv'), 'utf8')), [])

    const deletedTutor = await request(baseUrl, '/api/auth/delete-account', { method: 'POST', cookie: tutorCookie })
    assert.equal(deletedTutor.response.status, 200)
    assert.equal((await request(baseUrl, '/api/auth/me', { cookie: tutorCookie })).payload.user, null)
    const deletedOutsider = await request(baseUrl, '/api/auth/delete-account', { method: 'POST', cookie: outsiderCookie })
    assert.equal(deletedOutsider.response.status, 200)
    assert.deepEqual(parseCsv(await readFile(join(dataDirectory, 'users.csv'), 'utf8')), [])
    assert.deepEqual(parseCsv(await readFile(join(dataDirectory, 'tutors.csv'), 'utf8')), [])
    assert.deepEqual(parseCsv(await readFile(join(dataDirectory, 'availability.csv'), 'utf8')), [])
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await once(child, 'exit')
    }
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
