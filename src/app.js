const express = require('express')
const cors = require('cors')

const healthRouter = require('./routes/health')
const meRouter = require('./routes/me')
const problemsRouter = require('./routes/problems')
const attemptsRouter = require('./routes/attempts')

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/health', healthRouter)
app.use('/api/me', meRouter)
app.use('/api/problems', problemsRouter)
app.use('/api/attempts', attemptsRouter)

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

module.exports = app