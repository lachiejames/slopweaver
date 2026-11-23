/**
 * The narrow reader for the supervisor tick's recorded `fleet burn --json` (`src/fleet/hostBurn.ts`'s
 * `FleetBurnReport`): each host's tokens over the last 24 hours, the seven-day amount at that rate, and the sessions
 * drawing now. Same contract as every reader beside it: a shape it does not recognise is `undefined`, never a
 * plausible substitute, and one host that will not read refuses the whole report.
 */
import { type Bag, instant, isBag, num, str, strings, sub } from "../../lib/bag";
import type { FleetBurn, HostBurn } from "../../lib/planMeters";
import { type Reading, readingOf } from "./reading";

/**
 * A count the verb printed: a whole number, never negative. Anything else is a shape that moved, not a figure to draw.
 *
 * @returns the count, or `undefined`
 */
function count({ bag, key }: { bag: Bag; key: string }): number | undefined {
  const value = num({ bag, key });
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

/**
 * One host's burn, in whichever of its three states the report recorded.
 *
 * @returns the burn, or `undefined` when its state is unknown or a field that state carries will not read
 */
function hostBurnOf({ bag, windowHours }: { bag: Bag; windowHours: number }): HostBurn | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === "unavailable") {
    const why = str({ bag, key: "why" });
    if (why === undefined) {
      return undefined;
    }
    return { kind, why };
  }
  const totalTokens = count({ bag, key: "totalTokens" });
  const outputTokens = count({ bag, key: "outputTokens" });
  const sessions = count({ bag, key: "sessions" });
  const activeSessions = count({ bag, key: "activeSessions" });
  if (
    totalTokens === undefined ||
    outputTokens === undefined ||
    sessions === undefined ||
    activeSessions === undefined ||
    // A session drawing now is one of the sessions that drew in the window, the output is part of the total, and every
    // token burned was burned by a session, so any of these broken is a report that moved. These are the producer's
    // invariants cheap to state; the reader does not re-derive its whole arithmetic, which is `src/fleet/hostBurn.ts`'s
    // own, tested there, and recorded off this repository's own verb.
    activeSessions > sessions ||
    outputTokens > totalTokens ||
    (totalTokens > 0 && sessions === 0)
  ) {
    return undefined;
  }
  if (kind === "measured") {
    // The verb projects the window's total at its rate (`weekAtRateOf`, `src/fleet/hostBurn.ts`): a figure that is not
    // that arithmetic is not the verb's, so it is refused rather than drawn as measured.
    const projectedWeekTokens = count({ bag, key: "projectedWeekTokens" });
    if (projectedWeekTokens === undefined || projectedWeekTokens !== Math.round((totalTokens * 7 * 24) / windowHours)) {
      return undefined;
    }
    return { activeSessions, kind, outputTokens, projectedWeekTokens, sessions, totalTokens };
  }
  if (kind === "partial") {
    const problems = strings({ bag, key: "problems" });
    if (problems === undefined) {
      return undefined;
    }
    return { activeSessions, kind, outputTokens, problems, sessions, totalTokens };
  }
  return undefined;
}

/**
 * Project `fleet burn --json` into the plan usage block's shape.
 *
 * @returns the report, or `undefined` when the payload is not one or either host will not read
 */
export function readFleetBurn(payload: unknown): FleetBurn | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const windowHours = count({ bag: payload, key: "windowHours" });
  const activeWithinMinutes = count({ bag: payload, key: "activeWithinMinutes" });
  const hosts = sub({ bag: payload, key: "hosts" });
  // The window's two instants are part of the measurement: a report missing either, or whose two do not span exactly the
  // hours it names, is not the verb's whole document.
  const fromIso = instant({ bag: payload, key: "fromIso" });
  const observedAtIso = instant({ bag: payload, key: "observedAtIso" });
  if (fromIso === undefined || observedAtIso === undefined || windowHours === undefined) {
    return undefined;
  }
  if (Date.parse(observedAtIso) - Date.parse(fromIso) !== windowHours * 3_600_000) {
    return undefined;
  }
  // A zero-length window is not a window: both are refused at zero as well as when they will not read.
  if (windowHours === 0 || activeWithinMinutes === undefined || activeWithinMinutes === 0 || hosts === undefined) {
    return undefined;
  }
  const claudeBag = sub({ bag: hosts, key: "claude" });
  const codexBag = sub({ bag: hosts, key: "codex" });
  if (claudeBag === undefined || codexBag === undefined) {
    return undefined;
  }
  const claudeBurn = hostBurnOf({ bag: claudeBag, windowHours });
  const codexBurn = hostBurnOf({ bag: codexBag, windowHours });
  if (claudeBurn === undefined || codexBurn === undefined) {
    return undefined;
  }
  return { activeWithinMinutes, claude: claudeBurn, codex: codexBurn, windowHours };
}

/**
 * The last recorded reading of `fleet burn`.
 *
 * @returns the reading, or `undefined`
 */
export function readFleetBurnReading(payload: unknown): Reading<FleetBurn> | undefined {
  return readingOf({ payload, read: readFleetBurn });
}
