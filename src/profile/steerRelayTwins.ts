/**
 * One turn of the owner's recorded twice is one point: a console relay of a call stretch and the stretch itself both reach
 * the steer journal, and `steerKindsReading` (`./steerKinds.ts`) draws only one of them. Pure.
 */
import type { SteerPoint } from "./steerKinds.js";

/**
 * How far a console relay can land from the call stretch it relayed. A relay records no call or segment id
 * (`ownerWords.ts`), so the instant is the only tie. MEASURED over the 22 relay verdicts whose kind and
 * quote a call-stretch verdict also carries: the stretch fell 263s before to 44s after the relay. Repro:
 * `slopweaver store export --out <dir>`, read each envelope of `<dir>/steer-kinds.jsonl` and take its `exactText`
 * (the store's exact line) where that line says `"corrects"`, pair `talk:` with `talk-call:` rows on kind and
 * quote, and difference their `turnAtIso`.
 */
const RELAY_TWIN_MS = 10 * 60_000;

/**
 * A kind's points with every console relay dropped that a call stretch already says, the same way, within
 * `RELAY_TWIN_MS` — the relay and the stretch are one turn of the owner's recorded twice, and one turn is one point. A relay with no such stretch stays: it is
 * then the only record of what the owner said.
 *
 * @param points one kind's judged points
 * @returns the points with relay twins dropped, in the order given
 */
export function withoutRelayTwins({ points }: { points: readonly SteerPoint[] }): readonly SteerPoint[] {
  const stretches = points.filter((point) => point.anchor.startsWith("talk-call:"));
  return points.filter(
    (point) =>
      !point.anchor.startsWith("talk:") ||
      !stretches.some(
        (stretch) =>
          stretch.says === point.says && Math.abs(Date.parse(stretch.atIso) - Date.parse(point.atIso)) <= RELAY_TWIN_MS,
      ),
  );
}
