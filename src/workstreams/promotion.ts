/**
 * When a yes becomes a `standing` discovery workstream on the register, found again by its `mined:<id>` tag or by the
 * row that promoted it, so one candidate never becomes two workstreams; the workstream itself is `./candidateTile.ts`.
 *
 * Pure. `./reactionStore.ts` runs {@link planReactions} under the ledgers' lock and performs the two writes; where
 * each word lands on the register is `./placePick.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { CandidateCatalog } from "./candidateCatalog.js";
import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import {
  type Candidate,
  type Reaction,
  type ReactionRow,
  type ReactionVia,
  WORDS_WITH_A_REASON,
} from "./candidates.js";
import { minedTag } from "./candidateTile.js";
import type { DefinitionRow } from "./definitions.js";
import { type Marks, NO_PLACEMENT, type Placement } from "./placement.js";
import { endingFor, placePick } from "./placePick.js";
import { type Ending, emptyPlan, type HeldUnder, type PlanSoFar, type RowFields } from "./planSoFar.js";
import type { ReactionPick } from "./reactionBatch.js";
import { type CandidateState, latestReactions, standingState } from "./reactionFold.js";
import { slackChannelOf } from "./slackChannel.js";
import { typedWorkstreamDetail } from "./store/decode.js";
import type { WorkstreamAggregate, WorkstreamRegisterMeta } from "./store/types.js";

/**
 * The channel names the new workstreams need that the register does not already give: every Slack conversation their
 * entries cite, named as the candidates file names it. The register's own name for a conversation always stands.
 *
 * @param added the workstreams this batch adds
 * @param named the names the candidates file gives
 * @param channels the names the register already gives
 * @returns the names to add, by conversation id
 */
function channelsFor({
  added,
  channels,
  named,
}: {
  added: readonly WorkstreamAggregate[];
  channels: Readonly<Record<string, string>>;
  named: CandidateCatalog["channels"];
}): Readonly<Record<string, string>> {
  const needed: Record<string, string> = {};
  const hrefs = added.flatMap((one) => one.entries.flatMap((entry) => (entry.href === null ? [] : [entry.href])));
  for (const href of hrefs) {
    const channel = slackChannelOf({ href });
    const name = channel === undefined ? undefined : named[channel];
    if (channel !== undefined && name !== undefined && !Object.hasOwn(channels, channel)) {
      needed[channel] = name;
    }
  }
  return needed;
}

/**
 * The register document a person's FIRST kept candidate starts, when the store holds none yet — the onboarding case,
 * where the proposed candidates (the owner's stated outcomes, then any mined ones) are the first thing on the page. No
 * initiative is invented: a kept workstream is `standing`, outside them, and a person declares initiatives later. It
 * is only ever written beside the workstream the yes adds.
 *
 * @param catalog the candidates the first yes was given on, whose provenance the grouping states: the mining pass
 *   when there was one, else the owner's stated outcomes
 * @returns the register document to start
 */
export function firstRegister({ catalog }: { catalog: Pick<CandidateCatalog, "mined"> }): WorkstreamRegisterMeta {
  let anchor = "workstreams candidates, the owner's stated outcomes";
  let builtFrom = "the outcomes the owner stated, offered as candidates";
  if (catalog.mined !== null) {
    anchor = `workstreams candidates, mined ${catalog.mined.minedIso.slice(0, 10)}`;
    builtFrom = catalog.mined.minedFrom;
  }
  return {
    channels: {},
    grouping: {
      anchor,
      builtFrom,
      label: "Proposed from your words",
      why: "started by the first workstream you kept from the proposed candidates; no initiatives declared yet",
    },
    initiatives: [],
  };
}

/**
 * The tags a workstream carries: an outcome, standing or linked one's own; a local or closing one carries none.
 *
 * @returns the tags
 */
function tagsOf({ workstream }: { workstream: WorkstreamAggregate }): readonly string[] {
  const typed = typedWorkstreamDetail({ aggregate: workstream });
  if (typed.kind === "local" || typed.kind === "closing") {
    return [];
  }
  return typed.detail.tags;
}

/**
 * Whether a candidate is already a workstream on the register, so a yes promotes nothing: the workstream it was mined
 * as an echo of, one carrying its `mined:<id>` tag, the one an earlier yes's row names, or the one the owner's standing
 * same-as names.
 *
 * @param workstreams the register's workstreams as they stand, including any this batch is adding
 * @returns the register id it is held under, or `undefined`
 */
