# The daily organisation hunt: costly problems nobody is fixing, anywhere, past or present

The `organisation-hunt-daily` row is an `investigate` recipe: it posts its question into the owner's bot DM and a
visible session answers it. What that session hunts for, what it tracks and how it ends is this page. Where to
read each lens is [the lenses](organisation-hunt-lenses.md); how one issue becomes a card is
[a finding card](finding-card.md).

## The rulings

- **Go beyond regressions.** The hunt looks for big problems nobody is talking about, not only regressions. A
  payments bug costing big revenue is the model case: found, then tagged to the right people as a P1 with its
  daily cost.
- **Go beyond Datadog.** After runs that kept answering "no finding cards today", the hunt widened past Datadog
  and telemetry to anything: the past and the present, security, money. Answering that nothing big turned up in
  Datadog means the hunt looked in the wrong places.
- **Pull the thread to its end.** A Queue card that asks whether to pull on a lead is a half-pulled thread. A
  session that finds something worth a look puts it on the board and investigates it whether or not a scheduled
  ask is running, acting as an organisation intelligence, and brings the receipts, the screenshots and the
  citations on the first message.

So **the hunt is one door, not the only one.** Any session that notices something worth a look registers it as
a board row (`slopweaver handover register --ask "<the lead>" --dispatch`), records that with `slopweaver
autonomy record`, and pulls the thread to its end, a settled result or a refutation, before a finding card reaches
the owner; a live one that stalls surfaces early instead ([below](#surface-early-when-it-stalls)). **No card ever
asks "shall I keep pulling?"**: the card is the finding, with its receipts on it.

That is a **standing ask**: a finding card no particular steer of the owner's produced quotes it, and says no
other steer is behind it. Recorded once on the owner's machine with `slopweaver profile
standing add organisation-intelligence --anchor <anchor> --covers findings`
([profile](../../profile/SKILL.md)); a finding no recorded ask covers says so on its card.

Findings are TRACKED, not all sent: each completed one the form takes is its own parked bot card, a stalled
ticket a parked reply in the thread a person raised it in (else a top-level post tagging the team), a [live incident](#a-live-incident) a parked post to its channel, the rest the run's Queue ask ([how a run ends](#how-a-run-ends)), and
Slack moves only on the owner's yes. The outcome aimed at is another person finding a post really useful, because
nobody was talking about it, and acting on it, ideally the C-suite: a problem that is costing the organisation 80K a
month that no one is talking about, or a bug that will save the organisation a hundred grand.

**A lead inside a colleague's own cleanup clears a far higher bar.** Where a colleague has asked the owner to
hold off while they rebuild a family of alerts, and the owner has agreed in the thread to stop raising them, such a
lead reaches the owner's Queue only when it is real, verified and falsifiable, nobody is already on it, and it
materially changes what the owner knows, so that there is practically no chance of that colleague coming back to
say this is the third time. Unverified, it stays off the Queue until checked; inside the colleague's cleanup, it is
`below the bar`, on the page and in no option to send. Findings elsewhere are untouched.

## Why it came back empty, measured

Three answers in a row each read "nothing untracked cleared P2". The row was named and
worded as a Datadog hunt, the page it followed read only spans, and the card form admitted only a Datadog
citation, so every session went back to Datadog. Its own table dropped leads with real customer and revenue
impact because a ticket existed for each. The first widened run found one of those tickets closed Done with its
fix on staging while production still failed, and a spend nobody was watching. **A ticket is not a fix, and
Datadog is one source of many.**

## The lenses, and today's

Five lenses. **Money is swept every day**; one other lens goes deep, by the weekday on this machine's clock, the
same clock the row's cadence reads (08:30 there is the previous day in UTC).

| Day      | Deep lens                                  |
| -------- | ------------------------------------------ |
| Mon      | money                                      |
| Tue      | security and access                        |
| Wed      | care and product                           |
| Thu      | operations and silent failure              |
| Fri      | people, process and past decisions         |
| Sat, Sun | follow up every open lead on the last page |

Rank every lead by what it costs, in this order: **money lost or at risk**, **customers who cannot get care**,
**an exposure of customer data or access**, **customers who cannot pay, book or sign in**, then the rest. Spend the
run on the top two or three and pull each until it can be said in two sentences, or until it is noise.

**Past and present both count.** Read windows the source allows, never only a day: Datadog over 14 to 30 days,
the warehouse and Xero over months, the corpus over its whole history. A decision recorded months ago that never
landed is a lead today if it is still true today; check it is, in the system of record.

## Tracking: what the hunt remembers

- **Open with what earlier hunts found.** Read the last hunt pages (`$SLOPWEAVER_HOME/pages/organisation-hunt-*`)
  and `slopweaver knowledge recall "<the system>"`. Every lead still open is carried forward with what changed.
- **Trace every leg you read** with `slopweaver knowledge trace --domain <slug> --question "<q>" --probe "<exact
command>" --outcome paid|empty --evidence "<what came back>"`, and `--does-not-prove` on an empty one. The domain
  is one `slopweaver knowledge domains` lists — the platform's own where there is one. A remembered dead end
  reorders the next hunt; it never skips the leg ([traces](../../knowledge/reference/traces.md)).
- **Write the field notes as you go, not at the end**: each dead end, gotcha, thread worth re-pulling and
  known unknown the moment it is in hand, dated, each saying what would make it stale
  ([write it while it is true](../../knowledge/reference/traces.md#write-it-while-it-is-true)).
- **Every lead is on the page with a status**: `raised` (a parked card), `worth sharing` (settled and
  untracked, but no customer blast radius for the card form: spend, an exposure), `investigating` (its board
  row named; the thread is still being pulled), `stalled ticket`, `below the bar`, `refuted`, or `fixed since`.
  A lead leaves the list only as `fixed since` or `refuted`, or on the owner's no. `fixed since` is the run's own check
  in the system of record; someone SAYING it is fixed is carried on the lead as their attributed claim, with its
  permalink, and the lead stays open until checked. An unrefuted fault is
  `investigating`, never a question to the owner.

## Surface early when it stalls

Pulling to the end is not sitting on it. The standing lesson is from days spent tuning a bot-protection rule that
passed staging and broke real customers while the owner kept saying they were close: the right call was to
escalate to the vendor AND tell the team that the owner tried to fix this, it did not work as expected, and the
owner has escalated to support in the meantime, just FYI. So when an investigation
stalls, or outgrows what the fleet can prove, and the problem is live, its partial picture goes out EARLY as a
parked FYI in [the FYI shape](finding-card.md#the-fyi-shape-last-words-expected-against-current): what was
tried, what is still unknown, what was escalated, and that the thread is still being pulled. It is a statement,
never "shall I keep going?", and it still sends only on the owner's yes.

**The fleet's own work is held to it too**: a struggling seat is something the owner wants to know about, and a
result shown late is worse than one known early. A seat struggling says so early where the owner will see it,
with what it tried ([rule 6](../../../AGENTS.md)), never a polished result late.

**Its state is honest while it runs, not only done or blocked**: what was tried, the docs followed, the Codex
cross-check, and anything observed that does not line up with the documented behaviour — an honest "I don't know why" is fine. A
permission wall (at Acme the fleet has admin on this repository and read on the rest) names the exact access,
its holder and what it would answer. **Every such report is a Queue card; it is ALSO pushed as a floating note
unless silence risks nothing bad and the owner has not asked to see it** — the test is risk either way, and when close, surface.
The cases: something may break while the owner can still change it (a runner outage is pushed to the owner, not
pulled from the owner), a send the owner approved stopped on the owner's sign-in, seats idle on the owner, the
owner said they are keen to see it, or silence is a close call. A subscription question with no deadline just goes
to the Queue. `slopweaver hand surface` prints the
report, the Queue line and, only on those routes, the checked note line the seat sends the supervisor
([mid-investigation](../../hand/reference/mid-investigation.md)); a blocker only the owner can clear is still carded that
tick, as [stuck chats](../../supervisor/reference/stuck-chats.md) requires.

## A live incident

During an incident people drop everything to fix it, so they are more receptive to something related, and a
reproduction of the incident, with the proof, is a tool they can fix it with. So a live incident, an incidents.io channel
opening, is worth a look on sight, investigated for root cause and impact in a visible seat like any other lead.
Its finding is [the FYI shape](finding-card.md#the-fyi-shape-last-words-expected-against-current) in the owner's order:
a couple of verbatim quotes from the incident channel saying where the team has got to, then root cause and
impact with the screenshots and Datadog citations that settle them, then ONE question to the owner, whether to share
it with them. The scheduled recovery sweep registers a new incidents.io channel as an `incident-…` board row
with no model launched, the chair seats it on Opus, and the seat ends in ONE floating note posted with
`slopweaver incident note`, amended in place as findings land. The share is two parked bot posts (`--as bot`),
one to the incident channel and one to the related bugs thread a person started (never a bot alert's,
[who-will-see-it](../../slack/reference/who-will-see-it.md)), and the owner's yes on the note sends them. The whole
procedure is [incident](../../incident/SKILL.md). The incident ITSELF floats separately: `org-health` pages it
once when it starts or changes severity, and `org-health status` tells the rest on demand ([org-health](../../monitor/reference/org-health.md)).

## A ticket is not a fix

A lead the form refuses as tracked is not dropped. When its ticket has not moved in 14 days, or it is closed while
the fault still shows in the system of record (a fix merged to staging and never promoted is the measured case),
it is a `stalled ticket`: on the page with its count and the ticket's last movement. It never becomes a bot finding: the form refuses a tracked issue, and a lead somebody
already raised belongs in THEIR thread, one a person started. Still hurting customers and with no ruling accepting
it, it is worth sharing: a parked reply into the thread a PERSON raised it in, else, when only a bot
alert raised it, a top-level post in the owning team's channel tagging the team, since an alert's thread is nobody's
([who-will-see-it](../../slack/reference/who-will-see-it.md)). Either way it is in
[the FYI shape](finding-card.md#the-fyi-shape-last-words-expected-against-current), the last direct quotes with permalinks, expected against current with the charts, and nobody named as having
dropped it.

## How a run ends

1. **One findings page**, `slopweaver page publish organisation-hunt-<yyyy-mm-dd> --page <fragment>.html --review <id>`,
   reviewed first through `page review-prepare` ([page](../../page/SKILL.md)). Lead it with the biggest counted figure. Each lead carries its status, its
   count and basis, its evidence link, its tracking and what the run checked; an `investigating` one names its
   board row; then the probe table and the run's known unknowns. The four sections a finding page owes are
   [finding-page](../../handover/reference/finding-page.md)'s.
2. **One Queue ask** for the run: `slopweaver handover register --ask "<what the hunt found>" --problem … --options
… --lean … --risk … --blast-radius … --still-real … --slug organisation-hunt-<yyyy-mm-dd>`, then `slopweaver
handover artifact organisation-hunt-<yyyy-mm-dd> --url <the page's file URL>`. Its options are what to SEND, to
   whom, or leave, for the leads with no card of their own, each with what it costs; a lead that parked its own
   card or reply is answered there, never asked twice, and nothing asks whether to keep investigating.
3. **A parked bot finding per `raised` lead**, one card each, by [a finding card](finding-card.md): untracked,
   customer-facing, measured and refuted, its pictures and citation on it. A `worth sharing` lead rides the Queue
   ask, with the same receipts. Nothing reaches a team before the owner's yes.
4. **One line in the prompt's thread** naming the page and each draft id. It states facts and asks nothing (the
   owner's DM refuses an ask, `src/outbound/slack/ownerDmAsk.ts`), and carries no figure or link.

**"No big issues in Datadog" is never an ending.** When nothing clears the card bar, the page still ranks what
was found, every stalled ticket included, and the Queue ask says so.
