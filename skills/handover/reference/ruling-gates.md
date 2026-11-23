# Ruling gates — a recorded ruling that refuses the verb it rules on

A ruling recorded on the board — a DM-only ruling on a recipe, a hold, a no-post-today — must be read by
the verb it rules on at run time and refuse, never rely on the chair remembering it across a compaction.

## The failure, stated exactly

The owner ruled that a particular automation's output goes to a DM only. A later post went to the channel
anyway, and two earlier posts the same day were a duplicate of each other. Nothing was broken: the ruling was
recorded, `handover audit-rulings` could print it, and every door that reads a ruling — `findingGate.ts` —
reads it for a different question. What carried the DM-only constraint from the turn that heard it to the
verb that violated it was **one session's memory**, and auto-compaction is exactly the event that drops it.

**What a gate buys, no larger than it is.** The memory dependence lasts one `handover rule` invocation, not
a whole workstream. The chair still has to record the gate at the moment the owner rules;
nothing here reads the owner's words and infers a verb.

## What a gate is

A `ruling` event may carry a `gate`: a list of `{ noun, verb }` pairs, an optional list of `subjects`, and an
optional `untilIso`. A gate in force refuses the verb it names, at the CLI dispatch boundary AND on every
in-process path into it, in every session on the machine — including one that has never heard of the ruling.

```bash
slopweaver handover rule <slug> --anchor <where it was said> --words "<the owner's words>" \
  --gates "automation run-due, slack post" \
  --gate-subject "iso-policy-acceptance-daily" \
  --gate-until <UTC instant ending in Z>
```

- **`--gates`** is a comma-separated list of `<noun> <verb>` pairs. A verb the surface does not have is
  refused at record time rather than recorded as a gate that can never fire.
- **`--gate-subject`** narrows the gate to invocations whose argv carries that token whole. Omit it and the
  gate covers the whole verb.
- **`--gate-until`** lapses the gate at an instant. Omit it and it stands until released.

A `handover rule` that records no gate prints an advisory nudge saying so — the ruling is still recorded, and
nothing refuses on it.

## The blunt half and the precise half

Complements, not duplicates — keep both.

- **Blunt** — `dispatchGateVerdict`, through `src/cli/rulingGateDoor.ts`, which `src/cli/main.ts` calls before
  `--help` is answered or the verb's module loads. It knows a
  noun, a verb and a raw argv, nothing more, and it matches a subject as a **whole argv token** — a
  `--flag=value` token split at its first `=`, so both spellings the CLI accepts are refused alike. It runs
  ahead of every typed verb, which a session that never read the ruling still passes through.
- **Precise** — `rulingGateVerdict`, for a caller that has already resolved its real subject and can ask the
  exact question. `automation run-due` asks it once per due row (`src/cli/commands/automation/runDueRulingGate.ts`):
  a tick's argv names no row, so a gate scoped to one automation id holds that row — reported `HELD` with the
  owner's words and the anchor, neither run nor stamped, taking no `--limit` place — while its siblings run. A tick
  whose argv carries the id as a token (`--recipe <id>`) is still refused whole by the blunt half.

Neither replaces the other. The blunt half catches the invocation nobody anticipated; the precise half is
what a verb uses once it knows what it is actually about to do.

## Every path in, not only the typed one

