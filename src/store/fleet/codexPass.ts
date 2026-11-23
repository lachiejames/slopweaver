/**
 * Projecting one `$SLOPWEAVER_HOME/orchestration/<id>/record.json` into one `codex_pass` row.
 *
 * Pure: the record's text, the artifact's text and the directory name in; a row or a typed failure out.
 *
 * ## What is read as a column, and why everything else is not lost
 *
 * `record.json` is a deep document — nested `attempts`, `bound`, `scope`, `tree`, `outcome`, `usage` — and
 * it has changed shape more than once (`schemaVersion` is on every line for that reason). So this reads
 * out the handful of fields readers actually filter on, and stores the WHOLE record in `record` beside
 * them. A field this projection does not know about is therefore never lost, and a reader who needs one
 * gets it with a `->>` rather than a re-import.
 *
 * That is deliberately the opposite trade from `./doorEvent.ts`, where the line is flat and short and every
 * field is a column. The shape of the source decides it, not a preference.
 *
 * ## The 16 GB that is not here
 *
 * Each pass directory has a `.scratch` sibling holding a full checkout and its `node_modules`. MEASURED:
 * `orchestration/` is 875,337 files and 16 GB, of which 692,581 are `.ts`, `.js` or `.map` —
 * copies of code already in git. Nothing in this module can see it, which is the point: the durable part
 * of a pass is `record.json` and `artifact.md`.
 *
 * ## A NUL byte, which Postgres holds in neither column
 *
 * `text` refuses a 0x00 and jsonb refuses a `\u0000`, and either one sinks the WHOLE batch it rides in.
 * MEASURED: one review pass wrote `\u0000` where it meant `\\s` in its own answer, so the NUL sat
 * in both its `artifact.md` and its `record.json`, and the nightly import dropped the 2,155 passes batched
 * with it (`slopweaver store import-fleet --only codex --dry-run` names nothing; the insert is what fails).
 *
 * Neither column is byte-exact or digested — `record` is jsonb, which already drops key order and spacing, and
 * `artifact` is a searchable copy — and the files on disk keep their bytes. So each NUL, in the artifact and
 * in any string or key of the record, is stored as U+FFFD and COUNTED, and the leg prints the count. Refusing
 * the pass instead would hold the nightly import red on a byte the model emitted by mistake.
 */
import { isRecord } from "#lib/parsers.js";

import { err, ok, type Result } from "../../lib/result.js";
import type { NewCodexPassRecord } from "../schema/runs.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";

/** A nested record at `key`, or `undefined` when it is absent or not an object. */
function nested({
  from,
  key,
}: {
  from: Readonly<Record<string, unknown>>;
  key: string;
}): Readonly<Record<string, unknown>> | undefined {
  const value = from[key];
  return isRecord(value) ? value : undefined;
}

/** A field read as a non-empty string, or `null` — see `./autonomyEvent.ts` on why this is not `?? null`. */
function nullableText({ value }: { value: unknown }): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return null;
}

const NUL = String.fromCodePoint(0);
const REPLACEMENT = String.fromCodePoint(0xfffd);

/** A projected pass: the row, and how many NULs it carries as U+FFFD instead. */
export interface ProjectedCodexPass {
  readonly row: NewCodexPassRecord;
  /** NULs in `artifact.md` and `record.json` stored as U+FFFD — zero for nearly every pass, printed when not. */
  readonly nulsReplaced: number;
}

/** One string with every NUL stored as U+FFFD, and how many there were. */
function storableText({ text }: { text: string }): { text: string; nulsReplaced: number } {
  return { nulsReplaced: text.split(NUL).length - 1, text: text.replaceAll(NUL, REPLACEMENT) };
}

/**
 * An absent artifact as the nullable column takes it, with every NUL in a present one stored as U+FFFD.
 *
 * A named function rather than a ternary or a `??`, because the two gates pull opposite ways here and only
 * this shape satisfies both: `no-silent-fallback` refuses `??` outright and oxlint's
 * `prefer-nullish-coalescing` rewrites the equivalent ternary INTO one. Neither gate is weakened.
 *
 * @param text the artifact's contents, or `undefined` when the pass wrote none
 * @returns the column's text, `null` for a pass that died before writing one, and how many NULs it replaced
 */
function storableArtifact({ text }: { text: string | undefined }): { text: string | null; nulsReplaced: number } {
  if (text === undefined) {
    return { nulsReplaced: 0, text: null };
  }
  return storableText({ text });
}

