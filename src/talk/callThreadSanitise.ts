/**
 * Turn one wire entry into the entry stored in a call's thread journal: inline binary out, secrets masked, size
 * fitted, and a last scan of the whole line. Pure — the denylist arrives loaded.
 *
 * ## Why mask at write time
 *
 * `talk/threads` is local-only (`src/store/fleet/authoredDirectoryRows.ts`), so the store never
 * imports it — but the journal is still a file on this Mac that `talk file` and `talk call-thread` print into a
 * session. A tool answer is whatever a Slack thread, a local file or a web page said, so a pasted token would sit in it
 * as plain text. So a secret — a credential class or a private-denylist word, exactly what `isSecretHit` names — is
 * replaced at write time by `[REDACTED:<label>]`, counted by label, and nothing of it (not even a digest) is kept.
 * Identifiers are kept: an audit needs them. That is the one place a stored capture is knowingly not what the model
 * was handed.
 *
 * The last scan runs over the serialised line, the exact bytes the import will read. A hit surviving masking (one a
 * JSON escape or an object key made) withholds the capture whole, naming the labels, rather than refusing the batch:
 * a refused batch would sit at the head of the console's queue and hold every entry behind it.
 */
import { createHash } from "node:crypto";

import { maskSecretString, secretLabelsIn } from "../hygiene/maskSecrets.js";
import { safeJsonStringify } from "../lib/safeJson.js";
import type { CallThreadWireEntry, JsonValue, StoredCallThreadEntry } from "./callThreadEntry.js";
import { CALL_THREAD_ENTRY_MAX_BYTES, fitCapture } from "./callThreadFit.js";

/** A base64 data URL: a media type, `;base64`, the payload. Its bytes are never kept. */
const DATA_URL = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?((?:;[a-z0-9-]+=[^;,]*)*);base64,(.*)$/isu;

/** A payload that is base64 and nothing else. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

/**
 * The stand-in for one inline binary string: its media type, decoded length and digest, never its bytes.
 *
 * @param text a string that may be a base64 data URL
 * @returns the stand-in, or `undefined` when the string is not one
 */
export function binaryStandIn({ text }: { text: string }): JsonValue | undefined {
  const match = DATA_URL.exec(text);
  if (match === null) {
    return undefined;
  }
  const mediaType = match[1] === undefined ? null : match[1].toLowerCase();
  const payload = match[3]!.replace(/\s+/gu, "");
  if (!BASE64.test(payload)) {
    return { encodedLength: payload.length, mediaType, omitted: "inline-binary-invalid" };
  }
  const bytes = Buffer.from(payload, "base64");
  return {
    byteLength: bytes.length,
    mediaType,
    omitted: "inline-binary",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * Every base64 data URL in a capture replaced by its {@link binaryStandIn}.
 *
 * @param value the capture
 * @param count running count of stand-ins, added to
 * @returns the capture with no inline binary
 */
function standInBinary({ value, count }: { value: JsonValue; count: { n: number } }): JsonValue {
  if (typeof value === "string") {
    const standIn = binaryStandIn({ text: value });
    if (standIn === undefined) {
      return value;
    }
    count.n += 1;
    return standIn;
  }
  if (Array.isArray(value)) {
    return value.map((item: JsonValue) => standInBinary({ count, value: item }));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, standInBinary({ count, value: item })]));
  }
  return value;
}

/**
 * Every string leaf of a capture masked by `maskSecretString` (`src/hygiene/maskSecrets.ts`).
 *
 * @param value the capture
 * @param denylist the private denylist words
 * @param redactions running count per label, added to
 * @returns the masked capture
 */
function maskSecrets({
  value,
  denylist,
  redactions,
}: {
  value: JsonValue;
  denylist: readonly string[];
  redactions: Map<string, number>;
}): JsonValue {
  if (typeof value === "string") {
    return maskSecretString({ denylist, redactions, text: value });
  }
  if (Array.isArray(value)) {
    return value.map((item: JsonValue) => maskSecrets({ denylist, redactions, value: item }));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, maskSecrets({ denylist, redactions, value: item })]),
    );
  }
  return value;
}

/**
 * The stored line of an entry, exactly as the journal writes it, newline excluded.
 *
 * @param entry the stored entry
 * @returns the line
 */
export function storedLine({ entry }: { entry: StoredCallThreadEntry }): string {
  return safeJsonStringify({ label: "call-thread journal line", value: entry });
}

/**
 * The secret labels a stored line still carries.
 *
 * @param line the serialised entry
 * @param denylist the private denylist words
 * @returns each label once, in the order first found
 */
export function survivingSecretLabels({ line, denylist }: { line: string; denylist: readonly string[] }): string[] {
  return secretLabelsIn({ denylist, text: line });
}

