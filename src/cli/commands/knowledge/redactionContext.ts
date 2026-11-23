/**
 * The one place a knowledge verb opens its redaction inputs: the install's replacement map, read from the home,
 * and a scanner bound to the committed rules. Shared by `redaction-scan`, `redact` and every `--redact` flag, so
 * each says the same thing about whether the map ran.
 *
 * `--redact` is opt-in on every writer, never a default: a row about a provider in general stays as written, and
 * an install with no map loses nothing it did not ask to lose.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { FORBIDDEN_IDENTIFIER_RULES } from "../../../hygiene/forbiddenIdentifiers.js";
import { type IdentifierScanner, identifierScanner } from "../../../hygiene/identifierScan.js";
import { loadReplacementMap, type ReplacementRule, replacementMapStatusLine } from "../../../hygiene/replacementMap.js";
import type { MemoryRecording } from "../../../knowledge/memory.js";
import { planKnowledgeRedaction } from "../../../knowledge/redaction.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";

/** What a redacting verb runs with. */
export interface KnowledgeRedactionInputs {
  readonly home: string;
  readonly map: readonly ReplacementRule[];
  readonly scanner: IdentifierScanner;
}

/**
 * The `--home` a caller passed, else the ambient home — absence by design, so an `if` that returns.
 *
 * @param home the `--home` a caller passed, when it passed one
 * @returns the home directory every redaction read resolves against
 */
function resolveHome({ home }: { home: string | undefined }): string {
  if (home !== undefined) {
    return home;
  }
  return slopweaverHome();
}

/**
 * Resolve the home, load its map, bind the committed rules, and say on stderr whether the map ran.
 *
 * @param home the `--home` a caller passed, when it passed one
 * @param verb the prefix a refusal carries
 * @returns the inputs, or the one-line refusal — a map that cannot be read or parsed is never treated as empty
 */
export function openRedactionInputs({
  home,
  verb,
}: {
  home: string | undefined;
  verb: string;
}): Result<KnowledgeRedactionInputs, string> {
  const resolved = resolveHome({ home });
  const load = loadReplacementMap({ home: resolved });
  if (load.isErr()) {
    return err(`${verb}: ${load.error.message}`);
  }
  logger.warn({ msg: replacementMapStatusLine({ load: load.value }) });
  return ok({
    home: resolved,
    map: load.value.rules,
    scanner: identifierScanner({ rules: FORBIDDEN_IDENTIFIER_RULES }),
  });
}

/**
 * `--redact` on a single-row writer: the one recording about to be inserted, through the same plan `knowledge
 * redact` runs over the store, before any connection opens.
 *
 * @param recording the row about to be written
 * @param home the `--home` a caller passed, when it passed one
 * @param verb the prefix a refusal carries
 * @returns the redacted row, or `undefined` once a refusal is printed — the caller exits non-zero and writes
 *   nothing
 */
export function redactRecordingForWrite({
  recording,
  home,
  verb,
}: {
  recording: MemoryRecording;
  home: string | undefined;
  verb: string;
}): MemoryRecording | undefined {
  const inputs = openRedactionInputs({ home, verb });
  if (inputs.isErr()) {
    logger.error({ msg: inputs.error });
    return undefined;
  }
  const plan = planKnowledgeRedaction({
    map: inputs.value.map,
    memories: [recording],
    recalls: [],
    scanner: inputs.value.scanner,
  });
  if (plan.isErr()) {
    logger.error({ msg: plan.error.message });
    return undefined;
  }
  return plan.value.memories[0]!;
}
