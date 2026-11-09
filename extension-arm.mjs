import fs from 'node:fs';
import assert from 'node:assert/strict';
import {decideExtensionLabels} from './extension_labels.mjs';

const fixture = fs.readFileSync('extension.json','utf8');
const inputs = JSON.parse(fixture).inputs;
const plan = decideExtensionLabels(inputs);
assert.equal(plan.semantic_remaining,false);
assert.deepEqual(plan.add_labels,['ext-agents']);
const expected = {add_labels:plan.add_labels};
let decision = expected;
if (process.env.ARM==='agent') {
  const calls = fs.readFileSync('evidence/tools.jsonl','utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual([...new Set(calls.slice(0,-1).map(call=>call.args.name))].sort(),Object.keys(inputs).sort());
  assert.equal(calls.at(-1).name,'publish_result');
  assert(calls.every(call=>!call.error));
  decision = JSON.parse(calls.at(-1).args.body);
}
assert.deepEqual(decision,expected);
fs.writeFileSync('evidence/result.json',JSON.stringify(decision));
