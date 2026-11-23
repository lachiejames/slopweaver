# A Datadog citation opens on the window and the scope its claim was computed over

Refusal 4 of [links-citations-and-shots.md](links-citations-and-shots.md), in its own file because that one
is at its line budget. The first three rules there ask whether a claim carries evidence. This one asks
whether the evidence a reader CLICKS shows them what the claim was computed from.

It is a `warn` in the deterministic gate list (`src/admit/datadogCitationGate.ts`, break-glass
`answer.datadogCitation:v1`), so `turn review`'s pre-flight catches it before a reviewer exists, and the door
that sends runs the same list.

## Why it is a gate and not a review note

A reviewed turn's verdicts classify **claims, never citations**. A reviewer re-derives every number through
the API, and nobody clicks the links. So adding rounds corrects a claim and never touches a citation — which
is how two citation defects can ride every round, one of them into the answer that posts:

- A database CPU metric cited with no scope draws one line blended over every database in the estate,
  staging and read replicas included. An answer that reads that line as flat and writes "not the database"
  closes off a live lead while production's own line moves by an order of magnitude. Adding the scope is what
  fixes it.
- A `/apm/traces` citation frozen with `start`/`end`/`paused=true`: `src/datadog/ddLink.ts` MEASURED those
  params clamping the view to **15 minutes** against a claim window of several hours.

## What the gate reads, from the URL alone

| the view        | path                   | must carry                                                                        |
| --------------- | ---------------------- | --------------------------------------------------------------------------------- |
| logs, traces    | `/logs`, `/apm/traces` | `from_ts` + `to_ts` + `live=false`                                                |
| rum             | `/rum`                 | `start` + `end` + `paused=true`                                                   |
| metric explorer | `/metric/explorer`     | `start` + `end` + `paused=true`, `exp_metric`, and `exp_scope` **or** `exp_group` |

**Build the link, never paste one.** `ddConsoleLink` (`src/datadog/ddLink.ts`) builds logs, traces and rum,
freezing each by its own row of that table; a link copied out of the console address bar is where both
defects came from. The metric explorer has no builder here, so differentiate it yourself — `exp_scope` for a
claim about one system, `exp_group` where the claim really is estate-wide and the breakdown is the point. A
link with neither renders ONE blended line, which is the round-1 defect.

## What it deliberately does not judge

So that a correct citation is never refused: a path it has no row for (`/apm/services/...` among them), a
quoted free-text query — a declared alert probe legitimately is one — and whether a prod env filter is
present, which is an opt-in everywhere else in that package.

Two things it does not reach, both under-refusals and both stated rather than left to be discovered: it reads
`answer.citations` only, so a Datadog URL inside a body `link` run is unjudged, and `ddog-gov.com` sites fall
outside its host test. `src/datadog/answerCitations.ts`'s header carries the reasoning for every line here —
read it before changing the table.

## The host is the site's console, and a dead one never leaves

A regional site's console is the site itself: `us3`'s is `us3.datadoghq.com`. `app.<regional site>`, such as
`app.us3.datadoghq.com`, is the US1 `app.` prefix misapplied by analogy with every Datadog doc example, and it
resolves to the data intake, not a console. It is banned from every outbound write after a bot answer linked
`app.<this install's site>`. So the whole derived class —
`app.<site>` for each regional site whose console is elsewhere (`src/datadog/invalidConsoleHost.ts`) — is
REFUSED at the Slack, GitHub, Linear and Vanta write transports, in the PR-format gate and at `ddConsoleLink`,
and each refusal names the right host. A dry run sends nothing and does not refuse; the live send does. Build a
link from `DD_SITE` or with `ddConsoleLink`, never by hand.

## A Datadog citation carries a picture

Separate from what the link opens on: an answer citing a Datadog console page anywhere attaches at least one
screenshot in `images`, because talking about Datadog means showing the screenshot. A
measured graph finding still owes three; this is the floor under every other Datadog citation, at post, a held
answer's release and an edit alike. `noPictureBecause` does not answer it; the journalled `unshown-graphs` hatch
is the one exception. Every Slack lane holds the same floor: [media](../../slack/reference/media.md#a-datadog-citation-carries-its-screenshot).
