/**
 * Assemble the always-loaded context from the store, and fall back to the cache when the store is not
 * there.
 *
 * This is the one place that decides what a session sees at start. It is deliberately small and has one
 * hard rule: it always returns lines, and the lines always say where they came from. A live read stamps
 * the instant it happened; a cached read stamps its age and why the live one failed; with neither, it
 * says so in one sentence rather than staying silent, because silence is what a session reads as "there
 * is nothing to know about the owner".
 *
 * ## Why it is bounded, and what the bound is for
 *
 * A session start that hangs is worse than one that reports the store unreachable. `postgres.js` will sit
 * on an unreachable host for its own default rather than this hook's deadline, so the whole read races a
 * timer and the cache answers when the timer wins. The bound is an argument rather than a constant so the
 * hook and a human-run verb can choose differently: a hook has a host deadline to live inside, and
 * `slopweaver profile context` run by hand would rather wait and tell the truth.
 */
import { err, ok, type Result } from "#lib/result.js";

import { openStore, type StoreReader, storeUrl } from "../store/client.js";
import { readOwnerProfile, readVoiceRegister } from "../store/profile/client.js";
import { voiceCohortLine } from "../store/profile/core.js";
import type { ProfileError } from "../store/profile/errors.js";
import type { VoiceCohort } from "../store/profile/types.js";

import { type AlwaysLoadedSection, buildAlwaysLoadedContext, unavailableSection } from "./alwaysLoaded.js";
import { storeFingerprint, writeContextCache } from "./cache.js";
import { contextFromCache as fromCache, type LoadedContext, OWNER_TITLE } from "./cachedContext.js";

export type { LoadedContext } from "./cachedContext.js";

/** The heading the measured length register prints under. */
const VOICE_TITLE = "Measured voice register";

/**
 * Race one promise against a deadline, so an unreachable database cannot outlast a hook.
 *
 * @param work the read to bound
 * @param ms how long to allow
 * @returns the work's value, or `undefined` when the deadline won
 */
async function within<T>({ work, ms }: { work: Promise<T>; ms: number }): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      resolve(undefined);
    }, ms);
    timer.unref();
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** What one live read produced: the sections to render, the cohorts to cache, and whether it worked. */
interface LiveRead {
  readonly sections: readonly AlwaysLoadedSection[];
  readonly cohorts: readonly VoiceCohort[];
  /**
   * Empty when the database actually answered; the reason otherwise.
   *
   * MEASURED once, and this field exists because of what happened without it. Every read here
   * returns a typed `Result` rather than throwing, so a database that was not running produced a
   * perfectly successful `liveRead` carrying two "unavailable" sections — which reported
   * `origin: live` and then OVERWROTE a good cache with the unavailable block. A read whose every
   * section failed is not a live read, and saying so is what makes the fallback reachable at all.
   * Reproduce: `SLOPWEAVER_STORE_URL=postgresql://postgres:x@localhost:55999/postgres slopweaver
   * profile context` against a home whose cache was written from a running store.
   */
  readonly failure: string;
  /** The store answered and holds no owner row: the owner has no profile yet. */
  readonly ownerAbsent: boolean;
}

/** The sections a live read produced, each one saying what it found or why it found nothing. */
async function liveRead({ url, ms }: { url: string; ms: number }): Promise<LiveRead | undefined> {
  const client = openStore({ max: 1, url });
  try {
    return await within({
      ms,
      work: (async (): Promise<LiveRead> => {
        const owner = await readOwnerProfile({ client });
        const voice = await readVoiceRegister({ client });
        return {
          cohorts: voice.isOk() ? voice.value : [],
          failure: ownerReadFailure({ owner }),
          ownerAbsent: owner.isErr() && owner.error.code === "PROFILE_ABSENT",
          sections: [ownerSection({ owner }), voiceSection({ voice })],
        };
      })(),
    });
  } finally {
    void client.close();
  }
}

/**
 * Why reading the owner row means this read is not live, empty when it is. An ABSENT row is a live answer, since
 * a fresh install genuinely has none; every other failure renders the owner section `unavailable`, and a read printing
 * that may not report `origin: live`, because the load ledger would then call a session loaded whose context
 * holds no profile, and the unavailable block would overwrite a good cache. A row whose payload no longer parses
 * was exactly that: a live read, a loaded row, and no profile.
 *
 * @param owner what the owner read returned
 * @returns the reason to fall back to the cache, or empty when the read stands
 */
export function ownerReadFailure({ owner }: { owner: Result<unknown, ProfileError> }): string {
  if (owner.isOk() || owner.error.code === "PROFILE_ABSENT") {
    return "";
  }
  return owner.error.message;
}

/** The owner's own section: the always-loaded statements, and their ways of working. */
function ownerSection({ owner }: { owner: Awaited<ReturnType<typeof readOwnerProfile>> }): AlwaysLoadedSection {
  if (owner.isErr()) {
    if (owner.error.code === "PROFILE_ABSENT") {
      return {
        detail: "no owner row has been written — seed one with `slopweaver profile set --file <owner.json>`",
        lines: [],
        provider: "owner-profile",
        revision: null,
        status: "empty",
        title: OWNER_TITLE,
      };
    }
    return unavailableSection({ detail: owner.error.message, provider: "owner-profile", title: OWNER_TITLE });
  }
  const lines = [
    ...owner.value.selfDescription.alwaysLoaded.map((entry) => `- ${entry.text}`),
    ...owner.value.selfDescription.waysOfWorking.map((entry) => `- how the owner works: ${entry.text}`),
  ];
  if (lines.length === 0) {
    return {
      detail: "the owner row carries no always-loaded statements yet",
      lines: [],
      provider: "owner-profile",
      revision: owner.value.revision,
      status: "empty",
      title: OWNER_TITLE,
    };
  }
  return {
    detail: "",
    lines,
    provider: "owner-profile",
    revision: owner.value.revision,
    status: "loaded",
    title: OWNER_TITLE,
  };
}

