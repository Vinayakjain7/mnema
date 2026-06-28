import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

const API_BASE = process.env.MNEMA_API || 'https://mnema-api.onrender.com';

export async function connectCommand(opts) {
  const { dir } = opts;
  const brainDir = join(dir, '.mnema');
  const configPath = join(brainDir, 'config.json');

  console.log(chalk.bold.cyan('\n  Mnema connect') + '\n');

  if (!existsSync(brainDir)) {
    console.log(chalk.yellow('  No .mnema/ found.'));
    console.log(`  Run ${chalk.cyan('npx mnema init')} first.\n`);
    process.exit(1);
  }

  // Already connected?
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    console.log(`  Already connected to project: ${chalk.cyan(config.projectName)}`);
    console.log(`  Project ID: ${chalk.dim(config.projectId)}`);
    console.log(`  To reconnect, delete ${chalk.dim('.mnema/config.json')}\n`);
    return;
  }

  // Get project name from existing brain
  let projectName = 'my-project';
  const projectJsonPath = join(brainDir, 'project.json');
  if (existsSync(projectJsonPath)) {
    try {
      const pj = JSON.parse(readFileSync(projectJsonPath, 'utf8'));
      projectName = pj.name || projectName;
    } catch {}
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(res => rl.question(chalk.bold(`  ${q} `), res));

  let email;
  try {
    console.log('  This links your local Project Brain to the Mnema cloud.');
    console.log(`  ${chalk.dim('Your brain will be accessible to your whole team.')}\n`);
    email = await ask('Your email (optional, for account):');
    rl.close();
  } catch {
    rl.close();
    return;
  }

  console.log('');
  const spinner = await startSpinner('  Creating project...');

  try {
    const profile = existsSync(projectJsonPath)
      ? JSON.parse(readFileSync(projectJsonPath, 'utf8'))
      : {};

    const res = await fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: projectName,
        ownerEmail: email?.trim() || undefined,
        profile,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      stopSpinner(spinner, false);
      console.error(chalk.red(`\n  API error: ${err.message}\n`));
      process.exit(1);
    }

    const data = await res.json();
    stopSpinner(spinner, true);

    // Save config locally — token is the auth credential
    const config = {
      projectId:   data.id,
      projectName: data.name,
      token:       data.token,
      apiBase:     API_BASE,
      connectedAt: new Date().toISOString(),
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log('');
    console.log(`  ${chalk.green('✓')} Connected: ${chalk.bold(data.name)}`);
    console.log(`  ${chalk.green('✓')} Project ID: ${chalk.dim(data.id)}`);
    console.log(`  ${chalk.green('✓')} Token saved to ${chalk.dim('.mnema/config.json')}`);
    console.log('');
    console.log(chalk.yellow('  ⚠ Add .mnema/config.json to .gitignore — it contains your token.'));
    console.log('');
    console.log(`  ${chalk.bold('Next:')} Run ${chalk.cyan('npx mnema sync')} to push your brain to the cloud.`);
    console.log('');

  } catch (err) {
    stopSpinner(spinner, false);
    console.error(chalk.red(`\n  Connection failed: ${err.message}`));
    console.log(chalk.dim('  Is the API reachable? Check your internet connection.\n'));
    process.exit(1);
  }
}

// ── tiny inline spinner (avoids ora dependency issues) ────────────
function startSpinner(text) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  process.stdout.write(text);
  const id = setInterval(() => {
    process.stdout.write(`\r${frames[i++ % frames.length]} ${text.trim()}`);
  }, 80);
  return id;
}

function stopSpinner(id, success) {
  clearInterval(id);
  process.stdout.write(`\r${success ? chalk.green('✓') : chalk.red('✗')}                              \r`);
}
