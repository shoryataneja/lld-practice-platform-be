const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

module.exports = {
  port: Number(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL,
  demoLearnerEmail: (process.env.DEMO_LEARNER_EMAIL || 'demo@lld.dev').toLowerCase(),
}