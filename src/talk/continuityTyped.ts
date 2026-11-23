/**
 * The owner's turns typed straight into the supervisor's chat since the continuity floor, and why that read may have
 * stopped short of it — the chair's half of what the owner typed, read off the supervisor's own transcript window.
 *
 * Pure: the window is read by the caller (`./supervisorWindow.ts`).
 */
import { atOrAfter, type ContinuityTyped, type ContinuityUnread } from "./continuity.js";
import type { SupervisorWindow } from "./supervisorWindow.js";

/**
 * The owner's turns typed straight into the supervisor's chat in the window, newest first, each with the supervisor's
 * next turn when it came before the owner's next one. A relay the voice typed in is a steer, not one of these.
 *
 * @param window the current supervisor chat, newest first (`./supervisorWindow.ts`)
 * @param sinceIso the window's floor
 * @returns the turns, and a note when the chat's read stopped short of the floor
 */
export function typedTurnsOf({ window, sinceIso }: { window: SupervisorWindow; sinceIso: string }): {
  typed: readonly ContinuityTyped[];
  unread: readonly ContinuityUnread[];
} {
  const { exchanges } = window;
  const typed: ContinuityTyped[] = [];
  exchanges.forEach((exchange, index) => {
    if (exchange.who !== "owner" || exchange.viaVoice || !atOrAfter({ atIso: exchange.atIso, sinceIso })) {
      return;
    }
    const next = exchanges[index - 1];
    let reply: ContinuityTyped["reply"];
    if (next?.who === "chair") {
      reply = { atIso: next.atIso, text: next.text, ...cutFlag({ cut: next.cut }) };
    }
    typed.push({ atIso: exchange.atIso, reply, text: exchange.text, ...cutFlag({ cut: exchange.cut }) });
  });
  const unread = typedShortfallOf({ sinceIso, window });
  if (unread !== undefined) {
    return { typed, unread: [{ section: "typed", why: unread }] };
  }
  return { typed, unread: [] };
}

/** The flag a clipped turn carries, and nothing for a whole one, so an ordinary answer pays no bytes. */
function cutFlag({ cut }: { cut: boolean }): { readonly cut?: true } {
  if (!cut) {
    return {};
  }
  return { cut };
}

/**
 * Why the chat's read stopped short of the floor, or `undefined` when it reached it. Three things stop it: a line
 * that could not be decoded, the byte cap on the window, and the transcript tail itself — a chair's transcript
 * longer than the tail leaves every older turn unread with nothing omitted from the window.
 *
 * @param window the current supervisor chat, newest first
 * @param sinceIso the window's floor
 * @returns the reason, or `undefined`
 */
function typedShortfallOf({ window, sinceIso }: { window: SupervisorWindow; sinceIso: string }): string | undefined {
  const { exchanges } = window;
  // A line that is not a record at all carries no instant, so it may be an owner turn inside the window.
  if (window.undecodable > 0) {
    return `${String(window.undecodable)} line(s) of the chat could not be decoded, and an owner turn may be among them`;
  }
  // An owner turn whose time cannot be read cannot be placed either side of the floor.
  const undated = exchanges.filter((exchange) => exchange.who === "owner" && Number.isNaN(Date.parse(exchange.atIso)));
  if (undated.length > 0) {
    return `${String(undated.length)} owner turn(s) in the chat carry no readable time, so whether they came since cannot be told`;
  }
  const oldest = exchanges.at(-1);
  if (oldest === undefined) {
    if (window.tailCut) {
      return "the chat's read began past its start and held no turn, so earlier ones were not read";
    }
    return undefined;
  }
  // Only an oldest turn whose time reads can show the read reached the floor; an undated one proves nothing.
  const oldestDated = !Number.isNaN(Date.parse(oldest.atIso));
  if (oldestDated && !atOrAfter({ atIso: oldest.atIso, sinceIso })) {
    return undefined;
  }
  let back = "";
  if (oldestDated) {
    back = `, back to ${oldest.atIso}`;
  }
  if (window.omitted > 0) {
    return `only the chat's newest ${String(exchanges.length)} turns fitted the read${back}`;
  }
  if (window.tailCut) {
    return `the chat's read began past its start${back}`;
  }
  return undefined;
}
