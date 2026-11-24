/**
 * The help-truth tables' rows for `refresh`, `chatgpt`, `subset`, `cycle`, `memory` and `onboard` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseExportVerbArgs } from "../../../../cli/commands/chatgpt/exportRun.js";
import { parseListArgs } from "../../../../cli/commands/chatgpt/listRun.js";
import { parseLiveSyncArgs } from "../../../../cli/commands/chatgpt/liveSyncRun.js";
import { parseConversationArgs, parseImportRequestArgs } from "../../../../cli/commands/chatgpt/run.js";
import {
  CHATGPT_CONVERSATION_FLAG_NAMES,
  CHATGPT_IMPORT_EXPORT_FLAG_NAMES,
  CHATGPT_IMPORT_REQUEST_FLAG_NAMES,
  CHATGPT_LIST_FLAG_NAMES,
  CHATGPT_LIVE_SYNC_FLAG_NAMES,
  CHATGPT_SYNC_FLAG_NAMES,
} from "../../../../cli/commands/chatgpt/usage.js";
import { CYCLE_RECONCILE_FLAG_NAMES, parseReconcileOptions } from "../../../../cli/commands/cycle/core.js";
import { MEMORY_GATE_FLAG_NAMES, parseMemoryGateArgs } from "../../../../cli/commands/memory/gateRun.js";
import {
  MEMORY_GRADE_FLAG_NAMES,
  MEMORY_HYGIENE_FLAG_NAMES,
  parseMemoryGradeArgs,
  parseMemoryHygieneArgs,
} from "../../../../cli/commands/memory/hygiene.js";
import { MEMORY_OVERLAPS_FLAG_NAMES, parseMemoryOverlapsArgs } from "../../../../cli/commands/memory/overlapsRun.js";
import { parseMemoryPassesArgs } from "../../../../cli/commands/memory/passesRun.js";
import {
  MEMORY_CHECK_FLAG_NAMES,
  MEMORY_HOOK_FLAG_NAMES,
  MEMORY_SWEEP_FLAG_NAMES,
  parseMemoryCheckArgs,
  parseMemoryHookArgs,
  parseMemorySweepArgs,
} from "../../../../cli/commands/memory/run.js";
import { ONBOARD_FLAG_NAMES, parseOnboardArgs } from "../../../../cli/commands/onboard/core.js";
import { ONBOARD_EVAL_FLAG_NAMES, parseOnboardEvalArgs } from "../../../../cli/commands/onboard/evalCore.js";
import { ONBOARD_PLAN_FLAG_NAMES, parseOnboardPlanArgs } from "../../../../cli/commands/onboard/planCore.js";
import { parseRefreshOptions } from "../../../../cli/commands/refresh/core.js";
import { REFRESH_FLAG_NAMES } from "../../../../cli/commands/refresh/flags.js";
import {
  parseSubsetBuildOptions,
  parseSubsetStatusOptions,
  SUBSET_BUILD_FLAG_NAMES,
  SUBSET_STATUS_FLAG_NAMES,
} from "../../../../cli/commands/subset/core.js";
import {
  ONBOARD_WORKSTREAMS_FLAG_NAMES,
  parseOnboardWorkstreamsArgs,
} from "../../../../cli/commands/workstreams/core.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "chatgpt conversation": CHATGPT_CONVERSATION_FLAG_NAMES,
  "chatgpt import-export": CHATGPT_IMPORT_EXPORT_FLAG_NAMES,
  "chatgpt import-request": CHATGPT_IMPORT_REQUEST_FLAG_NAMES,
  "chatgpt list": CHATGPT_LIST_FLAG_NAMES,
  "chatgpt live-sync": CHATGPT_LIVE_SYNC_FLAG_NAMES,
  "chatgpt sync": CHATGPT_SYNC_FLAG_NAMES,
  "subset build": SUBSET_BUILD_FLAG_NAMES,
  subset: SUBSET_STATUS_FLAG_NAMES,
  "subset status": SUBSET_STATUS_FLAG_NAMES,
  cycle: CYCLE_RECONCILE_FLAG_NAMES,
  "cycle reconcile": CYCLE_RECONCILE_FLAG_NAMES,
  "memory check": MEMORY_CHECK_FLAG_NAMES,
  "memory gate": MEMORY_GATE_FLAG_NAMES,
  "memory grade": MEMORY_GRADE_FLAG_NAMES,
  "memory hook": MEMORY_HOOK_FLAG_NAMES,
  "memory hygiene": MEMORY_HYGIENE_FLAG_NAMES,
  "memory overlaps": MEMORY_OVERLAPS_FLAG_NAMES,
  "memory passes": ["--home", "--json"],
  "memory sweep": MEMORY_SWEEP_FLAG_NAMES,
  onboard: ONBOARD_FLAG_NAMES,
  "onboard eval": ONBOARD_EVAL_FLAG_NAMES,
  "onboard plan": ONBOARD_PLAN_FLAG_NAMES,
  "onboard workstreams": ONBOARD_WORKSTREAMS_FLAG_NAMES,
  "onboard run": ONBOARD_FLAG_NAMES,
  refresh: REFRESH_FLAG_NAMES,
  "refresh run": REFRESH_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "memory passes": { "--home": ["--home", "/tmp"], "--json": ["--json"] },
  "chatgpt conversation": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--max-pages": ["--max-pages", "5"],
  },
  "chatgpt list": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--max-pages": ["--max-pages", "5"],
  },
  "chatgpt live-sync": {
    "--home": ["--home", "/tmp"],
    "--max-conversations": ["--max-conversations", "5"],
    "--max-pages": ["--max-pages", "5"],
    "--relist": ["--relist"],
  },
  "chatgpt import-export": {
    "--from": ["--from", "/tmp/export.zip"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "chatgpt import-request": {
    "--from": ["--from", "/tmp/request.txt"],
    "--home": ["--from", "/tmp/request.txt", "--home", "/tmp"],
    "--json": ["--from", "/tmp/request.txt", "--json"],
  },
  "chatgpt sync": {
    "--from": ["--from", "/tmp/export.zip"],
    "--home": ["--home", "/tmp"],
    "--replay": ["--replay"],
  },
  "cycle reconcile": {
    // `--post` is refused on its own by design (this verb composes and never sends), so its valid
    // invocation is the pair — which is exactly the contract its help advertises.
    "--dry-run": ["--dry-run"],
    "--form": ["--form"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-01T00:00:00.000Z"],
    "--post": ["--post", "--dry-run"],
    "--verify": ["--verify"],
    "--write": ["--write"],
  },
  "subset build": {
    "--days": ["--days", "7"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "500"],
    "--out": ["--out", "/tmp/subset-probe"],
  },
  "subset status": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "memory check": {
    "--dir": ["--dir", "/tmp"],
    "--json": ["--json"],
  },
  "memory gate": {
    "--accept": ["--accept"],
    "--install": ["--install"],
    "--json": ["--json"],
  },
  "memory grade": {
    "--home": ["--home", "/tmp"],
    "--why": ["--why", "the ruling date is the point"],
  },
  "memory hook": {
    "--dir": ["--dir", "/tmp"],
    "--from-payload": ["--from-payload"],
  },
  "memory hygiene": {
    "--also-repo": ["--also-repo", "/tmp"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-18T08:00:00.000Z"],
    "--repo": ["--repo", "/tmp"],
  },
  "memory overlaps": {
    "--dir": ["--dir", "/tmp"],
    "--json": ["--json"],
    "--repo": ["--repo", "/tmp"],
  },
  "memory sweep": {
    "--dir": ["--dir", "/tmp"],
    "--json": ["--json"],
    "--stale-after": ["--stale-after", "90"],
  },
  onboard: {
    "--app-name": ["--app-name", "Team Brain"],
    "--identity": ["--identity", "ada-lovelace"],
    "--json": ["--json"],
    "--mailbox-zone": ["--mailbox-zone", "example.org"],
    "--tier": ["--tier", "restricted"],
  },
  "onboard eval": {
    "--eval-home": ["--eval-home", "/tmp"],
    "--file-findings": ["--file-findings", "3"],
    "--json": ["--json"],
    "--repo": ["--repo", "/tmp"],
    "--run": ["--run", "/tmp/run.json"],
    "--schema": ["--schema"],
  },
  "onboard plan": {
    "--backfill": ["--sources", "slack", "--backfill", "90"],
    "--github-org": ["--sources", "github", "--backfill", "90", "--repo", "owner/name", "--github-org", "owner"],
    "--json": ["--sources", "slack", "--backfill", "90", "--json"],
    "--repo": ["--sources", "github", "--backfill", "90", "--repo", "owner/name", "--github-org", "owner"],
    "--sources": ["--sources", "slack", "--backfill", "90"],
  },
  "onboard workstreams": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  refresh: {
    "--accept-full-history": ["--accept-full-history"],
    "--all": ["--all"],
    "--all-repos": ["--all-repos"],
    "--all-sources": ["--all-sources"],
    "--coverage": ["--coverage"],
    "--exclude-repo": ["--exclude-repo", "owner/repo"],
    "--fetch-cap": ["--fetch-cap", "1"],
    "--github-org": ["--github-org", "an-org"],
    "--github-page-cap": ["--github-page-cap", "20"],
    "--home": ["--home", "/tmp"],
    "--if-stale": ["--if-stale", "--all-sources"],
    "--include-repo": ["--include-repo", "owner/repo"],
    "--jit": ["--jit", "--source", "github"],
    "--lookback-days": ["--lookback-days", "1"],
    "--no-derive": ["--no-derive"],
    "--no-notion-attachments": ["--no-notion-attachments"],
    "--no-enrich": ["--no-enrich"],
    // The three Notion cap flags each refuse without `--source notion` beside them, and the two that LIFT a
    // bound refuse without a per-item time bound — so the probe fragment carries what makes each coherent.
    "--notion-block-depth": ["--source", "notion", "--notion-block-depth", "50", "--notion-item-time", "30m"],
    "--notion-item-calls": ["--source", "notion", "--notion-item-calls", "5000", "--notion-item-time", "30m"],
    "--notion-item-time": ["--source", "notion", "--notion-item-time", "30m"],
    "--numbers-only": ["--numbers-only"],
    "--refetch-unchanged": ["--refetch-unchanged"],
    "--repo": ["--repo", "owner/repo"],
    "--repo-cap": ["--repo-cap", "1"],
    "--sample": ["--sample", "1"],
    "--self": ["--self"],
    "--self-exclude": ["--self-exclude", "reference/vendored"],
    "--self-root": ["--self-root", "/tmp"],
    "--since": ["--since", "2026-01-01"],
    "--slack-channel": ["--slack-channel", "a-channel-id"],
    "--slack-membership-cap": ["--slack-membership-cap", "1"],
    "--source": ["--source", "github"],
    "--store": ["--store", "--source", "github"],
    // `--stale-after-days` only parses ALONGSIDE `--if-stale` — a threshold with no flag to govern is a
    // usage error by design, so the probe states the pair the parser actually accepts.
    "--stale-after": ["--if-stale", "--all-sources", "--stale-after", "4h"],
    "--until": ["--until", "2026-01-02"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "memory passes": ({ fragment }) => parseMemoryPassesArgs({ rest: fragment }),
  // `conversation` needs its one positional id; `import-request` carries its required `--from` in each probe.
  "chatgpt conversation": ({ fragment }) =>
    parseConversationArgs({ rest: ["6aba18a1-5280-83ec-9115-b16ac7e6a181", ...fragment] }),
  "chatgpt import-request": ({ fragment }) => parseImportRequestArgs({ rest: [...fragment] }),
  "chatgpt list": ({ fragment }) => parseListArgs({ rest: [...fragment] }),
  "chatgpt live-sync": ({ fragment }) => parseLiveSyncArgs({ rest: [...fragment] }),
  "chatgpt import-export": ({ fragment }) => parseExportVerbArgs({ rest: [...fragment], verb: "import-export" }),
  "chatgpt sync": ({ fragment }) => parseExportVerbArgs({ rest: [...fragment], verb: "sync" }),
  // `--out` is required, so a fragment probing any OTHER flag has to carry it or every probe reports the
  // same missing-flag error instead of the one it was testing.
  "subset build": ({ fragment }) =>
    parseSubsetBuildOptions({
      defaultHome: "/corpus/full",
      rest: dedupeFlags({ base: ["--out", "/tmp/subset-probe"], fragment }),
    }),
  "subset status": ({ fragment }) => parseSubsetStatusOptions({ defaultHome: "/corpus/full", rest: [...fragment] }),
  cycle: ({ fragment }) => parseReconcileOptions({ defaultHome: "/tmp/h", rest: [...fragment] }),
  "cycle reconcile": ({ fragment }) => parseReconcileOptions({ defaultHome: "/tmp/h", rest: [...fragment] }),
  "memory check": ({ fragment }) => parseMemoryCheckArgs({ rest: [...fragment] }),
  "memory gate": ({ fragment }) => parseMemoryGateArgs({ rest: [...fragment] }),
  // Both hygiene verbs parse flags only — the id and the answer word are positionals `gradeAnswer` reads
  // afterwards, and `--dir`/`--repo` are resolved after parsing, so one probed flag never needs the others.
  "memory grade": ({ fragment }) => parseMemoryGradeArgs({ rest: [...fragment] }),
  "memory hook": ({ fragment }) => parseMemoryHookArgs({ rest: [...fragment] }),
  "memory hygiene": ({ fragment }) => parseMemoryHygieneArgs({ rest: [...fragment] }),
  "memory overlaps": ({ fragment }) => parseMemoryOverlapsArgs({ rest: [...fragment] }),
  "memory sweep": ({ fragment }) => parseMemorySweepArgs({ rest: [...fragment] }),
  onboard: ({ fragment }) => parseOnboardArgs({ rest: [...fragment] }),
  "onboard eval": ({ fragment }) => parseOnboardEvalArgs({ rest: [...fragment] }),
  "onboard plan": ({ fragment }) => parseOnboardPlanArgs({ rest: [...fragment] }),
  "onboard workstreams": ({ fragment }) => parseOnboardWorkstreamsArgs({ rest: [...fragment] }),
  "onboard run": ({ fragment }) => parseOnboardArgs({ rest: [...fragment] }),
  refresh: ({ fragment }) => parseRefreshOptions({ rest: [...fragment] }),
  "refresh run": ({ fragment }) => parseRefreshOptions({ rest: [...fragment] }),
  subset: ({ fragment }) => parseSubsetStatusOptions({ defaultHome: "/corpus/full", rest: [...fragment] }),
};

/** The rows for `refresh`, `chatgpt`, `subset`, `cycle`, `memory` and `onboard`. */
export const corpusAndMemorySlice: HelpTruthSlice = { guarded, probes, parsers };
