/**
 * THE PRIVATE-WORDS REVIEW, pure core: whether a write the privacy check judged is sent, refused or held, the one
 * value that names a held write, what a held write prints, and the contexts a reviewer reads.
 *
 * ## The decision
 *
 * | The check found                                                  | The write is |
 * | ---------------------------------------------------------------- | ------------ |
 * | nothing                                                          | sent         |
 * | any finding that is not a private term, alone or beside one      | refused      |
 * | private terms only, and a matched row carries no meaning         | refused      |
 * | private terms only, every matched row carrying the owner's words | held         |
 *
 * A credential, a denylisted term, installation state and a forbidden identifier never reach a review: those are
 * facts about the text, not a judgement of context, and rewording is always possible. A row with no meaning gives a
 * reviewer nothing to judge against, so it refuses as every row did before the review existed.
 *
 * ## One held write is one value
 *
 * {@link privateTermHoldKey} hashes the family, the operation, the destination, every string the write sends, every
 * match's offsets, every matched row's exact-bytes digest and the digest of the whole request the door would send
 * ({@link requestDigest}), which carries the target ids the strings never do. A receipt releases that value and
 * nothing else: a reworded text, another channel, issue or event, a row edited or a new row matching are all a
 * different write, held afresh.
 */
import { createHash, type Hash } from "node:crypto";

import { isRecord } from "#lib/parsers.js";
import { stableStringify } from "#lib/stableStringify.js";

import {
  checkPrivacy,
  type PrivacyDestination,
  type PrivacyFinding,
  type PrivacyPolicy,
  privateTermMatchesIn,
  UNASSESSED_PERSONAL_MATERIAL,
} from "../privacyCheck.js";
import type {
  PrivateTermHeldContent,
  PrivateTermHeldMatch,
  PrivateTermHeldTerm,
  PrivateTermWriteDraft,
  PrivateTermWriteFamily,
} from "./types.js";

/** A write as its guard hands it over: what sends it, where, and every string it sends. */
export interface PrivateTermWriteInput {
  readonly family: PrivateTermWriteFamily;
  readonly command: string;
  readonly destination: string;
  readonly contents: readonly PrivateTermHeldContent[];
  /**
   * The whole request as the door will send it, target ids included: only its digest is kept, so a receipt can
   * never release the same contents sent anywhere else. Nothing that changes between two attempts of one write.
   */
  readonly request: unknown;
}

/**
 * Pure: sha256 over a request's canonical form. Keys are sorted, bytes are fed whole and tagged with their
 * length, so two requests that differ anywhere, an id or a byte of an upload, are two values.
 *
 * @param request the request as the door will send it
 * @returns sixty-four hex digits
 */
export function requestDigest({ request }: { request: unknown }): string {
  const hash = createHash("sha256");
  feedCanonical({ hash, value: request });
  return hash.digest("hex");
}

/** Feed one value into the hash, every kind tagged so no two kinds can spell the same bytes. */
function feedCanonical({ hash, value }: { hash: Hash; value: unknown }): void {
  if (value instanceof Uint8Array) {
    hash.update(`b${value.byteLength}:`);
    hash.update(value);
    return;
  }
  if (Array.isArray(value)) {
    hash.update(`a${value.length}[`);
    for (const item of value) {
      feedCanonical({ hash, value: item });
    }
    hash.update("]");
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).toSorted();
    hash.update(`o${keys.length}{`);
    for (const key of keys) {
      hash.update(JSON.stringify(key));
      feedCanonical({ hash, value: value[key] });
    }
    hash.update("}");
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    hash.update(`p${JSON.stringify(value)}`);
    return;
  }
  // undefined, a bigint, a function or a symbol: its kind alone, since none is ever request content.
  hash.update(`k${typeof value}`);
}

/** What becomes of one write. */
export type PrivateTermWriteDecision =
  | { readonly kind: "send" }
  | { readonly kind: "refuse" }
  | { readonly kind: "refuse-unmeant"; readonly termIds: readonly string[] }
  | { readonly kind: "review"; readonly draft: PrivateTermWriteDraft };

