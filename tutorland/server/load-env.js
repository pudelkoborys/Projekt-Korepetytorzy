import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const envPath = resolve(projectDirectory, '.env')

if (existsSync(envPath)) process.loadEnvFile(envPath)
