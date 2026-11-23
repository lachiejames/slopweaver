/**
 * `slopweaver atlas gemini-ai-studio sync [--json] [--home <dir>]` — compile Google's three published Gemini
 * discovery documents into the atlas's `discovery-specification` surface.
 *
 * The network calls it can make are GETs of three public, unauthenticated documents, and only for a document
 * not already cached under the atlas root — so a run that finds the reviewed bytes on disk makes no request
 * at all. It needs no Google credential, reaches no project, and writes only under `$SLOPWEAVER_HOME`, which
 * is why it is `local-state` rather than `external-write` and routes through no door.
 */
import {
  GEMINI_AI_STUDIO_ENTITIES_HOLDER,
  type GeminiAiStudioSyncOutcome,
} from "../../../atlas/geminiAiStudio/geminiAiStudioSurfaces.js";
import { geminiAiStudioAtlasPaths } from "../../../atlas/geminiAiStudio/store.js";
import { syncGeminiAiStudioCompiledSurface } from "../../../atlas/geminiAiStudio/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, the `atlas` noun and the `gemini-ai-studio` platform. */
const GEMINI_AI_STUDIO_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const GEMINI_AI_STUDIO_SYNC_USAGE = "usage: slopweaver atlas gemini-ai-studio sync [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** Print what the sync published. */
function report({ asJson, outcome }: { asJson: boolean; outcome: GeminiAiStudioSyncOutcome }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(outcome, null, 1) });
    return;
  }
  const counts = outcome.dispositionCounts;
  logger.out({
    line:
      `gemini-ai-studio surface — ${String(outcome.operationCount)} operation(s) across ` +
      `${String(outcome.kindCount)} kind(s), folded from ${String(outcome.declarationCount)} declaration(s) ` +
      `in ${String(outcome.specs.length)} published version(s): ${String(counts.reachable)} reachable, ` +
      `${String(counts.voluminous)} voluminous, ${String(counts.excluded)} excluded`,
  });
  for (const spec of outcome.specs) {
    logger.out({
      line:
        `  ${spec.version} revision ${spec.revision} read from ${spec.origin}` +
        `${spec.matchesReviewedCensus ? "" : " — census MOVED from the reviewed one, see the spec-revision-moved gap"}`,
    });
  }
  logger.out({
    line:
      `  ${String(outcome.versionDisagreementCount)} operation(s) described differently by two versions, ` +
      `${String(outcome.versionExclusiveCount)} declared by exactly one; ` +
      `${String(outcome.declaredPageCount)} browser page(s) declared and none visited`,
  });
  logger.out({
    line: `  this atlas holds NO entity of this organisation's: they are ${GEMINI_AI_STUDIO_ENTITIES_HOLDER}'s, which is registered and not yet built`,
  });
}

/**
 * Compile and publish the discovery-document surface.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function geminiAiStudioAtlasSyncCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: GEMINI_AI_STUDIO_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: GEMINI_AI_STUDIO_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: GEMINI_AI_STUDIO_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const published = await syncGeminiAiStudioCompiledSurface({
    at: new Date().toISOString(),
    paths: geminiAiStudioAtlasPaths({ home }),
  });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson, outcome: published.value });
  return EXIT_OK;
}