/**
 * Pure: every finding the one check makes on a write's contents, for one destination.
 *
 * @param contents every string the write sends
 * @param destination the facts about where it goes
 * @param policy the denylist, identifier rules and private terms
 * @returns the findings, content by content
 */
export function writeFindingsOf({
  contents,
  destination,
  policy,
}: {
  contents: readonly PrivateTermHeldContent[];
  destination: PrivacyDestination;
  policy: PrivacyPolicy;
}): readonly PrivacyFinding[] {
  return contents.flatMap(
    (content) =>
      checkPrivacy({ content, destination, personalMaterial: UNASSESSED_PERSONAL_MATERIAL, policy }).findings,
  );
}

/**
 * Pure: the value one held write is named by.
 *
 * @returns sixty-four hex digits
 */
export function privateTermHoldKey({
  family,
  command,
  destination,
  contents,
  matches,
  terms,
  requestSha256,
}: {
  family: PrivateTermWriteFamily;
  command: string;
  destination: string;
  contents: readonly PrivateTermHeldContent[];
  matches: readonly PrivateTermHeldMatch[];
  terms: readonly PrivateTermHeldTerm[];
  requestSha256: string;
}): string {
  const rows = terms.map(({ rowDigest, termId }) => ({ rowDigest, termId }));
  const value = { command, contents, destination, family, matches, requestSha256, rows, v: 2 };
  return createHash("sha256").update(stableStringify({ value }), "utf8").digest("hex");
}

/**
 * Pure: decide one write from what the check found in it.
 *
 * @param write the write as its guard hands it over
 * @param findings every finding the check made on its contents
 * @param privacyDestination the facts the check's forgiveness read, so the matches are the ones it counted
 * @param policy the policy the findings were made under
 * @returns send, refuse, refuse on a row with no meaning, or the draft to hold for review
 */
export function decidePrivateTermWrite({
  write,
  findings,
  privacyDestination,
  policy,
}: {
  write: PrivateTermWriteInput;
  findings: readonly PrivacyFinding[];
  privacyDestination: PrivacyDestination;
  policy: PrivacyPolicy;
}): PrivateTermWriteDecision {
  if (findings.length === 0) {
    return { kind: "send" };
  }
  if (findings.some((finding) => finding.code !== "PRIVATE_TERM")) {
    return { kind: "refuse" };
  }
  const matches: PrivateTermHeldMatch[] = write.contents.flatMap((content, index) =>
    privateTermMatchesIn({ content, destination: privacyDestination, policy }).map(
      ({ className, end, line, start, termId }) => ({ className, content: index, end, line, start, termId }),
    ),
  );
  if (matches.length === 0) {
    // The findings and the matches disagree, which only a changed policy could cause: refuse rather than guess.
    return { kind: "refuse" };
  }
  const matchedIds = [...new Set(matches.map((match) => match.termId))].toSorted();
  const rows = matchedIds.map((termId) => policy.privateTerms.find((term) => term.termId === termId)!);
  const unmeant = rows.filter((row) => row.meaning === undefined).map((row) => row.termId);
  if (unmeant.length > 0) {
    return { kind: "refuse-unmeant", termIds: unmeant };
  }
  const terms: PrivateTermHeldTerm[] = rows.map((row) => ({
    allowedWhere: row.allowedWhere,
    className: row.className,
    meaning: row.meaning!,
    rowDigest: row.rowDigest,
    termId: row.termId,
  }));
  const { request, ...described } = write;
  const unkeyed = { ...described, matches, requestSha256: requestDigest({ request }), terms };
  return { draft: { ...unkeyed, holdKey: privateTermHoldKey(unkeyed) }, kind: "review" };
}

/**
 * The extra reason a refusal on a row with no meaning prints: which rows, and the route to a review.
 *
 * @param termIds the matched rows that carry no meaning
 * @returns the line, naming ids only
 */
