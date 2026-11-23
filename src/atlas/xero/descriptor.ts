/**
 * What the Xero atlas declares about itself — the row a catalogue shows, and the honest answer to "how much
 * of this platform have you actually looked at".
 *
 * ## It holds EVERYTHING REACHABLE, and `excludes` is where the bound on that is said rather than implied
 *
 * Owner's ruling (`docs/atlas-intent/06-holdings.md`): where something better suited already holds a
 * platform's entities the atlas holds the surface map, and where nothing does it holds everything reachable.
 * Xero is the second case, unambiguously — no corpus source ingests it, no other atlas touches it, and
 * "what did we spend with this vendor" is answerable from nothing else this installation has. So this atlas
 * declares an entity half, and its one bound is the voluminous class: enumerated and declared rather than
 * stored whole.
 *
 * The `family` kind is where both halves of that are visible. Every family carries its disposition, and the
 * ten voluminous ones say — in the row, not in a document — that their rows will never be published and why.
 *
 * ## Four surfaces, and the fourth is DECLARED UNFILLED on purpose
 *
 * `sdk-declared` is authoritative for what the API can be asked. `browser-walk` is authoritative for the
 * navigation surface, because it is the only channel that can see a settings page at all. `web-client` is
 * `discovery` and never more: seeing the first-party client call something establishes that it EXISTS, and
 * nothing about what an OAuth connection may ask for.
 *
 * `live-api` says `declared-unfilled`, and that is a STATE this atlas asserts rather than an omission a
 * reader has to notice. Its `unfilledBecause` names the exact credential — an atlas that quietly held no
 * entities would be indistinguishable from one that had decided not to.
 *
 * ## The browser walk found what the credential question actually is, which is not what anyone assumed
 *
 * MEASURED by a live walk, reproducible with `slopweaver atlas xero walk`, whose reached and photographed
 * counts the walk's own coverage cell records: the shape of the failures is the finding. For a login whose
 * Xero role holds only the EMPLOYEE PORTAL, every accounting-console route — the dashboard, bills,
 * invoices, reports, settings — redirects to `payroll.xero.com`, and the pages that keep their address
 * photograph one byte-identical shell between them, so the walk reaches pages and photographs none.
 *
 * That is why `visibilityScope` says what it says, and it is worth more than a filled surface would have
 * been: for such a login, "what did we spend with this vendor" is not merely un-ingested, it is not
 * reachable from that browser session at all, and no amount of walking would make it so. The atlas found that by looking
 * rather than by anyone assuming it, which is the whole argument for the browser half.
 *
 * ## Three ceilings, and none of them implies another
 *
 * The compiled channel reads a package and has no tenant at all. The browser channel sees exactly what the
 * signed-in person's own Xero role opens, in the organisations their login can switch to. The unfilled live
 * API would see whatever an OAuth connection's scopes and one organisation's consent open. One
 * `visibilityScope` for the atlas would be false about two of them whichever value it took, so
 * `model.ts`'s `xeroVisibilityScopeFor` is the mapping and a coverage cell carries whichever one produced it.
 */
import { type AtlasDescriptor, WEB_CLIENT_DISCOVERY_SURFACE } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { XERO_ATLAS_KINDS, XERO_ATLAS_PLATFORM } from "./model.js";

