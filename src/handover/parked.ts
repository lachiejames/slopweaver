/**
 * What a run's journal says about a PARKED seat — the checkpoint `handover park` left when it closed one.
 *
 * Two readings, because the board and a reseat ask different questions. The board asks whether the seat is
 * parked NOW ({@link activeParkedCheckpoint}): closed, the run not ended, nobody reseated. A reseated session
 * asks where its predecessor stood ({@link latestParkedCheckpoint}), and that answer outlives the reseat.
 *
 * Both read only the CURRENT cycle, the same slice every other fold here reads. Pure: events in, a verdict out.
 */

import { currentCycle, type RunEvent } from "./ledger.js";
import type { ParkedEvent, ParkWakeSuspendedEvent } from "./parkedEvent.js";
import { parkWakeSuspension, straySuspensionReason } from "./parkWakeSuspension.js";
import { runOwnership } from "./runOwner.js";

/**
 * The most recent `parked` event of the current cycle, whatever happened since.
 *
 * @param events the journal's events, in order
 * @returns the checkpoint, or `undefined` when this cycle never parked
 */
export function latestParkedCheckpoint({ events }: { events: readonly RunEvent[] }): ParkedEvent | undefined {
  return currentCycle({ events }).findLast((event): event is ParkedEvent => event.kind === "parked");
}

/**
 * The checkpoint of a seat that is parked NOW: the current cycle's last `parked` event, provided nothing since
 * has ended the run or seated a session on it again.
 *
 * Cleared by any terminal event, and by a `dispatched`, `launched`, `resumed` or `claimed` — a seat is open on
 * the run again, so it is no longer closed. `dispatched` counts on its own because `cmux spawn` writes it only
 * once a seat booted, and that seat may never claim: one reseated into a worktree older than this kind could
 * not, and the park then stood over a live seat nobody could close. The owner's answer does NOT
 * clear it: the seat is still closed after they answer, and the answer is what a reseat is FOR (a parked seat leaves
 * the fleet and comes back on demand). Nor does a
 * correction, reshape, offer, reconfirmation, withdrawal or ruling: each changes what the card says, never
 * whether a seat is open. A `park-cleared` clears only the park at the position it names ({@link clearsPark}). A
 * `park-wake-suspended` clears nothing: it holds only the park's WAKE, and only while the owner's question stays open
 * ({@link parkAsItWaits}).
 *
 * @param events the journal's events, in order
 * @returns the checkpoint, or `undefined` when no seat is parked on this run now
 */
export function activeParkedCheckpoint({ events }: { events: readonly RunEvent[] }): ParkedEvent | undefined {
  const cycle = currentCycle({ events });
  const cycleStart = events.length - cycle.length;
  let active: ParkedEvent | undefined;
  let activeIndex = -1;
  for (const [offset, event] of cycle.entries()) {
    const index = cycleStart + offset;
    if (event.kind === "parked") {
      if (parkNamedHolder({ active, before: events.slice(0, index), event })) {
        active = event;
        activeIndex = index;
      }
      continue;
    }
    if (active !== undefined && clearsPark({ event, parkIndex: activeIndex })) {
      active = undefined;
    }
  }
  return active;
}

/**
 * Whether a `parked` line named the run's holder where it landed — the predicate `./staleHolder.ts` refuses a
 * park on at write time, applied again at READ time. The journal takes no lock, so a claim can land between a
 * park's last read and its append; that line then releases nobody (`./runRelease.ts`),
 * and this keeps it from reading as a checkpoint too, so no later sweep can close the claimer's seat off it.
 */
function parkNamedHolder({
  active,
  before,
  event,
}: {
  active: ParkedEvent | undefined;
  before: readonly RunEvent[];
  event: ParkedEvent;
}): boolean {
  const ownership = runOwnership({ events: before, sessionId: undefined });
  if (ownership.kind === "unowned") {
    return false;
  }
  if (ownership.kind === "released" && active !== undefined) {
    return false;
  }
  return ownership.writer.sessionId === event.sessionId;
}

/**
 * Whether one event after a park means the seat is no longer parked: the run ended, or a seat is open on it.
 *
 * @returns true for every kind in {@link PARK_ENDING_KINDS}
 */
function endsPark({ event }: { event: RunEvent }): boolean {
  return PARK_ENDING_KINDS.has(event.kind);
}

/**
 * Whether one event clears the park standing at `parkIndex`: any kind {@link endsPark} names, or a `park-cleared`
 * naming exactly that position — a stale one, written against a park since replaced, clears nothing.
 *
 * @param parkIndex the standing park's position in the whole journal
 * @returns true when the event clears that park
 */