/** The measured length register: one line per cohort, saying plainly which numbers do not exist. */
function voiceSection({ voice }: { voice: Awaited<ReturnType<typeof readVoiceRegister>> }): AlwaysLoadedSection {
  if (voice.isErr()) {
    return unavailableSection({ detail: voice.error.message, provider: "voice-register", title: VOICE_TITLE });
  }
  if (voice.value.length === 0) {
    return {
      detail:
        "no length cohort has been measured — a Slack refresh measures the owner's sent messages " +
        "(`slopweaver profile voice measure` by hand)",
      lines: [],
      provider: "voice-register",
      revision: null,
      status: "empty",
      title: VOICE_TITLE,
    };
  }
  return {
    detail: "",
    lines: voice.value.map((cohort) => `- ${voiceCohortLine({ cohort })}`),
    provider: "voice-register",
    revision: null,
    status: "loaded",
    title: VOICE_TITLE,
  };
}

/**
 * Rebuild the context cache from a store already open, STRICTLY: a read or write that fails is returned, never
 * dropped. For a writer that just changed what the cache holds — `profile voice measure` — because the send door
 * reads the voice register from this cache alone (`../cli/aboveFoldDoor.ts`), so a register written while the cache
 * stayed stale is one the door would not see until the next session start.
 *
 * An absent owner row writes nothing and says so, for the reason {@link loadAlwaysLoadedContext} gives: a cache with
 * no owner row in it is read as the owner's profile having existed.
 *
 * @param client the open store, or a transaction on it — so a writer can rebuild the cache from its own uncommitted
 *   rows and roll them back when the cache cannot be written
 * @param url the connection string it was opened on, which fingerprints the cache
 * @param cachePath where the cache sits
 * @param nowIso the instant the cache is stamped with
 * @returns `refreshed`, `owner-absent`, or why the cache could not be rebuilt
 */
export async function refreshContextCache({
  client,
  url,
  cachePath,
  nowIso,
}: {
  client: StoreReader;
  url: string;
  cachePath: string;
  nowIso: string;
}): Promise<Result<"refreshed" | "owner-absent", string>> {
  const owner = await readOwnerProfile({ client });
  const failure = ownerReadFailure({ owner });
  if (failure.length > 0) {
    return err(failure);
  }
  if (owner.isErr()) {
    return ok("owner-absent");
  }
  const voice = await readVoiceRegister({ client });
  if (voice.isErr()) {
    return err(voice.error.message);
  }
  const lines = buildAlwaysLoadedContext({
    capturedAtIso: nowIso,
    sections: [ownerSection({ owner }), voiceSection({ voice })],
  });
  const written = writeContextCache({
    cache: {
      capturedAtIso: nowIso,
      lines: [...lines],
      schemaVersion: 1,
      storeFingerprint: storeFingerprint({ url }),
      voiceRegister: [...voice.value],
    },
    path: cachePath,
  });
  if (written.isErr()) {
    return err(written.error.message);
  }
  return ok("refreshed");
}

/**
 * The always-loaded context, live if the store answers inside the bound and from the cache if it does not.
 *
 * A successful live read that found the owner's row WRITES the cache, which is the only thing that makes the fallback worth having:
 * a cache nobody refreshes ages into a confident lie. A failed write is not reported to the caller,
 * because a session start whose context is correct should not fail over a cache it did not need.
 *
 * @param cachePath where the last-known-good copy sits
 * @param nowIso the instant this is being loaded at
 * @param boundMs how long the live read is allowed before the cache answers instead
 * @returns the lines to inject, and where they came from
 */
export async function loadAlwaysLoadedContext({
  cachePath,
  nowIso,
  boundMs,
}: {
  cachePath: string;
  nowIso: string;
  boundMs: number;
}): Promise<LoadedContext> {
  const url = storeUrl();
  if (url.isErr()) {
    return fromCache({ cachePath, fingerprint: "", nowIso, reason: url.error.message });
  }
  const fingerprint = storeFingerprint({ url: url.value });
  let live: LiveRead | undefined;
  try {
    live = await liveRead({ ms: boundMs, url: url.value });
  } catch (error) {
    return fromCache({
      cachePath,
      fingerprint,
      nowIso,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  if (live === undefined) {
    return fromCache({
      cachePath,
      fingerprint,
      nowIso,
      reason: `the store did not answer within ${String(boundMs)}ms`,
    });
  }
  if (live.failure.length > 0) {
    return fromCache({ cachePath, fingerprint, nowIso, reason: live.failure });
  }
  const lines = buildAlwaysLoadedContext({ capturedAtIso: nowIso, sections: live.sections });
  // No owner row is no profile to keep: caching it would leave a file the first-boot read counts as the owner's profile having
  // existed, and a fresh machine would be held for a profile nobody has written.
  if (live.ownerAbsent) {
    return { lines, origin: "live", ownerAbsent: true, ownerAbsentIn: fingerprint, reason: "" };
  }
  void writeContextCache({
    cache: {
      capturedAtIso: nowIso,
      lines: [...lines],
      schemaVersion: 1,
      storeFingerprint: fingerprint,
      voiceRegister: [...live.cohorts],
    },
    path: cachePath,
  });
  return { lines, origin: "live", reason: "" };
}
