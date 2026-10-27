import assert from 'node:assert/strict';
export function assertNoDataWrites(result, calls) {
  const method = call => typeof call === 'string' ? call.replace(/^problem\./,'') : call.method;
  const writes = calls.map(method).filter(name => /^(?:save|set|delete|clear|enable|updateInfo)/.test(name));
  assert(writes.every(name => ['enableTreatPointsFromCheckerAsPercent'].includes(name)), writes.join(', '));
  const extra = calls.map(method).filter(name => name === 'editSolutionExtraTags');
  assert.equal(result.testMutations || 0, 0);
  assert.equal(result.mutations, writes.length + extra.length);
}
