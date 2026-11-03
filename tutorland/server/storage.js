import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv, stringifyCsv } from './csv.js'

const serverDirectory = dirname(fileURLToPath(import.meta.url))
export const dataDirectory = resolve(process.env.TUTORLAND_DATA_DIR ?? join(serverDirectory, 'data'))
const seedDirectory = join(serverDirectory, 'seed')

export const csvHeaders = {
  tutors: ['tutorId', 'firstName', 'lastName', 'age', 'teachingSinceYear', 'description', 'rating', 'pricePerLesson', 'levels', 'subjects', 'imagePath', 'email'],
  availability: ['tutorId', 'weekday', 'startTime', 'endTime'],
  bookings: ['id', 'tutorId', 'studentId', 'studentEmail', 'date', 'startTime', 'endTime', 'durationMinutes', 'subject', 'level', 'zoomStatus', 'zoomJoinUrl', 'zoomStartUrl'],
  reviews: ['id', 'studentId', 'studentEmail', 'tutorId', 'bookingId', 'rating', 'date', 'comment', 'updatedAt'],
  users: ['id', 'role', 'firstName', 'lastName', 'email', 'passwordHash', 'tutorId', 'createdAt'],
  subjects: ['name'],
  sessions: ['tokenHash', 'userId', 'expiresAt'],
  daysOff: ['tutorId', 'date', 'startTime', 'endTime'],
  oauthStates: ['stateHash', 'userId', 'purpose', 'role', 'returnTo', 'expiresAt'],
}

const queues = new Map()

export async function initializeStorage() {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
  const seedFiles = {
    tutors: 'tutors.csv',
    availability: 'tutor_availability.csv',
    bookings: 'bookings.csv',
    subjects: 'subjects.csv',
  }

  for (const [name, seedFile] of Object.entries(seedFiles)) {
    const path = dataPath(name)
    try {
      await readFile(path)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await copyFile(join(seedDirectory, seedFile), path)
      await chmodPrivate(path)
    }
  }

  const reviewPath = dataPath('reviews')
  try {
    await readFile(reviewPath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await writeCsv('reviews', [])
  }

  for (const name of ['users', 'sessions', 'daysOff', 'oauthStates']) {
    const path = dataPath(name)
    try {
      await readFile(path)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await writeFile(path, stringifyCsv(csvHeaders[name], []), { mode: 0o600 })
    }
  }

  try {
    await readFile(join(dataDirectory, 'zoom-connections.enc'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await writeFile(join(dataDirectory, 'zoom-connections.enc'), '{}\n', { mode: 0o600 })
  }
}

function dataPath(name) {
  const key = name.replace(/\.csv$/, '')
  if (!(key in csvHeaders)) throw new Error(`Nieznany plik CSV: ${name}`)
  return join(dataDirectory, `${key}.csv`)
}

async function readCsvFile(path) {
  return parseCsv(await readFile(path, 'utf8'))
}

async function chmodPrivate(path) {
  const { chmod } = await import('node:fs/promises')
  await chmod(path, 0o600)
}

export async function readCsv(name) {
  return readCsvFile(dataPath(name))
}

export async function writeCsv(name, records) {
  const path = dataPath(name)
  const headers = csvHeaders[name.replace(/\.csv$/, '')]
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, stringifyCsv(headers, records), { mode: 0o600 })
  await rename(temporaryPath, path)
}

export function updateCsv(name, updater) {
  const prior = queues.get(name) ?? Promise.resolve()
  const next = prior.then(async () => {
    const records = await readCsv(name)
    const { records: updatedRecords, result } = await updater(records)
    await writeCsv(name, updatedRecords)
    return result
  })
  queues.set(name, next.catch(() => {}))
  return next
}

export async function readPrivateJson(fileName) {
  const path = join(dataDirectory, fileName)
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function writePrivateJson(fileName, value) {
  const path = join(dataDirectory, fileName)
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporaryPath, path)
}
