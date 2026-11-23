/**
 * A SECOND, independent witness that a send actually landed on a cmux surface — cmux's own
 * `latest_submitted_message`, read back from the workspace inventory rather than scraped off the screen.
 *
 * ## Why a second witness exists at all
 *
 * `./spawn.ts`'s `pollForSendLanded` confirms a send by reading the SCREEN back. Measured live three times
 * now (two recipe dispatches among them), that check produces a FALSE NEGATIVE under concurrent cmux load:
 * `read-screen` throws `internal_error: Failed to read terminal text` on a surface that is genuinely fine,
 * every tick of the allotted budget, so the whole budget is spent without ever getting a clean look. Both
 * recipe children had in fact received their pickup, booted, investigated and posted — the caller was told
 * the send never landed while the child was already working.
 *
 * Raising the poll budget was the previous fix and it is the fix that just failed: the bound already grew
 * from 5 to 15 ticks and three incidents later the failure shape is unchanged. So this module changes the
 * failure MODE instead — a screen-read that never gets a clean look is now a reason to ask a different
 * question, not a verdict.
 *
 * ## What `latest_submitted_message` actually is — a precondition, measured
 *
 * It is the last text the AGENT SESSION on that surface accepted as a submitted prompt, not a raw terminal
 * echo. Measured live: sending text to a workspace whose surface is a bare shell leaves the
 * field `null`, while every workspace running a real `claude` session reports the prompt it was given. That
 * matters here in one direction only, and it is the safe one: a child whose `claude` has not finished
 * booting reports `null`, this module returns `false`, and the caller reports the dispatch failure it would
 * have reported anyway. The corroboration can only ever RESCUE a dispatch, never invent one.
 *
 * ## The truncation this module exists to encode
 *
 * `cmux workspace list --json` reports each workspace's `latest_submitted_message` — the last text cmux
 * itself accepted for that workspace, independent of whatever the terminal is currently able to render.
 * **It is truncated to {@link CMUX_SUBMITTED_MESSAGE_MAX_CHARS} characters with a trailing `…`**, measured
 * live against cmux 0.64.22: every one of six long real pickup lines came back at exactly
 * 240 characters ending in a single U+2026, while shorter ones came back whole. A dispatched recipe child's
 * pickup prompt is ~554 characters, so an equality or `includes` check against it can NEVER match — which
 * is precisely the trap this module is written to keep a caller out of. The comparison is a PREFIX
 * comparison, always.
 */

/** How many characters cmux keeps of a workspace's last submitted message before truncating with `…`. */
export const CMUX_SUBMITTED_MESSAGE_MAX_CHARS = 240;

/**
 * The shortest prefix this module accepts as corroboration.
 *
 * A prefix comparison against a one-character observation would match almost anything, so a short
 * observation is only ever accepted as an EXACT whole-text match. 40 characters is comfortably inside
 * cmux's own 240-character window while being far longer than any incidental shared opening — a recipe
 * child's pickup line, for instance, still carries its generation-bound request path well inside it.
 */
const MIN_CORROBORATING_PREFIX_CHARS = 40;

/** The single character cmux appends when it truncates, and the ASCII spelling, both stripped defensively. */
const TRUNCATION_MARKERS = ["…", "..."] as const;

/**
 * Collapse every run of whitespace to one space and trim — so a comparison survives a terminal wrapping a
 * long line, and survives cmux truncating mid-whitespace.
 *
 * @param text the raw text to normalise
 * @returns the same text with every run of whitespace collapsed to one space, trimmed
 */
export function normalizeSentText({ text }: { text: string }): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** Drop one trailing truncation marker, if cmux appended one. */
function withoutTruncationMarker({ text }: { text: string }): string {
  const marker = TRUNCATION_MARKERS.find((candidate) => text.endsWith(candidate));
  return marker === undefined ? text : text.slice(0, -marker.length).trimEnd();
}

/**
 * Whether a workspace's `latest_submitted_message` corroborates that `sentText` was the last thing
 * delivered to it — the truncation-aware prefix comparison this module's header explains.
 *
 * This is deliberately NOT an identity check: the caller is expected to already hold the exact
 * `workspaceRef` it created, so which workspace this is has been settled before this function is reached.
 * All this answers is whether the text cmux last accepted for that workspace is the text the caller sent.
 *
 * @param latestSubmittedMessage the workspace's reported last submitted message, or undefined when it has none
 * @param sentText the exact text the caller sent, before any truncation
 * @returns whether the observed message corroborates the send
 */
export function submittedMessageConfirmsSend({
  latestSubmittedMessage,
  sentText,
}: {
  readonly latestSubmittedMessage: string | undefined;
  readonly sentText: string;
}): boolean {
  if (latestSubmittedMessage === undefined) {
    return false;
  }
  const observed = withoutTruncationMarker({ text: normalizeSentText({ text: latestSubmittedMessage }) });
  const sent = normalizeSentText({ text: sentText });
  if (observed.length === 0 || sent.length === 0) {
    return false;
  }
  if (observed === sent) {
    return true;
  }
  return observed.length >= MIN_CORROBORATING_PREFIX_CHARS && sent.startsWith(observed);
}
