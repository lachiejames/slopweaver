/**
 * A Queue card that makes a claim brings its receipts, and the shape makes bringing them the easy path.
 *
 * A queue card never reaches the owner without its receipts. The rule is bounded: never withhold a card because a
 * session thinks it cannot get the receipt, since sometimes the evidence speaks for itself, and a claim to a human
 * (a vendor bill, say) wants at least a screenshot and a link to where they can go and see it. The path of least
 * resistance is to actually align with the owner. On proof that could not be had, the card shows what it tried: an
 * answer up front the owner can attack, never a bare absence.
 *
 * ## Three shapes, and the one that costs nothing
 *
 * - `attached` is DERIVED, never declared: a link in the rendered message or a file under it is a receipt the
 *   reader can open, so a recorder who brought one types no flag at all. That is the least-resistance path.
 * - `self-evident` is `--self-evident "<why no receipt is needed>"`: the message itself is the evidence.
 * - `tried` is `--tried "<what was tried and what stopped it>"`: the receipt could not be had, and the card says why
 *   where the receipt would have been. Beside a link it says what is still missing, a screenshot that would not load.
 *
 * A recording with none of the three is refused, with every shape named. There is deliberately NO escape hatch:
 * each way through is a declaration a recorder can always make, exactly as `./priorAsk.ts` reasons. A bump
 * (`--act bump`) re-surfaces an earlier message and asserts nothing new, so it owes none.
 *
 * ## A card the owner already sent back for its receipts
 *
 * A card the owner had rejected for no receipts can come back in front of them, its re-cut's words saying "got the
 * receipts" while the message carried no link and no file — its evidence on a local page the owner never sees from
 * the card. A re-cut of a row whose triage relay carried the owner's `no-receipts` feedback may not call itself
 * `self-evident`: the owner already said it is not. `tried` stays open there, because a card which could not get
 * the proof says what it tried rather than staying away.
 *
 * ## Residue, stated rather than discovered
 *
 * - That a link PROVES the claim is not decidable here; that the reader has something to open is.
 * - A file is counted, never classified: `--media` takes video as well as pictures, so the card says "attachment".
 * - `self-evident` is the recorder's word, shown first on the card where the owner can attack it.
 *
 * Pure: no network, no clock, no filesystem.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type DraftReceiptsError, DraftReceiptsErrors } from "./draftReceiptErrors.js";
import type { ParkedDraftReceipts } from "./receiptsLine.js";

/** What a recording declared about its receipts, before the message and its files are read. */
export type ReceiptsDeclaration =
  | { readonly kind: "undeclared" }
  | { readonly kind: "self-evident"; readonly why: string }
  | { readonly kind: "tried"; readonly tried: string };

/** A link a reader can open: an http(s) URL. */
const URL_PREFIX = /^https?:\/\//iu;

/** Slack's own `<url>` / `<url|label>` markup inside mrkdwn text. */
const SLACK_LINK = /<(https?:\/\/[^|>\s]+)(?:\|[^>]*)?>/giu;

/**
 * The declaration `--self-evident` and `--tried` make, or why the two cannot stand together.
 *
 * @param selfEvident `--self-evident`'s value, absent when not given
 * @param tried `--tried`'s value, absent when not given
 * @returns the declaration, or the refusal lines
 */
export function receiptsDeclarationOf({
  selfEvident,
  tried,
}: {
  selfEvident: string | undefined;
  tried: string | undefined;
}): Result<ReceiptsDeclaration> {
  const problems: string[] = [];
  if (selfEvident?.trim() === "") {
    problems.push('--self-evident needs the reason no receipt is needed: --self-evident "<why>"');
  }
  if (tried?.trim() === "") {
    problems.push('--tried needs what was tried and what stopped it: --tried "<what and why it failed>"');
  }
  if (selfEvident !== undefined && tried !== undefined) {
    problems.push("--self-evident and --tried contradict each other: a card that needs no receipt tried for none");
  }
  if (problems.length > 0) {
    return err(problems);
  }
  if (selfEvident !== undefined) {
    return ok({ kind: "self-evident", why: selfEvident });
  }
  if (tried !== undefined) {
    return ok({ kind: "tried", tried });
  }
  return ok({ kind: "undeclared" });
}

