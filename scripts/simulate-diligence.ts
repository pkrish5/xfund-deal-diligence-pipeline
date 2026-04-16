/**
 * simulate-diligence.ts
 *
 * Runs the full multi-agent diligence pipeline using real Perplexity + Anthropic APIs,
 * but skips Notion, Asana, and the database entirely. Output goes to console + a markdown file.
 *
 * Usage:
 *   npx tsx scripts/simulate-diligence.ts
 *
 *   Optional env overrides:
 *     COMPANY_NAME="Acme Corp" FOUNDER_NAME="Jane Doe" npx tsx scripts/simulate-diligence.ts
 *
 * Requires in .env:
 *   PERPLEXITY_API_KEY
 *   ANTHROPIC_API_KEY  (or OPENAI_API_KEY if SYNTHESIS_LLM_PROVIDER=openai)
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Load .env from project root ──────────────────────────────────────────────
// process.cwd() is the monorepo root when run as: npx tsx scripts/simulate-diligence.ts
const rootDir = process.cwd();
const envPath = path.resolve(rootDir, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = value;
    }
}

import { SynthesisLLMClient } from '../packages/shared/src/clients/synthesis-llm.client.js';
import { runDomainAgent, type DomainAgentConfig } from '../packages/shared/src/agents/domain-agent.js';
import { runVerifier } from '../packages/shared/src/agents/verifier-agent.js';
import { runSynthesis } from '../packages/shared/src/agents/synthesis-agent.js';
import { runReviewer } from '../packages/shared/src/agents/reviewer-agent.js';
import { RESEARCH_ORDER, AGENT_DISPLAY_TITLES, type AgentKey, type DomainAgentOutput } from '../packages/shared/src/agents/types.js';

// ── Config ───────────────────────────────────────────────────────────────────

const COMPANY_NAME = process.env.COMPANY_NAME || 'NovaSynth AI';
const FOUNDER_NAME = process.env.FOUNDER_NAME || 'Sarah Chen';
const ADDITIONAL_CONTEXT = process.env.ADDITIONAL_CONTEXT || '';

// ── Helpers ──────────────────────────────────────────────────────────────────

function sep(label?: string) {
    if (label) {
        const pad = Math.max(0, 76 - label.length);
        console.log(`\n${'─'.repeat(Math.floor(pad / 2))}  ${label}  ${'─'.repeat(Math.ceil(pad / 2))}`);
    } else {
        console.log('\n' + '─'.repeat(80));
    }
}

function checkEnv() {
    const perplexityKey = process.env.PERPLEXITY_API_KEY;
    const provider = (process.env.SYNTHESIS_LLM_PROVIDER || 'anthropic') as 'anthropic' | 'openai';
    const synthKey = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
    const keyName = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';

    const missing: string[] = [];
    if (!perplexityKey || perplexityKey.includes('xxx')) missing.push('PERPLEXITY_API_KEY');
    if (!synthKey || synthKey.includes('xxx')) missing.push(keyName);

    if (missing.length > 0) {
        console.error(`\nERROR: Missing or placeholder API keys in .env:\n  ${missing.join('\n  ')}`);
        console.error('Set real values and re-run.\n');
        process.exit(1);
    }

    return { perplexityKey: perplexityKey!, provider, synthKey: synthKey! };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const { perplexityKey, provider, synthKey } = checkEnv();

    const synthesisClient = new SynthesisLLMClient({
        provider,
        apiKey: synthKey,
        model: process.env.SYNTHESIS_LLM_MODEL || undefined,
    });

    const agentConfig: DomainAgentConfig = {
        perplexityApiKey: perplexityKey,
        synthesisClient,
    };

    console.log('\n' + '═'.repeat(80));
    console.log('  XFUND DILIGENCE PIPELINE — TEST RUN (no Notion / Asana / DB)');
    console.log(`  Company : ${COMPANY_NAME}`);
    console.log(`  Founder : ${FOUNDER_NAME}`);
    console.log(`  Model   : ${provider} / ${synthesisClient.getModelName()}`);
    console.log(`  Strategy: ${process.env.AGENT_STRATEGY || 'multi-turn-reflection'}`);
    console.log('═'.repeat(80) + '\n');

    const mdLines: string[] = [
        `# Diligence Report — ${COMPANY_NAME}`,
        `**Founder:** ${FOUNDER_NAME} | **Model:** ${provider}/${synthesisClient.getModelName()} | **Date:** ${new Date().toISOString().slice(0, 10)}`,
        '',
    ];

    // ── Phase 1: 9 Domain Agents (parallel) ──────────────────────────────────
    sep('PHASE 1 — RESEARCH  (9 agents in parallel)');
    console.log(`Running all 9 domain agents for "${COMPANY_NAME}"...\n`);

    const agentPromises = RESEARCH_ORDER.map(async (agentKey: AgentKey) => {
        const label = AGENT_DISPLAY_TITLES[agentKey];
        try {
            const result = await runDomainAgent(agentConfig, {
                agentKey,
                companyName: COMPANY_NAME,
                founderName: FOUNDER_NAME,
                additionalContext: ADDITIONAL_CONTEXT || undefined,
            });
            console.log(`  [done] ${label} — Score: ${result.output.provisionalScore} | Findings: ${result.output.findings.length}`);
            return { agentKey, result, success: true as const };
        } catch (err: any) {
            console.error(`  [fail] ${label} — ${err.message}`);
            return { agentKey, error: err, success: false as const };
        }
    });

    const agentResults = await Promise.all(agentPromises);
    const successful = agentResults.filter(r => r.success);
    console.log(`\nAgents completed: ${successful.length} / ${RESEARCH_ORDER.length}`);

    if (successful.length === 0) {
        console.error('\nNo agents succeeded — cannot continue.');
        process.exit(1);
    }

    const agentOutputs: Array<{ agentKey: string; output: DomainAgentOutput }> = successful.map(r => ({
        agentKey: r.agentKey,
        output: (r as any).result.output,
    }));

    // Print research summaries + write to md
    mdLines.push('## Research Outputs\n');
    for (const item of agentResults) {
        const label = AGENT_DISPLAY_TITLES[item.agentKey as AgentKey];
        if (!item.success) {
            mdLines.push(`### ${label}\n*Agent failed.*\n`);
            continue;
        }
        const out = (item as any).result.output as DomainAgentOutput;
        mdLines.push(`### ${label} [${out.provisionalScore}]`);
        mdLines.push(out.summary);
        mdLines.push('');
        if (out.findings.length > 0) {
            mdLines.push('**Key Findings:**');
            for (const f of out.findings) {
                const conf = f.confidence === 'high' ? '🟢' : f.confidence === 'medium' ? '🟡' : '🔴';
                mdLines.push(`- ${conf} ${f.claim}`);
            }
            mdLines.push('');
        }
        if (out.gaps.length > 0) {
            mdLines.push('**Gaps:**');
            for (const g of out.gaps) mdLines.push(`- ${g}`);
            mdLines.push('');
        }
        if (out.risksIdentified.length > 0) {
            mdLines.push('**Risks:**');
            for (const r of out.risksIdentified) mdLines.push(`- ${r}`);
            mdLines.push('');
        }
        mdLines.push(`*Score justification: ${out.scoreJustification}*\n`);
    }

    // ── Phase 2: Verification ────────────────────────────────────────────────
    sep('PHASE 2 — CROSS-AGENT VERIFICATION');
    console.log('Running verifier...\n');

    const verifierResult = await runVerifier(synthesisClient, {
        agentOutputs,
        companyName: COMPANY_NAME,
        founderName: FOUNDER_NAME,
    });

    const v = verifierResult.verification;
    console.log(`  Evidence quality  : ${v.overallEvidenceQuality}`);
    console.log(`  Contradictions    : ${v.contradictions.length}`);
    console.log(`  Score adjustments : ${v.scoreAdjustments.length}`);
    console.log(`  Human review flags: ${v.humanReviewFlags.length}`);
    console.log(`  Tokens            : ${verifierResult.tokensUsed}`);
    console.log(`\n  Summary: ${v.summary.slice(0, 200)}${v.summary.length > 200 ? '...' : ''}`);

    mdLines.push('---\n## Verification\n');
    mdLines.push(`**Evidence Quality:** ${v.overallEvidenceQuality}`);
    mdLines.push(`\n**Summary:** ${v.summary}\n`);
    if (v.contradictions.length > 0) {
        mdLines.push('**Contradictions:**');
        for (const c of v.contradictions) {
            mdLines.push(`- [${c.severity.toUpperCase()}] ${c.agentA} vs ${c.agentB}: ${c.claimA} ↔ ${c.claimB}${c.resolution ? ` *(${c.resolution})*` : ''}`);
        }
        mdLines.push('');
    }
    if (v.scoreAdjustments.length > 0) {
        mdLines.push('**Score Adjustments:**');
        for (const a of v.scoreAdjustments) {
            mdLines.push(`- ${a.agent}: ${a.originalScore} → ${a.adjustedScore} — ${a.reason}`);
        }
        mdLines.push('');
    }
    if (v.gaps.length > 0) {
        mdLines.push('**Gaps:**');
        for (const g of v.gaps) mdLines.push(`- ${g}`);
        mdLines.push('');
    }
    if (v.humanReviewFlags.length > 0) {
        mdLines.push('**Human Review Flags:**');
        for (const f of v.humanReviewFlags) mdLines.push(`- ${f}`);
        mdLines.push('');
    }

    // ── Phase 3: Synthesis ───────────────────────────────────────────────────
    sep('PHASE 3 — SYNTHESIS  (scorecard + IC memo)');
    console.log('Running synthesis...\n');

    const synthesisResult = await runSynthesis(synthesisClient, {
        agentOutputs,
        verification: v,
        meetingNotes: ADDITIONAL_CONTEXT,
        companyName: COMPANY_NAME,
        founderName: FOUNDER_NAME,
    });

    const sc = synthesisResult.scorecard;
    console.log(`  Overall score     : ${sc.overallScore}`);
    console.log(`  Recommendation    : ${sc.overallRecommendation}`);
    console.log(`  Memo sections     : ${synthesisResult.memo.sections.length}`);
    console.log(`  Tokens            : ${synthesisResult.totalTokens}`);

    mdLines.push('---\n## Scorecard\n');
    mdLines.push(`**Overall: ${sc.overallScore} — ${sc.overallRecommendation}**\n`);
    if (sc.domainScores.length > 0) {
        mdLines.push('| Domain | Score | Adjusted | Key Finding |');
        mdLines.push('|--------|-------|----------|-------------|');
        for (const ds of sc.domainScores) {
            mdLines.push(`| ${ds.domain} | ${ds.score} | ${ds.adjustedScore || ds.score} | ${ds.keyFinding} |`);
        }
        mdLines.push('');
    }
    if (sc.strengthsSummary.length > 0) {
        mdLines.push('**Strengths:**');
        for (const s of sc.strengthsSummary) mdLines.push(`- ${s}`);
        mdLines.push('');
    }
    if (sc.weaknessesSummary.length > 0) {
        mdLines.push('**Weaknesses:**');
        for (const w of sc.weaknessesSummary) mdLines.push(`- ${w}`);
        mdLines.push('');
    }
    if (sc.criticalQuestions.length > 0) {
        mdLines.push('**Critical Questions:**');
        for (const q of sc.criticalQuestions) mdLines.push(`- ${q}`);
        mdLines.push('');
    }

    mdLines.push('---\n## IC Memo\n');
    mdLines.push(`### ${synthesisResult.memo.title}\n`);
    for (const section of synthesisResult.memo.sections) {
        mdLines.push(`### ${section.heading}\n${section.content}\n`);
    }

    // Console scorecard
    sep('SCORECARD');
    console.log(`  Overall: ${sc.overallScore} — ${sc.overallRecommendation}\n`);
    for (const ds of sc.domainScores) {
        const adj = ds.adjustedScore && ds.adjustedScore !== ds.score ? ` → ${ds.adjustedScore}` : '';
        console.log(`  ${ds.domain.padEnd(28)} ${ds.score}${adj} — ${ds.keyFinding.slice(0, 60)}`);
    }
    console.log('\n  Strengths:');
    for (const s of sc.strengthsSummary) console.log(`    + ${s}`);
    console.log('\n  Weaknesses:');
    for (const w of sc.weaknessesSummary) console.log(`    - ${w}`);

    // Console memo preview
    sep('IC MEMO (preview)');
    const memoPreview = synthesisResult.rawMemoMarkdown.slice(0, 1800);
    console.log(memoPreview + (synthesisResult.rawMemoMarkdown.length > 1800 ? '\n\n[...see output file for full memo]' : ''));

    // ── Phase 4: Review ───────────────────────────────────────────────────────
    sep('PHASE 4 — DEVIL\'S ADVOCATE REVIEW');
    console.log('Running reviewer...\n');

    const reviewerResult = await runReviewer(synthesisClient, {
        scorecard: sc,
        memoMarkdown: synthesisResult.rawMemoMarkdown,
        verification: v,
        companyName: COMPANY_NAME,
        founderName: FOUNDER_NAME,
    });

    const rv = reviewerResult.review;
    console.log(`  Supported         : ${rv.recommendationSupported}`);
    console.log(`  Confidence        : ${rv.confidenceScore}/100`);
    console.log(`  Challenges        : ${rv.challenges.length}`);
    console.log(`  Human review?     : ${rv.requiresHumanReview}`);
    console.log(`  Tokens            : ${reviewerResult.tokensUsed}`);
    console.log(`\n  Assessment: ${rv.overallAssessment.slice(0, 300)}${rv.overallAssessment.length > 300 ? '...' : ''}`);

    mdLines.push("---\n## Devil's Advocate Review\n");
    mdLines.push(`**Confidence:** ${rv.confidenceScore}/100 | **Supported:** ${rv.recommendationSupported} | **Human Review:** ${rv.requiresHumanReview}\n`);
    mdLines.push(`**Overall Assessment:** ${rv.overallAssessment}\n`);
    if (rv.challenges.length > 0) {
        mdLines.push('**Challenges:**');
        for (const c of rv.challenges) {
            mdLines.push(`- [${c.severity.toUpperCase()}] **${c.area}:** ${c.challenge}`);
            if (c.evidenceGap) mdLines.push(`  *Gap: ${c.evidenceGap}*`);
        }
        mdLines.push('');
    }
    mdLines.push(`**The Case Against:**\n${rv.devilsAdvocateCase}\n`);
    if (rv.missingDiligence.length > 0) {
        mdLines.push('**Missing Diligence:**');
        for (const m of rv.missingDiligence) mdLines.push(`- [ ] ${m}`);
        mdLines.push('');
    }
    if (rv.humanReviewReasons.length > 0) {
        mdLines.push('**Human Review Reasons:**');
        for (const r of rv.humanReviewReasons) mdLines.push(`- ${r}`);
        mdLines.push('');
    }

    // ── Final Summary ─────────────────────────────────────────────────────────
    sep('DONE');
    const totalTokens = verifierResult.tokensUsed + synthesisResult.totalTokens + reviewerResult.tokensUsed;
    console.log(`  Total tokens  : ${totalTokens}`);
    console.log(`  Score         : ${sc.overallScore} — ${sc.overallRecommendation}`);
    console.log(`  Confidence    : ${rv.confidenceScore}/100`);
    console.log(`  Human review? : ${rv.requiresHumanReview}`);

    const footer = `\n---\n*Generated ${new Date().toISOString()} | Model: ${provider}/${synthesisClient.getModelName()} | Total tokens: ${totalTokens} | AI-generated — review before IC presentation.*`;
    mdLines.push(footer);

    // ── Write output file ─────────────────────────────────────────────────────
    const outputDir = path.resolve(rootDir, 'scripts/output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = COMPANY_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const outputFile = path.join(outputDir, `${slug}-${timestamp}.md`);
    fs.writeFileSync(outputFile, mdLines.join('\n'), 'utf8');

    console.log(`\n  Full report: ${outputFile}\n`);
}

main().catch(err => {
    console.error('\nSimulation failed:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});
