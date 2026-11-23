/**
 * The Alignment board projection: every board row's PLACEMENT fields, and nothing else, in one small file.
 *
 * **Why it exists.** The console's Alignment count is a count of act cards, and an act card's existence,
 * grouping and workspace all depend on the board: an act joins the board row its subject or `run` names, two acts
 * placed differently stay two cards, and a spoken steer on an in-flight row is a recut rather than hidden
 * (`docs/console/alignment.md`). So the count cannot drop the board, and the only board read there was
 * `handover list --json` — the whole document, every summary, question and card field of every row. MEASURED:
 * 13.9 s bare and 29 MB, ~38 s through the console. Repro: `time slopweaver handover list --json |
 * wc -c`.
 *
 * **What it is, and is not.** A PROJECTION, never the register — the precedent is `./rulingGateIndex.ts`. The docs
 * and run journals own every fact here; `handover list` rewrites this file whenever it composes the whole default
 * board ({@link alignmentBoardWriteRefusal}), and `handover alignment-board` rebuilds it from that same composition
 * when it is missing or will not read. Nothing edits it as state.
 *
 * **Every row, not only open ones.** An unsteered act can join a CLOSED row by its subject or `run`; a projection
 * of open rows would move that act's workspace and change the count.
 *
 * **Strict and whole.** One malformed row rejects the file, never drops the row: a projection missing a row
 * places the acts that join it differently, which is a wrong count that looks like a right one. And the failure
 * direction is the opposite of the ruling gates' fail-open: a projection that will not read is REBUILT from the
 * board, and if that fails the count is not measured. It is never read as an empty board.
 *
 * Pure: text in, a projection or the one reason it is not one out. The effectful half is
 * `./alignmentBoardProjectionStore.ts`; the model-to-row derivation is
 * `src/cli/commands/handover/alignmentBoardRows.ts`, beside the `--json` helpers it shares.
 */

import { z } from "zod";
import { parseJson } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import {
  type AlignmentBoardProjectionError,
  AlignmentBoardProjectionErrors,
} from "./alignmentBoardProjectionErrors.js";
import type { MailPreview } from "./mailActionPreview.js";
import type { RowTag, TagAssignment } from "./rowTags.js";
import { isCanonicalInstant } from "./ruling.js";
import { declaredWorkspace, WORKSPACES, type Workspace } from "./workspace.js";

/**
 * The schema version new code writes: version 2 is the one whose `workspace` values are the roles `team|self`, never
 * an organisation's name. A reader also accepts {@link PRE_ROLE_SCHEMA_VERSION} and serves it as this one.
 */
export const ALIGNMENT_BOARD_PROJECTION_SCHEMA_VERSION = 2;

/**
 * The version a checkout built before the rename still writes, spelling a stated workspace `acme|slopweaver`. Every
 * checkout shares the one home, so a stale seat's `handover list` can overwrite a version-2 file after the merge;
 * refusing it would make the next read pay a whole cold rebuild inside the console's timeout, once per stale write.
 * Its words are read as the roles, unless a row shows that build misplaced a role-stated doc.
 */
const PRE_ROLE_SCHEMA_VERSION = 1;

/**
 * One board row's placement fields, each named and valued exactly as `handover list --json` publishes it
 * (`src/cli/commands/handover/listJson.ts`'s `boardJsonRow`), so the console reads both through one set of readers.
 */
export interface AlignmentBoardProjectionRow {
  readonly slug: string;
  /** The board section — `IN FLIGHT` with an `active` run is what makes a spoken steer a recut. */
  readonly section: string;
  /** The run's disposition kind. */
  readonly run: string;
  readonly workspace: Workspace | undefined;
  readonly workspaceUnread: string | undefined;
  /** The pull-request links the row's summary, question and reason name — the same match the board publishes. */
  readonly prUrls: readonly string[];
  readonly tags: readonly RowTag[];
  readonly tagsIncomplete: boolean;
  /** Tags the registry refused; a refused `context=` makes the row a finding. */
  readonly unrecognisedTags: readonly TagAssignment[];
  /**
   * The recorded draft the open ask offers, as the board publishes it. Carried whole rather than reduced to its
   * destinations because whether it READS — a blank body, a broken follow-up, a mail missing its preview — decides
   * whether the row is a finding, and the console judges that with the same reader it runs over the board.
   */
  readonly action: Readonly<Record<string, unknown>> | undefined;
  readonly actionUnreadable: boolean;
  /** The preview address and digest a mail action needs to read as one. */
  readonly mailPreview: MailPreview | undefined;
}

