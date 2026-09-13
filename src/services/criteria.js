const MAX_SCORE = 10

const CRITERIA = [
  { criterion: 'REQUIREMENT_UNDERSTANDING', label: 'Requirement Understanding' },
  { criterion: 'CLASS_RESPONSIBILITIES', label: 'Class Responsibilities' },
  { criterion: 'COUPLING_AND_COHESION', label: 'Coupling / Cohesion' },
  { criterion: 'ENCAPSULATION_AND_INTERFACES', label: 'Encapsulation / Interfaces' },
  { criterion: 'ABSTRACTION_AND_DESIGN_PATTERNS', label: 'Abstraction / Design Patterns' },
  { criterion: 'EXTENSIBILITY', label: 'Extensibility' },
  { criterion: 'EDGE_CASES_AND_TESTABILITY', label: 'Edge Cases / Testability' },
  { criterion: 'EXPLANATION_QUALITY', label: 'Quality of Explanation' },
]

module.exports = { CRITERIA, MAX_SCORE }