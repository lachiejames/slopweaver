/**
 * MENTIONING a person in a Linear body — the token a caller writes, the markup Linear renders, and the
 * refusal that stands between them.
 *
 * ## The markup is MEASURED, not chosen
 *
 * Linear's own mention markup in a markdown body is `@[label](<linear-user-id>)`. Measured on the ingested
 * corpus — reproduce with:
 *
 * ```
 * grep -ho '@\[[^]]*\]([0-9a-f-]\{36\})' $SLOPWEAVER_HOME/corpus/bronze/linear/*.jsonl | wc -l
 * ```
 *
 * 85 occurrences across 8 distinct people, every one of them a bare user UUID in the target. NONE uses a
 * profile URL, so the URL form that looks plausible is not what Linear writes and is not what this emits.
 *
 * **The LABEL is cosmetic; the id is the mention.** Measured live: a body sent as
 * `@[ada.owner](c4e7371f-…)` came back from Linear stored as `@ada.owner` and RENDERED as
 * `@Ada Owner` — Linear resolves the display name from the id and discards what the label said. So the
 * label cannot make a mention point somewhere else, and a wrong one is a cosmetic defect in the sent bytes
 * rather than a mis-notification. It is still taken from the roster rather than the caller
 * ({@link ./personIndex.js linearLabelIndex}), because the bytes are what a reviewer reads in a dry run.
 *
 * ## Why the caller writes `@{key}` and never the markup
 *
 * The markup names a person by an opaque id, which is precisely the value a human cannot check by eye. So
 * the body carries `@{cj}` — a roster KEY — and this module resolves it, exactly as `./bareRefLinks.ts`
 * resolves `#N` into a link rather than making the caller paste one. `./schema.ts` REFUSES raw mention
 * markup in every prose field for the same reason it refuses a `+++` line: it is structure the door owns.
 *
 * The token is `@{…}` because it appears ZERO times in the ingested corpus (same grep, `@{[^}]*}`), so no
 * real body has ever wanted it literally, and braces carry no markdown meaning of their own.
 *
 * ## What a refusal owes the caller
 *
 * Naming the candidates, with their ids. A mention that will not resolve is usually a person the roster
 * knows under a different name, or two people who answer to the same one — and "no exact match" leaves the
 * caller with nothing to do but guess. `./personIndex.ts`'s candidate search is name-wide precisely so this
 * refusal can say WHO it might have meant; the caller then picks one with `--mention-id`, which is the
 * escape for an id they have verified live rather than a way around the roster.
 */

import { absentAsEmpty } from "#lib/absent.js";
import {
  type DeriveFreshness,
  freshnessAction,
  freshnessReason,
  SILVER_ROSTER_ARTEFACT,
} from "../../silver/derive/freshness.js";
import type { DerivedRoster } from "../../silver/derivedRoster.js";
import { isUnpinnedMiss, markClaims, type RoutedMentionLookup, routedLookupRefusals } from "../../silver/heardAs.js";
import type { IdentityRecord } from "../../silver/identity.js";
import {
  buildLinearPersonIndex,
  type LinearPersonCandidate,
  type LinearPersonOrigin,
  type LinearPersonTarget,
  type LinearRosterReport,
  linearLabelIndex,
  linearPersonCandidates,
  linearRosterReport,
} from "./personIndex.js";

/**
 * The token a body writes to mention someone: `@{` + a roster key + `}`.
 *
 * The key may not contain a brace or a newline, so an unclosed token cannot swallow the rest of a paragraph
 * looking for its closer.
 *
 * A FRESH regex per call rather than a shared constant: a `g` regex carries `lastIndex`, and a single shared
 * one is a cross-call state channel between the collector and the rewriter — the sort of bug that shows up
 * as one mention silently not rewritten, in one body, depending on what ran before it.
 *
 * @returns the global token matcher, its capture group being the key
 */
export function mentionToken(): RegExp {
  return /@\{([^{}\n\r]+)\}/g;
}

/** Linear's own mention markup, which a caller may never hand-write — see the module doc. */
export const RAW_MENTION_MARKUP = /@\[[^\]\n]*\]\([^)\n]*\)/;

