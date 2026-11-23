/**
 * Whether this process may run as the chair's courier, and how a follower started by an in-place re-exec
 * (`./courierReexec.ts`) waits for cmux rather than ending the courier the one it replaced would have kept.
 */

/**
 * Whether this process is the pinned chair's courier, as one cmux lookup read it: `refused` is definite (no workspace
 * id, or another workspace is the pinned chair), `undecided` is cmux not answering or naming no pinned chair right now
 * — a state a running follower simply waits through, its deliveries failing until a chair is pinned again.
 */
export type CourierAdmission =
  | { readonly kind: "admitted" }
  | { readonly kind: "refused"; readonly why: string }
  | { readonly kind: "undecided"; readonly why: string };

/** How often a re-executed follower asks cmux again — the follow loop's own pass interval. */
const REEXEC_ADMISSION_RETRY_MS = 5_000;

/**
 * Admit this process as the courier, or say why not. A follower a re-exec started already ran as the chair's courier a
 * moment ago under this pid, so an undecided lookup there is asked again every pass for as long as it stays undecided
 * — exactly what the follower it replaced would have done with its failed batch passes — rather than ending a courier a
 * continuing one would have kept. A definite refusal still ends it at once: that is the one
 * place a re-executed follower is STRICTER than the one it replaced, which never asked again and would have typed on
 * into whichever workspace cmux pinned next. Any other start refuses on the first undecided lookup, as before. The
 * stamp is an environment variable anybody can set, so it buys only the wait, never admission: nothing is typed until
 * cmux names this workspace the pinned chair.
 *
 * @param reexecAtIso the stamp a re-exec left in this process's environment, if one started it
 * @param admit one cmux lookup
 * @param sleep waits between lookups
 * @param error says, once, that a lookup failed and is being retried
 * @returns `undefined` once admitted, or why this process is not the courier
 */
export async function admitCourier({
  reexecAtIso,
  admit,
  sleep,
  error,
}: {
  reexecAtIso: string | undefined;
  admit: () => Promise<CourierAdmission>;
  sleep: (options: { readonly ms: number }) => Promise<void>;
  error: (options: { readonly line: string }) => void;
}): Promise<string | undefined> {
  for (let attempt = 1; ; attempt += 1) {
    const admission = await admit();
    if (admission.kind === "admitted") {
      return undefined;
    }
    if (admission.kind === "refused" || reexecAtIso === undefined) {
      return admission.why;
    }
    if (attempt === 1) {
      error({
        line: `${admission.why} — re-executed a moment ago, so asking again every 5s until cmux names the chair`,
      });
    }
    await sleep({ ms: REEXEC_ADMISSION_RETRY_MS });
  }
}
