const { Router } = require('express')

const prisma = require('../prisma')
const { getOrCreateLearner } = require('../services/learner')
const { getEvaluator, resolveEvaluatorType } = require('../services/evaluator')
const config = require('../config')

const router = Router()

function derivedScore(evaluation) {
  if (!evaluation || !evaluation.results || evaluation.results.length === 0) return null
  const total = evaluation.results.reduce((sum, result) => sum + result.score, 0)
  const max = evaluation.results.reduce((sum, result) => sum + result.maxScore, 0)
  return max === 0 ? null : Math.round((total / max) * 100)
}

function toSummary(attempt) {
  const { evaluation, ...rest } = attempt
  return {
    ...rest,
    score: derivedScore(evaluation),
  }
}

function toDetail(attempt) {
  const { evaluation, ...rest } = attempt
  return {
    ...rest,
    evaluation,
    score: derivedScore(evaluation),
  }
}

router.get('/', async (req, res, next) => {
  try {
    const learner = await getOrCreateLearner()
    const attempts = await prisma.attempt.findMany({
      where: { learnerId: learner.id },
      orderBy: { createdAt: 'desc' },
      include: {
        problem: { select: { slug: true, title: true } },
        evaluation: { include: { results: true } },
      },
    })
    res.json({ attempts: attempts.map(toSummary) })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const learner = await getOrCreateLearner()
    const attempt = await prisma.attempt.findFirst({
      where: { id: req.params.id, learnerId: learner.id },
      include: {
        problem: true,
        submission: { include: { sections: { orderBy: { createdAt: 'asc' } } } },
        evaluation: { include: { results: { orderBy: { criterion: 'asc' } } } },
      },
    })
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' })
    res.json({ attempt: toDetail(attempt) })
  } catch (err) {
    next(err)
  }
})

router.put('/:id/sections', async (req, res, next) => {
  try {
    const { sections } = req.body || {}
    if (!Array.isArray(sections)) {
      return res.status(400).json({ error: 'Body must include a sections array of { key, content }' })
    }
    const learner = await getOrCreateLearner()
    const attempt = await prisma.attempt.findFirst({
      where: { id: req.params.id, learnerId: learner.id },
    })
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' })
    if (attempt.status !== 'DRAFT') {
      return res.status(409).json({ error: 'Only draft attempts can be edited' })
    }

    const clean = sections
      .filter((section) => section && typeof section.key === 'string' && section.key)
      .map((section) => ({ key: section.key, content: String(section.content || '') }))

    const saved = await prisma.$transaction(async (tx) => {
      const submission = await tx.submission.upsert({
        where: { attemptId: attempt.id },
        update: {},
        create: { attemptId: attempt.id, format: 'STRUCTURED_TEXT' },
      })
      const existing = await tx.submissionSection.findMany({
        where: { submissionId: submission.id },
        select: { key: true },
      })
      const incomingKeys = new Set(clean.map((section) => section.key))
      await tx.submissionSection.deleteMany({
        where: {
          submissionId: submission.id,
          key: { notIn: clean.map((section) => section.key) },
        },
      })
      for (const section of clean) {
        await tx.submissionSection.upsert({
          where: { submissionId_key: { submissionId: submission.id, key: section.key } },
          update: { content: section.content },
          create: { submissionId: submission.id, key: section.key, content: section.content },
        })
      }
      return tx.submissionSection.findMany({
        where: { submissionId: submission.id },
        orderBy: { createdAt: 'asc' },
      })
    })

    res.json({ sections: saved })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/submit', async (req, res, next) => {
  try {
    const learner = await getOrCreateLearner()
    const attempt = await prisma.attempt.findFirst({
      where: { id: req.params.id, learnerId: learner.id },
      include: { submission: { include: { sections: true } } },
    })
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' })
    if (attempt.status !== 'DRAFT') {
      return res.status(409).json({ error: 'Attempt is not in draft state' })
    }

    await prisma.attempt.update({
      where: { id: attempt.id },
      data: { status: 'SUBMITTED' },
    })

    const evaluatorType = resolveEvaluatorType({
      evaluatorType: config.evaluatorType,
      groqApiKey: config.groqApiKey,
    })

    const evaluation = await prisma.evaluation.create({
      data: {
        attemptId: attempt.id,
        status: 'RUNNING',
        evaluatorType,
        provider: evaluatorType === 'AI' ? 'groq' : null,
        modelName: evaluatorType === 'AI' ? config.groqModel : null,
      },
    })

    try {
      const problem = await prisma.problem.findUnique({ where: { id: attempt.problemId } })
      let usedType = evaluatorType
      let outcome
      try {
        outcome = await getEvaluator(evaluatorType).evaluate({ submission: attempt.submission, problem })
      } catch (err) {
        if (evaluatorType !== 'AI') throw err
        console.warn(`AI evaluator failed (${err.message}); falling back to rule-based evaluator.`)
        usedType = 'RULE_BASED'
        outcome = await getEvaluator('RULE_BASED').evaluate({ submission: attempt.submission, problem })
      }
      await prisma.evaluation.update({
        where: { id: evaluation.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          evaluatorType: usedType,
          provider: usedType === 'AI' ? 'groq' : null,
          modelName: usedType === 'AI' ? config.groqModel : null,
          summary: outcome.summary,
          results: {
            create: outcome.results.map((result) => ({
              criterion: result.criterion,
              score: result.score,
              maxScore: result.maxScore,
              evidence: result.evidence,
              concern: result.concern,
              suggestion: result.suggestion,
              confidence: result.confidence,
            })),
          },
        },
      })
      await prisma.attempt.update({
        where: { id: attempt.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })
    } catch (err) {
      await prisma.evaluation.update({
        where: { id: evaluation.id },
        data: { status: 'FAILED', errorMessage: err.message },
      })
      await prisma.attempt.update({
        where: { id: attempt.id },
        data: { status: 'FAILED', completedAt: new Date() },
      })
      return next(err)
    }

    const detail = await prisma.attempt.findUnique({
      where: { id: attempt.id },
      include: {
        problem: true,
        submission: { include: { sections: { orderBy: { createdAt: 'asc' } } } },
        evaluation: { include: { results: { orderBy: { criterion: 'asc' } } } },
      },
    })
    res.json({ attempt: toDetail(detail) })
  } catch (err) {
    next(err)
  }
})

module.exports = router