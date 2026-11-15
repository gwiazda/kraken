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
  ui: ['core', 'config'],
  feature: ['core', 'auth', 'schema', 'ui', 'config'],
};

/** Modules whose insides are private: everyone else (main.ts and tests too) imports only their index.ts. `core` and `ui` are open toolboxes. */
const SEALED = (module: string) => module === 'auth' || module === 'schema' || module.startsWith('features/');

const isTest = (file: string) => file.endsWith('.test.ts') || file.startsWith('/src/testing/');

/** Pure-logic files: calculations and validation, no Google and no screen. */
const isModelFile = (file: string) => /^\/src\/features\/[^/]+\/model[^/]*\.ts$/.test(file) && !isTest(file);
const PURE_CORE = ['/src/core/numbers.ts', '/src/core/dates.ts'];
const BROWSER = /\b(document|window|globalThis|self|navigator|fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|location)\b/;

/** Non-code files that may be imported (styles, images, data). Anything else must resolve to a .ts file. */
const ASSET = /\.(css|svg|png|jpe?g|webp|gif|json|txt|woff2?)$/i;

/** `core`, `auth`, `features/lots`, `main`, `config`, ... */
export function moduleOf(file: string): string {
  const parts = file.replace(/^\/src\//, '').split('/');
  if (parts[0] === 'features' && parts.length > 2) return `features/${parts[1]}`;
  if (parts.length === 1) return (parts[0] ?? '').replace(/(\.d)?\.ts$/, '');
  return parts[0] ?? '';
}

/** Removes comments (block comments, and lines that start with //), so text in comments is never read as code. */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * The import paths of a file. Only real import/export statements at the start of a line count
 * (`import ... from 'x'`, `export ... from 'x'`, `import 'x'`) plus `import('x')`, so strings in UI text are ignored.
 */
export function importsOf(source: string): string[] {
  const code = withoutComments(source);
  const patterns = [
    /^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[1] ?? ''));
}

