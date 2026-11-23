/**
 * What the Datadog atlas declares about itself, including the four things it cannot yet do.
 *
 * ## No surface's status is READ from this file, and that is deliberate
 *
 * A descriptor's `status` is static, so a surface declared `filled` in source is filled on every install,
 * including one where the sync has never run or failed. So the literal below is a floor rather than an
 * answer: `surfaceFill.ts` derives `compiled-catalogue`'s status from what the manifest actually records —
 * every declared kind carrying a recorded success, not "most" and not "at least one" — and derives `api`'s
 * from the stored coverage CELLS, because one per-kind manifest timestamp cannot speak for three channels.
 * `readAdapter.ts` hands a reader THAT descriptor. `console` is derived from the `console-page` kind's own
 * cell and gaps (`consoleSurface.ts` writes them, `atlas datadog walk` is the verb): it flips when a walk
 * has attempted every declared route AND the live nav re-read on that run still matches the declared list,
 * never when a transport that could visit them is merely available.
 *
 * The sibling Slack atlas is the worked example of getting this wrong: it grades its browser surface synced
 * whenever pages-walked exceeds zero, while canon records it reached only one of the destinations it asked
 * for. "Reported N, reached one" is the failure this file refuses to repeat.
 *
 * ## Why THREE surfaces and not two, and why their NAMES are the channel names
 *
 * Each surface's `name` is exactly a member of `documents.ts`'s `DATADOG_CHANNELS`, and that is a contract
 * rather than a coincidence: `kit/contract.ts` documents `AtlasSource.surface` as "which
 * {@link AtlasSurface.name} produced this", so a stored observation whose channel is `api` while the
 * descriptor calls that surface `rest-api` points at a surface the catalogue does not declare. An
 * adversarial review pass caught exactly that mismatch in this file's first draft — the descriptor said
 * `rest-api`, the schema admitted only `api` — and `descriptor.test.ts` now asserts the two lists are
 * identical, because a test over `acquisition` values passed straight through it.
 *
 * `documents.ts` carries the reasoning for why there are three. The short version is that they answer three different questions —
 * does Datadog have this call at all, does this organisation answer it, and can the owner see it in the
 * console — and an investigation that cannot tell "this does not exist" from "this org has none of it"
 * gets the wrong answer for the right-looking reason.
 *
 * ## The browser surface's denominator is the live left nav, and that is the owner's rule rather than a guess
 *
 * The rule is that the WHOLE browser surface is reached and a subset is never accepted. Datadog publishes no
 * sitemap: MEASURED in the owner's own Chrome, the console's only
 * provider-owned navigation document is `GET /api/ui/cmd-k/navigation-mappings` — the command palette's
 * SHORTCUT table, whose distinct page routes are a subset of the console's pages — and the app-shell
 * `/config` carries no route or menu key. A walk reporting "N of N" against that would have been the Slack
 * atlas's "reported N, reached one" failure in a new costume, and a subset, so the surface stayed unfilled
 * until a real denominator existed.
 *
 * The real denominator is the console's own left nav. The owner chose re-reading that nav LIVE over
 * accepting the earlier recon's page list as it stood; `consolePages.ts`
 * is that read, one hover per section in the owner's own Chrome, with the three exclusions it makes
 * stated by rule. Two things keep a hand-carried list from being a lie: `atlas datadog walk` re-reads the nav
 * through the `datadog-nav-observe` arm on every run and raises `console-nav-drifted` in both directions,
 * and a route that redirects somewhere the list does not carry raises `console-route-undeclared`. Falcon's
 * 606-href sitemap is still the better kind of denominator — provider-published rather than provider-
 * rendered — and this file says so rather than claiming parity.
 *
 * ## `src/datadog/shot/` reaches a browser, and is still not this surface
 *
 * Worth stating precisely, because the loose version of this sentence is wrong in a way a reader would act
 * on. `shot/` DOES reach the console: `plan.ts` emits an `ExtensionBrief` (`src/browser/brief.ts`) and
 * `panelScript.ts`/`explorerScript.ts` are page-side functions Playwright evaluates inside the Datadog page.
 * What it does not do is LAUNCH anything or drive the walk transport itself — it briefs the visible session,
 * which carries the walk out in the owner's own Chrome, and then grades what comes back (`shot/proof.ts`,
 * `shot/write.ts`). So it is a PROOF lane: one address, one image, judged. A surface is filled by pages
 * actually reached against a denominator, and `shot/` neither enumerates pages nor has one.
 */
