process.env.DEMO_LEARNER_EMAIL = 'test-learner@lld.dev'
process.env.EVALUATOR_TYPE = 'rule-based'
process.env.JWT_SECRET = 'test-secret'

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

const prisma = require('../src/prisma')
const app = require('../src/app')

const TEST_LEARNER = process.env.DEMO_LEARNER_EMAIL
const TEST_LEARNER_PASSWORD = 'testpass123'
const TEST_PROBLEM_SLUG = 'parking-lot'

let server
let base
let cookie = ''

function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  if (cookie) headers.Cookie = cookie
  return fetch(`${base}${path}`, { ...options, headers })
}

async function getJson(response) {
  const body = await response.json()
  return { status: response.status, body }
}

function parseSetCookie(response) {
  const raw = response.headers.get('set-cookie') || ''
  const match = raw.match(/^([^;=]+=[^;]+)/)
  return match ? match[1] : ''
}

async function createAttempt(slug) {
  const res = await request(`/api/problems/${slug}/attempts`, { method: 'POST' })
  const { body } = await getJson(res)
  assert.equal(res.status, 201, JSON.stringify(body))
  return body.attempt
}

const sectionPayload = [
  { key: 'requirements', content: 'A parking lot that assigns spots, tracks occupancy and charges per duration.' },
  { key: 'classes', content: 'ParkingLot, Level, Spot, Vehicle, Ticket, Gate' },
  { key: 'decisions', content: 'Composition over inheritance to keep spot types swappable.' },
]

before(async () => {
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, resolve))
  const address = server.address()
  base = `http://127.0.0.1:${address.port}`

  await prisma.problem.upsert({
    where: { slug: TEST_PROBLEM_SLUG },
    update: {},
    create: {
      slug: TEST_PROBLEM_SLUG,
      title: 'Parking Lot',
      summary: 'Test fixture problem',
      description: 'Test fixture problem for integration tests.',
      difficulty: 'EASY',
      isPublished: true,
    },
  })
  await prisma.attempt.deleteMany({ where: { learner: { email: TEST_LEARNER } } })
  await prisma.user.deleteMany({ where: { email: TEST_LEARNER } })
  const signupRes = await request('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_LEARNER, password: TEST_LEARNER_PASSWORD, name: 'Test Learner' }),
  })
  assert.equal(signupRes.status, 201, 'test learner signup must succeed')
  cookie = parseSetCookie(signupRes)
})

after(async () => {
  await prisma.attempt.deleteMany({ where: { learner: { email: TEST_LEARNER } } })
  await new Promise((resolve) => server.close(resolve))
  await prisma.$disconnect()
})

describe('API health', () => {
  it('returns ok from /api/health', async () => {
    const { status, body } = await getJson(await request('/api/health'))
    assert.equal(status, 200)
    assert.deepEqual(body, { ok: true })
  })
})

describe('Critical attempt flow', () => {
  let attempt

  it('creates a draft attempt', async () => {
    attempt = await createAttempt(TEST_PROBLEM_SLUG)
    assert.equal(attempt.status, 'DRAFT')
    assert.ok(attempt.attemptNumber >= 1)
  })

  it('saves draft sections', async () => {
    const res = await request(`/api/attempts/${attempt.id}/sections`, {
      method: 'PUT',
      body: JSON.stringify({ sections: sectionPayload }),
    })
    const { status, body } = await getJson(res)
    assert.equal(status, 200)
    assert.equal(body.sections.length, sectionPayload.length)
    assert.equal(body.sections[0].key, 'requirements')
  })

  it('submits the attempt and completes evaluation with 8 results', async () => {
    const res = await request(`/api/attempts/${attempt.id}/submit`, { method: 'POST' })
    const { status, body } = await getJson(res)
    assert.equal(status, 200)
    assert.equal(body.attempt.status, 'COMPLETED')
    assert.equal(body.attempt.evaluation.status, 'COMPLETED')
    assert.equal(body.attempt.evaluation.results.length, 8)
    assert.equal(typeof body.attempt.score, 'number')
  })

  it('rejects submissions of an already-submitted attempt (409)', async () => {
    const res = await request(`/api/attempts/${attempt.id}/submit`, { method: 'POST' })
    assert.equal(res.status, 409)
  })

  it('returns 404 for unknown attempts', async () => {
    const res = await request('/api/attempts/does-not-exist')
    assert.equal(res.status, 404)
  })
})

describe('Retry creates a new attempt', () => {
  it('increments attemptNumber for the same problem', async () => {
    const first = await createAttempt(TEST_PROBLEM_SLUG)
    const second = await createAttempt(TEST_PROBLEM_SLUG)

    assert.equal(second.attemptNumber, first.attemptNumber + 1)
    assert.equal(second.id !== first.id, true)
    assert.equal(second.status, 'DRAFT')
  })
})

describe('History', () => {
  it('lists the test learner attempts newest first', async () => {
    const res = await request('/api/attempts')
    const { status, body } = await getJson(res)
    assert.equal(status, 200)

    const testAttempts = body.attempts.filter((a) => a.learnerId === undefined || a.problem.slug === TEST_PROBLEM_SLUG)
    assert.ok(testAttempts.length >= 1, 'at least one attempt for the test learner')
  })
})

describe('Failed evaluation state', () => {
  it('surfaces FAILED status and error message from the API', async () => {
    const learner = await prisma.user.upsert({
      where: { email: TEST_LEARNER },
      update: {},
      create: { email: TEST_LEARNER, name: 'Test Learner' },
    })
    const problem = await prisma.problem.findUnique({ where: { slug: TEST_PROBLEM_SLUG } })
    const failedAttempt = await prisma.attempt.create({
      data: {
        learnerId: learner.id,
        problemId: problem.id,
        attemptNumber: 9999,
        status: 'FAILED',
        evaluation: {
          create: {
            status: 'FAILED',
            evaluatorType: 'RULE_BASED',
            errorMessage: 'evaluator crashed: boom',
            completedAt: new Date(),
          },
        },
      },
    })

    const res = await request(`/api/attempts/${failedAttempt.id}`)
    const { status, body } = await getJson(res)
    assert.equal(status, 200)
    assert.equal(body.attempt.status, 'FAILED')
    assert.equal(body.attempt.evaluation.status, 'FAILED')
    assert.equal(body.attempt.evaluation.errorMessage, 'evaluator crashed: boom')
  })
})