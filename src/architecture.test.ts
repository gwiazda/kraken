// Architecture test (like ArchUnit in Java): reads the import lines of every source file and fails if the
// structure rules are broken. The rules are described in CLAUDE.md ("Code structure").

import { describe, expect, it } from 'vitest';

/** Every .ts file under src, as text. Vite reads them at test time; no Node APIs needed. */
const SOURCES = import.meta.glob<string>('/src/**/*.ts', { query: '?raw', import: 'default', eager: true });

/** What each module may import (besides itself). Features may also use other features, through their index.ts. */
const ALLOWED: Record<string, readonly string[]> = {
  config: [],
  core: ['config'],
  auth: ['core', 'config'],
  schema: ['core', 'config'],
  ui: ['core'],
  feature: ['core', 'auth', 'schema', 'ui', 'config'],
};

/** Modules whose insides are private: outsiders import only their index.ts. `core` is a toolbox and stays open. */
const SEALED = (module: string) => module === 'auth' || module === 'schema' || module.startsWith('features/');

/** Pure-logic files: calculations and validation, no Google and no screen. */
const isModelFile = (file: string) => /^\/src\/features\/[^/]+\/model[^/]*\.ts$/.test(file) && !isTest(file);
const PURE_CORE = ['/src/core/money.ts', '/src/core/ids.ts', '/src/core/dates.ts'];

const isTest = (file: string) => file.endsWith('.test.ts') || file.startsWith('/src/testing/');

