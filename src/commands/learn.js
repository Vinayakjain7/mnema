import chalk from 'chalk';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

export async function learnCommand(opts) {
  const { dir } = opts;
  const brainDir = join(dir, '.mnema');
  const decisionsDir = join(brainDir, 'decisions');

  console.log(chalk.bold.cyan('  Mnema learn') + '\n');
  console.log('  Recording an architectural decision into the Project Brain.');
  console.log(`  ${chalk.dim('These decisions help AI agents understand WHY things are the way they are.')}\n`);

  // Guard: not initialized
  if (!existsSync(brainDir)) {
    console.log(chalk.yellow('  No .mnema/ found in this directory.'));
    console.log(`  Run ${chalk.cyan('npx @fwufewio/mnema init')} first.\n`);
    process.exit(1);
  }

  mkdirSync(decisionsDir, { recursive: true });

  // ── Interactive prompts ───────────────────────────────────────
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(res => rl.question(chalk.bold(`  ${q} `), res));

  let decision, reason, alternatives, rejectedBecause, tags;

  try {
    console.log(chalk.dim('  Press Enter to skip optional fields.\n'));

    decision = await ask('Decision:');
    if (!decision.trim()) {
      console.log(chalk.red('\n  Decision is required. Aborting.\n'));
      rl.close();
      return;
    }

    reason = await ask('Reason:');
    alternatives = await ask('Alternatives considered (comma-separated):');
    rejectedBecause = await ask('Why alternatives were rejected:');
    tags = await ask('Tags (e.g. database, auth, testing):');

    rl.close();
  } catch {
    rl.close();
    return;
  }

  // ── Determine file number ─────────────────────────────────────
  const existing = existsSync(decisionsDir)
    ? readdirSync(decisionsDir).filter(f => f.endsWith('.md') && f !== 'README.md')
    : [];
  const num = String(existing.length + 1).padStart(3, '0');
  const slug = decision.trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50);
  const filename = `${num}-${slug}.md`;

  // ── Write ADR ─────────────────────────────────────────────────
  const content = buildADR({
    number: num,
    decision: decision.trim(),
    reason: reason.trim(),
    alternatives: alternatives.trim(),
    rejectedBecause: rejectedBecause.trim(),
    tags: tags.trim(),
  });

  writeFileSync(join(decisionsDir, filename), content);

  console.log('');
  console.log(`  ${chalk.green('✓')} Decision saved: ${chalk.bold(`.mnema/decisions/${filename}`)}`);
  console.log('');
  console.log(`  ${chalk.dim('Run')} ${chalk.cyan('npx @fwufewio/mnema explain')} ${chalk.dim('to see all decisions summarized.')}`);
  console.log('');
}

function buildADR({ number, decision, reason, alternatives, rejectedBecause, tags }) {
  const lines = [];

  lines.push(`# Decision ${number}: ${decision}`);
  lines.push('');
  lines.push(`**Date:** ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);

  if (tags) {
    lines.push(`**Tags:** ${tags.split(',').map(t => `\`${t.trim()}\``).join(', ')}`);
  }

  lines.push('');
  lines.push('## Decision');
  lines.push('');
  lines.push(decision);
  lines.push('');

  if (reason) {
    lines.push('## Reason');
    lines.push('');
    lines.push(reason);
    lines.push('');
  }

  if (alternatives) {
    lines.push('## Alternatives considered');
    lines.push('');
    alternatives.split(',').forEach(alt => lines.push(`- ${alt.trim()}`));
    lines.push('');
  }

  if (rejectedBecause) {
    lines.push('## Why alternatives were rejected');
    lines.push('');
    lines.push(rejectedBecause);
    lines.push('');
  }

  lines.push('## Impact on AI coding agents');
  lines.push('');
  lines.push(`When working on this project, follow this decision: **${decision}**`);
  if (alternatives) {
    lines.push(`Do not suggest ${alternatives.split(',')[0].trim()} as an alternative — it was already considered and rejected.`);
  }
  lines.push('');

  return lines.join('\n');
}
