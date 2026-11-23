/**
 * The prompt-time half of the profile guarantee: a prompt submitted to a session whose context lacks their profile
 * carries the profile in with it, as the `UserPromptSubmit` hook's `additionalContext`.
 *
 * The recovery from a failed load must be automatic. The PreToolUse
 * `profile-held` check (`../../../admit/profileHeld.ts`) holds every guarded call until the profile is in context;
 * this reaches the turn that makes no call at all — a reply in plain prose — so it is not written without them either.
 *
 * It rides the seat check because that is the one `UserPromptSubmit` entry, and a running seat reads `hooks.json`
 * once at boot, so a new entry would reach no live session. `bin/slopweaver`'s cached-pass fast path answers only
 * when the delivery marker is present too, so a session missing its profile always reaches this.
 *
 * Best effort by construction: under load node's boot can outrun the hook's budget and the envelope releases the
 * prompt with nothing added. The PreToolUse hold is the guarantee; this narrows what a prose-only turn can miss.
 */
import { machineNeverConfigured } from "../../../admit/profileFirstBoot.js";
import { slopweaverHome } from "../../../config.js";
import { noProfileIn } from "../../../context/cachedContext.js";
import { profileBlockLines } from "../../../context/loadLedger.js";
import { appendProfileLoad } from "../../../context/loadLedgerStore.js";
import { type DeliveryContext, markProfileDelivered, profileWasDelivered } from "../../../context/profileDelivery.js";
import { contextOutput } from "../../../handover/hookShell.js";
import { loadContextSettlingMarks } from "../profile/contextLoad.js";

/** How long the prompt-time live read may take before the cache answers — the session-start hook's own bound. */
const PROMPT_BOUND_MS = 2_000;

/**
 * Load their profile into a prompt whose session lacks it, record the attempt, and say what to print.
 *
 * @param sessionId the session the payload named
 * @param delivery the context the payload names — a prompt is only ever submitted to a main thread, so its session
 * @param home the Slopweaver home the marker, cache and ledger live under
 * @param nowIso the instant the load is stamped at
 * @param load the loader; a test passes a plain fake so no store is opened
 * @param firstBoot whether this machine was never configured, asked only when nothing loaded; a test passes a plain
 *   fake so the runner's own default homes cannot decide it
 * @returns the JSON line to print (undefined when the session already holds the profile) and the context it delivers
 *   to once printed — undefined when nothing loaded, so no marker claims a profile the context does not hold
 */
export async function promptProfile({
  sessionId,
  delivery,
  home = slopweaverHome(),
  nowIso = new Date().toISOString(),
  load = loadContextSettlingMarks,
  firstBoot = () => machineNeverConfigured({ home }),
}: {
  sessionId: string;
  delivery: DeliveryContext;
  home?: string;
  nowIso?: string;
  load?: typeof loadContextSettlingMarks;
  firstBoot?: () => boolean;
}): Promise<{ line: string | undefined; deliversTo: DeliveryContext | undefined }> {
  const delivered = profileWasDelivered({ context: delivery, home });
  if (delivered.isOk() && delivered.value) {
    return { deliversTo: undefined, line: undefined };
  }
  const loaded = await load({ boundMs: PROMPT_BOUND_MS, home, nowIso });
  const isFirstBoot = noProfileIn({ loaded }) && firstBoot();
  const lines = profileBlockLines({ firstBoot: isFirstBoot, loaded });
  // A first boot records nothing: no profile was lost, and an absent ledger is what the bash recovery lane reads as one.
  if (!isFirstBoot) {
    appendProfileLoad({
      home,
      row: {
        atIso: nowIso,
        cwd: process.cwd(),
        event: "UserPromptSubmit",
        origin: loaded.origin,
        reason: loaded.reason,
        sessionId,
        source: "hook",
      },
    });
  }
  const line = contextOutput({ event: "UserPromptSubmit", lines });
  if (line === null) {
    return { deliversTo: undefined, line: undefined };
  }
  const carriesProfile = !isFirstBoot && loaded.origin !== "none";
  return { deliversTo: carriesProfile ? delivery : undefined, line };
}

/**
 * Write the marker for a prompt whose printed context delivered their profile — called only AFTER the line was printed.
 *
 * @param home the Slopweaver home the marker lives under
 * @param deliversTo the context {@link promptProfile} named, undefined for none
 */
export function markPromptDelivery({
  home,
  deliversTo,
}: {
  home: string;
  deliversTo: DeliveryContext | undefined;
}): void {
  if (deliversTo === undefined) {
    return;
  }
  markProfileDelivered({ context: deliversTo, home });
}
