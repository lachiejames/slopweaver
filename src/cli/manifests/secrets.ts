/**
 * Lazy manifest for the `secrets` noun — transcript-safe connector-token capture (`set`) and the store's
 * READ side (`status`). A bare `slopweaver secrets` falls through to usage. Each command module loads only
 * when dispatched, so the stdin/fs edge stays off every unrelated invocation's load path.
 *
 * `status` exists because for months this noun had a write side and nothing else: the owner's only view of
 * their own credential store was `ls`, which cannot say what a file reaches, whether it was minted read-only,
 * when it expires, or whether anything still reads it at all.
 */
import { SECRETS_STATUS_USAGE } from "../commands/secrets/statusUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const secretsSetMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver secrets set slack-user-token",
  parseRejectIsIoFree: true,
  summary:
    "Persist a connector token to $SLOPWEAVER_HOME/secrets/<name> (0600) — no-echo prompt or piped stdin, never argv",
  usage: "usage: slopweaver secrets set <name> [--stdin] [--home <dir>] [--json]",
} as const;

const secretsStatusMeta = {
  createsWorkItem: false,
  // Not a diagnostic: it always exits 0. A finding is REPORTED — in the findings block a reader sees first,
  // and in every row's `state` under `--json` — never signalled by an exit code a pipe would trip over.
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver secrets status",
  parseRejectIsIoFree: true,
  summary:
    "List every credential in $SLOPWEAVER_HOME/secrets with its platform, scope, expiry and reader — and never a value",
  usage: SECRETS_STATUS_USAGE,
} as const;

const loadSet = () => import("../commands/secrets/run.js").then((m) => m.secretsSetCommand);
const loadStatus = () => import("../commands/secrets/statusRun.js").then((m) => m.secretsStatusCommand);

export const secretsManifest: Readonly<Record<string, VerbManifestEntry>> = {
  set: lazy({ load: loadSet, meta: secretsSetMeta }),
  status: lazy({ load: loadStatus, meta: secretsStatusMeta }),
};
