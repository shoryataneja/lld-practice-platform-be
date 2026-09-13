const { Router } = require('express')

const { getOrCreateLearner } = require('../services/learner')

const router = Router()

router.get('/', async (req, res, next) => {
  try {
    const learner = await getOrCreateLearner()
    res.json({ learner })
  } catch (err) {
    next(err)
  }
})

module.exports = router