import type { AtlasDescriptor } from "../kit/contract.js";

import { DATADOG_CONSOLE_NAV_READ_AT, DATADOG_CONSOLE_ROUTES } from "./consolePages.js";
import { DATADOG_ATLAS_PLATFORM, DATADOG_KINDS, DATADOG_VISIBILITY_SCOPE } from "./model.js";

/** Datadog's atlas, as it declares itself. */
export const DATADOG_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "read-before-write",
  excludes: [
    {
      because:
        "988 operations that are inventoried and never called. 950 of them are writes — this atlas only ever reads, and the registry has no callable variant for one, so a mutation is unreachable rather than merely unused. Four are individual decisions, and two of those are secret-bearing: `GET /api/v1/api_key/{key}` and `GET /api/v1/application_key/{key}` take the credential AS THE PATH PARAMETER, so no projection of a response can undo a secret in a URL. The remaining 34 are the `synthetics` kind, excluded whole under the separate entry below",
      ground: "never-acted",
    },
    {
      because:
        "the other two individual decisions, both side-effecting GETs, which is why an HTTP method decides nothing here: `GET /api/v1/graph/snapshot` renders a widget in a web page and uploads the image to cloud storage, and `GET /api/v2/cost/tag_descriptions/{tag_key}/generate` invokes Datadog's own AI to write a draft description. Each is kept out for what it DOES",
      ground: "never-acted",
    },
    {
      because:
        "occurrence bodies and metric points, across 90 operations. Logs, spans, RUM events and session replay, audit and event-stream entries, CI pipeline and test events, security signals and findings, LLM Observability spans, product-analytics per-user rows, live process and container inventories, and hourly billing rows all get the shape-index treatment instead — synthetic test results were among them and are now refused with the rest of their kind — which attribute paths exist and what types appear at them, never an entry and never a value outside a closed set of structural facets. This is the owner's scope rule, 'everything reachable minus the voluminous', and the CONFIGURATION behind every one of those families is held in full",
      ground: "shape-index",
      volume: {
        basis: "measured",
        establishedBy:
          'slopweaver datadog raw --method POST --path /api/v2/logs/analytics/aggregate --body \'{"compute":[{"aggregation":"count","type":"total"}],"filter":{"from":"2026-09-09T00:00:00Z","to":"2026-09-10T00:00:00Z","query":"*"}}\' — the aggregate endpoint rather than the `events/search` page this row used to name, because a search returns a page and this returns the window\'s own total',
        magnitude:
          "the live LOGS event total for the command's single UTC-day window, on this organisation — the LOGS family alone, one of the families this row covers, and a per-day total that a year multiplies before spans, RUM events, session replay or metric points are counted at all",
        unboundedBecause:
          "logs, spans, RUM events, session replay, audit entries, CI events, security signals, live process inventories and hourly billing rows are all per-instant emissions rather than configuration anybody authored",
      },
    },
    {
      because:
        "credential material inside responses this atlas legitimately reads — an API or application key value, an OAuth client secret, an AWS access key id and secret access key, a GCP private key, an integration's outbound token, a synthetics client-certificate private key, a private location's secrets, a workflow's webhook secret, and a public-dashboard share token. See sensitiveFields.ts; each denial is scoped to the kinds where the name carries material, because the same names are a case identifier, a feature-flag key and a tag key elsewhere",
      ground: "secret-material",
    },
    {
      because:
        "the `synthetics` kind whole — all 69 of its operations, 34 of them refused for this reason and the other 35 already refused as writes. The synthetics response models carry free-form fields where a test's credentials live, and this atlas has no allowlist projection for them yet. It is an `unsupported-sensitive-shape` exclusion in exclusions.ts, the one reason on that list about this atlas rather than the operation, and the allowlist projection sensitiveFields.ts specifies is what admits the kind",
      ground: "never-acted",
    },
    {
      because:
        "everything Datadog's own API does not expose to the two keys, plus the endpoints the installed SDK does not declare at all — `/api/v1/logs-analytics/*` is the known example, reachable through `slopweaver datadog raw` and outside this atlas's closed acquisition registry",
      ground: "not-fetched",
      wouldBeClosedBy:
        "declaring `/api/v1/logs-analytics/*` and the other undeclared endpoints in this atlas's acquisition registry rather than leaving them to `slopweaver datadog raw`",
    },
  ],
  kinds: [...DATADOG_KINDS],
  platform: DATADOG_ATLAS_PLATFORM,
  question:
    "what does Datadog hold for this organisation and what can be asked of it — every operation the pinned client declares and what this atlas does with each, plus the monitors, dashboards, SLOs, notebooks, synthetics, service catalogue, log and metric configuration, security rules, teams, roles and integrations themselves",
  // A day rather than the four-hour default, because of the census step below: the census stamps
  // its build an hour after its own window closes (`manifest.json`'s `builtAtIso` against
  // `window.toIso`), and six hour-long sweeps a day against a 5-per-minute span-search limit is spend, not
  // freshness. `slopweaver automation resync --list | grep datadog` shows the cadence this derives.
  freshnessWindow: "24h",
  // The census rides the same scheduled row, AFTER the surface map: it is what `store detect`, `turn brief`
  // and `route plan` match a question against, and nothing else rebuilds it. Its step
  // needs the Datadog keys, which the surface-map step never did, so an install without them now reports
  // this row FAILED — deliberately: a census nobody can rebuild is one every detective silently trusts. The
  // attempt is judged on the atlas clock plus the exit code; the census's own `builtAtIso` is not re-read.
  resyncCommand: "slopweaver atlas datadog sync && slopweaver datadog catalogue build --from 7d",
  surfaces: [
    {
      denominator: {
        because:
          "Datadog publishes no catalogue of its `compiled-catalogue` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "compiled-catalogue",
      role: "discovery",
      status: "declared-unfilled",
      unfilledBecause:
        "`slopweaver atlas datadog sync` has not been run on this installation, so no generation carries the registry yet. It needs no credential and makes no request — `surfaceFill.ts` flips this to filled once every declared kind carries a recorded success, and a reader is always handed the DERIVED status rather than this literal",
    },
    {
      denominator: {
        because:
          "Datadog publishes no catalogue of its `api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "`atlas datadog sync --live` asks this organisation the 329 entity operations that take no path parameter, and `surfaceFill.ts` derives this surface's real status from what the stored `api` coverage cells record — so the literal here is the floor, read only on an install where that pass has never run. FOUR remainders keep it unfilled and each is enumerated per kind rather than summarised: 325 entity operations take an identifier and need a FAN-OUT from an already-stored entity; 97 of the 329 walk a collection and this pass keeps their first page, because it will not guess where a cursor lives in a response body; every one of the 326 response boundaries whose operation no census measured answering holds only the specification's field names, so an answer one admits has every value unread until a fresh census regenerates it; and all 90 shape-index operations need a windowed pass that folds an occurrence family into attribute paths. MEASURED on the first live pass against this install's site, before any response boundary existed: not every one of the 329 answered, and some kinds returned a 400 naming a required QUERY parameter — which is the same class as a path parameter one field over, and is why the sentence 'takes no path parameter' names the tractable half only approximately. Every registry figure here counts the registry after the `synthetics` kind was excluded whole with reason `unsupported-sensitive-shape`. Reproduce the 329 with `yarn tsx tools/datadogKindCensus.ts` beside `generated/surfaces.ts`",
    },
    {
      denominator: {
        exists: DATADOG_CONSOLE_ROUTES.length,
        known: true,
        reached: 0,
        source: `the console's own left nav, read live in the owner's Chrome on ${DATADOG_CONSOLE_NAV_READ_AT} (consolePages.ts) — every page every section's fly-out offers, this organisation's own resources and off-origin links excluded by rule; \`reached\` is derived from the last walk by surfaceFill.ts`,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "console",
      role: "corroborating",
      status: "declared-unfilled",
      unfilledBecause:
        "`slopweaver atlas datadog walk` has not run on this installation. The denominator is settled: Datadog publishes no sitemap, and the owner took the LIVE left nav as the bounded page list over the earlier recon — read in the owner's own Chrome and declared in consolePages.ts, re-read by every walk so drift is a gap rather than a silence. `surfaceFill.ts` flips this to filled once a walk has attempted every declared route AND the live nav still matches the list; a reader is always handed the DERIVED status rather than this literal",
    },
  ],
  visibilityScope: DATADOG_VISIBILITY_SCOPE,
};