/** A Linear user id, as `--mention-id` must spell it: the UUID Linear's own API issues. */
const LINEAR_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which layer vouched for a mention: the two roster layers, the MEMBER index each provider's own member
 * list writes, or an id the caller verified live.
 *
 * `member` sits above `derived` because it is not an inference. A member row is Linear's own answer to "who
 * is user `<uuid>`", captured by hydration; a derived person is this repository's guess at which accounts
 * are the same human. `heard-as` is the member index answering for the key a heard-as pin in the identity roster
 * sent a token to (`../../silver/heardAs.ts`).
 */
type LinearMentionOrigin = LinearPersonOrigin | "member" | "heard-as" | "verified";

/** One resolved mention: the Linear user id to notify, the label to render, and who vouched for it. */
export interface LinearMentionTarget {
  readonly linearId: string;
  readonly label: string;
  readonly origin: LinearMentionOrigin;
}

/** The resolution for one write: what resolved, what did not, and who the misses might have meant. */
export interface LinearMentionResolution {
  readonly resolved: ReadonlyMap<string, LinearMentionTarget>;
  readonly roster: LinearRosterReport;
  /** The requested keys that name a HELD candidate — unresolvable BY DESIGN, and worth saying so. */
  readonly heldRequested: readonly string[];
  /** For each key that did NOT resolve, who it might have meant. Never consulted to resolve anything. */
  readonly candidates: ReadonlyMap<string, readonly LinearPersonCandidate[]>;
  /**
   * What the member index concluded about each requested key. A REFUSAL here is terminal for that key: the
   * derived layer is not consulted after it, because the whole reason the member index exists is that it
   * can see people derive cannot, and letting an inference overrule it would restore the failure this layer
   * removes.
   */
  readonly memberLookups: ReadonlyMap<string, RoutedMentionLookup>;
}

/**
 * Every mention key one markdown string names, in first-appearance order.
 *
 * @param text the markdown text
 * @returns each distinct key, once
 */
