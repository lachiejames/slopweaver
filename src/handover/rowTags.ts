/**
 * Board-row TAGS: typed `key=value` facts a row carries, so a card is chosen by what a row DECLARES rather than by
 * a regex guessing at its words, and the board filters on one spelling per fact.
 *
 * Rows carry tags, DevSecOps-style, added at registration or later as the board changes, because a seat that
 * classifies Slack-draft cards by regex guesses. A card relates to one or SEVERAL workstreams, and a workstream
 * carries an impact. The design page is `~/.slopweaver/pages/board-row-tags/index.html`.
 *
 * ## Three rules, each the reason a tag can be trusted
 *
 * - **The key list is CLOSED.** {@link TAG_KEYS} defines every key, its values and what it means. An unknown key
 *   is refused naming the nearest real one, because an open vocabulary lets `platfrom=slack` split the board
 *   silently — which is the guessing this replaces, moved one level down.
 * - **A tag lives in the row's JOURNAL**, as a `tagged` event, the way a ruling does. That keeps who tagged what
 *   and why, and never rewrites a doc somebody authored by hand. It reaches the AUTHORED rows, doc and ask: a
 *   projected Slack-tag row is keyed by its lifecycle pair rather than by a journal slug, so it carries derived
 *   tags only until it has a journal of its own.
 * - **A DERIVED key is computed, never written.** `kind`, `priority`, `reply`, `origin`, `repo` and `run` are already
 *   fields on the row; a tag copy of one would be a second source of truth that disagrees the first time either
 *   moves. `reply` is the case that proved it: declared, `reply=drafted` would outlive the answer or correction
 *   that removed the draft, so it is read off the open question instead.
 *
 * Pure: the vocabulary and its validators, the WRITE half. One `tagged` event's own checks are `./taggedEvent.ts`;
 * the fold that reads a journal into tags is `./rowTagFold.ts`.
 */

import { levenshteinDistance } from "#lib/editDistance.js";
import { err, ok, type Result } from "#lib/result.js";

import { INTEGRATION_NAMES, NEEDS_KEY } from "./integrationNeeds.js";
import { type RowTagError, RowTagErrors } from "./rowTagErrors.js";

/** Where a key's values come from: written by a session, or computed from a field the row already has. */
type TagSource = "declared" | "derived";

/**
 * Where one tag a row carries came from. `unrecognised` is a DECLARED tag the running build's registry refuses —
 * written under an older vocabulary, or by hand — and it is kept and marked rather than dropped, because a filter
 * or card that silently lost a persisted fact would misfile the row with nothing on it saying so.
 */
type RowTagSource = TagSource | "unrecognised";

/** One `key=value` pair, as written. */
export interface TagAssignment {
  readonly key: string;
  readonly value: string;
}

/** One tag a row carries, with where it came from. */
export interface RowTag extends TagAssignment {
  readonly source: RowTagSource;
}

/** What values a key takes: a closed list, or a shape every value must match. */
type TagValueRule =
  | { readonly kind: "enum"; readonly allowed: readonly string[] }
  | { readonly kind: "pattern"; readonly pattern: RegExp; readonly shape: string };

/** One key the registry defines. */
export interface TagKeySpec {
  readonly key: string;
  /** `one` replaces on write; `many` accumulates, so a row can relate to several workstreams or pull requests. */
  readonly cardinality: "one" | "many";
  readonly values: TagValueRule;
  /** `derived` keys are computed from the named field and refused as writes. */
  readonly source: TagSource;
  /** For a derived key, the row field it is read from — what a refusal tells the writer to change instead. */
  readonly derivedFrom?: string;
  /** What the key decides, in one line. */
  readonly meaning: string;
  /**
   * A value no row on the board carries yet is refused unless the write names it with `--new-value`, so a typo
   * cannot mint a second spelling of a name the board already uses. A property of the KEY, so a later key opts in
   * with this one field and every write path reads it from here.
   */
  readonly newValueNeedsFlag?: true;
  /**
   * A DERIVED key whose value is read off the row's run JOURNAL rather than its doc, so a journal that could not be
   * completely read can leave it wrong. Every declared key reads the journal; this marks the derived ones that do.
   */
  readonly readsJournal?: true;
}