export function heldAs({
  candidate,
  state,
  workstreams,
}: {
  candidate: Candidate;
  state: CandidateState | undefined;
  workstreams: readonly WorkstreamAggregate[];
}): string | undefined {
  const ids = new Set(workstreams.map((one) => one.id));
  if (candidate.inRegister !== null && ids.has(candidate.inRegister)) {
    return candidate.inRegister;
  }
  const tag = minedTag({ candidateId: candidate.id });
  const tagged = workstreams.find((one) => tagsOf({ workstream: one }).includes(tag));
  if (tagged !== undefined) {
    return tagged.id;
  }
  if (state !== undefined && state.promotedAs !== null && ids.has(state.promotedAs)) {
    return state.promotedAs;
  }
  // The owner's standing word naming it as a workstream the register already holds.
  if (state !== undefined && state.sameAs !== null && ids.has(state.sameAs)) {
    return state.sameAs;
  }
  return undefined;
}

/** What one batch of the owner's words writes: the rows, the workstreams, the endings, and which word landed on which one. */
export interface ReactionPlan {
  readonly rows: readonly ReactionRow[];
  /** New workstreams: a standing one for a yes or abandoned, a closing one for a done. */
  readonly added: readonly WorkstreamAggregate[];
  /** Notes and own milestones the batch leaves on workstreams, by id — a placing word's sticky context. */
  readonly marks: ReadonlyMap<string, Marks>;
  /** Each placing word, and the register workstream it named. */
  readonly placed: readonly (HeldUnder & { readonly word: Reaction })[];
  /** Held workstreams a yes carried a standing definition of done onto, by id, replacing the register's copy. */
  readonly updated: ReadonlyMap<string, WorkstreamAggregate>;
  /** The Slack conversation names the added workstreams need in the register document, by id. */
  readonly channels: Readonly<Record<string, string>>;
  /** How each workstream an abandoned word lands on ended, by its id; one added FOR one carries its own ending. */
  readonly endings: ReadonlyMap<string, Ending>;
  /** Each yes or abandoned that became a new register workstream, and its id. */
  readonly promoted: readonly HeldUnder[];
  /** Each yes whose candidate the register already holds, and under which id. */
  readonly alreadyHeld: readonly HeldUnder[];
  /** Each abandoned word, and the register workstream it ended. */
  readonly ended: readonly HeldUnder[];
}

/**
 * Plan a batch of the owner's reactions against the register and the rows as they stand: one row per pick, a new workstream
 * for every yes or abandoned the register does not already hold, and an ending on every workstream an abandoned word
 * names. An id another candidate's row already names is reserved for that candidate's owed promotion, never reused:
 * reusing it would make this workstream read as that candidate's.
 *
 * @param picks each candidate and the owner's word
 * @param catalog the candidates the picks name, stated and mined alike
 * @param held every reaction row recorded so far
 * @param workstreams every workstream the register holds
 * @param meta the register document as it stands, or the first one a first yes starts
 * @param nowIso the instant the owner reacted
 * @param anchor where the owner said it, for a relayed word; `null` for a press
 * @param reason why it was abandoned, in the owner's words; `null` unless a pick is abandoned
 * @param placement what a done, no, same-as, milestone-of or yes word carries beyond itself; none when absent
 * @param titles each candidate the owner retitled, and the title a new workstream for it takes
 * @param bySession who recorded it
 * @param heard the owner's words as heard, kept on every row of the batch; `null` for a press
 * @param definitions each candidate's standing definition of done, which a yes carries onto its workstream
 * @param mintId the fresh canonical UUID each new entry takes
 * @returns the plan, or the refusal naming a pick no candidate carries, an abandoned word missing its reason or
 *   anchor, one landing on a workstream that cannot end, a placing word naming a workstream the register lacks, or a
 *   workstream the store would refuse
 */
export function planReactions({
  picks,
  catalog,
  held,
  definitions,
  workstreams,
  meta,
  nowIso,
  anchor,
  reason,
  placement = NO_PLACEMENT,
  titles = NO_TITLES,
  bySession,
  heard,
  via,
  mintId,
}: {
  picks: readonly ReactionPick[];
  catalog: Pick<CandidateCatalog, "candidates" | "channels">;
  held: readonly ReactionRow[];
  definitions: ReadonlyMap<string, DefinitionRow>;
  workstreams: readonly WorkstreamAggregate[];
  meta: WorkstreamRegisterMeta;
  nowIso: string;
  anchor: string | null;
  reason: string | null;
  placement?: Placement;
  titles?: ReadonlyMap<string, string>;
  bySession: string;
  heard: string | null;
  via: ReactionVia;
  mintId: () => string;
}): Result<ReactionPlan, CandidatesError> {
  const states = latestReactions({ rows: held });
  const byId = new Map(catalog.candidates.map((one) => [one.id, one] as const));
  const stamp = { anchor, bySession, heard, iso: nowIso, via };
  const so = emptyPlan({ workstreams });
  const rows: ReactionRow[] = [];
  for (const pick of picks) {
    const row = pickParts({ anchor, byId, nowIso, pick, reason }).andThen(({ candidate, ending }) =>
      rowFor({ candidate, definitions, ending, held, mintId, pick, placement, so, stamp, states, titles, workstreams }),
    );
    if (row.isErr()) {
      return err(row.error);
    }
    rows.push(row.value);
  }
  const { added, alreadyHeld, ended, endings, marks, placed, promoted, updated } = so;
  const channels = channelsFor({ added, channels: meta.channels, named: catalog.channels });
  return ok({ added, alreadyHeld, channels, ended, endings, marks, placed, promoted, rows, updated });
}