/** The whole projection, as written to `$SLOPWEAVER_HOME/alignment-board.json`. */
export interface AlignmentBoardProjection {
  readonly schemaVersion: typeof ALIGNMENT_BOARD_PROJECTION_SCHEMA_VERSION;
  /** When these rows were composed — what a cached count's stale mark names. */
  readonly builtAtIso: string;
  /** When the doc scan behind them began, the bound a reader proves a doc was seen against. */
  readonly scanStartedIso: string;
  readonly rows: readonly AlignmentBoardProjectionRow[];
}

/** Where a printed projection came from: the file as it stood, or a composition this very invocation ran. */
export type AlignmentBoardServedFrom = "cache" | "live";

/** A canonical `toISOString()` instant. */
const instant = z.string().refine((iso) => isCanonicalInstant({ iso }), {
  message: "is not a canonical toISOString() instant",
});

const tagSchema = z
  .object({ key: z.string(), source: z.enum(["declared", "derived", "unrecognised"]), value: z.string() })
  .strict();

const rowFields = {
  action: z.record(z.string(), z.unknown()).optional(),
  actionUnreadable: z.boolean(),
  mailPreview: z.object({ digest: z.string(), url: z.string() }).strict().optional(),
  prUrls: z.array(z.string()).readonly(),
  run: z.string().min(1),
  section: z.string().min(1),
  slug: z.string().min(1),
  tags: z.array(tagSchema).readonly(),
  tagsIncomplete: z.boolean(),
  unrecognisedTags: z.array(z.object({ key: z.string(), value: z.string() }).strict()).readonly(),
  workspaceUnread: z.string().optional(),
};

const rowSchema = z.object({ ...rowFields, workspace: z.enum(WORKSPACES).optional() }).strict();

/** A {@link PRE_ROLE_SCHEMA_VERSION} row: the same fields, its workspace one of the two words that build wrote. */
const preRoleRowSchema = z.object({ ...rowFields, workspace: z.enum(["acme", "slopweaver"]).optional() }).strict();

const projectionFields = { builtAtIso: instant, scanStartedIso: instant };

const projectionSchema = z.discriminatedUnion("schemaVersion", [
  z
    .object({
      ...projectionFields,
      rows: z.array(rowSchema).readonly(),
      schemaVersion: z.literal(ALIGNMENT_BOARD_PROJECTION_SCHEMA_VERSION),
    })
    .strict(),
  z
    .object({
      ...projectionFields,
      rows: z.array(preRoleRowSchema).readonly(),
      schemaVersion: z.literal(PRE_ROLE_SCHEMA_VERSION),
    })
    .strict(),
]);

/**
 * A row's stated workspace as its role: a {@link PRE_ROLE_SCHEMA_VERSION} row spells it in the old words.
 *
 * @param workspace the row's stated workspace, in either generation's words
 * @returns the role, or `undefined` when the row states none
 */
function statedRole({ workspace }: { workspace: string | undefined }): Workspace | undefined {
  if (workspace === undefined) {
    return undefined;
  }
  return declaredWorkspace({ declared: workspace });
}

/**
 * Why a {@link PRE_ROLE_SCHEMA_VERSION} file cannot be served as this version, or `undefined` when it can. A build that
 * knew no role read a doc a newer writer stated as `team|self` as a front-matter PROBLEM, so it placed that row by
 * its problem — its section included — not by its workspace. Mapping the word back would leave the
 * section wrong, so such a file is refused whole and rebuilt; one whose every row states an old word or a real
 * misspelling carries the same placement this build composes.
 *
 * @param rows the version-1 rows, as parsed
 * @returns the reason the file is refused, naming the first row that holds a role as unread
 */
function preRoleRefusal({
  rows,
}: {
  rows: readonly { readonly workspaceUnread?: string | undefined }[];
}): string | undefined {
  const index = rows.findIndex(
    (row) => row.workspaceUnread !== undefined && declaredWorkspace({ declared: row.workspaceUnread }) !== undefined,
  );
  if (index === -1) {
    return undefined;
  }
  return (
    `rows.${String(index)}.workspaceUnread names a role a version-${String(PRE_ROLE_SCHEMA_VERSION)} build ` +
    "placed as a problem"
  );
}

/**
 * Parse a projection file, or say why it is not one.
 *
 * @param text the file's contents
 * @param path where it came from, so the reason names the file
 * @returns the projection, or the one typed reason it is not one
 */
