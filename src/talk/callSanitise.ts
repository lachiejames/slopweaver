/**
 * Mask a batch of call lines before `talk transcript` appends it to `talk/calls/<callId>.jsonl` — the call file's half
 * of what `./callThreadSanitise.ts` does for the call's thread journal, with the same masker
 * (`src/hygiene/maskSecrets.ts`). Pure: the denylist arrives loaded.
 *
 * ## Why every string, not only a tool's answer
 *
 * `talk` is authored state, and `store import-fleet --only authored` refuses a whole FILE carrying a secret hit
 * (`src/store/fleet/authoredFile.ts`). A tool line keeps exactly what the model was handed (`./callToolLine.ts`) — a
 * Slack thread, a local file, a web page — so one pasted token kept the whole call out of the store and the backup and
 * sat on disk in the clear. A token read aloud lands in a segment, a relay or a written message just the same, so every
 * string of every line is masked: a secret hit becomes `[REDACTED:<label>]`, counted by label, and nothing of it is
 * kept. Identifiers are kept, as the import keeps them. The private denylist is literal secrets, never the owner's ordinary
 * words, so those words are touched only where they carried one.
 *
 * A string still carrying a secret after every pass is replaced whole by one marker per surviving label, so a line is
 * never dropped for it. A tool answer the markers grew past `CALL_TOOL_ANSWER_MAX_BYTES` is dropped by the line's own
 * schema, as one past the cap always was, and counted. The last check is the exact line that will be written; a secret
 * on it there — or masking that broke the line's shape — refuses the batch rather than write one. The store looks once
 * more under the call's lock, after stamping (`secretOnStoredLine`): a field it adds is never masked, so a
 * denylist word one carries refuses the append instead.
 */
import { maskSecretString, secretLabelsIn } from "../hygiene/maskSecrets.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonStringify } from "../lib/safeJson.js";
import { type CallEntry, callEntryOf } from "./callRecord.js";
import { type CallSanitiseError, CallSanitiseErrors } from "./callSanitiseErrors.js";

/** A batch masked for the call file. */
export interface SanitisedCallBatch {
  readonly entries: readonly CallEntry[];
  /** How many secrets were masked, per label, in the order first found. */
  readonly redactions: readonly { readonly label: string; readonly count: number }[];
  /** How many tool answers masking grew past the answer cap, so the line keeps none. */
  readonly toolAnswersDropped: number;
}

/**
 * One string masked, or replaced whole when a secret outlasts every pass.
 *
 * @param denylist the private denylist words
 * @param redactions running count per label, added to
 * @returns the string as it may be stored
 */
function maskedText({
  text,
  denylist,
  redactions,
}: {
  text: string;
  denylist: readonly string[];
  redactions: Map<string, number>;
}): string {
  const masked = maskSecretString({ denylist, redactions, text });
  const surviving = secretLabelsIn({ denylist, text: masked });
  if (surviving.length === 0) {
    return masked;
  }
  for (const label of surviving) {
    const before = redactions.get(label);
    redactions.set(label, before === undefined ? 1 : before + 1);
  }
  return surviving.map((label) => `[REDACTED:${label}]`).join(" ");
}

/**
 * Every string inside a parsed line masked; object keys are the schema's own and never rewritten.
 *
 * @param value a line, or a value inside one
 * @param denylist the private denylist words
 * @param redactions running count per label, added to
 * @returns the value with every string masked
 */
function maskValue({
  value,
  denylist,
  redactions,
}: {
  value: unknown;
  denylist: readonly string[];
  redactions: Map<string, number>;
}): unknown {
  if (typeof value === "string") {
    return maskedText({ denylist, redactions, text: value });
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => maskValue({ denylist, redactions, value: item }));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, maskValue({ denylist, redactions, value: item })]),
    );
  }
  return value;
}

/**
 * How many secrets have been masked so far, across every label.
 *
 * @param redactions running count per label
 * @returns the total
 */
function maskedSoFar({ redactions }: { redactions: ReadonlyMap<string, number> }): number {
  let total = 0;
  for (const count of redactions.values()) {
    total += count;
  }
  return total;
}

/**
 * The first line of a batch carrying a secret exactly as the call file will hold it — the store's own last look, made
 * after it stamps each segment line with when it wrote it, so a field the store adds is judged as well as the batch.
 *
 * @param entries the lines as they will be written
 * @param denylist the private denylist words, already loaded
 * @returns that line's kind and the labels on it, or `undefined` when no line carries one
 */
export function secretOnStoredLine({
  entries,
  denylist,
}: {
  entries: readonly CallEntry[];
  denylist: readonly string[];
}): { readonly kind: string; readonly labels: readonly string[] } | undefined {
  for (const entry of entries) {
    const labels = secretLabelsIn({ denylist, text: safeJsonStringify({ label: "call line", value: entry }) });
    if (labels.length > 0) {
      return { kind: entry.kind, labels };
    }
  }
  return undefined;
}

/**
 * Mask one batch for the call file.
 *
 * @param entries the batch as read, origin already stamped
 * @param denylist the private denylist words, already loaded
 * @returns the lines to append and what masking did, or why the batch must not be written
 */
export function sanitiseCallBatch({
  entries,
  denylist,
}: {
  entries: readonly CallEntry[];
  denylist: readonly string[];
}): Result<SanitisedCallBatch, CallSanitiseError> {
  const redactions = new Map<string, number>();
  const sanitised: CallEntry[] = [];
  let toolAnswersDropped = 0;
  for (const entry of entries) {
    const before = maskedSoFar({ redactions });
    const masked = maskValue({ denylist, redactions, value: entry });
    // An untouched line is kept as parsed: re-parsing it could only re-run what the read already ran.
    const line = maskedSoFar({ redactions }) === before ? entry : callEntryOf({ value: masked });
    if (line === undefined) {
      return err(CallSanitiseErrors.shapeBroken({ kind: entry.kind }));
    }
    const surviving = secretOnStoredLine({ denylist, entries: [line] });
    if (surviving !== undefined) {
      return err(CallSanitiseErrors.secretSurvived({ kind: entry.kind, labels: surviving.labels }));
    }
    if (entry.kind === "tool" && line.kind === "tool" && entry.answer !== undefined && line.answer === undefined) {
      toolAnswersDropped += 1;
    }
    sanitised.push(line);
  }
  return ok({
    entries: sanitised,
    redactions: [...redactions.entries()].map(([label, count]) => ({ count, label })),
    toolAnswersDropped,
  });
}