/**
 * The secret labels a capture still carries, read on every DECODED string — each value and each object key — so a
 * secret the serialised line escapes (a quote or backslash in a denylist word) is still seen. Keys are never masked,
 * only judged: a capture with one is withheld.
 *
 * @param value the capture, masked
 * @param denylist the private denylist words
 * @param found the labels seen so far, added to
 */
function decodedSecretLabels({
  value,
  denylist,
  found,
}: {
  value: JsonValue;
  denylist: readonly string[];
  found: Set<string>;
}): void {
  const scan = ({ text }: { text: string }): void => {
    for (const label of secretLabelsIn({ denylist, text })) {
      found.add(label);
    }
  };
  if (typeof value === "string") {
    scan({ text: value });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      decodedSecretLabels({ denylist, found, value: item });
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      scan({ text: key });
      decodedSecretLabels({ denylist, found, value: item });
    }
  }
}

/**
 * Every secret label a capture still carries, on its serialised line and on each decoded string.
 *
 * @param shell the entry's envelope, which the line is built around
 * @param capture the capture to judge
 * @param denylist the private denylist words
 * @returns each label once
 */
function survivingInCapture({
  shell,
  capture,
  denylist,
}: {
  shell: Omit<StoredCallThreadEntry, "capture">;
  capture: JsonValue;
  denylist: readonly string[];
}): string[] {
  const found = new Set(survivingSecretLabels({ denylist, line: storedLine({ entry: { ...shell, capture } }) }));
  decodedSecretLabels({ denylist, found, value: capture });
  return [...found];
}

/**
 * Sanitise one wire entry for the journal.
 *
 * @param entry the entry as the console handed it over
 * @param denylist the private denylist words, already loaded
 * @param maxBytes the stored line's ceiling, {@link CALL_THREAD_ENTRY_MAX_BYTES} unless a test narrows it
 * @returns the stored entry; its `withheld` is set when the capture could not be kept safely or at all
 */
export function sanitiseCallThreadEntry({
  entry,
  denylist,
  maxBytes = CALL_THREAD_ENTRY_MAX_BYTES,
}: {
  entry: CallThreadWireEntry;
  denylist: readonly string[];
  maxBytes?: number;
}): StoredCallThreadEntry {
  const count = { n: 0 };
  const binaryFree = standInBinary({ count, value: entry.capture });
  const redactionCounts = new Map<string, number>();
  const masked = maskSecrets({ denylist, redactions: redactionCounts, value: binaryFree });
  const redactions = [...redactionCounts.entries()].map(([label, n]) => ({ count: n, label }));
  const base = {
    binaryStandIns: count.n,
    callId: entry.callId,
    kind: entry.capture.kind,
    receivedAtIso: entry.receivedAtIso,
    redactions,
    version: 1,
    writeId: entry.writeId,
  } as const;
  const shell = { ...base, truncation: null, withheld: null };
  // Judged on the whole masked capture BEFORE any cut: a cut can shorten a surviving secret below what the scanner
  // recognises, and the prefix it leaves is still a secret's.
  const survivedMasking = survivingInCapture({ capture: masked, denylist, shell });
  if (survivedMasking.length > 0) {
    return withheldForSecret({ kind: entry.capture.kind, labels: survivedMasking, shell });
  }
  const fitted = fitCapture({
    capture: masked,
    maxBytes,
    measure: ({ capture, truncation }) =>
      Buffer.byteLength(storedLine({ entry: { ...shell, capture, truncation } }), "utf8"),
  });
  if (fitted === undefined) {
    return { ...shell, capture: { kind: entry.capture.kind }, withheld: { labels: [], reason: "unfittable" } };
  }
  const cutShell = { ...shell, truncation: fitted.truncation };
  const stored: StoredCallThreadEntry = { ...cutShell, capture: fitted.capture };
  const labels = survivingInCapture({ capture: fitted.capture, denylist, shell: cutShell });
  if (labels.length === 0) {
    return stored;
  }
  return withheldForSecret({ kind: entry.capture.kind, labels, shell });
}

/**
 * An entry whose capture is replaced whole because a secret survived masking.
 *
 * @param shell the entry's envelope, untruncated and not yet withheld
 * @param kind the capture's kind, the only part of it kept
 * @param labels the secret classes that survived
 * @returns the withheld entry
 */
function withheldForSecret({
  shell,
  kind,
  labels,
}: {
  shell: Omit<StoredCallThreadEntry, "capture">;
  kind: StoredCallThreadEntry["kind"];
  labels: readonly string[];
}): StoredCallThreadEntry {
  return { ...shell, capture: { kind }, withheld: { labels: [...labels], reason: "secret-survived-masking" } };
}