/** A decoded JSON value with every NUL in a string or a key stored as U+FFFD, and how many there were. */
function storableJson({ value }: { value: unknown }): { value: unknown; nulsReplaced: number } {
  if (typeof value === "string") {
    const stored = storableText({ text: value });
    return { nulsReplaced: stored.nulsReplaced, value: stored.text };
  }
  if (Array.isArray(value)) {
    const items = value.map((item: unknown) => storableJson({ value: item }));
    return { nulsReplaced: sumOf({ counts: items }), value: items.map((item) => item.value) };
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).map(([key, item]) => {
      const storedKey = storableText({ text: key });
      const storedItem = storableJson({ value: item });
      return {
        key: storedKey.text,
        nulsReplaced: storedKey.nulsReplaced + storedItem.nulsReplaced,
        value: storedItem.value,
      };
    });
    return {
      nulsReplaced: sumOf({ counts: entries }),
      value: Object.fromEntries(entries.map((entry) => [entry.key, entry.value])),
    };
  }
  return { nulsReplaced: 0, value };
}

/** The total of every part's replaced-NUL count. */
function sumOf({ counts }: { counts: readonly { nulsReplaced: number }[] }): number {
  return counts.reduce((total, part) => total + part.nulsReplaced, 0);
}

/** A field read as a finite number, or `null` for the same reason. */
function nullableInt({ value }: { value: unknown }): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return null;
}

/**
 * Project one Codex pass directory into the row an insert takes.
 *
 * @param id the pass directory's name, which is the artifact id and the row's primary key
 * @param recordText the exact bytes of `record.json`
 * @param artifactText `artifact.md`'s text, or `undefined` when the pass died before writing one
 * @param path the directory, carried into a failure so the operator can go and look
 * @returns the row with how many NULs it stored as U+FFFD, or the typed reason the record could not become one
 */
export function projectCodexPass({
  id,
  recordText,
  artifactText,
  path,
}: {
  id: string;
  recordText: string;
  artifactText: string | undefined;
  path: string;
}): Result<ProjectedCodexPass, FleetImportError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(recordText);
  } catch {
    return err(FleetImportErrors.unreadableLine({ lineNumber: 1, path }));
  }
  const stored = storableJson({ value: parsed });
  const decoded = stored.value;
  if (!isRecord(decoded)) {
    return err(FleetImportErrors.unreadableLine({ lineNumber: 1, path }));
  }
  const createdAtIso = nullableText({ value: decoded["createdAtIso"] });
  if (createdAtIso === null) {
    return err(FleetImportErrors.missingField({ field: "createdAtIso", lineNumber: 1, path }));
  }
  const createdAt = new Date(createdAtIso);
  if (Number.isNaN(createdAt.getTime())) {
    return err(FleetImportErrors.unreadableInstant({ lineNumber: 1, path, value: createdAtIso }));
  }
  const outcome = nullableText({ value: nested({ from: decoded, key: "outcome" })?.["kind"] });
  if (outcome === null) {
    return err(FleetImportErrors.missingField({ field: "outcome.kind", lineNumber: 1, path }));
  }
  const scope = nested({ from: decoded, key: "scope" });
  const property = nested({ from: decoded, key: "scope" })?.["property"];
  const propertyRecord = isRecord(property) ? property : undefined;
  const tree = nested({ from: decoded, key: "tree" });
  const artifact = storableArtifact({ text: artifactText });
  const row: NewCodexPassRecord = {
    artifact: artifact.text,
    baseSha: nullableText({ value: scope?.["baseSha"] }),
    branch: nullableText({ value: tree?.["branch"] }),
    createdAt,
    diffSha256: nullableText({ value: scope?.["diffSha256"] }),
    elapsedMs: nullableInt({ value: decoded["observedElapsedMs"] }),
    headSha: nullableText({ value: scope?.["headSha"] }),
    id,
    mode: nullableText({ value: scope?.["mode"] }),
    model: nullableText({ value: decoded["requestedModel"] }),
    outcome,
    pass: nullableText({ value: scope?.["pass"] }),
    property: nullableText({ value: propertyRecord?.["statement"] }),
    propertyId: nullableText({ value: propertyRecord?.["id"] }),
    record: decoded,
    repoRoot: nullableText({ value: decoded["repoRoot"] }),
  };
  return ok({ nulsReplaced: artifact.nulsReplaced + stored.nulsReplaced, row });
}
