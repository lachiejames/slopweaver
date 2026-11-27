/**
 * A ratchet BUMP as a record: what a change loosens against main, why, and the digest a witness binds to. A
 * record is a statement of intent and nothing more — the implementing session writes it, so it can write any
 * string into it. What it buys is that every loosening is DECLARED, exactly, and that one digest names the
 * declared set for the witness to answer for.
 *
 * ## Where a record lives, and where the witness is
 *
 * In the state home (`src/codex/bumpRecordStore.ts`), never the tree: the rules and counts stay in the code,
 * each allowed exception and the Codex verdict on it are the installation's own history, so a fork starts with
 * the rules and none of it. The session implementing a pull request must not be the one deciding to bump its
 * ratchet, for the same reason Codex plans and reviews every pull request, so the authority is a Codex review of
 * the pull request's head, read by the landing verbs (`src/codex/baselineBumpWitness.ts`) on a property id and a
 * claim both rendered here from the digest, so neither can be softened by whoever ran the review. CI cannot see
 * the home, so it only reports what a change loosened (`./baselineAgainstMain.ts`); the landing door holds both
 * the declaration and the authority, and a merge that skips both landing verbs is the stated residue.
 *
 * ## A WIDENING row is proven, not asserted
 *
 * A rise that comes from widening a rule — new rows on code main already had — is the good kind, but still gets
 * an adversarial witness or the owner, so that widening does not become a loophole nobody anticipated. A row
 * declared `widening` therefore covers its loosening only when the file it names is byte-identical at main and
 * in the change ({@link provenUnchanged}): the rise cannot have come from this change's code. The Codex witness
 * is still owed on top — the proof says WHERE the rows came from, the witness judges whether the wider rule is
 * right.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { parseJson } from "../lib/jsonParse.js";
import { err, ok, type Result } from "../lib/result.js";
import { type Loosening, NAME_KEYED_PARTS } from "./baselineRegistry.js";

/** Where a record is kept, relative to the state home — the one spelling a claim and a refusal print. */
export const BUMP_RECORD_HOME_DIR = "ledgers/baseline-bumps/";

/** Why a loosening is there: a rule measuring more of unchanged code, or code that grew. */
export type BumpCause = "widening" | "growth";

/** One declared loosening. */
export interface BumpRow extends Loosening {
  readonly cause: BumpCause;
}

/** A bump record: the declaration a landing verb matches against what a pull request loosens. */
export interface BumpManifest {
  /**
   * The main commit the rows were measured against. It is in the digest so the same rows declared again later,
   * after the first bump landed, get a record of their own rather than colliding with the spent one. Landing
   * reads a record whose base is not in main's history as inert, and one naming an older main commit only when
   * its rows still hold against it (`src/codex/baselineBumpWitnessRun.ts`).
   */
  readonly base: string;
  readonly reason: string;
  readonly loosenings: readonly BumpRow[];
  /** sha256 of {@link canonicalText} over `base` and `loosenings`. */
  readonly digest: string;
}

/**
 * A `file` or `entry` with no control character. NUL separates {@link rowKey}'s fields and tab and newline
 * {@link canonicalText}'s, so one inside a field would let two different declarations share a key or a digest —
 * `file: "x\0lint", entry: "unit"` matching a computed `entry: "lint\0unit"`. A loosening
 * whose own key carries one can then never be declared, so it is refused rather than misread.
 */
const fieldText = z
  .string()
  .min(1)
  .refine((text) => !hasControlCharacter({ text }));

/**
 * Whether any UTF-16 unit of `text` is a C0 control or DEL. Every such character is a single unit, so walking
 * units rather than code points can neither miss one nor split a surrogate pair into a false hit.
 *
 * @param text the field value under test
 * @returns true when one control character is present
 */
function hasControlCharacter({ text }: { text: string }): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x20 || unit === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a row's identity tuple is the one canonical tuple behind its entry: it renders to the entry exactly,
 * and a non-final identity part holds `#` — the only case a tuple is carried, so a row has one spelling. Pure.
 */
const tupleNamesEntry = ({ tuple, entry }: { tuple: readonly string[]; entry: string }): boolean =>
  tuple.length >= 2 &&
  `${tuple[0]!}:${tuple.slice(1).join("#")}` === entry &&
  tuple.slice(1, -1).some((part) => part.includes("#"));

