---
name: incident
description: Investigate a live incident unasked and end in ONE floating note asking the owner whether to share it. Use when the board carries an `incident-…` dispatch row (a new incidents.io channel the scheduled recovery sweep found), when seating that row, or when composing, dry-running or amending an incident note with `slopweaver incident note`. Also when a resolved incident's postmortem is worth the owner's seat — a `postmortem-…` row, `slopweaver incident postmortems` or `incident postmortem`.
---

# A live incident, investigated unasked

The owner's ask: during an incident people drop everything to fix it, so it is the moment
they are most receptive to a finding — and a reproduction is a tool they can fix it with. So a new incidents.io
channel starts an investigation nobody asked for, and the owner gets ONE floating note: what the room is saying, what
the fleet found, and one question — share it with them, yes or no.

## How it starts (rule 2: a row, never a model)

`listen recover --scheduled` lists the workspace's channels on every sweep. A channel named
`inc-<date>-<slug>`, opened inside the last 48 hours, not archived, and readable by the token
`slack read-thread` resolves becomes ONE dispatch row `incident-<channel id>` at p1, tagged `context=work`, recorded
in `incidents/seen.jsonl` so no later sweep registers it twice. The slug is the id alone and the tag makes the board
check that slug's journal and archive under its lock, so a rename or an archive mid-race still finds the one row;
with the ledger missing, that row's doc, live or archived, still counts, and one that will not read refuses. Before
the doc, the sweep takes `incidents/claims/<channel id>` exclusively and never gives it back once a row exists, so a
sweep that dies mid-registration leaves a claim with no doc: later sweeps skip the channel, naming the claim, until it
is 30 minutes old, when the next one restamps it in place and registers. A claimed channel stays a candidate past the
window until its row is recorded, and a taken-over claim is never given back on a failed probe or register. A sweep removes a claim only while it
still carries that sweep's own stamp and is under 15 minutes old, so one another sweep could be taking over stays. A probe
naming a workspace that is not a `*.slack.com` link writes no row, since a later sweep could not recognise its ask.
Nothing is launched. A drill that names itself
(`test`, `testing`, `tutorial`, `example` as a name token) is reported in the sweep's `incidents.skipped`, never
registered. `slopweaver incident detect` prints the same judgement over the corpus, registering nothing.

The chair seats the row like any other: `slopweaver cmux spawn <slug> --model opus`. **A private incident
channel the bot is not in is never listed** — invite the bot and the next sweep inside the window finds it.

**A row registered by hand** (an incident older than the window, found from another workstream) takes a slug
starting `incident-`, names the incident's incident.io address or channel id, and opens its summary with WHY the fleet
is looking. `org-health status` reads exactly those rows to say the fleet is looking into an incident, and why
([org-health](../monitor/reference/org-health.md) § Quiet); a row named otherwise is never counted there.

## What the seat does

Read [investigation.md](reference/investigation.md) before the first read. In short:

1. **The channel first**, with `slopweaver slack read-thread` — where the team has got to, who is leading, what
   they have ruled out. Pick the two or three lines that say it, verbatim, with their permalinks.
2. **Then everywhere relevant**, through the doors only: Datadog (`datadog logs`, `errors`, `rum`, `apm`,
   `monitor`), the deploy and pull-request timeline, the bug-report channels and support. There is usually smoke
   before the fire, and people often know the state of the world better than telemetry does. A support
   complaint with no matching error is a lead: work backwards from it into Datadog.
3. **Name the stakeholders** — who is leading, who is affected, who will act. Without them nothing happens.
4. **Root cause and impact**, each settled by evidence: a `datadog shot` of the panel that shows it, and the
   Datadog links as citations. Then ask what the room does not have yet; if nothing, stop there.
5. **Review, then publish the receipts page**: `slopweaver page review-prepare`, the Codex pass it prints, then
   `slopweaver page publish <slug> --page <file> --review <id>` ([page](../page/SKILL.md)): the annotated Datadog shot,
   its link, the quotes, the impact in people. It is what the note's Open button lands on — never the Queue, a CI
   run or a PR: lead with the proof, not with the PR.
6. **Park both cross-posts** with `slopweaver slack draft record`, each opening on the evidence and the
   conversation, never a pull request (refused at record and at send): one for the incident channel, one for the
   related bugs thread a person started, never a bot alert's (or say there is none;
   [who-will-see-it](../slack/reference/who-will-see-it.md)). They are what the owner's yes sends, and they come last.