export function clearsPark({ event, parkIndex }: { event: RunEvent; parkIndex: number }): boolean {
  if (event.kind === "park-cleared") {
    return event.parkIndex === parkIndex;
  }
  return endsPark({ event });
}

/**
 * Why a `park-cleared` about to be written must be refused — it names a journal position other than the standing
 * park's, so it would clear nothing, or a park since replaced, and read as though a wake had been retired.
 *
 * @param event the event about to be written
 * @param events the whole journal as it stands, where the standing park and its position are read
 * @returns the reason, or `undefined` when the event is no clear or clears the park that stands
 */
export function strayParkClearReason({
  event,
  events,
}: {
  event: RunEvent;
  events: readonly RunEvent[];
}): string | undefined {
  if (event.kind !== "park-cleared") {
    return undefined;
  }
  const standing = activeParkedCheckpoint({ events });
  if (standing !== undefined && events.indexOf(standing) === event.parkIndex) {
    return undefined;
  }
  return `no park stands at position ${String(event.parkIndex)}, so there is nothing this clears`;
}

/**
 * Why a `park-wake-suspended` about to be written must be refused, over the journal as it stands: it names a park
 * other than the standing one, or a question other than the one open (`./parkWakeSuspension.ts`).
 *
 * @param event the event about to be written
 * @param events the whole journal as it stands
 * @returns the reason, or `undefined` when the event is no suspension or binds what stands
 */
export function straySuspendReason({
  event,
  events,
}: {
  event: RunEvent;
  events: readonly RunEvent[];
}): string | undefined {
  if (event.kind !== "park-wake-suspended") {
    return undefined;
  }
  const standing = activeParkedCheckpoint({ events });
  const standingIndex = standing === undefined ? undefined : events.indexOf(standing);
  return straySuspensionReason({ event, events, standingIndex });
}

/**
 * The park standing now AS IT WAITS: {@link activeParkedCheckpoint}, its `wake` dropped while a suspension holds it
 * on the owner's open question (`./parkWakeSuspension.ts`). For a reader asking what the park waits on — the board row, the
 * wake's candidates, `resume` — never for one comparing park identity, which must take the journal's own object.
 *
 * @param events the journal's events, in order
 * @returns the park as it waits, and the suspension holding its wake when one does — or `undefined` with no park
 */
export function parkAsItWaits({ events }: { events: readonly RunEvent[] }):
  | {
      readonly parked: ParkedEvent;
      readonly parkIndex: number;
      readonly suspension: ParkWakeSuspendedEvent | undefined;
    }
  | undefined {
  const standing = activeParkedCheckpoint({ events });
  if (standing === undefined) {
    return undefined;
  }
  const parkIndex = events.indexOf(standing);
  const suspension = standing.wake === undefined ? undefined : parkWakeSuspension({ events, parkIndex });
  if (suspension === undefined) {
    return { parkIndex, parked: standing, suspension };
  }
  const { wake: _suspended, ...rest } = standing;
  return { parkIndex, parked: rest, suspension };
}

/** Every kind {@link endsPark} reads as the end of a park; any other kind leaves the seat parked. */
const PARK_ENDING_KINDS: ReadonlySet<RunEvent["kind"]> = new Set<RunEvent["kind"]>([
  "finished",
  "closed",
  "abandoned",
  "orphaned",
  "dispatched",
  "launched",
  "resumed",
  "claimed",
]);

/**
 * The `PARKED` block `handover resume` prints: where the seat stood when it was closed, and what reseats it.
 *
 * @param events the journal's events, in order
 * @param slug the run's slug, for the commands it names
 * @returns the lines, or none when this cycle never parked
 */
export function parkedResumeLines({ events, slug }: { events: readonly RunEvent[]; slug: string }): readonly string[] {
  const latest = latestParkedCheckpoint({ events });
  if (latest === undefined) {
    return [];
  }
  const waiting = parkAsItWaits({ events });
  const still = waiting !== undefined;
  const cleared = still ? undefined : wakeClearOf({ events, parked: latest });
  const suspension = waiting?.suspension;
  const screen = latest.screenTail.length === 0 ? ["    (the screen read empty)"] : indent({ text: latest.screenTail });
  return [
    headLine({ cleared, parked: latest, still }),
    `  worktree: ${latest.worktree} (rebuilt from the branch if it is gone)`,
    `  branch:   ${latest.branch}`,
    ...waitedLines({ parked: latest }),
    ...(suspension === undefined ? [] : [`  wake suspended ${suspension.atIso}: ${suspension.why}`]),
    ...draftLines({ drafts: latest.drafts }),
    "  last screen before it closed:",
    ...screen,
    lastLine({ cleared, slug, still, waiting }),
  ];
}

