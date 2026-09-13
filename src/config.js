const path = require('path')
const crypto = require('crypto')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const isProd = process.env.NODE_ENV === 'production'

function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  if (isProd) throw new Error('JWT_SECRET is required in production')
  console.warn('JWT_SECRET is not set; using an ephemeral dev secret (sessions reset on restart).')
  return crypto.randomBytes(32).toString('hex')
}

module.exports = {
  port: Number(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL,
  demoLearnerEmail: (process.env.DEMO_LEARNER_EMAIL || 'demo@lld.dev').toLowerCase(),
  demoPassword: process.env.DEMO_PASSWORD || 'demo1234',
  groqApiKey: process.env.GROQ_API_KEY || null,
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  groqTimeoutMs: Number(process.env.GROQ_TIMEOUT_MS) || 60000,
  evaluatorType: (process.env.EVALUATOR_TYPE || 'auto').toLowerCase(),
  isProd,
  sessionTtlMs: (Number(process.env.SESSION_TTL_DAYS) || 7) * 24 * 60 * 60 * 1000,
  corsOrigins: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  jwtSecret: resolveJwtSecret(),
}