A verb that calls another verb's function IN-PROCESS never passes `main.ts`, so the dispatch boundary alone
was walked around (a fresh audit's finding): measured, 47 in-process paths reached 23
verb bodies across 22 verbs ungated, the automation drain's `handover register`, `slack post` and
`slack alert-summary` among them. So every verb body an in-process path reaches opens with
`const gated = refuseRunnerOnStandingRuling({ noun, verb, rest })` (`src/cli/rulingGateDoor.ts`) and returns
`gated` when it is defined, as its first two statements, `const` binding and all, in
the deepest shell every caller crosses. It asks the same blunt verdict over the same homes, so a typed
invocation refused at the boundary never reaches it and never prints twice. Unlike the boundary it does
not exempt `--help`: only the boundary answers help, and `-h` can be another flag's value. A caller running over another
home wraps its work in `withCallerGateHomes` — `automation run-due --home <dir>` does — so a body handed no
`--home` still reads that home's gates. `run-due` also points `$SLOPWEAVER_HOME` at `<dir>` for the tick
(`runUnderHome`, `src/homeDir.ts`), so the verbs it runs RESOLVE that home too, and keeps the environment's
original home as a caller gate home, so a ruling standing there still judges them; a verb child and a metrics
producer receive both through `SLOPWEAVER_CALLER_GATE_HOMES`, which only adds gates. A nested tick, run as
such a child, judges its rows against every home handed to it as well as its own two, and refuses the tick when
that hand-down cannot be read.

`src/__tests__/unit/cli/inProcessRulingGate.test.ts` holds that to the AST: a NEW in-process path into an
ungated body fails the unit lane the day it is written, a call through a namespace import included. What its
scanner does not see — a helper taking parsed values, a namespace object handed on whole, a re-export — is
stated in `src/__tests__/inProcessVerbPaths.ts`'s header.

## A ruling about what a message CARRIES is a proof rule, not a gate

A gate refuses a verb, a subject or a window whole. A ruling about the CONTENT a verb must carry would refuse every
legitimate use of the verb along with the bad one, so it is built as a schema-level proof rule that the verb reads
at every seam instead. The owner's standing rule is that shape. A first message in a
channel, any author, carries an annotated, unobstructed screenshot and its link, or `slack draft record` refuses it,
the Queue sends it back unseen and the release refuses it:
[receipts](../../slack/reference/receipts.md#a-first-message-in-a-channel-leads-with-an-annotated-screenshot-and-its-link).
Record such a ruling with `handover rule` and no `--gates`. The advisory nudge is correct there, because the code is
what bites.

## Refused until the owner permits it is a ruling half, not a gate

A gate refuses once recorded and fails OPEN, so it cannot express "refused until the owner says yes". `github attach
upload` is that shape: `handover rule … --attach-upload permitted|refused` records the owner's word as a half of the
ruling, the latest live one on the install decides, no ruling and an unreadable one both refuse, and a later ruling of
the other verdict reverses it, so there is no release to record and it never enters `ruling-gates.json`
([attachments](../../github/reference/attachments.md#attach-upload-is-closed-until-the-owners-ruling-permits-it)).

## Verbs that can never be gated

`UNGATEABLE` (`src/handover/rulingGate.ts`) is frozen: `handover rule`, `handover gate`, `handover list`.
Gating any of them would wedge the register — there would be no verb left to record a ruling, lift a gate or
read the board. `handover rule --gates "handover rule"` exits 2 and says so, rather than recording it.

**It is held on the READ side too, and that half is the invariant.** The flag refusal is the loud, early
one, but `$SLOPWEAVER_HOME` is shared, hand-editable JSONL and `rowEventSchema.ts` checks a gated pair's
SHAPE rather than its membership — so a `ruling` line naming `handover gate` can reach a journal without
ever passing the flag parser, and there would then be no verb able to lift it. `standingGatesOf` drops such
a gate, WHOLE, exactly as `parseGateSelectors` refuses a `--gates` value whole.

## Reading, releasing and repairing

```bash
slopweaver handover gate list                 # what stands, and what is in force right now
slopweaver handover gate check                # does the projection agree with the journals? never repairs
slopweaver handover gate rebuild              # reproject from the journals; idempotent
slopweaver handover gate release <gate-id> --anchor <where> --words "<the owner's words>"
```

**A release goes through even when the journal does not fully decode**, and that is the one carve-out in
`rowEvent.ts`'s rule that every ruling needs a readable journal. The gate keeps firing off the lines that
DID decode, so refusing its only lift leaves a permanent refusal — measured with one appended
line of a kind the build had no case for. A release that places no gate and reconstructs
nothing claims nothing those unreadable lines could contradict.

**A release is the owner's word too.** `gate release` appends a `ruling` event carrying `gateReleases: [<id>]` on the
gate's own row, so lifting a refusal is as anchored and as journalled as placing one. There is no flag that
lifts a gate without an anchor and the owner's words.

**A gate has NO escape hatch and no environment override**, and the refusal says so — `hold` is the
precedent. The only way past is a release.

## The projection, and why it fails OPEN

MEASURED on one machine: `slopweaver --version` 4.1s; a board scan adds 6.4s; walking every
journal under `runs/` is 728ms and growing (11 MB across 2,144 journals, against 52 MB and 2,678 rows on the
board). Reproduce with `time slopweaver --version` and `time slopweaver handover gate rebuild`. A guardrail
that taxes every invocation by six seconds is one that gets removed, so the boundary reads **one small
derived file**, `$SLOPWEAVER_HOME/ruling-gates.json`, written by `handover rule` and `handover gate
rebuild`. The journals stay the source of truth; the file is a cache with a schema version.

**An unreadable or absent projection lets the verb run.** That is deliberate and it is the honest failure
direction for a mechanism installed ahead of the entire surface: a corrupt cache that bricked every verb on
the machine would be a far worse outcome than a missed refusal, and `gate check` is what surfaces the
divergence. Say it out loud rather than discovering it.

**The boundary reads the environment's home ALWAYS, and an argv `--home` only ADDS** (`gateHomes`,
`src/cli/rulingGateDoor.ts`). It runs before the verb parses its flags, and `slopweaverHome()` answers from
the environment alone — measured while building this, a `--home <dir>` invocation read the operator's
projection and let a gate in `<dir>` straight through. Reading only the argv home was the opposite hole (audit
finding 04): `--home <empty>`, or a `--home=` token riding in as another flag's value, re-pointed the read
at a home with no rulings. So both projections are read and unioned, and a misread token costs one extra file
read, never a dropped gate.

## Two properties the writer and the reader both hold

**A reconstruction authors no refusal.** A `ruling` event carrying `backfilledFrom` cannot place or lift a
gate: the write schema refuses it, and `standingGatesOf` projects from live rulings only. A backfill can
neither manufacture a permission nor revoke one — the same property `latestFindingRuling` already holds.

**A gate is ORIGIN, not authority.** It is the owner's recorded word made to keep biting, exactly as
[journalled-grants.md](../../../.claude/rules/journalled-grants.md) describes a row: another process on this
machine could write one, and the protection is partial on purpose. What it removes is the chair's memory as
the sole carrier of a constraint the owner already stated.
