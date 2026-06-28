import chalk from 'chalk';
import ora from 'ora';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { scanRepository } from '../utils/scanner.js';
import { generateBrain } from '../utils/generator.js';

export async function initCommand(opts) {
  const { dir, force } = opts;
  const brainDir = join(dir, '.mnema');
  const projectName = getProjectName(dir);

  console.log(chalk.bold.cyan('  Mnema init') + '\n');
  console.log(`  Project: ${chalk.white.bold(projectName)}`);
  console.log(`  Path:    ${chalk.dim(dir)}\n`);

  // Guard: already initialized
  if (existsSync(brainDir) && !force) {
    console.log(chalk.yellow('  .mnema/ already exists.'));
    console.log(`  Use ${chalk.cyan('--force')} to overwrite, or run ${chalk.cyan('mnema learn')} to add decisions.\n`);
    return;
  }

  // ── Scan ──────────────────────────────────────────────────────
  const scanSpinner = ora({ text: 'Scanning repository...', indent: 2 }).start();

  let profile;
  try {
    profile = scanRepository(dir);
    scanSpinner.succeed(`Scanned — detected ${profile.detectedFiles.length} project file(s)`);
  } catch (err) {
    scanSpinner.fail('Scan failed: ' + err.message);
    process.exit(1);
  }

  // Show what was detected
  console.log('');
  printDetected(profile);

  // ── Generate ──────────────────────────────────────────────────
  const genSpinner = ora({ text: 'Generating Project Brain...', indent: 2 }).start();

  let brain;
  try {
    brain = generateBrain(profile, projectName);
    genSpinner.succeed('Project Brain generated');
  } catch (err) {
    genSpinner.fail('Generation failed: ' + err.message);
    process.exit(1);
  }

  // ── Write ─────────────────────────────────────────────────────
  const writeSpinner = ora({ text: 'Writing .mnema/ files...', indent: 2 }).start();

  try {
    mkdirSync(brainDir, { recursive: true });
    mkdirSync(join(brainDir, 'decisions'), { recursive: true });

    writeFileSync(join(brainDir, 'project.json'), brain.projectJson);
    writeFileSync(join(brainDir, 'brain.md'), brain.brainMd);
    writeFileSync(join(brainDir, 'rules.md'), brain.rulesMd);
    writeFileSync(join(brainDir, 'skills.md'), brain.skillsMd);

    // Empty decisions README
    writeFileSync(
      join(brainDir, 'decisions', 'README.md'),
      '# Decisions\n\nArchitectural decisions recorded by `npx mnema learn`.\n\nEach file follows the ADR format: decision, reason, alternatives considered, and why alternatives were rejected.\n'
    );

    writeSpinner.succeed('Files written');
  } catch (err) {
    writeSpinner.fail('Write failed: ' + err.message);
    process.exit(1);
  }

  // ── Done ──────────────────────────────────────────────────────
  console.log('');
  console.log(`  ${chalk.green('✓')} ${chalk.bold('.mnema/project.json')}  ${chalk.dim('— machine-readable stack profile')}`);
  console.log(`  ${chalk.green('✓')} ${chalk.bold('.mnema/brain.md')}       ${chalk.dim('— human-readable project summary')}`);
  console.log(`  ${chalk.green('✓')} ${chalk.bold('.mnema/rules.md')}       ${chalk.dim('— AI behavior rules')}`);
  console.log(`  ${chalk.green('✓')} ${chalk.bold('.mnema/skills.md')}      ${chalk.dim('— portable cross-agent context')}`);
  console.log(`  ${chalk.green('✓')} ${chalk.bold('.mnema/decisions/')}     ${chalk.dim('— architectural decision records')}`);
  console.log('');
  console.log(`  ${chalk.bold('Next steps:')}`);
  console.log(`  1. Review and edit ${chalk.cyan('.mnema/brain.md')} — add context the scanner couldn't detect`);
  console.log(`  2. Run ${chalk.cyan('npx mnema learn')} to record your first architectural decision`);
  console.log(`  3. Commit ${chalk.cyan('.mnema/')} to your repo — it's your team's shared project brain`);
  console.log('');
}

function printDetected(p) {
  const items = [
    p.language    && ['Language',         fmt(p.language)],
    p.framework   && ['Framework',        fmt(p.framework)],
    p.database    && ['Database',         fmt(p.database)],
    p.orm         && ['ORM',              fmt(p.orm)],
    p.testing     && ['Testing',          fmt(p.testing)],
    p.styling     && ['Styling',          fmt(p.styling)],
    p.linter      && ['Linter',           fmt(p.linter)],
    p.auth        && ['Auth',             fmt(p.auth)],
    p.deployment  && ['Deployment',       fmt(p.deployment)],
    p.packageManager && ['Package mgr',  p.packageManager],
    p.buildSystem && ['Build system',     fmt(p.buildSystem)],
    p.cicd        && ['CI/CD',            fmt(p.cicd)],
    p.containerized && ['Containerized',  'Yes'],
  ].filter(Boolean);

  if (items.length > 0) {
    console.log(`  ${chalk.bold('Detected stack:')}`);
    items.forEach(([k, v]) =>
      console.log(`    ${chalk.dim(k.padEnd(15))} ${chalk.cyan(v)}`)
    );
    console.log('');
  } else {
    console.log(`  ${chalk.yellow('No stack detected.')} Generating generic brain — edit manually.\n`);
  }
}

function fmt(str) {
  if (!str) return '';
  return str.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getProjectName(dir) {
  // Try package.json name first
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg.name) return pkg.name;
    } catch {}
  }
  // Fall back to directory name
  return basename(dir);
}
