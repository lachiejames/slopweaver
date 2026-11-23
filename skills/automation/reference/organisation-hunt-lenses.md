# The organisation hunt's lenses: where each one reads

Bundled reference for the [organisation hunt](organisation-hunt.md). Each lens names what it hunts for and the
sources that hold it. The verbs are the doors every session already has; an atlas's own read is
`slopweaver atlas <name> read` ([atlas](../../atlas/SKILL.md)), and when a question spans several sources plan the
legs with [route](../../route/SKILL.md) first. A source with no credential on this install is a blind spot the
page names, never a reason to fall back to Datadog.

## Money

What it hunts: a charge that fails, doubles or never records; a plan billed on the wrong schedule; a refund that
leaves paid care booked; vendor and AI spend nobody is watching; a revenue fix closed but never shipped.

- **Spend**: `slopweaver atlas trelica read --kind ai-usage` and `--kind ai-alert` (AI cost by key, model, team
  and person, plus spike alerts); `--kind app` for SaaS; `slopweaver spend read` for card spend.
- **Books**: `slopweaver atlas xero read` (read-only).
- **Payments in flight**: Stripe client spans and invariant logs through `slopweaver datadog logs` and
  `slopweaver datadog apm`; the payment monitors' own alert channel in the Slack corpus.
- **Who and how much**: the warehouse through [hex](../../hex/SKILL.md).
- **Shipped or not**: a revenue ticket's fix, checked on the branch production runs, not the ticket's state.

## Security and access

What it hunts: a leaver who still holds access; an admin role nobody needs; a secret exposed in code, a chat or a
shared drive; a critical vulnerability open for months; an unmanaged device; a dangling DNS record; a failing
compliance test that is a real exposure rather than paperwork.

- **Identity and access**: `slopweaver atlas google-admin read`, `slopweaver atlas jumpcloud read`,
  `slopweaver atlas onepassword read`, the GitHub org through `slopweaver atlas github read`, HiBob for who left.
- **Endpoints and edges**: `slopweaver atlas crowdstrike read`, `slopweaver atlas cloudflare read`.
- **Exposure**: `slopweaver atlas nightfall read`, `slopweaver github vuln list`, code scanning alerts.
- **Compliance**: `slopweaver atlas vanta read` and the [compliance](../../compliance/SKILL.md) skill.

Refute before you raise: an apparent leaver's account may be a service account, so say what was checked.

## Care and product

What it hunts: a customer who cannot book, pay or sign in; a result never delivered; a notification switched off
and never switched back; a site with no availability for weeks.

- **Telemetry**: `slopweaver datadog apm 'env:(prod OR production) status:error' --from 14d --by service`, then
  `--by resource_name` on the money and care paths; `slopweaver datadog rum` for a funnel step people fall out
  of. A fault flat for a month is a lead, and so is a new one. Both env spellings, always: one service
  can emit `production` while another emits `prod`, so `env:production` alone drops every error span the
  `prod` services emit (`slopweaver datadog apm 'env:prod status:error' --from 14d --by service`).
- **Notifications**: `slopweaver atlas knock read`, Twilio and Braze atlases, and the notification service's
  own "not sent" logs grouped by workflow.
- **Who was affected**: the warehouse through hex, counted on customer id.
- **Sampled, not blast radius**: the telemetry move's APM total is indexed spans, a sampled lower bound as its
  own header says, so it is a lead and never the affected-event count. Corroborate a material count with
  `slopweaver datadog logs` before it sizes a finding, and re-run a report that prints `NOT a count of events`.

## Operations and silent failure

What it hunts: a job that stopped, a retry loop that gave up, a dead-letter queue, a webhook nobody
acknowledges, an alert routed to a channel nobody reads, a digest that misreads what it reports.

- **Jobs**: `slopweaver atlas inngest read`; cron and ETL services in Datadog over weeks.
- **Alert routing**: the monitor definitions in the product repository against the channel each posts to, and
  whether any human ever answered one there (`slopweaver store facets --facet author`).

## People, process and past decisions

What it hunts: an incident that keeps recurring with no root fix; a decision in a meeting or thread that never
landed; a High or Urgent ticket never started; a costly manual process; a renewal flagged and forgotten.

- **History**: `slopweaver store query --search "<words>"`, `slopweaver store probe`, and `slopweaver store
around` on a hit; Fathom transcripts and Notion pages are in the same store.
- **Tickets**: `slopweaver linear query` for old open High/Urgent work, `slopweaver linear search` for a theme.
- **Still true now**: every past lead is checked in its system of record today before it reaches the page.
