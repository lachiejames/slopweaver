/**
 * PURE argument handling for `gmail connect` — the mail door's consent verb, parsed here and nowhere else.
 *
 * Its own file rather than a section of `core.ts` for the reason the Google Admin door's `connectCore.ts`
 * is: a connect verb's grant table is the door's SCOPE POLICY written as flag names, and it is read and
 * argued about on its own, while the rest of the noun's parsers are about mail. Splitting it is also what
 * keeps `core.ts` under the `file-size-ratchet` cap.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { GmailCapability } from "../../../live/gmail/scopes.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type GmailArgsError, GmailArgsErrors } from "./errors.js";

/** The capabilities `gmail connect` may be asked to request, by their flag-facing names. */
const GRANT_CHOICES: Readonly<Record<string, readonly GmailCapability[]>> = {
  full: ["read", "modify", "compose", "send", "docs"],
  // `docs` rides on EVERY grant, including the narrowest, and that is deliberate rather than sloppy. The
  // Gemini meeting-notes emails Google Meet sends carry an inline summary and a LINK to the doc holding the
  // full transcript, so without it the narrowest grant ingests half of every meeting and cannot say which
  // half. It is `documents.readonly` — it reads a document, it cannot list a Drive, and it cannot write.
  read: ["read", "docs"],
  // The default, and it is deliberately not `read`: labelling, read-state and archiving are the verbs the
  // owner reaches for straight after reading, and re-running consent to widen a grant costs a full browser
  // round trip. `manage` asks for the reading and organising half up front, and leaves the two grants that
  // can put mail in front of another person (`compose`, `send`) to an explicit `--grant full`.
  manage: ["read", "modify", "docs"],
};

/** What an unflagged `gmail connect` asks for — see {@link GRANT_CHOICES} for why it is not `read`. */
const DEFAULT_GRANT = "manage";

/** The `--grant` names, in the order `--help` lists them. */
const GRANT_NAMES: readonly string[] = ["read", "manage", "full"];

/**
 * A parsed `gmail connect` invocation.
 *
 * @internal — the declared shape of {@link parseGmailConnectArgs}'s success value; no caller names it.
 */
export interface GmailConnectArgs {
  readonly home: string | undefined;
  readonly capabilities: readonly GmailCapability[];
  readonly json: boolean;
  /** Report the stored grant and stop, without opening a browser or a socket. */
  readonly statusOnly: boolean;
  /** Withdraw the stored grant at Google and delete the file, without opening a browser or a socket. */
  readonly revoke: boolean;
}

/**
 * `gmail connect` usage.
 *
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const GMAIL_CONNECT_USAGE =
  "usage: slopweaver gmail connect [--grant <read|manage|full>] [--status] [--revoke] [--json]\n" +
  "       [--home <dir>]\n" +
  "  Opens Google's consent screen in your browser and stores the resulting grant, owner-only\n" +
  "  --grant   which capabilities to request (default manage: read + labels/read-state/archive)\n" +
  "  --status  report the stored grant's account and scopes and stop — no browser, no socket\n" +
  "  --revoke  withdraw the stored grant at Google and delete it — Google revokes the whole\n" +
  "            (client, account) grant at once, so every door sharing this OAuth client goes with it\n" +
  "  --json    emit the token-free grant status as one machine-readable document";

/**
 * Parse the `gmail connect` tail.
 *
 * @param rest the argv tail after `gmail connect`
 * @returns the validated request, or every reason it was refused
 */
export function parseGmailConnectArgs({ rest }: { rest: readonly string[] }): Result<GmailConnectArgs, GmailArgsError> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json", "revoke", "status"], value: ["grant", "home"] } });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: GMAIL_CONNECT_USAGE }));
  }
  // A destructured default rather than an operator: which grant an unflagged `connect` asks for is a policy
  // choice, and `no-silent-fallback` is what keeps it spelled as one.
  const { grant = DEFAULT_GRANT } = parsed.value.values;
  const capabilities = GRANT_CHOICES[grant];
  if (capabilities === undefined) {
    return err(GmailArgsErrors.grantUnknown({ grant, known: GRANT_NAMES, usage: GMAIL_CONNECT_USAGE }));
  }
  return ok({
    capabilities,
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
    revoke: parsed.value.flags.has("revoke"),
    statusOnly: parsed.value.flags.has("status"),
  });
}
