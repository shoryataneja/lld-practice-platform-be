/* eslint-disable no-restricted-syntax */

const { CRITERIA, MAX_SCORE } = require('./criteria')

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const words = (text) => (text || '').match(/\S+/g)?.length || 0
const mentions = (text, keywords) => keywords.filter((k) => text.toLowerCase().includes(k)).length
const quote = (text, max = 160) => {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

function scoreResult(criterion, score, context) {
  return {
    criterion,
    score: clamp(Math.round(score), 0, MAX_SCORE),
    maxScore: MAX_SCORE,
    evidence: context.evidence || 'No supporting detail found in the submission.',
    concern: context.concern || null,
    suggestion: context.suggestion,
    confidence: context.confidence,
  }
}

class RuleBasedEvaluator {
  async evaluate({ submission, problem }) {
    const sections = (submission && submission.sections) || []
    const byKey = new Map(
      sections
        .filter((section) => section.content && section.content.trim())
        .map((section) => [section.key, section.content.trim()])
    )
    const pick = (...keys) => keys.map((key) => byKey.get(key)).filter(Boolean).join('\n').trim()
    const totalWords = [...byKey.values()].reduce((sum, content) => sum + words(content), 0)
    const confidence = clamp(0.55 + totalWords / 500, 0.6, 0.95)
    const brief = problem ? `${problem.title}` : 'the problem'

    const results = []
    const push = (criterion, score, evidence, concern, suggestion) => {
      results.push(
        scoreResult(criterion, score, { evidence, concern, suggestion, confidence: clamp(confidence, 0.6, 0.95) })
      )
    }

    const requirements = pick('requirements')
    const assumptions = pick('assumptions', 'requirements')
    const classes = pick('classes')
    const responsibilities = pick('responsibilities', 'classes')
    const relationships = pick('relationships', 'classes')
    const decisions = pick('decisions')
    const code = pick('code')

    // 1. Requirement Understanding
    let reqScore = 4 + Math.min(words(requirements), 20) * 0.15
    reqScore += mentions(requirements, ['user', 'system', 'actor', 'flow', 'must', 'should', 'requirement']) * 0.35
    reqScore += assumptions ? 0.6 : 0
    push(
      'REQUIREMENT_UNDERSTANDING',
      reqScore,
      requirements
        ? `Restated the scope in ${words(requirements)} words: "${quote(requirements)}"`
        : `No requirement restatement was provided for ${brief}.`,
      words(requirements) < 25 ? 'The restatement is thin — a short list, not a clear understanding of scope.' : null,
      'Separate must-have behaviour (core flows) from nice-to-have, and name explicit constraints without adding them to the model.'
    )

    // 2. Class Responsibilities
    const classCount = (classes.match(/\b[A-Z][A-Za-z0-9]{2,}\b/g) || []).length
    let clsScore = 4 + Math.min(classCount, 8) * 0.3
    clsScore += Math.min(words(responsibilities), 24) * 0.1
    clsScore += responsibilities ? 0.5 : 0
    push(
      'CLASS_RESPONSIBILITIES',
      clsScore,
      `Identified ${classCount} candidate class(es) and a ${words(responsibilities)} word responsibility breakdown.`,
      classCount < 3
        ? 'Very few entities are named — many designs split into 5–8 collaborators for a problem like this.'
        : !responsibilities
          ? 'You named classes but did not state who owns which behaviour.'
          : null,
      'Give every class exactly one clear job, phrased as behaviour (e.g. "ParkingLot allocates spots") rather than data.'
    )

    // 3. Coupling / Cohesion
    let coupCatScore = 5
    coupCatScore += mentions(relationships, ['interface', 'compos', 'dependenc', 'inject']) * 0.4
    coupCatScore += mentions(relationships, ['cohesion', 'responsibilit', 'single responsibility']) * 0.25
    coupCatScore += mentions(decisions, ['coupl', 'cohesi', 'compos', 'layer']) * 0.35
    if (!relationships && !decisions) coupCatScore -= 1.5
    push(
      'COUPLING_AND_COHESION',
      coupCatScore,
      relationships
        ? `Relationship model present: "${quote(relationships)}"`
        : 'No relationship/ownership analysis was found.',
      coupCatScore < 5.5 ? 'Ownership between classes is unclear — most collaborators look tightly coupled.' : null,
      'Prefer composition over raw references and split any class that both coordinates and computes.'
    )

    // 4. Encapsulation / Interfaces
    let encScore = 5
    encScore += mentions(classes, ['interface', 'private', 'abstract', 'encapsul']) * 0.4
    encScore += mentions(relationships, ['expose', 'behaviour', 'method', 'api']) * 0.25
    encScore += mentions(code, ['private', 'interface', 'class', 'abstract']) * 0.3
    push(
      'ENCAPSULATION_AND_INTERFACES',
      encScore,
      code
        ? `Code sketch has ${words(code)} words of class skeletons.`
        : 'No code sketch or interface-level detail was given.',
      encScore < 5.5 ? 'Little evidence of interfaces or information hiding — the model reads as public data.' : null,
      'Expose behaviour (park, pay, validate) rather than raw state, and define narrow interfaces between collaborators.'
    )

    // 5. Abstraction / Design Patterns
    const patternKeywords = ['factory', 'strategy', 'observer', 'state', 'command', 'decorator', 'adapter', 'template', 'singleton', 'builder', 'visitor']
    const patternHits = mentions(classes, patternKeywords) + mentions(decisions, patternKeywords) + mentions(relationships, patternKeywords)
    let absScore = 4 + Math.min(patternHits, 3) * 0.8
    absScore += mentions(decisions, ['abstraction', 'abstract', 'policy', 'behaviour']) * 0.4
    push(
      'ABSTRACTION_AND_DESIGN_PATTERNS',
      absScore,
      patternHits
        ? `Pattern vocabulary detected (${patternHits} hit(s)).`
        : 'No named pattern or abstraction layer was described.',
      !decisions ? 'No design-decision narrative means the abstraction choices are unclear.' : null,
      'Name the pattern explicitly and say which concrete variation/behaviour it captures — not just the pattern name.'
    )

    // 6. Extensibility
    let extScore = 4.5
    extScore += mentions(decisions, ['extens', 'new feature', 'future', 'plug', 'swap', 'config']) * 0.5
    extScore += mentions(relationships, ['interface', 'polymorph', 'strategy']) * 0.35
    extScore += patternHits * 0.3
    push(
      'EXTENSIBILITY',
      extScore,
      `Extension points discussed in ${words(decisions)} words of decisions.`,
      extScore < 5.5 ? 'No concrete extension point is described (what changes most often here?).' : null,
      'Name the extension points explicitly: what types of change should cost the least tomorrow?'
    )

    // 7. Edge Cases / Testability
    const edgeKeywords = ['empty', 'full', 'invalid', 'limit', 'capacity', 'null', 'error', 'concurr', 'boundary', 'timeout', 'fail']
    const allText = [...byKey.values()].join(' ')
    const edgeHits = mentions(allText, edgeKeywords)
    let edgeScore = 3 + edgeHits * 0.5
    edgeScore += words(code) > 20 ? 1.2 : 0
    push(
      'EDGE_CASES_AND_TESTABILITY',
      edgeScore,
      `Edge-case vocabulary found ${edgeHits} time(s) across the write-up.`,
      edgeScore < 4.5
        ? 'No failure states or boundary conditions are handled — the happy path only.'
        : null,
      'Model failure explicitly (lot full, ticket expired, duplicate request) and cover each with a test.'
    )

    // 8. Explanation Quality
    let expScore = 4.5 + Math.min(words(decisions), 24) * 0.12
    expScore += mentions(decisions, ['trade-off', 'alternative', 'because', 'why', 'chose', 'chosen']) * 0.5
    push(
      'EXPLANATION_QUALITY',
      expScore,
      `Made a ${words(decisions)} word decision narrative with ${mentions(decisions, ['trade-off', 'alternative', 'because', 'why'])} justified choices.`,
      !decisions ? 'No rationale was recorded — decisions and trade-offs are missing.' : null,
      'Lead each decision with the alternative you rejected and the reason, then keep it tight.'
    )

    const strong = results.filter((result) => result.score >= 7).length
    const weak = results.filter((result) => result.score < 5).length
    const summary =
      weak === 0
        ? `Solid design overall. ${strong}/8 criteria scored 7 or higher — your model, responsibilities and decisions read as coherent and defensible.`
        : `Promising shape with ${weak} weak spot(s). The core model is there, but the evaluation flagged thin areas — start with the criteria scoring below 5 before reworking what already works.`

    return { results, summary }
  }
}

const { AiEvaluator } = require('./aiEvaluator')

const EVALUATORS = { RULE_BASED: RuleBasedEvaluator, AI: AiEvaluator }

function resolveEvaluatorType({ evaluatorType = 'auto', groqApiKey = null } = {}) {
  const mode = String(evaluatorType).toLowerCase()
  if (mode === 'ai') return 'AI'
  if (mode === 'rule-based' || mode === 'rule_based' || mode === 'rulebased') return 'RULE_BASED'
  return groqApiKey ? 'AI' : 'RULE_BASED'
}

function getEvaluator(type) {
  const Evaluator = EVALUATORS[type] || RuleBasedEvaluator
  return new Evaluator()
}

module.exports = { getEvaluator, resolveEvaluatorType, CRITERIA, RuleBasedEvaluator, AiEvaluator }