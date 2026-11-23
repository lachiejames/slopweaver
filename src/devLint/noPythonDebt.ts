/**
 * The `no-python` gate's DEBT — every instruction to run Python that stood in this tree when the gate landed.
 *
 * Measured by the gate itself (`yarn tsx src/devLint/noPython.entry.ts` against an empty list). Every entry is a
 * real instruction the criterion correctly names — almost all of them a measurement's reproduction command in
 * a doc comment, which `.claude/rules/typescript-patterns.md` requires a measured comment to carry. Replacing
 * one is not a text edit: the replacement has to be RUN and shown to reproduce the same number, which is why
 * these were recorded rather than rewritten from inspection in the change that introduced the gate.
 *
 * Identity is the exact path plus the trimmed physical line, with a count, never a line number and never a whole
 * file. So moving a line is free; editing it retires the old entry (stale) and exposes the new text (fresh), and
 * a second identical instruction beside a recorded one is fresh. A stale entry fails the gate: delete it when its
 * instruction is converted. Never add one — a new hit is converted, or the criterion is sharpened.
 */
import type { PythonDebt } from "./noPython.js";

/** Today's recorded instructions, in path order. */
export const NO_PYTHON_DEBT: readonly PythonDebt[] = [
  {
    count: 1,
    matchedLine:
      "*   python3 -c 'import os,time;t=time.time();n=sum(1 for _ in os.scandir(os.environ[\"TMPDIR\"]));print(n,time.time()-t)'",
    owes: "a typed probe timing one scandir of TMPDIR and printing its entry count",
    path: "src/__tests__/setup-temp-root.ts",
  },
  {
    count: 1,
    matchedLine:
      "* python3 -c \"import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as p; p.plot([1,2],[1,2]); \\",
    owes: "a reproduction of the JPEG metadata experiment; no jq equivalent exists, so it needs a typed route",
    path: "src/admit/inventedVisual.ts",
  },
  {
    count: 1,
    matchedLine: "*   python3 -c \"print(open('/tmp/m.jpg','rb').read().find(b'Matplotlib'), \\",
    owes: "a grep -c for the Matplotlib marker bytes in the written JPEG, run against a real one",
    path: "src/admit/inventedVisual.ts",
  },
  {
    count: 1,
    matchedLine: "* python3 -c \"import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as p; \\",
    owes: "a reproduction of the PNG metadata experiment; no jq equivalent exists, so it needs a typed route",
    path: "src/admit/inventedVisual.ts",
  },
  {
    count: 1,
    matchedLine: "*   python3 -c \"print(open('/tmp/m.png','rb').read().find(b'Matplotlib version'))\"",
    owes: "a grep -c for the Matplotlib version marker in the written PNG, run against a real one",
    path: "src/admit/inventedVisual.ts",
  },
  {
    count: 1,
    matchedLine:
      "*   python3 -c \"import json,re,collections; c=collections.Counter(); [c.update([len(r['bundle_version'])]) for l in open('$SLOPWEAVER_HOME/atlas/jumpcloud/_resume.jsonl') for r in (json.loads(l).get('records') or []) if isinstance(r,dict) and re.fullmatch(r'[0-9a-f]{7,}', str(r.get('bundle_version','')))]; print(sorted(c.items()))\"",
    owes: "a jq over the resume journal counting hex-shaped bundle_version lengths",
    path: "src/atlas/jumpcloud/shapeExemptions.ts",
  },
  {
    count: 1,
    matchedLine:
      "* `http://127.0.0.1` — `python3 -m http.server --bind 127.0.0.1` in the directory it was written to, killed",
    owes: "a slopweaver verb serving the written report on localhost",
    path: "src/atlas/vanta/vulnerabilityReport.ts",
  },
  {
    count: 1,
    matchedLine:
      "* python3 -c \"import sys;print(len(','.join(l.strip() for l in sys.stdin if l.strip()).encode()))\" < scopes.txt",
    owes: "a jq or wc measurement of the joined scope list's UTF-8 byte length",
    path: "src/briefing/caps.ts",
  },
  {
    count: 1,
    matchedLine:
      "* `python3 -c \"import json;f=json.load(open('form.json'));print(len(f['reactNow']['meFacing'][0]['detail']['blocks']))\"`.",
    owes: "a jq counting the first card's detail blocks, run against a real form",
    path: "src/briefing/caps.ts",
  },
  {
    count: 1,
    matchedLine:
      '* `for f in ~/.slopweaver/handovers/*.md; do python3 -c \'import re,sys;t=open(sys.argv[1]).read();m=re.match(r"^---\\n(.*?)\\n---\\n",t,re.S);s=re.search(r"^summary: (?:\\"(.*?)\\"|(.*?))\\n(?=[a-zA-Z]+:|\\Z)",m.group(1),re.S|re.M);print(len(s.group(1) or s.group(2) or ""),sys.argv[1])\' "$f"; done | sort -n`):',
    owes: "a verb or awk measuring each handover summary's length",
    path: "src/handover/summaryCap.ts",
  },
  {
    count: 1,
    matchedLine:
      "* `SLOPWEAVER_ALLOW_RAW=1 curl -sS https://registry.npmjs.org/fathom-typescript | python3 -c \"import sys,json;d=json.load(sys.stdin);print(d.get('repository'),[m['name'] for m in d['maintainers']],len(d['time'])-2)\"`",
    owes: "a jq over the registry document naming repository, maintainers and version count",
    path: "src/live/fathom/api.ts",
  },
  {
    count: 1,
    matchedLine:
      '* `curl -sS https://api.fathom.ai/external/v1/meetings -H "X-Api-Key: $KEY" | python3 -c "import sys,json;print(repr(json.load(sys.stdin)[\'next_cursor\']))"`',
    owes: "a jq showing next_cursor's JSON form, checked against the representation it replaces",
    path: "src/live/fathom/api.ts",
  },
  {
    count: 1,
    matchedLine: '* python3 -c "',
    owes: "a typed corpus inspection reproducing the recorded count",
    path: "src/reflect/collectAskedForMissing.ts",
  },
  {
    count: 1,
    matchedLine: '*    written by one typed verb — `python3 -c "import json; [json.loads(l) for l in',
    owes: "a typed corpus inspection reproducing the recorded parse",
    path: "src/reflect/collectAskedForMissing.ts",
  },
  {
    count: 1,
    matchedLine: '* `python3 -c "import json;[print(i) for i,l in',
    owes: "a typed corpus inspection reproducing the recorded substrate listing",
    path: "src/reflect/substrate.ts",
  },
  {
    count: 1,
    matchedLine:
      "* python3 -c \"import json,os;d=json.load(open(os.path.expanduser('~/.slopweaver/capability-profile.json')));print(sum(1 for c in d['capabilities'] if c['sourceClass']=='atlas'))\"",
    owes: "a jq counting capabilities whose sourceClass is atlas",
    path: "src/route/atlasReading.ts",
  },
  {
    count: 1,
    matchedLine:
      "*     find ~/.slopweaver/corpus/members -name '[*].jsonl' -exec cat {} + | python3 -c \"import sys,json;rows=[json.loads(l) for l in sys.stdin];latest={(r['source'],r['identity']['nativeId']):r for r in rows};bots=[r for r in latest.values() if (r.get('profile') or {}).get('bot') is True];print(len(latest),len(bots),sum(1 for b in bots if (b.get('identity') or {}).get('email')))\"",
    owes: "a jq deduplicating by source and nativeId last-row-wins, then the bot and email counts",
    path: "src/silver/mentionResolver.ts",
  },
];
