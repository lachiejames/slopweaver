# The sweep cycle — arm the contract by reference, never by retyping it

**A cadence that lives in one session's memory dies with that session's hiccups.** A running supervisor once
armed `ScheduleWakeup` by hand each tick, re-issuing the sweep prompt itself — it worked for hours, then one
wakeup silently never fired (most likely dropped across an owner `/login` account switch), and nothing noticed
because the wakeup was the only thing that would have. The owner caught it by hand, hours later. So this is the
skill's own contract rather than something to remember: arm it, and every subsequent tick re-arms itself.

**The steps themselves are NOT here.** They are in [sweep-contract.md](sweep-contract.md), which is the single
copy, under the `agent-doc-size` cap and the canon stale-reference ratchet. This file is the rule about arming;
that file is what gets armed. A second copy of the procedure is exactly the failure both files exist to end.

## Arm it on your very first turn, right after the § 2 briefing

**Unless one Claude plan stands.** Then the chair runs lean ([model-tiering](model-tiering.md)): `sweep-prompt`
prints nothing and exits 3, `tick close` prints no re-arm, and the chair arms no wakeup — it runs on the owner's
next turn or a seat's message.

Before waiting for the owner to say anything:

```bash
slopweaver supervisor sweep-prompt --budget                            # what may this tick's state run to?
slopweaver supervisor sweep-prompt --shift "<this tick's shift state>"
```

Pass the render's output verbatim as the `prompt` of
`ScheduleWakeup({ delaySeconds: 1200, prompt: <that string>, reason: "recurring supervisor sweep" })`. The
rendered prompt names the contract file by path, so the wake-up re-enters by READING the standing half rather
than by carrying a copy of it. `--shift-file <path>` and `--shift-file -` take the shift state from a file or
stdin when it is long enough that a shell argument is awkward — but never both flags at once.

**A NAMED shift source that yields nothing is a refusal, never a quiet tick.** That covers all three
spellings: a `--shift-file` that cannot be read, one that reads clean and is empty, and `--shift ""`. Naming a
source says this tick HAS state, so an empty one is a broken pipe or a mistyped path, and arming a wakeup that
announces a quiet tick would report it as a deliberate choice. **A tick with genuinely no state of its own
passes no shift flag at all** — that, and only that, renders the quiet line.

