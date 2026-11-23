/**
 * Whether a component mounting onto a live channel starts a read of its own — pure, so the rule is a unit test.
 *
 * MEASURED with `slopweaver perf console`: a sidebar click from Pull requests to the Queue started twelve
 * `/api/live` reads, every one a child process, though the shell had read eleven of those same slugs seconds before
 * and was still polling them. The Queue badge, the voice and the PR badge keep those channels alive on every page,
 * and each tile the new page mounted joined one and read it again at once. Three slots and a child process apiece
 * turned that into eleven seconds before the page stopped saying "loading".
 *
 * A mount now RIDES a channel that another component is already keeping current, as long as the channel's last
 * answer is younger than the interval that channel promises. Nothing about freshness moves: a polled channel's own
 * timer already guarantees an answer that young, and that timer keeps running. Everything else still reads on
 * mount, exactly as before — a first mount, a mount that itself reads once (it asked for no poll, so a younger-than-the-
 * channel-poll answer is no promise it made), a channel every subscriber reads once (nothing keeps it current, so a
 * second read-once mount riding the first would never see the register move), a channel rebuilt from a kept
 * reading (`liveRetained.ts`), whose age nothing has bounded, and every press (`refreshLive`), which must never be
 * answered from before its write.
 */

/**
 * Whether a mount joining a channel starts a read.
 *
 * @param joinedLive the channel already had a subscriber before this one joined
 * @param hasLast the channel holds an answer to hand over
 * @param supersede the mount knows the register moved, so nothing from before now may be shown
 * @param answeredAtMs when the channel's last answer landed, on this page's clock; `undefined` when unknown
 * @param askedEveryMs the joining mount's own poll interval, `undefined` when it reads once
 * @param everyMs the channel's poll interval BEFORE this mount joined, `undefined` while every subscriber reads once
 * @param nowMs now, on the same clock
 * @returns true to read now, false to hand over the channel's answer as current
 */
export function joinReads({
  joinedLive,
  hasLast,
  supersede,
  answeredAtMs,
  askedEveryMs,
  everyMs,
  nowMs,
}: {
  joinedLive: boolean;
  hasLast: boolean;
  supersede: boolean;
  answeredAtMs: number | undefined;
  askedEveryMs: number | undefined;
  everyMs: number | undefined;
  nowMs: number;
}): boolean {
  if (supersede || !joinedLive || !hasLast || answeredAtMs === undefined || askedEveryMs === undefined) {
    return true;
  }
  if (everyMs === undefined) {
    return true;
  }
  // Younger than the poll that already ran AND than the joiner's own: a 5s mount joining a 60s poll rides 4s, not 30s.
  const age = nowMs - answeredAtMs;
  // A negative age is a clock that cannot be trusted, never an answer from the future: read.
  return age < 0 || age >= Math.min(askedEveryMs, everyMs);
}
