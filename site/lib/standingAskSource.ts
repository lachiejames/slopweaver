/**
 * The standing ask of the owner's a Queue card quotes when no particular steer of theirs is recorded behind it.
 *
 * Every card quotes the owner's own words — the
 * particular steer that led to it, or, for one no particular steer produced (an organisation-intelligence finding),
 * the standing ask it rests on, saying no other particular steer is behind it. So this is a pass over every built
 * row (`./queueRows.ts` `rowsOf`): a row whose source is unsteered — a fleet finding, a bot reply, a row a session
 * registered, a card recording nothing — is matched to the ONE active standing ask covering cards like it
 * (`src/profile/standingAsks.ts`, which refuses two asks over one coverage at write time). A card no ask covers, or
 * one read while the register is unread or broken, says which rather than reading as complete.
 *
 * Pure: rows and a reading in, rows out.
 */
import type { StandingAskReading, StandingAskView } from "../components/live/readStandingAsks";
import type { LiveState } from "../components/live/useLive";
import { withoutMachineIds } from "./machineIds";
import type { CardSource, UnsteeredOrigin } from "./queueCardSource";
import type { QueueRow } from "./queueRows";
import { NO_COVERING_ASK, standingAddStep } from "./sessionSteps";

/** The autonomy kind grammar `act:<kind>` accepts — `src/profile/standingAsks.ts` `ACT_KIND`, which the site cannot import. */
const ACT_KIND = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/u;

/**
 * The coverages a row's card falls under, most specific first: an act's own kind before where it came from — the
 * standing ask behind a kind of act (auto-merging a pull request) is what the act rests on, whichever row it served.
 *
 * @param row the built row
 * @param immediate where its card came from
 * @returns the coverages, in the order an ask is looked for
 */
export function standingCoverages({
  row,
  immediate,
}: {
  row: QueueRow;
  immediate: UnsteeredOrigin;
}): readonly [string, ...string[]] {
  // Only a kind `profile standing add --covers act:<kind>` accepts: no ask could cover any other, and printing one
  // would hand the session a command its own verb refuses, carrying whatever free text the act recorded.
  let own: string | undefined;
  if (row.record.kind === "act" && ACT_KIND.test(row.record.act.kind)) {
    own = `act:${row.record.act.kind}`;
  }
  switch (immediate.kind) {
    case "none": {
      if (row.record.kind === "draft") {
        return withOwn({ origin: "bot-replies", own });
      }
      return withOwn({ origin: "findings", own });
    }
    case "registered":
      return withOwn({ origin: "registered-rows", own });
    case "unrecorded": {
      if (own !== undefined) {
        return [own];
      }
      return ["unlinked-cards"];
    }
    default: {
      const never: never = immediate;
      return never;
    }
  }
}

/** An act's own coverage, when it has one, ahead of where its card came from. */
function withOwn({ own, origin }: { own: string | undefined; origin: string }): readonly [string, ...string[]] {
  if (own === undefined) {
    return [origin];
  }
  return [own, origin];
}

/** The unsteered part of a source, or `undefined` when a steer of the owner's, or a pointer at one, is behind it. */
function unsteeredOf({ source }: { source: CardSource }): UnsteeredOrigin | undefined {
  switch (source.kind) {
    case "none":
      return source.hover === undefined
        ? { kind: "none", origin: source.origin }
        : { hover: source.hover, kind: "none", origin: source.origin };
    case "registered":
      return { kind: "registered", run: source.run, session: source.session };
    case "unrecorded":
      if (source.hover === undefined) {
        return { kind: "unrecorded", origin: source.origin };
      }
      return { hover: source.hover, kind: "unrecorded", origin: source.origin };
    case "words":
    case "unquoted":
    case "unreadable":
    case "elsewhere":
    case "unread":
    case "board-pending":
    case "standing":
    case "standing-missing":
    case "standing-pending":
      return undefined;
    default: {
      const never: never = source;
      return never;
    }
  }
}

/**
 * Where a card came from once the owner's standing asks are read: the ask covering it, or why none is quoted.
 *
 * @param row the built row
 * @param standing the standing-ask register as read
 * @returns the row's source — unchanged when a steer of the owner's, or a pointer at one, is already behind it
 */
export function standingAskSource({
  row,
  standing,
}: {
  row: QueueRow;
  standing: LiveState<StandingAskReading>;
}): CardSource {
  const source = row.source;
  const immediate = unsteeredOf({ source });
  if (immediate === undefined) {
    return source;
  }
  // Everything the overlay does not replace rides through: the owner's later steers, the subject, and their words on the card's
  // pull request from other rows — dropping that last one would hide them on every unsteered card.
  const carried: Pick<CardSource, "steers" | "subject" | "prSteers"> = {
    steers: source.steers,
    ...(source.subject === undefined ? {} : { subject: source.subject }),
    ...(source.prSteers === undefined ? {} : { prSteers: source.prSteers }),
  };
  if (standing.phase === "loading") {
    return { ...carried, immediate, kind: "standing-pending", read: { phase: "loading" } };
  }
  if (standing.phase === "not-measured") {
    return {
      ...carried,
      immediate,
      kind: "standing-pending",
      read: { phase: "not-measured", why: withoutMachineIds({ text: standing.why }) },
    };
  }
  const reading = standing.value;
  if (reading.kind === "defect") {
    return {
      ...carried,
      immediate,
      kind: "standing-missing",
      // The read's own reason is said plainly beneath the line with its raw message folded (steer 7): the fold is the
      // one place a machine id may stand, so it is kept exactly as the read gave it.
      why: [
        {
          lead: "Your standing asks are recorded but do not read, so the one this card rests on cannot be quoted",
          why: reading.why,
        },
      ],
    };
  }
  const coverages = standingCoverages({ immediate, row });
  const ask = firstCovering({ active: reading.active, coverages });
  if (ask === undefined) {
    return {
      ...carried,
      immediate,
      kind: "standing-missing",
      uncoveredCoverage: coverages[0],
      why: `${NO_COVERING_ASK} ${standingAddStep({ coverage: coverages[0] })}`,
    };
  }
  return { ...carried, askId: ask.id, immediate, kind: "standing", quote: ask.quote };
}

/** The active ask covering the first coverage any ask covers, or `undefined` when none covers any. */
function firstCovering({
  active,
  coverages,
}: {
  active: readonly StandingAskView[];
  coverages: readonly string[];
}): StandingAskView | undefined {
  for (const coverage of coverages) {
    const ask = active.find((one) => one.covers.includes(coverage));
    if (ask !== undefined) {
      return ask;
    }
  }
  return undefined;
}

/**
 * Every row's source with the owner's standing asks read in.
 *
 * @param rows the built rows
 * @param standing the standing-ask register as read
 * @returns the rows, each unsteered card's source naming the standing ask it rests on, or why none is quoted
 */
export function withStandingAsks({
  rows,
  standing,
}: {
  rows: readonly QueueRow[];
  standing: LiveState<StandingAskReading>;
}): readonly QueueRow[] {
  return rows.map((row) => {
    const source = standingAskSource({ row, standing });
    if (source === row.source) {
      return row;
    }
    return { ...row, source };
  });
}
