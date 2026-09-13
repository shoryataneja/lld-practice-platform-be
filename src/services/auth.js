const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const { jwtSecret, sessionTtlMs, isProd } = require('../config')

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'lld_session'
const BCRYPT_ROUNDS = 10

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

async function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false
  return bcrypt.compare(password, passwordHash)
}

function createSessionToken(user) {
  return jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: sessionTtlMs / 1000 })
}

function verifySessionToken(token) {
  return jwt.verify(token, jwtSecret)
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    maxAge: sessionTtlMs,
  }
}

function safeUser(user) {
  if (!user) return user
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  }
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  sessionCookieOptions,
  safeUser,
}