const manifestSchema = z.object({
  base: z.string().regex(/^[0-9a-f]{40}$/u),
  digest: z.string().regex(/^[0-9a-f]{64}$/u),
  loosenings: z
    .array(
      z
        .object({
          cause: z.enum(["widening", "growth"]),
          entry: fieldText,
          file: fieldText,
          from: z.number().nullable(),
          identityTuple: z.array(fieldText).min(2).optional(),
          to: z.number().nullable(),
        })
        .refine(
          (row) => row.identityTuple === undefined || tupleNamesEntry({ entry: row.entry, tuple: row.identityTuple }),
        ),
    )
    .min(1),
  reason: z.string().trim().min(1),
});

/** A manifest that is not a manifest, or whose digest is not its own rows'. */
export interface BumpManifestError {
  readonly code: "BUMP_MANIFEST_MALFORMED" | "BUMP_DIGEST_MISMATCH";
  readonly message: string;
  readonly path: string;
}

/** The factory every manifest failure is built through. */
export const BumpManifestErrors = {
  digestMismatch: ({ path }: { path: string }): BumpManifestError => ({
    code: "BUMP_DIGEST_MISMATCH",
    message: `${path}: its digest is not the digest of its own rows — re-record it with \`slopweaver dev baseline-bump\``,
    path,
  }),
  malformed: ({ path, detail }: { path: string; detail: string }): BumpManifestError => ({
    code: "BUMP_MANIFEST_MALFORMED",
    message: `${path}: not a bump manifest (${detail})`,
    path,
  }),
} as const;

/**
 * The identity of one row, cause excluded — what a comparison computes and a record must match. Pure.
 *
 * A row carrying an identity tuple appends it, so it never matches a different row that shows the same entry; a
 * row without one keys exactly as it always has.
 *
 * @param row the loosening or declared row
 * @returns its file, entry and both measures joined by NUL, which no field may carry, then its tuple when it has one
 */
export function rowKey({ row }: { row: Loosening }): string {
  const key = `${row.file}\u0000${row.entry}\u0000${String(row.from)}\u0000${String(row.to)}`;
  return row.identityTuple === undefined ? key : `${key}\u0000${JSON.stringify(row.identityTuple)}`;
}

/**
 * The rows a manifest declares that a measurement does not reproduce exactly, cause excluded. Pure.
 *
 * @param manifest the manifest whose rows are checked
 * @param measured what the change loosened against the commit the manifest names as its base
 * @returns the manifest's rows absent from `measured`, in manifest order
 */
export function rowsUnmeasured({
  manifest,
  measured,
}: {
  manifest: BumpManifest;
  measured: readonly Loosening[];
}): readonly BumpRow[] {
  const keys = new Set(measured.map((row) => rowKey({ row })));
  return manifest.loosenings.filter((row) => !keys.has(rowKey({ row })));
}

/**
 * The canonical text a digest is taken over: the base line, then rows sorted by file then entry, every field in
 * a fixed order, and a sixth field only on a row carrying an identity tuple — so every other row's text, and every
 * digest recorded before tuples existed, is unchanged. Pure — the same rows in any order give the same text.
 *
 * @param rows the declared loosenings
 * @param base the main commit they were measured against
 * @returns the base line, then one line per row
 */
export function canonicalText({ rows, base }: { rows: readonly BumpRow[]; base: string }): string {
  return [
    `base\t${base}`,
    ...rows
      .toSorted((a, b) => rowKey({ row: a }).localeCompare(rowKey({ row: b })))
      .map((row) => {
        const line = `${row.file}\t${row.entry}\t${String(row.from)}\t${String(row.to)}\t${row.cause}`;
        return row.identityTuple === undefined ? line : `${line}\t${JSON.stringify(row.identityTuple)}`;
      }),
  ].join("\n");
}

/**
 * The digest a manifest carries and a witness binds to. Pure.
 *
 * @param rows the declared loosenings
 * @param base the main commit they were measured against
 * @returns lowercase hex sha256
 */
export function digestOf({ rows, base }: { rows: readonly BumpRow[]; base: string }): string {
  return createHash("sha256").update(canonicalText({ base, rows })).digest("hex");
}

/**
 * The file name a record with this digest is kept under, so one record cannot hide behind another's name. The
 * WHOLE digest, never a prefix: a truncated name is a pigeonhole, so the same rows declared against some later
 * base could share a spent record's name and be refused as a rewrite of it.
 * Pure.
 *
 * @param digest the manifest's digest
 * @returns `<64 hex>.json`
 */
