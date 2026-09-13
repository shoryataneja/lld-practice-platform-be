const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')

const healthRouter = require('./routes/health')
const authRouter = require('./routes/auth')
const problemsRouter = require('./routes/problems')
const attemptsRouter = require('./routes/attempts')
const { requireAuth } = require('./middleware/auth')
const { corsOrigins } = require('./config')

const app = express()

const corsOptions = {
  credentials: true,
  origin: corsOrigins.length > 0 ? corsOrigins : true,
}

app.use(cors(corsOptions))
app.use(express.json())
app.use(cookieParser())

app.use('/api/health', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/problems', problemsRouter)
app.use('/api/attempts', requireAuth, attemptsRouter)

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

module.exports = app