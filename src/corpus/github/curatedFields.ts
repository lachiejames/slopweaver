/**
 * How the curated lane's loosely-typed raw fields read into the text a curated record carries: a string or an
 * honest empty one, an author's login, and the label a release is shown under.
 *
 * Split from `./curated.ts`, which is at its file-size floor (`.baselines/file-size-baseline.json`), along the
 * line between READING one raw field and SHAPING a whole item. Every function here is pure.
 */
import { isRecord } from "../../lib/parsers.js";
import { optStr as str } from "../slack/shape.js";

/**
 * A string field off an unknown, or `""` when absent — an honest empty sentinel, not a fail-loud path.
 *
 * @param value the raw field, of unvalidated shape
 * @returns the string, or `""` when the field holds anything else
 */
export function strOrEmpty({ value }: { value: unknown }): string {
  return typeof value === "string" ? value : "";
}

/**
 * The `.login` off a nested author object.
 *
 * @param value the raw author object, of unvalidated shape
 * @returns the login, or `undefined` when there is no author object or it carries no login
 */
export function authorLoginOf({ value }: { value: unknown }): string | undefined {
  return isRecord(value) ? str({ value: value["login"] }) : undefined;
}

/**
 * The label a release is shown under. GitHub's `release` schema declares `name: string | null`: a release
 * published from a bare tag, with no title typed, carries `null`, and GitHub's own release page then shows the
 * tag in its place — so this does the same.
 *
 * @param name the raw `name` field
 * @param tag the release's tag — its identity, already established
 * @returns the release's own name, or its tag when it was published without one
 */
export function releaseNameOf({ name, tag }: { name: unknown; tag: string }): string {
  const own = str({ value: name });
  if (own === undefined) {
    return tag;
  }
  return own;
}
