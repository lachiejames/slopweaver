/**
 * The effectful edge of a `--recommendations` flag: read the document it names and hand it to the pure parser.
 *
 * Both verbs that carry the lane accept the same three spellings a `--probes` value does — a literal JSON
 * document (which is how a recipe row passes it, as one argv word), a path, or `-` for stdin — so the reading
 * lives once, here, rather than as a second copy in each verb's shell.
 */
import { readFileSync } from "node:fs";

import { readStdin } from "../../lib/readStdin.js";
import { err, type Result } from "../../lib/result.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import {
  parseRecommendationSet,
  type RecommendationSet,
  type RecommendationSetError,
  RecommendationSetErrors,
} from "./recommendationSet.js";

/** A thrown value's own words. */
function causeText({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

/**
 * Read and parse one `--recommendations` value.
 *
 * @param value a literal JSON document, a path to one, or `-` for stdin
 * @param readInput reads the whole of stdin for `-`; the process's own stdin unless a test supplies the text
 * @returns the parsed set, or why it could not be read or is not one
 */
export async function resolveRecommendationSet({
  value,
  readInput = readStdin,
}: {
  readonly value: string;
  readonly readInput?: () => Promise<string>;
}): Promise<Result<RecommendationSet, RecommendationSetError>> {
  let text: string;
  if (value === "-") {
    text = await readInput();
  } else if (value.trimStart().startsWith("{")) {
    text = value;
  } else {
    try {
      text = readFileSync(value, "utf8");
    } catch (cause) {
      return err(
        RecommendationSetErrors.documentUnreadable({
          detail: `'${value}' is not a readable file: ${causeText({ cause })}`,
        }),
      );
    }
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: "--recommendations document", text });
  } catch (cause) {
    return err(RecommendationSetErrors.documentUnreadable({ detail: causeText({ cause }) }));
  }
  return parseRecommendationSet({ value: decoded });
}
