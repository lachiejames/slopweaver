/**
 * Every refusal the fleet's recovery path can record, and the ONE table that turns each into a reason in plain words
 * and at most one button.
 *
 * ## Typed at the producer, never parsed from prose
 *
 * A refusal reaches this table as a CODE its producer chose — `cmux reseat`'s own `ReseatError` codes, the routing
 * gate's `refusalKind`, and the recovery pass's own. The producer's text travels beside it as `raw` and is shown only
 * under a fold. Nothing here matches on wording, so a reworded refusal can never move a headline or lose a button.
 *
 * ## The first mapping is the gate the owner hit
 *
 * After a restart the owner re-seated their chair by hand and `cmux spawn … --model fable` refused it; the way
 * through was an escape hatch they had to find in the refusal's own text (`ALLOW_FABLE_OVERRIDE=1`). `MODEL_REFUSED`
 * is that gate on the recovery path, and its row carries the hatch as a button instead.
 *
 * ## One button, chosen by a fixed order
 *
 * When several refusals stand at once the page offers ONE action, chosen in `./headlineReason.ts`.
 *
 * Pure: values in, values out.
 */
import { reasonOf, signinHeadline, signinStep, storeReason } from "./storeRefusalReason.js";
import type { FleetReason } from "./types.js";

/** Every refusal code the recovery path records. `UNKNOWN` is a code a newer build wrote that this one cannot name. */
export type FleetRefusalCode =
  // `cmux reseat`'s own codes (`../sessions/reseatErrors.ts`), carried through unchanged.
  | "OWN_WORKSPACE"
  | "NO_LIVE_SESSION"
  | "NO_RESUMABLE_SESSION"
  | "NOT_COLD"
  | "NOT_AT_PROMPT"
  | "AMBIGUOUS_SESSION"
  | "UNSAFE_SESSION_ID"
  | "NO_MODEL"
  | "MODEL_REFUSED"
  | "BUSY"
  | "CMUX_READ_FAILED"
  | "STORE_REFUSED"
  | "KILL_TIMEOUT"
  | "RELAUNCH_FAILED"
  | "UNCONFIRMED"
  | "RESEAT_CONTENDED"
  | "WALL_CLEARED"
  | "RESEAT_LOCK_FAILED"
  // The recovery pass's own.
  | "HELD"
  | "SEAT_STILL_WALLED"
  | "SEAT_STILL_LIMITED"
  | "NO_CHAIR_PIN"
  | "CHAIR_ON_CODEX"
  | "CHAIR_REORIENTATION_TIMEOUT"
  | "CONSOLE_FAILED"
  | "CMUX_ACCESS_DENIED"
  | "CRASH_LOOP"
  | "SEAT_NOT_RESUMED"
  | "UNKNOWN";

/** Every known code, so a journal line naming any other one decodes to `UNKNOWN` rather than being dropped. */
export const FLEET_REFUSAL_CODES: readonly FleetRefusalCode[] = [
  "OWN_WORKSPACE",
  "NO_LIVE_SESSION",
  "NO_RESUMABLE_SESSION",
  "NOT_COLD",
  "NOT_AT_PROMPT",
  "AMBIGUOUS_SESSION",
  "UNSAFE_SESSION_ID",
  "NO_MODEL",
  "MODEL_REFUSED",
  "BUSY",
  "CMUX_READ_FAILED",
  "STORE_REFUSED",
  "KILL_TIMEOUT",
  "RELAUNCH_FAILED",
  "UNCONFIRMED",
  "RESEAT_CONTENDED",
  "WALL_CLEARED",
  "RESEAT_LOCK_FAILED",
  "HELD",
  "SEAT_STILL_WALLED",
  "SEAT_STILL_LIMITED",
  "NO_CHAIR_PIN",
  "CHAIR_ON_CODEX",
  "CHAIR_REORIENTATION_TIMEOUT",
  "CONSOLE_FAILED",
  "CMUX_ACCESS_DENIED",
  "CRASH_LOOP",
  "SEAT_NOT_RESUMED",
  "UNKNOWN",
];

/**
 * Which routing refusal a `STORE_REFUSED` was, or `token` when the plan's setup-token file refused.
 *
 * @internal
 */
export type StoreRefusalKind =
  "spent-plan" | "unreadable-plan" | "configuration" | "usage-limit" | "not-measured" | "paused" | "token";

