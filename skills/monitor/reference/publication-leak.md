# `publication-leak`: something already published carries what the outbound privacy check refuses

The outbound doors refuse a private term, an installation id or a hygiene hit BEFORE a write. This monitor is the
other half: what went out before those doors existed, or past them, read back as it stands now. It is the
prerequisite for taking the repository public.

## What fires it

The last `slopweaver audit publications` report (`$SLOPWEAVER_HOME/evidence/publication-audit/latest.json`). The
verb reads four doors, in order, each through its own read seam, and judges every text with the same `checkPrivacy`
the write doors run, strict audience:

- **GitHub**: every pull request, issue, issue comment, review and review comment on the repository.
- **Slack**: every message a guarded Slack write settled in the placement journal (`live/slack/placementJournal.ts`),
  read back as that exact message now — its raw `text` and its block and attachment prose, never the replies around it.
- **Linear**: every issue, document, project, comment and project update the `linear` write ledgers record, read by
  its confirmed address; a comment or update is found by its exact id, and only its own body is judged.
- **Notion**: every page the page ledger confirmed, created or adopted — its title and its whole block tree's prose.

Each object and class is one finding: a class (`installation-state/<kind>`, `hygiene/<label>`, `private-term/<class>`),
a door, a link and a coordinate-only id. The matched text is never in the report, so nothing downstream can carry it.

**On a schedule, once switched on**: the standing row `publication-audit-daily` (`45 5 * * *`) is declared OFF until
the owner says, and when on it runs `audit publications --fire`, which
runs this monitor's pass over the report it just wrote, whatever it found — inside the visible session that claimed
the row, never a daemon ([declared rows](../../automation/reference/publication-audit-row.md)).

## What the owner sees

- **One card per finding**, `work`, floating: `Edit or delete the published text at the link below — it carries leak
class <class> on <door>`, the link cited. Whether to edit, delete or accept (a pull request ABOUT session ids may
  quote one on purpose) is the owner's judgement about their own words in public, so the card asks rather than acts.
- **A link that itself matches a rule is withheld**, and the card says so instead of printing it.

## When it fires and settles

- Read on any `monitor check` pass that includes it; `audit publications --fire --by-session <s>` runs it after a run.
- Settled when a COMPLETE run no longer finds that class on that object. A run that read any door only partly
  keeps every open card (`preservesDepartures`), and a partial run with no finding is `unmeasurable`, never clear.
  The rule is report-wide, not per door: while any door carries a standing gap (GitHub's unread uploads, Linear's
  attachment writes) no card settles by itself, even one whose own door was read whole. It stays open until the owner
  settles it.
- **A door with no credential, or one it could not read whole, is `partial`**, naming a fixed gap (`credential
missing`, `message not found or not visible`, `object ceiling reached`, …) and never a provider's message; the
  other doors are still read. A message or object the read cannot find may be deleted or merely invisible to the
  token, so it is a gap, never a clear. An earlier report's `not-swept` door holds no finding and blocks nothing.

## What it cannot see

Uploaded files are counted (`attachmentsNotSwept`) and never read: a text check cannot judge an image. The Slack,
Linear and Notion inventories start at each write journal's first row: what the fleet posted before a journal
existed, and anything no journalled verb wrote (a Slack canvas, a status, channel metadata), is outside the audit's
declared scope rather than a gap. A Slack placement that was `held` may have posted a repair cross-link the row does
not record, so any held row is a fixed gap. `linear attach upload` keeps no per-object ledger, so Linear carries
`attachment writes not inventoried` on every run and is never `complete`; its labels, initiatives and milestones are
`<family> not swept` when any exist. An absent or malformed report is `unmeasurable`. Declared and evaluated
in `src/monitor/publicationLeak.ts`; the verb is `src/cli/commands/audit/publicationsRun.ts` (its production door
reads `publicationsDoors.ts`), the doors `src/live/publicationAudit/{github,slack,linear,notion}Reader.ts` with the
Linear and Notion seams in `{linear,notion}Seam.ts`, the store `src/live/publicationAudit/store.ts`.
