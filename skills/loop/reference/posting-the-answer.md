# Posting the answer — the form, and the reviewer that gates it

The two calls that end a turn, in order: the reviewer opens on the answer's exact bytes, and the send is
refused without the verdict it writes. The rule — exactly one answer, never an unreviewed one — is in
[SKILL.md](../SKILL.md).

## Then post exactly one answer

```bash
cat > /tmp/answer.json <<'JSON'
{"kind": "answer", "lead": "the short direct answer",
 "body": [{"type": "paragraph", "runs": [{"type": "text", "text": "the supporting detail"}]}],
 "citations": [], "images": [],
 "grounding": {"kind": "conversation", "reason": "why context and judgement alone answer this",
   "evidence": {"read": [], "consultedEmpty": [], "premiseChecks": [], "substitutedForReal": [],
     "couldNotSee": {"blindSpots": [], "reason": "..."}},
   "provenance": {"model": "the supervisor session (Claude Code, in-turn)", "skillsLoaded": [], "verbsLoaded": []}}}
JSON
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn answer --brief <the brief path> --decision <your decision file> --answer /tmp/answer.json --verdict /tmp/verdict.json
```

`--verdict` is the reviewer's file, and without it the send is REFUSED. Write `/tmp/answer.json` first,
because the verdict binds to those exact bytes. `provenance.model` above is the INLINE label; a dispatched
worker copies the `PROVENANCE:` line its own `turn resume` printed instead.

## On a thread that is still moving, name what you read up to

**Pass `--read-through <ts>` on every send — the `ts` of the newest message your read actually reached.**
Without it the door measures its send-time delta from the ADDRESSING message, so on a long thread every
reply since the ask counts as new forever, and every send is refused until you clear that whole delta.

The door re-reads the thread at send time and computes the delta itself. **Whenever you pass
`--read-through`, the answer carries one line saying what you claimed to have read through** — empty delta
included. No code can check what you actually read, so the claim goes in the room where the person whose
message sits below it can see it. Give it honestly.

What you do about the delta:

- **Nothing landed** — it posts, carrying that one line.
- **Something landed and none of it touches a claim your answer makes** — read every message it names, then
  add `--delta-cleared`. It posts with a one-line freshness note the DOOR composes (you never write that
  line) and **costs no review round** — with or without `--read-through`; without one, the note names the
  addressing message as the boundary.
- **Something landed that contradicts or pre-empts a claim your answer makes** — that is not `--delta-cleared`.
  Fix that claim and re-open review narrowed to it.

The refusal names every message in the delta and both routes, so you never have to remember this. Measured
on the release incident `C0SYN000002/1789433376.265259`: five rounds, 156 minutes, and the owner
answering a colleague in public that it was unclear how long a final answer would take — the round
that produced that had nothing new in the thread at all, only a boundary that could never be satisfied.

## Before that send: open the reviewer through the verb

**Read [reference/reviewer.md](reviewer.md) before every send.** The reviewer is a second visible
cmux session, and its instructions are composed by CODE from the answer's bytes — never by you, never by a
worker:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn review --brief <the brief path> --decision <your decision file> --answer /tmp/answer.json --read-through <newest human ts you read>
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn review --brief <the brief path> --poll --wait   # one bounded call; exit 0 = verdict landed, 4 = still working
```

Run the BEFORE REVIEW ROUND 1 checklist your pre-flight printed first; round 1 refuses to open over a human
message newer than `--read-through` ([why](worker-contract.md), step 2).

`--poll` prints the verdict path `turn answer --verdict` takes; `--close` releases the reviewer once it has written.
On a worker's turn the worker runs exactly the same two calls with `--dispatch <id>` instead of
`--brief`/`--decision`.

`"images": []` above is the EMPTY case, not the expected one. When the answer's proof is a picture — a
curve's shape, a dashboard's state, a board, a diff — capture it and put an absolute path there. The routing
brief prints that default in full and `skills/loop-bot/reference/visual-evidence.md` carries the
measurement. It is never a refusal but in ONE case: a measured answer linking a Datadog graph view carries at
least three screenshots or the form refuses it ([rule 7](../../loop-bot/reference/links-citations-and-shots.md)).
A missing shot is never grounds for another review round. **Never
point a browser at Slack, GitHub, Linear or Notion to get one** — those go through the door (rule 3); the
doorless surfaces, where 23 of 28 of that day's visual links lived, are untouched.

`"substitutedForReal": []` is the same shape: the EMPTY case. Some subjects have a REAL artifact whose own
surface is the only evidence that counts — a monitor's deployed page and its evaluation panel, above all —
and a chart you drew of your own arithmetic is not it. The send door refuses such an answer unless it either
links the real thing or carries `{"real": "...", "why": "..."}` here, where `why` is the REASON you could not
produce it. Measured: an answer that said the monitors were never deployed and stopped there is
the failure this exists for — naming the gap is not naming its cause. `src/admit/realArtifact.ts` holds the
subject table.
