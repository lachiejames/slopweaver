/**
 * Which turn a backend event belongs to, and how two records of one turn become one — the correlation half of the
 * voice's activity fold (`voiceActivity.ts`), split out so each file reads as one idea. Pure: no clock, no I/O.
 */

import type { Delegation, EndedDelegation, VoiceActivity } from "./voiceActivityState";

/**
 * Which open delegation an event belongs to: the outer id, else a bound response id, else the only open one.
 * A named id the fold has not seen still counts — it reopens a delegation a tool-call completion left.
 *
 * @returns the delegation's key — a `response:` key for a response no turn can take — or `undefined` when unknowable
 */
export function correlate({
  activity,
  delegationId,
  responseId,
}: {
  activity: VoiceActivity;
  delegationId: string | undefined;
  responseId: string | undefined;
}): string | undefined {
  if (delegationId !== undefined) {
    return delegationId;
  }
  if (responseId !== undefined) {
    for (const delegation of activity.delegations.values()) {
      if (delegation.responseIds.includes(responseId)) {
        return delegation.id;
      }
    }
    // A response an ended turn had names THAT turn, never the one open delegation it would otherwise fall to.
    for (const past of activity.ended) {
      if (past.responseIds.includes(responseId)) {
        return past.id;
      }
    }
  }
  if (responseId === undefined) {
    if (activity.delegations.size === 1) {
      return [...activity.delegations.keys()][0];
    }
    return undefined;
  }
  // A response no turn has had continues the one turn waiting for one; with none waiting it is a turn of its own.
  const waiting = [...activity.delegations.values()].filter((delegation) => awaitsResponse({ delegation }));
  if (waiting.length === 1) {
    return waiting.at(0)!.id;
  }
  if (waiting.length === 0) {
    return `response:${responseId}`;
  }
  return undefined;
}

/** Whether a delegation is waiting for a new response: it has none yet, or its newest asked for a tool. */
function awaitsResponse({ delegation }: { delegation: Delegation }): boolean {
  const newest = delegation.responseIds.at(-1);
  if (newest === undefined || delegation.unboundAsk) {
    return true;
  }
  return delegation.askedBy.includes(newest);
}

/**
 * The activity with the turn already bound to `responseId` under another key — open, or ended — moved under `id`, the
 * delegation's own. The same activity when there is nothing to move.
 *
 * @returns the activity with that turn under `id`, or the same activity when nothing moved
 */
export function adopted({
  activity,
  id,
  responseId,
}: {
  activity: VoiceActivity;
  id: string;
  responseId: string | undefined;
}): VoiceActivity {
  if (responseId === undefined) {
    return activity;
  }
  const known = activity.delegations.get(id);
  for (const [key, delegation] of activity.delegations) {
    // A response-keyed turn joins a delegation already open through `merged`, below; a guessed one always leaves.
    const joins = key.startsWith("response:") && known !== undefined;
    if (key !== id && !joins && delegation.responseIds.includes(responseId)) {
      const delegations = new Map(activity.delegations);
      if (key.startsWith("response:")) {
        // A turn opened on this response before any delegation was named: it IS this delegation.
        delegations.delete(key);
        delegations.set(id, { ...delegation, id });
      } else {
        // Another delegation took this response as its continuation by guess: it is this one's, so it leaves.
        let { guessedAsk } = delegation;
        if (guessedAsk === responseId) {
          guessedAsk = undefined;
        }
        delegations.set(key, {
          ...delegation,
          askedBy: delegation.askedBy.filter((owner) => owner !== responseId),
          guessedAsk,
          responseIds: delegation.responseIds.filter((owner) => owner !== responseId),
        });
      }
      return { ...activity, delegations };
    }
  }
  const guessedPast = activity.ended.find(
    (record) => !record.id.startsWith("response:") && record.id !== id && record.responseIds.includes(responseId),
  );
  if (guessedPast !== undefined) {
    // An ended delegation took this response by guess: named with this one, it was never that turn's, so it leaves.
    const last = activity.endedState.get(guessedPast.id);
    if (last !== undefined && guessedPast.responseIds.at(-1) === responseId) {
      // And it was the response whose close ended that turn: the turn never ended, so it reopens as it stood.
      return reopened({ activity, last, record: guessedPast, responseId });
    }
    return {
      ...activity,
      ended: activity.ended.map((record) => {
        if (record !== guessedPast) {
          return record;
        }
        return { ...record, responseIds: record.responseIds.filter((owner) => owner !== responseId) };
      }),
    };
  }
  if (known !== undefined) {
    return merged({ activity, known, responseId });
  }
  const past = activity.ended.find(
    (record) => record.id.startsWith("response:") && record.id !== id && record.responseIds.includes(responseId),
  );
  if (past === undefined) {
    return activity;
  }
  const mine = activity.ended.find((record) => record.id === id);
  if (mine !== undefined) {
    // Both ended apart, and this event names them as one turn: the delegation's record takes the response's in.
    const responseIds = chronological({
      activity,
      ids: [...mine.responseIds, ...past.responseIds.filter((owner) => !mine.responseIds.includes(owner))],
    });
    return {
      ...activity,
      ended: activity.ended
        .filter((record) => record !== past)
        .map((record) => (record === mine ? { ...record, responseIds } : record)),
    };
  }
  return { ...activity, ended: activity.ended.map((record) => (record === past ? { ...record, id } : record)) };
}

