/**
 * The `profile-held` PreToolUse decision: a session whose context does not hold the owner's profile acts on nothing
 * until it does, and the refusal that holds it is what delivers the profile.
 *
 * Doing nothing beats acting misaligned for the owner, and recovery has to be automatic, never a floating note or a
 * word the owner must say each time. MEASURED: every one of seven unloaded sessions was the `SessionStart` profile
 * hook killed "after 7s" while node booted under load, most of them at a compaction, and each carried on acting with
 * no profile.
 *
 * ## What "held" means, and why the refusal is the delivery
 *
 * Claude Code shows a PreToolUse refusal's stderr to the model, so a refused call is a channel into the very context
 * that lost the profile. The first guarded call after a failed load is refused WITH the profile in its text, and the
 * delivery marker (`../context/profileDelivery.ts`) is written behind it, so the session re-runs the call holding what
 * it lacked: recovery in one turn, with nobody's hand on it. Only when no copy exists anywhere is it held outright,
 * and then the one call let through is the by-hand reload, which reads the store live — unless the machine was
 * never configured at all, a first boot, which is not held (see {@link FirstBootEvidence}).
 *
 * Pure: the load is a thunk the runner supplies, so this decides without touching a file.
 */
import type { LoadedContext } from "../context/cachedContext.js";
import { PROFILE_RELOAD_COMMAND, unloadedWarningLines } from "../context/loadLedger.js";

/**
 * The surviving evidence that a home was ever configured, read by `./profileFirstBoot.ts` across the resolved home
 * and `~/.slopweaver`.
 *
 * ## Why a first boot is not held
 *
 * Keep holding when a profile EXISTS and was not loaded, but when none exists yet there is nothing to block and
 * holding is self-imposed hardship — onboarding creates the first profile, and must never trap anyone. So on a never-configured machine EVERY call runs, whatever
 * its tool or command: holding it left nothing runnable but a reload that cannot succeed until the store it would
 * set up exists (`yarn store:start`, which locks the stack and selects it, then `slopweaver store push`). A reachable store with
 * no owner row is the same state one step later — "a fresh install genuinely has none" (`ownerReadFailure`,
 * `../context/load.ts`) — so that live read caches nothing and, here, is a first boot too. The door's `PROFILE_NOT_LOADED` hold opens on the same evidence
 * (`./profileLoadGate.ts`), since a first boot's `profile context` records no load that could ever clear it.
 *
 * What counts is evidence the owner's PROFILE existed here, never that a store was selected: onboarding selects the
 * store before its schema or any profile exists, and holding on the selection wedges `store push`
 * (`./ownerProfileWritten.ts`). The carve-out is "no SURVIVING evidence", which is all a filesystem can say: a home whose
 * every trace was deleted reads as a fresh one. Every trace counts, and an unreadable one counts as present.
 */
export interface FirstBootEvidence {
  /** `slopweaver profile set` left its `profile/owner-written` mark: the owner row was written from this machine. */
  readonly ownerWritten: boolean;
  /** A cached context, `profile/context.json` or its `context.txt` copy, exists. */
  readonly cacheExists: boolean;
  /** The load ledger records a `live` or `cache` load, or a delivery marker exists. */
  readonly everLoaded: boolean;
}

/**
 * Whether the evidence says this machine was never configured: no profile written, cached or ever held.
 *
 * @param evidence what the read found
 * @returns true only when every signal is absent
 */
export function neverConfigured({ evidence }: { evidence: FirstBootEvidence }): boolean {
  return !evidence.ownerWritten && !evidence.cacheExists && !evidence.everLoaded;
}

/** What one guarded call meets. */
export type ProfileHeldDecision =
  | { readonly kind: "pass" }
  /** A never-configured machine: nothing to misalign with, so the call runs, and nothing is recorded or marked. */
  | { readonly kind: "first-boot" }
  /** The owner's profile, delivered in the refusal; the runner records the load and writes the marker. */
  | { readonly kind: "deliver"; readonly lines: readonly string[]; readonly loaded: LoadedContext }
  /** No copy anywhere: held, with the one way out named. No marker. */
  | { readonly kind: "stop"; readonly lines: readonly string[]; readonly loaded: LoadedContext };

