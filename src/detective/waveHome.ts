/**
 * WHERE a detective wave lands — the one decision `store detect` and `knowledge detect` share about their
 * output directory, and the record each wave leaves beside its briefs.
 *
 * ## Why a wave belongs to its turn
 *
 * Measured: both verbs defaulted `--out` to `$SLOPWEAVER_HOME/detective/<ms>`, a directory
 * that did not exist, because every bot turn passed `--out` into its own session scratchpad under
 * `/private/tmp` — and a report there died with the session (`find ~/.slopweaver/live ~/.slopweaver/detective
 * -name 'report-*.md'` returned nothing). Neither place is the turn's record set, keyed `<channel>-<messageTs>`
 * under `live/slack/`, which is what survives the session and what `turn freeze` copies. The memories and findings that
 * accumulate as the detectives go have to land somewhere. With `--ask`, the wave lands in `live/slack/detectives/<key>/<kind>-<ms>/`.
 *
 * A wave with no `--ask` still lands under the detective root, because a session outside a bot turn has no
 * record set to join — but it SAYS so, since a wave the freeze will never find is exactly the loss this
 * module exists to end (`no-silent-fallback`).
 *
 * Pure: paths in, paths out. The caller supplies the clock and does the writing.
 */
import { join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import { parseAskArgument } from "../live/ask/askArgument.js";
import { stateHomePaths } from "../stateHome.js";

/** The two roots a wave can land under. */
export interface WaveRoots {
  /** `$home/detective` — a wave planned outside any bot turn. */
  readonly unattached: string;
  /** `$home/live/slack/detectives` — one `<channel>-<messageTs>/` directory per ask. */
  readonly recordSet: string;
}

/** Which verb planned a wave, and so how its directory and its record are named. */
export type WaveKind = "store" | "recall";

/** The file every wave writes beside its briefs, and the one `turn freeze` carries. */
export const WAVE_RECORD_FILE = "wave.json";

/** Where a wave's briefs and reports go, and the line to print when that place is outside any turn. */
export interface WaveOut {
  readonly out: string;
  readonly note: string | null;
}

/**
 * The two wave roots for a home.
 *
 * @param home the state home, defaulting to the ambient one
 * @returns both roots
 */
export function waveRoots({ home }: { home?: string } = {}): WaveRoots {
  const paths = home === undefined ? stateHomePaths() : stateHomePaths({ home });
  return { recordSet: paths.live.slack.detectives, unattached: paths.detective };
}

/**
 * Decide where one wave writes, from a verb's parsed flag values.
 *
 * The seam both detect verbs call, so neither parser carries the flag-reading branches itself.
 *
 * @param values the parsed single-value flags, read for `ask` and `out`
 * @param roots where the two kinds of default land
 * @param kind which verb is planning the wave
 * @param nowMs the planning instant, which names the wave's directory
 * @returns the directory and any line to print, or the refusal
 */
export function waveOutFromFlags({
  values,
  roots,
  kind,
  nowMs,
}: {
  values: Readonly<Record<string, unknown>>;
  roots: WaveRoots;
  kind: WaveKind;
  nowMs: number;
}): Result<WaveOut> {
  const ask = values["ask"];
  const out = values["out"];
  return resolveWaveOut({
    ask: typeof ask === "string" ? ask : undefined,
    kind,
    nowMs,
    out: typeof out === "string" ? out : undefined,
    roots,
  });
}

/**
 * Decide where one wave writes.
 *
 * `--ask` and `--out` together are refused rather than ranked: they name two different places, and quietly
 * picking one is how a wave meant for the record set ends up in a scratchpad again.
 *
 * @param ask the bot turn, as `<channel>/<messageTs>`, whose record set the wave joins
 * @param out a directory the caller named instead
 * @param roots where the two kinds of default land
 * @param kind which verb is planning the wave
 * @param nowMs the planning instant, which names the wave's directory
 * @returns the directory and any line to print, or the refusal
 */
function resolveWaveOut({
  ask,
  out,
  roots,
  kind,
  nowMs,
}: {
  ask: string | undefined;
  out: string | undefined;
  roots: WaveRoots;
  kind: WaveKind;
  nowMs: number;
}): Result<WaveOut> {
  const wave = `${kind}-${String(nowMs)}`;
  if (ask !== undefined && out !== undefined) {
    return err(["--ask and --out name two different places — pass one"]);
  }
  if (out !== undefined) {
    return ok({ note: null, out });
  }
  if (ask === undefined) {
    return ok({
      note:
        "this wave is outside any turn's record set, so `turn freeze` will not carry it — " +
        "a bot turn passes --ask <channel>/<messageTs>",
      out: join(roots.unattached, wave),
    });
  }
  const identity = parseAskArgument({ ask });
  // A Slack channel id and a message `ts` are fixed shapes, and checking them is what stops `C1/../../x`
  // joining its way out of the record set it names.
  const wellFormed =
    identity !== undefined && /^[A-Z0-9]+$/.test(identity.channel) && /^\d+\.\d+$/.test(identity.messageTs);
  if (identity === undefined || !wellFormed) {
    return err([`--ask must read <channel>/<messageTs>, got ${ask}`]);
  }
  return ok({ note: null, out: join(roots.recordSet, `${identity.channel}-${identity.messageTs}`, wave) });
}
