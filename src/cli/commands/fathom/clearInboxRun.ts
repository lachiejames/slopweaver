/**
 * `fathom clear-inbox`'s shell: argv, the archive edge, and the run.
 *
 * `clear-inbox` ingests every share link Fathom's mail carries that the fathom source lacks, then archives each
 * inbox mail whose every link is held. The archive is `gmail archive`'s own run — door-routed, on the modify
 * grant — never a second write path. The inbox triage never cards Fathom's mail.
 */

import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../../../live/gmail/read.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { productionGmailModifyDeps, runGmailArchive } from "../gmail/modifyRun.js";
import { clearInboxLines, fathomInboxPlan } from "./clearInboxCore.js";
import {
  coverageLine,
  discoverLines,
  type FathomDiscoverDeps,
  type FathomMail,
  type FathomMailCoverage,
  sharesInMail,
} from "./discoverCore.js";
import { diagnose, productionDiscoverDeps, productionShareDeps, VERB_ARG_OFFSET } from "./run.js";
import { type FathomShareDeps, ingestNewShares, settleLines, shareLines } from "./shareCore.js";
import { FATHOM_CLEAR_INBOX_USAGE } from "./usage.js";

/** The options `fathom clear-inbox` takes. */
interface ClearInboxOptions {
  readonly dryRun: boolean;
  readonly limit: number;
  readonly home: string;
}

/**
 * Parse `fathom clear-inbox`'s argv tail. Pure.
 *
 * @param rest the argv after the verb
 * @returns the options, or one sentence per refusal
 *
 * @internal
 */
export function parseClearInboxArgs({ rest }: { rest: readonly string[] }): Result<ClearInboxOptions> {
  const parsed = parseFlags({ args: rest, spec: { boolean: ["dry-run"], string: ["home", "limit"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const home = values["home"];
  const rawLimit = values["limit"];
  let limit = DEFAULT_LIST_LIMIT;
  if (typeof rawLimit === "string") {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
      return err([`--limit must be a whole number from 1 to ${String(MAX_LIST_LIMIT)}, got ${rawLimit}`]);
    }
  }
  return ok({ dryRun: values["dry-run"] === true, home: typeof home === "string" ? home : slopweaverHome(), limit });
}

/**
 * The edge `clear-inbox` archives through — `gmail archive`'s own run in production, so the door request, the
 * refusal and the report are that verb's, never a second copy of them.
 */
export type FathomArchiveEdge = (args: { ids: readonly string[]; home: string; dryRun: boolean }) => Promise<number>;

/** Fathom's mail and the tokens bronze already holds, or every line saying why either could not be read. */
async function mailAndHeld({
  deps,
  home,
  limit,
}: {
  deps: FathomDiscoverDeps;
  home: string;
  limit: number;
}): Promise<Result<{ coverage: FathomMailCoverage; held: ReadonlySet<string>; mails: readonly FathomMail[] }>> {
  const read = await deps.fathomMail({ home, limit });
  if (read.isErr()) {
    return err([read.error]);
  }
  const held = deps.heldTokens({ home });
  if (held.isErr()) {
    return err(held.error);
  }
  return ok({ coverage: read.value.coverage, held: held.value, mails: read.value.mails });
}

/** Why the archive is withheld after an ingest pass, or nothing when the pass had no failure. */
function withheldReason({ failures }: { failures: readonly string[] }): string | undefined {
  if (failures.length === 0) {
    return undefined;
  }
  return (
    `the ingest pass failed (${String(failures.length)} problem(s), on stderr), so it proved nothing — ` +
    "the next pass repairs and archives"
  );
}

/**
 * Run `fathom clear-inbox` against injected edges: ingest every share link Fathom's mail carries that the fathom
 * source lacks, then archive each inbox mail whose every share link is held — and nothing when the ingest failed.
 *
 * @param rest the argv after the verb
 * @param deps the mail and bronze readers
 * @param shareDeps the share edges each new link is ingested through
 * @param archive the archive edge the proven mail goes through
 * @returns the process exit code: 3 when no Fathom mail is in the inbox, 1 when the ingest or an archive failed
 */
export async function runFathomClearInbox({
  rest,
  deps,
  shareDeps,
  archive,
}: {
  rest: readonly string[];
  deps: FathomDiscoverDeps;
  shareDeps: FathomShareDeps;
  archive: FathomArchiveEdge;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: FATHOM_CLEAR_INBOX_USAGE });
    return EXIT_OK;
  }
  const options = parseClearInboxArgs({ rest });
  if (options.isErr()) {
    diagnose({ lines: [...options.error, FATHOM_CLEAR_INBOX_USAGE] });
    return EXIT_USAGE;
  }
  const { dryRun, home, limit } = options.value;
  const read = await mailAndHeld({ deps, home, limit });
  if (read.isErr()) {
    diagnose({ lines: read.error });
    return EXIT_ERROR;
  }
  const { coverage, held, mails } = read.value;
  const shares = sharesInMail({ held, mails });
  const report = dryRun
    ? { failures: [], outcomes: [], settle: null }
    : await ingestNewShares({ deps: shareDeps, home, shares });
  const withheld = withheldReason({ failures: report.failures });
  // Proof off bronze as it stands NOW, never off the outcome list: a share this pass stored is held only if it landed.
  const heldNow = deps.heldTokens({ home });
  if (heldNow.isErr()) {
    diagnose({ lines: heldNow.error });
    return EXIT_ERROR;
  }
  const plan = fathomInboxPlan({ held: heldNow.value, mails });
  const lines = [
    ...discoverLines({ shares }),
    coverageLine({ coverage }),
    ...report.outcomes.flatMap((outcome) => shareLines({ outcome })),
    ...settleLines({ settle: report.settle }),
    ...clearInboxLines({ dryRun, plan, withheld }),
  ];
  for (const line of lines) {
    logger.out({ line });
  }
  diagnose({ lines: report.failures });
  if (withheld !== undefined) {
    return EXIT_ERROR;
  }
  if (plan.archive.length === 0) {
    return plan.kept.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  return archive({ dryRun, home, ids: plan.archive });
}

/**
 * The production archive edge: `gmail archive` over the exact ids, with its own door routing and report.
 *
 * @returns the edge
 */
function productionArchiveEdge(): FathomArchiveEdge {
  return ({ ids, home, dryRun }) =>
    runGmailArchive({
      deps: productionGmailModifyDeps(),
      rest: [...ids, "--home", home, ...(dryRun ? ["--dry-run"] : [])],
    });
}

/** `slopweaver fathom clear-inbox` — ingest what Fathom's inbox mail points at, then archive what is proven held. */
export const fathomClearInboxCommand = defineCommand({
  run: (argv) =>
    runFathomClearInbox({
      archive: productionArchiveEdge(),
      deps: productionDiscoverDeps(),
      rest: argv.slice(VERB_ARG_OFFSET),
      shareDeps: productionShareDeps(),
    }),
});
