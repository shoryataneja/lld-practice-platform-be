const { Router } = require('express')

const prisma = require('../prisma')
const { requireAuth } = require('../middleware/auth')
const {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createSessionToken,
  sessionCookieOptions,
  safeUser,
} = require('../services/auth')

const router = Router()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function setSessionCookie(res, user) {
  res.cookie(COOKIE_NAME, createSessionToken(user), sessionCookieOptions())
}

router.post('/signup', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body && req.body.email)
    const password = String((req.body && req.body.password) || '')
    const name = String((req.body && req.body.name) || '').trim() || null

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' })
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' })
    }

    const user = await prisma.user.create({
      data: { email, name, passwordHash: await hashPassword(password) },
    })
    setSessionCookie(res, user)
    res.status(201).json({ user: safeUser(user) })
  } catch (err) {
    next(err)
  }
})

router.post('/login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body && req.body.email)
    const password = String((req.body && req.body.password) || '')

    const user = await prisma.user.findUnique({ where: { email } })
    const valid = user ? await verifyPassword(password, user.passwordHash) : false
    if (!user || !valid) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    setSessionCookie(res, user)
    res.json({ user: safeUser(user) })
  } catch (err) {
    next(err)
  }
})

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, sessionCookieOptions())
  res.json({ ok: true })
})

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: safeUser(req.user) })
})

module.exports = router