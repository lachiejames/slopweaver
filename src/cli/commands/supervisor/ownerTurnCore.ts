/**
 * The pure half of `slopweaver supervisor owner-turn-record` and `owner-turn-show`: what their flags mean,
 * and the lines each prints.
 *
 * No I/O, no clock, no store. `./ownerTurnRun.ts` re-reads the file, opens the store and prints.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { OwnerTurnRecordOutcome, StoredOwnerTurn } from "../../../store/fleet/ownerTurnStore.js";
import { parseFlagTail } from "../../optionParsers.js";

/** The reconcile command every failure names — the batch path that catches up whatever one record missed. */
export const OWNER_TURN_IMPORT_COMMAND = "slopweaver store import-fleet --only owner-turns";

export const OWNER_TURN_RECORD_USAGE =
  "usage: slopweaver supervisor owner-turn-record --file <path> [--home <dir>] [--json]\n" +
  "\n" +
  "Records one owner-turn-*.txt a seat has just written into the store's owner_turn table: the file is RE-READ\n" +
  "and its exact bytes hashed, so the row is a witness to what is on disk rather than to what the seat meant to\n" +
  "write. The file stays where it is. Only a file under handovers/archive/ or supervisor-scratch/<handoff>/ of\n" +
  `the home is recorded; anything else, or a home with no store, exits non-zero naming \`${OWNER_TURN_IMPORT_COMMAND}\`.\n` +
  "\n" +
  "example: slopweaver supervisor owner-turn-record --file ~/.slopweaver/supervisor-scratch/handoff-9291/owner-turn-291-60.txt";

export const OWNER_TURN_SHOW_USAGE =
  "usage: slopweaver supervisor owner-turn-show --ref <anchor|turn> [--all] [--home <dir>] [--json]\n" +
  "\n" +
  "Prints an owner turn FROM THE STORE — never from disk. --ref takes an anchor in any spelling canon uses\n" +
  "(`~/.slopweaver/…/owner-turn-257-1.txt`, `$SLOPWEAVER_HOME/…`, `state:…`, an absolute path, a trailing\n" +
  "#fragment) or a bare turn label (`<n>-<m>`). Prints the newest body; --all prints every distinct body, newest\n" +
  "first, each headed by where it was found. --json carries every body byte-exact. When the store holds\n" +
  `nothing for the ref, it says so and names \`${OWNER_TURN_IMPORT_COMMAND}\`.\n` +
  "\n" +
  "example: slopweaver supervisor owner-turn-show --ref <n>-<m>";

