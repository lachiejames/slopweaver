/**
 * `slopweaver incident`'s usage lines, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/incident.ts` reads these strings on EVERY invocation, because `--help`, `catalog`
 * and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. The command modules
 * import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** `slopweaver incident detect`'s usage. */
export const INCIDENT_DETECT_USAGE =
  "usage: slopweaver incident detect [--since <iso>] [--now <iso>] [--home <dir>] [--json]\n" +
  "  Judge every Slack channel the corpus holds, at its newest capture, as the live sweep would: which are\n" +
  "  incident channels (`inc-<date>-<slug>`), which are drills that name themselves, and when each opened.\n" +
  "  READ-ONLY: it registers nothing. Registration is the scheduled recovery sweep's alone\n" +
  "  (the scheduled `listen recover`), off LIVE discovery, so a stale corpus can never open a row.\n" +
  "  --since <iso>   only channels opened at or after this instant (default: every incident channel).\n" +
  "  --now <iso>     judge the live window against this instant instead of the clock.\n" +
  "  --json          one JSON document: every incident and drill channel, its verdict and its evidence.";

/** `slopweaver incident note`'s usage. */
export const INCIDENT_NOTE_USAGE =
  "usage: slopweaver incident note --form <file.json> [--dry-run] [--quiet] [--json] [--home <dir>]\n" +
  "                                [--by-session <name>]\n" +
  "  Post an incident investigation's ONE floating note: 2–3 verbatim channel quotes with permalinks above\n" +
  "  the fold, root cause and impact with Datadog citations and screenshot, and one question — share with\n" +
  "  the team, yes or no. Nothing is posted to Slack: both cross-posts are PARKED drafts the card names.\n" +
  "  A re-run for the same channel AMENDS the note: the next revision supersedes the open one.\n" +
  "  Status reads SOLVED only with telemetry clear AND a customer confirmation; telemetry alone is not it.\n" +
  "  --form <file>   the write-up (skills/incident/reference/note-form.md names every field).\n" +
  "  --dry-run       admit against this home — row, drafts, posting rules — then record and draw the note\n" +
  "                  from a THROWAWAY register, so their queue never holds it. Prints that register's home.\n" +
  "  --quiet         record without drawing the note.\n" +
  "  Only the pinned supervisor posts (as `hand post`); --dry-run posts nothing and is open to any seat.";

/** `slopweaver incident postmortem`'s usage. */
export const INCIDENT_POSTMORTEM_USAGE =
  "usage: slopweaver incident postmortem --form <file.json> [--dry-run] [--quiet] [--json] [--home <dir>]\n" +
  "                                      [--by-session <name>]\n" +
  "  Post the ONE Queue card asking whether to send the reply that gets them into a resolved incident's\n" +
  "  postmortem: it opens the briefing page, carries 2–3 verbatim channel lines above the fold, and asks one\n" +
  "  question. Nothing is posted to Slack: the reply is a PARKED draft in their voice, in the incident channel,\n" +
  "  tagging whoever runs the postmortem, raised by the card's `postmortem-<channel>` row — refused otherwise.\n" +
  "  A re-run for the same channel AMENDS the card: the next revision supersedes the open one.\n" +
  "  --form <file>   the card (skills/incident/reference/postmortem-form.md names every field).\n" +
  "  --dry-run       admit against this home — row, draft, posting rules — then record and draw the card\n" +
  "                  from a THROWAWAY register, so their queue never holds it. Prints that register's home.\n" +
  "  --quiet         record without drawing the card.\n" +
  "  Only the pinned supervisor posts (as `hand post`); --dry-run posts nothing and is open to any seat.";

/** `slopweaver incident postmortems`'s usage. */
export const INCIDENT_POSTMORTEMS_USAGE =
  "usage: slopweaver incident postmortems [--json] [--home <dir>]\n" +
  "  List the resolved incidents worth putting a postmortem card in front of them for, off the org-health\n" +
  "  snapshot: resolved in the last 7 days, not Minor, with an incident channel no postmortem card has\n" +
  "  named yet. Each prints the `handover register` flags that raise its `postmortem-<channel>` row.\n" +
  "  READ-ONLY: it registers nothing and posts nothing; the chair picks which, every now and then.\n" +
  "  Exits 3 when there is none, 1 when the snapshot is absent or stale.\n" +
  "  --json          one JSON document: the snapshot's read time and every candidate.";
