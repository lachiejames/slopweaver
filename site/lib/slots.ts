/**
 * The slot machinery: what a request may supply to a verb the console runs, and the shapes it is checked
 * against before it becomes an argv element.
 *
 * It lives here rather than inside `actVerbs.ts` because there is now more than one closed list that fills
 * slots — the act list the Queue presses, and `talkToolsList.ts`, the read tools the console voice's model may call.
 * Two copies of this check would be two places for a leading hyphen to stop being refused, and the whole
 * property both lists depend on is that a value can never be read as a flag, a path or a verb.
 *
 * **What a slot may never be**: a verb or a flag. A list's argv is literal except at its declared slots,
 * every shape below either refuses a leading hyphen or hex-encodes its value into one argv element (`request`,
 * `hexText`), and there is no shape whose value could name a command.
 *
 * **A path IS a slot shape, and saying so plainly matters.** The act list has no path slot and none of its
 * rows could take one. The console voice's `code_read` and `code_list` take exactly that, because reading a
 * named file is what they are for. What bounds them is NOT this file: `talk code` refuses anything outside
 * the serving checkout, anything git does not track, and four classes of alias, re-checked on the open
 * descriptor (`src/talk/checkout.ts`). `PATH_SHAPE` here is the cheap half in front of that — an absolute
 * path, a `..` segment or a control byte is refused before a verb is launched at all — and treating it as
 * the protection would be reading this file as the boundary when the verb is.
 *
 * `localPath` is the other path shape, for `file_read` and `file_list`: any file on this machine, so it must be ABSOLUTE or `~`-rooted — the opposite of `path`. What bounds it is again
 * the verb: `talk file` refuses every credential store and credential-named file, on the path as asked and on
 * where it resolves, and masks credentials inside an ordinary file (`src/talk/localPath.ts`, `localFile.ts`).
 */
import { encodeVerbRequest } from "./verbRequest";

/** A value the request supplies, checked against one of two shapes before it becomes an argv element. */
export interface Slot {
  readonly slot: string;
  /**
   * `id` is an identifier a register printed — letters, digits, dot, underscore, hyphen, never a leading
   * hyphen, so it can never be read as a flag. `text` is prose: any printable line up to 2000 characters,
   * never starting with a hyphen for the same reason (`src/cli/parseFlags.ts` refuses a value that starts
   * with `--`, and this refuses a step earlier so the refusal is the console's own). `count` is a
   * non-negative decimal integer, which is what a byte offset into a file is. `path` is a repository-relative
   * path, bounded here only cheaply — see the file overview. `localPath` is an absolute or `~/` path on this
   * machine, bounded by `talk file` rather than here. `request` is the `verb` tool's structured
   * `{ noun, verb, args }`, which becomes ONE hex-encoded argv element (`./verbRequest.ts`). `hexText` is
   * `text` that MAY start with a hyphen, because it travels as one hex argv element no parser can read as a
   * flag — for a verb that takes a hex spelling (`talk code find --text-hex`), so the voice can search for a
   * flag such as `--json` itself (without this the voice's search for it is refused, measured twice).
   */
  readonly shape: "count" | "id" | "path" | "localPath" | "text" | "hexText" | "request";
}

/** An identifier as a register prints one: no leading hyphen, so it can never be read as a flag. */
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

/** A non-negative decimal integer, with no sign and no separators, so it can never be read as a flag. */
const COUNT_SHAPE = /^(0|[1-9][0-9]{0,15})$/;

/**
 * A repository-relative path: printable, no NUL, no control bytes, and short enough to be a real one.
 *
 * Backslash is allowed because a filename may legitimately contain one on this platform, and nothing here
 * ever reaches a shell — every argv is spawned as an array (`site/lib/spawnVerb.ts`), so there is no
 * quoting surface for one to escape.
 */
// The control range IS the subject here: this refuses a path carrying a NUL or an escape, which is exactly
// what the rule below assumes nobody means to match.
// oxlint-disable-next-line no-control-regex
const PATH_SHAPE = /^[^\u0000-\u001F\u007F]{1,1024}$/;

/** Prose: printable, one line or several, up to 2000 characters. */
export const TEXT_MAX = 2000;

/**
 * Check one supplied value against its slot's shape.
 *
 * @param slot the declared shape this value has to fit
 * @returns `undefined` when it fits, else the sentence the refusal prints
 */