**An over-budget shift state OVERFLOWS; it is never trimmed by hand.** The cap is on the RENDERED prompt;
what a seat writes is the shift state, and the budget is the cap less this verb's own frame — 631 words as the
contract path stands, printed by `--budget`. Past it, both `sweep-prompt` and `tick close` keep the longest run
of whole sentences that fits, end it with `[… N more words — the whole shift state is <path>; read it beside the
contract this tick]`, and write the whole state to `$SLOPWEAVER_HOME/supervisor-scratch/<scope>/shift-overflow-<sha256>.txt`
(scope `sweep`, or the seat's handoff for `tick close`) before printing. A wake whose prompt carries the pointer
reads that file. MEASURED over one chair's ticks 14–44: the refuse-then-trim lap was 57 of
75 shape refusals, 3.1 extra API calls a tick re-reading 531,928 prompt tokens a tick
(`src/supervisor/sweepPromptOverflow.ts` carries the repro).

**Three refusals, all measured, all returned together** so one run names the whole invocation
(`src/supervisor/sweepPrompt.ts` carries the numbers and their repro):

- A shift state **whose overflow pointer cannot fit the budget by itself** is refused, naming the path. Only a
  scratch path longer than the budget reaches it.
- A shift state that names a **STANDING step** — `session watch`, `handover reconcile`, `fill-to-cap` and the
  rest — is refused, naming the step. That is the contract being retyped into the prompt.
- A shift state that names a **command-line option** is refused, naming each one. It asks whether a
  whitespace-delimited word IS an option once quotes, brackets and markdown emphasis come off either end —
  never whether one sits inside a URL, which is why `https://logs.example.com/search?q=--timeout` and a
  `mailto:` are silent without a line of code about either, while `_--tick-id_` is caught. That criterion is
  LEXICAL, so what it costs is a policy choice and all three classes are stated rather than discovered: an
  option carrying a non-option character INSIDE it is not reported — other ASCII text abutting with no
  whitespace, or a non-ASCII character in the body — nor is one an ODD leading hyphen run merged with
  (`---tick-id`), the run being consumed a pair at a time so that an even one (`----tick-id`) leaves the
  opener standing and IS reported. A token whose punctuation all sits at its ends is reported too, however it was
  meant — a dot-slash-prefixed `--out` reads exactly like a bracketed one, and nothing lexical separates a
  path from a decorated option. A URL lands here too when it strips to one, and that is the whole of what
  can be said about URLs: three drafts each tried to name a URL-shaped reason for a silent one and a URL the
  criterion already handled falsified each, so state the criterion and stop — a URL is reported exactly when
  one of the whitespace-delimited TOKENS it falls into strips to an option. A literal tab inside one is a
  boundary like any other ASCII whitespace, so the tail after it takes that same test —
  `?q=<TAB>--timeout` reports and `?q=<TAB>--timeout&from=now-1h` does not — and a silent token is silent
  for whichever class above its stripped form falls into. Separately from all three, the pattern is a GRAMMAR and not only an alphabet, so a token built
  entirely of option characters can still fail it — `--tick--id`, `--1x`. A parser would take both, so this
  is narrower than parseable on purpose, and what sets the width is this CLI: EVERY option literal under
  `src/cli/` matches it, none excepted. The total moves with the tree and nothing depends on it, so the
  repro on `flagTokensIn` counts the ones that FAIL and that number is 0. The misses are the side to fail on, because this drives a REFUSAL and a false positive
  rejects a blameless prompt. Which flags a verb takes is
  standing procedure, and it already lives in [sweep-contract.md](sweep-contract.md),
  [derived-narrative.md](derived-narrative.md) and [verbs.md](verbs.md). MEASURED by the matcher that ships
  today over the 25 shift files shift-335 through shift-359 — the sample, not the 31 ticks the word-cap
  figures above come from: every shift state carried 7 to 10 distinct option tokens, and the sentences
  holding them (split on `/(?<=[.!?])\s+/`) ran **219 to 356 words a tick**, 33–57% of the whole thing,
  hand-copied forward tick after tick while canon already held it. Delete those sentences and the per-tick
  state that remains measures 268 to 449 words. A count is its matcher's output — re-measure after changing
  one, never quote this; the runnable repro is on `flagTokensIn`, `src/supervisor/sweepPrompt.ts`.

## Re-arm on every tick

Same call, carrying the prompt `supervisor tick close` prints LAST (rendered from its `tick.json`'s `shift`),
same 1200s by default — `noop: true` when the sweep found nothing worth reporting, `false` when it
did. Shorten to ~300s only while the queue is non-empty and the fleet is under cap, or while actively waiting
on fast-changing external state; never shorter just to "keep warm". **The one tick that does NOT re-arm** is one whose
`tick close` printed HAND OFF THIS TICK — its last line is then the hand-off, not a sweep prompt — and that seated a
successor: the successor takes the pin and arms its own sweep, and a second armed chair would sweep the fleet twice.
A spawn that refused re-arms the HAND-OFF prompt, so the next wake tries again.

**If the wakeup ever fails to fire** — the owner notices a gap, or a tick lands far later than scheduled — say
so plainly, re-arm immediately, and record the gap in the state doc (SKILL.md § 4). A silent gap is the failure
this section exists to prevent; a late tick that gets flagged is the contract working.

## What belongs in the shift state, and what does not

Shift state is what changed: the merge queue, in-flight workspaces, standing orders for this shift, the ready
queue, the depth line, a deadman deadline. **A standing rule is not shift state** — it belongs in
[sweep-contract.md](sweep-contract.md), and the state doc's own caps ([state-doc.md](state-doc.md)) say the
same thing about a boot block. Measured: fourteen rules present in the sweep prompt at handoff 32
were absent by handoff 36 while still true, dropped purely by hand-copy attrition.