export function manifestFileName({ digest }: { digest: string }): string {
  return `${digest}.json`;
}

/**
 * Decode a bump record and check it is internally honest: its digest is its own rows', no row appears twice,
 * and it is filed under its own digest. Pure.
 *
 * @param path where it was read, for the message
 * @param name the file name it was kept under
 * @param text the record's JSON
 * @returns the manifest, or why it is not one
 */
export function parseBumpManifest({
  path,
  name,
  text,
}: {
  path: string;
  name: string;
  text: string;
}): Result<BumpManifest, BumpManifestError> {
  const parsed = parseJson({ text });
  const decoded = parsed.isOk() ? manifestSchema.safeParse(parsed.value) : undefined;
  if (decoded === undefined || !decoded.success) {
    return err(BumpManifestErrors.malformed({ detail: "expected { base, reason, loosenings: [...], digest }", path }));
  }
  const { base, digest, loosenings } = decoded.data;
  if (new Set(loosenings.map((row) => rowKey({ row }))).size !== loosenings.length) {
    return err(BumpManifestErrors.malformed({ detail: "a row is declared twice", path }));
  }
  if (digestOf({ base, rows: loosenings }) !== digest) {
    return err(BumpManifestErrors.digestMismatch({ path }));
  }
  if (name !== manifestFileName({ digest })) {
    return err(
      BumpManifestErrors.malformed({
        detail: `filed as ${name}, its digest names ${manifestFileName({ digest })}`,
        path,
      }),
    );
  }
  return ok(decoded.data);
}

/**
 * The repo-relative file a row's entry names, when it names one — `offenders:tools/x.ts` and
 * `sites:src/a.ts#??` both name a path; a scalar, a CI job and a heap ceiling (`ceilingsMiB:…`, a part in
 * `NAME_KEYED_PARTS`) do not. Pure.
 *
 * A row carrying an identity tuple names its path exactly — `sites:src/a#b.ts#jsonl-read-whole` is `src/a#b.ts`,
 * never `src/a` — and one whose tuple does not render to its entry names nothing, so it can prove nothing.
 *
 * @param entry the row's entry
 * @param identityTuple the row's tuple, when its entry alone is ambiguous
 * @returns the path, or `undefined` when the entry names no file
 */
export function pathOfEntry({
  entry,
  identityTuple,
}: {
  entry: string;
  identityTuple?: readonly string[] | undefined;
}): string | undefined {
  const colon = entry.indexOf(":");
  if (colon < 0 || NAME_KEYED_PARTS.has(entry.slice(0, colon))) {
    return undefined;
  }
  if (identityTuple !== undefined && !tupleNamesEntry({ entry, tuple: identityTuple })) {
    return undefined;
  }
  const path = identityTuple === undefined ? entry.slice(colon + 1).split("#")[0]! : identityTuple[1]!;
  return path.includes("/") || path.includes(".") ? path : undefined;
}

/**
 * Whether a row's file is proven untouched by the change — what a `widening` row claims. Pure.
 *
 * Matched against each changed path rather than by parsing the entry, because `#` joins a compound identity
 * AND is legal in a file name: `offenders:src/gen#v2.ts` must not read as `src/gen`. A changed path the
 * entry equals, or opens with followed by `#`, disproves it — so an ambiguous name fails closed. A row carrying an
 * identity tuple is ALSO disproved by a change to the tuple's exact path; the tuple only ever adds a way to fail.
 *
 * @param entry the row's entry
 * @param identityTuple the row's tuple, when its entry alone is ambiguous
 * @param changedPaths every path the change touched against main
 * @returns `true` only when the entry names a file and no changed path is that file
 */
export function provenUnchanged({
  entry,
  identityTuple,
  changedPaths,
}: {
  entry: string;
  identityTuple?: readonly string[] | undefined;
  changedPaths: ReadonlySet<string>;
}): boolean {
  const exact = pathOfEntry({ entry, identityTuple });
  if (exact === undefined) {
    return false;
  }
  const named = entry.slice(entry.indexOf(":") + 1);
  // A directory-keyed row (`directories:src/devLint`) is touched by any change beneath it.
  return ![...changedPaths].some(
    (path) =>
      named === path ||
      named.startsWith(`${path}#`) ||
      path.startsWith(`${named}/`) ||
      path === exact ||
      path.startsWith(`${exact}/`),
  );
}

/**
 * The review property id a witness for this manifest must carry — the whole digest, for the same reason as
 * {@link manifestFileName}: a prefix would let one manifest's witness answer for another's. Pure.
 *
 * @param digest the manifest's digest
 * @returns `baseline-bump-<64 hex>`
 */
