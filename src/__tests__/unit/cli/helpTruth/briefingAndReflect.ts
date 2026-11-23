/**
 * The help-truth tables' rows for `briefing` and `reflect` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  BRIEFING_ARCHIVE_FLAG_NAMES,
  parseBriefingArchiveArgs,
} from "../../../../cli/commands/briefing/archiveArgs.js";
import {
  BRIEFING_CHECK_FLAG_NAMES,
  BRIEFING_CORRECTIONS_FLAG_NAMES,
  BRIEFING_FREEZE_FLAG_NAMES,
  BRIEFING_RENDER_FLAG_NAMES,
  parseBriefingCheckArgs,
  parseBriefingCorrectionsArgs,
  parseBriefingFreezeArgs,
  parseBriefingRenderArgs,
} from "../../../../cli/commands/briefing/core.js";
import { briefingCommandErrorLines } from "../../../../cli/commands/briefing/errors.js";
import {
  BRIEFING_CARD_FLAG_NAMES,
  BRIEFING_FOLD_CAPS_FLAG_NAMES,
  BRIEFING_RECUT_FLAG_NAMES,
  BRIEFING_SWEEP_BLOCK_FLAG_NAMES,
  parseBriefingCardArgs,
  parseBriefingFoldCapsArgs,
  parseBriefingRecutArgs,
  parseBriefingSweepBlockArgs,
} from "../../../../cli/commands/briefing/formEditArgs.js";
import { parseReflectBoardOptions, REFLECT_BOARD_FLAG_SPEC } from "../../../../cli/commands/reflect/boardCore.js";
import { parseReflectBriefOptions, REFLECT_BRIEF_FLAG_SPEC } from "../../../../cli/commands/reflect/briefCore.js";
import {
  parseReflectTelemetryOptions,
  REFLECT_TELEMETRY_DEFAULT_LIMIT,
  REFLECT_TELEMETRY_FLAG_SPEC,
} from "../../../../cli/commands/reflect/core.js";
import {
  parseReflectFrictionReviewOptions,
  REFLECT_FRICTION_REVIEW_FLAG_SPEC,
} from "../../../../cli/commands/reflect/frictionReviewCore.js";
import { parseReflectGradeOptions, REFLECT_GRADE_FLAG_SPEC } from "../../../../cli/commands/reflect/gradeCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

/** `reflect board`'s advertised flags, derived from the spec the verb parses with. */
const REFLECT_BOARD_FLAG_NAMES: readonly string[] = [
  ...REFLECT_BOARD_FLAG_SPEC.value.map((name) => `--${name}`),
  ...REFLECT_BOARD_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `reflect telemetry`'s advertised flags, derived from the spec the verb parses with. */
const REFLECT_TELEMETRY_FLAG_NAMES: readonly string[] = [
  ...REFLECT_TELEMETRY_FLAG_SPEC.value.map((name) => `--${name}`),
  ...REFLECT_TELEMETRY_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `reflect brief`'s advertised flags, derived from the spec the verb parses with. */
const REFLECT_BRIEF_FLAG_NAMES: readonly string[] = [
  ...REFLECT_BRIEF_FLAG_SPEC.value.map((name) => `--${name}`),
  ...REFLECT_BRIEF_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `reflect friction-review`'s advertised flags, derived from the spec the verb parses with. */
const REFLECT_FRICTION_REVIEW_FLAG_NAMES: readonly string[] = [
  ...REFLECT_FRICTION_REVIEW_FLAG_SPEC.value.map((name) => `--${name}`),
  ...REFLECT_FRICTION_REVIEW_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `reflect grade`'s advertised flags, derived from the spec the verb parses with. */
const REFLECT_GRADE_FLAG_NAMES: readonly string[] = [
  ...REFLECT_GRADE_FLAG_SPEC.value.map((name) => `--${name}`),
  ...REFLECT_GRADE_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** A complete `briefing sweep-block` invocation: every required flag, so a probe tests only its own flag. */
const SWEEP_BLOCK_BASE: readonly string[] = [
  "--form",
  "/tmp/form.json",
  "--workspace",
  "workspace:55",
  "--handoff",
  "handoff-9250",
  "--model",
  "fable",
  "--pinned-at",
  "2026-09-13T00:11:07Z",
  "--sleeping",
  "false",
  "--alignment",
  "4 of 40 live sessions are on the board's top 5.",
  "--headline-sentence",
  "07:1x, pass seven, the loop's successor is booting.",
  "--headline-sentence",
  "You answered every card this pass.",
  "--fold",
  "The gauge was read in full this pass.",
  "--fold-summary",
  "the fold gauges, the depth line, and who is stuck on what",
];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "reflect board": REFLECT_BOARD_FLAG_NAMES,
  "reflect brief": REFLECT_BRIEF_FLAG_NAMES,
  "reflect friction-review": REFLECT_FRICTION_REVIEW_FLAG_NAMES,
  "reflect grade": REFLECT_GRADE_FLAG_NAMES,
  "reflect telemetry": REFLECT_TELEMETRY_FLAG_NAMES,
  "briefing archive": BRIEFING_ARCHIVE_FLAG_NAMES,
  "briefing card": BRIEFING_CARD_FLAG_NAMES,
  "briefing fold-caps": BRIEFING_FOLD_CAPS_FLAG_NAMES,
  "briefing recut": BRIEFING_RECUT_FLAG_NAMES,
  "briefing sweep-block": BRIEFING_SWEEP_BLOCK_FLAG_NAMES,
  "briefing check": BRIEFING_CHECK_FLAG_NAMES,
  "briefing corrections": BRIEFING_CORRECTIONS_FLAG_NAMES,
  "briefing freeze": BRIEFING_FREEZE_FLAG_NAMES,
  "briefing render": BRIEFING_RENDER_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "briefing archive": {
    "--dry-run": ["--dry-run"],
    "--form": ["--form", "/tmp/form.json"],
    "--keep-notes": ["--keep-notes", "5"],
    "--keep-sections": ["--keep-sections", "2"],
    "--oldest-first": ["--oldest-first"],
    "--out": ["--out", "/tmp/archive.json"],
  },
  "briefing card": {
    "--dry-run": ["--dry-run"],
    "--drop": ["--drop", "https://claude.ai/code/artifact/3eb11d97-9d46-46f6-ae79-b85e441e86b8"],
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
    "--open-pages": ["--open-pages", "/tmp/open-pages.json"],
    "--replace": ["--replace"],
    "--row": ["--row", "/tmp/row.json"],
    "--settled-by": ["--settled-by", "a-row"],
  },
  "briefing fold-caps": {
    "--dry-run": ["--dry-run"],
    "--form": ["--form", "/tmp/form.json"],
  },
  "briefing recut": {
    "--dry-run": ["--dry-run"],
    "--form": ["--form", "/tmp/form.json"],
    "--out": ["--out", "/tmp/recut.json"],
  },
  "briefing sweep-block": {
    "--alignment": ["--alignment", "4 of 40 live sessions are on the board's top 5."],
    "--alignment-detail": ["--alignment-detail", "Two live sessions sit on entries the board does not know."],
    "--alignment-summary": ["--alignment-summary", "the reconcile line verbatim, and what was done about it"],
    "--drop-card-prefix": ["--drop-card-prefix", "The Fable week reads"],
    "--dry-run": ["--dry-run"],
    "--earlier-summary": ["--earlier-summary", "earlier today"],
    "--fold": ["--fold", "The gauge was read in full this pass."],
    "--fold-summary": ["--fold-summary", "the fold gauges, the depth line, and who is stuck on what"],
    "--form": ["--form", "/tmp/form.json"],
    "--handoff": ["--handoff", "handoff-9250"],
    "--headline-sentence": ["--headline-sentence", "07:1x, pass seven, the loop's successor is booting."],
    "--intake": ["--intake", "6 owner turns have no row or card."],
    "--keep-recent": ["--keep-recent", "4"],
    "--lede": ["--lede", "You are reacting, and the fleet acts on your pull requests."],
    "--model": ["--model", "fable"],
    "--pinned-at": ["--pinned-at", "2026-09-13T00:11:07Z"],
    "--sleeping": ["--sleeping", "false"],
    "--workspace": ["--workspace", "workspace:55"],
  },
  "briefing check": {
    "--home": ["--home", "/tmp"],
  },
  "briefing corrections": {
    "--artifact": ["--artifact", "0dc1a3db"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--out": ["--out", "/tmp/marked.html"],
    "--page": ["--page", "/tmp/page.html"],
    "--previous": ["--previous", "/tmp/prev.html"],
    "--verify": ["--verify"],
  },
  "briefing freeze": {
    "--artifact": ["--artifact", "0dc1a3db"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--new": ["--new"],
    "--page": ["--page", "/tmp/page.html"],
  },
  "briefing render": {
    "--form": ["--form", "{}"],
    // `--freshness` reads this machine's own resync roster and outcomes; it needs no other flag.
    "--freshness": ["--freshness"],
    "--home": ["--home", "/tmp"],
    // `--nothing-stale` reads the hygiene and followed-thread documents out of the state home; no other flag.
    "--nothing-stale": ["--nothing-stale"],
    "--open-artifacts": ["--open-artifacts", "open-pages.json"],
    // `--open-page-cards` builds its cards from the `--open-artifacts` document, so the probe carries both.
    "--open-page-cards": ["--open-page-cards", "--open-artifacts", "open-pages.json"],
    // `--ticks` names the supervisor tick ledger the three narrative sections are projected from.
    "--ticks": ["--ticks", "supervisor-ticks.jsonl"],
    // `--ticks-days` bounds how far back that projection reaches, so the probe carries the ledger too.
    "--ticks-days": ["--ticks-days", "1", "--ticks", "supervisor-ticks.jsonl"],
    // `--open-prs` reads the same document `--your-list` does, so the probe carries both.
    "--open-prs": ["--open-prs", "--your-list", "-"],
    // The two ledger routes are refused TOGETHER, so each probe carries only its own half.
    "--autonomy-ledger": ["--autonomy-ledger"],
    "--autonomy-ledger-file": ["--autonomy-ledger-file", "autonomy.jsonl"],
    "--out": ["--out", "page.html"],
    // `--hand-steps` reads the hand register out of the state home; it needs no other flag either.
    "--hand-steps": ["--hand-steps"],
    // `--owner-beliefs` reads the proposal queue out of the state home; it needs no other flag.
    "--knowledge-quiz": ["--knowledge-quiz", "--sweep", "tick-240-9"],
    "--owner-beliefs": ["--owner-beliefs"],
    // `--sweep` names the sweep whose recorded question `--knowledge-quiz` projects, so the probe
    // carries both — either alone is refused, which is the point of the pairing.
    "--sweep": ["--sweep", "tick-240-9", "--knowledge-quiz"],
    "--top": ["--top", "5"],
    "--your-list": ["--your-list", "-"],
  },
  "reflect board": {
    "--json": ["--json"],
    "--now": ["--now", "2026-09-01T00:00:00.000Z"],
  },
  "reflect brief": {
    "--cap": ["--cap", "3"],
    "--dry-run": ["--dry-run"],
    "--from": ["--from", "24h"],
    "--json": ["--json"],
    "--to": ["--to", "now"],
    "--write": ["--write"],
  },
  "reflect friction-review": {
    "--home": ["--home", "/tmp/h"],
    "--json": ["--json"],
    "--mark-published": ["--mark-published"],
    "--republish": ["--republish"],
  },
  "reflect grade": {
    "--closed-by": ["--closed-by", "#740"],
    "--home": ["--home", "/tmp/h"],
    "--json": ["--json"],
    "--why": ["--why", "already covered"],
  },
  "reflect telemetry": {
    "--from": ["--from", "24h"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--to": ["--to", "now"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "reflect board": ({ fragment }) => parseReflectBoardOptions({ rest: [...fragment] }),
  "reflect brief": ({ fragment }) => parseReflectBriefOptions({ rest: [...fragment] }),
  "reflect friction-review": ({ fragment }) => parseReflectFrictionReviewOptions({ rest: [...fragment] }),
  "reflect grade": ({ fragment }) => parseReflectGradeOptions({ rest: ["abc123def456", "keep", ...fragment] }),
  "reflect telemetry": ({ fragment }) =>
    parseReflectTelemetryOptions({ defaultLimit: REFLECT_TELEMETRY_DEFAULT_LIMIT, rest: [...fragment] }),
  "briefing archive": ({ fragment }) =>
    parseBriefingArchiveArgs({ rest: dedupeFlags({ base: ["--form", "/tmp/form.json"], fragment }) }).mapErr((error) =>
      briefingCommandErrorLines({ error }),
    ),
  // Two exclusive arms, so a drop-arm flag is probed beside --drop and every other flag beside --row.
  "briefing card": ({ fragment }) =>
    parseBriefingCardArgs({
      rest: dedupeFlags({
        base: [
          "--open-pages",
          "/tmp/open-pages.json",
          ...(fragment.includes("--drop") || fragment.includes("--settled-by")
            ? ["--drop", "https://claude.ai/code/artifact/3eb11d97-9d46-46f6-ae79-b85e441e86b8"]
            : ["--row", "/tmp/row.json"]),
        ],
        fragment,
      }),
    }),
  "briefing fold-caps": ({ fragment }) =>
    parseBriefingFoldCapsArgs({ rest: dedupeFlags({ base: ["--form", "/tmp/form.json"], fragment }) }),
  "briefing recut": ({ fragment }) =>
    parseBriefingRecutArgs({
      rest: dedupeFlags({ base: ["--form", "/tmp/form.json", "--out", "/tmp/recut.json"], fragment }),
    }),
  "briefing sweep-block": ({ fragment }) =>
    parseBriefingSweepBlockArgs({ rest: dedupeFlags({ base: SWEEP_BLOCK_BASE, fragment }) }),
  "briefing check": ({ fragment }) => parseBriefingCheckArgs({ rest: ["a.html", ...fragment] }),
  "briefing corrections": ({ fragment }) => parseBriefingCorrectionsArgs({ rest: [...fragment] }),
  "briefing freeze": ({ fragment }) => parseBriefingFreezeArgs({ rest: [...fragment] }),
  "briefing render": ({ fragment }) =>
    parseBriefingRenderArgs({ rest: dedupeFlags({ base: ["--form", "{}"], fragment }) }).mapErr((error) =>
      briefingCommandErrorLines({ error }),
    ),
};

/** The rows for `briefing` and `reflect`. */
export const briefingAndReflectSlice: HelpTruthSlice = { guarded, probes, parsers };
