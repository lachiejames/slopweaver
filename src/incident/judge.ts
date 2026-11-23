/**
 * The read-only view `incident detect` prints: every incident-shaped channel, judged exactly as the live sweep judges
 * one — incident or drill, when it opened, and whether it is inside the live window now — with nothing registered.
 *
 * It exists so the convention can be checked against the whole corpus by eye: a channel the sweep would miss, or a
 * drill it would take for an incident, shows up here as a line rather than as a row nobody expected.
 */
import { epochSecondsToIso } from "../lib/date.js";

import { classifyIncidentChannel, type IncidentChannel, incidentsCreatorOf, liveAdmission } from "./channel.js";

/** One incident-shaped channel, judged. */
export interface JudgedIncidentChannel {
  readonly id: string;
  readonly name: string;
  readonly verdict: "incident" | "drill";
  /** When it opened, or absent when the capture carried no creation time. */
  readonly openedIso?: string;
  /** Whether the live sweep would admit it now; a drill never is. */
  readonly live: boolean;
  /** Why it is not live, when it is not. */
  readonly why?: string;
  readonly evidence: readonly string[];
}

/**
 * Judge every incident-shaped channel, newest first.
 *
 * @param channels the corpus's channels at their newest capture
 * @param nowEpochSeconds the instant the live window is judged against
 * @param sinceEpochSeconds keep only channels opened at or after this instant, when set; a channel with no creation
 *   time is dropped by it, since it cannot be shown to have opened after anything
 * @returns the incident and drill channels, opened-newest first, undated last
 */
export function judgeIncidentChannels({
  channels,
  nowEpochSeconds,
  sinceEpochSeconds,
}: {
  channels: readonly IncidentChannel[];
  nowEpochSeconds: number;
  sinceEpochSeconds: number | undefined;
}): readonly JudgedIncidentChannel[] {
  const incidentsCreator = incidentsCreatorOf({ channels });
  const judged: JudgedWithOrder[] = [];
  for (const channel of channels) {
    const one = judgeOne({ channel, incidentsCreator, nowEpochSeconds, sinceEpochSeconds });
    if (one !== undefined) {
      judged.push(one);
    }
  }
  return judged
    .toSorted((left, right) => newestFirst({ left: left.created, right: right.created }))
    .map((one) => one.row);
}

/** A judged channel and the creation time it sorts by — undated sorts last. */
interface JudgedWithOrder {
  readonly created: number;
  readonly row: JudgedIncidentChannel;
}

/**
 * Judge one channel, or drop it: not incident-shaped, or opened before `sinceEpochSeconds` (undated included).
 *
 * @param channel the channel
 * @param incidentsCreator who created `#incidents`, when the batch knows
 * @param nowEpochSeconds the instant the live window is judged against
 * @param sinceEpochSeconds the earliest opening kept, when set
 * @returns the judged row and its sort key, or `undefined` when it is dropped
 */
function judgeOne({
  channel,
  incidentsCreator,
  nowEpochSeconds,
  sinceEpochSeconds,
}: {
  channel: IncidentChannel;
  incidentsCreator: string | undefined;
  nowEpochSeconds: number;
  sinceEpochSeconds: number | undefined;
}): JudgedWithOrder | undefined {
  const verdict = classifyIncidentChannel({ channel, incidentsCreator });
  const created = channel.createdEpochSeconds;
  const openedTooEarly = sinceEpochSeconds !== undefined && (created === undefined || created < sinceEpochSeconds);
  if (verdict.kind === "not-incident" || openedTooEarly) {
    return undefined;
  }
  const openedIso = created === undefined ? undefined : epochSecondsToIso({ seconds: created });
  const base = {
    evidence: verdict.evidence,
    id: channel.id,
    name: channel.name,
    ...(openedIso === undefined ? {} : { openedIso }),
  };
  // A channel with no creation time sorts first, so a dated one is always the latest.
  let order = Number.NEGATIVE_INFINITY;
  if (created !== undefined) {
    order = created;
  }
  if (verdict.kind === "drill") {
    return { created: order, row: { ...base, live: false, verdict: "drill", why: `names itself "${verdict.token}"` } };
  }
  const admission = liveAdmission({ channel, nowEpochSeconds });
  const live = admission.admit ? { live: true } : { live: false, why: admission.why };
  return { created: order, row: { ...base, ...live, verdict: "incident" } };
}

/** A comparator over creation times, newest first — two undated channels compare equal rather than as `NaN`. */
function newestFirst({ left, right }: { left: number; right: number }): number {
  if (left === right) {
    return 0;
  }
  return right > left ? 1 : -1;
}
