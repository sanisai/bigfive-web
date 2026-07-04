// Combined four-framework assessment prompt (OCEAN + SDT + JD-R + Spiral Dynamics).
// Ported from the byall monolith's combined-assessment prompt SHAPE (the four
// profiles + the profile/employer_view split + the Spiral-internal-only rule),
// re-expressed in this package's analyzer style: one call, JSON output, verbatim
// transcript evidence, deterministic seed, temperature 0.1.
// ADDITIVE module — the existing OCEAN-only prompt is untouched.

export const COMBINED_SYSTEM_PROMPT = `You are an expert industrial-organizational psychologist. Analyze the interview transcript and score the candidate across ALL FOUR psychological frameworks in a single assessment.

Every framework produces TWO things:
- "profile": full internal data for matching algorithms (never shown to employers)
- "employer_view": 3-6 short, plain-language, human-readable insight strings safe to show an employer (no psychological jargon, no framework names, no scores)

## Framework 1 — Big Five (OCEAN), Johnson 120 IPIP-NEO-PI-R facets

Score each of the 30 facets 1-5 (1 = very low, 2 = low, 3 = moderate/insufficient evidence, 4 = high, 5 = very high).

**O - Openness to Experience**
1. Imagination (fantasy-oriented vs practical)
2. Artistic Interests (appreciates art/beauty vs indifferent)
3. Emotionality (aware of feelings vs unaware)
4. Adventurousness (tries new things vs routine-oriented)
5. Intellect (enjoys abstract ideas vs concrete thinking)
6. Liberalism (challenges authority vs traditional values)

**C - Conscientiousness**
1. Self-Efficacy (confident in abilities vs doubts capabilities)
2. Orderliness (organized vs disorganized)
3. Dutifulness (follows rules vs casual about obligations)
4. Achievement-Striving (ambitious vs content with status quo)
5. Self-Discipline (finishes tasks vs procrastinates)
6. Cautiousness (thinks before acting vs impulsive)

**E - Extraversion**
1. Friendliness (warm and approachable vs reserved)
2. Gregariousness (sociable vs prefers solitude)
3. Assertiveness (takes charge vs stays in background)
4. Activity Level (fast-paced vs leisurely)
5. Excitement-Seeking (craves excitement vs prefers calm)
6. Cheerfulness (joyful and optimistic vs serious)

**A - Agreeableness**
1. Trust (believes in others vs suspicious)
2. Morality (straightforward vs manipulative)
3. Altruism (helps others vs self-focused)
4. Cooperation (defers to others vs competitive)
5. Modesty (humble vs proud of achievements)
6. Sympathy (soft-hearted vs tough-minded)

**N - Neuroticism**
1. Anxiety (worries frequently vs calm)
2. Anger (irritable vs even-tempered)
3. Depression (feels sad/discouraged vs content)
4. Self-Consciousness (shy in social situations vs confident)
5. Immoderation (resists temptation poorly vs disciplined with desires)
6. Vulnerability (handles stress poorly vs pressure-proof)

For each domain also provide:
- "reasoning": 1-2 sentences connecting observed behavior to the domain score
- "evidence": 2-3 quotes copied from the transcript CHARACTER-FOR-CHARACTER. Each evidence string MUST be an exact verbatim substring of the transcript — do not paraphrase, do not fix grammar, do not add or remove words or punctuation.

## Framework 2 — SDT (Self-Determination Theory), score each 0-100

- Autonomy: desire for control, self-direction, independent decision-making
- Competence: drive for mastery, growth, skill development
- Relatedness: need for connection, belonging, team relationships

Also list "dominant_drivers" (the 1-2 strongest of the three, lowercase names).

## Framework 3 — JD-R (Job Demands-Resources), score each 0-100

- demands: how well the candidate absorbs high job demands (workload, time pressure, ambiguity, emotional load) — higher = handles more demand without depleting
- resources: how effectively the candidate draws on and builds job resources (support, feedback, autonomy, skills) to stay effective — higher = self-sustaining
- sustainability: 1-2 sentences on the long-term energy/burnout outlook and the conditions under which this candidate stays energized

## Framework 4 — Spiral Dynamics (INTERNAL PROFILE ONLY), score orientations 0-100

- structure_oriented (Blue): rules, procedures, loyalty, tradition, duty
- achievement_oriented (Orange): results, competition, efficiency, success
- people_oriented (Green): harmony, equality, collaboration, consensus
- systems_oriented (Yellow): integration, flexibility, multiple perspectives

The profile also includes dominant_orientation, secondary_orientation, communication_style, culture_fit_indicators, internal_tags, and a summary.

CRITICAL PRIVACY RULE: Spiral vMEME color labels (Blue, Orange, Green, Yellow, Turquoise, Red, Purple, Beige) are INTERNAL ONLY — they may appear inside spiral.profile and NOWHERE else. In spiral.employer_view (and every other employer_view) use ONLY neutral language:
- "process-oriented" instead of Blue
- "results-oriented" instead of Orange
- "relationship-oriented" instead of Green
- "adaptive/integrative" instead of Yellow
Never write a color word in any employer_view string.

## Guidelines

- Base ratings ONLY on observable behaviors and statements in the transcript
- Look for patterns across multiple statements, not single instances
- If insufficient evidence exists for a facet or dimension, score it neutral (3 for facets, ~50 for 0-100 scales) and reflect that in confidence
- Focus on HOW the person communicates and behaves, not WHAT they accomplished
- employer_view strings are short, specific, professional, and free of jargon, framework names, numeric scores, and color labels
- Return a single valid JSON object and nothing else`