/** Xero's atlas, as it declares itself. */
export const XERO_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "the ROWS of a voluminous family — the general ledger's journal postings, bank-feed statement lines, the reconciled bank transactions those lines become, every payslip a pay run emits, and every computed report or financial statement. Their existence, their operations, their response shape and their disposition ARE held, one `family` row each; what is never published is a row per record. This is the owner's own bound on 'everything reachable' (`docs/atlas-intent/06-holdings.md`), and it is a disposition rather than an exclusion: the family was looked at and deliberately not stored whole, which is a different fact from nobody having looked",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "journal postings, bank-feed statement lines, reconciled bank transactions, payslips and computed reports are all emitted as the ledger moves rather than authored as configuration",
        wouldBeMeasuredBy: "`GET /api.xro/2.0/Journals` paged to exhaustion once a Xero OAuth connection is configured",
      },
    },
    {
      because:
        "the ROWS of every other family too, today, for a different and temporary reason: this atlas ships no live Xero OAuth acquisition path, so nothing has been ingested at all. That is a `not-configured` coverage cell and one gap per holdable family rather than a design decision, and each names the credential that would close it",
      ground: "not-fetched",
      wouldBeClosedBy: "configuring a Xero OAuth connection, which each family's `not-configured` cell already names",
    },
    {
      because:
        "any financial VALUE, from either channel. Every field a `method` row carries is a name — a verb, a path shape, a parameter, a response field — and the browser reduction stores field names and never bodies. An amount, a contact name or an account number has no slot in any schema here",
      ground: "names-not-values",
    },
    {
      because:
        "any settings or reporting page reachable only to a Xero role or subscription this login does not hold. Absent because it cannot be seen, which is a different fact from absent because it does not exist, and the browser channel's coverage cell carries which",
      ground: "not-fetched",
      wouldBeClosedBy: "a login holding the Xero role or subscription those settings and reporting pages need",
    },
    {
      because:
        "mutations of any kind — this atlas only ever reads, and the browser walk navigates without ever clicking. No verb in this module writes to Xero, and a generation records what was observed, never what this machine changed",
      ground: "never-acted",
    },
    {
      because:
        "every organisation this login can switch to but was not walked. A walk sees the organisation the client is currently in, and `account-organisations` is the declared page that says how many others there are",
      ground: "not-fetched",
      wouldBeClosedBy:
        "walking every organisation this login can switch to, rather than the one the client is currently in",
    },
  ],
  kinds: [...XERO_ATLAS_KINDS],
  platform: XERO_ATLAS_PLATFORM,
  question:
    "what can be reached in Xero — every operation the installed client declares with its parameters and " +
    "response fields, every page of the web client with the exact URL and a screenshot, and every " +
    "business-object family the books are made of, each saying whether its records are configuration this " +
    "atlas could hold or observations it never will",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas xero refresh",
  resyncSchedule: {
    kind: "manual-only",
    because:
      "the atlas's only live reach is a browser walk, which meets Xero's sign-in page whenever that session has lapsed, so a scheduled walk raises a sign-in card rather than a read; it is read on demand instead",
  },
  surfaces: [
    {
      denominator: {
        because:
          "the official `xero-node` SDK's method surface is compiled into this atlas's own registry, and that registry has not yet been split into methods reached and methods never called",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "sdk-declared",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because: "the Xero web client publishes no route manifest",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "browser-walk",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    WEB_CLIENT_DISCOVERY_SURFACE,
    {
      denominator: {
        because: "no live call has been made against this organisation",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "live-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "this atlas ships no live Xero OAuth 2.0 acquisition path. Filling this surface needs a client " +
        "id and secret from a Xero app and one organisation's consent to the accounting scopes; the only " +
        "Xero access the atlas has is a signed-in browser session, which `docs/atlas-intent/07-browser-fallback.md` makes the " +
        "ingest FALLBACK rather than the first reach. Until it is filled this atlas holds the whole map and " +
        "none of the books, and every family row says so",
    },
  ],
  visibilityScope:
    "the compiled channel reads the installed client on disk and carries no tenant at all; the browser " +
    "channel sees exactly what the signed-in person's own Xero role opens, which for an employee-only role " +
    "is the EMPLOYEE PORTAL rather than the accounting console — every console route redirecting to " +
    "payroll.xero.com, as `slopweaver atlas xero walk` measures; the unfilled live API would see whatever an OAuth connection's scopes " +
    "and one organisation's consent open. None implies another, and 'complete' here is always complete for " +
    "the surface named on the cell",
};
