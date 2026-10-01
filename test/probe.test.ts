import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { captureCommand } from '../src/command.ts';
import { fixture } from './support.ts';

test('the native probe rejects absent, disabled and untrusted owned capabilities', context => {
  const project = fixture(context);
  const directory = path.join(project, 'bin');
  mkdirSync(directory);
  const executable = path.join(directory, 'codex');
  writeFileSync(executable, `#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
project=Path.cwd()
root=project/'candidate'
names=['plan','roadmap','quick','debug','quality-pass','debt-sweep','doubt-pass','security-pass','triage']
for name in names:
 path=root/'skills'/name/'SKILL.md'
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text('fixture')
hookpath=root/'hooks/hooks.json'
hookpath.parent.mkdir(parents=True,exist_ok=True)
hookpath.write_text('{}')
scenario=os.environ['OSO_PROBE_SCENARIO']
for line in sys.stdin:
 request=json.loads(line)
 method=request.get('method')
 result={}
 if method=='skills/list':
  skills=[{'name':'oso-code-codex:'+name,'path':str(root/'skills'/name/'SKILL.md'),'pluginId':'oso-code-codex@personal','enabled':True} for name in names]
  if scenario=='missing-skill': skills.pop()
  if scenario=='disabled-skill': skills[0]['enabled']=False
  result={'data':[{'cwd':str(project),'skills':skills,'errors':[]}]}
 if method=='hooks/list':
  hook={'key':'oso-code-codex@personal:hooks/hooks.json:pre_tool_use:0:0','eventName':'preToolUse','pluginId':'oso-code-codex@personal','enabled':scenario!='disabled-hook','trustStatus':'untrusted' if scenario=='untrusted' else 'trusted','currentHash':'sha256:fixture','sourcePath':str(hookpath)}
  result={'data':[{'cwd':str(project),'hooks':[] if scenario=='missing-hook' else [hook]}]}
 print(json.dumps({'id':request['id'],'result':result}),flush=True)
`);
  chmodSync(executable, 0o755);
  const probe = path.resolve('scripts/codex-probe.py');
  const report = path.join(project, 'probe.json');
  const invoke = (scenario: string) => captureCommand(['env', `PATH=${directory}:${process.env.PATH}`, `OSO_PROBE_SCENARIO=${scenario}`, 'python3', probe, '--project', project, '--trust-owned', '--output', report], project);
  for (const scenario of ['missing-hook', 'missing-skill', 'disabled-hook', 'disabled-skill', 'untrusted']) assert.throws(() => invoke(scenario), /missing|disabled|untrusted|required/i, scenario);
  assert.match(invoke('complete'), /oso-code-codex:plan/);
  assert.equal(JSON.parse(readFileSync(report, 'utf8')).validation.status, 'pass');
});
