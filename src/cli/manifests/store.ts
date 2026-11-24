/**
 * Lazy manifest for the `store` noun — the typed query layer over the local Supabase.
 *
 * The bare noun resolves to `status` (read-only), so a bare `slopweaver store` can never start an ingest
 * by accident, the same rule `lexical` follows for the same reason.
 */
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";
import { storeAuthoredManifest } from "./storeAuthored.js";
import { backfillVerbs } from "./storeBackfillMeta.js";
import * as backupFamily from "./storeBackup.js";
import { aroundMeta, detectMeta, groupsMeta, hitsMeta, openMeta, peekMeta, probeMeta } from "./storeDetectiveMeta.js";
import { measurementVerbs } from "./storeMeasurementMeta.js";
import { projectionVerbs } from "./storeProjectionMeta.js";
import { citeMeta, readMeta, readMetaFanout } from "./storeQueryMeta.js";
import * as transferFamily from "./storeTransfer.js";

const statusMeta = {
  ...readMeta,
  example: "slopweaver store status --check",
  summary: "Report what the store holds, whether it is reachable, and how far behind bronze it sits",
  usage: "usage: slopweaver store status [--home <dir>] [--json] [--source <s>] [--full] [--check]",
} as const;

const shareMeta = {
  ...readMeta,
  example: "slopweaver store share --json",
  summary: "What each record kind still holds under ~/.slopweaver, against the store table it mirrors into",
  usage: "usage: slopweaver store share [--home <dir>] [--json]",
} as const;

const queryMeta = {
  ...readMeta,
  example: 'slopweaver store query --source slack --search "staging pool" --limit 20',
  summary: "List and filter the store's content rows by source, kind, container, author, time or full text",
  usage:
    "usage: slopweaver store query [--home <dir>] [--source <s>] [--kind <k>] [--container <c>] [--author <a>] [--person <name>] [--since <iso>] [--until <iso>] [--search <text>] [--contains <literal>] [--like <pattern>] [--visibility <v>] [--thread <native-id>] [--channel <c>] [--repo <o/r>] [--team <t>] [--assignee <a>] [--state <s>] [--limit <n>] [--offset <n>] [--json]",
} as const;

const facetsMeta = {
  ...readMeta,
  example: "slopweaver store facets --facet container --source slack",
  summary: "Count the rows a filter selects, grouped by one indexed column, largest group first",
  usage:
    "usage: slopweaver store facets [--home <dir>] [--facet <f>] [--source <s>] [--kind <k>] [--container <c>] [--author <a>] [--person <name>] [--since <iso>] [--until <iso>] [--search <text>] [--contains <literal>] [--like <pattern>] [--visibility <v>] [--thread <native-id>] [--channel <c>] [--repo <o/r>] [--team <t>] [--assignee <a>] [--state <s>] [--limit <n>] [--offset <n>] [--json]",
} as const;

const detailMeta = {
  ...readMeta,
  example: "slopweaver store detail --source slack --id c-random:1000000000.000001",
  summary: "Retrieve one row whole, addressed by the source and native id a citation already carries",
  usage: "usage: slopweaver store detail --source <s> --id <native-id> [--home <dir>] [--json]",
} as const;

const ingestMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store ingest --file ~/.slopweaver/corpus/bronze/slack/6d_2026-09-08.jsonl --limit 1000",
  parseRejectIsIoFree: true,
  summary: "Read one bronze .jsonl into the store, a bounded slice at a time, reporting every record it refused",
  usage:
    "usage: slopweaver store ingest --file <path.jsonl> --limit <n> [--from <byte>] [--all] [--home <dir>] [--json]\n" +
    "       slopweaver store ingest --source <s> --limit <n> [--all] [--from-file <basename>] [--home <dir>] [--json]\n" +
    "  --limit is the PER-SLICE record ceiling (the heap bound), never a ceiling on the run.\n" +
    "  --source reads that source's whole bronze in bronze read order — compact.jsonl first, then window\n" +
    "  files by name, which is what decides whose capture wins the upsert. --all reads each file to its\n" +
    "  end; without it, one bounded slice per file, a cheap pass that reports what a source will refuse.\n" +
    "  --from-file resumes at a named file. --from is a byte offset into ONE file and is refused with\n" +
    "  --source; --from-file is refused with --file. A file or source reaching a no-access path on the\n" +
    "  owner's protect list is refused before anything is read or the store is opened.",
} as const;

const identityMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store identity --pull",
  parseRejectIsIoFree: true,
  summary:
    "Build the store's people from the Google Workspace directory (email the key, each platform's id a column) and the member pull, and point every content row's author at them; --pull reads the directory through the Google Admin grant first",
  usage: "usage: slopweaver store identity [--pull] [--home <dir>] [--json]",
} as const;

const collectMeta = {
  ...readMeta,
  example: "slopweaver store collect --plan ~/.slopweaver/fanout/<slug>/plan.json --replies ./replies.json",
  summary: "Check what the fan-out readers returned against the shard each was given, keeping only quoted evidence",
  usage: "usage: slopweaver store collect --plan <path> --replies <file.json> [--json]",
} as const;

const loadMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store load --days 7 --cap 10000",
  parseRejectIsIoFree: true,
  summary: "Repull one week from every provider straight into the store — never from a bronze file",
  usage:
    "usage: slopweaver store load [--source <a,b>] [--days <n>] [--cap <n>] [--github-org <org>] [--home <dir>] [--json]",
} as const;

const lifecycleMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  parseRejectIsIoFree: true,
} as const;

const pushMeta = {
  ...lifecycleMeta,
  example: "slopweaver store push",
  summary:
    "Generate a migration from the schema if it changed, apply everything pending to the local store, then read the database back and refuse to call it done unless it matches",
  usage: "usage: slopweaver store push [--no-generate] [--home <dir>] [--json]",
} as const;

const verifyMeta = {
  ...readMeta,
  example: "slopweaver store verify",
  summary:
    "Read the local store back against the schema — every declared table, policy, grant, enum label, extension and role — and the store lock, and report each disagreement",
  usage: "usage: slopweaver store verify [--workdir <checkout>] [--home <dir>] [--json]",
} as const;

const baselineMeta = {
  ...lifecycleMeta,
  example: "slopweaver store baseline --through 0000_polite_lady_mastermind",
  summary:
    "Record migrations as already applied on a database whose tables were created by hand, after checking the catalog agrees with the tag named",
  usage: "usage: slopweaver store baseline --through <tag> [--home <dir>] [--json]",
} as const;

const resetMeta = {
  ...lifecycleMeta,
  example: "slopweaver store reset --acknowledge slopweaver_small",
  summary:
    "Drop everything in one LOCAL database and rebuild it from the schema — the flag must name the database, and no hatch reaches another host",
  usage: "usage: slopweaver store reset --acknowledge <database> [--home <dir>] [--json]",
} as const;

const lockMeta = {
  ...lifecycleMeta,
  example: "slopweaver store lock",
  summary:
    "Close the local stack's password doors from this Mac: the verbs' own login only, earlier sessions ended, the API roles' table rights revoked — each proven by behaviour",
  usage: "usage: slopweaver store lock [--rotate] [--workdir <checkout>] [--home <dir>] [--json]",
} as const;

const startMeta = {
  ...lifecycleMeta,
  example: "slopweaver store start",
  summary: "Start the local Supabase stack through the pinned CLI, then lock it — what `yarn store:start` runs",
  usage: "usage: slopweaver store start [--rotate] [--workdir <checkout>] [--home <dir>] [--json]",
} as const;

const loadStatus = () => import("../commands/store/statusRun.js").then((m) => m.storeStatusCommand);

