const { CRITERIA, MAX_SCORE } = require('./criteria')

const config = require('../config')

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const MAX_TOKENS = 3200

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const roundScore = (value) => clamp(Math.round(value), 0, MAX_SCORE)

function stripCodeFence(text) {
  const trimmed = String(text).trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1].trim() : trimmed
}

class AiEvaluator {
  constructor({ model, apiKey, timeoutMs, fetchImpl } = {}) {
    this.model = model || config.groqModel
    this.apiKey = apiKey || config.groqApiKey
    this.timeoutMs = timeoutMs || config.groqTimeoutMs
    this.fetchImpl = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
    this.provider = 'groq'
    if (!this.apiKey) throw new Error('Groq API key is required to use the AI evaluator')
    if (!this.fetchImpl) throw new Error('No fetch implementation available for the AI evaluator')
  }

  buildSystemPrompt() {
    const criteriaLines = CRITERIA.map(({ criterion, label }) => `- ${criterion}: ${label}`).join('\n')
    return [
      'You are an expert low-level design (LLD) interviewer and grader.',
      'Evaluate the candidate submission against the problem statement and score it on the following 8 criteria:',
      criteriaLines,
      '',
      'Scoring rubric (0-10, integer):',
      '- 8-10: comprehensive, well-structured, clearly justified',
      '- 5-7: solid coverage with minor gaps',
      '- 2-4: partial or shallow coverage',
      '- 0-1: missing, irrelevant, or severely flawed',
      '',
      'For every criterion provide: score (0-10 integer), evidence (quote or summarize concrete supporting detail from the submission, never empty), concern (a specific weakness or null if none), suggestion (one actionable improvement, never empty), confidence (0 to 1).',
      'Return ONLY a single JSON object with this exact shape: {"summary": string, "results": [{"criterion": string, "score": number, "evidence": string, "concern": string|null, "suggestion": string, "confidence": number}]}.',
      `The results array MUST contain exactly ${CRITERIA.length} entries, one for each criterion listed above, using the exact criterion values. summary must be 1-2 sentences of overall feedback.`,
    ].join('\n')
  }

  buildUserMessage(problem, submission) {
    const sections = (submission && submission.sections) || []
    const rendered = sections
      .filter((section) => section && typeof section.content === 'string' && section.content.trim())
      .map((section) => `## ${section.key}\n${section.content.trim()}`)
    const problemText = problem
      ? `Title: ${problem.title || ''}${problem.description ? `\nDescription: ${problem.description}` : ''}`
      : ''
    const prompt = `Evaluate the submission below for the following problem.\n\n### Problem\n${problemText}\n\n### Submission\n${
      rendered.join('\n\n') || '(No sections submitted.)'
    }`
    return { role: 'user', content: prompt }
  }

  async parseResponse(content) {
    let parsed
    try {
      parsed = JSON.parse(stripCodeFence(content))
    } catch {
      throw new Error('Groq response was not valid JSON')
    }
    return this.validateResult(parsed)
  }

  validateResult(payload) {
    const results = payload && Array.isArray(payload.results) ? payload.results : null
    if (!results) throw new Error('Groq response is missing the results array')
    if (results.length !== CRITERIA.length) {
      throw new Error(`Groq response must contain exactly ${CRITERIA.length} criteria, got ${results.length}`)
    }

    const byCriterion = new Map()
    for (const entry of results) {
      if (!entry || typeof entry !== 'object' || typeof entry.criterion !== 'string') {
        throw new Error('Groq response contained a malformed result entry')
      }
      if (byCriterion.has(entry.criterion)) {
        throw new Error(`Groq response contained duplicate criterion ${entry.criterion}`)
      }
      byCriterion.set(entry.criterion, entry)
    }

    const knownCriterion = new Set(CRITERIA.map((c) => c.criterion))
    const unknown = [...byCriterion.keys()].filter((key) => !knownCriterion.has(key))
    if (unknown.length > 0) throw new Error(`Groq response contained unknown criteria: ${unknown.join(', ')}`)

    const normalized = CRITERIA.map(({ criterion }) => {
      const raw = byCriterion.get(criterion)
      const numeric = Number(raw.score)
      if (!Number.isFinite(numeric)) {
        throw new Error(`Groq response had an invalid score for criterion ${criterion}`)
      }
      const evidence =
        typeof raw.evidence === 'string' && raw.evidence.trim() ? raw.evidence.trim() : 'No supporting detail found in the submission.'
      const concern =
        typeof raw.concern === 'string' && raw.concern.trim() ? raw.concern.trim() : null
      const suggestion =
        typeof raw.suggestion === 'string' && raw.suggestion.trim()
          ? raw.suggestion.trim()
          : 'Tighten this area with concrete design decisions and trade-offs.'
      const confidence = clamp(Number(raw.confidence) || 0, 0, 1)
      return { criterion, score: roundScore(numeric), maxScore: MAX_SCORE, evidence, concern, suggestion, confidence }
    })

    const summary =
      typeof payload.summary === 'string' && payload.summary.trim() ? payload.summary.trim() : 'Evaluation completed.'
    return { results: normalized, summary }
  }

  async callGroq(userMessage) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_tokens: MAX_TOKENS,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: this.buildSystemPrompt() },
            { role: 'user', content: userMessage.content },
          ],
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        let detail = ''
        try {
          const payload = await response.json()
          if (payload && payload.error && payload.error.message) detail = `: ${payload.error.message}`
        } catch {}
        throw new Error(`Groq API request failed with status ${response.status}${detail}`)
      }
      const payload = await response.json()
      const content =
        payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content
      if (!content) throw new Error('Groq API returned an empty response')
      return this.parseResponse(content)
    } finally {
      clearTimeout(timer)
    }
  }

  async evaluate({ submission, problem } = {}) {
    const userMessage = this.buildUserMessage(problem || null, submission || {})
    const outcome = await this.callGroq(userMessage)
    return { results: outcome.results, summary: outcome.summary }
  }
}

module.exports = { AiEvaluator }