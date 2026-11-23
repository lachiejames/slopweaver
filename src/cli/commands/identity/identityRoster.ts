/**
 * `slopweaver identity roster show|replace` — the one way the human identity roster is read whole and changed.
 *
 * The roster is a row in the store, not a file in the home. `show` prints the records and the revision a writer pins
 * to; `replace` decodes a whole replacement document strictly BEFORE the store is touched, then writes it ONCE,
 * pinned to the revision the caller names. A conflict is a typed refusal and is never retried: the writer cannot
 * know whether its document still says what was meant over the rows another writer left. A store outage on
 * `replace` is never retried either, because a connection that fails after the commit is indistinguishable from one
 * that failed before it — so the refusal says to read the row again first.
 *
 * Every edge is injected, so the exit codes and the single write are unit tested over the in-memory port.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { IdentityRecord } from "../../../silver/identity.js";
import {
  type IdentityRosterPort,
  type IdentityRosterSnapshot,
  retiredRosterFileLine,
} from "../../../silver/identityRoster.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { type IdentityDeps, verbTail } from "./identityShared.js";
import { type IdentityRosterArgsError, IdentityRosterArgsErrors } from "./rosterArgsErrors.js";
import { IDENTITY_ROSTER_USAGE } from "./rosterUsage.js";

/** The flag spec `identity roster` parses. */
const ROSTER_FLAGS = { boolean: ["json"], string: ["home", "file", "expect-revision"] } as const;

/** `--`-prefixed, so the help-truth ratchet can compare the usage string against the parser both ways. */
export const IDENTITY_ROSTER_FLAG_NAMES: readonly string[] = [...ROSTER_FLAGS.string, ...ROSTER_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/** The token `--expect-revision` takes when the writer read no row. */
const NO_ROW_TOKEN = "none";

/** A parsed `identity roster` invocation. */
export type IdentityRosterArgs =
  | { readonly action: "show"; readonly home: string | undefined; readonly json: boolean }
  | {
      readonly action: "replace";
      readonly expectedRevision: number | null;
      readonly file: string;
      readonly home: string | undefined;
      readonly json: boolean;
    };

/** The seams `identity roster` performs its effects through. */
export interface IdentityRosterDeps {
  readonly home: () => string;
  readonly logger: IdentityDeps["logger"];
  readonly port: IdentityRosterPort;
  readonly readDocument: (request: {
    readonly path: string;
  }) => Result<readonly IdentityRecord[] | undefined, IdentityRosterError>;
}

/** A string flag's value, or `undefined` when it was not passed. */
function stringValue({
  name,
  values,
}: {
  name: string;
  values: Readonly<Record<string, string | boolean>>;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse `--expect-revision`: `none` for a writer that read no row, else a positive whole revision.
 *
 * @param token what the caller passed
 * @returns the revision to pin to, null for no row, or the typed refusal
 */
export function parseExpectedRevision({ token }: { token: string }): Result<number | null, IdentityRosterArgsError> {
  if (token === NO_ROW_TOKEN) {
    return ok(null);
  }
  if (!/^[1-9]\d*$/u.test(token)) {
    return err(IdentityRosterArgsErrors.revisionMalformed({ noRowToken: NO_ROW_TOKEN, token }));
  }
  return ok(Number(token));
}

/**
 * Parse `identity roster` argv. Pure, and exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv after `identity roster`
 * @returns the invocation, or the typed refusal
 */
export function parseIdentityRosterArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<IdentityRosterArgs, IdentityRosterArgsError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: ROSTER_FLAGS });
  if (parsed.isErr()) {
    return err(IdentityRosterArgsErrors.flagsUnparsed({ problems: parsed.error }));
  }
  const { positionals, values } = parsed.value;
  const action = positionals[0];
  if (positionals.length !== 1 || (action !== "show" && action !== "replace")) {
    return err(IdentityRosterArgsErrors.actionMissing());
  }
  const home = stringValue({ name: "home", values });
  const json = values["json"] === true;
  const file = stringValue({ name: "file", values });
  const revisionToken = stringValue({ name: "expect-revision", values });
  if (action === "show") {
    if (file !== undefined || revisionToken !== undefined) {
      return err(IdentityRosterArgsErrors.showTakesNoWriteFlags());
    }
    return ok({ action, home, json });
  }
  if (file === undefined || revisionToken === undefined) {
    return err(IdentityRosterArgsErrors.replaceUnpinned());
  }
  const expectedRevision = parseExpectedRevision({ token: revisionToken });
  if (expectedRevision.isErr()) {
    return err(expectedRevision.error);
  }
  return ok({ action, expectedRevision: expectedRevision.value, file, home, json });
}

