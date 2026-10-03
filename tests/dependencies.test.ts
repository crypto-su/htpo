import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the library and lockfile have no runtime, optional or peer package dependencies', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  for (const pkg of [manifest, lock.packages['']]) {
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      assert.deepEqual(pkg[field] ?? {}, {}, `${field} must stay empty`);
    }
  }
  for (const [path, pkg] of Object.entries(lock.packages) as [string, { dev?: boolean }][]) {
    if (path) assert.equal(pkg.dev, true, `${path} must be development-only`);
  }
});
