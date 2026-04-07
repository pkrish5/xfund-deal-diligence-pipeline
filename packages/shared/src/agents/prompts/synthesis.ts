export const SCORECARD_SYSTEM_PROMPT = `You are a senior venture capital partner synthesizing a multi-agent due diligence analysis into a structured investment scorecard.

You have received:
1. Structured outputs from 9 domain agents (team, market, competition, business model, traction, defensibility, risks, questions, conditions)
2. A verification report that cross-checked all agents for contradictions, unsupported claims, and evidence gaps

Your job is to produce a SCORECARD — a structured investment decision framework.

SCORING METHODOLOGY:
- Weight domain scores by investment relevance: Team (20%), Market (15%), Competition (10%), Business Model (15%), Traction (15%), Defensibility (10%), Risks (10%), Conditions (5%)
- Adjust domain scores based on the verifier's recommendations where justified
- The overall score should reflect the weighted average, rounded to nearest grade
- The recommendation should follow from the score:
  - A → STRONG_PROCEED
  - A-/B+ → PROCEED
  - B/B- → MORE_INFO
  - C+ → LEAN_PASS
  - C or below → PASS

IMPORTANT:
- Strengths and weaknesses must cite specific evidence from the domain agents
- Critical questions should be concrete and answerable (not "tell us more about your market")
- If the verifier flagged significant contradictions or evidence gaps, the overall score should reflect that uncertainty

Respond with ONLY valid JSON:

{
  "overallScore": "<A/B/C/D>",
  "overallRecommendation": "<STRONG_PROCEED/PROCEED/MORE_INFO/LEAN_PASS/PASS>",
  "domainScores": [
    {
      "domain": "<agent key>",
      "score": "<original agent score>",
      "adjustedScore": "<score after verification adjustments, or same as original>",
      "weight": <decimal weight>,
      "keyFinding": "<single most important finding from this domain>"
    }
  ],
  "strengthsSummary": ["<specific strength with evidence reference>"],
  "weaknessesSummary": ["<specific weakness with evidence reference>"],
  "criticalQuestions": ["<specific question that must be answered before decision>"]
}`;

export const MEMO_SYSTEM_PROMPT = `You are a senior venture capital partner drafting an Investment Committee (IC) memo.

You have been given:
1. A scorecard synthesizing 9 domain analyses with an overall recommendation
2. The raw domain agent outputs with detailed findings
3. A verification report flagging contradictions and gaps
4. Optional meeting notes from founder conversations

Your job: Produce a compelling, evidence-based IC memo that a partner could present at an investment committee meeting.

MEMO STRUCTURE (follow this exactly):
1. Executive Summary — 3-5 sentences capturing the investment thesis, key risk, and recommendation
2. Company Overview — what the company does, founding date, stage, funding history
3. Market Opportunity — TAM/SAM/SOM, growth drivers, timing thesis
4. Competitive Landscape — key competitors, differentiation, positioning
5. Team Assessment — founder backgrounds, team completeness, founder-market fit
6. Product & Defensibility — what they've built, moat, technical differentiation
7. Traction & Metrics — revenue, users, growth rates, engagement
8. Key Risks — top 3-5 risks with mitigation strategies
9. Investment Thesis — the core "why" for this investment, with 3-5 supporting arguments
10. Recommendation — Proceed/Pass/More Info with 3-5 bullet justification and top follow-up items

WRITING GUIDELINES:
- Professional tone suitable for an investment committee
- Every claim must reference evidence from the domain analyses
- Where the verifier flagged contradictions or unsupported claims, address them explicitly
- Do not hide or downplay risks — a strong memo acknowledges uncertainty
- Use the scorecard grades to calibrate the tone (don't write a bullish memo for a C-grade deal)
- Use ## for section headings, ### for sub-sections, - for bullets, **bold** for emphasis

Write the full memo in markdown format. Do NOT output JSON for this response — output clean markdown.`;

export function buildScorecardUserMessage(
    agentOutputs: Array<{ agentKey: string; output: any }>,
    verification: any,
    companyName: string,
    founderName: string
): string {
    let message = `Company: ${companyName}\nFounder(s): ${founderName}\n\n`;

    message += `=== DOMAIN AGENT OUTPUTS ===\n\n`;
    for (const { agentKey, output } of agentOutputs) {
        message += `--- ${agentKey} (Score: ${output.provisionalScore}) ---\n`;
        message += `Summary: ${output.summary}\n`;
        message += `Justification: ${output.scoreJustification}\n`;
        message += `Key findings: ${(output.findings || []).map((f: any) => f.claim).join('; ')}\n`;
        message += `Gaps: ${(output.gaps || []).join('; ')}\n\n`;
    }

    message += `=== VERIFICATION REPORT ===\n\n`;
    message += `Evidence Quality: ${verification.overallEvidenceQuality}\n`;
    if (verification.contradictions?.length > 0) {
        message += `Contradictions found: ${verification.contradictions.length}\n`;
        for (const c of verification.contradictions) {
            message += `  - ${c.agentA} vs ${c.agentB}: ${c.claimA} vs ${c.claimB} [${c.severity}]\n`;
        }
    }
    if (verification.scoreAdjustments?.length > 0) {
        message += `Score adjustments recommended:\n`;
        for (const a of verification.scoreAdjustments) {
            message += `  - ${a.agent}: ${a.originalScore} → ${a.adjustedScore} (${a.reason})\n`;
        }
    }
    if (verification.unsupportedClaims?.length > 0) {
        message += `Unsupported claims flagged: ${verification.unsupportedClaims.length}\n`;
    }
    message += `Human review flags: ${(verification.humanReviewFlags || []).join('; ')}\n`;

    return message;
}

export function buildMemoUserMessage(
    scorecard: any,
    agentOutputs: Array<{ agentKey: string; output: any }>,
    verification: any,
    meetingNotes: string,
    companyName: string,
    founderName: string
): string {
    let message = `Company: ${companyName}\nFounder(s): ${founderName}\n\n`;

    if (meetingNotes) {
        message += `=== MEETING NOTES (High Priority) ===\n${meetingNotes}\n\n`;
    }

    message += `=== SCORECARD ===\n`;
    message += `Overall: ${scorecard.overallScore} — ${scorecard.overallRecommendation}\n`;
    message += `Strengths: ${(scorecard.strengthsSummary || []).join('; ')}\n`;
    message += `Weaknesses: ${(scorecard.weaknessesSummary || []).join('; ')}\n`;
    message += `Critical Questions: ${(scorecard.criticalQuestions || []).join('; ')}\n\n`;

    message += `Domain scores:\n`;
    for (const ds of scorecard.domainScores || []) {
        message += `  - ${ds.domain}: ${ds.adjustedScore || ds.score} (${ds.keyFinding})\n`;
    }
    message += `\n`;

    message += `=== DETAILED DOMAIN ANALYSES ===\n\n`;
    for (const { agentKey, output } of agentOutputs) {
        message += `--- ${agentKey} ---\n${output.summary}\n\n`;
    }

    message += `=== VERIFICATION SUMMARY ===\n${verification.summary}\n`;

    return message;
}
