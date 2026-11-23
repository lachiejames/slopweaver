/**
 * PURE argument handling for the `drive` noun. Every verb's tail is parsed here and nowhere else, so a
 * malformed invocation is refused before a credential is read or a socket is opened — which is what lets
 * every `drive` verb declare `parseRejectIsIoFree`.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../../../live/drive/read.js";
import type { DriveCapability } from "../../../live/drive/scopes.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";
import type { GoogleConnectArgs } from "../google/connectShell.js";
import { type DriveArgsError, DriveArgsErrors } from "./errors.js";

/**
 * The capabilities `drive connect` may be asked to request, by their flag-facing names.
 *
 * The first line between them is Google's sharpest: `metadata` can enumerate and describe every file and
 * cannot read one byte of any of them, while `read` can. An install that only ever answers "what is in
 * here, who owns it, when did it change" never has to grant the ability to read the files themselves — so
 * the narrow grant is the DEFAULT, and reading content is the deliberate choice.
 *
 * `write` is the third, and it is the rule expressed as a grant: create Drive files
 * and edit the owner's Google Docs, on top of everything `read` holds. It is requested as a whole rather than
 * incrementally so the consent screen shows exactly what the door will be able to do, in one place, once —
 * the same argument `calendar connect --grant meetings` is built on. What it deliberately cannot do, and
 * why, is `src/live/drive/scopes.ts`'s header.
 */
const GRANT_CHOICES: Readonly<Record<string, readonly DriveCapability[]>> = {
  metadata: ["metadata"],
  read: ["metadata", "content"],
  write: ["metadata", "content", "write", "docs"],
};

/** The `--grant` names, in the order `--help` lists them. */
const GRANT_NAMES: readonly string[] = ["metadata", "read", "write"];

/**
 * A parsed `drive list` invocation.
 *
 * @internal — the declared shape of `parseDriveListArgs`'s success value; no caller names it.
 */
export interface DriveListArgs {
  readonly home: string | undefined;
  readonly query: string | undefined;
  readonly folderId: string | undefined;
  readonly driveId: string | undefined;
  readonly limit: number;
  readonly includeTrashed: boolean;
  readonly json: boolean;
}

/**
 * A parsed `drive read` invocation.
 *
 * @internal — the declared shape of `parseDriveReadArgs`'s success value; no caller names it.
 */
export interface DriveReadArgs {
  readonly home: string | undefined;
  readonly address: string;
  readonly withText: boolean;
  readonly json: boolean;
}

/**
 * A parsed `drive drives` invocation.
 *
 * @internal — the declared shape of `parseDriveDrivesArgs`'s success value; no caller names it.
 */
export interface DriveDrivesArgs {
  readonly home: string | undefined;
  readonly json: boolean;
}

/** `drive connect` usage. */
const CONNECT_USAGE =
  "usage: slopweaver drive connect [--grant <metadata|read|write>] [--status] [--revoke] [--json]\n" +
  "       [--home <dir>]\n" +
  "  Opens Google's consent screen in your browser and stores the resulting grant, owner-only\n" +
  "  --grant   metadata (default) lists and describes files and CANNOT read one; read can read them;\n" +
  "            write adds creating Drive files and editing your Google Docs — never deleting a file it\n" +
  "            did not create, and never reaching a shared drive\n" +
  "  --status  report the stored grant's account and scopes and stop — no browser, no socket\n" +
  "  --revoke  withdraw the stored grant at Google and delete it — Google revokes the whole\n" +
  "            (client, account) grant at once, so every door sharing this OAuth client goes with it\n" +
  "  --json    emit the token-free grant status as one machine-readable document";

/** `drive list` usage. */
const LIST_USAGE =
  "usage: slopweaver drive list [--query <drive-query>] [--folder <id>] [--drive <id>] [--limit <1..100>] " +
  "[--trashed] [--json] [--home <dir>]\n" +
  "  Lists matching files as metadata only — name, type, size, owner, modified date. No content is read\n" +
  "  --query   a Drive search expression, as the API takes it (`name contains 'budget'`)\n" +
  "  --folder  restrict to the direct children of one folder id\n" +
  "  --drive   search a SHARED drive instead of My Drive — `drive drives` lists their ids\n" +
  "  --limit   how many files to read (default 25, maximum 100)\n" +
  "  --trashed include trashed files, which are excluded by default";

/** `drive read` usage. */
const READ_USAGE =
  "usage: slopweaver drive read <file-id-or-url> [--metadata-only] [--json] [--home <dir>]\n" +
  "  Reads one file: its metadata always, and its text when it is a Google Doc, Sheet or Slides deck\n" +
  "  --metadata-only  do not export any text, even from a document that has one\n" +
  "  --json           emit one machine-readable document with freshness, coverage and residue\n" +
  "  A binary file's bytes are never downloaded — the read says so rather than failing";

