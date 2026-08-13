import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const backendSrc = join(repoRoot, 'backend', 'src');
const frontendSrc = join(repoRoot, 'frontend', 'src');

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  walk(root);
  return out;
}

const IMPORT_PATTERN = /(?:import|export)[\s\S]{0,200}?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]/g;

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2];
    if (specifier) found.push(specifier);
  }
  return found;
}

/**
 * TR-STR-003: neither tree imports source files from the other. This is the
 * requirement that keeps §8.3 a boundary rather than a folder convention, so it
 * is checked rather than trusted.
 */
describe('source boundary (§8.3)', () => {
  it('TR-STR-003: the backend imports nothing from the frontend tree', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(backendSrc)) {
      for (const specifier of importsOf(file)) {
        if (/frontend/.test(specifier)) {
          offenders.push(`${file}: ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('TR-STR-003: the frontend imports nothing from the backend tree', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(frontendSrc)) {
      for (const specifier of importsOf(file)) {
        if (/backend/.test(specifier) || /\.\.\/\.\.\/backend/.test(specifier)) {
          offenders.push(`${file}: ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('TR-STR-002: each tree carries its own manifest and lockfile', () => {
    for (const tree of ['backend', 'frontend']) {
      for (const file of ['package.json', 'package-lock.json', 'tsconfig.json']) {
        expect(() => statSync(join(repoRoot, tree, file)), `${tree}/${file}`).not.toThrow();
      }
    }
  });

  it('TR-BE-002, TR-FE-002: both trees compile in strict mode', () => {
    for (const tree of ['backend', 'frontend']) {
      const config = readFileSync(join(repoRoot, tree, 'tsconfig.json'), 'utf8');
      const strictHere = /"strict"\s*:\s*true/.test(config);
      const strictInReferenced =
        !strictHere &&
        readdirSync(join(repoRoot, tree))
          .filter((name) => /^tsconfig\..*\.json$/.test(name))
          .some((name) =>
            /"strict"\s*:\s*true/.test(readFileSync(join(repoRoot, tree, name), 'utf8')),
          );
      expect(strictHere || strictInReferenced, `${tree} strict mode`).toBe(true);
    }
  });
});