export function mentionKeysOfText({ text }: { text: string }): readonly string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(mentionToken())) {
    const key = match[1]!.trim();
    if (key.length > 0 && !keys.includes(key)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Parse a `--mention-id` value: `key=<linear-user-id>`, comma-separated.
 *
 * The id is checked against Linear's UUID shape rather than accepted as any string, and that is not
 * tidiness: whatever is passed here goes straight into the rendered markup with no roster to contradict it,
 * so a value that is not an id would be a caller-supplied string written into someone's mention.
 *
 * @param raw the flag's value, or undefined when it was not given
 * @returns the verified key → id map, plus one error line per malformed pair
 */
export function parseVerifiedMentionIds({ raw }: { raw: string | undefined }): {
  readonly verified: ReadonlyMap<string, string>;
  readonly errors: readonly string[];
} {
  const verified = new Map<string, string>();
  const errors: string[] = [];
  if (raw === undefined) {
    return { errors, verified };
  }
  for (const pair of raw.split(",").map((part) => part.trim())) {
    if (pair.length === 0) {
      continue;
    }
    const split = pair.indexOf("=");
    const key = split === -1 ? "" : pair.slice(0, split).trim();
    const id = split === -1 ? "" : pair.slice(split + 1).trim();
    if (key.length === 0 || id.length === 0) {
      errors.push(`--mention-id takes \`key=<linear-user-id>\` pairs, comma-separated; got ${JSON.stringify(pair)}`);
      continue;
    }
    if (!LINEAR_USER_ID.test(id)) {
      errors.push(
        `--mention-id ${JSON.stringify(key)} is not a Linear user id: ${JSON.stringify(id)}. It must be the ` +
          "UUID Linear itself issues — `slopweaver linear states --team <key>` prints one per member.",
      );
      continue;
    }
    verified.set(key, id.toLowerCase());
  }
  return { errors, verified };
}

/**
 * Resolve every mention key a body names, against both roster layers and the caller's verified ids.
 *
 * A verified id WINS over the roster, and deliberately so: it is the escape for the case this door was built
 * in — a roster that cannot be rebuilt, so the only current truth is what a human just read off Linear
 * itself. It is narrower than it looks, because {@link parseVerifiedMentionIds} has already refused anything
 * that is not a Linear user id.
 *
 * @param derived the derived roster
 * @param overrides the human override roster
 * @param freshness whether the derived roster still reflects what has been ingested
 * @param keys the mention keys the body names, in first-appearance order
 * @param verified the `--mention-id` ids the caller checked live, keyed by mention key
 * @returns what resolved, the roster state behind it, and the candidates for whatever did not
 */
export function resolveLinearMentions({
  derived,
  overrides,
  freshness,
  keys,
  verified = new Map<string, string>(),
  memberLookups: givenLookups = new Map<string, RoutedMentionLookup>(),
}: {
  derived: DerivedRoster;
  overrides: readonly IdentityRecord[];
  freshness: DeriveFreshness;
  keys: readonly string[];
  verified?: ReadonlyMap<string, string>;
  memberLookups?: ReadonlyMap<string, RoutedMentionLookup>;
}): LinearMentionResolution {
  const { index, collisions } = buildLinearPersonIndex({ derived, overrides });
  const memberLookups = markClaims({ keys, lookups: givenLookups, records: overrides });
  const labels = linearLabelIndex({ derived, overrides });
  const resolved = new Map<string, LinearMentionTarget>();
  const candidates = new Map<string, readonly LinearPersonCandidate[]>();
  for (const key of keys) {
    const target = linearTargetFor({ index, key, labels, memberLookups, verified });
    // The id is interpolated into `@[label](<id>)` after the form's checks ran, so a roster or member row
    // holding anything but Linear's UUID could open raw HTML there: it resolves nothing.
    if (target !== undefined && LINEAR_USER_ID.test(target.linearId)) {
      resolved.set(key, target);
      continue;
    }
    // A member-index REFUSAL already names exactly who it saw and why it declined, so a second list of
    // roster candidates under it would be noise rather than help.
    if (isUnpinnedMiss({ lookup: memberLookups.get(key) })) {
      candidates.set(key, linearPersonCandidates({ derived, key, overrides }));
    }
  }
  return {
    candidates,
    heldRequested: keys.filter((key) => !resolved.has(key) && derived.heldPersonIds.has(key)),
    memberLookups,
    resolved,
    roster: linearRosterReport({ collisions, derived, freshness, index }),
  };
}

/**
 * The target for one mention key, applying the layer order: an id the caller verified live, then the member
 * index, then the roster index (whose own layering already puts the human roster above `derive`).
 *
 * A member-index refusal stops the walk. The one thing that may still overrule it is a key a human confirmed
 * in the identity roster, and that is why `--mention-id` and the override layer are both checked around it
 * rather than after it: every refusal this file emits has to keep a documented way out.
 */
function linearTargetFor({
  verified,
  memberLookups,
  index,
  labels,
  key,
}: {
  verified: ReadonlyMap<string, string>;
  memberLookups: ReadonlyMap<string, RoutedMentionLookup>;
  index: ReadonlyMap<string, LinearPersonTarget>;
  labels: ReadonlyMap<string, string>;
  key: string;
}): LinearMentionTarget | undefined {
  const verifiedId = verified.get(key);
  if (verifiedId !== undefined) {
    return { label: labels.get(verifiedId) ?? key, linearId: verifiedId, origin: "verified" };
  }
  const hit = index.get(key);
  const fromRoster =
    hit === undefined
      ? undefined
      : { label: labels.get(hit.linearId) ?? key, linearId: hit.linearId, origin: hit.origin };
  if (hit?.origin === "override") {
    return fromRoster;
  }
  const lookup = memberLookups.get(key) ?? { kind: "unknown" };
  if (lookup.kind === "resolved") {
    const origin = lookup.heardAsTarget === undefined ? "member" : "heard-as";
    return { label: lookup.match.person.displayName, linearId: lookup.nativeId, origin };
  }
  return isUnpinnedMiss({ lookup }) ? fromRoster : undefined;
}

/** One candidate as a refusal renders it: who they are, and the id that would address them. */
function candidateLine({ candidate }: { candidate: LinearPersonCandidate }): string {
  const address =
    candidate.linearId === undefined ? "no Linear account — cannot be mentioned" : `linear:${candidate.linearId}`;
  const email = candidate.email === undefined ? "" : ` <${candidate.email}>`;
  return `    ${candidate.name}${email} — ${address}  [${candidate.personId}]`;
}

/** The candidate block appended to a refusal, or nothing when the roster knows no-one by that key. */
function candidateLines({
  key,
  candidates,
}: {
  key: string;
  candidates: readonly LinearPersonCandidate[];
}): readonly string[] {
  if (candidates.length === 0) {
    return [];
  }
  const addressable = candidates.filter((candidate) => candidate.linearId !== undefined);
  return [
    `  ${String(candidates.length)} person(s) answer to ${JSON.stringify(key)}:`,
    ...candidates.map((candidate) => candidateLine({ candidate })),
    addressable.length === 0
      ? "  none of them has a Linear account, so nothing here can be mentioned — check the person is in Linear at all."
      : `  pick one with \`--mention-id ${key}=<linear-user-id>\`, once you have opened their Linear profile and confirmed it is them.`,
  ];
}

/**
 * Why a mention could not be resolved, in terms of the roster's actual state — and WHO it might have meant.
 *
 * The candidate block is the half that makes this actionable. "No exact match" is true and useless when the
 * cause is two people sharing a name or one person the roster has never joined to a Linear account: each of
 * those has a different fix, and neither is visible without being told who is in the running.
 *
 * @param resolution the resolution the keys came from
 * @param keys the mention keys the body named, in first-appearance order
 * @returns one or more refusal lines per unresolved key, or empty when every mention resolved
 */
export function linearMentionRefusals({
  resolution,
  keys,
}: {
  resolution: LinearMentionResolution;
  keys: readonly string[];
}): readonly string[] {
  const missing = keys.filter((key) => !resolution.resolved.has(key));
  if (missing.length === 0) {
    return [];
  }
  const { roster } = resolution;
  const held = new Set(resolution.heldRequested);
  const collided = new Set(roster.collisions);
  const lines = missing.flatMap((key) => {
    // The member index saw someone and declined to hand them over — that reason is the specific one, and it
    // displaces every generic roster-state line below it.
    const fromMembers = routedLookupRefusals({
      key,
      lookup: resolution.memberLookups.get(key) ?? { kind: "unknown" },
      source: "linear",
    });
    if (fromMembers.length > 0) {
      return fromMembers;
    }
    const candidates = absentAsEmpty({ value: resolution.candidates.get(key) });
    if (held.has(key)) {
      return [
        `cannot mention ${JSON.stringify(key)}: that identity link is HELD — derive PROPOSED it but nothing ` +
          "has confirmed it, and a held link may never address a person. Confirm it in " +
          "the identity roster (slopweaver identity roster replace) to make it mentionable.",
        ...candidateLines({ candidates, key }),
      ];
    }
    if (collided.has(key)) {
      return [
        `cannot mention ${JSON.stringify(key)}: two different people claim that key, so it was DROPPED ` +
          "rather than resolved to whichever came first.",
        ...candidateLines({ candidates, key }),
      ];
    }
    return [
      `cannot mention ${JSON.stringify(key)}: no exact match among the ${String(roster.addressableKeys)} ` +
        "addressable keys (canonical person id, Linear user id, Linear handle, `@handle`, or the email on " +
        "the Linear identity). A mention is exact-match only — never guessed.",
      ...candidateLines({ candidates, key }),
    ];
  });
  return [
    ...lines,
    ...(roster.freshness.kind === "fresh" || !dependsOnDerive({ keys: missing, resolution })
      ? []
      : [
          `${freshnessReason({ artefact: SILVER_ROSTER_ARTEFACT, freshness: roster.freshness })} — run \`${SILVER_ROSTER_ARTEFACT.command}\``,
        ]),
  ];
}

/**
 * Whether any of these keys still RESTS on the derived roster — the test that decides whether a stale
 * `derive` can change this write's outcome at all.
 *
 * A key the member index settled has a reason of its own and a fix of its own, and appending "the roster is
 * stale, run derive" to it sends the reader off to a command that refuses under the heap ceiling and would
 * not have helped anyway. Measured: four Linear comments posted correctly while printing that
 * exact line, which reads as a failure and is not.
 */
function dependsOnDerive({
  keys,
  resolution,
}: {
  keys: readonly string[];
  resolution: LinearMentionResolution;
}): boolean {
  return keys.some((key) => {
    return isUnpinnedMiss({ lookup: resolution.memberLookups.get(key) });
  });
}

/**
 * The refusal for a write whose mentions rest on a roster that is STILL not fresh after the consumer's
 * just-in-time refresh had its chance — the same third rule of the freshness contract the assignee gate
 * applies, and for the same reason.
 *
 * A key the caller supplied through `--mention-id` does not count as affected output: its id came from
 * Linear itself rather than from the roster, so a stale roster cannot make it wrong. A body whose mentions
 * are ALL verified that way therefore passes a stale roster, which is the whole point of the escape.
 *
 * A key the MEMBER index settled counts the same way, and for the same reason — its id came from Linear's
 * own member list. That is what makes `--mention-id` an escape hatch again rather than the routine path:
 * measured, every mention in four consecutive comments needed it, purely because the roster
 * behind them could not be rebuilt.
 *
 * @param resolution the mention resolution, carrying the post-refresh verdict
 * @param keys the mention keys this write asks to resolve
 * @returns the refusal lines, or empty when the write may proceed
 */
export function staleLinearMentionRefusals({
  resolution,
  keys,
}: {
  resolution: LinearMentionResolution;
  keys: readonly string[];
}): readonly string[] {
  // A mention the MEMBER index resolved is in the same position as a verified one: its id came from
  // Linear's own member list rather than from the derived roster, so a stale roster cannot make it wrong.
  const rosterBacked = keys.some((key) => {
    const origin = resolution.resolved.get(key)?.origin;
    const fromMembers = origin === "verified" || origin === "member" || origin === "heard-as";
    return !fromMembers && dependsOnDerive({ keys: [key], resolution });
  });
  const action = freshnessAction({
    affectsOutput: rosterBacked,
    artefact: SILVER_ROSTER_ARTEFACT,
    freshness: resolution.roster.freshness,
    // The consumer that produced this resolution already had its just-in-time chance
    // (`../../cli/commands/linear/wiring.ts`); reaching here still stale means the refusal arm.
    refreshAttempted: true,
  });
  return action.kind === "refuse" ? [action.line] : [];
}

/**
 * A run of line endings, `structuralEscapes.ts`'s `LINE_BREAK` class, backticks, angle brackets or quotes.
 * Spelled here rather than imported because that module imports {@link RAW_MENTION_MARKUP} from this one. Each
 * is folded rather than escaped because the rewrite also lands where a backslash escapes nothing. Inside an
 * authored code span a label's backtick would close the span and expose the `<!--` it was quoting,
 * and inside a tag the author left open, `<textarea title="@{x}`, a label's `"` closes the attribute and its
 * `\>` still closes the tag. With none of the five, inserted text can neither
 * leave a quoted attribute nor end a tag.
 */
const LABEL_FOLDS = /(?:\r\n|[\n\r\v\f\x85\p{Zl}\p{Zp}`<>"'])+/gu;

/** The characters that could end the label's brackets early. */
const LABEL_MARKUP = /[\\[\]]/gu;

/**
 * One resolved mention as Linear's own markup.
 *
 * The label is a display name read from a roster AFTER the form's structural checks ran, so whatever it holds
 * lands unchecked in the rendered bytes. A line ending could put a `+++` on its own line, closing a fold early,
 * so each run folds to one space, and so does a run of backticks, angle brackets or quotes, any
 * of which could open raw HTML that swallows every fold after it or finish a tag the author left open;
 * a `]` could end the label early, so a backslash and bracket are each backslash-escaped. Linear
 * re-resolves the name from the id and discards the label, so neither costs anything a reader sees, and a name
 * holding none of them renders byte for byte as before.
 *
 * @param target the resolved mention
 * @returns `@[label](<linear-user-id>)`, the label on one line with its markup folded or escaped
 */
export function renderLinearMention({ target }: { target: LinearMentionTarget }): string {
  const label = target.label.replace(LABEL_FOLDS, " ").replace(LABEL_MARKUP, "\\$&");
  return `@[${label}](${target.linearId})`;
}
