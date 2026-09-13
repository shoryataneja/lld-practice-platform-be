const prisma = require('../prisma')
const { demoLearnerEmail } = require('../config')

async function getOrCreateLearner() {
  return prisma.user.upsert({
    where: { email: demoLearnerEmail },
    update: {},
    create: { email: demoLearnerEmail, name: 'Demo Learner' },
  })
}

module.exports = { getOrCreateLearner }