/**
 * Render the roster as it stands: the revision and one line per record, or the whole snapshot as JSON. Pure.
 *
 * @param json whether the caller asked for the machine-readable document
 * @param snapshot the roster as read or as just written
 * @returns the lines to print
 */
export function renderIdentityRoster({
  json,
  snapshot,
}: {
  json: boolean;
  snapshot: IdentityRosterSnapshot;
}): readonly string[] {
  if (json) {
    return [JSON.stringify({ records: snapshot.records, revision: snapshot.revision }, null, 2)];
  }
  const head =
    snapshot.revision === null
      ? "identity roster: the store holds no row (an empty roster); replace with --expect-revision none"
      : `identity roster: revision ${String(snapshot.revision)}, ${String(snapshot.records.length)} record(s)`;
  return [head, ...snapshot.records.map((record) => `  ${record.id}  @${record.handle}  ${record.name}`)];
}

/** Print a snapshot and the retired-file line, and answer with the exit its contents earn. */
function emitSnapshot({
  deps,
  json,
  snapshot,
}: {
  deps: IdentityRosterDeps;
  json: boolean;
  snapshot: IdentityRosterSnapshot;
}): number {
  const retired = retiredRosterFileLine({ snapshot });
  if (retired !== undefined) {
    deps.logger.warn({ msg: `identity roster: ${retired}` });
  }
  for (const line of renderIdentityRoster({ json, snapshot })) {
    deps.logger.out({ line });
  }
  return snapshot.records.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** The refusal lines a failed `replace` prints: the error, plus the re-read an outage demands. */
function replaceRefusalLines({ error }: { error: IdentityRosterError }): readonly string[] {
  if (error.code !== "IDENTITY_ROSTER_STORE_UNAVAILABLE") {
    return [`identity roster replace: ${error.message}`];
  }
  return [
    `identity roster replace: ${error.message}`,
    "identity roster replace: run `slopweaver identity roster show` before retrying — a connection that fails " +
      "after the commit cannot be told apart from one that failed before it, so the write may have landed",
  ];
}

/** `replace`: decode the document whole, then one compare-and-set pinned to the caller's revision. */
async function runReplace({
  args,
  deps,
  home,
}: {
  args: Extract<IdentityRosterArgs, { action: "replace" }>;
  deps: IdentityRosterDeps;
  home: string;
}): Promise<number> {
  // Decoded whole BEFORE the store is touched, so a malformed document writes nothing and opens nothing.
  const document = deps.readDocument({ path: args.file });
  if (document.isErr()) {
    deps.logger.error({ msg: `identity roster replace: ${document.error.message} — nothing was written` });
    return EXIT_USAGE;
  }
  if (document.value === undefined) {
    deps.logger.error({ msg: `identity roster replace: ${args.file} does not exist — nothing was written` });
    return EXIT_ERROR;
  }
  const written = await deps.port.replace({ expectedRevision: args.expectedRevision, home, records: document.value });
  if (written.isErr()) {
    for (const msg of replaceRefusalLines({ error: written.error })) {
      deps.logger.error({ msg });
    }
    return EXIT_ERROR;
  }
  deps.logger.warn({ msg: `identity roster: wrote revision ${String(written.value.revision)}` });
  return emitSnapshot({ deps, json: args.json, snapshot: written.value });
}

/** The `--home` the caller named, else the injected default home — `resolveHome`'s shape over a seam. */
function homeFor({ deps, named }: { deps: IdentityRosterDeps; named: string | undefined }): string {
  if (named === undefined) {
    return deps.home();
  }
  return named;
}

/**
 * Run `identity roster` against injected edges.
 *
 * @param argv the full process argv
 * @param deps the port, the strict document read and the output seams
 * @returns the process exit code — `EXIT_EXPECTED_EMPTY` when the roster holds no records
 */
export async function runIdentityRosterWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: IdentityRosterDeps;
}): Promise<number> {
  const rest = verbTail({ argv, verb: "roster" });
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.logger.out({ line: IDENTITY_ROSTER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseIdentityRosterArgs({ rest });
  if (parsed.isErr()) {
    const problems = parsed.error.code === "ROSTER_FLAGS_UNPARSED" ? parsed.error.problems : [parsed.error.message];
    for (const msg of [...problems, IDENTITY_ROSTER_USAGE]) {
      deps.logger.error({ msg });
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = homeFor({ deps, named: args.home });
  if (args.action === "replace") {
    return runReplace({ args, deps, home });
  }
  const read = await deps.port.read({ home });
  if (read.isErr()) {
    deps.logger.error({ msg: `identity roster show: ${read.error.message}` });
    return EXIT_ERROR;
  }
  return emitSnapshot({ deps, json: args.json, snapshot: read.value });
}
