process.env.DEMO_LEARNER_EMAIL = 'auth-learner@lld.dev'
process.env.EVALUATOR_TYPE = 'rule-based'
process.env.JWT_SECRET = 'test-secret'

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

const prisma = require('../src/prisma')
const app = require('../src/app')

const FIXTURE_EMAIL = 'fixture@lld.dev'
const FIXTURE_PASSWORD = 'password123'
const TEST_PROBLEM_SLUG = 'parking-lot'

let server
let base
let cookie = ''

function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  if (options.withCookie !== false && cookie) headers.Cookie = cookie
  return fetch(`${base}${path}`, { ...options, headers })
}

function parseSetCookie(res) {
  const raw = res.headers.get('set-cookie') || ''
  const match = raw.match(/^([^;=]+=[^;]+)/)
  return match ? match[1] : ''
}

async function json(res) {
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

async function signup(email, password, name) {
  const res = await request('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
    withCookie: false,
  })
  return res
}

async function login(email, password) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    withCookie: false,
  })
}

before(async () => {
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, resolve))
  base = `http://127.0.0.1:${server.address().port}`
  await prisma.problem.upsert({
    where: { slug: TEST_PROBLEM_SLUG },
    update: {},
    create: {
      slug: TEST_PROBLEM_SLUG,
      title: 'Parking Lot',
      summary: 'Auth test fixture problem',
      description: 'Auth test fixture problem.',
      difficulty: 'EASY',
      isPublished: true,
    },
  })
  const res = await signup(FIXTURE_EMAIL, FIXTURE_PASSWORD, 'Fixture User')
  assert.equal(res.status, 201)
  cookie = parseSetCookie(res)
})

after(async () => {
  const emails = [FIXTURE_EMAIL, 'fresh@lld.dev', 'dupe@lld.dev']
  await prisma.attempt.deleteMany({ where: { learner: { email: { in: emails } } } })
  await prisma.user.deleteMany({ where: { email: { in: emails } } })
  await new Promise((resolve) => server.close(resolve))
  await prisma.$disconnect()
})

describe('Signup', () => {
  it('creates a user and returns safe fields plus a session cookie', async () => {
    const res = await signup('fresh@lld.dev', 'password123', 'Fresh User')
    const { status, body } = await json(res)

    assert.equal(status, 201)
    assert.equal(body.user.email, 'fresh@lld.dev')
    assert.equal(body.user.name, 'Fresh User')
    assert.ok(body.user.id && body.user.createdAt)
    assert.equal(Object.hasOwn(body.user, 'passwordHash'), false, 'must never expose passwordHash')
    assert.ok(parseSetCookie(res), 'must set a session cookie')
    assert.ok(/HttpOnly/i.test(res.headers.get('set-cookie') || ''), 'cookie must be HttpOnly')
  })

  it('rejects duplicate email accounts (409)', async () => {
    const res = await signup(FIXTURE_EMAIL, 'password123')
    const { status, body } = await json(res)
    assert.equal(status, 409)
    assert.match(body.error, /already exists/i)
  })

  it('rejects invalid emails (400)', async () => {
    const res = await signup('not-an-email', 'password123')
    const { status } = await json(res)
    assert.equal(status, 400)
  })

  it('rejects short passwords (400)', async () => {
    const res = await signup('dupe@lld.dev', 'short')
    const { status } = await json(res)
    assert.equal(status, 400)
  })
})

describe('Login', () => {
  it('logs in with valid credentials and sets a cookie', async () => {
    const res = await login(FIXTURE_EMAIL, FIXTURE_PASSWORD)
    const { status, body } = await json(res)

    assert.equal(status, 200)
    assert.equal(body.user.email, FIXTURE_EMAIL)
    assert.equal(Object.hasOwn(body.user, 'passwordHash'), false)
    assert.ok(parseSetCookie(res))
  })

  it('rejects an invalid password (401)', async () => {
    const res = await login(FIXTURE_EMAIL, 'wrong-password')
    assert.equal(res.status, 401)
  })

  it('rejects an unknown email (401)', async () => {
    const res = await login('nobody@lld.dev', 'password123')
    assert.equal(res.status, 401)
  })
})

describe('Session', () => {
  it('returns the current user from /api/auth/me', async () => {
    const { status, body } = await json(await request('/api/auth/me'))
    assert.equal(status, 200)
    assert.equal(body.user.email, FIXTURE_EMAIL)
    assert.equal(Object.hasOwn(body.user, 'passwordHash'), false)
  })

  it('rejects /api/auth/me without a session (401)', async () => {
    const { status, body } = await json(await request('/api/auth/me', { withCookie: false }))
    assert.equal(status, 401)
    assert.match(body.error, /authentication required/i)
  })

  it('logs out by clearing the session cookie', async () => {
    const res = await request('/api/auth/logout', { method: 'POST' })
    const { status } = await json(res)

    assert.equal(status, 200)
    const setCookie = res.headers.get('set-cookie') || ''
    assert.match(setCookie, /lld_session=/)
    assert.match(setCookie, /Expires=/)

    cookie = ''
    const me = await json(await request('/api/auth/me'))
    assert.equal(me.status, 401, 'must require auth after logout')
  })
})

describe('Authenticated resource access', () => {
  it('rejects attempt creation without a session (401)', async () => {
    const res = await request(`/api/problems/${TEST_PROBLEM_SLUG}/attempts`, {
      method: 'POST',
      withCookie: false,
    })
    assert.equal(res.status, 401)
  })

  it('allows attempt creation with a valid session (201)', async () => {
    cookie = parseSetCookie(await login(FIXTURE_EMAIL, FIXTURE_PASSWORD))
    const { status, body } = await json(
      await request(`/api/problems/${TEST_PROBLEM_SLUG}/attempts`, { method: 'POST' })
    )
    assert.equal(status, 201)
    assert.equal(body.attempt.status, 'DRAFT')
  })
})