/**
 * Projecting one parsed handover document into one `board_row`.
 *
 * Pure: a `HandoverDoc` and the document's own text in, a row or a typed failure out. The text is a
 * parameter rather than re-read here so the hash this stores is provably the hash of what was parsed.
 *
 * ## Why so little is validated, and what that buys
 *
 * `../../handover/doc.ts` has already decided what every field means, including how a malformed one reads:
 * an unparseable `status:` becomes `unknown` rather than an error, because the board's whole design is that
 * a broken row is VISIBLE rather than absent. Re-validating here would either duplicate that judgement or
 * disagree with it, and disagreeing is worse — the file stays authoritative (`../schema/board.ts`), so a
 * projection that refused a row the board itself displays would make the table quietly smaller than the
 * board and give no reader a way to notice.
 *
 * The one thing this DOES refuse is an `askedIso:` that is present and unreadable. A timestamp is the only
 * field here that a reader does arithmetic on — the ask-latency number AGENTS.md's register turns on — and
 * silently dropping an unreadable one to NULL would move that number without saying so.
 */
import type { HandoverDoc } from "../../handover/doc.js";
import { docHash } from "../../handover/runStore.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { NewBoardRowRecord } from "../schema/board.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";

/**
 * An optional field, as the nullable column takes it.
 *
 * Generic rather than `string`-typed because four of these columns are ENUMS: `doc.priority` is a
 * `BoardPriority | undefined` and widening it to `string` here would make the row assignable to nothing.
 * See `./autonomyEvent.ts` on why this is a function rather than `?? null`.
 *
 * @returns the value, or `null` when the document declared none
 */
function orNull<T>({ value }: { value: T | undefined }): T | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * An optional instant, refused rather than defaulted when it is present and unreadable.
 *
 * @param value the ISO string the frontmatter declared, or `undefined` when it declared none
 * @param field which field it came from, so a refusal names it
 * @param path the document, so a refusal can be gone and looked at
 * @returns the date, `null` for an absent field, or the typed refusal
 */
function optionalInstant({
  value,
  field,
  path,
}: {
  value: string | undefined;
  field: string;
  path: string;
}): Result<Date | null, FleetImportError> {
  if (value === undefined) {
    return ok(null);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return err(FleetImportErrors.unreadableDocField({ field, path, value }));
  }
  return ok(parsed);
}

/**
 * Everything below the front-matter — the prose a session actually reads.
 *
 * Split on the front-matter's own CLOSING delimiter rather than parsed: the body is markdown whose headings
 * are a convention, not a schema, and the one thing anything does with it is give it back unchanged. A
 * document with no front-matter at all is all body, which is the honest reading of a file nothing fenced.
 *
 * **What it does NOT do is `trim()`, and that is the whole care in this function.** A review
 * (`unreachable-classification`) falsified the whole-string approach: whole-string trimming strips the
 * leading indentation off a body whose first line is an indented markdown code block, where the indentation
 * IS the syntax. This column exists so `handovers/` can be deleted, so a round trip that silently reindents
 * a document means the file was never safe to delete. Only the blank line that separates the fence from the
 * prose is removed, and only ever one, by slicing past the line break rather than by trimming.
 *
 * `\r\n` is handled for the same reason and it was the same review: matching the fence as `---\n` alone made
 * a CRLF document read as having no front-matter at all, which stored its entire header as body.
 *
 * Pure, and exported so the split is testable without a document on disk.
 *
 * @param text the document's full text
 * @returns the prose below the front-matter, byte for byte apart from the one separating blank line
 */
export function bodyBelowFrontMatter({ text }: { text: string }): string {
  const fence = fenceOf({ text });
  if (fence === undefined) {
    return text;
  }
  const closing = text.indexOf(`${fence.eol}---${fence.eol}`, fence.open.length - fence.eol.length);
  if (closing === -1) {
    // An unterminated fence is not front-matter, so nothing here may claim to have stripped one.
    return text;
  }
  const afterFence = text.slice(closing + `${fence.eol}---${fence.eol}`.length);
  return afterFence.startsWith(fence.eol) ? afterFence.slice(fence.eol.length) : afterFence;
}

/**
 * The opening front-matter fence and the line ending the document uses, or `undefined` when it has none.
 *
 * @param text the document's full text
 * @returns the fence as written and its line ending
 */
function fenceOf({ text }: { text: string }): { readonly open: string; readonly eol: string } | undefined {
  if (text.startsWith("---\r\n")) {
    return { eol: "\r\n", open: "---\r\n" };
  }
  if (text.startsWith("---\n")) {
    return { eol: "\n", open: "---\n" };
  }
  return undefined;
}

/**
 * Project one board document into the row an insert takes.
 *
 * @param doc the parsed frontmatter, as `handover list` itself reads it
 * @param text the document's full text, hashed so a stale projection is visible rather than silent
 * @returns the row, or the typed reason the document could not become one
 */
export function projectBoardDoc({
  doc,
  text,
}: {
  doc: HandoverDoc;
  text: string;
}): Result<NewBoardRowRecord, FleetImportError> {
  const askedAt = optionalInstant({ field: "askedIso", path: doc.path, value: doc.askedIso });
  if (askedAt.isErr()) {
    return err(askedAt.error);
  }
  const pausedSince = optionalInstant({ field: "pausedSince", path: doc.path, value: doc.pausedSince });
  if (pausedSince.isErr()) {
    return err(pausedSince.error);
  }
  return ok({
    anchor: orNull({ value: doc.anchor }),
    askedAt: askedAt.value,
    baseBranch: orNull({ value: doc.baseBranch }),
    blockedBy: doc.blockedBy,
    body: bodyBelowFrontMatter({ text }),
    branch: orNull({ value: doc.branch }),
    docHash: docHash({ text }),
    doneWhen: doc.doneWhen,
    evidence: doc.evidence,
    kind: doc.kind,
    observedBy: orNull({ value: doc.observedBy }),
    origin: orNull({ value: doc.origin }),
    outputs: doc.outputs,
    pausedOn: orNull({ value: doc.pausedOn }),
    pausedSince: pausedSince.value,
    priority: orNull({ value: doc.priority }),
    repo: orNull({ value: doc.repo }),
    ruling: orNull({ value: doc.ruling }),
    rulingAnchor: orNull({ value: doc.rulingAnchor }),
    settlement: orNull({ value: doc.settlement }),
    settlementReason: orNull({ value: doc.settlementReason }),
    settlementWitness: orNull({ value: doc.settlementWitness }),
    slug: doc.slug,
    sourcePath: doc.path,
    status: doc.status,
    summary: orNull({ value: doc.summary }),
  });
}