/** `drive drives` usage. */
const DRIVES_USAGE =
  "usage: slopweaver drive drives [--json] [--home <dir>]\n" +
  "  Lists every SHARED drive this account can see, with the id a `drive list` restriction takes\n" +
  "  --json    emit one machine-readable document with freshness, coverage and residue";

/**
 * Every flag each `drive` verb's parser accepts, derived from the exact specs the parsers below pass.
 *
 * The help-truth contract reads this: a flag the parser takes and the usage hides is the same defect as a
 * flag the usage advertises and the parser refuses.
 */
export const DRIVE_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = {
  connect: ["--grant", "--home", "--json", "--revoke", "--status"],
  drives: ["--home", "--json"],
  list: ["--drive", "--folder", "--home", "--json", "--limit", "--query", "--trashed"],
  read: ["--home", "--json", "--metadata-only"],
};

/** Read the optional `--home` value out of a parsed tail. */
function homeOf({ values }: { values: Readonly<Record<string, string>> }): string | undefined {
  return values["home"];
}

/**
 * Parse the `drive connect` tail.
 *
 * @param rest the argv tail after `drive connect`
 * @returns the validated request, or the typed refusal
 */
export function parseDriveConnectArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GoogleConnectArgs<DriveCapability>, DriveArgsError> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json", "revoke", "status"], value: ["grant", "home"] } });
  if (parsed.isErr()) {
    return err(DriveArgsErrors.flagsInvalid({ reasons: parsed.error, usage: CONNECT_USAGE }));
  }
  const grant = flagValueOr({ fallback: "metadata", name: "grant", parsed: parsed.value });
  const capabilities = GRANT_CHOICES[grant];
  if (capabilities === undefined) {
    return err(DriveArgsErrors.grantUnknown({ choices: GRANT_NAMES, got: grant, usage: CONNECT_USAGE }));
  }
  return ok({
    capabilities,
    home: homeOf({ values: parsed.value.values }),
    json: parsed.value.flags.has("json"),
    revoke: parsed.value.flags.has("revoke"),
    statusOnly: parsed.value.flags.has("status"),
  });
}

/**
 * Parse the `drive list` tail.
 *
 * @param rest the argv tail after `drive list`
 * @returns the validated request, or the typed refusal
 */
export function parseDriveListArgs({ rest }: { rest: readonly string[] }): Result<DriveListArgs, DriveArgsError> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json", "trashed"], value: ["drive", "folder", "home", "limit", "query"] },
  });
  if (parsed.isErr()) {
    return err(DriveArgsErrors.flagsInvalid({ reasons: parsed.error, usage: LIST_USAGE }));
  }
  const rawLimit = parsed.value.values["limit"];
  const limit = rawLimit === undefined ? DEFAULT_LIST_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    return err(DriveArgsErrors.limitOutOfRange({ got: String(rawLimit), max: MAX_LIST_LIMIT, usage: LIST_USAGE }));
  }
  return ok({
    driveId: parsed.value.values["drive"],
    folderId: parsed.value.values["folder"],
    home: homeOf({ values: parsed.value.values }),
    includeTrashed: parsed.value.flags.has("trashed"),
    json: parsed.value.flags.has("json"),
    limit,
    query: parsed.value.values["query"],
  });
}

/**
 * Parse the `drive read` tail: one leading positional address, then flags.
 *
 * The address is NOT validated here beyond being present and not a flag. Turning it into a file id is
 * `src/live/drive/files.ts`'s job and produces a typed domain error, so the two refusals stay distinct: a
 * missing argument is a usage fault, and an unparseable one is a Drive-domain fault a caller can branch on.
 *
 * @param rest the argv tail after `drive read`
 * @returns the validated request, or the typed refusal
 */
export function parseDriveReadArgs({ rest }: { rest: readonly string[] }): Result<DriveReadArgs, DriveArgsError> {
  const address = rest[0];
  if (address === undefined || address.startsWith("-")) {
    return err(DriveArgsErrors.argumentMissing({ name: "<file-id-or-url>", usage: READ_USAGE }));
  }
  const parsed = parseFlagTail({
    rest: rest.slice(1),
    spec: { boolean: ["json", "metadata-only"], value: ["home"] },
  });
  if (parsed.isErr()) {
    return err(DriveArgsErrors.flagsInvalid({ reasons: parsed.error, usage: READ_USAGE }));
  }
  return ok({
    address,
    home: homeOf({ values: parsed.value.values }),
    json: parsed.value.flags.has("json"),
    withText: !parsed.value.flags.has("metadata-only"),
  });
}

/**
 * Parse the `drive drives` tail.
 *
 * @param rest the argv tail after `drive drives`
 * @returns the validated request, or the typed refusal
 */
export function parseDriveDrivesArgs({ rest }: { rest: readonly string[] }): Result<DriveDrivesArgs, DriveArgsError> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(DriveArgsErrors.flagsInvalid({ reasons: parsed.error, usage: DRIVES_USAGE }));
  }
  return ok({ home: homeOf({ values: parsed.value.values }), json: parsed.value.flags.has("json") });
}