/**
 * The one character no tag value may contain, for every key: the CLI carries a list of drops or new values as one
 * comma-separated flag, so a value holding one could not be named. A registry invariant rather
 * than a pattern each key must remember.
 */
export const TAG_LIST_SEPARATOR = ",";

/** A kebab-case name: what a workstream is called. */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** A whole number with no leading zero, so one count has exactly one spelling. */
const COUNT = /^(?:0|[1-9][0-9]*)$/u;

/** `owner/repo#N`: one pull request, spelled the way the board already cites them. */
const PULL_REQUEST = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#[1-9][0-9]*$/u;

/** The `audience` value for an outward act that reaches the owner alone. */
export const OWNER_AUDIENCE = "owner" as const;

/**
 * Every tag key a row may carry. Adding one is a change here and nowhere else — the verb, the schema and every
 * filter read this list.
 */
export const TAG_KEYS: readonly TagKeySpec[] = [
  {
    cardinality: "one",
    key: "platform",
    meaning: "where the row's outward act lands; which native preview a card draws",
    source: "declared",
    values: {
      allowed: ["slack", "linear", "github", "gmail", "notion", "calendar", "drive", "vanta", "none"],
      kind: "enum",
    },
  },
  {
    cardinality: "one",
    key: "audience",
    meaning: "who the outward act reaches; person and channel park on the owner's queue",
    source: "declared",
    values: {
      allowed: [OWNER_AUDIENCE, "team", "person", "channel"],
      kind: "enum",
    },
  },
  {
    cardinality: "many",
    key: "workstream",
    meaning: "which of the owner's workstreams the row relates to; a row may relate to several",
    newValueNeedsFlag: true,
    source: "declared",
    values: { kind: "pattern", pattern: KEBAB, shape: "a kebab-case workstream name, e.g. iso-certification" },
  },
  {
    cardinality: "many",
    key: "substream",
    meaning: "which milestone of a workstream the row serves, named with its parent workstream as a prefix",
    newValueNeedsFlag: true,
    source: "declared",
    values: {
      kind: "pattern",
      pattern: KEBAB,
      shape: "a kebab-case milestone name prefixed with its workstream, e.g. iso-certification-policy-acceptance",
    },
  },
  {
    cardinality: "many",
    key: "area",
    meaning: "which area the row's work covers; a workstream covers every area its rows do",
    newValueNeedsFlag: true,
    source: "declared",
    values: { kind: "pattern", pattern: KEBAB, shape: "a kebab-case area name, e.g. security or platform" },
  },
  {
    cardinality: "one",
    key: "impact",
    meaning: "how much rides on the row — ISO certification is high",
    source: "declared",
    values: { allowed: ["critical", "high", "medium", "low"], kind: "enum" },
  },
  {
    cardinality: "one",
    key: "controls-resolved",
    meaning:
      "how many failing compliance controls the row's act resolves — what ranks the owner's priority cards, most first (`src/waiting/queueOrder.ts`)",
    source: "declared",
    values: { kind: "pattern", pattern: COUNT, shape: "a whole number of controls, e.g. 8" },
  },
  {
    cardinality: "one",
    key: "effort",
    meaning: "how big the row's work is, Linear's t-shirt estimate — what a Queue card's effort line reads",
    source: "declared",
    values: { allowed: ["xs", "s", "m", "l", "xl"], kind: "enum" },
  },
  {
    cardinality: "many",
    key: "pr",
    meaning: "which pull requests the row is about",
    source: "declared",
    values: { kind: "pattern", pattern: PULL_REQUEST, shape: "owner/repo#N, a repository and its pull request number" },
  },
  {
    cardinality: "one",
    key: "preapproved",
    meaning: "a class of act already greenlit, so an ask for permission on it is a defect",
    source: "declared",
    values: { allowed: ["cassette-recording"], kind: "enum" },
  },
  {
    cardinality: "many",
    key: "steer-hatch",
    meaning:
      "a gate the owner's explicit steer on this row released, written by the verb that released it (`vulnerability-fix topup --steer-row`)",
    source: "declared",
    values: { allowed: ["vulnerability-fix-topup-gate"], kind: "enum" },
  },
  {
    cardinality: "one",
    key: "context",
    meaning:
      "which console context owns the row — the team's work or this instance's own; the only thing past repo that places one",
    source: "declared",
    values: { allowed: ["work", "slopweaver"], kind: "enum" },
  },
  {
    cardinality: "many",
    key: NEEDS_KEY,
    meaning:
      "an integration the row's work cannot be done without; while this install stores none of its credentials the row is held, never offered (`./integrationNeeds.ts`)",
    source: "declared",
    values: { allowed: INTEGRATION_NAMES, kind: "enum" },
  },
  {
    cardinality: "one",
    derivedFrom: "the row's kind:",
    key: "kind",
    meaning: "doc, ask or tag",
    source: "derived",
    values: { allowed: ["doc", "ask", "tag"], kind: "enum" },
  },
  {
    cardinality: "one",
    derivedFrom: "the row's priority: (or its kind's default)",
    key: "priority",
    meaning: "the band the row ranks in",
    source: "derived",
    values: { allowed: ["p0", "p1", "p2", "p3"], kind: "enum" },
  },
  {
    cardinality: "one",
    derivedFrom: "the draft its open question offers (`handover ask --action`)",
    key: "reply",
    meaning: "whether the row's open question carries a message drafted as the owner",
    readsJournal: true,
    source: "derived",
    values: { allowed: ["drafted", "none"], kind: "enum" },
  },
  {
    cardinality: "one",
    derivedFrom: "the row's origin:",
    key: "origin",
    meaning: "finding, when a session registered it from its own observation",
    source: "derived",
    values: { allowed: ["finding"], kind: "enum" },
  },
  {
    cardinality: "one",
    derivedFrom: "the row's repo: (`handover set-repo`)",
    key: "repo",
    meaning: "the checkout the row's work is cut from, by its directory name",
    source: "derived",
    // Any one path segment: the value is DERIVED from a real checkout path, so the rule describes what that yields
    // rather than narrowing it — a narrower one let `/tmp/my repo` derive a value its own key refused.
    values: { kind: "pattern", pattern: /^[^/]+$/u, shape: "a checkout's directory name" },
  },
  {
    cardinality: "one",
    derivedFrom: "the row's run journal (`handover start`, `ask`, `finish`, `close`, `abandon`)",
    key: "run",
    readsJournal: true,
    // The journal's lifecycle, NEVER a liveness claim: an open cycle outlives a session that died holding it, and
    // `handover reap` orphans one only on a PROVEN death, never a Codex writer's (`./reap.ts`, `./writerLiveness.ts`).
    meaning:
      "where the row's run journal stands: open, waiting on the owner, orphaned by a dead session, ended, or none",
    source: "derived",
    values: { allowed: ["open", "waiting", "orphaned", "ended", "none"], kind: "enum" },
  },
];

