/**
 * The doctrine panel's readings as it may count them: a live channel still loading, failed, stale or handed over from an
 * earlier page is NOT in hand and says why, never a zero. Split from `./fleetDoctrine.ts`, which composes the lines.
 */
import type { DoctrineGlance } from "./fleetDoctrineSeats";
import type { DoctrineInput } from "./fleetDoctrineTypes";
import type { LiveState } from "./liveState";

/** A phrase opened in capitals, so a subject named mid-sentence ("the board") can open a sentence of its own. */
function capitalised({ text }: { text: string }): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/**
 * A live channel's state as the projection takes it: a reading still loading, one that failed, one drawn over a
 * read that failed since, or one handed over from an earlier page is NOT in hand: each says why, never empty. Only the
 * one still loading is pending: a handed-over reading has a value in hand, so it is not yet current rather than on its
 * way, and the panel settles over it instead of waiting behind every other first read the page queues.
 *
 * @param state the channel's state as the page draws it
 * @param subject what the reading is, in the words the sentence names it by
 * @param pick the part of the reading the projection reads
 * @returns the input
 */
export function doctrineInputOf<T, V>({
  state,
  subject,
  pick,
}: {
  state: LiveState<T>;
  subject: string;
  pick: (value: T) => V;
}): DoctrineInput<V> {
  if (state.phase === "loading") {
    return { kind: "unread", pending: true, why: `${subject} is still loading` };
  }
  // A read's own reason can be a stderr tail or a stack, so it is quoted apart from the words that name it (steer 7).
  if (state.phase === "not-measured") {
    return { kind: "unread", why: { lead: `${capitalised({ text: subject })} did not read`, why: state.why } };
  }
  if (state.stale !== undefined) {
    return { kind: "unread", why: { lead: `The latest read of ${subject} failed`, why: state.stale.why } };
  }
  // A reading handed over from an earlier page, its replacement still on its way, is not this page's read; it proves
  // no doctrine count, but it is in hand, so it never holds the panel busy.
  if (state.refreshing === true) {
    return { kind: "unread", why: `${subject} is not yet current for this page` };
  }
  return { kind: "read", value: pick(state.value) };
}

/**
 * Whether any input the panel stands on has nothing in hand yet, its first read still loading, so the panel marks
 * itself busy (`aria-busy`) instead of presenting its not-read lines as settled. A handed-over reading whose
 * replacement is on its way is not pending: it is in hand, and the page's own reading marks say it is re-reading.
 *
 * @param inputs every input the panel's lines read
 * @param glance the glance as `doctrineGlanceOf` withdrew it, pending while its capacity or ceiling channel loads
 * @returns true when at least one is unread only because its first read has not landed yet
 */
export function doctrinePendingOf({
  inputs,
  glance,
}: {
  inputs: readonly DoctrineInput<unknown>[];
  glance: DoctrineGlance;
}): boolean {
  return glance.pending === true || anyPendingOf({ inputs });
}

/** Whether any of these inputs is unread only because its first read is still loading. */
function anyPendingOf({ inputs }: { inputs: readonly DoctrineInput<unknown>[] }): boolean {
  return inputs.some((input) => input.kind === "unread" && input.pending === true);
}

/**
 * The glance as the panel may count it: the page's glance draws a ceiling or a burst off a reading whose latest
 * refresh failed, which is fine beside a staleness mark but would read here as measured. So a ceiling
 * not in hand goes undefined, and a burst off a capacity reading not in hand goes unread, naming why.
 *
 * @param glance the page's glance
 * @param ceiling the plans' seat ceiling channel the glance's ceiling came from
 * @param capacity the machine capacity channel the glance's burst came from
 * @returns the glance with every count it cannot stand behind withdrawn
 */
export function doctrineGlanceOf({
  glance,
  ceiling,
  capacity,
}: {
  glance: DoctrineGlance;
  ceiling: LiveState<unknown>;
  capacity: LiveState<unknown>;
}): DoctrineGlance {
  const ceilingInHand = doctrineInputOf({
    pick: () => glance.ceiling,
    state: ceiling,
    subject: "the plans' seat ceiling reading",
  });
  const capacityInHand = doctrineInputOf({
    pick: () => true,
    state: capacity,
    subject: "the machine capacity reading",
  });
  let burst = glance.burst;
  if (capacityInHand.kind === "unread") {
    burst = { kind: "unread", why: capacityInHand.why };
  }
  // Either channel with nothing in hand yet keeps the panel busy, exactly as one of its own four inputs would.
  const marked = anyPendingOf({ inputs: [capacityInHand, ceilingInHand] }) ? { pending: true as const } : {};
  if (ceilingInHand.kind === "unread") {
    // The channel's own reason travels with the withdrawn ceiling, so the line names it.
    return { burst, ceiling: undefined, ceilingWhy: ceilingInHand.why, working: glance.working, ...marked };
  }
  return { burst, ceiling: ceilingInHand.value, working: glance.working, ...marked };
}
