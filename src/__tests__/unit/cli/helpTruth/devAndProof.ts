/**
 * The help-truth tables' rows for `dev`, `catalog`, `gold`, `proof`, `pdf` and `page` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseCatalogHealthArgs } from "../../../../cli/commands/catalog/healthRun.js";
import { CATALOG_TREES_FLAG_NAMES, parseCatalogTreesArgs } from "../../../../cli/commands/catalog/treesRun.js";
import {
  DEV_ANSWER_QUALITY_FLAG_NAMES,
  parseDevAnswerQualityArgs,
} from "../../../../cli/commands/dev/answerQualityCore.js";
import { DEV_BASELINE_BUMP_FLAGS, parseBaselineBumpArgs } from "../../../../cli/commands/dev/baselineBumpCore.js";
import { DEV_BUILD_FLAG_NAMES, parseDevBuildArgs } from "../../../../cli/commands/dev/buildCore.js";
import {
  DEV_CAPTURE_CONFLICTS_FLAG_NAMES,
  parseDevCaptureConflictsArgs,
} from "../../../../cli/commands/dev/captureConflictsCore.js";
import { DEV_DEDUP_INDEX_FLAG_NAMES, parseDevDedupIndexArgs } from "../../../../cli/commands/dev/dedupIndexCore.js";
import { DEV_DRIZZLE_REBASE_FLAGS, parseDevDrizzleRebaseArgs } from "../../../../cli/commands/dev/drizzleRebase.js";
import { DEV_HEAP_CURVE_FLAG_NAMES, parseDevHeapCurveArgs } from "../../../../cli/commands/dev/heapCurveCore.js";
import { DEV_PROFILE_FLAG_NAMES, parseDevProfileArgs } from "../../../../cli/commands/dev/profileCore.js";
import { DEV_SLICE_SHAPE_FLAG_NAMES, parseDevSliceShapeArgs } from "../../../../cli/commands/dev/sliceShapeCore.js";
import {
  DEV_TARGETED_TESTS_FLAG_NAMES,
  parseDevTargetedTestsArgs,
} from "../../../../cli/commands/dev/targetedTestsCore.js";
import {
  GOLD_DEBTS_FLAG_NAMES,
  GOLD_OWE_FLAG_NAMES,
  GOLD_SETTLE_FLAG_NAMES,
  parseGoldDebtsArgs,
  parseGoldOweArgs,
  parseGoldSettleArgs,
} from "../../../../cli/commands/gold/core.js";
import {
  PAGE_FIND_FLAG_NAMES,
  PAGE_PUBLISH_FLAG_NAMES,
  PAGE_REVIEW_PREPARE_FLAG_NAMES,
  PAGE_TAG_FLAG_NAMES,
  pageFindOptions,
  pagePublishOptions,
  pageReviewPrepareOptions,
  pageTagOptions,
} from "../../../../cli/commands/page/core.js";
import { PAGE_EXPORT_FLAG_NAMES, pageExportOptions } from "../../../../cli/commands/page/exportRun.js";
import { PAGE_READ_FLAG_NAMES, pageReadOptions } from "../../../../cli/commands/page/readRun.js";
import {
  PDF_CHECK_FLAG_NAMES,
  PDF_READ_FLAG_NAMES,
  parsePdfCheckArgs,
  parsePdfReadArgs,
} from "../../../../cli/commands/pdf/core.js";
import {
  PROOF_CASSETTE_FLAG_NAMES,
  PROOF_YARN_WHY_FLAG_NAMES,
  parseProofCassetteArgs,
  parseProofYarnWhyArgs,
} from "../../../../cli/commands/proof/core.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags, flagNamesOf } from "./sharedProbes.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "dev baseline-bump": flagNamesOf({ spec: DEV_BASELINE_BUMP_FLAGS }),
  "dev drizzle-rebase": flagNamesOf({ spec: DEV_DRIZZLE_REBASE_FLAGS }),
  "catalog health": ["--json"],
  "catalog trees": CATALOG_TREES_FLAG_NAMES,
  "page find": PAGE_FIND_FLAG_NAMES,
  "page publish": PAGE_PUBLISH_FLAG_NAMES,
  "page read": PAGE_READ_FLAG_NAMES,
  "page export": PAGE_EXPORT_FLAG_NAMES,
  "page review-prepare": PAGE_REVIEW_PREPARE_FLAG_NAMES,
  "page tag": PAGE_TAG_FLAG_NAMES,
  "pdf check": PDF_CHECK_FLAG_NAMES,
  "pdf read": PDF_READ_FLAG_NAMES,
  "dev answer-quality": DEV_ANSWER_QUALITY_FLAG_NAMES,
  "dev build": DEV_BUILD_FLAG_NAMES,
  "dev capture-conflicts": DEV_CAPTURE_CONFLICTS_FLAG_NAMES,
  "dev dedup-index": DEV_DEDUP_INDEX_FLAG_NAMES,
  "dev heap-curve": DEV_HEAP_CURVE_FLAG_NAMES,
  "dev profile": DEV_PROFILE_FLAG_NAMES,
  "dev slice-shape": DEV_SLICE_SHAPE_FLAG_NAMES,
  "dev targeted-tests": DEV_TARGETED_TESTS_FLAG_NAMES,
  "gold debts": GOLD_DEBTS_FLAG_NAMES,
  "gold owe": GOLD_OWE_FLAG_NAMES,
  "gold settle": GOLD_SETTLE_FLAG_NAMES,
  "proof cassette": PROOF_CASSETTE_FLAG_NAMES,
  "proof yarn-why": PROOF_YARN_WHY_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  // `--reason` is required, so every probe carries one.
  "dev baseline-bump": {
    "--base": ["--reason", "widening", "--base", "abc123"],
    "--cwd": ["--reason", "widening", "--cwd", "/tmp/sw-checkout"],
    "--dry-run": ["--reason", "widening", "--dry-run"],
    "--home": ["--reason", "widening", "--home", "/tmp/sw-home"],
    "--reason": ["--reason", "widening"],
  },
  "dev drizzle-rebase": {
    "--dry-run": ["--dry-run"],
    "--migrations": ["--migrations", "drizzle"],
  },
  "catalog health": { "--json": ["--json"] },
  "catalog trees": { "--json": ["--json"] },
  "page find": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
  },
  "page publish": {
    "--assets-from": ["--assets-from", "/tmp/page-assets"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-13T06:00:00Z"],
    "--page": ["--page", "/tmp/page.html"],
    "--review": ["--review", "pass-1,receipt-1"],
    "--review-changed": ["--review-changed", "fixed the date the review flagged"],
  },
  "page read": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--presentation": ["--presentation"],
  },
  "page export": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--out": ["--out", "/tmp/a-slug.html"],
  },
  "page review-prepare": {
    "--home": ["--home", "/tmp"],
    "--inputs": ["--inputs", "/tmp/words.md,/tmp/doc.md"],
    "--json": ["--json"],
    "--page": ["--page", "/tmp/page.html"],
  },
  "page tag": {
    "--calendar": ["--calendar", "primary"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--meeting": ["--meeting", "6h1s9r0k4p2m8n3q_20261002T050000Z"],
    "--now": ["--now", "2026-10-02T04:00:00Z"],
  },
  "pdf check": {
    "--json": ["--json"],
  },
  "pdf read": {
    "--json": ["--json"],
    "--pages": ["--pages", "3"],
  },
  "gold debts": {
    "--all": ["--all"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--repo": ["--repo", "octo-self/slopweaver"],
    "--settled": ["--settled"],
  },
  "gold owe": {
    "--blocked-on": ["--blocked-on", "the owner's own approval"],
    "--by-session": ["--by-session", "workspace:gold-debt-ledger"],
    "--grade": ["--grade", "silver"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--merged-iso": ["--merged-iso", "2026-09-18T17:31:52Z"],
    "--pull-request": ["--pull-request", "https://github.com/octo-self/slopweaver/pull/872"],
    "--recorded-iso": ["--recorded-iso", "2026-09-19T04:00:00Z"],
    "--run": ["--run", "gold-debt-ledger"],
    "--title": ["--title", "the pull request title"],
    "--would-be": ["--would-be", "post the ask as the owner into a real channel"],
  },
  "gold settle": {
    "--as": ["--as", "gathered"],
    "--by-session": ["--by-session", "workspace:gold-debt-ledger"],
    "--evidence": ["--evidence", "the real post, really sent"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--proof-commit": ["--proof-commit", "bcbeea941"],
    "--regrade": ["--regrade", "the description now reads solved-gold"],
    "--settled-iso": ["--settled-iso", "2026-09-20T09:00:00Z"],
  },
  "proof cassette": {
    "--cwd": ["--cwd", "/tmp"],
    "--out": ["--out", "/tmp/out.mp4"],
    "--tape": ["--tape", "/tmp/proof.tape"],
  },
  "proof yarn-why": {
    "--after": ["--after", "/tmp/after"],
    "--after-label": ["--after-label", "PR branch"],
    "--before": ["--before", "/tmp/before"],
    "--before-label": ["--before-label", "staging"],
    "--dep": ["--dep", "left-pad"],
    "--out": ["--out", "/tmp/out.png"],
  },
  "dev build": {
    "--json": ["--json"],
    "--out": ["--out", "dist"],
  },
  "dev capture-conflicts": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--source": ["--source", "notion"],
  },
  // Every fragment carries `--cases`, which the verb requires before it will look at anything else — without
  // it each probe would report the same missing-cases error rather than the flag it is about.
  "dev answer-quality": {
    "--artifact": ["--cases", "cases.json", "--selftest", "--artifact", "out.md"],
    "--candidates": ["--cases", "cases.json", "--candidates", "answers.json"],
    "--cases": ["--cases", "cases.json", "--selftest"],
    "--json": ["--cases", "cases.json", "--selftest", "--json"],
    "--selftest": ["--cases", "cases.json", "--selftest"],
  },
  "dev dedup-index": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--source": ["--source", "slack"],
  },
  "dev heap-curve": {
    "--corpus": ["--corpus", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--projection": ["--projection", "bronze"],
  },
  "dev profile": {
    "--check": ["--gate", "named-object-params", "--check"],
    "--cpu": ["--gate", "named-object-params", "--cpu"],
    "--gate": ["--gate", "named-object-params"],
    "--heap-prof": ["--gate", "named-object-params", "--heap-prof"],
    "--interval": ["--gate", "named-object-params", "--cpu", "--interval", "4000"],
    "--json": ["--gate", "named-object-params", "--json"],
    "--lane": ["--lane", "unit"],
    "--record": ["--gate", "named-object-params", "--record"],
    "--top": ["--gate", "named-object-params", "--top", "5"],
    "--verb": ["--verb"],
  },
  "dev slice-shape": {
    "--corpus": ["--corpus", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--top": ["--top", "5"],
  },
  "dev targeted-tests": {
    "--dry-run": ["--dry-run"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "dev baseline-bump": ({ fragment }) => parseBaselineBumpArgs({ rest: fragment }),
  "dev drizzle-rebase": ({ fragment }) => parseDevDrizzleRebaseArgs({ rest: fragment }),
  "catalog health": ({ fragment }) => parseCatalogHealthArgs({ rest: fragment }),
  "catalog trees": ({ fragment }) => parseCatalogTreesArgs({ rest: fragment }),
  "page find": ({ fragment }) => pageFindOptions({ rest: dedupeFlags({ base: ["icons"], fragment }) }),
  "page publish": ({ fragment }) =>
    pagePublishOptions({ rest: dedupeFlags({ base: ["a-slug", "--page", "/tmp/page.html"], fragment }) }),
  "page read": ({ fragment }) =>
    pageReadOptions({ rest: dedupeFlags({ base: ["a-slug", "--presentation"], fragment }) }),
  "page export": ({ fragment }) =>
    pageExportOptions({ rest: dedupeFlags({ base: ["a-slug", "--out", "/tmp/a-slug.html"], fragment }) }),
  "page review-prepare": ({ fragment }) =>
    pageReviewPrepareOptions({
      rest: dedupeFlags({ base: ["a-slug", "--page", "/tmp/page.html", "--inputs", "/tmp/words.md"], fragment }),
    }),
  "page tag": ({ fragment }) =>
    pageTagOptions({ rest: dedupeFlags({ base: ["a-slug", "--meeting", "evt1"], fragment }) }),
  // `pdf read` takes one positional, and it must not look like a provider reference — `providerReferenceRoute`
  // refuses a URL or an `F…` id BY NAME, so a probe using one would report that refusal instead of the flag.
  "pdf read": ({ fragment }) => parsePdfReadArgs({ rest: ["/tmp/a.pdf", ...fragment] }),
  "pdf check": ({ fragment }) => parsePdfCheckArgs({ rest: [...fragment] }),
  "dev answer-quality": ({ fragment }) => parseDevAnswerQualityArgs({ rest: [...fragment] }),
  "dev build": ({ fragment }) => parseDevBuildArgs({ rest: [...fragment] }),
  "dev capture-conflicts": ({ fragment }) => parseDevCaptureConflictsArgs({ rest: [...fragment] }),
  "dev dedup-index": ({ fragment }) => parseDevDedupIndexArgs({ rest: [...fragment] }),
  "dev heap-curve": ({ fragment }) => parseDevHeapCurveArgs({ rest: [...fragment] }),
  "dev profile": ({ fragment }) => parseDevProfileArgs({ rest: [...fragment] }),
  "dev slice-shape": ({ fragment }) => parseDevSliceShapeArgs({ rest: [...fragment] }),
  "dev targeted-tests": ({ fragment }) => parseDevTargetedTestsArgs({ rest: [...fragment] }),
  "gold debts": ({ fragment }) => parseGoldDebtsArgs({ rest: [...fragment] }),
  "gold owe": ({ fragment }) => parseGoldOweArgs({ rest: [...fragment] }),
  // The debt is a POSITIONAL, so every probe carries one — a bare flag set names no debt to settle.
  "gold settle": ({ fragment }) => parseGoldSettleArgs({ rest: ["octo-self/slopweaver#872", ...fragment] }),
  "proof cassette": ({ fragment }) => parseProofCassetteArgs({ rest: [...fragment] }),
  "proof yarn-why": ({ fragment }) => parseProofYarnWhyArgs({ rest: [...fragment] }),
};

/** The rows for `dev`, `catalog`, `gold`, `proof`, `pdf` and `page`. */
export const devAndProofSlice: HelpTruthSlice = { guarded, probes, parsers };
