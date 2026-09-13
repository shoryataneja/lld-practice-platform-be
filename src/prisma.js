const { PrismaClient } = require('@prisma/client')
const { PrismaNeon } = require('@prisma/adapter-neon')
const { neonConfig } = require('@neondatabase/serverless')
const ws = require('ws')
const { databaseUrl } = require('./config')

neonConfig.webSocketConstructor = ws

const adapter = new PrismaNeon({ connectionString: databaseUrl })
const prisma = new PrismaClient({ adapter })

module.exports = prisma