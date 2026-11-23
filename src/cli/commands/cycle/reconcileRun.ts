/**
 * `slopweaver cycle reconcile` — the daily close-this list and the overdue project updates, as PROPOSALS.
 *
 * A thin effectful shell: every rule is pure ({@link ../../../cycle/classify},
 * {@link ../../../cycle/projectUpdate}, {@link ../../../cycle/report}), every read is streaming
 * ({@link ./read}), and the clock enters exactly once, here. The pass itself lives in {@link ./pass} so
 * `slopweaver session-start`'s cycle leg consumes the same one rather than a copy of it.
 *
 * It never sends and never changes Linear or GitHub. There is no Linear mutation on this path and no Slack
 * send: `--form` emits the card for `slopweaver slack post --as bot --form -`, which is the one door with the
 * preview, the voice rules and the duplicate gate already on it. `--post` without `--dry-run` is refused by
 * the parser for that reason rather than by a check here.
 *
 * The one thing it may write is LOCAL: `--write` publishes the `--json` report to
 * `$SLOPWEAVER_HOME/live/hygiene/cycle-reconcile.json` through `../../../live/hygiene/reportStore.ts`, so the
 * `linear-briefing-daily` standing row leaves a document a later reader opens rather than a transcript it
 * would have to scrape. The file and `--json` come from {@link cycleReconcileJson}, so they cannot disagree.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import { slopweaverHome } from "../../../config.js";
import { reconcileForm, reconcileLines } from "../../../cycle/render.js";
import type { CycleReconcileReport } from "../../../cycle/types.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { writeHygieneDocument } from "../../../live/hygiene/reportStore.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseReconcileOptions, type ReconcileOptions } from "./core.js";
import { reconcilePass } from "./pass.js";

const USAGE =
  "usage: slopweaver cycle reconcile [--json | --form] [--verify] [--post --dry-run] [--write] [--now <iso>] [--home <dir>]";

/**
 * The report's canonical JSON — what `--json` prints and what `--write` publishes, byte for byte.
 *
 * @param report the finished pass
 * @returns the pretty-printed document, without a trailing newline
 */
export function cycleReconcileJson({ report }: { readonly report: CycleReconcileReport }): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Publish the report to the home's hygiene document, replacing the previous one whole.
 *
 * The document is {@link cycleReconcileJson} plus one terminal newline — the same bytes `--json` puts on
 * stdout. A failure leaves the previous document standing (`writeHygieneDocument`'s own guarantee).
 *
 * @param home the state home whose `live/hygiene/cycle-reconcile.json` is replaced
 * @param report the finished pass
 * @returns the path written, or why nothing was
 */
export function publishCycleReconcile({
  home,
  report,
}: {
  readonly home: string;
  readonly report: CycleReconcileReport;
}): Result<string> {
  return writeHygieneDocument({
    chunks: [cycleReconcileJson({ report }), "\n"],
    path: stateHomePaths({ home }).live.hygiene.cycleReconcile,
  });
}

/** The instant the pass judges against: `--now` when given (a replay's own clock), else the wall clock. */
function passInstant({ options }: { options: ReconcileOptions }): string {
  const given = unsetFieldAsNull({ key: "nowIso", record: options });
  if (given === null) {
    return new Date().toISOString();
  }
  return given;
}

/** Emit the report in whichever single output mode the caller asked for. */
function emit({
  report,
  json,
  form,
  post,
}: {
  report: CycleReconcileReport;
  json: boolean;
  form: boolean;
  post: boolean;
}): number {
  if (post) {
    logger.out({
      line: `would post ${String(report.proposals.length)} proposal(s) as a bot card, and posted nothing. Pipe \`--form\` into \`slopweaver slack post\` to send it`,
    });
    return EXIT_OK;
  }
  if (form) {
    logger.out({ line: JSON.stringify(reconcileForm({ report }), null, 2) });
    return EXIT_OK;
  }
  if (json) {
    logger.out({ line: cycleReconcileJson({ report }) });
    return EXIT_OK;
  }
  for (const line of reconcileLines({ report })) {
    logger.info({ msg: line });
  }
  return EXIT_OK;
}

/**
 * Run the reconcile verb.
 *
 * @param argv the full process argv (the verb tail starts after `cycle reconcile`)
 * @returns the process exit code
 */
export async function runCycleReconcile(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["reconcile"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseReconcileOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const { home, json, form, post, verify, write } = parsed.value;
  const pass = await reconcilePass({
    home,
    identityRoster: identityRosterPort(),
    nowIso: passInstant({ options: parsed.value }),
    verify,
  });
  if (pass.isErr()) {
    logger.error({ msg: pass.error.message });
    return EXIT_ERROR;
  }
  const exitCode = emit({ form, json, post, report: pass.value });
  if (!write) {
    return exitCode;
  }
  const published = publishCycleReconcile({ home, report: pass.value });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  logger.info({ msg: `cycle reconcile: wrote ${published.value}` });
  return exitCode;
}

/** The registered verb. */
export const cycleReconcileCommand = defineCommand({ run: runCycleReconcile });
