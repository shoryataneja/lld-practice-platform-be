const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

module.exports = {
  port: Number(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL,
  demoLearnerEmail: (process.env.DEMO_LEARNER_EMAIL || 'demo@lld.dev').toLowerCase(),
  groqApiKey: process.env.GROQ_API_KEY || null,
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  groqTimeoutMs: Number(process.env.GROQ_TIMEOUT_MS) || 60000,
  evaluatorType: (process.env.EVALUATOR_TYPE || 'auto').toLowerCase(),
}