/** One recorded refusal. */
export interface FleetRefusal {
  readonly code: FleetRefusalCode;
  /** The producer's own text — for the fold, never the headline. */
  readonly message: string;
  /** The code a newer build wrote, kept when this build decoded it as `UNKNOWN`. */
  readonly originalCode?: string;
  readonly workspaceRef?: string;
  /** The plan a credential refusal is about. */
  readonly alias?: string;
  readonly storeRefusal?: StoreRefusalKind;
}

/** What the table needs to name an account: each plan's bound or cached email. */
export interface FleetAccountNames {
  readonly emailFor: (options: { readonly alias: string }) => string | undefined;
}

/**
 * Map one refusal to a reason in plain words and at most one button.
 *
 * @param refusal what the recovery path recorded
 * @param accounts each plan's email, for a sign-in button
 * @returns the reason — its `raw` is the producer's text, for the fold only
 */
// max-lines-exempt: one exhaustive switch over the refusal codes, and its length IS the code count; splitting it would destroy the `never` default that makes an unmapped code a compile error.
export function mapFleetRefusal({
  refusal,
  accounts,
}: {
  refusal: FleetRefusal;
  accounts: FleetAccountNames;
}): FleetReason {
  const at = refusal.workspaceRef === undefined ? "" : ` (${refusal.workspaceRef})`;
  switch (refusal.code) {
    case "OWN_WORKSPACE":
      return reasonOf({
        detail: `Recovery skipped the tab it runs in${at}.`,
        headline: "Recovery would stop the tab running recovery.",
        refusal,
      });
    case "NO_LIVE_SESSION":
      return reasonOf({
        detail: `No Claude session runs in this seat${at}, and recovery never starts a fresh one in its place — that would lose the conversation. Once its tab shows a shell prompt, run recovery again; a worker seat still refused is re-seated with \`slopweaver session re-seat\`, the chair never.`,
        headline: "This seat has no session to resume.",
        refusal,
      });
    case "NO_RESUMABLE_SESSION":
      return reasonOf({
        detail: `This seat is a bare shell${at} and its saved conversation is not on disk, so recovery has nothing to resume — and it never starts a fresh session in its place. Tell the supervisor which row it was.`,
        headline: "This seat's saved conversation could not be found.",
        refusal,
      });
    case "NOT_COLD":
      return reasonOf({
        detail: `Something started in this seat${at} while recovery was about to resume it, so nothing was typed. Recovery reads it again on the next attempt.`,
        headline: "A seat came back on its own while recovery was resuming it.",
        refusal,
      });
    case "NOT_AT_PROMPT":
      return reasonOf({
        detail: `Recovery stopped the old session in this seat${at}, and something other than a bare shell was left, so nothing was typed. Read the seat's screen.`,
        headline: "A seat did not come back to a shell prompt after its old session was stopped.",
        refusal,
      });
    case "AMBIGUOUS_SESSION":
      return reasonOf({
        detail: `Recovery will not guess which one to resume${at}.`,
        headline: "More than one Claude session is running in this seat.",
        refusal,
      });
    case "UNSAFE_SESSION_ID":
      return reasonOf({
        detail: `The id is not a session id, so it is never put on a launch line${at}.`,
        headline: "This seat's session id is not safe to relaunch.",
        refusal,
      });
    case "NO_MODEL":
      return reasonOf({
        detail: `Nothing records which model this seat runs, and recovery never guesses one${at}.`,
        headline: "Nothing records which model this seat must resume on.",
        refusal,
      });
    case "MODEL_REFUSED":
      return {
        ...reasonOf({
          detail: `This seat was running on Fable${at}, and Fable on a worker needs your override — the same one \`cmux spawn\` asked for after the restart.`,
          headline: "This seat runs on Fable, and resuming it needs your override.",
          refusal,
        }),
        handStep: {
          action: { hatch: "ALLOW_FABLE_OVERRIDE", kind: "policy-override" },
          id: "policy-override:ALLOW_FABLE_OVERRIDE",
          label: "Resume it on Fable",
          note: "A seat was running on Fable. Resume it on Fable?",
        },
      };
    case "BUSY":
      return reasonOf({
        detail: `It is mid-turn${at}; stopping it now would lose that turn, so it is left alone.`,
        headline: "This session is still working.",
        refusal,
      });
    case "CMUX_READ_FAILED":
    case "CMUX_ACCESS_DENIED":
      return reasonOf({
        detail: `The recovery tab could not read cmux${at}. Nothing was stopped.`,
        headline: "The recovery tab could not read cmux.",
        refusal,
      });
    case "STORE_REFUSED":
      return storeReason({ accounts, refusal });
    case "KILL_TIMEOUT":
      return reasonOf({
        detail: `The old session would not stop${at}, so nothing was typed into it.`,
        headline: "The old Claude session did not stop.",
        refusal,
      });
    case "RELAUNCH_FAILED":
      return reasonOf({
        detail: `The old session stopped but the new one did not start${at}.`,
        headline: "A seat stopped but did not relaunch.",
        refusal,
      });
    case "UNCONFIRMED":
      return reasonOf({
        detail: `The launch line was sent${at} and the session never came back.`,
        headline: "A seat was relaunched and never came back.",
        refusal,
      });
    case "RESEAT_CONTENDED":
      return reasonOf({
        detail: `Another reseat was already working on this seat${at}, so recovery left it to that one and typed nothing. The next attempt reads whatever it left.`,
        headline: "Another reseat was already bringing this seat back.",
        refusal,
      });
    case "WALL_CLEARED":
      return reasonOf({
        detail: `This seat was walled when recovery picked it${at}, and by the time it held the seat it no longer was, so nothing was stopped or typed. The next attempt reads it again.`,
        headline: "A seat came back before recovery reached it.",
        refusal,
      });
    case "RESEAT_LOCK_FAILED":
      return reasonOf({
        detail: `Recovery could not take this seat's reseat lock${at}, so nothing was stopped or typed. The reason is below.`,
        headline: "Recovery could not take this seat's reseat lock.",
        refusal,
      });
    case "HELD":
      return reasonOf({
        detail: "The machine is too busy to start another seat safely. The rest wait for the next attempt.",
        headline: "The machine is still too busy to recover the next seat.",
        refusal,
      });
    case "SEAT_STILL_WALLED":
      if (refusal.alias !== undefined) {
        return {
          ...reasonOf({
            detail: `The seat relaunched on ${refusal.alias}'s own login, and that login is signed out${at}. Signing in once fixes every seat on it.`,
            headline: signinHeadline({ accounts, alias: refusal.alias }),
            refusal,
          }),
          handStep: signinStep({ accounts, alias: refusal.alias }),
        };
      }
      return reasonOf({
        detail: `The seat came back still asking for a login${at}, on no plan Slopweaver knows.`,
        headline: "A seat came back still signed out.",
        refusal,
      });
    case "SEAT_STILL_LIMITED":
      return reasonOf({
        detail: `The seat relaunched${at} and is waiting for its plan's usage window to reset. Recovery tries it again; there is nothing for you to do.`,
        headline: "A seat came back on a plan at its usage limit.",
        refusal,
      });
    case "NO_CHAIR_PIN":
      return reasonOf({
        detail: "Nothing records which session is the supervisor, so recovery cannot bring it back first.",
        headline: "There is no supervisor to resume.",
        refusal,
      });
    case "CHAIR_ON_CODEX":
      return reasonOf({
        detail:
          "The pin names a Codex chair, and recovery resumes only Claude sessions, so it was left alone and no other seat waited on it.",
        headline: "The supervisor runs on Codex, which recovery does not resume.",
        refusal,
      });
    case "CHAIR_REORIENTATION_TIMEOUT":
      return reasonOf({
        detail: "The supervisor is running, but it has not said it is caught up, so no other seat was started.",
        headline: "The supervisor is back but has not said it is caught up.",
        refusal,
      });
    case "CONSOLE_FAILED":
      return reasonOf({
        detail: "The console did not come back. The seats are recovered regardless.",
        headline: "The console did not start.",
        refusal,
      });
    case "CRASH_LOOP":
      return reasonOf({
        detail: `Recovery kept bringing this seat back${at} and it kept falling over, so it stopped restarting it. The supervisor has been asked to find the cause and bring it back once it is fixed — nothing here needs you.`,
        headline: "A seat keeps falling over after being brought back — the supervisor is investigating it instead.",
        refusal,
      });
    case "SEAT_NOT_RESUMED":
      return reasonOf({
        detail: `This seat${at} had no conversation on disk to resume, so it came back as a fresh, empty Claude session. A worker is re-seated from its row by the next \`session close-done\`; the supervisor's seat needs a new /slopweaver:supervisor chat.`,
        headline: "A seat came back empty: its conversation was never saved.",
        refusal,
      });
    case "UNKNOWN":
      return reasonOf({
        detail: "The original text is below.",
        headline: "Recovery stopped at a step Slopweaver does not understand yet.",
        refusal,
      });
    default: {
      const unreachable: never = refusal.code;
      return unreachable;
    }
  }
}
