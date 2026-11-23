/**
 * The first object key a JSON document spells twice in one object.
 *
 * `JSON.parse` keeps the LAST value of a repeated key and says nothing, so `{"n":{…},"n":null}` reads as though the
 * first `n` never existed. A reader that must not lose what a document holds asks this first. It scans the text once,
 * holding one key set per open object; a key is compared decoded, so `"a"` and `"a"` are the same key.
 */

/** One open object or array: the keys an object has spelled so far, and the segment its current child sits under. */
interface Frame {
  readonly keys: Set<string> | undefined;
  child: string;
}

/** The index just past the string literal opening at `start`, escapes skipped. */
function stringEnd({ text, start }: { text: string; start: number }): number {
  let at = start + 1;
  while (at < text.length) {
    const char = text[at];
    if (char === "\\") {
      at += 2;
    } else if (char === '"') {
      return at + 1;
    } else {
      at += 1;
    }
  }
  return at;
}

/** Whether the next character past `from` that is not whitespace is a colon — what makes a string a key. */
function opensValue({ text, from }: { text: string; from: number }): boolean {
  let at = from;
  while (at < text.length && /\s/u.test(text[at]!)) {
    at += 1;
  }
  return text[at] === ":";
}

/** The path to a key just spelled, when its object already holds it; the key is recorded either way. */
function repeatedKey({
  frames,
  top,
  literal,
}: {
  frames: readonly Frame[];
  top: Frame;
  literal: string;
}): string[] | undefined {
  const key = String(JSON.parse(literal));
  top.child = key;
  if (top.keys!.has(key)) {
    return frames.map((frame) => frame.child);
  }
  top.keys!.add(key);
  return undefined;
}

/** Move past one structural character, opening, closing or advancing a frame. */
function step({ frames, char }: { frames: Frame[]; char: string }): void {
  if (char === "{") {
    frames.push({ child: "", keys: new Set() });
  } else if (char === "[") {
    frames.push({ child: "0", keys: undefined });
  } else if (char === "}" || char === "]") {
    frames.pop();
  } else if (char === ",") {
    const top = frames.at(-1);
    if (top !== undefined && top.keys === undefined) {
      top.child = String(Number(top.child) + 1);
    }
  }
}

/**
 * The path to the first key spelled twice in one object, outermost segment first (an array position is its index),
 * or `undefined` when no object repeats a key. The text is taken to be JSON that already parses.
 *
 * @param text one JSON document
 * @returns the repeated key's path, or `undefined`
 */
export function findDuplicateKey({ text }: { text: string }): readonly string[] | undefined {
  const frames: Frame[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at]!;
    if (char === '"') {
      const end = stringEnd({ start: at, text });
      const top = frames.at(-1);
      if (top?.keys !== undefined && opensValue({ from: end, text })) {
        const path = repeatedKey({ frames, literal: text.slice(at, end), top });
        if (path !== undefined) {
          return path;
        }
      }
      at = end;
    } else {
      step({ char, frames });
      at += 1;
    }
  }
  return undefined;
}
