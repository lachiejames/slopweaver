/**
 * Finding a top-level key a JSON object names twice — the one check no parser here will do for you.
 *
 * It lives in its own module because BOTH the adoption pass and the ordinary reader need it, and they sit on
 * opposite sides of an import edge: `adopt.ts` imports `decode.ts`, so `decode.ts` cannot import `adopt.ts` back.
 * Living in `adopt.ts` alone would cover the one path a human is expected to use and not the path the briefing
 * renders from, so a hand-appended row whose `why` was written twice would reach the owner's page carrying only the
 * second one.
 */

/**
 * The first top-level key a candidate names twice, or undefined when it names each one once.
 *
 * `JSON.parse` keeps the LAST of two same-named keys and says nothing, so a row written by hand as
 * `{"why":"CI failed; merge refused","why":"CI green; merged"}` decodes to one `why` and the other is gone
 * before anything can notice. On this register that is the reasoning the owner steers against, silently replaced by
 * its own contradiction, while the change report says only that a witness was added.
 *
 * So the TEXT is scanned before the decoded object is trusted. A hand-written scan rather than a parser
 * because no parser here reports the duplicate — the whole defect is that every one of them resolves it.
 *
 * @param text the candidate's exact text, already known to decode as an object
 * @returns the duplicated key, or undefined when there is none
 */
export function duplicateTopLevelKey({ text }: { text: string }): string | undefined {
  const seen = new Set<string>();
  let depth = 0;
  let index = 0;
  while (index < text.length) {
    const step = nextToken({ depth, index, text });
    depth = step.depth;
    index = step.index;
    if (step.key === undefined) {
      continue;
    }
    if (seen.has(step.key)) {
      return step.key;
    }
    seen.add(step.key);
  }
  return undefined;
}

/**
 * Advance one token: a brace or bracket moves the depth, a string literal is skipped whole, and anything else
 * is one character. `key` is set only for a string at depth 1 that a `:` follows — the shape of a top-level
 * key, decoded so two spellings of one key compare equal.
 */
function nextToken({ text, index, depth }: { text: string; index: number; depth: number }): {
  index: number;
  depth: number;
  key: string | undefined;
} {
  const character = text[index];
  if (character === "{" || character === "[") {
    return { depth: depth + 1, index: index + 1, key: undefined };
  }
  if (character === "}" || character === "]") {
    return { depth: depth - 1, index: index + 1, key: undefined };
  }
  if (character !== '"') {
    return { depth, index: index + 1, key: undefined };
  }
  const read = readJsonString({ start: index, text });
  const isKey = depth === 1 && isKeyPosition({ from: read.next, text });
  return {
    depth,
    index: read.next,
    key: isKey ? decodeJsonStringLiteral({ literal: read.literal }) : undefined,
  };
}

/**
 * Read one JSON string literal starting at its opening quote, honouring backslash escapes.
 *
 * It answers the literal INCLUDING its quotes rather than the text between them, because the caller has to
 * decode it — see {@link decodeJsonStringLiteral}. Escapes are skipped rather than interpreted here, which is
 * only enough to find where the literal ends.
 */
function readJsonString({ text, start }: { text: string; start: number }): { literal: string; next: number } {
  let index = start + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === '"') {
      return { literal: text.slice(start, index + 1), next: index + 1 };
    }
    index += 1;
  }
  return { literal: text.slice(start), next: index };
}

/**
 * The STRING a JSON literal denotes, or undefined when it is not one.
 *
 * `JSON.parse` on the literal itself, because comparing raw spellings is not the comparison the parser makes:
 * a key written with a unicode escape for one of its letters is different TEXT and the SAME key, so a scan
 * over spellings reports no duplicate while the parser quietly keeps one of the two.
 * One key's literal is bounded by the field caps, so this is not a
 * data-sized parse.
 */
function decodeJsonStringLiteral({ literal }: { literal: string }): string | undefined {
  try {
    const decoded: unknown = JSON.parse(literal);
    return typeof decoded === "string" ? decoded : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the next non-space character after a string literal is the `:` that makes it a KEY. */
function isKeyPosition({ text, from }: { text: string; from: number }): boolean {
  let index = from;
  while (index < text.length && /\s/u.test(text[index]!)) {
    index += 1;
  }
  return text[index] === ":";
}
