# Datadog as a detective source

Read this when a wave gave you a `datadog` lead, or when a question names a service, a log pattern, a span
operation, an error code, a metric or a monitor. The fan-out rules themselves are in
[detective-fanout.md](detective-fanout.md); what is here is the Datadog leg.

## Fan out FIRST, then read the census, then go live

A Datadog search term is a **haiku detective fan-out**, not a query you type yourself.
`store detect` gates the fan-out on the local census — a question whose keywords match nothing in it sends no
detective to Datadog at all — and every detective's first move is the local read, which costs no network.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store detect "<the question>" --term <t> [--term <t> ...] --ask <channel>/<messageTs>
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" datadog catalogue show --query <fragment> [--service <s>] [--product <p>]
```

The census holds **every shape of every product**, counted over its window: every log pattern (Datadog's own
message fingerprint), every span `operation × kind` with the resources under it, every RUM event type with
its route groups, every CI pipeline with its jobs, every test suite with its tests, every database query
signature with its tables, every profile family, and every metric with the tag keys it is queryable by. Each
row carries the attribute paths and types an event of that shape holds, the allowlisted facet values, and the
query that reproduces it. Build or rebuild it with `datadog catalogue build` (`--product <p,...>` runs one
product; there is no cell ceiling and no `--family`).

**The census is on the schedule, and `store detect` says its age.** `resync-atlas-datadog` runs `atlas datadog
sync && datadog catalogue build --from 7d` daily (`src/atlas/datadog/descriptor.ts`), and `store detect`
prints one line naming how old the census is — STALE past that window, EXPIRED once the window it measured
leaves the logs' 15-day retention. Read that line before you trust a MISS: a shape newer than the build is
invisible to the gate, so "Datadog has nothing to say" is only as current as the census.

## One verb per product, counts before events

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" datadog logs '<query>' [--from 1h] [--by f,f] [--not clause] [--rows <n>]
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" datadog apm | rum | ci | tests | dbm | profiles   # same shape, each product own facets
```

Every one answers with COUNTS first and prints no event until `--rows` asks. `--not` negates a clause out of
the count, which is how the noise goes; `--by` regroups. A group is labelled by what the local census says it
is, so a log pattern reads as its message template rather than as a hex fingerprint. MEASURED:
`datadog logs 'service:jobs-api status:error' --from 2h --by __dd.log_identity.raw_msg_fingerprint` returns
thousands of events in a couple of dozen labelled patterns, the top one about half.

A count is what Datadog REPORTED, and two checks on every report say what it may be read as. **`apm` is a
sampled lower bound**: its total is indexed spans, which adaptive sampling thins before any retention filter, so
the header ends `count over sampled traffic — a lower bound, not a total`, a caveat follows the query, and the
hint points at `datadog logs` (unsampled) to size blast radius. `rum`, `ci` and `tests` carry the same qualifier
only when their own aggregate declares `traffic_type: sampled`. **A single-facet grouping is audited against the
total** (several facets never are: their truncation flag cannot see one outer group hitting its limit): when
they sum to MORE, the report prints `NOT a count of events` and suppresses every share; when they sum to less, it
prints the shortfall. MEASURED: one `apm` run printed a total less than half what its groups summed to,
so a service showed well over 100%; a re-run converged on the groups' sum. Neither cause is proven by the arithmetic, so re-run before
reading an inflated report as a facet fault, and use `--json`'s `countLabel`, `partition` and `corroborate` when scripting.

The two products with no reachable analytics endpoint (`dbm`, `profiles`) fold their groups from one page and
SAY so on the report, with every count on them a floor.

## The live verbs, and the one rule about `raw`

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store probe  <keyword> --source datadog [--from 7d] [--env <e,…>]
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store groups --term <t> --source datadog --facet service|status|@err.code
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store hits   --term <t> --source datadog [--rung <r>] [--regex <p>]
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store peek   --id dd:<…> --match <term>
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store open   --id dd:<…>                       # UNREDACTED, see below
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store around --id dd:<…> --mode trace|request|session|ip|service
```

**`datadog raw` is for an obscure case no verb fits, not for a query you could have run through one** — and a
hand-built console URL is never the move. If the shape you need has no verb, that is a row to raise rather
than a reason to reach for `raw`.

## What a live query costs, measured

MEASURED on this install's site from the `x-ratelimit-*` headers: logs search **3 per 10s**, logs aggregate **2
per 10s**, spans search and aggregate share **5 per 60s**, RUM **167 per 60s**, CI pipelines and tests **100
per 60s**, metric tags **30 per 10s**, and Datadog's own unified event track
(`POST /api/v1/logs-analytics/list?type=<track>`) **85 per 10s shared across every track**. That last budget
is why a census can afford one exemplar per shape, and why a census is a scheduled pass rather than something
a detective runs mid-question.

**Four rungs, not seven.** `term`, `term-wild` (`*t*`), `all-fields` (`*:t*`), `all-fields-wild` (`*:*t*`).
Datadog's message index does not tokenise on punctuation the way `to_tsvector` does, so the store's substring
shapes collapse here — MEASURED on `Knock` over one production day of tens of thousands of lines, `term-wild` matches the same lines as
`term`, `all-fields` a fraction of a percent more and `all-fields-wild` a few percent more. `*:` is
the rung that cuts. `--shape` is the store's flag and is refused by name; `--rung` is Datadog's.

**Datadog has no regex.** `--regex` on `store hits --source datadog` pulls a bounded page and matches LOCALLY,
so a pattern matching nothing on page one has not proven the term is absent.

**Every environment by default, on the owner's ruling.** No `--env` means production, staging and the events
whose env tag is wrong or missing — some of this organisation's logs carry the wrong key or none, which is
exactly why the default is not production. Narrow with `--env` deliberately, and say so in your report.

**About fifteen days of retention.** A zero over an older window means NOT RETAINED, never no events; the
verbs refuse a window past retention rather than returning that zero.

**What you read is UNREDACTED and what you report must not be.** The owner's ruling: the bot sees what
the owner sees, `usr.*` and `session.ip` included, because redacting mid-investigation is a hindrance — and
because `around --mode ip` is a real move the owner uses, finding what else came from an IP and checking whether any of it
carried a uid. The redaction happens at the Slack post (`src/outbound/slack/piiRedaction.ts`, emails and IPs).
Quote what you must, and say when a quote carries identity so the composer knows.

**A census row never carries event data, and that is a different rule from the one above.** A row is kept
forever while an event is kept fifteen days, so values reach a row only through the facet allowlist. The
database product is the sharpest case: a row names the query signature and the TABLES, and holds
`@db.statement`, `@db.plan.definition` and `@network.client.ip` as PATHS with no values at all.

## A finding the detective shares is the bot's post

What a detective finds is parked as a `finding` queue card with `slack draft record --as bot`, naming the channel
and any thread (one a person started, never a bot alert's: [who-will-see-it](../../slack/reference/who-will-see-it.md)),
who to tag and why (the owner's ruling: no fixed channel, judged as the owner would), and on the owner's
yes it goes out as the bot, never under the owner's name: the owner did not find it and has not verified it
(the owner's ruling). As the owner only where the bot cannot post — a DM with a person, a thread the owner is
already in (a person's, never a bot alert's), a private channel the bot is not in
([draft-review](../../slack/reference/draft-review.md)). The bot's own answer to a tag is `--as bot` already.
