# An alignment-briefing row — the owner's weekday morning, a step ahead of the owner's manager

The owner's ruling: a briefing early in the morning that anticipates what the owner's manager will expect or look for by
the end of the day, so that, in the owner's words, in the morning, the owner basically has some kind of goal about what
the owner is going to have done by the end today.
`alignment-briefing-weekday` is the declared row ([declared rows](declared-rows.md)): 08:00 the owner's time, Monday to
Friday, reading `handover currency --json`.

**One page and one card, nothing sent.** The seat writes nothing to Slack, Linear or Vanta. Every write the page
proposes is held for the owner's yes, and the act-first list is a list the owner picks from, never a licence (the
owner's word).

## The order is the contract

You were seated with ONE command, `slopweaver automation run-due --recipe alignment-briefing-weekday --claim-id <token>`.
**Run it LAST**: it settles the firing.

1. **Finish what the owner already answered.** An `alignment-briefing-<date>` row back in `RUN NOW` carries the
   owner's pick: read it with `slopweaver handover row --slug <slug> --json`, prepare exactly the items the owner
   named (each still held for the owner's yes), and settle it. An earlier `alignment-briefing-` card still unanswered is folded into today's page and
   withdrawn once today's is carded (`slopweaver handover withdraw <slug> --why "<today's slug> supersedes it"`),
   so the cards never pile up; one the verb refuses is named in the board row.
2. **Read every source live, to exhaustion** (below). A source you could not read is a named gap on the page,
   never left out, and a section with nothing in it says "none found" only when its read succeeded.
3. **Compose the page** (below), check every number by machine, publish it, card it.
4. **Settle.** Run the claimed `run-due`, then answer in the board row with the page address and the card slug.

Four investigations that do not depend on each other — held items, Linear, ISO and Vanta, the manager and the
meetings — are worth reading in parallel. Re-check a sample of what any helper reports before it reaches the page.

## What to read

- **Held on the owner's permission.** `slopweaver handover currency --json` (the row's own run), `slopweaver slack draft
list`, then `slack draft show <id>` and `slack read-thread <link>` for each draft: who has not replied, since
  when, and the owner's latest word on it (the `held — not-the-owners-yes` line). `slopweaver hand list` for steps only the
  owner can take.
- **Linear.** Every issue in the projects the owner leads (`slopweaver linear issues --project <url> --json`), each read with
  `slopweaver linear read <url>`: state, due date, estimate, priority, last comment, linked threads. Projects the
  owner's standing rule covers carry effort and done-by dates, so a missing due date is a finding.
- **Programme threads.** `slopweaver slack channel-view` on the programme's own channel, the consultants'
  channel and the security channel, then `slack read-thread` on each thread active in the last two weeks: moving, stalled (on whom,
  since when), or done. `slopweaver slack awaiting` and `slopweaver slack owed` for the asks gone quiet.
- **Compliance.** Read the live posture with `slopweaver atlas vanta controls-evidence --json` and `atlas vanta
control-evidence --control <id>` per control not yet complete. Never re-sync from this seat.
- **The owner's manager and last week.** The owner's DM with the manager (`slopweaver slack read-thread` on its threads), last
  week's meetings (`slopweaver calendar list`, huddle notes with `slopweaver slack read-file`, the Notion meeting
  pages, Fathom), and any ChatGPT chat in the corpus about how the owner works. Pull out what the manager asked for,
  what the manager pushed back on, and which action items of the owner's are still open.
- **Yesterday's briefing.** Read it, but never copy a conclusion forward without re-reading its source.

## The page

Slug `alignment-briefing-<YYYY-MM-DD>`, a fragment under `$SLOPWEAVER_HOME/pages/<slug>/`, published with
`slopweaver page publish <slug> --page <fragment> --review <id>` after the review `page review-prepare` prints
([page](../../page/SKILL.md)). It opens on what was noticed,
never on a pull request, and carries, in this order:

1. **The lede and the goal line.** One paragraph on where the day stands against what the owner will be asked, then
   one callout: what the owner would have done by the end of the working day. Mark the page's one question `data-card="question"` and its lean
   `data-card="lean"`.
2. **What the owner's manager will probably notice is missing:** Linear (no update posted, issues due today still Todo,
   no due date, no comments, threads not linked, cruft in the projects), the work the owner is shipping, and every ISO
   thread with the ones stalled on the owner listed deadline first. The rest folds.
3. **Act first, ranked.** Every held item in one table: the act in one line, the evidence (who, since when, the
   link), and a band. `could act` is an item the decision's owner already said yes to, or a reply in the owner's
   own thread to people already in it. `ask first` is a new audience, a policy call or an unproven claim. `drop` is
   superseded or moot.
4. **Compliance.** The one number to chase (controls to flip for the gate), the buckets with their controls, and
   the owner's actions ranked by controls each one flips. Never two numbers the owner would have to subtract.
5. **Out of the box.** What the manager's DM and last week's meetings imply for today that the sections above do
   not already say, each line anchored to its source.
6. **A fold for sources and gaps.**

Before publishing, sum every bucket and count every list by machine, against the totals the page states.

## The card

```bash
slopweaver handover register --slug alignment-briefing-<YYYY-MM-DD> --repo slopweaver --workspace team \
  --workspace-because "the owner's own day's alignment with the owner's manager" --priority p1 --asked-iso <now> \
  --ask "Do you want today aimed at the goals on the page, and which act-first items should the fleet prepare?" \
  --problem "<the lede's one sentence>" \
  --options "aim at the goals and prep the top act-first items :: each prepared item still waits on your yes
aim at the goals only :: you take the act-first list yourself
name your own picks :: exactly the rows you name are prepared" \
  --lean "…" --risk "<the nearest deadline>" --blast-radius "<what the prepared items would touch>" \
  --still-real "every source read live at <now>" --example "<a scene from the owner's day, ending on the question>"
slopweaver handover artifact alignment-briefing-<YYYY-MM-DD> --url <the address publish printed>
```

The question opens the `--ask`: a card whose first two sentences ask nothing is refused.
