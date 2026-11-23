# The pre-planning name step — which spelling the corpus actually holds

Runs BEFORE the Haikus launch, on the wave [detective-fanout.md](detective-fanout.md) plans. The rule: when the
person a question names is ambiguous in free text — no tag, a first name only, a possible misspelling, a
nickname a thread uses — probe counts across name variants with the store verbs, treat zero hits as the wrong
spelling and try another, look for nicknames and alternative forms, then size the leads on what the probes turn
up. Good judgment, no dumb rules. Ids are never ambiguous.

It is NOT a correction of the exact match, which was the correct first behaviour; the widening is the next
step. The ladder stays exactly as it is; this adds a step in front of it.

## How to run it

You supply the forms. The verb probes them beside the question's own keywords, classifies the counts, sizes
the leads on whichever form carries, and copies the verdict into **every** brief:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store detect "<the question>" --term "<keyword>" --ask <channel>/<messageTs> \
  --name "<the name as the question wrote it>" --variant "<another form>" --variant "<another>"
```

`--variant` without `--name` is refused — a variant of nothing would be probed as an ordinary keyword while
looking like a name step that ran.

## Judgment is yours, and there is no table behind it

`src/detective/nameProbe.ts` holds **no nickname list, no edit distance, no soundex**. Every one of those is
the dumb rule this step avoids, and each would have missed one of the two cases below. Read the thread, the
roster and the store, and propose the forms yourself:

- the other spelling of a near-miss (`quillen` / `quillin`);
- the surname on its own, and the full name as one quoted keyword;
- a nickname the channel uses — find one with `store groups --facet author` on a form that DOES carry, or by
  reading `around` a record that already mentions the person;
- what a voice-to-text transcript would have made of it, which is rarely anything a speller would guess.

## The two measurements that made it a step

Both on a live store of a couple of million rows. The names are synthetic stand-ins for the measured
ones, so each command reproduces the probe's shape on any store, not these counts:

| asked     | the corpus holds           | `exact` asked     | `exact` held | reproduce                                    |
| --------- | -------------------------- | ----------------- | ------------ | -------------------------------------------- |
| `quillen` | `quillin` (Thomas)         | dozens            | thousands    | `slopweaver store probe quillen quillin`     |
| `ada`     | `aida loveless` (Lovelace) | tens of thousands | a handful    | `slopweaver store probe ada 'aida loveless'` |

The first is the case a "did it find anything" check cannot see: `quillen` is not empty, it is a DIFFERENT
and larger population, and the first live wave sized every per-source slot off those few dozen rows of **other
people**. The second is a meeting transcript rendering Dr Ada Lovelace as "Doctor Aida Loveless" — neither the
given name nor the surname survived it, and only a form nobody would guess from the spelling reaches the
record that answers the question.

## What the verb decides, and it is only two things

- **An id is never ambiguous.** A `<@U…>` mention, an email address, a uuid, a `dd:` event, a URL, an issue
  number: `--name <an id>` runs no variant probe and says so on one line. Probe it directly instead.
- **Empty at every rung is a SPELLING, not an absence.** A form nothing matched is reported as one nobody
  has found yet, never as a person who is not there. When every form is empty, the finding tells you — and
  every detective in the wave — to propose another before believing any absence.

Everything else is counts you read. A form's row carries its narrowest non-empty rung and its `exact` count,
and `lexeme-blind` means the tsvector holds nothing while a substring rung does — the name is living inside
email addresses, `<@U…|handle>` mentions and URLs, which is the 98.5% case the ladder exists for.

## The other half: who the ROSTER says they meant

The step above probes the CORPUS for a spelling. It cannot tell you who a misspelling refers to, and
the rule for that half is to hand the whole identity roster to a haiku sub-agent, never a list of alternative
spellings: it narrows the roster to who the token most likely refers to, so the roster never enters the single
context window of the agent doing the work.

**Spawn the sub-agent and have it run the verb.** That is what keeps the roster out of your context — you
send a token, it sends back one key:

```text
Run: slopweaver identity narrow "<the token>" --question "<the question>" --asked-by "<who asked>"
Follow the brief it prints. Answer with exactly its two lines.
```

Then check the key it picked, which is never yours to trust on sight:

```bash
slopweaver identity narrow "<the token>" --answer "PICK <key>"   # refuses a key the roster does not carry
```

A valid pick is re-run through the EXACT ladder, so what you get back is a real resolution with its
org-status refusals intact. MEASURED on the live store: `Tom Quillen` reaches Thomas Quillin
(`slack:U0SYN000030`) and `Dr Ada` reaches Ada — the second is a title plus a given name, which no
edit distance reaches at all.
