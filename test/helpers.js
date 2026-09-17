// Boots a real server in a child process on an ephemeral port with a
// throwaway DATA_DIR, exactly as `npm start` runs it. Each test file gets its
// own process, so the per-IP login rate limit (20 per 15 min) starts fresh and
// one file's state can never leak into another's. Every optional integration
// is left unconfigured, so nothing here ever reaches the network.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const SECRET = 'test-secret'
export const USERS = ['Alex', 'Sam']
export const BABY = 'Robin'
export const TZ = 'America/Chicago'

export function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bt-test-'))
}

export function baseEnv(dataDir) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DATA_DIR: dataDir,
    APP_SECRET: SECRET,
    USER_NAMES: USERS.join(','),
    BABY_NAME: BABY,
    BIRTH_DATE: '2026-05-02',
    BABY_SEX: 'girl',
    HOME_TZ: TZ,
    NUDGE_HOURS: '0',
    PHOTO_NUDGE_DAYS: '0',
    MONTHLY_PHOTO_NUDGE: '0',
  }
}

export async function startServer(extraEnv = {}) {
  const dataDir = tempDataDir()
  const env = { ...baseEnv(dataDir), PORT: '0', ...extraEnv }
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d))
  const port = await new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', (d) => {
      out += d
      const m = out.match(/listening on :(\d+)/)
      if (m) resolve(Number(m[1]))
    })
    child.on('exit', (code) => reject(new Error(`server exited with ${code}\n${stderr}`)))
    setTimeout(() => reject(new Error(`server did not start\n${stderr}`)), 15000).unref()
  })
  const base = `http://127.0.0.1:${port}`

  async function api(method, url, { body, cookie, headers = {} } = {}) {
    const init = { method, headers: { ...headers } }
    if (cookie) init.headers.cookie = cookie
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    const res = await fetch(base + url, init)
    const buf = Buffer.from(await res.arrayBuffer())
    const text = buf.toString('utf8')
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}
    return { status: res.status, json, text, buf, headers: res.headers }
  }

  async function login(user = USERS[0]) {
    const r = await api('POST', '/api/login', { body: { secret: SECRET, user } })
    if (r.status !== 200) throw new Error(`login failed: ${r.status} ${r.text}`)
    return r.headers.get('set-cookie').split(';')[0]
  }

  function stop() {
    child.kill('SIGTERM')
    fs.rmSync(dataDir, { recursive: true, force: true })
  }

  return { base, api, login, stop, dataDir, stderr: () => stderr }
}
