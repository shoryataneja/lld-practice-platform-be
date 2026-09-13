const { Router } = require('express')

const prisma = require('../prisma')
const { getOrCreateLearner } = require('../services/learner')

const router = Router()

router.get('/', async (req, res, next) => {
  try {
    const problems = await prisma.problem.findMany({
      where: { isPublished: true },
      orderBy: { slug: 'asc' },
      select: { id: true, slug: true, title: true, summary: true, difficulty: true },
    })
    res.json({ problems })
  } catch (err) {
    next(err)
  }
})

router.get('/:slug', async (req, res, next) => {
  try {
    const problem = await prisma.problem.findUnique({
      where: { slug: req.params.slug },
      include: { _count: { select: { attempts: true } } },
    })
    if (!problem || !problem.isPublished) {
      return res.status(404).json({ error: 'Problem not found' })
    }
    res.json({ problem })
  } catch (err) {
    next(err)
  }
})

router.post('/:slug/attempts', async (req, res, next) => {
  try {
    const problem = await prisma.problem.findUnique({ where: { slug: req.params.slug } })
    if (!problem || !problem.isPublished) {
      return res.status(404).json({ error: 'Problem not found' })
    }
    const learner = await getOrCreateLearner()
    const attemptCount = await prisma.attempt.count({
      where: { learnerId: learner.id, problemId: problem.id },
    })
    const attempt = await prisma.attempt.create({
      data: {
        learnerId: learner.id,
        problemId: problem.id,
        attemptNumber: attemptCount + 1,
        status: 'DRAFT',
      },
      include: { problem: { select: { slug: true, title: true } } },
    })
    res.status(201).json({ attempt })
  } catch (err) {
    next(err)
  }
})

module.exports = router