7. **Write the form** ([note-form.md](reference/note-form.md)), its `proof` the page's slug, prove it with
   `slopweaver incident note --form <file> --dry-run`, and hand the form's path to the chair, who posts it with
   `slopweaver incident note --form <file>` — only the pinned supervisor posts a card.

## The rules that make it an incident note

- **The proof first, the ask last.** The note opens the receipts page, its details open on that page's address, and
  the drafts the owner would send sit at the bottom. Any card on an `incident-` row that opens anything else is refused by
  `hand post` itself (`src/hand/proofLink.ts`), the chair's own included.

- **Nothing is posted before the owner's yes.** No Slack message, no comment — the owner's ruling: no outbound
  action while investigating, and nothing posted to Slack on the owner's behalf.
- **Organisation intelligence, not organisation fixing** (the owner's ruling). The note hands the owner a
  validated finding to decide whether to report: no fix pull request is raised, and none leads a draft or the
  card; whether a fix follows is the owner's word, case by case. The room already discusses the incident, so a note
  exists only for what the fleet ADDS (`adds`: hard evidence the channel lacks); nothing to add, no note. It
  carries a screenshot proving it (`shot`, required) and the Datadog link first in `cites`. An impact the fleet
  cannot measure becomes a question for whoever holds the access, never a stop. It opens on `meaning`, the
  impact in people ("12 people could not complete a signup"), never the mechanism, which sits below. The whole doctrine:
  [rule-10-team-facing](../../docs/doctrine-rationale/rule-10-team-facing.md).
- **Updates AMEND the same note.** A second `incident note` for the same channel is revision `r<n+1>` and
  supersedes the open one; the owner never gets two cards for one incident. Send one on a significant, meaningful
  update — a root cause found, an impact measured, a status change — not on every read.
- **SOLVED needs both halves.** Status reads "telemetry clear since <time>, customer confirmation pending" until
  a support or customer message confirms; telemetry alone never closes it.
- **Quotes are verbatim**, two or three, each with who said it and its permalink. A paraphrase is not a quote.

## Ending

The row settles when the owner's answer lands: `filed` once the drafts are sent on the owner's yes, `declined` on the owner's no,
`answered` when the room had already reached the same root cause and the note only confirmed it. Record what the
investigation taught with `slopweaver knowledge record` before settling.

## After it resolves: a seat at the postmortem

The owner's steer: every now and then, put a Queue card in front of the owner asking whether the owner wants to send a
reply so the owner can go to the postmortem — with a briefing first, so the owner knows what the room is talking about. The
owner's yes sends one reply; the invite is theirs.

- **The chair finds them.** `slopweaver incident postmortems` reads the org-health snapshot: resolved in the last 7
  days, not Minor, with a channel no `pm-` card has named yet. Read-only; exits 3 when there is none. It prints the
  `handover register` command for each, a p2 dispatch row `postmortem-<channel id>` — never `incident-`, which
  `org-health status` reads as the fleet investigating a live incident. A title `register` would refuse as an unrooted path is
  named, its command printed past that gate for the chair to judge. The chair picks which and when; nothing raises one alone.
- **The seat briefs, then parks the ask.** Read the channel and the incident's page; publish a briefing (what
  happened, in people first; who will be in the room; what they will want to settle), reviewed and published with
  `slopweaver page publish --review`.
  Park ONE reply as the owner (`slack draft record`, `--row postmortem-<channel id>`) in the incident channel, tagging
  whoever runs the postmortem, asking to be added. It opens on the conversation, never a PR.
- **One card.** Write the form ([postmortem-form.md](reference/postmortem-form.md)), prove it with
  `slopweaver incident postmortem --form <file> --dry-run`, and hand its path to the chair. The card opens the
  briefing (every card on a `postmortem-` row must), carries two or three verbatim lines, and refuses a reply that is
  not held, as the owner, in that channel, tagging the facilitator, on this row, or a channel the snapshot does not name as
  the incident's own. `hand post` refuses a `postmortem-` row outright. A re-run amends it.
- **Ending**: `filed` once the reply is sent on the owner's yes, `declined` on the owner's no.
