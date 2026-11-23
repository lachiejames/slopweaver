# A corrected page shows where the corrections are

Bundled reference for the `supervisor` skill. Loaded when a page the owner has ALREADY READ is about to be
republished — the fleet briefing every sweep, and any reaction artifact a ruling has moved.

## What the owner asked for

When the owner reads a briefing, reacts to it and is then asked to react to the corrected one, it is very difficult
to tell where the corrections are; that cost grows over multiple rounds of reacting. Every ruling stamps a corrected page, so this is the common case rather than an edge one.

## The two verbs, in the order the seat runs them

```bash
slopweaver briefing freeze --artifact "$(cat <id-file>)" --page <html>  # after EVERY publish, no exceptions
slopweaver briefing corrections --artifact <url|id> --page <html>       # before the NEXT one, stamps in place
slopweaver briefing check <html>                                        # the gate, as always
```

**Read the id from a file; never type it and never copy a previous tick's line** — rule 4 below is the
incident that made that a rule. `--new` is the opener for a page that genuinely has no history yet, and a
freeze onto an id holding no version REFUSES without it.

`freeze` writes the exact bytes that reached the owner into the published-page store as a version of `<id>`, named
by their own `sha256`, and nothing on disk; a store failure fails it (re-run the same freeze to complete it). `corrections` diffs the next version against the store's newest freeze and writes the marks onto
it — a `changed`/`new` rule down the left of every moved block, a jump strip beside the eyebrow, and
`3 changed inside` on any collapsed section holding one. `--previous <html>` names a file instead of the
freeze, for a page the store holds no freeze of.

**A first publish has nothing to mark and that is correct.** `corrections` refuses with the `freeze` command
to run rather than stamping an empty claim, and `briefing check` reports `not stamped` rather than a defect.

## Four rules, and each one is a defect that already happened

**1 · The marks are COMPUTED, never remembered.** A page was once hand-marked with `chosen` / `not taken` /
`answered` tags. The publisher checked them by diffing the file against the published bytes and
they matched — but that check lived in the seat, not on the page. Had the author forgotten one edit, the
page would have said "changed in three marked places" while carrying four, and nothing on the page could
have said so. Never hand-write a mark; run the verb.

**2 · Freeze every publish, or the next correction cannot be made at all.** A page once had no source file on disk, so stamping one paragraph of the owner's ruling onto it meant reconstructing ~30 KB
of HTML from the published copy — the move most likely to introduce a silent transcription error, on a page
whose whole subject was a defect nobody could see. That page was left unstamped and its ruling stayed on the
row. Freeze is one command and it is what buys the option.

**3 · Never publish a second page.** The owner asked for the corrections to be findable ON the page, not for a
diff document beside it. There is one page and one URL.

**4 · The artifact id is STATE, not a constant in a script.** MEASURED: each tick's publish tail
was derived by `sed`-ing the previous tick's script from N-1 to N, and the fleet-briefing id
(`<uuid>`) carried the digits `259`. From tick 259 the substitution rewrote the
ID ITSELF — `…642592` → `…642602` → … — so **33 ticks froze into 48 fresh directories** holding one version
each, while the canonical 568-version history stopped dead at tick 258 and nothing said a word. Keep the id
in a file the tick's own edits never touch (`$S/artifact-id.txt`) and read it with `$(cat …)`. The freeze
refuses an id with no prior version and **names the existing keys within two characters of it, with their
version counts** — a neighbour holding 568 versions is what ends this on the tick it starts, rather than 33
ticks later. `--new` is the opener when a page really is new. Never reach for it to silence the refusal.

## What the gate checks, and what only `--verify` can

`briefing check` reads the page alone, so it checks every claim the page makes about itself: the strip's
count equals the marks actually on it, every jump lands on an element that exists, and the strip names the
`sha256` it compared against. A hand-edited strip fails all three together.

It cannot know whether the marks match a REAL diff — that needs the version the owner read. `slopweaver briefing
corrections --page <html> --artifact <id> --verify` recomputes and exits non-zero when the page's marks and
the diff disagree. Run it when you did not stamp the page yourself.

## What the marks are computed over

A **spot** is a block the owner's eye lands on: a heading, a paragraph, a list, a react-now card, one of the owner's rows, or
a fold's summary line. A card stays atomic — it is the unit the owner reacts to, and naming which of its fields
moved would be finer than the decision. A **fold does not**: the scan descends through it, so a correction
three folds deep gets a mark of its own, and every collapsed section above it says how many changed
underneath. Measured on one pair of consecutive briefings: reading each outermost `<details>` as one block found 19
spots on a 190 KB page, one of them spanning 100 KB; descending found 84.

The eyebrow is skipped by name. Its two instants move on every single republish, so a page marked against it
would report a correction every time and the marks would become the noise they exist to remove.

**Stamping is idempotent.** The verb strips the previous round's marks off both sides before comparing, so a
third round of reacting diffs content against content rather than against last round's highlights.

## Two neighbours of the same class

- **A card authored from memory of its page drifts from it.** A briefing card once asked four
  questions the page does not ask; another carried lean B where the page's lean was A. The owner's reply — go
  with your lean — then answered the CARD, and one lock-in was stamped B before the owning session caught it
  against the published file. Neither end could see it — both read coherently, only side by side did they
  diverge. Read a card's question and lean off the page you are pointing at, never off your memory of it.
- **Relay an option's TEXT, never its letter.** One card's A was "nothing more"; the page's A was
  "rule every unruled finding as a class, releases 81 rows". Relayed as "A", it would have laundered 81
  team-facing pull requests through one ambiguous letter. Both surfaces letter from A, so a bare letter is
  never safe to carry between them.