/** The block's last line: why its wake was cleared, or how the seat comes back. */
function lastLine({
  cleared,
  slug,
  still,
  waiting,
}: {
  cleared: Extract<RunEvent, { kind: "park-cleared" }> | undefined;
  slug: string;
  still: boolean;
  waiting: ReturnType<typeof parkAsItWaits>;
}): string {
  if (cleared !== undefined) {
    return `  wake cleared: ${cleared.why}`;
  }
  if (waiting?.suspension !== undefined) {
    return "  reseats itself once the owner's question is answered or withdrawn: the wake is live again then, and already due";
  }
  if (waiting === undefined) {
    return reseatLine({ hasWake: false, slug, still });
  }
  return reseatLine({ hasWake: waiting.parked.wake !== undefined, slug, still });
}

/**
 * The `park-cleared` that ended this park, when the first line to clear it was one AND the park stood when it
 * was written, else `undefined` — a hand-edited clear naming a park that never stood retired nothing.
 */
function wakeClearOf({
  events,
  parked,
}: {
  events: readonly RunEvent[];
  parked: ParkedEvent;
}): Extract<RunEvent, { kind: "park-cleared" }> | undefined {
  const parkIndex = events.lastIndexOf(parked);
  const clearAt = events.findIndex((event, at) => at > parkIndex && clearsPark({ event, parkIndex }));
  const first = events[clearAt];
  const stood = activeParkedCheckpoint({ events: events.slice(0, clearAt) }) === parked;
  return first?.kind === "park-cleared" && stood ? first : undefined;
}

/** The block's first line: closed at rest, and whether it is still closed, was reseated, or had its wake cleared. */
function headLine({
  cleared,
  parked,
  still,
}: {
  cleared: Extract<RunEvent, { kind: "park-cleared" }> | undefined;
  parked: ParkedEvent;
  still: boolean;
}): string {
  const opening = `PARKED ${parked.atIso} — ${parked.workspaceRef} was closed at rest`;
  if (still) {
    return `${opening}; the seat is NOT open`;
  }
  if (cleared !== undefined) {
    return `${opening}; its wake was cleared at ${cleared.atIso} without a reseat`;
  }
  return `${opening}; it has since been reseated`;
}

/** What the seat waited on: the owner's open question, the clock or CI it named, both, or nothing open. */
function waitedLines({ parked }: { parked: ParkedEvent }): readonly string[] {
  const lines: string[] = [];
  if (parked.question !== undefined) {
    lines.push(`  waited on: ${parked.question}`);
  }
  if (parked.wake?.kind === "at") {
    lines.push(`  wakes at:  ${parked.wake.atIso}`);
  }
  if (parked.wake?.kind === "checks") {
    lines.push(`  wakes on:  CI finishing on ${parked.wake.repo}#${String(parked.wake.number)}, or its merge or close`);
  }
  return lines.length === 0 ? ["  waited on: nothing open — it stopped between turns"] : lines;
}

/** The block's last line: how the seat comes back, or that it already has. */
function reseatLine({ hasWake, slug, still }: { hasWake: boolean; slug: string; still: boolean }): string {
  if (!still) {
    return `  reseated: \`slopweaver handover claim ${slug} --why "reseating a parked run"\` if it is not yours yet`;
  }
  if (hasWake) {
    return `  reseats itself: the supervisor tick's \`handover wake\` runs \`cmux spawn ${slug}\` once its wake is due`;
  }
  return `  reseat when wanted: slopweaver cmux spawn ${slug} — the seat then claims and resumes here`;
}

/** The drafts block: every unsent message the seat held, in full, so a reseat starts from them rather than over. */
function draftLines({ drafts }: { drafts: ParkedEvent["drafts"] }): readonly string[] {
  if (drafts === undefined || drafts.length === 0) {
    return [];
  }
  return [
    "  drafts it held, unsent:",
    ...drafts.flatMap((draft) => [
      draft.kind === "slack-draft" ? `    slack draft ${draft.id}:` : "    the question's drafted message:",
      ...indent({ text: draft.text }).map((line) => `  ${line}`),
    ]),
  ];
}

/** Every line of a block, indented under its heading. */
function indent({ text }: { text: string }): readonly string[] {
  return text.split("\n").map((line) => `    ${line}`);
}
