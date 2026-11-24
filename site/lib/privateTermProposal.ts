/**
 * What `/api/private-term-proposals` answers, shared by the route that reads the owner's private-terms store
 * (`./privateTermProposalRead.ts`) and the card that shows it (`../components/console/PrivateTermProposals.tsx`).
 *
 * A Queue card asking the owner to confirm private words names its proposals by id. This is the one place their
 * words are drawn: read from the owner's own machine when the card opens and held only in that card's state. They
 * never go into a card file, a `QueueRow`, a voice or recorded reading, a log or a URL. A proposal that cannot be drawn
 * answers one of a closed set of reasons, never the text that failed.
 *
 * Pure: an unknown body in, a checked answer or `undefined` out.
 */

/** Every reason one proposal is not drawn. Closed, so a refusal can never carry a word. */
export const PRIVATE_TERM_PROPOSAL_UNAVAILABLE = [
  "not-waiting",
  "unreadable",
  "malformed",
  "linked",
  "current-changed",
  "not-one-row",
] as const;

/** One reason from {@link PRIVATE_TERM_PROPOSAL_UNAVAILABLE}. */
export type PrivateTermProposalUnavailable = (typeof PRIVATE_TERM_PROPOSAL_UNAVAILABLE)[number];

/** The owner's recorded answer to one proposal, or `null` when they have not answered. */
export type PrivateTermProposalAnswerWord = "yes" | "no" | null;

/** One proposal as the card draws it. */
export type PrivateTermProposalItem =
  | {
      readonly kind: "shown";
      readonly proposalId: string;
      readonly action: "add" | "narrow" | "remove";
      readonly termId: string;
      readonly className: string;
      readonly caseInsensitive: boolean;
      readonly pattern: string;
      readonly meaning: string | null;
      readonly allowedWhere: string | null;
      readonly answer: PrivateTermProposalAnswerWord;
    }
  | {
      readonly kind: "unavailable";
      readonly proposalId: string;
      readonly reason: PrivateTermProposalUnavailable;
    };

/** The route's answer: every asked id in order, or why the request was refused. */
export type PrivateTermProposalsAnswer =
  | { readonly kind: "read"; readonly items: readonly PrivateTermProposalItem[] }
  | { readonly kind: "refused"; readonly reason: "not-the-console" | "bad-request" };

/** One of the three edits a proposal makes. */
function isAction(value: unknown): value is "add" | "narrow" | "remove" {
  return value === "add" || value === "narrow" || value === "remove";
}

/** One of the closed reasons. */
function isReason(value: unknown): value is PrivateTermProposalUnavailable {
  return PRIVATE_TERM_PROPOSAL_UNAVAILABLE.some((reason) => reason === value);
}

/** A plain object, so its fields can be read by name. */
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string, or `null` read as absent. */
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** One shown item's fields, every one checked. */
function shownOf({ item }: { item: Readonly<Record<string, unknown>> }): PrivateTermProposalItem | undefined {
  const { action, allowedWhere, answer, caseInsensitive, className, meaning, pattern, proposalId, termId } = item;
  const answerKnown = answer === null || answer === "yes" || answer === "no";
  const textsKnown =
    typeof proposalId === "string" &&
    typeof termId === "string" &&
    typeof className === "string" &&
    typeof pattern === "string" &&
    isNullableString(meaning) &&
    isNullableString(allowedWhere);
  if (!textsKnown || !answerKnown || !isAction(action) || typeof caseInsensitive !== "boolean") {
    return undefined;
  }
  return {
    action,
    allowedWhere,
    answer,
    caseInsensitive,
    className,
    kind: "shown",
    meaning,
    pattern,
    proposalId,
    termId,
  };
}

/** One item, checked, or `undefined` for any shape the route never answers. */
function itemOf({ value }: { value: unknown }): PrivateTermProposalItem | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  if (value["kind"] === "shown") {
    return shownOf({ item: value });
  }
  const { proposalId, reason } = value;
  if (value["kind"] !== "unavailable" || typeof proposalId !== "string" || !isReason(reason)) {
    return undefined;
  }
  return { kind: "unavailable", proposalId, reason };
}

/**
 * Check the route's body against what the card asked for: one item per asked id, in the asked order, each of a
 * known shape. Anything else is `undefined`, which the card draws as not read, never partly.
 *
 * @param body the parsed JSON body
 * @param expectedIds the ids the card asked for, in order
 * @returns the items, or `undefined` when the body is not exactly that answer
 */
export function privateTermProposalsAnswerOf({
  body,
  expectedIds,
}: {
  body: unknown;
  expectedIds: readonly string[];
}): readonly PrivateTermProposalItem[] | undefined {
  if (!isObject(body) || body["kind"] !== "read" || !Array.isArray(body["items"])) {
    return undefined;
  }
  const raw: readonly unknown[] = body["items"];
  if (raw.length !== expectedIds.length) {
    return undefined;
  }
  const items: PrivateTermProposalItem[] = [];
  for (const [index, value] of raw.entries()) {
    const item = itemOf({ value });
    if (item === undefined || item.proposalId !== expectedIds[index]) {
      return undefined;
    }
    items.push(item);
  }
  return items;
}