/**
 * A delegation already open, named together with a response a turn opened before any delegation was named holds: one
 * turn, so the two records become one under the delegation's id. If that turn has already ended, the delegation ended
 * with it when it had no response of its own, and otherwise takes the ended record's responses in as its earlier ones.
 */
function merged({
  activity,
  known,
  responseId,
}: {
  activity: VoiceActivity;
  known: Delegation;
  responseId: string;
}): VoiceActivity {
  const holds = ({ key, responseIds }: { key: string; responseIds: readonly string[] }): boolean =>
    key.startsWith("response:") && key !== known.id && responseIds.includes(responseId);
  const open = [...activity.delegations.values()].find((delegation) =>
    holds({ key: delegation.id, responseIds: delegation.responseIds }),
  );
  if (open !== undefined) {
    const union = ({ a, b }: { a: readonly string[]; b: readonly string[] }): readonly string[] => [
      ...a,
      ...b.filter((owner) => !a.includes(owner)),
    ];
    let latest = known;
    if (open.lastProgressMs > known.lastProgressMs) {
      latest = open;
    }
    let { guessedAsk } = open;
    if (known.guessedAsk !== undefined) {
      guessedAsk = known.guessedAsk;
    }
    // In the order each response began, so the newest stays last and only its close ends the turn.
    const responseIds = chronological({ activity, ids: union({ a: known.responseIds, b: open.responseIds }) });
    const delegations = new Map(activity.delegations);
    delegations.delete(open.id);
    delegations.set(known.id, {
      ...known,
      askedBy: union({ a: known.askedBy, b: open.askedBy }),
      guessedAsk,
      lastProgressMs: latest.lastProgressMs,
      responseIds,
      sinceMs: Math.min(known.sinceMs, open.sinceMs),
      step: latest.step,
      unboundAsk: known.unboundAsk || open.unboundAsk,
    });
    return { ...activity, delegations };
  }
  const past = activity.ended.find((record) => holds({ key: record.id, responseIds: record.responseIds }));
  if (past === undefined) {
    return activity;
  }
  if (known.responseIds.some((owner) => !past.responseIds.includes(owner))) {
    // The delegation runs on in a later response: the ended record was its earlier part, so it leaves `ended`.
    const delegations = new Map(activity.delegations);
    delegations.set(known.id, {
      ...known,
      responseIds: chronological({
        activity,
        ids: [...past.responseIds, ...known.responseIds.filter((owner) => !past.responseIds.includes(owner))],
      }),
    });
    return { ...activity, delegations, ended: activity.ended.filter((record) => record !== past) };
  }
  const delegations = new Map(activity.delegations);
  delegations.delete(known.id);
  const ended = activity.ended.map((record) => {
    if (record === past) {
      return { ...record, id: known.id };
    }
    return record;
  });
  return { ...activity, delegations, ended };
}

/**
 * Response ids in the order each was first named. An id never named by an event — an `unnamed:` stand-in for a close
 * that named none — keeps its place just after the id before it, which is where the close that minted it put it.
 *
 * @returns the same ids, oldest first, so only the newest response's close can end a turn
 */
export function chronological({
  activity,
  ids,
}: {
  activity: VoiceActivity;
  ids: readonly string[];
}): readonly string[] {
  let previous = -1;
  const timed = ids.map((id, index) => {
    const seen = activity.responseOrder.get(id);
    if (seen !== undefined) {
      previous = seen;
    }
    return { at: previous, id, index };
  });
  timed.sort((a, b) => a.at - b.at || a.index - b.index);
  return timed.map(({ id }) => id);
}

/**
 * The activity with an ended delegation open again as it closed, minus the response that proved to be another's.
 *
 * A trade, not an oversight: a turn keeps one step and one last-progress time, not one per response, so the reopened
 * row shows what it showed at its close — which may be that response's progress. It is in flight either way, and the
 * stall label still counts from that time.
 */
function reopened({
  activity,
  last,
  record,
  responseId,
}: {
  activity: VoiceActivity;
  last: Delegation;
  record: EndedDelegation;
  responseId: string;
}): VoiceActivity {
  const without = (ids: readonly string[]): readonly string[] => ids.filter((owner) => owner !== responseId);
  let { guessedAsk } = last;
  if (guessedAsk === responseId) {
    guessedAsk = undefined;
  }
  const delegations = new Map(activity.delegations);
  delegations.set(record.id, {
    ...last,
    askedBy: without(last.askedBy),
    closedBy: without(last.closedBy),
    guessedAsk,
    responseIds: without(record.responseIds),
  });
  const endedState = new Map(activity.endedState);
  endedState.delete(record.id);
  return { ...activity, delegations, ended: activity.ended.filter((other) => other !== record), endedState };
}
