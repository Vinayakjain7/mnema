import chalk from 'chalk';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export async function syncCommand(opts) {
  const { dir } = opts;
  const brainDir   = join(dir, '.mnema');
  const configPath = join(brainDir, 'config.json');

  console.log(chalk.bold.cyan('\n  Mnema sync') + '\n');

  // Guards
  if (!existsSync(brainDir)) {
    console.log(chalk.yellow('  No .mnema/ found. Run: npx mnemakit init\n'));
    process.exit(1);
  }
  if (!existsSync(configPath)) {
    console.log(chalk.yellow('  Not connected to cloud. Run: npx mnemakit connect\n'));
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const { token, apiBase, projectName } = config;

  console.log(`  Syncing: ${chalk.cyan(projectName)}\n`);

  // ── Collect brain files ───────────────────────────────────────
  const FILE_NAMES = ['project.json', 'brain.md', 'rules.md', 'skills.md'];
  const files = {};
  const missing = [];

  FILE_NAMES.forEach(f => {
    const path = join(brainDir, f);
    if (existsSync(path)) {
      files[f] = readFileSync(path, 'utf8');
    } else {
      missing.push(f);
    }
  });

  if (missing.length) {
    console.log(chalk.dim(`  Skipping missing files: ${missing.join(', ')}`));
  }

  // ── Collect decisions ─────────────────────────────────────────
  const decisionsDir = join(brainDir, 'decisions');
  const decisions = [];

  if (existsSync(decisionsDir)) {
    readdirSync(decisionsDir)
      .filter(f => f.endsWith('.md') && f !== 'README.md')
      .sort()
      .forEach(f => {
        const parsed = parseDecisionFile(join(decisionsDir, f));
        if (parsed) decisions.push(parsed);
      });
  }

  // ── Push brain files ──────────────────────────────────────────
  const brainResult = await apiCall(apiBase, '/api/brain', 'POST', token, { files });
  if (!brainResult.ok) {
    console.error(chalk.red(`  Brain sync failed: ${brainResult.error}\n`));
    process.exit(1);
  }
  console.log(`  ${chalk.green('✓')} Brain files: ${brainResult.data.synced} synced`);

  // ── Push decisions ────────────────────────────────────────────
  if (decisions.length) {
    const decResult = await apiCall(apiBase, '/api/decisions/bulk', 'POST', token, { decisions });
    if (!decResult.ok) {
      console.log(chalk.yellow(`  Decisions sync failed: ${decResult.error}`));
    } else {
      console.log(`  ${chalk.green('✓')} Decisions: ${decResult.data.synced} synced`);
    }
  } else {
    console.log(`  ${chalk.dim('○')} No decisions to sync`);
  }

  console.log('');
  console.log(`  ${chalk.bold('Done.')} Brain is live in the cloud.`);
  console.log(`  ${chalk.dim('Team members can pull with:')} ${chalk.cyan('npx mnemakit pull')}`);
  console.log('');
}

// ── helpers ───────────────────────────────────────────────────────
async function apiCall(base, path, method, token, body) {
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.message || data.error };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function parseDecisionFile(path) {
  try {
    const text = readFileSync(path, 'utf8');
    const lines = text.split('\n');

    const get = (heading) => {
      const idx = lines.findIndex(l => l.toLowerCase().includes(heading.toLowerCase()) && l.startsWith('#'));
      if (idx === -1) return null;
      const section = [];
      for (let i = idx + 2; i < lines.length; i++) {
        if (lines[i].startsWith('#')) break;
        const clean = lines[i].replace(/^[-*]\s*/, '').trim();
        if (clean) section.push(clean);
      }
      return section.join(' ') || null;
    };

    const titleLine = lines.find(l => l.startsWith('# Decision'));
    const title = titleLine?.replace(/^# Decision \d+:\s*/, '').trim();
    if (!title) return null;

    return {
      title,
      reason:          get('Reason'),
      alternatives:    get('Alternatives'),
      rejectedBecause: get('Why alternatives'),
    };
  } catch { return null; }
}
