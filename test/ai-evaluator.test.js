process.env.GROQ_API_KEY = 'test-key'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  getEvaluator,
  resolveEvaluatorType,
  AiEvaluator,
  RuleBasedEvaluator,
  CRITERIA,
} = require('../src/services/evaluator')

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const collection = new Set(CRITERIA.map((c) => c.criterion))

function validResultEntries(overrides = {}) {
  return CRITERIA.map(({ criterion }) => ({
    criterion,
    score: 7,
    evidence: `Solid evidence for ${criterion}.`,
    concern: null,
    suggestion: `Improve ${criterion}.`,
    confidence: 0.8,
    ...(overrides[criterion] || {}),
  }))
}

function groqPayload(results, summary = 'Solid design overall.') {
  return {
    choices: [{ message: { role: 'assistant', content: JSON.stringify({ results, summary }) } }],
  }
}

function createEvaluator(fetchImpl) {
  return new AiEvaluator({ apiKey: 'test-key', model: 'test-model', timeoutMs: 1000, fetchImpl })
}

function recordingFetch(payload) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { impl, calls }
}

const submission = {
  sections: [
    { key: 'requirements', content: 'A parking lot that assigns spots and charges per duration.' },
    { key: 'decisions', content: 'Composition over inheritance for spot types.' },
  ],
}

const problem = { title: 'Parking Lot', description: 'Design a parking lot system.' }

function assertResultSchema(result) {
  assert.ok(collection.has(result.criterion), `unknown criterion ${result.criterion}`)
  assert.ok(Number.isInteger(result.score), 'score must be integer')
  assert.ok(result.score >= 0 && result.score <= 10, `score out of range: ${result.score}`)
  assert.equal(result.maxScore, 10)
  assert.equal(typeof result.evidence, 'string')
  assert.ok(result.evidence.length > 0, 'evidence must be non-empty')
  assert.ok(result.concern === null || typeof result.concern === 'string')
  assert.equal(typeof result.suggestion, 'string')
  assert.ok(result.suggestion.length > 0, 'suggestion must be non-empty')
  assert.ok(result.confidence >= 0 && result.confidence <= 1, `confidence out of range: ${result.confidence}`)
}