/**
 * Every distinct link a rendered message carries, in first-seen order: a `url` field anywhere in its blocks (a rich
 * text `link` element, a button) and a `<url|label>` in its mrkdwn. Read off the rendered payload, which is what the owner
 * sees on the card and what their approval binds.
 *
 * @param payload the exact bytes a release would post
 * @returns the links
 */
export function receiptLinks({ payload }: { payload: unknown }): readonly string[] {
  const seen = new Set<string>();
  walk({ seen, value: payload });
  return [...seen];
}

/** Collect every link under one JSON value into `seen`. */
function walk({ seen, value }: { seen: Set<string>; value: unknown }): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(SLACK_LINK)) {
      seen.add(match[1]!);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walk({ seen, value: item });
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, field] of Object.entries(value)) {
    if (key === "url" && typeof field === "string" && URL_PREFIX.test(field)) {
      seen.add(field);
      continue;
    }
    walk({ seen, value: field });
  }
}

/**
 * The receipts a recording parks with, or why it may not park.
 *
 * @param declared what `--self-evident` / `--tried` said, or `undeclared`
 * @param payload the exact bytes a release would post
 * @param media how many files go under the message
 * @param bump whether the row is a bump (`--act bump`), which asserts nothing new and owes no receipt
 * @param sentBackFor the row this one re-cuts that the owner's triage word sent back for its receipts, if any
 * @returns the row's receipts (`undefined` for a bump that brought and declared none), or the typed refusal
 */
export function receiptsOfRecording({
  declared,
  payload,
  media,
  bump,
  sentBackFor,
}: {
  declared: ReceiptsDeclaration;
  payload: unknown;
  media: number;
  bump: boolean;
  sentBackFor: string | undefined;
}): Result<ParkedDraftReceipts | undefined, DraftReceiptsError> {
  const links = receiptLinks({ payload });
  if (links.length > 0 || media > 0) {
    if (declared.kind === "self-evident") {
      return err(DraftReceiptsErrors.selfEvidentWithReceipts({ links: links.length, media }));
    }
    return ok({ kind: "attached", links, media, ...(declared.kind === "tried" ? { tried: declared.tried } : {}) });
  }
  if (declared.kind === "self-evident" && sentBackFor !== undefined) {
    return err(DraftReceiptsErrors.selfEvidentSentBack({ sentBackFor }));
  }
  if (declared.kind === "self-evident") {
    return ok({ kind: "self-evident", why: declared.why });
  }
  if (declared.kind === "tried") {
    return ok({ kind: "tried", tried: declared.tried });
  }
  if (bump) {
    return ok(undefined);
  }
  return err(DraftReceiptsErrors.missing());
}

/**
 * Whether a stored row's receipts are one of the three shapes and, for `attached`, exactly what its own message and
 * files carry — so a hand-edited count or a link the message does not hold reads as a malformed row, never as proof.
 *
 * @param receipts the stored field, absent on a row recorded before it and on a bump
 * @param payload the row's rendered message
 * @param media how many files the row carries
 * @returns true when absent or well-formed and consistent
 */
export function receiptsValid({
  receipts,
  payload,
  media,
}: {
  receipts: unknown;
  payload: unknown;
  media: number;
}): boolean {
  if (receipts === undefined) {
    return true;
  }
  if (!isRecord(receipts)) {
    return false;
  }
  const record = receipts;
  const keys = Object.keys(record).toSorted();
  if (record["kind"] === "self-evident") {
    return keys.join(",") === "kind,why" && nonBlank({ value: record["why"] });
  }
  if (record["kind"] === "tried") {
    return keys.join(",") === "kind,tried" && nonBlank({ value: record["tried"] });
  }
  if (record["kind"] !== "attached") {
    return false;
  }
  const allowed = new Set(["kind", "links", "media", "tried"]);
  const { links, tried } = record;
  return (
    keys.every((key) => allowed.has(key)) &&
    record["media"] === media &&
    (tried === undefined || nonBlank({ value: tried })) &&
    Array.isArray(links) &&
    JSON.stringify(links) === JSON.stringify(receiptLinks({ payload })) &&
    (links.length > 0 || media > 0)
  );
}

/** Whether a value is a string with something in it. */
function nonBlank({ value }: { value: unknown }): boolean {
  return typeof value === "string" && value.trim() !== "";
}
