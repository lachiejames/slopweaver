/**
 * Pure Slack file reference → file id. The front door of `slack read-file`, and the mirror of
 * `permalink.ts` for the OTHER kind of Slack link: `permalink.ts` resolves a message, this resolves a file.
 *
 * ## The shapes Slack hands a person
 *
 * There is no single canonical file URL. The four that reach a clipboard in practice are:
 *
 * - `https://<ws>.slack.com/docs/<TEAM>/<FILE>` — a canvas or huddle-notes doc, which is the shape the
 *   Files browser copies and the one this verb was built for;
 * - `https://<ws>.slack.com/canvas/<FILE>` — the same object, opened as a canvas;
 * - `https://<ws>.slack.com/files/<USER>/<FILE>/<name>` — an ordinary upload;
 * - `https://files.slack.com/files-pri/<TEAM>-<FILE>/<name>` — the private-download host.
 *
 * The file id is a path SEGMENT in the first three and a hyphen-joined half of one in the fourth. Rather
 * than matching four path templates — a list that would go stale the next time Slack adds a surface — the
 * parser looks for the one thing every shape shares: a `F…` id somewhere in the path. Slack ids are
 * `[A-Z0-9]`, and no other segment of a Slack URL both starts with `F` and is all-caps-alphanumeric, so the
 * scan is unambiguous rather than merely convenient.
 *
 * ## Why a message permalink is refused BY NAME
 *
 * `/archives/<channel>/p<ts>` parses as a Slack URL and contains no file id, so the generic refusal would
 * be "no file id in the path" — true, useless, and one letter away from the verb the caller wanted. It is
 * detected and named instead, pointing at `slack read-thread`. `read-thread`'s own refusal already does the
 * reverse for a file link, so the two verbs hand a mistaken caller to each other.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type SlackFileReferenceError, SlackFileReferenceErrors } from "./fileErrors.js";

/**
 * Whether a hostname is Slack's, matching the LABEL rather than the suffix.
 *
 * `hostname.endsWith("slack.com")` is the shape CodeQL calls incomplete URL substring sanitization, and it
 * is wrong rather than merely untidy: `evilslack.com` ends with `slack.com`, so the sloppy test accepted a
 * link on a host nobody here controls. The dot is what makes it a subdomain test. Same rule as
 * `download.ts`'s `isSlackFileHost`, which got it right; this parser did not.
 *
 * @param hostname the URL's hostname, already lowercased by `URL`
 * @returns true when the host is `slack.com` itself or one of its subdomains
 */
function isSlackHost({ hostname }: { hostname: string }): boolean {
  return hostname === "slack.com" || hostname.endsWith(".slack.com");
}

/** A Slack file id: `F` plus the id alphabet. The length floor keeps a bare `F` from parsing. */
const FILE_ID = /^F[A-Z0-9]{6,}$/;

/** A file id anywhere inside one path segment, so `files-pri/T123-F456` yields `F456`. */
const FILE_ID_IN_SEGMENT = /\bF[A-Z0-9]{6,}\b/;

/**
 * Whether a string is a bare Slack file id rather than a URL.
 *
 * @param value the candidate, already trimmed
 * @returns true when Slack would accept it as `files.info`'s `file` argument
 *
 * @internal — exported for its own unit test; the parser below is the only caller.
 */
export function isSlackFileId({ value }: { value: string }): boolean {
  return FILE_ID.test(value);
}

/**
 * Resolve whatever the caller pasted to the file id `files.info` needs.
 *
 * @param reference a bare `F…` id, or any Slack URL whose path carries one
 * @returns the file id, or `err` naming exactly why the reference was refused
 */
export function parseSlackFileReference({ reference }: { reference: string }): Result<string, SlackFileReferenceError> {
  const trimmed = reference.trim();
  if (trimmed.length === 0) {
    return err(SlackFileReferenceErrors.empty());
  }
  if (isSlackFileId({ value: trimmed })) {
    return ok(trimmed);
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return err(SlackFileReferenceErrors.notAReference({ text: trimmed }));
  }
  if (url.protocol !== "https:") {
    return err(SlackFileReferenceErrors.notHttps({ protocol: url.protocol }));
  }
  if (!isSlackHost({ hostname: url.hostname })) {
    return err(SlackFileReferenceErrors.notSlackHost({ hostname: url.hostname }));
  }
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments[0] === "archives") {
    return err(SlackFileReferenceErrors.isMessagePermalink({ url: trimmed }));
  }
  for (const segment of segments) {
    const found = FILE_ID_IN_SEGMENT.exec(decodeURIComponent(segment))?.[0];
    if (found !== undefined) {
      return ok(found);
    }
  }
  return err(SlackFileReferenceErrors.noFileId({ pathname: url.pathname }));
}
