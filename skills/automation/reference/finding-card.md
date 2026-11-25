# A finding card: one issue, graded, routed and parked for the owner's yes

Every bot `finding` card is composed by this page, whichever lane found the issue: the
[organisation hunt](organisation-hunt.md) and the [error-tracking batch](error-tracking-batch.md) both park
through it. The form is `src/outbound/artifact/finding.ts`.

## The rulings

A post shows one thing, and a run that finds several things makes several posts. So every issue worth raising is
its own top-level bot post, parked as a queue card; the owner's yes on the card is the share, and nothing else asks the owner which to share. A lead
the form refuses is not a finding card: `worth sharing` rides the hunt's one Queue ask, a `stalled ticket` its
own parked reply in a person's thread (else a top-level post tagging the team), a live incident a parked post to its channel ([the hunt](organisation-hunt.md#how-a-run-ends)).

A finding goes to the OWNING TEAM's channel, never a DM. Jasper's top-n triage is its own weekly batch, so a lead that is already a top Error
Tracking issue belongs there.

The card is the END of an investigation, never a proposal to continue one. It arrives with the thread pulled, the
pictures and citation on its first appearance, because otherwise the first question is where the screenshots are. A lead not yet settled stays
`investigating` on its board row ([the hunt](organisation-hunt.md#tracking-what-the-hunt-remembers)).

## The FYI shape: last words, expected against current

An active problem for us or our customers is worth surfacing **unless a ruling can be found accepting it won't
be fixed** — a cold ticket included, framed as this still affecting this many users a week, with the charts to
prove it. It is never framed as a person who started a ticket long ago and has done nothing. So the message is built from
facts nobody can argue with ([a live incident](organisation-hunt.md#a-live-incident) orders them its own way):

- **The last direct words on the matter**, each a verbatim quote with its permalink and who said it — never a
  paraphrase. A fabricated quote is the fastest way to lose a reader, since nobody can argue with a quote of their own words.
  A claim stays ATTRIBUTED, apart from the facts the fleet checked: "X said it was fixed" is a data point,
  never "fixed" ([nobody's word is a fact](../../knowledge/reference/traces.md#write-it-while-it-is-true)).
- **Expected against current**: what was said would happen and by when, then the state today in production,
  with the people affected counted and the charts that show it.
- **FYI by default**: not telling anyone to do anything, only noting this, which they might or might not care
  about, and inviting a correction to the fleet's picture. A suggestion only when every word on the matter, and the
  workstream's timeline, says it would land; a team that has discussed it many times reads one as
  out of place, and there is no global rule.
- **Never the alarm alone**: a candidate fix goes beside the alarm whenever the audience and the words on the
  matter support one.
- **No person is named as having dropped it.** It is a parked `slack draft record`: a reply in the existing thread
  a person started, never under a bot alert ([who-will-see-it](../../slack/reference/who-will-see-it.md); [a ticket is not a fix](organisation-hunt.md#a-ticket-is-not-a-fix)), else a bot post (`--as bot`) to the owning team's channel.

## Evidence sources and pictures

The citation is the system of record for the claim, and the hunt reaches past Datadog:
a Datadog graph view, or an https page on a console `src/outbound/artifact/findingEvidence.ts` lists — GitHub
code and pull requests, Xero, Vanta, CrowdStrike, Trelica, Hex, Google Admin, Google Cloud, JumpCloud,
Cloudflare, Nightfall, Inngest, Knock, Twilio. A tracker or a conversation (Linear, Jira, a GitHub issue, a Slack
permalink) is refused by name: it is where a finding starts, never its evidence
([organisation intelligence](organisation-intelligence.md)). The card's link names the source, `the Xero view`.

Every finding still carries three distinct pictures. A Datadog view is taken with `slopweaver datadog shot
explorer --url <link>`; any other console with `slopweaver browser read` (its viewport picture) or `slopweaver
browser scroll`, each recorded with `slopweaver browser image-record`. A console that renders nothing attachable
leaves the lead on the hunt's page, never a card through the hatch.

## The dollar figure is counted, never guessed

Failed charges times their own amounts, blocked bookings times the average booking value from the
warehouse, lost renewals times the plan price, a vendor bill read off the bill itself, over a stated window and
divided to a day. The form's `cost.basis` says how, so a reader can count again. When nothing gives a number
you can defend, leave `cost` out and rank by people: a wrong figure in front of the founders costs more than a
missing one.

## Measure before you grade

For each lead, in its own window:

- **Impact**: what the person using the product cannot do. The owner's anchors: cannot pay or cannot log in is
  `high`; an occasional error popup is `low`. The owner's test for every grade: how the owner would grade impact and priority.
- **Blast radius**: UNIQUE PEOPLE, grouped on the user id, customer id or account. Never sessions, events or calls:
  one user in a hundred sessions matters less than 100 users each in one session.
- **Cost**: dollars a day and how they were counted, when there is a defensible count (above).
- **Env**: production or staging, from the query's own `env:` facet.
- **Introduced**: the first failing instant, and how that is known (the quiet window before it). A standing
  fault says so: `failing at this rate since at least 1 Jan 2001, the start of the window read`.
- **Tracking**: search Linear (`slopweaver linear search "<words>"`) and say where you looked.
- **Prior thread**: look for an earlier report in #defects, #urgent-defects and support over the window. One
  finding once went to #defects that support had raised there two days earlier; a lead a PERSON already raised belongs
  in THEIR thread, never a new card; a bot alert raising it is not a person raising it.

On a span-backed lead, count unique users with a cardinality aggregate on `@usr.id`; elsewhere count the
source's own ids (accounts in an access list, customers in the warehouse):

```bash
slopweaver datadog raw --method POST --path /api/v2/spans/analytics/aggregate --body '{"compute":[{"aggregation":"cardinality","metric":"@usr.id"}],"filter":{"query":"<query>","from":"now-14d","to":"now"}}'
```

**When the failing spans carry no user id**, and client spans to a third party usually do not, join by trace:
group the failing spans by `trace_id`, then run the cardinality over the parent service's spans with
`trace_id:(<id> OR <id> …)`. When no parent carries one either, the form's `unmeasuredBecause` and `proxy` say so,
and the finding ranks as `unknown`.

**Refute before you post.** A burst of errors is not a problem until something a customer does fails. A file-proxy
"not found" storm once measured was scanner and favicon traffic: every masked code matched a probe word
(`.env`, `credentials`, `terraform`) and none had the shape of a real short code, so it reached no customer.

## The matrix

Priority is derived by `src/outbound/artifact/findingPriority.ts` and never typed:

| Impact | many ≥100 | some 10–99 | few 2–9 | one | unknown |
| ------ | --------- | ---------- | ------- | --- | ------- |
| high   | P0        | P1         | P2      | P3  | P2      |
| medium | P1        | P2         | P3      | P3  | P3      |
| low    | P2        | P3         | P4      | P4  | P4      |

`unknown` reads the `few` cell. A staging finding is capped at P2. A dollar figure does NOT move a cell: cost
ranks the leads and heads the card, and a costly fault on few users still derives P2 and tags nobody. Every card
opens with Blast radius, Impact and Priority, derived (`FINDING_SIZING_LABELS`, the owner's question order).

## A P0 or P1 with a dollar figure tags Jonah and Smith

That is the post the owner described: a bug found, costing the organisation a large daily sum, graded P1. The form carries it:

- `cost: { dollarsPerDay, basis }` shows on the Impact line (`high, costing about $12,500 a day. …`), basis folded.
- `escalate` names the people it tags, rendered as mentions on the Priority line, `P1, …, for @Jonah and @smith`.
  Resolve each key first with `slopweaver identity resolve jonah` and `slopweaver identity resolve smith`.
- The form REFUSES a tag without a `cost`, a tag on a P2, and a P0 or P1 carrying a `cost` that tags nobody.

It still parks like every other finding and **nothing reaches them before the owner's yes** on the queue card, in the
owning team's channel, or #urgent-defects for a live P0 or P1 costing money now. **A payments-alert lead clears a
far higher bar first**: verified, nobody on it, it changes what smith knows ([the bar](organisation-hunt.md#the-rulings)).

## Which team: name it from evidence, and say how

No table maps a service to a team, and spans carry no `team` tag (measured: a single `team:` span among
hundreds of thousands of production error spans over 7 days, `slopweaver datadog apm 'env:production status:error' --from 7d --by
team`; those are sampled indexed spans, a lower bound fit for a share and never for blast radius, which is
sized as above). So the composer names the owning team from what the failing path shows, in this order: the acme-admin
`CODEOWNERS` line for the failing code when it names a team rather than `@acme/acme-eng`; the product
surface the user is on (a booking or signup flow is growth, the customer app is the customer team, the site
console is the team that owns it); the recent authors of the failing code. The channel is that team's own, read from the
Slack corpus (`team-customer`, `team-ops`, `squad-web-platform`, `growth`). The draft's `--why`
names the team and how it was known, so the owner's yes approves the routing too. When nothing names one, the `--why`
says so and offers the two likeliest channels; never a DM to an engineer instead.

## Parking a finding: a queue card, then the bot's post

The owner's typed ruling: the bot found it and the owner has not verified it, so each finding is parked as the
BOT's card for the team's channel, and released as the bot's post once the owner approves:

```bash
slopweaver slack draft record --as bot --channel <team channel> --why "<team, who to tag and why: finding …>" --media a.png,b.png,c.png --asked-before <none|permalink> --form -
slopweaver slack post --as bot --draft <id> --approve <digest>   # what `slack draft show <id>` prints
```

There is no fixed channel (the owner's typed ruling): judge each finding as the owner would, and let the card
name the channel, a thread a person started (`--thread-ts <root ts>`, released by `slack reply`), who to tag and
why. Never a channel that serves another purpose, like an alerts channel full of automations, and never a bot alert's thread ([who-will-see-it](../../slack/reference/who-will-see-it.md)). A private channel needs the bot
in it. `slack draft record --as me` on a top-level finding refuses in a public channel, and a top-level row as the owner
outside a DM must declare `--kind finding|message` (`src/outbound/slack/findingIdentity.ts`).
`src/outbound/slack/findingDestination.ts` refuses a `finding` form anywhere but an approved share into a
channel or one of its threads, the owner's DM included; `findingIdentity.ts` signs it the bot. No hatch on either. A finding that asks "is this expected?" declares whether the team already answered it: [asked-before](../../slack/reference/asked-before.md). Released, one met with silence, an untimed "looking into it" or a "fixed" comes back to the owner as ONE follow-up card ([finding-followups](../../slack/reference/finding-followups.md)).

## The bar, and what the form refuses

Only P0, P1 or P2, and only an issue nobody is tracking: priority is the metric that decides what is worth
surfacing. A lead below the bar is named among what was checked and never
posted. The form also refuses:

- a missing `impact`, `blastRadius`, `env`, `introduced`, `tracking`, `priorThread` or `options`, and any unknown
  key; a `cost` without its `basis`;
- an `escalate` without a `cost` or below P1, and a costed P0 or P1 without one;
- a `citationUrl` that is not a system-of-record view (above), and a tracker by name;
- fewer than three DISTINCT pictures in `--media`, counted by image digest (the journalled `unshown-graphs` hatch
  is the one deliberate exception);
- `slack edit` with a finding form: post the corrected one and `slack delete` the old one.

**A high-stakes channel is never where a finding lands on its own.** #defects and #urgent-defects are named in
`profile.json` `slackHighStakes.channels`; a top-level post there is refused unless it is this form, and a second
one inside a day is refused whatever it is (`src/outbound/slack/highStakesChannel.ts`): a finding there has to be
thoroughly defensible. A reply inside an existing thread is not gated.

## The form, field by field

```json
{
  "kind": "finding",
  "title": "Card payments fail at checkout",
  "env": "production",
  "impact": { "grade": "high", "what": "Customers cannot pay for their assessment." },
  "blastRadius": { "users": 42, "window": "7 days", "basis": "unique usr.id on the checkout parent spans" },
  "cost": { "dollarsPerDay": 12500, "basis": "failed charges times their own amounts over 7 days" },
  "escalate": ["jonah", "smith"],
  "introduced": "failing at this rate since at least 1 Jan 2001, the start of the window read",
  "tracking": { "none": "searched Linear for checkout and the provider's error code, nothing open" },
  "priorThread": { "none": "no #defects or #urgent-defects thread on checkout since 1 Jan 2001" },
  "options": ["Replay the failed charges from the provider's own log.", "Roll back the change that began it."],
  "citationUrl": "https://us3.datadoghq.com/apm/traces?query=…"
}
```

`cost` and `escalate` are optional; the rest are required. The pictures are taken as
[above](#evidence-sources-and-pictures). Read what a release would post with `slack draft show <id>`, and re-cut with `--supersedes <id>` rather than leaving two.