/** No candidate retitled. */
const NO_TITLES: ReadonlyMap<string, string> = new Map();

/**
 * One pick's row: place it on the plan against the register plus what this batch has added, then stamp the row its
 * word writes. A candidate with no standing definition or title carries `null` for each — absent by design.
 *
 * @param states each candidate's latest reaction so far, which says what it is already held as
 * @param stamp the when, where, by whom and via what every row of this batch shares
 * @param workstreams every workstream the register holds
 * @returns the row, or the refusal
 */
function rowFor({
  candidate,
  definitions,
  ending,
  held,
  mintId,
  pick,
  placement,
  so,
  stamp,
  states,
  titles,
  workstreams: registered,
}: {
  candidate: Candidate;
  definitions: ReadonlyMap<string, DefinitionRow>;
  ending: Ending | null;
  held: readonly ReactionRow[];
  mintId: () => string;
  pick: ReactionPick;
  placement: Placement;
  so: PlanSoFar;
  stamp: Pick<ReactionRow, "anchor" | "bySession" | "heard" | "iso" | "via">;
  states: ReturnType<typeof latestReactions>;
  titles: ReadonlyMap<string, string>;
  workstreams: readonly WorkstreamAggregate[];
}): Result<ReactionRow, CandidatesError> {
  const workstreams = [...registered, ...so.added];
  const fields = fieldsFor({ placement, reaction: pick.reaction });
  const definition = definitions.get(candidate.id);
  const title = titles.get(candidate.id);
  return placePick({
    candidate,
    // oxlint-disable-next-line prefer-nullish-coalescing -- no-silent-fallback bans `?? null`; none picked is by design
    definition: definition === undefined ? null : definition,
    ending,
    fields,
    held,
    holding: heldAs({ candidate, state: standingState({ candidateId: candidate.id, held, states }), workstreams }),
    mintId,
    nowIso: stamp.iso,
    reaction: pick.reaction,
    reactionAnchor: stamp.anchor,
    so,
    // oxlint-disable-next-line prefer-nullish-coalescing -- no-silent-fallback bans `?? null`; no title is by design
    title: title === undefined ? null : title,
    workstreams,
  }).map((promotedAs): ReactionRow => {
    const rowReason = ending === null ? fields.reason : ending.reason;
    return {
      ...stamp,
      ...fields,
      candidate: candidate.id,
      name: candidate.name,
      promotedAs,
      reaction: pick.reaction,
      reason: rowReason,
    };
  });
}

/**
 * The placement fields a word's row carries, read off the call's placement: a field on any other word is dropped,
 * never written onto a row the schema would refuse.
 *
 * @returns the row's fields
 */
function fieldsFor({ placement, reaction }: { placement: Placement; reaction: Reaction }): RowFields {
  const onNo = reaction === "no";
  let reasonHere: string | null = null;
  if (WORDS_WITH_A_REASON.has(reaction) && reaction !== "abandoned") {
    reasonHere = placement.reason;
  }
  return {
    coveredBy: onNo ? placement.coveredBy : null,
    milestoneOf: reaction === "milestone-of" ? placement.milestoneOf : null,
    outcomeOf: reaction === "outcome-of" ? placement.outcomeOf : null,
    owner: onNo ? placement.owner : null,
    reason: reasonHere,
    sameAs: reaction === "same-as" ? placement.sameAs : null,
    steer: reaction === "yes" ? placement.steer : null,
    supersededBy: reaction === "superseded" ? placement.supersededBy : null,
  };
}

/**
 * The candidate a pick names and the ending its word writes, or the refusal for an id no candidate carries or an
 * abandoned word missing its reason or anchor.
 *
 * @param byId every candidate, by its id
 * @returns the candidate and its ending (`null` for any word but abandoned), or the refusal
 */
function pickParts({
  anchor,
  byId,
  nowIso,
  pick,
  reason,
}: {
  anchor: string | null;
  byId: ReadonlyMap<string, Candidate>;
  nowIso: string;
  pick: ReactionPick;
  reason: string | null;
}): Result<{ candidate: Candidate; ending: Ending | null }, CandidatesError> {
  const candidate = byId.get(pick.candidate);
  if (candidate === undefined) {
    return err(CandidatesErrors.reactionRefused({ problems: [`no candidate has the id ${pick.candidate}`] }));
  }
  return endingFor({ anchor, candidate: candidate.id, nowIso, reaction: pick.reaction, reason }).map((ending) => ({
    candidate,
    ending,
  }));
}
