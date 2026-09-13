const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { getEvaluator, CRITERIA } = require('../src/services/evaluator')

const evaluator = getEvaluator('RULE_BASED')
const criterionEnumValues = new Set(CRITERIA.map((c) => c.criterion))

function buildSubmission(keyValues) {
  return {
    sections: keyValues.map(([key, content]) => ({ key, content })),
  }
}

const problem = { title: 'Parking Lot' }

const richSubmission = buildSubmission([
  ['requirements', 'Model a multi-level parking lot. Vehicles enter at a gate, are assigned an available spot, and pay before exiting. Must support motorcycle, compact and large spot types, track per-level occupancy and enforce a full-lot limit.'],
  ['assumptions', 'Single process, one currency, no distributed concerns. Assume a single entry and exit per level.'],
  ['classes', 'ParkingLot, Level, Spot, Vehicle, Ticket, Gate, PricingPolicy, EntryController, ExitController'],
  ['responsibilities', 'ParkingLot owns allocation strategy and pricing. Gate controls entry flow. ExitController computes payment. Spot is a passive value object.'],
  ['relationships', 'ParkingLot composes Levels which hold Spots. Gate references Ticket. ExitController depends on PricingPolicy via interface.'],
  ['decisions', 'I chose composition over inheritance for Level and Spot to keep types swappable. PricingPolicy is a strategy behind an interface so rules can change without touching Lot. Trade-off: slightly more classes but cleaner separation.'],
  ['code', 'interface Spot { fitVehicle(v: Vehicle): boolean }\nclass ParkingLot { private levels: Level[] }\nclass Gate { private ticketing: Ticketing }'],
])

const emptySubmission = buildSubmission([])

const minimalSubmission = buildSubmission([
  ['requirements', 'Parking lot.'],
])

function assertResultSchema(result) {
  assert.ok(criterionEnumValues.has(result.criterion), `unknown criterion: ${result.criterion}`)
  assert.ok(Number.isInteger(result.score), `${result.criterion}: score must be integer`)
  assert.ok(result.score >= 0 && result.score <= 10, `${result.criterion}: score ${result.score} outside 0..10`)
  assert.equal(result.maxScore, 10, `${result.criterion}: maxScore must be 10`)
  assert.equal(typeof result.evidence, 'string', `${result.criterion}: evidence must be string`)
  assert.ok(result.evidence.length > 0, `${result.criterion}: evidence must not be empty`)
  assert.ok(typeof result.confidence === 'number', `${result.criterion}: confidence must be number`)
}

describe('RuleBasedEvaluator', () => {
  it('returns all 8 criteria with valid schema on a rich submission', async () => {
    const { results, summary } = await evaluator.evaluate({ submission: richSubmission, problem })

    assert.equal(results.length, 8, 'must return exactly 8 results')
    assert.ok(typeof summary === 'string' && summary.length > 0, 'summary must be non-empty string')

    for (const result of results) assertResultSchema(result)
  })

  it('scores are deterministic for the same input', async () => {
    const first = await evaluator.evaluate({ submission: richSubmission, problem })
    const second = await evaluator.evaluate({ submission: richSubmission, problem })

    assert.deepEqual(first.results, second.results, 'results must be deeply equal')
    assert.equal(first.summary, second.summary, 'summaries must match')
  })

  it('rich submissions score higher than minimal/empty ones', async () => {
    const rich = await evaluator.evaluate({ submission: richSubmission, problem })
    const minimal = await evaluator.evaluate({ submission: minimalSubmission, problem })
    const empty = await evaluator.evaluate({ submission: emptySubmission, problem })

    const avg = (res) => res.results.reduce((s, r) => s + r.score, 0) / res.results.length

    assert.ok(avg(rich) > avg(minimal), 'rich should outscore minimal')
    assert.ok(avg(rich) > avg(empty), 'rich should outscore empty')
    assert.ok(avg(minimal) >= avg(empty), 'minimal should be >= empty')
  })

  it('returns valid results on an empty submission (no crash)', async () => {
    const { results, summary } = await evaluator.evaluate({ submission: emptySubmission, problem })

    assert.equal(results.length, 8)
    assert.ok(typeof summary === 'string' && summary.length > 0)

    for (const result of results) {
      assertResultSchema(result)
    }
  })

  it('includes concern messages for low-scoring criteria', async () => {
    const { results } = await evaluator.evaluate({ submission: emptySubmission, problem })

    const lows = results.filter((r) => r.score <= 4)
    const concerns = lows.filter((r) => r.concern !== null)

    assert.ok(concerns.length > 0, 'low-scoring criteria should have concern messages')
    for (const c of concerns) {
      assert.equal(typeof c.concern, 'string')
      assert.ok(c.concern.length > 0, `${c.criterion}: concern must not be empty string`)
    }
  })
})