/**
 * PURE argument handling for `gmail archive`, apart from `./core.ts` because it is the one mutation verb that takes
 * many ids — the exact set a triage card named — and that file sits at the size ratchet. Refused before a credential
 * is read, like every `gmail` parser.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { SYSTEM_LABELS } from "../../../live/gmail/labels.js";
import { parseFlagTail } from "../../optionParsers.js";
import type { GmailModifyArgs } from "./core.js";
import { type GmailArgsError, GmailArgsErrors } from "./errors.js";

/**
 * The most ids one `gmail archive` takes. Each is its own door request and its own Gmail call, so this bounds one
 * invocation's run time and its ledger rows; a card's set larger than this is split across calls.
 */
export const MAX_ARCHIVE_IDS = 100;

/** `gmail archive` usage. */
const ARCHIVE_USAGE =
  "usage: slopweaver gmail archive <message-id>... [--restore] [--thread] [--dry-run] [--json] [--home <dir>]\n" +
  "  Archives each message — Gmail's INBOX label, removed. The mail is not deleted and stays searchable\n" +
  "  --restore put it BACK in the inbox instead\n" +
  "  --thread  treat each id as a THREAD id and archive every message in it\n" +
  "  --dry-run print exactly what would change, and send nothing\n" +
  `  Up to ${String(MAX_ARCHIVE_IDS)} ids, each its own change and its own report`;

/**
 * Parse the `gmail archive` tail: one or more leading ids, then flags. Many ids exist so the EXACT set a triage card
 * named is archived in one call; a repeated id is dropped rather than changed twice.
 *
 * @param rest the argv tail after `gmail archive`
 * @returns the validated request, or the one reason it was refused
 */
export function parseGmailArchiveArgs({ rest }: { rest: readonly string[] }): Result<GmailModifyArgs, GmailArgsError> {
  const firstFlag = rest.findIndex((token) => token.startsWith("-"));
  const leading = firstFlag === -1 ? rest : rest.slice(0, firstFlag);
  const addresses = [...new Set(leading)];
  if (addresses.length === 0) {
    return err(GmailArgsErrors.argumentMissing({ name: "<message-id>", usage: ARCHIVE_USAGE }));
  }
  if (addresses.length > MAX_ARCHIVE_IDS) {
    return err(GmailArgsErrors.tooManyIds({ got: addresses.length, max: MAX_ARCHIVE_IDS, usage: ARCHIVE_USAGE }));
  }
  const parsed = parseFlagTail({
    rest: rest.slice(leading.length),
    spec: { boolean: ["dry-run", "json", "restore", "thread"], value: ["home"] },
  });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: ARCHIVE_USAGE }));
  }
  const restore = parsed.value.flags.has("restore");
  return ok({
    addRefs: restore ? [SYSTEM_LABELS.inbox] : [],
    addresses,
    dryRun: parsed.value.flags.has("dry-run"),
    home: parsed.value.values["home"],
    intent: restore ? "restore to inbox" : "archive",
    json: parsed.value.flags.has("json"),
    removeRefs: restore ? [] : [SYSTEM_LABELS.inbox],
    thread: parsed.value.flags.has("thread"),
  });
}
