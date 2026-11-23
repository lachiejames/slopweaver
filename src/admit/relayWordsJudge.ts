/**
 * The relay-words guard's judgement: given a talk relay row before and after one `Write` or `Edit`, did the write
 * reword what the row holds of the owner's words — and if so, the refusal.
 *
 * MEASURED, why it exists: 38 rows `talk-<id>.md` had their `summary`, `ownerWords`, heading and Work-to-dispatch
 * paragraph replaced by plain `Write` calls, and nothing refused. The owner ruled a relay row keeps the owner's words
 * and is never reworded.
 *
 * ## What it refuses, and what it never touches
 *
 * Only a change to a PROTECTED part (`./relayWordsProjection.ts`) is judged, and a changed part passes only when it
 * lands on the source of truth:
 *
 * - the anchor never moves — it is which of the owner's words the row names;
 * - the quote group must equal the record the anchor's turn holds now, exactly what `handover quote --check`
 *   computes (`recordOfRead` over `resolveHisWords`, compared by `sameHisWords`); a further steer's group is written
 *   by `handover quote --add-steer` and never by hand;
 * - the summary must rebuild to the digest the turn stored (`./relayWordsDigest.ts`);
 * - the heading and the ask paragraph must each read exactly the summary;
 * - the offer section must be exactly what the turn's offer renders as (`relayOfferSection`), or absent when the turn
 *   carried none.
 *
 * Everything else on the row — status, settlement, priority, any hand note — is never judged, and a row that was
 * already damaged before the write is not refused for that: only a part the write itself changed is held to its
 * source. So a restore by hand passes, and a status edit on a damaged row passes.
 *
 * ## Residue, stated rather than discovered
 *
 * A `PreToolUse` hook sees the payload, not the write: between this read and the tool's write another process may
 * change the file, and no lock spans the tool call. A `Bash` write (`sed -i`, a redirect) is not a `Write` or
 * `Edit` and is not seen here at all. A summary whose relay carried a candidate ruling cannot be rebuilt
 * (`./relayWordsDigest.ts`), so restoring one takes the hatch.
 *
 * Pure: projections, a record and a turn in; defects out.
 */

import { type HisWordsRecord, sameHisWords } from "../handover/hisWords.js";
import { ESCAPE_HATCHES } from "../hatch/registry.js";
import { hatchRefusal } from "../hatch/render.js";
import type { EscapeHatch } from "../hatch/types.js";
import { parseRelayAnchor } from "../talk/relayDraft.js";
import { relayOfferSection } from "../talk/relayOfferRow.js";
import type { TurnRecord } from "../talk/relayStore.js";
import { summaryRebuilds, workspaceCandidates } from "./relayWordsDigest.js";
import { type RelayRowProjection, relayRowProjection } from "./relayWordsProjection.js";

/** This guard's own register row — the refusal text is the register's, never this module's. */
const HATCH: EscapeHatch = ESCAPE_HATCHES.find((hatch) => hatch.id === "relay-words")!; // registry-owned

/** Which protected parts one write changed. */
interface RelayWordsChanges {
  readonly anchor: boolean;
  readonly group: boolean;
  readonly steers: boolean;
  readonly summary: boolean;
  readonly heading: boolean;
  readonly askParagraph: boolean;
  readonly offer: boolean;
}

/** What one write needs: nothing, or a judgement of the parts it changed against the turn its anchor names. */
export type RelayWordsPlan =
  | { readonly kind: "allow" }
  | {
      readonly kind: "judge";
      readonly anchor: string;
      readonly turnId: string;
      readonly post: RelayRowProjection;
      readonly prior: RelayRowProjection;
      readonly changes: RelayWordsChanges;
    };

/** Which protected parts differ between two projections of one row. */
function changesBetween({ prior, post }: { prior: RelayRowProjection; post: RelayRowProjection }): RelayWordsChanges {
  return {
    anchor: prior.anchor !== post.anchor,
    askParagraph: prior.askParagraph !== post.askParagraph,
    group: prior.groupValues !== post.groupValues,
    heading: prior.heading !== post.heading,
    offer: prior.offerBlock !== post.offerBlock,
    steers: prior.steerValues !== post.steerValues,
    summary: prior.summary !== post.summary,
  };
}

/**
 * What one write to a board row needs judged. A row that is not a talk relay row before the write — a new file, any
 * other row — needs nothing; nor does a write that leaves every protected part as it was, which is decided with no
 * read beyond the row itself.
 *
 * @param path the row's path
 * @param priorText the row as it is now
 * @param postText the row as the write would leave it
 * @returns the plan
 */
export function planRelayWordsCheck({
  path,
  priorText,
  postText,
}: {
  path: string;
  priorText: string;
  postText: string;
}): RelayWordsPlan {
  const prior = relayRowProjection({ path, text: priorText });
  const anchor = prior.anchor;
  // Only a canonical `talk:<turnId>` spelling names a turn file; the resolver itself reads no other.
  if (anchor === undefined || parseRelayAnchor({ text: anchor }) !== anchor) {
    return { kind: "allow" };
  }
  const post = relayRowProjection({ path, text: postText });
  const changes = changesBetween({ post, prior });
  if (!Object.values(changes).some((changed) => changed)) {
    return { kind: "allow" };
  }
  return { anchor, changes, kind: "judge", post, prior, turnId: anchor.slice("talk:".length) };
}