/** The furthest a misspelt key may be from a real one and still be named as the likely intent. */
const NEAREST_KEY_DISTANCE = 2;

/**
 * The spec for one key, or `undefined` when the registry defines none.
 *
 * @param key the key as written
 * @returns its spec
 */
export function tagKeySpec({ key }: { key: string }): TagKeySpec | undefined {
  return TAG_KEYS.find((spec) => spec.key === key);
}

/** The defined key closest to a misspelt one, when one is close enough to name. */
function nearestKey({ key }: { key: string }): string | undefined {
  const ranked = TAG_KEYS.map((spec) => ({ distance: levenshteinDistance({ left: key, right: spec.key }), spec }))
    .filter((candidate) => candidate.distance <= NEAREST_KEY_DISTANCE)
    .toSorted((left, right) => left.distance - right.distance);
  return ranked[0]?.spec.key;
}

/**
 * The spec for a key, or the refusal naming the nearest real one.
 *
 * @returns the spec, or the unknown-key refusal
 */
export function knownKey({ key }: { key: string }): Result<TagKeySpec, RowTagError> {
  const spec = tagKeySpec({ key });
  if (spec === undefined) {
    return err(
      RowTagErrors.unknownKey({
        key,
        known: TAG_KEYS.map((each) => each.key).join(", "),
        nearest: nearestKey({ key }),
      }),
    );
  }
  return ok(spec);
}

/** Whether a value satisfies its key's rule, as the refusal would describe the rule when it does not. */
function valueProblem({ spec, value }: { spec: TagKeySpec; value: string }): RowTagError | undefined {
  const rule = spec.values;
  if (rule.kind === "enum") {
    return rule.allowed.includes(value)
      ? undefined
      : RowTagErrors.badValue({ allowed: rule.allowed.join(" | "), key: spec.key, value });
  }
  return rule.pattern.test(value) ? undefined : RowTagErrors.badValue({ allowed: rule.shape, key: spec.key, value });
}

