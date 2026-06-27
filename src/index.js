#!/usr/bin/env node
import { program } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { initCommand }       from './commands/init.js';
import { learnCommand }      from './commands/learn.js';
import { scanCommand }       from './commands/scan.js';
import { explainCommand }    from './commands/explain.js';
import { connectCommand }    from './commands/connect.js';
import { syncCommand }       from './commands/sync.js';
import { pullCommand, enrichCommand } from './commands/pull.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

console.log('');

program
  .name('mnema')
  .description(
    chalk.bold('Mnema') + ' — Repository intelligence layer for AI coding agents.\n' +
    chalk.dim('  GitHub stores code. Mnema stores context.')
  )
  .version(pkg.version);

// ── Local commands ────────────────────────────────────────────────
program
  .command('init')
  .description('Analyze this repo and generate a Project Brain')
  .option('--dir <path>', 'target repository path', process.cwd())
  .option('--force', 'overwrite existing .mnema/ directory')
  .action(initCommand);

program
  .command('learn')
  .description('Record an architectural decision into the Project Brain')
  .option('--dir <path>', 'target repository path', process.cwd())
  .action(learnCommand);

program
  .command('scan')
  .description('Analyze git history to surface architectural decisions')
  .option('--dir <path>', 'target repository path', process.cwd())
  .option('--enrich', 'use an LLM (your own key) to infer the reasoning behind each decision')
  .action(scanCommand);

program
  .command('explain')
  .description('Generate a full project summary for developers and AI agents')
  .option('--dir <path>', 'target repository path', process.cwd())
  .option('--format <type>', 'output format: terminal | markdown', 'terminal')
  .action(explainCommand);

// ── Cloud commands ────────────────────────────────────────────────
program
  .command('connect')
  .description('Link this project to the Mnema cloud')
  .option('--dir <path>', 'target repository path', process.cwd())
  .action(connectCommand);

program
  .command('sync')
  .description('Push your local Project Brain to the cloud')
  .option('--dir <path>', 'target repository path', process.cwd())
  .action(syncCommand);

program
  .command('pull')
  .description('Pull the latest Project Brain from the cloud')
  .option('--dir <path>', 'target repository path', process.cwd())
  .action(pullCommand);

program
  .command('enrich')
  .description('Upgrade your Project Brain with Claude AI (Pro)')
  .option('--dir <path>', 'target repository path', process.cwd())
  .action(enrichCommand);

program.parse();