export function refuseSlot({ slot, value }: { slot: Slot; value: string }): string | undefined {
  if (slot.shape === "id") {
    if (!ID_SHAPE.test(value)) {
      return `${slot.slot} is not an id a register prints: letters, digits, dot, underscore or hyphen, up to 120, never starting with a hyphen`;
    }
    return undefined;
  }
  if (slot.shape === "count") {
    if (!COUNT_SHAPE.test(value)) {
      return `${slot.slot} is not a count: a whole number from 0 up, written in digits, with no sign`;
    }
    return undefined;
  }
  if (slot.shape === "path") {
    if (!PATH_SHAPE.test(value)) {
      return `${slot.slot} is empty, over 1024 characters, or carries a control character`;
    }
    if (value.startsWith("-")) {
      return `${slot.slot} starts with a hyphen, which the verb would read as a flag`;
    }
    if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
      return `${slot.slot} is absolute; the checkout's own paths are relative to its root`;
    }
    if (value.split("/").includes("..")) {
      return `${slot.slot} climbs out of the checkout with a .. segment`;
    }
    return undefined;
  }
  if (slot.shape === "localPath") {
    if (!PATH_SHAPE.test(value)) {
      return `${slot.slot} is empty, over 1024 characters, or carries a control character`;
    }
    const rooted = value.startsWith("/") || value === "~" || value.startsWith("~/");
    if (!rooted) {
      return `${slot.slot} is not a whole path: give one starting / or ~/`;
    }
    return undefined;
  }
  if (value.trim().length === 0) {
    return `${slot.slot} is empty; the verb records your words, so it needs some`;
  }
  if (value.length > TEXT_MAX) {
    return `${slot.slot} is ${String(value.length)} characters; the console carries up to ${String(TEXT_MAX)}`;
  }
  if (slot.shape === "text" && value.startsWith("-")) {
    return `${slot.slot} starts with a hyphen, which the verb would read as a flag; start it with a word`;
  }
  // A lone surrogate has no UTF-8 spelling: TextEncoder writes U+FFFD for it, so the verb would search for a
  // character nobody asked for. Under `u`, a paired surrogate is one code point, not Cs.
  if (slot.shape === "hexText" && /\p{Cs}/u.test(value)) {
    return `${slot.slot} carries half of a character, which no file can contain`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    return `${slot.slot} carries a control character`;
  }
  return undefined;
}

/** What building an argv came to: the literal argv, or the one refusal. */
export type BuiltArgv =
  { readonly kind: "argv"; readonly argv: readonly string[] } | { readonly kind: "refused"; readonly why: string };

/**
 * Fill a declared argv's slots from a request body, refusing anything that is not exactly those slots.
 *
 * Unknown fields are refused rather than ignored: a body carrying a field the row did not declare is a
 * client that thinks it can pass something the door does not take, and silence there would teach it
 * otherwise. That matters more for the console voice than for a button, because there the client composing the
 * body is a language model rather than a page this repository wrote.
 *
 * @param parts the row's argv — literal strings and declared slots
 * @param supplied the request's fields
 * @param subject what the refusal names, so a reader knows which row said no
 * @returns the argv, or the refusal
 */
export function fillSlots({
  parts,
  supplied,
  subject,
}: {
  parts: readonly (string | Slot)[];
  supplied: Record<string, unknown>;
  subject: string;
}): BuiltArgv {
  const declared = new Set(parts.filter((part): part is Slot => typeof part !== "string").map((part) => part.slot));
  for (const key of Object.keys(supplied)) {
    if (!declared.has(key)) {
      return { kind: "refused", why: `${subject} takes no field named ${key}` };
    }
  }
  const argv: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      argv.push(part);
      continue;
    }
    if (!(part.slot in supplied)) {
      return { kind: "refused", why: `${subject} needs ${part.slot}` };
    }
    const value = supplied[part.slot];
    if (part.shape === "request") {
      const encoded = encodeVerbRequest({ value });
      if (encoded.kind === "refused") {
        return encoded;
      }
      argv.push(encoded.hex);
      continue;
    }
    if (typeof value !== "string") {
      return { kind: "refused", why: `${part.slot} must be a string` };
    }
    const refused = refuseSlot({ slot: part, value });
    if (refused !== undefined) {
      return { kind: "refused", why: refused };
    }
    if (part.shape === "hexText") {
      argv.push(utf8Hex({ text: value }));
      continue;
    }
    argv.push(value);
  }
  return { argv, kind: "argv" };
}

/**
 * A string's UTF-8 bytes as lowercase hex — the argv spelling of a `hexText` slot.
 *
 * @param text the checked value
 * @returns two hex digits per byte, which can never start with a hyphen
 */
export function utf8Hex({ text }: { text: string }): string {
  return Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
