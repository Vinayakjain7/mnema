import chalk from 'chalk';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export async function pullCommand(opts) {
  const { dir } = opts;
  const brainDir   = join(dir, '.mnema');
  const configPath = join(brainDir, 'config.json');

  console.log(chalk.bold.cyan('\n  Mnema pull') + '\n');

  if (!existsSync(configPath)) {
    console.log(chalk.yellow('  Not connected to cloud. Run: npx mnema connect\n'));
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const { token, apiBase, projectName } = config;

  console.log(`  Pulling: ${chalk.cyan(projectName)}\n`);

  try {
    const res = await fetch(`${apiBase}/api/brain`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.json();
      console.error(chalk.red(`  Pull failed: ${err.message || err.error}\n`));
      process.exit(1);
    }

    const data = await res.json();
    const { files, meta } = data;

    mkdirSync(brainDir, { recursive: true });

    const written = [];
    Object.entries(files).forEach(([filename, content]) => {
      writeFileSync(join(brainDir, filename), content);
      written.push(filename);
    });

    // Show what was written with version info
    written.forEach(f => {
      const info = meta.find(m => m.filename === f);
      const age  = info ? timeAgo(new Date(info.updatedAt)) : '';
      console.log(`  ${chalk.green('✓')} ${f.padEnd(15)} ${chalk.dim(`v${info?.version || 1} · ${age}`)}`);
    });

    console.log('');
    console.log(`  ${chalk.bold('Done.')} Local brain is up to date.`);
    console.log('');

  } catch (err) {
    console.error(chalk.red(`  Pull failed: ${err.message}\n`));
    process.exit(1);
  }
}

// ── enrich command — AI-powered brain upgrade ─────────────────────
export async function enrichCommand(opts) {
  const { dir } = opts;
  const brainDir   = join(dir, '.mnema');
  const configPath = join(brainDir, 'config.json');

  console.log(chalk.bold.cyan('\n  Mnema enrich') + '\n');
  console.log(`  ${chalk.dim('Upgrading your Project Brain with Claude AI...')}\n`);

  if (!existsSync(configPath)) {
    console.log(chalk.yellow('  Not connected to cloud. Run: npx mnema connect\n'));
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const { token, apiBase, projectName } = config;

  // Optionally pass README for richer context
  let readme = null;
  const readmePath = join(dir, 'README.md');
  if (existsSync(readmePath)) {
    readme = readFileSync(readmePath, 'utf8').slice(0, 3000);
  }

  try {
    const res = await fetch(`${apiBase}/api/enrich`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ readme }),
    });

    const data = await res.json();

    if (res.status === 402) {
      console.log(chalk.yellow('  AI enrichment is a Pro feature.'));
      console.log(`  Upgrade at: ${chalk.cyan(data.upgradeUrl)}\n`);
      process.exit(0);
    }

    if (!res.ok) {
      console.error(chalk.red(`  Enrichment failed: ${data.message || data.error}\n`));
      process.exit(1);
    }

    console.log(`  ${chalk.green('✓')} Files enriched by Claude: ${data.enriched.join(', ')}`);
    console.log(`  ${chalk.green('✓')} Tokens used: ${chalk.dim(data.tokensUsed)}`);

    if (data.suggestedDecisions?.length) {
      console.log('');
      console.log(`  ${chalk.bold('Suggested decisions to record:')}`);
      data.suggestedDecisions.forEach((d, i) => {
        console.log(`    ${chalk.cyan(i + 1 + '.')} ${d.title}`);
        if (d.reason) console.log(`       ${chalk.dim('→')} ${chalk.dim(d.reason)}`);
      });
      console.log('');
      console.log(`  Run ${chalk.cyan('npx mnema learn')} to record them.`);
    }

    console.log('');
    console.log(`  Pull the enriched files: ${chalk.cyan('npx mnema pull')}`);
    console.log('');

  } catch (err) {
    console.error(chalk.red(`  Enrichment failed: ${err.message}\n`));
    process.exit(1);
  }
}

// ── helper ────────────────────────────────────────────────────────
function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 60)   return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
