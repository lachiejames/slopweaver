/**
 * `slopweaver atlas hex sync [--json] [--home <dir>]` — compile the anonymous evidence into the atlas's
 * `api` and `method` kinds.
 *
 * ## It reaches the network once, and what it reaches is not the workspace
 *
 * `static.hex.site/openapi.json` is the document Hex's own public API reference renders from: no credential,
 * nothing about this installation, the same bytes any anonymous reader is served. So this is not a doored
 * provider read — it writes only under `$SLOPWEAVER_HOME` and asks Hex nothing about the workspace. The
 * other two evidence bodies are committed measurements and are republished without a call at all.
 *
 * The document is checked against the digest in `generated/specLock.ts`, and one whose bytes have moved is
 * compiled and REPORTED rather than refused — `atlas/hex/errors.ts` carries the reasoning, and Hex publishes
 * at an unversioned address, so the digest moves on an ordinary release.
 *
 * ## And then, ONLY when a token exists, it reads the workspace too
 *
 * The `project` and `resource` kinds are never held empty.
 * When `hex-api-token` resolves, this verb follows the anonymous compile with `entitySync.ts` — what the
 * workspace HAS, never what a query returned. With no token it says what would fill those kinds and exits
 * 0: an install with no Hex credential is not a failed sync, it is the same surface map it always was.
 */
import {
  type HexEntitySyncFailure,
  type HexEntitySyncOutcome,
  syncHexWorkspaceEntities,
} from "../../../atlas/hex/entitySync.js";
import { HEX_ENTITY_UNBLOCKED_BY } from "../../../atlas/hex/model.js";
import { httpSpecTransport } from "../../../atlas/hex/specFetch.js";
import { hexAtlasPaths } from "../../../atlas/hex/store.js";
import { type HexSyncOutcome, syncHexApiSurface } from "../../../atlas/hex/syncPublish.js";
import { openHexClient } from "../../../hex/session.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Hex atlas verb sits: past the runtime, the script, the `atlas` noun and the `hex` platform. */
const HEX_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const HEX_SYNC_USAGE = "usage: slopweaver atlas hex sync [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * The lines the sync prints, leading with the three evidence bodies rather than with one total.
 *
 * @param outcome what the publish recorded
 * @returns the lines, in print order
 *
 * @internal
 */
export function renderHexSync({ outcome }: { outcome: HexSyncOutcome }): readonly string[] {
  const lines = [
    `hex api surface — ${String(outcome.specsCompiled)} of ${String(outcome.specsDeclared)} pinned ` +
      `document(s) compiled into ${String(outcome.operationCount)} published operation(s), beside ` +
      `${String(outcome.mountedNouns)} mounted /api/v1 noun(s) and ${String(outcome.graphqlCount)} client ` +
      `GraphQL operation(s) — ${String(outcome.methodCount)} method row(s) in all`,
    `  ${String(outcome.withheldCount)} operation(s) WITHHELD — mapped in full and never called for their ` +
      "body, because their response is or renders a query result",
    `  ${String(outcome.shapeIndexedCount)} operation(s) shape-indexed — the project run family, mapped and ` +
      "never stored a row per record",
  ];
  if (outcome.specsFailed.length > 0) {
    lines.push(`  unread: ${outcome.specsFailed.join(", ")} — each carries its own gap`);
  }
  if (outcome.specsDrifted.length > 0) {
    lines.push(
      `  moved at their pinned address: ${outcome.specsDrifted.join(", ")} — compiled, and each carries its own gap`,
    );
  }
  return lines;
}

/**
 * One line for whichever arm of the fill's failure came back — a typed read error, or the publish's own
 * list of reasons.
 *
 * The two arms are genuinely different domains (`.claude/rules/error-handling.md`), so they are narrowed
 * here rather than merged behind a shared base type neither has.
 *
 * @param failure what the fill refused with
 * @returns the line to print
 */
function entitySyncFailureLine({ failure }: { failure: HexEntitySyncFailure }): string {
  if (failure.kind === "read") {
    return failure.error.message;
  }
  return failure.reasons.join("; ");
}

/**
 * The workspace half: fill the two entity kinds when a token exists, and say what would fill them when not.
 *
 * A token that is absent is a state this atlas has always reported rather than an error, and a token that is
 * REFUSED is reported the same way for the same reason — the anonymous surface map has already been published by
 * the time this runs, and throwing that away because a credential is wrong would lose a good generation over an
 * unrelated fact. An answer a boundary REFUSED is the one failure that fails the verb: the endpoint answered a
 * shape this version does not read, which is a broken read rather than a state, so it is `refused` and the verb
 * exits non-zero naming the endpoint and the field. The anonymous surface stays published either way.
 *
 * @param home the state home being written
 * @param at this run's ISO timestamp
 * @returns what the fill published, the line to print when it did not run, or the refusal that fails the verb
 */
async function fillWorkspaceEntities({
  home,
  at,
}: {
  home: string;
  at: string;
}): Promise<{ outcome: HexEntitySyncOutcome } | { skipped: string } | { refused: string }> {
  const opened = openHexClient({ home });
  if (opened.isErr()) {
    return { skipped: `  workspace entities NOT read: ${opened.error.message}` };
  }
  const filled = await syncHexWorkspaceEntities({ at, client: opened.value, paths: hexAtlasPaths({ home }) });
  if (filled.isErr() && filled.error.kind === "read" && filled.error.error.code === "MALFORMED_RESPONSE") {
    return { refused: `  workspace entities REFUSED: ${filled.error.error.message}` };
  }
  if (filled.isErr()) {
    return { skipped: `  workspace entities NOT read: ${entitySyncFailureLine({ failure: filled.error })}` };
  }
  return { outcome: filled.value };
}

/** What the workspace half printed in a `--json` document: the outcome, or the one line saying why there is none. */
function workspaceJson({
  workspace,
}: {
  workspace: { outcome: HexEntitySyncOutcome } | { skipped: string } | { refused: string };
}): HexEntitySyncOutcome | string {
  if ("outcome" in workspace) {
    return workspace.outcome;
  }
  return "refused" in workspace ? workspace.refused.trim() : workspace.skipped.trim();
}

/**
 * Run the Hex API-surface sync.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function hexAtlasSyncCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: HEX_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HEX_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: HEX_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const at = new Date().toISOString();
  const published = await syncHexApiSurface({ at, paths: hexAtlasPaths({ home }), transport: httpSpecTransport });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const workspace = await fillWorkspaceEntities({ at, home });
  const exitCode = "refused" in workspace ? EXIT_ERROR : EXIT_OK;
  if (asJson) {
    logger.out({
      line: JSON.stringify({ surface: published.value, workspace: workspaceJson({ workspace }) }, null, 1),
    });
    return exitCode;
  }
  for (const line of renderHexSync({ outcome: published.value })) {
    logger.out({ line });
  }
  if ("refused" in workspace) {
    logger.error({ msg: workspace.refused });
  } else if ("outcome" in workspace) {
    logger.out({
      line: `  workspace entities: ${String(workspace.outcome.projectCount)} project(s) and ${String(workspace.outcome.resourceCount)} resource(s) — what EXISTS, never a cell's output`,
    });
    if (workspace.outcome.tablesUnreadable.length > 0) {
      logger.out({
        line: `  ${String(workspace.outcome.tablesUnreadable.length)} project(s) would not hand over their queried tables — a gap says which`,
      });
    }
  } else {
    logger.out({ line: workspace.skipped });
    logger.out({ line: `  what fills them: ${HEX_ENTITY_UNBLOCKED_BY}` });
  }
  return exitCode;
}
