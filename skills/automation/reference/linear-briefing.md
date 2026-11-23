# A linear-briefing row — every Linear write the owner should make, briefed once a day

Each day the briefing proposes all the writes the owner should be making into Linear: comments to leave, with
confidence ranking (obvious versus less obvious), tickets that look superseded or stale, and moves back to
backlog. The owner approves the briefing, the seat makes the writes after that approval, and with no approval
nothing is written in Linear. `linear-briefing-daily` is the declared row ([declared rows](declared-rows.md)):
17:30 the owner's time, every day, reading `cycle reconcile --verify` ([cycle](../../cycle/SKILL.md)).

**Read-only until the owner's yes.** The seat writes nothing to Linear. It produces ONE page and ONE Queue card; the
owner's answer applies the writes the owner picked, per item or all. No answer, no write.

**Cumulative, never a window.** The briefing covers everything since Linear last matched reality, so a briefing the
owner never opened loses nothing: tomorrow's re-proposes every item that still stands, recomputed from live Linear.

## The order is the contract

You were seated with ONE command, `slopweaver automation run-due --recipe linear-briefing-daily --claim-id <token>`.
**Run it LAST**: it settles the firing, and its `cycle reconcile --verify --write` refreshes
`live/hygiene/cycle-reconcile.json`.