function resolve(fromFile: string, path: string, files: Set<string>): string | null {
  const parts = fromFile.split('/').slice(0, -1);
  for (const part of path.replace(/\?.*$/, '').split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  const base = parts.join('/');
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`, base.replace(/\.js$/, '.ts')]) {
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
        if (!ASSET.test(path.replace(/\?.*$/, ''))) problems.push(`${file} imports "${path}", which does not exist`);
        continue;
      }
      const to = moduleOf(target);
      if (to === 'main') {
        problems.push(`${file} imports main.ts: nothing may depend on the start file`);
        continue;
      }
      if (to === 'testing') {
        if (!isTest(file)) problems.push(`${file} imports test helpers (${target})`);
        continue;
      }
      if (isModelFile(file)) {
        const ownModel = from === to && /\/model[^/]*\.ts$/.test(target) && !isTest(target);
        if (!(ownModel || PURE_CORE.includes(target))) problems.push(`${file} is pure logic and may not import ${target}`);
        continue;
      }
      if (from === to || target.endsWith('.d.ts')) continue;

      if (from !== 'main' && from !== 'testing') {
        const kind = from.startsWith('features/') ? 'feature' : from;
        const allowed = ALLOWED[kind] ?? [];
        if (!(allowed.includes(to) || (kind === 'feature' && to.startsWith('features/')))) {
          problems.push(`${file} (${from}) may not import ${target} (${to})`);
        }
      }
      if (SEALED(to) && target !== `/src/${to}/index.ts`) {
        problems.push(`${file} must import ${to} through /src/${to}/index.ts, not ${target}`);
      }
    }
    if (isModelFile(file) && BROWSER.test(withoutComments(source))) {
      problems.push(`${file} is pure logic and may not use the browser (document, window, fetch, storage, ...)`);
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
        '/src/core/numbers.ts': '',
        '/src/auth/index.ts': '',
        '/src/ui/button.ts': "import { GOOGLE_CLIENT_ID } from '../config';",
        '/src/features/lots/index.ts': "export { x } from './page';",
        '/src/features/lots/page.ts': "import { a } from '../../core/sheets';\nimport {\n  b,\n  c,\n} from '../../auth';\nimport { m } from './model';",
        '/src/features/lots/model.ts': "import { money } from '../../core/numbers';\nimport { code } from './modelCode';\n/** rounds like the window on the label */",
        '/src/features/lots/modelCode.ts': '',
        '/src/features/costs/page.ts': "import { lots } from '../lots';",
        '/src/main.ts': "import { x } from './features/lots';\nimport './style.css';\nimport logo from './logo.svg?url';",
      }),
    ).toEqual([]);
  });

  it("rejects a feature reaching into another feature's internals", () => {
    expect(
      check({ '/src/features/lots/index.ts': '', '/src/features/lots/repo.ts': '', '/src/features/costs/page.ts': "import { r } from '../lots/repo';" }),
    ).toEqual(['/src/features/costs/page.ts must import features/lots through /src/features/lots/index.ts, not /src/features/lots/repo.ts']);
  });

  it('rejects importing sign-in internals, from main.ts too and with a .js ending', () => {
    const auth = { '/src/auth/index.ts': '', '/src/auth/token.ts': '' };
    expect(check({ ...auth, '/src/main.ts': "import { t } from './auth/token';" })).toEqual([
      '/src/main.ts must import auth through /src/auth/index.ts, not /src/auth/token.ts',
    ]);
    expect(check({ ...auth, '/src/features/lots/page.ts': "import { t } from '../../auth/token.js';" })).toEqual([
      '/src/features/lots/page.ts must import auth through /src/auth/index.ts, not /src/auth/token.ts',
    ]);
  });

  it('rejects core depending on anything above it, in tests too', () => {
    expect(check({ '/src/schema/index.ts': '', '/src/core/sheets.ts': "import { m } from '../schema';" })).toEqual([
      '/src/core/sheets.ts (core) may not import /src/schema/index.ts (schema)',
    ]);
    expect(check({ '/src/schema/meta.ts': '', '/src/core/sheets.test.ts': "import { m } from '../schema/meta';" })).toEqual([
      '/src/core/sheets.test.ts (core) may not import /src/schema/meta.ts (schema)',
      '/src/core/sheets.test.ts must import schema through /src/schema/index.ts, not /src/schema/meta.ts',
    ]);
  });

  it('rejects pure logic that talks to Google or the screen, even through its own feature', () => {
    expect(
      check({
        '/src/core/sheets.ts': '',
        '/src/features/lots/repo.ts': '',
        '/src/features/lots/model.ts': "import { s } from '../../core/sheets';\nimport { r } from './repo';\nconst x = sessionStorage.length;",
      }),
    ).toEqual([
      '/src/features/lots/model.ts is pure logic and may not import /src/core/sheets.ts',
      '/src/features/lots/model.ts is pure logic and may not import /src/features/lots/repo.ts',
      '/src/features/lots/model.ts is pure logic and may not use the browser (document, window, fetch, storage, ...)',
    ]);
  });

  it('rejects importing main.ts, test helpers, packages and missing files, once each', () => {
    expect(
      check({
        '/src/main.ts': '',
        '/src/testing/fake.ts': '',
        '/src/core/a.ts': "import { m } from '../main';\nimport { f } from '../testing/fake';\nimport x from 'left-pad';\nimport { y } from './missing';\nimport { z } from './gone.js';",
      }),
    ).toEqual([
      '/src/core/a.ts imports main.ts: nothing may depend on the start file',
      '/src/core/a.ts imports test helpers (/src/testing/fake.ts)',
      '/src/core/a.ts imports the package "left-pad": app code uses no packages',
      '/src/core/a.ts imports "./missing", which does not exist',
      '/src/core/a.ts imports "./gone.js", which does not exist',
    ]);
  });

  it('ignores import-like text in strings and comments', () => {
    expect(
      check({
        '/src/core/a.ts': "button.textContent = \"Import from 'RoasTime'\";\n// values come from 'Sheet1'\n/* import { x } from '../main'; */\nexport const y = { from: 'z' };",
      }),
    ).toEqual([]);
  });

  it('lets tests use test helpers, packages and their own module internals', () => {
    expect(
      check({ '/src/testing/fake.ts': '', '/src/auth/token.ts': '', '/src/auth/token.test.ts': "import { describe } from 'vitest';\nimport { t } from './token';\nimport { f } from '../testing/fake';" }),
    ).toEqual([]);
  });
});