/**
 * Whether a key — and a value, when one is named — is something a row could carry: the check a FILTER term takes.
 * Unlike {@link writableAssignment} it accepts a derived key, because `kind=ask` is a question a reader may ask
 * even though no session may write it. An unknown key is refused naming the nearest real one, and a value outside
 * its key's rule is refused naming the rule, so a typo in a filter is an error rather than an empty board.
 *
 * @param key the key as written
 * @param value the value, or `undefined` for a term about the key alone
 * @returns the key's spec, or why the term could never match a tag
 */
export function filterableTerm({
  key,
  value,
}: {
  key: string;
  value: string | undefined;
}): Result<TagKeySpec, RowTagError> {
  const padded = [key, value].find((text) => text !== undefined && text !== text.trim());
  if (padded !== undefined) {
    return err(RowTagErrors.padded({ text: padded }));
  }
  return knownKey({ key }).andThen((spec) => {
    const problem = value === undefined ? undefined : valueProblem({ spec, value });
    return problem === undefined ? ok(spec) : err(problem);
  });
}

/**
 * Whether a key's value on a row is read off the row's run journal: every declared key, and a derived one marked
 * {@link TagKeySpec.readsJournal}. A journal that could not be completely read can leave exactly these wrong.
 *
 * @param spec the key
 * @returns true when an incomplete journal can change what the row carries under this key
 */
export function readsJournal({ spec }: { spec: TagKeySpec }): boolean {
  return spec.source === "declared" || spec.readsJournal === true;
}

/** Split `key=value` at its FIRST `=`, or `undefined` when either half is empty or there is no `=`. */
function splitPair({ text }: { text: string }): TagAssignment | undefined {
  const at = text.indexOf("=");
  if (at <= 0 || at === text.length - 1) {
    return undefined;
  }
  return { key: text.slice(0, at), value: text.slice(at + 1) };
}

/**
 * Read one `key=value` a session wants to WRITE, refusing anything the registry would not store.
 *
 * @param text the pair as typed, e.g. `platform=slack`
 * @returns the assignment, or why it cannot be written
 */
export function parseTagAssignment({ text }: { text: string }): Result<TagAssignment, RowTagError> {
  const pair = splitPair({ text: text.trim() });
  if (pair === undefined) {
    return err(RowTagErrors.malformed({ text }));
  }
  return writableAssignment({ assignment: pair }).map(() => pair);
}

/**
 * Whether an assignment may be written: a defined, DECLARED key with a value its rule allows.
 *
 * The one validator the verb, the journal schema and the fold share, so the three cannot disagree about what a
 * well-formed tag is.
 *
 * @param assignment the key and value
 * @returns the key's spec, or why it cannot be written
 */
export function writableAssignment({ assignment }: { assignment: TagAssignment }): Result<TagKeySpec, RowTagError> {
  // Judged here rather than beside it, so the writer and the fold hold ONE whitespace rule by construction: a
  // padded string is what the journal keeps, and no filter would ever match it.
  const padded = [assignment.key, assignment.value].find((text) => text !== text.trim());
  if (padded !== undefined) {
    return err(RowTagErrors.padded({ text: padded }));
  }
  if (assignment.value.includes(TAG_LIST_SEPARATOR)) {
    return err(RowTagErrors.separatorInValue({ key: assignment.key, separator: TAG_LIST_SEPARATOR }));
  }
  return knownKey({ key: assignment.key }).andThen((spec) => {
    if (spec.source === "derived") {
      return err(RowTagErrors.derivedKey({ from: derivedFromOf({ spec }), key: spec.key }));
    }
    const problem = valueProblem({ spec, value: assignment.value });
    return problem === undefined ? ok(spec) : err(problem);
  });
}

/**
 * The field a derived key reads, as a refusal names it.
 *
 * @returns the key's `derivedFrom`, or a generic phrase when the spec names none
 */
export function derivedFromOf({ spec }: { spec: TagKeySpec }): string {
  if (spec.derivedFrom === undefined) {
    return "a field the row already carries";
  }
  return spec.derivedFrom;
}
