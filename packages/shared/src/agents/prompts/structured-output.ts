/**
 * Instructions appended to Phase 2 prompts to enforce structured JSON output.
 */
export const STRUCTURED_OUTPUT_INSTRUCTIONS = `
CRITICAL OUTPUT FORMAT REQUIREMENT:
You MUST respond with ONLY valid JSON. No markdown fences, no explanation outside the JSON, no preamble.

Your response must be a single JSON object matching this exact schema:

{
  "summary": "<string: 2-4 paragraph narrative summary of your analysis. Be specific and evidence-based.>",
  "findings": [
    {
      "claim": "<string: a specific, verifiable claim about the company>",
      "evidence": "<string: the evidence supporting this claim — quote sources, cite data points>",
      "sourceUrl": "<string or null: URL of the source if available>",
      "confidence": "<one of: 'high', 'medium', 'low'>"
    }
  ],
  "provisionalScore": "<one of: 'A', 'B', 'C', 'D'>",
  "scoreJustification": "<string: 2-3 sentences explaining why you chose this grade, referencing specific evidence>",
  "assumptions": ["<string: each assumption you made due to limited data>"],
  "gaps": ["<string: specific information you could not find or verify>"],
  "risksIdentified": ["<string: risks specific to this analysis domain>"]
}

RULES:
- Include at least 3-5 findings, each with specific evidence
- Every finding MUST cite evidence — never include an unsupported claim as a finding
- If you cannot find evidence for something important, list it in "gaps" instead of fabricating a finding
- The provisionalScore must reflect EVIDENCE STRENGTH, not optimism
- List at least 1 gap — a thorough analysis always identifies what is unknown
- Assumptions must be clearly stated — do not embed hidden assumptions in findings
- risksIdentified should list domain-specific risks (not generic startup risks)`;

export const CRITIQUE_INSTRUCTIONS = `You are a critical reviewer of venture capital investment analyses. Your job is to find weaknesses, not to be encouraging.

Review the analysis and identify:
1. UNSUPPORTED CLAIMS — findings that lack sufficient evidence or cite vague sources
2. LOGICAL GAPS — conclusions that don't follow from the evidence presented
3. MISSING ANALYSIS — important aspects of this domain that were not addressed
4. OPTIMISM BIAS — places where the analyst gave benefit of the doubt without justification
5. SCORE JUSTIFICATION — is the provisional score actually supported by the findings?
6. CONTRADICTIONS — internal inconsistencies within the analysis

For each issue, be specific: quote the problematic text, explain why it's weak, and suggest what would make it stronger.

Format your critique as structured text with clear headers for each issue type.`;

export const REVISION_INSTRUCTIONS = `A critical review has identified weaknesses in a previous version of this analysis. You must address ALL critique points in your revision.

RULES FOR REVISION:
- Every issue raised in the critique must be addressed — either fix it or explain why the original was actually correct
- If a finding was flagged as unsupported, either add evidence or move the claim to "gaps"
- If optimism bias was identified, adjust the score and justification accordingly
- Do NOT simply remove findings to make the analysis look cleaner — address the underlying issue
- Your revised analysis should be MORE thorough than the original, not less

Respond with ONLY the revised JSON (same schema as before). No explanation outside the JSON.`;