/** `owner-turn-record`'s flag tail — exported so `--help`'s advertised flags and the parser cannot drift. */
export const OWNER_TURN_RECORD_FLAG_SPEC = {
  boolean: ["json"],
  value: ["file", "home"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** `owner-turn-show`'s flag tail. */
export const OWNER_TURN_SHOW_FLAG_SPEC = {
  boolean: ["all", "json"],
  value: ["ref", "home"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** A parsed `owner-turn-record`. `file` is checked by the shell, so a missing one is refused as usage. */
export interface OwnerTurnRecordArgs {
  readonly file: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `owner-turn-show`. `ref` is checked by the shell, as `file` is above. */
export interface OwnerTurnShowArgs {
  readonly ref: string | undefined;
  readonly home: string | undefined;
  readonly all: boolean;
  readonly json: boolean;
}

/**
 * Parse `owner-turn-record`'s flag tail.
 *
 * @param rest the argv after `supervisor owner-turn-record`
 * @returns the arguments, or the tokeniser's own rejections
 */
export function parseOwnerTurnRecordArgs({ rest }: { rest: readonly string[] }): Result<OwnerTurnRecordArgs> {
  const parsed = parseFlagTail({ rest, spec: OWNER_TURN_RECORD_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return ok({ file: values["file"], home: values["home"], json: flags.has("json") });
}

/**
 * Parse `owner-turn-show`'s flag tail.
 *
 * @param rest the argv after `supervisor owner-turn-show`
 * @returns the arguments, or the tokeniser's own rejections
 */
export function parseOwnerTurnShowArgs({ rest }: { rest: readonly string[] }): Result<OwnerTurnShowArgs> {
  const parsed = parseFlagTail({ rest, spec: OWNER_TURN_SHOW_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return ok({ all: flags.has("all"), home: values["home"], json: flags.has("json"), ref: values["ref"] });
}

/** What `owner-turn-record` prints and whether it succeeded. */
export interface VerbLines {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/**
 * The lines a record prints, from its outcome.
 *
 * `no-store` and `outside-family` are failures here even though neither is an error of the store: the
 * seat asked for the owner's words to reach the store and they did not, which is exactly what must not pass silently.
 *
 * @param file the path the seat named
 * @param home the state home the file was judged against
 * @param outcome what recording did
 * @returns the lines and whether the verb succeeded
 */
export function ownerTurnRecordLines({
  file,
  home,
  outcome,
}: {
  file: string;
  home: string;
  outcome: OwnerTurnRecordOutcome;
}): VerbLines {
  if (outcome.kind === "no-store") {
    return {
      lines: [
        `supervisor owner-turn-record: ${home} selects no store, so ${file} is on disk only — run ` +
          `\`${OWNER_TURN_IMPORT_COMMAND}\` once a store is selected`,
      ],
      ok: false,
    };
  }
  if (outcome.kind === "outside-family") {
    return {
      lines: [
        `supervisor owner-turn-record: ${file} is not an owner-turn-*.txt under handovers/archive/ or ` +
          `supervisor-scratch/<handoff>/ of ${home} — nothing recorded; \`${OWNER_TURN_IMPORT_COMMAND}\` reads only those roots`,
      ],
      ok: false,
    };
  }
  return {
    lines: [
      `supervisor owner-turn-record: ${outcome.relativePath} (turn ${outcome.turn}, sha256 ` +
        `${outcome.bodySha256.slice(0, 12)}) — ${String(outcome.counts.bodies)} new body, ` +
        `${String(outcome.counts.locations)} new location`,
    ],
    ok: true,
  };
}

/** One distinct body, with every place the store found it. */
export interface OwnerTurnVersion {
  readonly bodySha256: string;
  readonly byteLength: number;
  readonly body: string;
  /** Each location's path and file time, newest first. */
  readonly locations: readonly { readonly relativePath: string; readonly fileModifiedAt: Date }[];
}

/**
 * Group stored copies into distinct bodies, keeping the store's newest-first order.
 *
 * @param rows every location the ref resolved to, newest file write first
 * @returns one version per distinct body, the newest-written first
 */
export function ownerTurnVersions({ rows }: { rows: readonly StoredOwnerTurn[] }): readonly OwnerTurnVersion[] {
  const bySha = new Map<string, { version: OwnerTurnVersion; locations: OwnerTurnVersion["locations"][number][] }>();
  for (const row of rows) {
    const existing = bySha.get(row.bodySha256);
    const location = { fileModifiedAt: row.fileModifiedAt, relativePath: row.relativePath };
    if (existing !== undefined) {
      existing.locations.push(location);
      continue;
    }
    const locations = [location];
    bySha.set(row.bodySha256, {
      locations,
      version: { body: row.body, bodySha256: row.bodySha256, byteLength: row.byteLength, locations },
    });
  }
  return [...bySha.values()].map((entry) => entry.version);
}

/**
 * The line printed when the store holds nothing for a ref — never followed by the disk copy.
 *
 * @param ref the ref as typed
 * @returns the line naming the import command
 */
export function ownerTurnNothingStoredLine({ ref }: { ref: string }): string {
  return (
    `supervisor owner-turn-show: the store holds no owner turn for ${ref} — if the file exists, run ` +
    `\`${OWNER_TURN_IMPORT_COMMAND}\` and ask again; this verb never reads the disk copy`
  );
}

/**
 * The header line printed above one version under `--all`.
 *
 * @param version the version to head
 * @returns one line naming its hash, size and every path it was found at
 */
export function ownerTurnVersionHeader({ version }: { version: OwnerTurnVersion }): string {
  const places = version.locations
    .map((location) => `${location.relativePath} @ ${location.fileModifiedAt.toISOString()}`)
    .join(", ");
  return `=== sha256 ${version.bodySha256} · ${String(version.byteLength)} bytes · ${places}`;
}

/**
 * A body as the one `out` line the data channel takes, which appends its own newline.
 *
 * A body that already ends in a newline loses that one here and gets it back from the channel, so the
 * printed bytes are the stored bytes. A body with no final newline gains one — the text mode's one residual,
 * and why `--json` is the byte-exact form.
 *
 * @param body the stored body
 * @returns the text to hand `logger.out`
 */
export function bodyAsOutLine({ body }: { body: string }): string {
  if (body.endsWith("\n")) {
    return body.slice(0, -1);
  }
  return body;
}
