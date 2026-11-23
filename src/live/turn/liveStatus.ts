/**
 * Deriving a short, human-readable "what's happening right now" line from a `fresh-visible-session`
 * workspace's own live terminal screen — the primitive that lets the checklist's in-flight step show
 * genuinely current text instead of a static "Investigate in a fresh visible session" for the whole
 * duration of a slow turn.
 *
 * ## A best-effort scrape, honestly labelled as one
 *
 * Unlike `../../cmux/client.ts`'s `readScreen` (measured live against real cmux) or `dispatch.ts`'s
 * `freshScreenTruth` (a strict marker match), this is a HEURISTIC over free-form terminal text with no
 * fixed grammar — a visible session's screen can show anything from a tool call to a wall of JSON to a shell
 * prompt sitting idle. It is deliberately conservative: it surfaces the last non-blank line when there is
 * one worth showing, and says nothing rather than guessing at a line that is plainly not informative (a bare
 * shell prompt, or nothing at all). A caller that wants MORE structure than "the last thing printed" needs a
 * real reporting protocol from the dispatched session itself, not a screen scrape — see the handover doc's
 * own tradeoff note on this.
 */

import { clampVisible } from "./answer.js";
import { LIVE_STATUS_CAP } from "./liveStatusCap.js";

/**
 * Whether a piece of screen text says anything a reader could act on: it must carry at least one letter or
 * digit. Pure.
 *
 * **The criterion is "no letter or digit", not "made of box-drawing".** An enumerated character class is
 * what let this through: `/^[$>%#❯›─]*\s*$/` was the earlier test, it required the WHOLE line to be one run
 * of rule characters, and Claude Code's own input box is drawn as a long rule, a space, then a second short
 * one. MEASURED on ask `C0SYN000009/1789344513.735589` — the card the owner was watching took
 * four consecutive writes whose entire detail was the single character `─`, spread over about 19 minutes,
 * and read as frozen for the 6.1m and 6.6m between them. Reproduce the class:
 *
 * ```bash
 * grep -c '"detail":"─"' "$SLOPWEAVER_HOME/live/slack/progress/C0SYN000009-1789344513.735589.jsonl"
 * ```
 *
 * Applied at BOTH ends for one reason each: {@link lastInformativeLine} keeps scanning upward past such a
 * line rather than stopping on it, and {@link liveStatusFromScreen} re-checks the CLAMPED result, because
 * `clampVisible`'s own `stripCardNoise` removes a divider run at its seam and can leave a survivor — which
 * is exactly how a 120-character rule became that one-character detail.
 *
 * @param text the candidate line, raw or clamped
 * @returns whether it carries anything worth putting on a card
 */
export function carriesInformation({ text }: { text: string }): boolean {
  return /\p{L}|\p{N}/u.test(text);
}

/**
 * Claude Code's own persistent status chrome — the permission-mode indicator ("shift+tab to cycle"), the
 * sidebar agent-count chip ("← N agents"/"→ N agents"), and the trailing slash-command hint row (a lone
 * `/rc`-shaped token, right-padded to the terminal width, that Claude Code draws on its OWN last row below
 * both of the other two). All three sit near the bottom of every Claude Code screen regardless of what the
 * session is actually doing, so a raw scrape that only skips blank/prompt-only lines picks one of them as
 * "the last informative line" whenever it happens to be the lowest non-blank row — which made two dispatched
 * sessions doing genuinely different work show the IDENTICAL checklist status text (the first two shapes),
 * and made a real turn's card show the literal string `/rc` for five minutes (the third — measured live,
 * `docs/`-free repro in `liveStatusFromScreen`'s own test file). The hint only owns its own row at a narrow
 * terminal width; at a wider one it wraps onto the SAME row as the permission chrome, where the first
 * alternative already matches it.
 */
const UI_CHROME_LINE = /shift\+tab to cycle|[←→]\s*\d+\s+agents?\b|^\/[a-zA-Z][\w-]*$/i;

/**
 * Pick the last informative line off a raw screen read. Pure.
 *
 * @param screen the workspace's current screen text, from `readScreen`
 * @returns the last non-blank, non-prompt-only, non-chrome line, or `undefined` when the screen has nothing
 *   worth showing
 */
function lastInformativeLine({ screen }: { screen: string }): string | undefined {
  const lines = screen.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!.trim();
    if (carriesInformation({ text: line }) && !UI_CHROME_LINE.test(line)) {
      return line;
    }
  }
  return undefined;
}

/**
 * Derive the checklist's live in-flight detail from a `fresh-visible-session` workspace's current screen.
 * Pure and total — never throws, never reads a clock.
 *
 * @param screen the workspace's current screen text, from `readScreen`
 * @returns a clamped, human-readable status line, or `undefined` when the screen has nothing worth showing
 */
export function liveStatusFromScreen({ screen }: { screen: string }): string | undefined {
  const line = lastInformativeLine({ screen });
  if (line === undefined) {
    return undefined;
  }
  // `clampVisible` strips a divider run or session key at its own seam, so what SURVIVES it can carry less
  // than what went in — empty, or the one-character remnant of a rule. Either is still "worth showing" to
  // `??` unless this says otherwise explicitly. See {@link carriesInformation} for the measured turn.
  const clamped = clampVisible({ cap: LIVE_STATUS_CAP, text: line });
  return carriesInformation({ text: clamped }) ? clamped : undefined;
}

/**
 * How long a dispatched turn may go without its screen showing anything informative before the card says so.
 *
 * Five minutes rather than the lease's two hours, because the two numbers answer different questions: the
 * lease asks "may this ask be re-judged?", and this asks "is the reader still being told the truth?". A card
 * that has shown the same in-flight step for five minutes is already reading as stuck to the person waiting
 * on it, and the owner's own report is that they then go and ask a session about it — which is the cost this
 * exists to remove.
 */
export const CHECKLIST_STALL_AFTER_MS = 5 * 60 * 1000;

/**
 * The card's own "nothing has been reported for a while" line, or `undefined` while the turn is still
 * inside its grace window. Pure — the clock is injected, never read.
 *
 * Says WHEN it was last heard from rather than only that it has been quiet, because "last heard 13:07" is
 * something a reader can act on (go and look at that session) and "no progress" is not.
 *
 * @param lastHeardIso when this turn last produced an event or a live detail
 * @param nowIso the current instant
 * @param stallAfterMs how long silence may last before it is worth saying; defaults to
 *   {@link CHECKLIST_STALL_AFTER_MS}
 * @returns the clamped line to show on the in-flight step, or `undefined` when the silence is not yet worth
 *   reporting or the timestamps cannot be read
 */
export function stalledDetail({
  lastHeardIso,
  nowIso,
  stallAfterMs = CHECKLIST_STALL_AFTER_MS,
}: {
  lastHeardIso: string;
  nowIso: string;
  stallAfterMs?: number;
}): string | undefined {
  const lastHeard = Date.parse(lastHeardIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(lastHeard) || Number.isNaN(now)) {
    return undefined;
  }
  const silentMs = now - lastHeard;
  if (silentMs < stallAfterMs) {
    return undefined;
  }
  const minutes = Math.floor(silentMs / 60_000);
  const clock = lastHeardIso.slice(11, 16);
  return clampVisible({
    cap: LIVE_STATUS_CAP,
    text: `handed to a session, last heard ${clock}Z — nothing reported for ${String(minutes)}m`,
  });
}