export function witnessPropertyId({ digest }: { digest: string }): string {
  return `baseline-bump-${digest}`;
}

/**
 * The exact claim a witness review must have judged, rendered from the manifest so whoever runs the review
 * cannot soften it. CLEAN means every row is justified; BROKEN means at least one is not. ONE line, so the
 * command {@link witnessCommand} prints pastes into a shell unchanged. Pure.
 *
 * @param manifest the bump record
 * @returns the claim text, byte-for-byte what the landing verbs compare
 */
export function witnessClaim({ manifest }: { manifest: BumpManifest }): string {
  const inline = manifest.loosenings
    .toSorted((a, b) => rowKey({ row: a }).localeCompare(rowKey({ row: b })))
    .map((row) => {
      // The witness must see WHICH row an ambiguous entry is, since the digest it answers for binds the tuple.
      const which = row.identityTuple === undefined ? "" : ` identity ${JSON.stringify(row.identityTuple)}`;
      return `${row.file} ${row.entry}${which} ${String(row.from)}->${String(row.to)} (${row.cause})`;
    })
    .join("; ");
  const rows =
    inline.length <= WITNESS_INLINE_ROWS_MAX_CHARS
      ? `Rows (file entry main->now (cause)): ${inline}`
      : `Rows: ${rowSummaryOf({ manifest })}, every one listed in the bump record ${BUMP_RECORD_HOME_DIR}${manifestFileName({ digest: manifest.digest })} under $SLOPWEAVER_HOME, whose digest above binds them`;
  return (
    `Ratchet bump ${manifest.digest}: each loosening listed is JUSTIFIED — a rule now measuring code main ` +
    "already had (cause widening), a register growing by one row of its own purpose, or a measured re-seed — " +
    "and NONE could be removed by fixing or splitting the code in this diff instead. Stated reason: " +
    `${manifest.reason.replace(/\s+/gu, " ").trim()}. ${rows}`
  );
}

/**
 * The longest row list a claim carries inline. Past it the claim names the manifest file and a per-baseline count
 * instead, since the digest already binds every row: a 6,000-row seed inlined measured about 635 KB, most of a shell's
 * argument ceiling and a property no review reads. The largest manifest landed before this cap inlines well
 * under it, so its claim is unchanged.
 */
const WITNESS_INLINE_ROWS_MAX_CHARS = 64_000;

/** One clause per baseline file and cause, in file order: `<file> <n> row(s) (<cause>)`. Pure. */
function rowSummaryOf({ manifest }: { manifest: BumpManifest }): string {
  const tally = new Map<string, { file: string; cause: BumpCause; count: number }>();
  for (const row of manifest.loosenings) {
    const key = `${row.file}\u0000${row.cause}`;
    const standing = tally.get(key);
    tally.set(key, { cause: row.cause, count: standing === undefined ? 1 : standing.count + 1, file: row.file });
  }
  return [...tally.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => `${group.file} ${String(group.count)} row(s) (${group.cause})`)
    .join("; ");
}

/** The Codex review bound a witness pass is given, in seconds. */
const WITNESS_BOUND_SECONDS = 1500;

/** The diff ceiling a witness pass is given, in bytes. */
const WITNESS_MAX_DIFF_BYTES = 4_000_000;

/** Quote one argument for a POSIX shell. */
const shellQuote = ({ text }: { text: string }): string => `'${text.replaceAll("'", "'\\''")}'`;

/**
 * The one command that takes the witness for a manifest — the adversarial r3 pass on the claim and property
 * id the landing verbs look for, against main's commit. Pure; printed by `dev baseline-bump` and by the
 * landing refusal, so the two cannot name different commands.
 *
 * @param manifest the bump record
 * @param base main's commit the pull request is judged against
 * @returns a shell command line
 */
export function witnessCommand({ manifest, base }: { manifest: BumpManifest; base: string }): string {
  return [
    "slopweaver codex review --pass r3",
    `--property-id ${witnessPropertyId({ digest: manifest.digest })}`,
    `--property ${shellQuote({ text: witnessClaim({ manifest }) })}`,
    `--base ${base}`,
    `--bound-seconds ${String(WITNESS_BOUND_SECONDS)}`,
    `--max-diff-bytes ${String(WITNESS_MAX_DIFF_BYTES)}`,
  ].join(" ");
}
