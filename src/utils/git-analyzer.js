import { execSync } from 'child_process';

/**
 * Layer 1 — heuristic git analysis. Free, local, no network.
 * Reads git history and extracts a factual "decision skeleton":
 * what changed, who changed it, which areas churn, and which commits
 * look like real decisions (vs. typo fixes / formatting).
 */

const MAX_COMMITS = 500; // safety cap so huge repos don't hang

// Conventional-commit / decision-signal keywords that suggest a real decision
const DECISION_SIGNALS = [
  'refactor', 'migrate', 'switch', 'replace', 'introduce', 'adopt',
  'remove', 'drop', 'rewrite', 'redesign', 'restructure', 'move to',
  'add support', 'deprecate', 'upgrade', 'downgrade', 'rename',
  'feat', 'breaking', 'arch', 'choose', 'use ',
];

// Noise we want to ignore — not architectural decisions
const NOISE_SIGNALS = [
  'typo', 'whitespace', 'formatting', 'lint', 'prettier', 'fmt',
  'bump version', 'merge branch', 'merge pull', 'wip', 'fixup',
  'gitignore', 'readme', 'comment', 'spelling',
];

export function isGitRepo(dir) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: dir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function git(dir, args) {
  return execSync(`git ${args}`, {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50, // 50MB
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Main entry. Returns a structured analysis of the repo's history.
 */
export function analyzeGitHistory(dir) {
  // Pull the log: hash, author, date, subject — separated by a rare delimiter
  const SEP = '\x1f'; // unit separator
  const RECORD = '\x1e'; // record separator
  const raw = git(
    dir,
    `log --no-merges -${MAX_COMMITS} --pretty=format:"%H${SEP}%an${SEP}%ad${SEP}%s${RECORD}" --date=short`
  );

  const commits = raw
    .split(RECORD)
    .map(r => r.trim())
    .filter(Boolean)
    .map(r => {
      const [hash, author, date, subject] = r.split(SEP);
      return { hash, author, date, subject: (subject || '').trim() };
    });

  if (commits.length === 0) {
    return { empty: true, commits: [], contributors: [], hotspots: [], decisions: [] };
  }

  // ── Contributors ──────────────────────────────────────────────
  const contributorMap = {};
  commits.forEach(c => {
    contributorMap[c.author] = (contributorMap[c.author] || 0) + 1;
  });
  const contributors = Object.entries(contributorMap)
    .map(([name, count]) => ({ name, commits: count }))
    .sort((a, b) => b.commits - a.commits);

  // ── File churn / hotspots ─────────────────────────────────────
  // How many times each file/area was touched across history
  let churnRaw = '';
  try {
    churnRaw = git(dir, `log --no-merges -${MAX_COMMITS} --name-only --pretty=format:""`);
  } catch {
    churnRaw = '';
  }
  const fileCounts = {};
  churnRaw.split('\n').forEach(line => {
    const f = line.trim();
    if (!f || f.startsWith('"')) return;
    fileCounts[f] = (fileCounts[f] || 0) + 1;
  });

  // Roll up to meaningful areas (up to 2 path segments) for a cleaner picture
  const areaCounts = {};
  Object.entries(fileCounts).forEach(([file, count]) => {
    const parts = file.split('/');
    let area;
    if (parts.length === 1) area = file;          // top-level file
    else if (parts.length === 2) area = parts[0] + '/';
    else area = parts[0] + '/' + parts[1] + '/';  // two levels deep
    areaCounts[area] = (areaCounts[area] || 0) + count;
  });
  const hotspots = Object.entries(areaCounts)
    .map(([area, changes]) => ({ area, changes }))
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 8);

  // ── Decision-like commits ─────────────────────────────────────
  const decisions = commits
    .map(c => ({ ...c, score: scoreCommit(c.subject) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    empty: false,
    totalCommits: commits.length,
    capped: commits.length >= MAX_COMMITS,
    contributors,
    hotspots,
    decisions,
    commits,
  };
}

/**
 * Score a commit subject for how likely it is to represent a real
 * architectural decision. Higher = more decision-like.
 */
function scoreCommit(subject) {
  if (!subject) return 0;
  const s = subject.toLowerCase();

  // Reject noise outright
  if (NOISE_SIGNALS.some(n => s.includes(n))) return 0;

  let score = 0;
  DECISION_SIGNALS.forEach(sig => {
    if (s.includes(sig)) score += 1;
  });

  // Bonus: conventional-commit "feat:" / "refactor:" prefixes are strong signals
  if (/^(feat|refactor|perf|breaking)(\(|:)/.test(s)) score += 1;

  return score;
}

/**
 * For a given commit hash, get which files it changed and a short stat.
 * Used when enriching a specific decision (Layer 2 feeds on this).
 */
export function getCommitDetail(dir, hash) {
  try {
    const files = git(dir, `show --name-only --pretty=format:"" ${hash}`)
      .split('\n')
      .map(f => f.trim())
      .filter(Boolean);
    const stat = git(dir, `show --stat --pretty=format:"" ${hash}`)
      .split('\n')
      .filter(Boolean)
      .pop() || '';
    return { files, stat };
  } catch {
    return { files: [], stat: '' };
  }
}