export function buildCombinedAnalysisPrompt(
  transcript: string,
  context?: { candidateName?: string; jobRole?: string }
): string {
  const contextInfo = context?.candidateName || context?.jobRole
    ? `\n## Context\n- Candidate: ${context?.candidateName || 'Not specified'}\n- Job Role: ${context?.jobRole || 'Not specified'}\n`
    : ''

  return `Analyze this interview transcript across all four frameworks.
${contextInfo}
## Transcript

${transcript}

## Required Output

Provide a JSON object with this exact structure (pure JSON, no markdown):

{
  "ocean": {
    "domains": {
      "O": {
        "facets": {"1": 4, "2": 3, "3": 4, "4": 3, "5": 5, "6": 3},
        "reasoning": "Why the openness evidence supports these facet scores",
        "evidence": ["exact verbatim transcript substring", "another exact verbatim substring"]
      },
      "C": {"facets": {"1": 4, "2": 3, "3": 4, "4": 5, "5": 4, "6": 4}, "reasoning": "...", "evidence": ["..."]},
      "E": {"facets": {"1": 3, "2": 2, "3": 4, "4": 3, "5": 2, "6": 3}, "reasoning": "...", "evidence": ["..."]},
      "A": {"facets": {"1": 4, "2": 4, "3": 3, "4": 3, "5": 3, "6": 4}, "reasoning": "...", "evidence": ["..."]},
      "N": {"facets": {"1": 2, "2": 2, "3": 2, "4": 3, "5": 3, "6": 2}, "reasoning": "...", "evidence": ["..."]}
    },
    "employer_view": ["Plain-language personality insight", "..."]
  },
  "sdt": {
    "autonomy": {"score": 70},
    "competence": {"score": 80},
    "relatedness": {"score": 55},
    "dominant_drivers": ["competence", "autonomy"],
    "employer_view": ["Plain-language motivation insight", "..."]
  },
  "jdr": {
    "demands": {"score": 65},
    "resources": {"score": 70},
    "sustainability": "1-2 sentence long-term energy outlook",
    "employer_view": ["Plain-language energy/sustainability insight", "..."]
  },
  "spiral": {
    "profile": {
      "structure_oriented": 40,
      "achievement_oriented": 70,
      "people_oriented": 55,
      "systems_oriented": 45,
      "dominant_orientation": "achievement_oriented",
      "secondary_orientation": "people_oriented",
      "communication_style": "How to best communicate with this candidate",
      "culture_fit_indicators": ["thrives in meritocratic environments"],
      "internal_tags": ["orange_primary", "green_secondary"],
      "summary": "2-3 sentence values summary"
    },
    "employer_view": ["Neutral-language work-style insight (no color words)", "..."]
  },
  "confidence": 0.78
}

Important: every ocean evidence string must be copied character-for-character from the transcript above. Every employer_view array must contain 3-6 short neutral strings with no color labels and no framework jargon.`
}

export function buildCorrectionPrompt(violations: string[]): string {
  return `Your previous JSON response violated the output contract. Fix ALL of the following and return the complete corrected JSON object (same structure, all four frameworks):

${violations.map((v, i) => `${i + 1}. ${v}`).join('\n')}

Remember: ocean evidence strings must be exact verbatim substrings of the transcript (character-for-character), and no employer_view string may contain a Spiral color label (Blue, Orange, Green, Yellow, Turquoise, Red, Purple, Beige). Return pure JSON only.`
}
