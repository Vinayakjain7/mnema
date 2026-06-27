import chalk from 'chalk';
import ora from 'ora';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { isGitRepo, analyzeGitHistory, getCommitDetail } from '../utils/git-analyzer.js';
import { getApiConfig, enrichDecisions } from '../utils/llm-enricher.js';

export async function scanCommand(opts) {
  const { dir, enrich } = opts;
  const brainDir = join(dir, '.mnema');

  console.log(chalk.bold.cyan('\n  Mnema scan') + '\n');
  console.log('  Reading your git history to surface architectural decisions.');
  console.log(`  ${chalk.dim('Everything here runs locally — nothing is uploaded.')}\n`);

  if (!isGitRepo(dir)) {
    console.log(chalk.yellow('  This folder is not a git repository.'));
    console.log(`  ${chalk.dim('mnema scan reads git history, so it needs a repo with commits.')}\n`);
    process.exit(1);
  }

  const spinner = ora({ text: 'Analyzing git history...', indent: 2 }).start();

  let analysis;
  try {
    analysis = analyzeGitHistory(dir);
  } catch (err) {
    spinner.fail('Analysis failed.');
    console.error(chalk.red(`\n  ${err.message}\n`));
    process.exit(1);
  }

  if (analysis.empty) {
    spinner.warn('No commits found.');
    console.log(`  ${chalk.dim('This repo has no history yet. Make some commits first.')}\n`);
    return;
  }

  spinner.succeed(
    `Analyzed ${analysis.totalCommits}${analysis.capped ? '+' : ''} commits`
  );

  // ── Contributors ──────────────────────────────────────────────
  console.log('');
  console.log(`  ${chalk.bold('Contributors')}  ${chalk.dim('(who holds the context)')}`);
  analysis.contributors.slice(0, 5).forEach(c => {
    const bar = '█'.repeat(Math.max(1, Math.round((c.commits / analysis.totalCommits) * 20)));
    console.log(`    ${c.name.padEnd(20).slice(0, 20)} ${chalk.cyan(bar)} ${chalk.dim(c.commits)}`);
  });

  // ── Hotspots ──────────────────────────────────────────────────
  console.log('');
  console.log(`  ${chalk.bold('Most-changed areas')}  ${chalk.dim('(where the work concentrated)')}`);
  analysis.hotspots.slice(0, 6).forEach(h => {
    console.log(`    ${chalk.cyan(h.area.padEnd(24).slice(0, 24))} ${chalk.dim(h.changes + ' changes')}`);
  });

  // ── Decision-like commits ─────────────────────────────────────
  console.log('');
  console.log(`  ${chalk.bold('Likely decisions')}  ${chalk.dim(`(${analysis.decisions.length} found)`)}`);
  if (analysis.decisions.length === 0) {
    console.log(`    ${chalk.dim('No clear decision-style commits detected.')}`);
  } else {
    analysis.decisions.slice(0, 10).forEach(d => {
      console.log(`    ${chalk.green('•')} ${d.subject}  ${chalk.dim(d.date)}`);
    });
    if (analysis.decisions.length > 10) {
      console.log(`    ${chalk.dim(`... and ${analysis.decisions.length - 10} more`)}`);
    }
  }

  // ── Write a draft decisions file ──────────────────────────────
  let draftPath = null;
  if (analysis.decisions.length > 0) {
    if (!existsSync(brainDir)) mkdirSync(brainDir, { recursive: true });
    const decisionsDir = join(brainDir, 'decisions');
    mkdirSync(decisionsDir, { recursive: true });

    draftPath = join(decisionsDir, '000-scan-draft.md');
    writeFileSync(draftPath, buildScanDraft(analysis));

    console.log('');
    console.log(`  ${chalk.green('✓')} Draft written: ${chalk.bold('.mnema/decisions/000-scan-draft.md')}`);
    console.log(`    ${chalk.dim('Review it, keep the real decisions, delete the noise.')}`);
  }

  // ── Optional LLM enrichment ───────────────────────────────────
  if (enrich) {
    if (analysis.decisions.length === 0) {
      console.log(`\n  ${chalk.yellow('No decisions to enrich.')}\n`);
    } else {
      await runEnrichment({ dir, analysis, draftPath });
    }
  } else {
    console.log('');
    console.log(`  ${chalk.bold('Next:')}`);
    console.log(`    ${chalk.dim('•')} Review the draft and refine the decisions that matter`);
    console.log(`    ${chalk.dim('•')} Want the reasoning auto-filled? ${chalk.cyan('mnema scan --enrich')} ${chalk.dim('(uses your own LLM key)')}`);
    console.log('');
  }
}

/**
 * Exported so it can be called standalone (e.g. from tests or other commands).
 * Fetches per-commit file detail, calls the LLM, and rewrites the draft
 * with enrichments inline.
 */
