/**
 * Lazy manifest for the `connect` noun — the read-only source preflight. `connect <source>` (the bare
 * default) and `connect check <source>` both resolve to the one handler; the SDK-probe module loads only
 * when dispatched, keeping the connector clients off every unrelated invocation's load path.
 *
 * The targets are every integration whose manifest has a `connect` feature (`CONNECT_TARGETS`,
 * `src/integrations/corpusSources.ts`). Five of the seven feed the corpus, `gmail` among them through a consented
 * grant rather than a token. `datadog` and `outlook` do not: they are live connectors read at question time, and
 * live on this verb because "can this credential reach the thing, and what may it do there" is the same question
 * regardless of whether the answer ends up in bronze.
 */
import { CONNECT_USAGE } from "../commands/connect/connectUsage.js";
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

const connectMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: false,
  effect: "external-read",
  example: "slopweaver connect slack --check --json",
  parseRejectIsIoFree: true,
  summary: "Preflight a source: reachability + the exact scopes/capabilities it needs (+ a 1-item read)",
  usage:
    `${CONNECT_USAGE}\n` +
    "  gmail differs from the other four: it reports the user-consented GRANT's scopes per verb family, and\n" +
    "  a declined optional scope is a warning rather than a failure. --home selects the grant's state home\n" +
    "  datadog resolves the site (profile.json datadog.site, or DD_SITE) and both keys (the secrets store, or\n" +
    "  DD_API_KEY/DD_APP_KEY) from --home's state home, verifies them, and names the site's own key pages\n" +
    "  outlook reports the app registration (outlook-client-id), the stored grant's tiers (read/manage/send)\n" +
    "  and one live GET /me, which refreshes the token silently and may rotate the stored cache",
} as const;

const loadConnect = () => import("../commands/connect/run.js").then((m) => m.connectCheckCommand);

export const connectManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadConnect, meta: connectMeta }),
  check: lazy({ load: loadConnect, meta: connectMeta }),
};
