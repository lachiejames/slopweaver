# The Xero atlas holds EVERYTHING REACHABLE, and declares the ledger rather than storing it

Part of [Atlases](../atlases.md).

The owner's ruling ([atlas-intent.md](../atlas-intent/06-holdings.md) §6): the who-else-holds-it test comes out the
other way here. No corpus source ingests Xero, no other atlas touches it, and _"what did we spend with this
vendor"_ is answerable from nothing else this installation has — so this atlas declares an entity half rather
than a surface map alone.

**The one bound is the `family` kind, and it is a shape no other atlas here has.** A highly voluminous surface
is _"enumerated and declared rather than stored whole"_, and `family` is that enumeration made a stored
record: one row per business-object family, carrying which operations reach it, which declared page shows it,
and its DISPOSITION. Read it with `slopweaver atlas xero families`.

MEASURED against `xero-node` 19.1.0, reproducible with `slopweaver atlas xero sync`: **475 operations across
11 generated API classes, resolving to 413 distinct routes, with response fields from 354 models, and 72
families — 47 configuration, 15 mixed, 10 voluminous, 0 unjudged.**

Four things about that are decisions rather than numbers:

- **The disposition cuts THROUGH a family, which is why `mixed` exists.** `GET /Invoices` returns documents a
  person authored; `GET /Invoices/{InvoiceID}/History` returns the trail Xero emits about one of them. 32 such
  operations across 16 families, so a family forced to one disposition would have to be wrong about one side
  of fifteen of them.
- **The judgement table is exhaustive by CI, not by anyone remembering.** `families.ts` DERIVES the family
  list from the installed SDK and DECLARES the disposition by hand, and `families.test.ts` fails in both
  directions — a family the SDK declares that the table does not judge, and a table entry for a family the SDK
  no longer declares. `unjudged` is the honest runtime fallback that a green build never produces.
- **A route two clients declare keeps BOTH declarations.** Three payroll clients share `payroll.xro/2.0` and
  62 paths between them. The route is the entity, because the route is what the browser channel can also
  observe — but dropping one client's declaration loses a real fact and unioning their query parameters would
  ASSERT a false one, that the UK client accepts a New Zealand parameter. Only `responseFields` is widened,
  because that field answers "which call hands me this" and a union is the right answer to that question.
- **`live-api` is DECLARED and UNFILLED, and that cell is the answer to the obvious question.** This atlas
  ships no live OAuth acquisition path, so its only Xero access is a signed-in browser session, and
  [atlas-intent.md](../atlas-intent/07-browser-fallback.md) §7 makes the browser the ingest FALLBACK rather than the
  first reach — so the surface that should answer first has no credential. The atlas says so once, with the exact remedy (a Xero OAuth 2.0 app and one
  organisation's consent), rather than scraping the books out of a rendered page. Every holdable family
  carries its own gap that closes the moment that credential exists.

**The browser half declares candidates at four roots on purpose.** Xero publishes no manifest of its own web
routes and its client migrated in stages — some surfaces are still `go.xero.com/<Area>/<Page>.aspx`, some
moved under `go.xero.com/app/!<short code>/…`, reporting moved to its own origin and the account hub to
another. So `browserPages.ts` declares each surface at the roots it plausibly hangs off and the generation
publishes which resolved; a form that does not resolve becomes a recorded gap on its own row, so the next
session does not re-measure it. The organisation's short code is learned at run time and never written down —
it identifies the organisation, and no reason, report line or `--json` field ever carries a URL.

## What a walk can find: the login's role decides the scope

`slopweaver atlas xero walk` reports how many declared pages it reached and photographed, and how many
undocumented first-party operations it published; the generation holds that install's numbers, never this page.

**An employee-only role sees Xero's EMPLOYEE PORTAL, not the accounting console.** For such a login every
console route — the dashboard, bills, invoices, reports, settings — redirects to `payroll.xero.com`, and the
routes that kept their address photograph one byte-identical shell between them, which
`markIndistinguishablePages` catches and strips rather than counting as separate surfaces. "What did we spend
with this vendor" is then not merely un-ingested: it is not reachable from that browser session at all, and no
amount of walking makes it so.

Only walking finds the scope, exactly as [atlas-intent.md](../atlas-intent/02-both-surfaces.md) §2 says a browser
surface is for: a cookie signal cannot tell a console from a portal. The descriptor's `visibilityScope` says it;
a reader who needs a console-scoped answer needs an OAuth connection, and the atlas can say why in one command.

The browser-only operations are the corroboration output, read with `slopweaver atlas xero report`: Xero's own
navigation and notification services, its identity endpoints and dashboard calls, none declared by `xero-node`,
which is the disjointness the two-channel design exists to record.

**Landing on Xero's sign-in origin stops the walk** rather than failing every page after it. A sign-in wall is
a successful navigation, so without that one sign-out becomes forty page gaps that have nothing to do with the
pages.

## It runs on demand, never on the schedule

The atlas's only live reach is a browser walk, and a walk meets Xero's sign-in page whenever that session has
lapsed, so a scheduled walk raises a sign-in card rather than a read. So the descriptor declares
`resyncSchedule: { kind: "manual-only" }`, `atlasResyncInputs` derives no row from it, and `automation
register-resyncs` retires `resync-atlas-xero`. A read is `slopweaver atlas xero refresh` when someone asks for one,
and it writes no resync state, so it raises no card.

**A signed-in visit may land on `payroll.xero.com`, and the recheck walk reads it that way.** Xero's session row in
`src/hand/sessionProbes.ts` leases the walk's own origins and declares payroll a signed-in landing, so a
`go.xero.com` visit redirected there settles the owner's sign-in card instead of reading `OFF_LEASE_ORIGIN`
([rechecking](../../skills/hand/reference/rechecking.md)).