/**
 * Which sources a plan's judgement reads, so a caller reads nothing the judgement will not use.
 *
 * @param plan a plan that needs judging
 * @returns whether the anchor's record and the turn file are needed
 */
export function relayWordsSources({ plan }: { plan: Extract<RelayWordsPlan, { kind: "judge" }> }): {
  readonly record: boolean;
  readonly turn: boolean;
} {
  return { record: plan.changes.group, turn: plan.changes.summary || plan.changes.offer };
}

/** Why a changed quote group does not stand: it must be a record equal to the one the anchor's turn holds now. */
function groupDefect({ post, record }: { post: RelayRowProjection; record: HisWordsRecord | undefined }): string[] {
  const group = post.group;
  const stands =
    record !== undefined &&
    (group.kind === "held" || group.kind === "unread") &&
    sameHisWords({ read: record, stored: group });
  if (stands) {
    return [];
  }
  return ["the ownerWords quote no longer equals what the relay turn holds — `handover quote --apply` writes it"];
}

/** Why a changed summary does not stand: it must rebuild to the digest the turn stored. */
function summaryDefect({
  plan,
  turn,
}: {
  plan: Extract<RelayWordsPlan, { kind: "judge" }>;
  turn: TurnRecord | undefined;
}): string[] {
  const summary = plan.post.summary;
  if (turn === undefined) {
    return ["the summary changed and the relay turn that would prove it unchanged cannot be read"];
  }
  const workspaces = workspaceCandidates({ stated: [plan.prior.workspace, plan.post.workspace] });
  if (summary !== undefined && summaryRebuilds({ summary, turn, workspaces })) {
    return [];
  }
  return [
    "the summary no longer rebuilds to the digest the relay turn stored, so it is not the owner's words as relayed",
  ];
}

/** Why a changed offer section does not stand: it must render exactly as the turn's offer, or be absent with none. */
function offerDefect({
  plan,
  turn,
}: {
  plan: Extract<RelayWordsPlan, { kind: "judge" }>;
  turn: TurnRecord | undefined;
}): string[] {
  if (turn === undefined) {
    return ["the offer section changed and the relay turn that holds the offer cannot be read"];
  }
  let expected: string | undefined;
  if (turn.offered !== undefined) {
    expected = relayOfferSection({ anchor: plan.anchor, offered: turn.offered });
  }
  if (plan.post.offerBlock === expected) {
    return [];
  }
  return ["the running-list offer section no longer reads the voice's offer exactly as the relay turn holds it"];
}

/** Why a changed heading or ask paragraph does not stand: each must read exactly the summary. */
function bodyDefects({ plan }: { plan: Extract<RelayWordsPlan, { kind: "judge" }> }): string[] {
  const { changes, post } = plan;
  const defects: string[] = [];
  if (changes.heading && post.heading !== post.summary) {
    defects.push("the heading no longer reads exactly the summary");
  }
  if (changes.askParagraph && post.askParagraph !== post.summary) {
    defects.push("the paragraph under the first section heading no longer reads exactly the summary");
  }
  return defects;
}

/**
 * Every protected part one write changed that does not land on its source of truth.
 *
 * @param plan a plan that needs judging
 * @param record the record the anchor's turn holds now, `undefined` when the plan did not need it
 * @param turn the relay turn, `undefined` when the plan did not need it or it could not be read
 * @returns one sentence per defect, empty when the write stands
 */
export function relayWordsDefects({
  plan,
  record,
  turn,
}: {
  plan: Extract<RelayWordsPlan, { kind: "judge" }>;
  record: HisWordsRecord | undefined;
  turn: TurnRecord | undefined;
}): readonly string[] {
  const { changes } = plan;
  const defects: string[] = [];
  if (changes.anchor) {
    defects.push(`the anchor moved off ${plan.anchor}, which changes whose words the row names`);
  }
  if (changes.group) {
    defects.push(...groupDefect({ post: plan.post, record }));
  }
  if (changes.steers) {
    defects.push("a further steer's quote changed — `handover quote --add-steer` writes those");
  }
  if (changes.summary) {
    defects.push(...summaryDefect({ plan, turn }));
  }
  if (changes.offer) {
    defects.push(...offerDefect({ plan, turn }));
  }
  defects.push(...bodyDefects({ plan }));
  return defects;
}

/**
 * The refusal for a write that rewords a relay row, or `undefined` when it does not.
 *
 * @param path the row's path, named in the refusal
 * @param defects what {@link relayWordsDefects} found
 * @returns the four-line refusal, or `undefined` to allow
 */
export function relayWordsRefusal({ path, defects }: { path: string; defects: readonly string[] }): string | undefined {
  if (defects.length === 0) {
    return undefined;
  }
  return hatchRefusal({ detail: `${path} — ${defects.join("; ")}`, hatch: HATCH });
}
