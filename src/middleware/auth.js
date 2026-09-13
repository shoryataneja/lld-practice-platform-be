const prisma = require('../prisma')
const { COOKIE_NAME, verifySessionToken } = require('../services/auth')

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME]
    if (!token) return res.status(401).json({ error: 'Authentication required' })

    let payload
    try {
      payload = verifySessionToken(token)
    } catch {
      return res.status(401).json({ error: 'Session is invalid or has expired' })
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user) return res.status(401).json({ error: 'Session user no longer exists' })

    req.user = user
    next()
  } catch (err) {
    next(err)
  }
}

module.exports = { requireAuth }