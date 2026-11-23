/**
 * The shared 429 block: when a provider rate-limits ONE request, every other caller stops too.
 *
 * Without this, a 429 is only ever seen by the request that earned it. That request backs off politely
 * while every other in-flight call keeps hammering the same exhausted quota, so the backoff accomplishes
 * nothing and the provider stays angry for longer. The prior 18-integration system named this its
 * highest-leverage shared utility, and the reason is exactly that asymmetry: the useful unit of backoff is
 * the PROVIDER, not the request.
 *
 * The block is keyed by (provider, scopeId) rather than by provider alone, because a quota's scope is real
 * (see `./rateLimits.ts`): Slack's is per-workspace, so two tokens on one workspace must share a block
 * while two tokens on different workspaces must not. The class is deliberately NOT part of the key — a
 * write 429 blocks reads too, since the provider is telling us it wants less traffic, not less writing.
 *
 * The clock and the delay are injected, so every behaviour here is unit-testable without a real wait.
 */

/** The identity a block applies to. `scopeId` is opaque — a workspace id, a token digest, whatever fits. */
export interface ProviderScope {
  readonly provider: string;
  readonly scopeId: string;
}

/** What a block currently says. `blockedUntilMs` absent means open. */
interface BlockState {
  readonly blockedUntilMs?: number | undefined;
}

/** How long to wait when a 429 arrives with no `Retry-After` at all. */
const DEFAULT_BLOCK_MS = 30_000;

/** The seams a block needs from the world. */
export interface RateBlockSeams {
  /** Monotonic-ish current time in ms. */
  readonly now: () => number;
  /** Sleep. Injected so a test asserts the requested delay instead of taking it. */
  readonly delay: (args: { delayMs: number }) => Promise<void>;
}

/** The shared block, as its callers use it. */
export interface RateBlock {
  /** Resolve once the scope is open, waiting if it is not. */
  readonly waitUntilOpen: (args: { scope: ProviderScope }) => Promise<void>;
  /** Record a rate-limit response. Returns the resulting state. */
  readonly recordLimited: (args: { scope: ProviderScope; retryAfterMs?: number | undefined }) => BlockState;
  /** Read the state without waiting — for a dry run, a diagnostic, or a non-retrying caller. */
  readonly inspect: (args: { scope: ProviderScope }) => BlockState;
  /** How long a caller would have to wait right now, in ms. Zero when open. */
  readonly remainingMs: (args: { scope: ProviderScope }) => number;
}

/** The map key for a scope. */
function keyOf({ scope }: { scope: ProviderScope }): string {
  return `${scope.provider}\u0000${scope.scopeId}`;
}

/**
 * Build a rate block over injected seams.
 *
 * @param seams the clock and the sleep
 * @returns a block instance
 */
export function createRateBlock({ seams }: { seams: RateBlockSeams }): RateBlock {
  const blockedUntil = new Map<string, number>();

  const remainingMs = ({ scope }: { scope: ProviderScope }): number => {
    const until = blockedUntil.get(keyOf({ scope }));
    if (until === undefined) {
      return 0;
    }
    return Math.max(0, until - seams.now());
  };

  return {
    inspect: ({ scope }) => {
      const until = blockedUntil.get(keyOf({ scope }));
      // An expired block is reported as OPEN rather than as a stale deadline, so a caller never has to
      // compare timestamps itself to know whether it may proceed.
      return until === undefined || until <= seams.now() ? {} : { blockedUntilMs: until };
    },
    recordLimited: ({ scope, retryAfterMs }) => {
      const wait = retryAfterMs === undefined || retryAfterMs <= 0 ? DEFAULT_BLOCK_MS : retryAfterMs;
      const key = keyOf({ scope });
      const candidate = seams.now() + wait;
      const existing = blockedUntil.get(key);
      // The LATER deadline wins. Two concurrent 429s must not let the shorter one shorten the block the
      // longer one asked for — that is how a provider gets hit again the moment it says "not yet".
      const until = existing === undefined ? candidate : Math.max(existing, candidate);
      blockedUntil.set(key, until);
      return { blockedUntilMs: until };
    },
    remainingMs,
    waitUntilOpen: async ({ scope }) => {
      // A loop rather than a single sleep: another caller may extend the block while this one is waiting,
      // and a single sleep would then return early into a still-closed provider.
      let wait = remainingMs({ scope });
      while (wait > 0) {
        await seams.delay({ delayMs: wait });
        wait = remainingMs({ scope });
      }
    },
  };
}

/**
 * The ONE process-wide block. Shared deliberately: a module-level instance is what makes "every caller
 * stops" true across the three separate places a Slack client is constructed (the read seam, the write
 * seam's two clients, and the upload-readiness poll). A per-client block would be four blocks that never
 * hear about each other.
 */
const SHARED_BLOCK: RateBlock = createRateBlock({
  seams: {
    delay: async ({ delayMs }) => {
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
    },
    now: () => Date.now(),
  },
});

/**
 * The shared process-wide rate block.
 *
 * @returns the one block every provider call consults
 */
export function sharedRateBlock(): RateBlock {
  return SHARED_BLOCK;
}