/** `core`, `auth`, `features/lots`, `main`, `config`, ... */
export function moduleOf(file: string): string {
  const parts = file.replace(/^\/src\//, '').split('/');
  if (parts[0] === 'features' && parts.length > 2) return `features/${parts[1]}`;
  if (parts.length === 1) return (parts[0] ?? '').replace(/(\.d)?\.ts$/, '');
  return parts[0] ?? '';
}

/** The import paths written in a file: `import ... from 'x'`, `export ... from 'x'`, `import 'x'`, `import('x')`. */
export function importsOf(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return found;
}

function resolve(fromFile: string, path: string, files: Set<string>): string | null {
  const parts = fromFile.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  const base = parts.join('/');
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

/** Checks the rules on a set of files ({ path: source }) and returns one sentence per broken rule. */
export function findViolations(sources: Record<string, string>): string[] {
  const files = new Set(Object.keys(sources));
  const problems: string[] = [];
  for (const [file, source] of Object.entries(sources)) {
    const from = moduleOf(file);
    for (const path of importsOf(source)) {
      if (!path.startsWith('.')) {
        if (!isTest(file)) problems.push(`${file} imports the package "${path}": app code uses no packages`);
        continue;
      }
      const target = resolve(file, path, files);
      if (target === null) {
        if (!/\.[a-z]+$/i.test(path)) problems.push(`${file} imports "${path}", which does not exist`);
        continue;
      }
      const to = moduleOf(target);
      if (to === 'main') problems.push(`${file} imports main.ts: nothing may depend on the start file`);
      if (target.startsWith('/src/testing/') && !isTest(file)) problems.push(`${file} imports test helpers (${target})`);
      if (isTest(file) || from === to || from === 'main' || target.endsWith('.d.ts')) continue;

      const kind = from.startsWith('features/') ? 'feature' : from;
      const allowed = ALLOWED[kind] ?? [];
      if (!(allowed.includes(to) || (kind === 'feature' && to.startsWith('features/')))) {
        problems.push(`${file} (${from}) may not import ${target} (${to})`);
      }
      if (SEALED(to) && target !== `/src/${to}/index.ts`) {
        problems.push(`${file} must import ${to} through /src/${to}/index.ts, not ${target}`);
      }
      if (isModelFile(file) && !PURE_CORE.includes(target)) {
        problems.push(`${file} is pure logic and may not import ${target}`);
      }
    }
    if (isModelFile(file) && /\b(document|window|fetch|localStorage)\b/.test(source.replace(/\/\/.*$/gm, ''))) {
      problems.push(`${file} is pure logic and may not use the browser (document, window, fetch, localStorage)`);
    }
  }
  return problems;
}

describe('the real code follows the structure rules', () => {
  it('finds the source files', () => {
    expect(Object.keys(SOURCES)).toContain('/src/main.ts');
  });

  it('has no violations', () => {
    const { ['/src/architecture.test.ts']: _self, ...others } = SOURCES;
    expect(findViolations(others)).toEqual([]);
  });
});

describe('the checker itself catches broken rules', () => {
  const check = (sources: Record<string, string>) => findViolations({ '/src/config.ts': '', ...sources });

  it('allows a clean feature', () => {
    expect(
      check({
        '/src/core/sheets.ts': '',
        '/src/core/money.ts': '',
        '/src/auth/index.ts': '',
        '/src/features/lots/index.ts': "export { x } from './page';",
        '/src/features/lots/page.ts': "import { a } from '../../core/sheets';\nimport { b } from '../../auth';\nimport { m } from './model';",
        '/src/features/lots/model.ts': "import { money } from '../../core/money';",
        '/src/features/costs/page.ts': "import { lots } from '../lots';",
        '/src/main.ts': "import { x } from './features/lots';\nimport './style.css';",
      }),
    ).toEqual([]);
  });

  it("rejects a feature reaching into another feature's internals", () => {
    expect(
      check({ '/src/features/lots/index.ts': '', '/src/features/lots/repo.ts': '', '/src/features/costs/page.ts': "import { r } from '../lots/repo';" }),
    ).toEqual(['/src/features/costs/page.ts must import features/lots through /src/features/lots/index.ts, not /src/features/lots/repo.ts']);
  });

  it('rejects importing sign-in internals', () => {
    expect(check({ '/src/auth/index.ts': '', '/src/auth/token.ts': '', '/src/main.ts': "import { t } from './auth/token';" })).toEqual([]);
    expect(check({ '/src/auth/index.ts': '', '/src/auth/token.ts': '', '/src/features/lots/page.ts': "import { t } from '../../auth/token';" })).toEqual([
      '/src/features/lots/page.ts must import auth through /src/auth/index.ts, not /src/auth/token.ts',
    ]);
  });

  it('rejects core depending on anything above it', () => {
    expect(check({ '/src/schema/index.ts': '', '/src/core/sheets.ts': "import { m } from '../schema';" })).toEqual([
      '/src/core/sheets.ts (core) may not import /src/schema/index.ts (schema)',
    ]);
  });

  it('rejects pure logic that talks to Google or the screen', () => {
    expect(
      check({ '/src/core/sheets.ts': '', '/src/features/lots/model.ts': "import { s } from '../../core/sheets';\nconst x = document.title;" }),
    ).toEqual([
      '/src/features/lots/model.ts is pure logic and may not import /src/core/sheets.ts',
      '/src/features/lots/model.ts is pure logic and may not use the browser (document, window, fetch, localStorage)',
    ]);
  });

  it('rejects importing main.ts, test helpers, packages and missing files', () => {
    expect(
      check({
        '/src/main.ts': '',
        '/src/testing/fake.ts': '',
        '/src/core/a.ts': "import { m } from '../main';\nimport { f } from '../testing/fake';\nimport x from 'left-pad';\nimport { y } from './missing';",
      }),
    ).toEqual([
      '/src/core/a.ts imports main.ts: nothing may depend on the start file',
      '/src/core/a.ts (core) may not import /src/main.ts (main)',
      '/src/core/a.ts imports test helpers (/src/testing/fake.ts)',
      '/src/core/a.ts (core) may not import /src/testing/fake.ts (testing)',
      '/src/core/a.ts imports the package "left-pad": app code uses no packages',
      '/src/core/a.ts imports "./missing", which does not exist',
    ]);
  });

  it('lets tests use test helpers and their own module internals', () => {
    expect(
      check({ '/src/testing/fake.ts': '', '/src/auth/token.ts': '', '/src/auth/token.test.ts': "import { describe } from 'vitest';\nimport { t } from './token';\nimport { f } from '../testing/fake';" }),
    ).toEqual([]);
  });
});
