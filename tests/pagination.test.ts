import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeCut } from '../src/pagination';
import { normalizeOptions } from '../src/options';

describe('pagination boundaries', () => {
  it('moves a cut before a table row without cutting text in the preceding cell', () => {
    assert.equal(safeCut(0, 100, [{ top: 80, bottom: 120 }, { top: 75, bottom: 83 }], [], 200), 75);
  });
  it('does not move a forced break or create a blank trailing page', () => {
    assert.equal(safeCut(0, 100, [], [80], 200), 80);
    assert.equal(safeCut(80, 180, [], [80, 160], 160), 160);
  });
  it('makes progress for an oversized keep-together block', () => {
    assert.equal(safeCut(0, 100, [{ top: 0, bottom: 350 }], [], 350), 100);
  });
  it('rejects invalid geometry and resource limits', () => {
    assert.throws(() => normalizeOptions({ margin: 110 }));
    assert.throws(() => normalizeOptions({ scale: NaN }));
    assert.throws(() => normalizeOptions({ maxPages: 1.5 }));
    assert.deepEqual(normalizeOptions({ format: 'letter', orientation: 'landscape' }).size, [279.4, 215.9]);
  });
});