1. **Finish what the owner already answered.** A `linear-briefing-<date>` row back in `RUN NOW` carries the owner's
   pick: read it with `slopweaver handover row --slug <slug> --json`, run exactly the steps its `## On the owner's word`
   section maps that pick to, and settle it (§ Applying the owner's yes). Do this BEFORE reading, so today's briefing sees those writes.
2. **Derive the floor.** Under `$SLOPWEAVER_HOME/linear-briefing/`, the newest bundle holding `applied-all.json` gives
   `evidenceSinceIso` (its `asOfIso`). No such bundle means `null`: read the whole corpus, with no lookback cap.
   `build` derives the same floor from the sibling bundles and refuses any other.
3. **Read the worklist.** `slopweaver cycle reconcile --verify --json` — tickets that look shipped and projects
   overdue an update, already re-read live.
4. **Read every source since the floor**, to exhaustion — `slopweaver store cite "<question>" --source <s> --since
<floor> --json`, following each lead ([store](../../store/SKILL.md) § Follow the thread): `linear`, `slack`,
   `notion`, `fathom`, `calendar`. Then read each candidate ticket and project live (`slopweaver linear read <url>
--include comments,history`). A source you could not read is a named gap in `coverage`, never left out.
5. **Compose the briefing** (below) and build it. Fix every refusal; never card a briefing that did not build.
6. **Dry-run every step** the build printed. A refusal is an item to fix or drop, never one to card.
7. **Publish and card** (below). Withdraw any earlier `linear-briefing-` card still unanswered first.
8. **Settle.** Run the claimed `run-due`, then answer in the board row with the slug carded and the item counts.

## What to propose

Five kinds, each the exact form its own verb sends, so the owner's yes applies it with no second composition:

| `kind`             | Proposes                                                                                         | Sent by                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `comment`          | a comment the owner should leave, early, naming what is uncertain                                | `linear comment create`                             |
| `state-change`     | a state that no longer matches the work (shipped, started, ready)                                | `linear issue update --fields-only`                 |
| `stale-to-backlog` | a stale ticket out of the owner's cycle: Backlog, `cycleId: null`, `assignee: null`, in ONE form | `linear issue update --fields-only`                 |
| `superseded`       | a ticket another replaced: a comment, an optional edge, an optional close                        | `comment create`, `relation create`, `issue update` |
| `project-update`   | a project's status update, overdue or overtaken by events                                        | `linear project-update create`                      |

Every item carries `confidence` — `high` when the evidence settles it, `low` when it is a judgement the owner may read
differently — a one-line `why` that names the uncertainty rather than waiting it out, and at least one evidence
link. **Push early**: a `low` item worth saying now beats a `high` one a week late ([linear](../../linear/SKILL.md)
§ Push updates early). Never propose a write the owner already made, and never one the live read contradicts.

A state id comes from `slopweaver linear states --team <key>`, never memory; a project update's `overdueSince`
is the worklist's `movedAtIso` exactly ([project updates](../../linear/reference/project-updates.md)).

## Building it

The briefing is one JSON form: `asOfIso` (now), `evidenceSinceIso` (the floor), `zone` (the owner's IANA zone),
`lean` (one line, what the owner would most likely pick), `coverage` (each of `linear-live`, `linear`, `slack`, `notion`,
`fathom`, `calendar` exactly once, `read` true or a named gap) and `proposals`. Item ids are lower-case kebab
(`eng-42-backlog`), because the owner's answer names them.

```bash
slopweaver linear briefing build --form - --out "$SLOPWEAVER_HOME/linear-briefing/<YYYY-MM-DD>" < <the form>
```

A move names its issue by the UUID `linear read <key> --json` prints, never the key. It refuses an
`evidenceSinceIso` other than the floor, validates every embedded form against its own verb's schema and writes `briefing.json`, one `forms/NN-<id>-<step>.json`
per write, `apply.json`, `on-the-owners-word.md` and `page.html`, then names each earlier unapplied briefing it
carries forward (an interrupted one with no readable `briefing.json` too, said so) and prints each step's dry
run. Floor instants order at their full written precision. It reaches no provider.

## The page and the card

```bash
slopweaver page review-prepare linear-briefing-<YYYY-MM-DD> --page "$SLOPWEAVER_HOME/linear-briefing/<YYYY-MM-DD>/page.html" \
  --inputs "$SLOPWEAVER_HOME/linear-briefing/<YYYY-MM-DD>/briefing.json"   # then run the codex review it prints
slopweaver page publish linear-briefing-<YYYY-MM-DD> --page "$SLOPWEAVER_HOME/linear-briefing/<YYYY-MM-DD>/page.html" --review <id>
slopweaver handover register --slug linear-briefing-<YYYY-MM-DD> --repo slopweaver \
  --example "<you open one real item, see what changed, and the page's question>" \
  --workspace team --workspace-because "every write lands in the organisation's Linear" \
  --ask "<the page's question, then one line per item: title (KEY) · kind · id>" --asked-iso <now> --priority p2 \
  --problem "<N> writes would make Linear match what happened since <the floor, in words>." \
  --options "apply all :: every item, in the order the page shows
apply the obvious ones :: only the high-confidence items
apply the ones I name :: exactly the ids in the owner's answer
hold :: nothing is written; tomorrow's briefing re-proposes what still stands" \
  --lean "<the form's lean>" --risk "…" --blast-radius "<N> writes across <M> tickets and projects" \
  --still-real "every item read live at <now>" --anchor "state:linear-briefing/<YYYY-MM-DD>/briefing.json"
slopweaver handover artifact linear-briefing-<YYYY-MM-DD> --url <the page address publish printed>
```

An item line opens on the ticket's title with its key after it: register refuses a line that opens on a bare
key, and a version or advisory number that reads as a section list, so reword that title rather than quote it.
Then paste `on-the-owners-word.md` into the doc, above `## How this ends`. An empty briefing (no proposals) is a clean
firing: publish nothing, card nothing, and say so in the board row.

## Applying the owner's yes

Run the chosen items' steps from `## On the owner's word`, in order, each only once the one before printed `created` or
`updated`. A refusal or an indeterminate write STOPS that item: read its target live before anything else, and
never re-run it blind. Read each landed write back live, then settle `--as answered --witness <every URL printed>`;
a hold settles `--as declined`.

**Only a fully landed apply-all moves the floor.** When every item landed and read back, write
`applied-all.json` into that bundle — `{ "asOfIso": "<the briefing's asOfIso>", "witnesses": { "<step file>":
"<the URL that write printed>" } }`, one entry for EVERY step in `apply.json`. `build` refuses a record that
misses a step, names one never planned, or carries another instant — naming it and reading past it — so a
partial apply cannot certify itself.
It reaches no provider, so it cannot read a witness back: write each URL only after that write's live read-back.
A partial apply, a hold, or an apply with any refusal writes nothing, so the next briefing re-reads the same
evidence and re-proposes what still stands.
