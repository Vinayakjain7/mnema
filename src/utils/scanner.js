import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Scans a repository and returns a structured profile of its stack.
 * Reads: package.json, requirements.txt, pyproject.toml, Cargo.toml,
 *        Dockerfile, docker-compose.yml, tsconfig.json, .github/workflows/
 */
export function scanRepository(dir) {
  const profile = {
    language: null,
    framework: null,
    database: null,
    orm: null,
    testing: null,
    deployment: null,
    buildSystem: null,
    packageManager: null,
    styling: null,
    linter: null,
    formatter: null,
    auth: null,
    additionalLibs: [],
    cicd: null,
    containerized: false,
    detectedFiles: [],
  };

  // ── package.json ──────────────────────────────────────────────
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    profile.detectedFiles.push('package.json');
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      profile.language = 'javascript';

      // TypeScript
      if (deps.typescript || existsSync(join(dir, 'tsconfig.json'))) {
        profile.language = 'typescript';
        profile.detectedFiles.push('tsconfig.json');
      }

      // Framework detection
      if (deps.next)                profile.framework = 'nextjs';
      else if (deps['@remix-run/react']) profile.framework = 'remix';
      else if (deps.nuxt)           profile.framework = 'nuxt';
      else if (deps['@sveltejs/kit']) profile.framework = 'sveltekit';
      else if (deps.astro)          profile.framework = 'astro';
      else if (deps.express)        profile.framework = 'express';
      else if (deps.fastify)        profile.framework = 'fastify';
      else if (deps.hono)           profile.framework = 'hono';
      else if (deps.react)          profile.framework = 'react';
      else if (deps.vue)            profile.framework = 'vue';

      // Database / ORM
      if (deps['@prisma/client'] || deps.prisma) {
        profile.orm = 'prisma';
        profile.database = profile.database || 'postgresql';
      }
      if (deps.drizzle || deps['drizzle-orm']) profile.orm = 'drizzle';
      if (deps.mongoose)          profile.database = 'mongodb';
      if (deps.pg || deps.postgres) profile.database = profile.database || 'postgresql';
      if (deps.mysql2)            profile.database = 'mysql';
      if (deps.better_sqlite3 || deps['better-sqlite3']) profile.database = 'sqlite';
      if (deps['@supabase/supabase-js']) {
        profile.database = 'supabase (postgresql)';
        profile.additionalLibs.push('supabase');
      }

      // Testing
      if (deps.vitest)            profile.testing = 'vitest';
      else if (deps.jest)         profile.testing = 'jest';
      else if (deps.mocha)        profile.testing = 'mocha';
      else if (deps['@playwright/test']) profile.testing = 'playwright';

      // Styling
      if (deps.tailwindcss)       profile.styling = 'tailwindcss';
      else if (deps['styled-components']) profile.styling = 'styled-components';
      else if (deps['@emotion/react']) profile.styling = 'emotion';

      // Linter / formatter
      if (deps.eslint)            profile.linter = 'eslint';
      if (deps.prettier)          profile.formatter = 'prettier';
      if (deps.biome || deps['@biomejs/biome']) profile.linter = 'biome';

      // Auth
      if (deps['next-auth'] || deps['@auth/core']) profile.auth = 'next-auth';
      else if (deps['@clerk/nextjs'] || deps['@clerk/clerk-react']) profile.auth = 'clerk';
      else if (deps.lucia)        profile.auth = 'lucia';
      else if (deps['passport'])  profile.auth = 'passport';

      // Build / package manager
      if (existsSync(join(dir, 'pnpm-lock.yaml')))  profile.packageManager = 'pnpm';
      else if (existsSync(join(dir, 'bun.lockb')))  profile.packageManager = 'bun';
      else if (existsSync(join(dir, 'yarn.lock')))  profile.packageManager = 'yarn';
      else                                          profile.packageManager = 'npm';

      if (deps.turbo || pkg.turbo)  profile.buildSystem = 'turborepo';
      else if (deps.nx)             profile.buildSystem = 'nx';
      else if (deps.vite)           profile.buildSystem = 'vite';

      // Deployment hints
      if (deps['@vercel/analytics'] || pkg.scripts?.deploy?.includes('vercel'))
        profile.deployment = 'vercel';
      if (deps['@netlify/functions'])
        profile.deployment = 'netlify';

    } catch {}
  }

  // ── requirements.txt / pyproject.toml ────────────────────────
  const reqPath = join(dir, 'requirements.txt');
  const pyprojectPath = join(dir, 'pyproject.toml');

  if (existsSync(reqPath) || existsSync(pyprojectPath)) {
    profile.language = 'python';
    const src = existsSync(reqPath)
      ? readFileSync(reqPath, 'utf8').toLowerCase()
      : readFileSync(pyprojectPath, 'utf8').toLowerCase();

    if (existsSync(reqPath))      profile.detectedFiles.push('requirements.txt');
    if (existsSync(pyprojectPath)) profile.detectedFiles.push('pyproject.toml');

    if (src.includes('fastapi'))       profile.framework = 'fastapi';
    else if (src.includes('django'))   profile.framework = 'django';
    else if (src.includes('flask'))    profile.framework = 'flask';
    else if (src.includes('litestar')) profile.framework = 'litestar';

    if (src.includes('sqlalchemy'))    profile.orm = 'sqlalchemy';
    if (src.includes('psycopg'))       profile.database = profile.database || 'postgresql';
    if (src.includes('pymongo'))       profile.database = 'mongodb';
    if (src.includes('redis'))         profile.additionalLibs.push('redis');

    if (src.includes('pytest'))        profile.testing = 'pytest';

    if (src.includes('uvicorn') || src.includes('gunicorn'))
      profile.deployment = profile.deployment || 'wsgi/asgi server';
  }

  // ── Cargo.toml ────────────────────────────────────────────────
  const cargoPath = join(dir, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    profile.language = 'rust';
    profile.detectedFiles.push('Cargo.toml');
    const src = readFileSync(cargoPath, 'utf8').toLowerCase();
    if (src.includes('actix'))   profile.framework = 'actix-web';
    else if (src.includes('axum'))  profile.framework = 'axum';
    else if (src.includes('rocket')) profile.framework = 'rocket';
    if (src.includes('diesel'))     profile.orm = 'diesel';
    else if (src.includes('sqlx'))  profile.orm = 'sqlx';
    if (src.includes('tokio'))      profile.additionalLibs.push('tokio');
    if (src.includes('serde'))      profile.additionalLibs.push('serde');
  }

  // ── Dockerfile / docker-compose ───────────────────────────────
  if (existsSync(join(dir, 'Dockerfile'))) {
    profile.containerized = true;
    profile.detectedFiles.push('Dockerfile');
  }
  if (existsSync(join(dir, 'docker-compose.yml')) || existsSync(join(dir, 'docker-compose.yaml'))) {
    profile.containerized = true;
    profile.detectedFiles.push('docker-compose.yml');
    const src = readFileSync(
      existsSync(join(dir, 'docker-compose.yml'))
        ? join(dir, 'docker-compose.yml')
        : join(dir, 'docker-compose.yaml'),
      'utf8'
    ).toLowerCase();
    if (src.includes('postgres'))  profile.database = profile.database || 'postgresql';
    if (src.includes('mysql'))     profile.database = profile.database || 'mysql';
    if (src.includes('mongo'))     profile.database = profile.database || 'mongodb';
    if (src.includes('redis'))     profile.additionalLibs.push('redis');
  }

  // ── CI/CD ─────────────────────────────────────────────────────
  const ghWorkflows = join(dir, '.github', 'workflows');
  if (existsSync(ghWorkflows)) {
    profile.cicd = 'github-actions';
    profile.detectedFiles.push('.github/workflows');
  } else if (existsSync(join(dir, '.gitlab-ci.yml'))) {
    profile.cicd = 'gitlab-ci';
    profile.detectedFiles.push('.gitlab-ci.yml');
  }

  // ── Deployment (fallback from files) ─────────────────────────
  if (!profile.deployment) {
    if (existsSync(join(dir, 'vercel.json')))  profile.deployment = 'vercel';
    if (existsSync(join(dir, 'netlify.toml'))) profile.deployment = 'netlify';
    if (existsSync(join(dir, 'fly.toml')))     profile.deployment = 'fly.io';
    if (existsSync(join(dir, 'railway.json'))) profile.deployment = 'railway';
    if (existsSync(join(dir, 'render.yaml')))  profile.deployment = 'render';
    if (existsSync(join(dir, 'Procfile')))     profile.deployment = 'heroku';
  }

  return profile;
}
