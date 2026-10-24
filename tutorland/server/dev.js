import './load-env.js'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(serverDirectory, '..')
const processes = [
  spawn(process.execPath, [resolve(serverDirectory, 'index.js')], {
    cwd: projectDirectory,
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(process.execPath, [
    resolve(projectDirectory, 'node_modules/vite/bin/vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    process.env.VITE_PORT ?? '5173',
  ], {
    cwd: projectDirectory,
    stdio: 'inherit',
    env: process.env,
  }),
]

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of processes) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
  process.exitCode = code
}

for (const child of processes) {
  child.on('error', (error) => {
    console.error('Nie udało się uruchomić procesu deweloperskiego:', error)
    stop(1)
  })
  child.on('exit', (code) => {
    if (!stopping) stop(code || 0)
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stop(0))
}