/**
 * The by-hand reload, the one call a held session may make: the bare launcher on `PATH`, with or without `--json`.
 * Never a path to one — any executable can be named `slopweaver` — and anything chained
 * onto it is not it. Spaces and tabs only: a newline ends a shell command, so `slopweaver profile\ncontext` is two
 * of them. `PROFILE_RELOAD_PATTERN` in `hooks/lib/profile-delivered.sh` is its bash twin, for
 * the hold no node can run; change both or neither.
 */
const RELOAD_PATTERN = /^[ \t]*slopweaver[ \t]+profile[ \t]+context(?:[ \t]+--json)?[ \t]*$/u;

/**
 * Whether a Bash command is exactly the by-hand reload.
 *
 * @param command the Bash call's command, `undefined` for any other tool
 * @returns true only for `slopweaver profile context [--json]`
 */
export function isProfileReload({ command }: { command: string | undefined }): boolean {
  return command !== undefined && RELOAD_PATTERN.test(command);
}

/** The line every held call opens on, so a reader of the refusal knows it is this check before anything else. */
export const PROFILE_HELD_HEADLINE =
  "# HELD — this call waited for the owner's profile, which this session's context lacked";

/**
 * What a payload naming no session is told. Both hosts' PreToolUse input schemas REQUIRE `session_id` (Claude Code's,
 * and the `pre-tool-use.command.input` the vendored Codex binary carries), so one without it is no host's tool call,
 * and passing it would be the one unconditional way past the hold.
 */
export const PROFILE_HELD_ANONYMOUS_LINES: readonly string[] = [
  PROFILE_HELD_HEADLINE,
  "",
  "This PreToolUse payload names no session_id a delivery of the owner's profile can be recorded under (letters, digits and",
  "dashes), so nothing can say this context holds it. Both Claude Code and Codex send a UUID on every tool call; a",
  "payload without one is malformed, and it is refused rather than run unaligned.",
];

/**
 * Decide one guarded call.
 *
 * @param delivered whether this session's current context holds the owner's profile, read off its marker
 * @param command the Bash call's command, `undefined` for any other tool
 * @param load reads the owner's profile from the last-known-good copy; called only when it is needed
 * @param firstBoot reads the first-boot evidence, `undefined` when it could not be read; called only when no copy
 *   loaded, so a home holding one is never asked
 * @returns pass, first-boot, deliver, or stop
 */
export function profileHeldDecision({
  delivered,
  command,
  load,
  firstBoot,
}: {
  delivered: boolean;
  command: string | undefined;
  load: () => LoadedContext;
  firstBoot: () => FirstBootEvidence | undefined;
}): ProfileHeldDecision {
  if (delivered || isProfileReload({ command })) {
    return { kind: "pass" };
  }
  const loaded = load();
  if (loaded.origin === "none") {
    const evidence = firstBoot();
    if (evidence !== undefined && neverConfigured({ evidence })) {
      return { kind: "first-boot" };
    }
    return {
      kind: "stop",
      lines: [
        ...unloadedWarningLines({ reason: loaded.reason }),
        PROFILE_HELD_HEADLINE,
        "",
        `No copy of the owner's profile could be read here, so nothing but \`${PROFILE_RELOAD_COMMAND}\` runs until it loads.`,
        "There is no escape hatch for this one: doing nothing beats acting misaligned for the owner.",
        "The fix is the command above: it reads the store live and refreshes the copy, so the call after it is",
        "held once more with the owner's profile in the refusal, and goes through when made again.",
        "",
        ...loaded.lines,
      ],
      loaded,
    };
  }
  return {
    kind: "deliver",
    lines: [
      PROFILE_HELD_HEADLINE,
      "",
      "The owner's profile is below, delivered now. Read it, then make this same call again: it goes through. Nothing else is",
      "needed and the owner is asked for nothing; this is the automatic recovery, and it happened because the session-start",
      "load did not reach this context (a killed hook, usually at a compaction under load).",
      "There is no escape hatch for this one: doing nothing beats acting misaligned for the owner.",
      "",
      ...loaded.lines,
    ],
    loaded,
  };
}