export function parseAlignmentBoardProjection({
  text,
  path,
}: {
  text: string;
  path: string;
}): Result<AlignmentBoardProjection, AlignmentBoardProjectionError> {
  const decoded = parseJson({ text });
  if (decoded.isErr()) {
    return err(AlignmentBoardProjectionErrors.invalid({ detail: decoded.error.message, path }));
  }
  const parsed = projectionSchema.safeParse(decoded.value);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ");
    return err(AlignmentBoardProjectionErrors.invalid({ detail, path }));
  }
  if (parsed.data.schemaVersion === PRE_ROLE_SCHEMA_VERSION) {
    const refusal = preRoleRefusal({ rows: parsed.data.rows });
    if (refusal !== undefined) {
      return err(AlignmentBoardProjectionErrors.invalid({ detail: refusal, path }));
    }
  }
  return ok({
    builtAtIso: parsed.data.builtAtIso,
    rows: parsed.data.rows.map((row): AlignmentBoardProjectionRow => ({
      action: row.action,
      actionUnreadable: row.actionUnreadable,
      mailPreview: row.mailPreview,
      prUrls: row.prUrls,
      run: row.run,
      section: row.section,
      slug: row.slug,
      tags: row.tags,
      tagsIncomplete: row.tagsIncomplete,
      unrecognisedTags: row.unrecognisedTags,
      workspace: statedRole({ workspace: row.workspace }),
      workspaceUnread: row.workspaceUnread,
    })),
    scanStartedIso: parsed.data.scanStartedIso,
    schemaVersion: ALIGNMENT_BOARD_PROJECTION_SCHEMA_VERSION,
  });
}

/**
 * Render a projection for writing. Compact, because its size is the board's — ten thousand rows on this install.
 *
 * @returns the file's contents, newline-terminated
 */
export function renderAlignmentBoardProjection({ projection }: { projection: AlignmentBoardProjection }): string {
  return `${safeJsonStringify({ label: "alignment board projection", value: projection })}\n`;
}

/**
 * Render the document `handover alignment-board --json` prints: the projection, and where it came from.
 *
 * `observedAtIso` repeats `builtAtIso` under the name the console's live route believes a verb's own stamp by
 * (`site/lib/liveVerbRun.ts` `observedAt`), so a cached projection is drawn at the instant its rows were composed,
 * never at the instant the file was read.
 *
 * @param servedFrom `cache` when the file read whole, `live` when this invocation composed it from the board
 * @returns one JSON document, compact
 */
export function renderAlignmentBoardDocument({
  projection,
  servedFrom,
}: {
  projection: AlignmentBoardProjection;
  servedFrom: AlignmentBoardServedFrom;
}): string {
  return safeJsonStringify({
    label: "alignment board document",
    value: { ...projection, observedAtIso: projection.builtAtIso, servedFrom },
  });
}

/**
 * Why a `handover list` composition may NOT overwrite the projection, or `undefined` when it may.
 *
 * Only the ordinary whole board is the machine's board: a custom `--dir` is another board, a `--tag` list is a
 * subset, `--base` and `--probe` can move a section the console's own read would not, and a sweep cut by its
 * deadline, an unreadable doc or an unread journal is a composition that may be missing what places an act.
 * Each of those keeps the last good projection rather than replacing it.
 *
 * @param handoverDir the directory this run scanned
 * @param defaultHandoverDir the home's own handovers directory
 * @param tagTerms the `--tag` terms, empty when the board is whole
 * @param base the `--base` override, when one was passed
 * @param runCommands whether `--probe` ran `command:` probes
 * @param unresolved how many docs the probe sweep did not finish
 * @param unreadable the doc files the scan could not read
 * @param unreadJournals how many journals no doc claims would not read whole
 * @returns the reason, or `undefined` for a composition that may be written
 */
export function alignmentBoardWriteRefusal({
  handoverDir,
  defaultHandoverDir,
  tagTerms,
  base,
  runCommands,
  unresolved,
  unreadable,
  unreadJournals,
}: {
  handoverDir: string;
  defaultHandoverDir: string;
  tagTerms: number;
  base: string | undefined;
  runCommands: boolean;
  unresolved: number;
  unreadable: number;
  unreadJournals: number;
}): string | undefined {
  if (handoverDir !== defaultHandoverDir) {
    return `it scanned ${handoverDir}, not the home's own ${defaultHandoverDir}`;
  }
  if (tagTerms > 0) {
    return "--tag narrowed it to a subset of the board";
  }
  if (base !== undefined) {
    return `--base ${base} counted commits against a branch the console's read does not`;
  }
  if (runCommands) {
    return "--probe ran command: probes the console's read does not";
  }
  if (unresolved > 0) {
    return `the probe sweep left ${String(unresolved)} doc(s) unresolved`;
  }
  if (unreadable > 0) {
    return `${String(unreadable)} doc file(s) would not read`;
  }
  if (unreadJournals > 0) {
    return `${String(unreadJournals)} journal(s) no doc claims would not read whole`;
  }
  return undefined;
}