export async function runEnrichment({ dir, analysis, draftPath }) {
  console.log('');
  console.log(`  ${chalk.bold('Enrichment')}  ${chalk.dim('(inferring the reasoning with an LLM)')}`);

  const config = getApiConfig();
  if (!config) {
    console.log(`\n  ${chalk.yellow('No LLM API key found.')}`);
    console.log(`  Set one of: ${chalk.cyan('GROQ_API_KEY')} (free), ${chalk.cyan('ANTHROPIC_API_KEY')}, or ${chalk.cyan('OPENAI_API_KEY')}`);
    console.log(`  Example: ${chalk.dim('GROQ_API_KEY=gsk_... mnema scan --enrich')}\n`);
    return;
  }

  console.log(`  ${chalk.dim(`Using ${config.provider} · ${config.model}`)}`);

  // Gather per-commit detail (files changed, diffstat) for the LLM prompt.
  const detailSpinner = ora({ text: 'Fetching commit details...', indent: 2 }).start();
  const decisions = analysis.decisions.slice(0, 25).map(d => {
    const detail = getCommitDetail(dir, d.hash);
    return { ...d, ...detail };
  });
  detailSpinner.succeed(`Fetched details for ${decisions.length} commits`);

  const enrichSpinner = ora({ text: 'Asking the model to infer reasoning...', indent: 2 }).start();
  let enrichResult;
  try {
    enrichResult = await enrichDecisions(decisions, config);
  } catch (err) {
    enrichSpinner.fail('Enrichment failed.');
    console.error(chalk.red(`\n  ${err.message}\n`));
    return;
  }

  const { results, requests, failures } = enrichResult;

  if (failures > 0 && results.size === 0) {
    enrichSpinner.fail(`All ${requests} request(s) failed.`);
    return;
  }

  enrichSpinner.succeed(
    failures > 0
      ? `Enriched ${results.size} decisions (${failures} batch failure(s) — partial result)`
      : `Enriched ${results.size} of ${decisions.length} decisions`
  );

  if (draftPath) {
    writeFileSync(draftPath, buildEnrichedDraft(analysis, decisions, results));
    console.log(`\n  ${chalk.green('✓')} Draft updated: ${chalk.bold('.mnema/decisions/000-scan-draft.md')}`);
    console.log(`    ${chalk.dim('Enriched reasoning is now inline. Review and keep what rings true.')}`);
  }

  console.log('');
  console.log(`  ${chalk.bold('Next:')}`);
  console.log(`    ${chalk.dim('•')} Review the enriched draft — the LLM is inferring, not reading minds`);
  console.log(`    ${chalk.dim('•')} Low-confidence items (🟡) are flagged — treat them as suggestions`);
  console.log('');
}

function buildScanDraft(analysis) {
  const lines = [];
  lines.push('# Scan draft — candidate decisions');
  lines.push('');
  lines.push('> Auto-generated by `mnema scan` from git history.');
  lines.push('> These are *candidate* decisions detected heuristically.');
  lines.push('> Review, keep the real ones, delete the noise, then they become part of your Project Brain.');
  lines.push('');
  lines.push('## Repository context');
  lines.push('');
  lines.push(`- **Commits analyzed:** ${analysis.totalCommits}${analysis.capped ? '+' : ''}`);
  lines.push(`- **Top contributor:** ${analysis.contributors[0]?.name || 'unknown'} (${analysis.contributors[0]?.commits || 0} commits)`);
  lines.push(`- **Most-changed area:** ${analysis.hotspots[0]?.area || 'unknown'}`);
  lines.push('');
  lines.push('## Candidate decisions');
  lines.push('');
  lines.push('_For each one worth keeping, fill in the reasoning — why it was done, what was rejected._');
  lines.push('');

  analysis.decisions.slice(0, 25).forEach((d, i) => {
    lines.push(`### ${i + 1}. ${d.subject}`);
    lines.push(`- **Date:** ${d.date}  ·  **By:** ${d.author}  ·  **Commit:** \`${d.hash.slice(0, 8)}\``);
    lines.push('- **Reasoning:** _(fill in — why was this done?)_');
    lines.push('- **Alternatives considered:** _(fill in, or delete if not a real decision)_');
    lines.push('');
  });

  return lines.join('\n');
}

function buildEnrichedDraft(analysis, decisions, enrichments) {
  const lines = [];
  lines.push('# Scan draft — candidate decisions (enriched)');
  lines.push('');
  lines.push('> Auto-generated by `mnema scan --enrich` from git history + LLM inference.');
  lines.push('> **The reasoning below is inferred, not recalled — the LLM is guessing from commit messages and file names.**');
  lines.push('> Review: keep what rings true, correct what\'s wrong, delete noise.');
  lines.push('> 🟢 high · 🔵 medium · 🟡 low confidence');
  lines.push('');
  lines.push('## Repository context');
  lines.push('');
  lines.push(`- **Commits analyzed:** ${analysis.totalCommits}${analysis.capped ? '+' : ''}`);
  lines.push(`- **Top contributor:** ${analysis.contributors[0]?.name || 'unknown'} (${analysis.contributors[0]?.commits || 0} commits)`);
  lines.push(`- **Most-changed area:** ${analysis.hotspots[0]?.area || 'unknown'}`);
  lines.push('');
  lines.push('## Candidate decisions');
  lines.push('');

  decisions.forEach((d, i) => {
    const e = enrichments.get(d.hash);
    const icon = !e ? '⬜' : e.confidence === 'high' ? '🟢' : e.confidence === 'medium' ? '🔵' : '🟡';

    lines.push(`### ${i + 1}. ${d.subject}  ${icon}`);
    lines.push(`- **Date:** ${d.date}  ·  **By:** ${d.author}  ·  **Commit:** \`${d.hash.slice(0, 8)}\``);

    if (e) {
      lines.push(`- **Reasoning:** ${e.reason || '_(not inferred)_'}`);
      if (e.alternatives.length > 0) {
        lines.push(`- **Alternatives considered:** ${e.alternatives.join('; ')}`);
      }
      if (e.rejectedBecause) {
        lines.push(`- **Rejected because:** ${e.rejectedBecause}`);
      }
      if (e.tags.length > 0) {
        lines.push(`- **Tags:** ${e.tags.map(t => '`' + t + '`').join(', ')}`);
      }
      lines.push(`- **Confidence:** ${e.confidence}`);
    } else {
      lines.push('- **Reasoning:** _(not enriched — fill in manually)_');
      lines.push('- **Alternatives considered:** _(fill in, or delete if not a real decision)_');
    }

    lines.push('');
  });

  return lines.join('\n');
}