export const storeManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadStatus, meta: statusMeta }),
  backup: lazy({
    load: () => import("../commands/store/backup.js").then((m) => m.storeBackupCommand),
    meta: backupFamily.backupMeta,
  }),
  "backup-register": lazy({
    load: () => import("../commands/store/backup.js").then((m) => m.storeBackupRegisterCommand),
    meta: backupFamily.backupRegisterMeta,
  }),
  restore: lazy({
    load: () => import("../commands/store/restoreRun.js").then((m) => m.storeRestoreCommand),
    meta: backupFamily.restoreMeta,
  }),
  rehearse: lazy({
    load: () => import("../commands/store/rehearseRun.js").then((m) => m.storeRehearseCommand),
    meta: backupFamily.rehearseMeta,
  }),
  recover: lazy({
    load: () => import("../commands/store/recoverRun.js").then((m) => m.storeRecoverCommand),
    meta: backupFamily.recoverMeta,
  }),
  exclusions: lazy({
    load: () => import("../commands/store/exclusion.js").then((m) => m.storeExclusionsCommand),
    meta: backupFamily.exclusionsMeta,
  }),
  export: lazy({
    load: () => import("../commands/store/transferRun.js").then((m) => m.storeExportCommand),
    meta: transferFamily.exportMeta,
  }),
  import: lazy({
    load: () => import("../commands/store/transferRun.js").then((m) => m.storeImportCommand),
    meta: transferFamily.importMeta,
  }),
  "import-resolve": lazy({
    load: () => import("../commands/store/importResolveRun.js").then((m) => m.storeImportResolveCommand),
    meta: transferFamily.importResolveMeta,
  }),
  "import-questions": lazy({
    load: () => import("../commands/store/importQuestionsRun.js").then((m) => m.storeImportQuestionsCommand),
    meta: transferFamily.importQuestionsMeta,
  }),
  detail: lazy({
    load: () => import("../commands/store/run.js").then((m) => m.storeDetailCommand),
    meta: detailMeta,
  }),
  facets: lazy({
    load: () => import("../commands/store/run.js").then((m) => m.storeFacetsCommand),
    meta: facetsMeta,
  }),
  share: lazy({
    load: () => import("../commands/store/shareRun.js").then((m) => m.storeShareCommand),
    meta: shareMeta,
  }),
  identity: lazy({
    load: () => import("../commands/store/run.js").then((m) => m.storeIdentityCommand),
    meta: identityMeta,
  }),
  ingest: lazy({
    load: () => import("../commands/store/ingestRun.js").then((m) => m.storeIngestCommand),
    meta: ingestMeta,
  }),
  ...projectionVerbs,
  ...storeAuthoredManifest,
  ...measurementVerbs,
  collect: lazy({
    load: () => import("../commands/store/read.js").then((m) => m.storeCollectCommand),
    meta: collectMeta,
  }),
  load: lazy({ load: () => import("../commands/store/load.js").then((m) => m.storeLoadCommand), meta: loadMeta }),
  ...backfillVerbs,
  // The progressive-disclosure ladder, in the order a detective climbs it. See `src/cli/commands/store/probe.ts`
  // for the counting rungs and `src/cli/commands/store/probeDisclose.ts` for the reading rungs.
  probe: lazy({ load: () => import("../commands/store/probe.js").then((m) => m.storeProbeCommand), meta: probeMeta }),
  groups: lazy({
    load: () => import("../commands/store/probe.js").then((m) => m.storeGroupsCommand),
    meta: groupsMeta,
  }),
  hits: lazy({ load: () => import("../commands/store/probe.js").then((m) => m.storeHitsCommand), meta: hitsMeta }),
  peek: lazy({
    load: () => import("../commands/store/probeDisclose.js").then((m) => m.storePeekCommand),
    meta: peekMeta,
  }),
  open: lazy({
    load: () => import("../commands/store/probeDisclose.js").then((m) => m.storeOpenCommand),
    meta: openMeta,
  }),
  around: lazy({
    load: () => import("../commands/store/probeDisclose.js").then((m) => m.storeAroundCommand),
    meta: aroundMeta,
  }),
  detect: lazy({
    load: () => import("../commands/store/detect.js").then((m) => m.storeDetectCommand),
    meta: detectMeta,
  }),
  query: lazy({ load: () => import("../commands/store/run.js").then((m) => m.storeQueryCommand), meta: queryMeta }),
  // The lifecycle, in the order a database moves through it. See `src/store/lifecycle.ts`.
  push: lazy({
    load: () => import("../commands/store/lifecycleRun.js").then((m) => m.storePushCommand),
    meta: pushMeta,
  }),
  verify: lazy({
    load: () => import("../commands/store/lifecycleRun.js").then((m) => m.storeVerifyCommand),
    meta: verifyMeta,
  }),
  baseline: lazy({
    load: () => import("../commands/store/lifecycleRun.js").then((m) => m.storeBaselineCommand),
    meta: baselineMeta,
  }),
  reset: lazy({
    load: () => import("../commands/store/lifecycleRun.js").then((m) => m.storeResetCommand),
    meta: resetMeta,
  }),
  read: lazy({ load: () => import("../commands/store/read.js").then((m) => m.storeReadCommand), meta: readMetaFanout }),
  cite: lazy({ load: () => import("../commands/store/cite.js").then((m) => m.storeCiteCommand), meta: citeMeta }),
  status: lazy({ load: loadStatus, meta: statusMeta }),
  lock: lazy({ load: () => import("../commands/store/lockRun.js").then((m) => m.storeLockCommand), meta: lockMeta }),
  start: lazy({ load: () => import("../commands/store/lockRun.js").then((m) => m.storeStartCommand), meta: startMeta }),
};