export function unmeantRowsReason({ termIds }: { termIds: readonly string[] }): string {
  return (
    `the matched row(s) ${termIds.join(", ")} carry no meaning, so a match refuses outright; if the owner says what ` +
    "the term means, the chair records it with `slopweaver private-terms narrow <id> --meaning <words>` and a " +
    "match is then held for a review in context"
  );
}

/**
 * The lines a held write prints: what was held, why, and every step to its release.
 *
 * @param command the operation
 * @param reasons one redacted finding message per match line
 * @param home the state home every step must name
 * @param brokenReceipts BROKEN receipts already recorded against this exact write
 * @returns the lines, headline first
 */
export function heldWriteLines({
  command,
  reasons,
  holdId,
  home,
  brokenReceipts,
}: {
  command: string;
  reasons: readonly string[];
  holdId: string;
  home: string;
  brokenReceipts: readonly string[];
}): readonly string[] {
  const lines = [
    `${command} held before sending: a private term matched on a row carrying the owner's meaning, so a review judges it in context.`,
    ...reasons,
    `hold ${holdId}. Prepare its review: slopweaver private-terms review-prepare --hold ${holdId} --home ${home}`,
    "That prints the review for a FRESH reviewer and the record step; then run this same command again, unchanged. " +
      "A CLEAN receipt releases exactly these bytes, once.",
  ];
  if (brokenReceipts.length > 0) {
    lines.push(
      `Receipt(s) ${brokenReceipts.join(", ")} came back BROKEN for exactly this write: reword it and run it again, which is a new hold.`,
    );
  }
  return lines;
}

/** How much text either side of a match a reviewer sees. */
const CONTEXT_CHARACTERS = 240;

/**
 * Pure: the contexts file a reviewer reads, each match numbered in its surrounding text.
 *
 * @param draft the held write
 * @returns the markdown, ending in a line break
 */
export function contextsMarkdown({ draft }: { draft: PrivateTermWriteDraft }): string {
  const sections = draft.matches.map((match, index) => {
    const content = draft.contents[match.content]!;
    const text = content.text.replace(/\r\n/gu, "\n");
    const before = text.slice(Math.max(0, match.start - CONTEXT_CHARACTERS), match.start);
    const after = text.slice(match.end, match.end + CONTEXT_CHARACTERS);
    return [
      `## Match ${String(index + 1)}`,
      "",
      `- term: ${match.termId} (${match.className})`,
      `- where: ${content.locus}, line ${String(match.line)}; whole text in write/contents/${String(match.content + 1).padStart(2, "0")}.txt`,
      "",
      "```text",
      `${before}⟦${text.slice(match.start, match.end)}⟧${after}`,
      "```",
      "",
    ].join("\n");
  });
  return [`# ${String(draft.matches.length)} match(es) to judge`, "", ...sections].join("\n");
}

/**
 * Pure: one matched term's file, as the reviewer reads it.
 *
 * @param term the matched row as the hold saw it
 * @returns the markdown, ending in a line break
 */
export function termMarkdown({ term }: { term: PrivateTermHeldTerm }): string {
  return [
    `# ${term.termId}`,
    "",
    `- class: ${term.className}`,
    `- what the owner said it means: ${term.meaning}`,
    `- where the owner said it is fine: ${allowedWhereText({ allowedWhere: term.allowedWhere })}`,
    "",
  ].join("\n");
}

/** A row that names no allowed place says so in words, because a blank reads as a place the reviewer cannot see. */
function allowedWhereText({ allowedWhere }: { allowedWhere: string | undefined }): string {
  if (allowedWhere === undefined) {
    return "nowhere named";
  }
  return allowedWhere;
}

/**
 * Pure: the destination file, as the reviewer reads it.
 *
 * @param draft the held write
 * @returns the text, ending in a line break
 */
export function destinationText({ draft }: { draft: PrivateTermWriteDraft }): string {
  return [`family: ${draft.family}`, `operation: ${draft.command}`, `destination: ${draft.destination}`, ""].join("\n");
}