describe('AiEvaluator', () => {
  it('evaluates a valid Groq response into 8 schema-valid results', async () => {
    const payload = groqPayload(validResultEntries())
    const evaluator = createEvaluator(async () => new Response(JSON.stringify(payload), { status: 200 }))

    const outcome = await evaluator.evaluate({ submission, problem })

    assert.equal(outcome.results.length, 8)
    assert.equal(outcome.summary, 'Solid design overall.')
    for (const result of outcome.results) assertResultSchema(result)
  })

  it('sends the Groq request with correct URL, auth, model and JSON response format', async () => {
    const payload = groqPayload(validResultEntries())
    const { impl, calls } = recordingFetch(payload)
    const evaluator = createEvaluator(impl)

    await evaluator.evaluate({ submission, problem })

    assert.equal(calls.length, 1)
    const { url, init, body } = calls[0]
    assert.equal(url, GROQ_URL)
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.Authorization, 'Bearer test-key')
    assert.equal(body.model, 'test-model')
    assert.equal(body.temperature, 0.2)
    assert.deepEqual(body.response_format, { type: 'json_object' })

    const systemPrompt = body.messages[0].content
    for (const { criterion, label } of CRITERIA) {
      assert.ok(systemPrompt.includes(criterion), `system prompt missing criterion ${criterion}`)
      assert.ok(systemPrompt.includes(label), `system prompt missing label ${label}`)
    }
    assert.ok(body.messages[1].content.includes('Parking Lot'), 'user message should include problem title')
    assert.ok(body.messages[1].content.includes('requirements'), 'user message should include submissions')
  })

  it('parses markdown-fenced JSON content', async () => {
    const results = validResultEntries()
    const content = `\`\`\`json\n${JSON.stringify({ results, summary: 'Fenced summary.' })}\n\`\`\``
    const evaluator = createEvaluator(
      async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
    )

    const outcome = await evaluator.evaluate({ submission, problem })

    assert.equal(outcome.results.length, 8)
    assert.equal(outcome.summary, 'Fenced summary.')
  })

  it('clamps out-of-range scores and confidence', async () => {
    const entries = validResultEntries({
      REQUIREMENT_UNDERSTANDING: { score: 999, confidence: 1.9 },
      CLASS_RESPONSIBILITIES: { score: -5, confidence: -0.5 },
      COUPLING_AND_COHESION: { score: 7.5 },
    })
    const evaluator = createEvaluator(async () => new Response(JSON.stringify(groqPayload(entries)), { status: 200 }))

    const outcome = await evaluator.evaluate({ submission, problem })

    const byCriterion = new Map(outcome.results.map((r) => [r.criterion, r]))
    assert.equal(byCriterion.get('REQUIREMENT_UNDERSTANDING').score, 10)
    assert.equal(byCriterion.get('REQUIREMENT_UNDERSTANDING').confidence, 1)
    assert.equal(byCriterion.get('CLASS_RESPONSIBILITIES').score, 0)
    assert.equal(byCriterion.get('CLASS_RESPONSIBILITIES').confidence, 0)
    assert.equal(byCriterion.get('COUPLING_AND_COHESION').score, 8)
  })

  it('returns results in canonical criteria order regardless of LLM order', async () => {
    const shuffled = validResultEntries().reverse()
    const evaluator = createEvaluator(async () => new Response(JSON.stringify(groqPayload(shuffled)), { status: 200 }))

    const outcome = await evaluator.evaluate({ submission, problem })

    assert.deepEqual(
      outcome.results.map((r) => r.criterion),
      CRITERIA.map((c) => c.criterion)
    )
  })

  it('turns empty or absent concerns into null', async () => {
    const entries = validResultEntries({
      REQUIREMENT_UNDERSTANDING: { concern: '' },
      CLASS_RESPONSIBILITIES: { concern: null },
    })
    const evaluator = createEvaluator(async () => new Response(JSON.stringify(groqPayload(entries)), { status: 200 }))

    const outcome = await evaluator.evaluate({ submission, problem })

    const byCriterion = new Map(outcome.results.map((r) => [r.criterion, r]))
    assert.equal(byCriterion.get('REQUIREMENT_UNDERSTANDING').concern, null)
    assert.equal(byCriterion.get('CLASS_RESPONSIBILITIES').concern, null)
  })

  it('rejects responses with unknown criteria', async () => {
    const entries = validResultEntries()
    entries[7] = { ...entries[7], criterion: 'MAGIC_POWERS' }
    const evaluator = createEvaluator(async () => new Response(JSON.stringify(groqPayload(entries)), { status: 200 }))

    await assert.rejects(() => evaluator.evaluate({ submission, problem }), /unknown criteria: MAGIC_POWERS/)
  })

  it('rejects responses with duplicate criteria', async () => {
    const entries = validResultEntries()
    entries[1] = { ...entries[1], criterion: entries[0].criterion }
    const evaluator = createEvaluator(async () => new Response(JSON.stringify(groqPayload(entries)), { status: 200 }))

    await assert.rejects(() => evaluator.evaluate({ submission, problem }), /duplicate criterion/)
  })

  it('rejects responses with the wrong number of criteria', async () => {
    const evaluator = createEvaluator(
      async () => new Response(JSON.stringify(groqPayload(validResultEntries().slice(0, 3))), { status: 200 })
    )

    await assert.rejects(() => evaluator.evaluate({ submission, problem }), /exactly 8 criteria/)
  })

  it('rejects non-JSON content', async () => {
    const evaluator = createEvaluator(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }), { status: 200 })
    )

    await assert.rejects(() => evaluator.evaluate({ submission, problem }), /not valid JSON/)
  })

  it('rejects non-numeric scores', async () => {
    const entries = validResultEntries({ REQUIREMENT_UNDERSTANDING: { score: 'strong' } })
    const evaluator = createEvaluator(async () => new Response(JSON.stringify(groqPayload(entries)), { status: 200 }))

    await assert.rejects(() => evaluator.evaluate({ submission, problem }), /invalid score/)
  })

  it('throws on empty response content', async () => {
    const evaluator = createEvaluator(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 })
    )

    await assert.rejects(() => evaluator.evaluate({ submission, problem }), /empty response/)
  })

  it('throws on HTTP error responses', async () => {
    const evaluator = createEvaluator(
      async () =>
        new Response(JSON.stringify({ error: { message: 'rate limit exceeded' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
    )

    await assert.rejects(() => evaluator.evaluate({ submission, problem }), /status 429/)
  })

  it('throws when the network call fails', async () => {
    const evaluator = createEvaluator(async () => {
      throw new Error('socket hang up')
    })

    await assert.rejects(() => evaluator.evaluate({ submission, problem }), /socket hang up/)
  })
})

describe('Evaluator selection', () => {
  it('resolves auto mode based on the presence of a Groq API key', () => {
    assert.equal(resolveEvaluatorType({ evaluatorType: 'auto' }), 'RULE_BASED')
    assert.equal(resolveEvaluatorType({ evaluatorType: 'auto', groqApiKey: 'key' }), 'AI')
  })

  it('honors explicit ai / rule-based overrides regardless of key', () => {
    assert.equal(resolveEvaluatorType({ evaluatorType: 'ai' }), 'AI')
    assert.equal(resolveEvaluatorType({ evaluatorType: 'ai', groqApiKey: null }), 'AI')
    assert.equal(resolveEvaluatorType({ evaluatorType: 'rule-based', groqApiKey: 'key' }), 'RULE_BASED')
    assert.equal(resolveEvaluatorType({ evaluatorType: 'RULE-BASED' }), 'RULE_BASED')
    assert.equal(resolveEvaluatorType({ evaluatorType: 'AUTO', groqApiKey: 'key' }), 'AI')
  })

  it('getEvaluator returns an AiEvaluator for AI and RuleBasedEvaluator for unknown types', () => {
    assert.ok(getEvaluator('AI') instanceof AiEvaluator)
    assert.ok(getEvaluator('HUMAN') instanceof RuleBasedEvaluator)
    assert.ok(getEvaluator(undefined) instanceof RuleBasedEvaluator)
  })
})