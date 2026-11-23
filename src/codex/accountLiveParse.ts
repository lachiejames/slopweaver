/**
 * The PURE half of the live Codex account read: what one store's `codex app-server` answered, turned into
 * this repository's vocabulary — signed in as whom, how full each window is right now, and how many free
 * usage-limit resets the account holds.
 *
 * ## Why a live read exists at all
 *
 * Every other Codex quota reader here reads the PAST: a store's own rollout log, or a cached refusal. Both
 * go wrong, measured on codex-cli 0.155.1 with `slopweaver codex route`:
 *
 *  - `~/.codex-one` held no sign-in, carried no refusal, and so ranked FIRST — a pass routed there
 *    failed `401 Missing bearer`. Nothing in the fleet read could tell a signed-out store from a healthy one.
 *  - `~/.codex` had just had its weekly window reset by the owner, yet its rollout log's newest reading — 233,643
 *    seconds old — still said 100%, so it ranked as a reserve while an app-server read reported it at 0%.
 *  - Two accounts held a free usage-limit reset nobody knew about while every plan read as capped.
 *
 * The app-server answers all three in one exchange (`account/read`, `account/rateLimits/read`); the effectful
 * half that holds that exchange open is `./accountLive.ts`. This file never runs anything.
 *
 * ## The window rules are NOT restated here
 *
 * A live snapshot is re-expressed in the rollout log's own snake_case shape and handed to the SAME
 * `gaugeFromRateLimits` and `evidenceFromGauge` the log is read with, so slot-is-not-a-window, every window
 * counts, and the exhausted window that reopens LAST names the wait (`./quotaLog.ts`) hold for both sources
 * by construction rather than by two copies agreeing.
 */
import { z } from "zod";

import type { CodexGauge } from "./gauge.js";
import { gaugeFromRateLimits } from "./gauge.js";
import { evidenceFromGauge } from "./quotaLog.js";
import type { CodexQuotaEvidence, CodexQuotaObservation } from "./quotaTypes.js";
import { type CodexResetCredit, listedResetCreditsOf, resetCreditsOf, resetCreditsWire } from "./resetCreditsParse.js";

/** The `limit_id` the ordinary Codex allowance is metered under — the one routing ranks on. */
const CODEX_ROUTING_LIMIT_ID = "codex";

/** The request id this exchange sends `account/rateLimits/read` under. */
export const RATE_LIMITS_REQUEST_ID = 2;
/** The request id this exchange sends `account/read` under. */
export const ACCOUNT_REQUEST_ID = 3;

/**
 * What one store answered. Every arm names the store, and the instant the read was judged at, so a row can
 * never be dated differently from the read that produced it.
 */
export type CodexAccountLive =
  | {
      /** The store is signed in and answered both requests. */
      readonly kind: "signed-in";
      readonly codexHome: string;
      readonly readAtIso: string;
      /** The address the provider reports, or undefined for a sign-in that carries none (an API key). */
      readonly email: string | undefined;
      /** The provider's own account id — two stores sharing one are one account, and add no capacity. */
      readonly accountId: string | undefined;
      readonly planType: string | undefined;
      /**
       * The backend's permission for ordinary included usage. The protocol says a client must not infer
       * recovery from percentages, so `false` is refusal evidence of its own; `undefined` is "not reported"
       * (codex-cli 0.153.4 omits it), never healthy by default.
       */
      readonly ordinaryUsageAllowed: boolean | undefined;
      /** One reading per metered `limit_id`, each observed at {@link readAtIso}. */
      readonly gauges: readonly CodexGauge[];
      /** Free usage-limit resets the account holds and has not redeemed. */
      readonly resetCreditsAvailable: number;
      /**
       * Each held reset the provider itemised, or absent when it sent the count alone (`credits: null`). The
       * backend may cap the list, so it can be shorter than {@link resetCreditsAvailable}; it is never longer.
       */
      readonly resetCreditsListed?: readonly CodexResetCredit[];
    }
  | { readonly kind: "signed-out"; readonly codexHome: string; readonly readAtIso: string }
  | { readonly kind: "store-missing"; readonly codexHome: string; readonly readAtIso: string }
  | {
      /** Nothing trustworthy came back — a missing binary, a deadline, a malformed answer. Today's behaviour. */
      readonly kind: "unreadable";
      readonly codexHome: string;
      readonly readAtIso: string;
      readonly reason: string;
    };

const windowWire = z.object({
  resetsAt: z.number().nullable().optional(),
  // A negative percentage is a malformed answer, never a measured window.
  usedPercent: z.number().nonnegative(),
  windowDurationMins: z.number().nullable().optional(),
});

const creditsWire = z.object({
  // A string today (`"0"` on a healthy account); a NUMBER is what `./gauge.ts` reads as a spent balance, so one
  // must reach it rather than fail the whole answer as unreadable.
  balance: z.union([z.string(), z.number()]).nullable().optional(),
  hasCredits: z.boolean(),
  unlimited: z.boolean(),
});

const snapshotWire = z.object({
  credits: creditsWire.nullable().optional(),
  limitId: z.string().nullable().optional(),
  planType: z.string().nullable().optional(),
  primary: windowWire.nullable().optional(),
  rateLimitReachedType: z.string().nullable().optional(),
  secondary: windowWire.nullable().optional(),
});

const rateLimitsWire = z.object({
  accountId: z.string().nullable().optional(),
  ordinaryUsageAllowed: z.boolean().nullable().optional(),
  rateLimitResetCredits: resetCreditsWire,
  rateLimits: snapshotWire,
  rateLimitsByLimitId: z.record(z.string(), snapshotWire).nullable().optional(),
});

const accountWire = z.object({
  account: z
    .object({
      email: z.string().nullable().optional(),
      planType: z.string().nullable().optional(),
      type: z.string(),
    })
    .nullable(),
});

const responseWire = z.object({
  error: z.object({ code: z.number(), message: z.string() }).optional(),
  id: z.number(),
  result: z.unknown().optional(),
});

type SnapshotWire = z.infer<typeof snapshotWire>;
type ResponseWire = z.infer<typeof responseWire>;

/** A wire field the provider may send as `null` or omit, read as the one absence this repository uses. */
function present<T>({ value }: { value: T | null | undefined }): T | undefined {
  if (value == null) {
    return undefined;
  }
  return value;
}

/**
 * The marker the reader prints, in place of a JSON line, when something about the exchange itself failed.
 * Kept in this file so the Tcl program and the parser cannot disagree about the vocabulary.
 */
export const LIVE_MARKER_PREFIX = "!";

/** What each marker the reader prints means, as the reason an `unreadable` row carries. */
const MARKER_REASONS: ReadonlyMap<string, string> = new Map([
  ["deadline", "the app-server did not answer both requests before the per-store deadline"],
  ["eof", "the app-server exited before answering both requests"],
  ["open", "the app-server could not be started"],
  ["overflow", "the app-server wrote more than the per-store byte cap"],
]);

/** One snapshot, re-expressed in the rollout log's own snake_case shape so the log's parser reads it. */
function rolloutShaped({ snapshot }: { snapshot: SnapshotWire }): Record<string, unknown> {
  const windowOf = ({ window }: { window: z.infer<typeof windowWire> | null | undefined }): unknown => {
    if (window == null) {
      return null;
    }
    return { resets_at: window.resetsAt, used_percent: window.usedPercent, window_minutes: window.windowDurationMins };
  };
  const { credits } = snapshot;
  return {
    credits:
      credits == null
        ? null
        : { balance: credits.balance, has_credits: credits.hasCredits, unlimited: credits.unlimited },
    limit_id: snapshot.limitId,
    plan_type: snapshot.planType,
    primary: windowOf({ window: snapshot.primary }),
    rate_limit_reached_type: snapshot.rateLimitReachedType,
    secondary: windowOf({ window: snapshot.secondary }),
  };
}

/**
 * Every metered bucket as a gauge, or the reason the buckets cannot be trusted.
 *
 * A map key disagreeing with the `limitId` inside it is refused rather than resolved either way: which one
 * scopes the reading decides which cap it may clear, and guessing is how a healthy `codex` window would lift
 * a capped `premium` allowance.
 */
function gaugesOf({
  readAtIso,
  response,
}: {
  readAtIso: string;
  response: z.infer<typeof rateLimitsWire>;
}): { readonly gauges: readonly CodexGauge[] } | { readonly reason: string } {
  const byLimit = response.rateLimitsByLimitId;
  if (byLimit == null) {
    return {
      gauges: [
        gaugeFromRateLimits({ observedAtIso: readAtIso, rateLimits: rolloutShaped({ snapshot: response.rateLimits }) }),
      ],
    };
  }
  const mismatched = Object.entries(byLimit).find(
    ([key, snapshot]) => snapshot.limitId != null && snapshot.limitId !== key,
  );
  if (mismatched !== undefined) {
    return { reason: `the rate-limit bucket keyed ${mismatched[0]} names itself ${String(mismatched[1].limitId)}` };
  }
  const keyed = Object.entries(byLimit).map(([key, snapshot]) =>
    gaugeFromRateLimits({
      observedAtIso: readAtIso,
      rateLimits: rolloutShaped({ snapshot: { ...snapshot, limitId: key } }),
    }),
  );
  // The top-level bucket is REQUIRED on the wire and the map is optional, so a map that does not carry it must
  // not erase it: one naming a limit the map omits is read under that limit, and
  // one naming no limit at all is read UNSCOPED, as the rollout parser reads such a line. A keyed copy wins.
  const topLevelId = response.rateLimits.limitId;
  if (topLevelId != null && Object.hasOwn(byLimit, topLevelId)) {
    return { gauges: keyed };
  }
  const topLevel = gaugeFromRateLimits({
    observedAtIso: readAtIso,
    rateLimits: rolloutShaped({ snapshot: response.rateLimits }),
  });
  return { gauges: [...keyed, topLevel] };
}

/** Each JSON-RPC response a store sent, by id — or the reason the stream cannot be read as responses. */
function responsesOf({
  lines,
}: {
  lines: readonly string[];
}): { readonly byId: ReadonlyMap<number, ResponseWire> } | { readonly reason: string } {
  const byId = new Map<number, ResponseWire>();
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return { reason: "the app-server wrote a line that is not JSON" };
    }
    const parsed = responseWire.safeParse(value);
    // A notification carries no numeric id; it is not an answer to anything asked, so it is skipped.
    if (!parsed.success) {
      continue;
    }
    if (byId.has(parsed.data.id)) {
      return { reason: `the app-server answered request ${String(parsed.data.id)} twice` };
    }
    // JSON-RPC forbids an answer carrying both; reading its result would take a failed call as a measurement.
    if (parsed.data.error !== undefined && parsed.data.result !== undefined) {
      return { reason: `the app-server answered request ${String(parsed.data.id)} with both an error and a result` };
    }
    byId.set(parsed.data.id, parsed.data);
  }
  return { byId };
}

/** Why an exchange with no complete pair is unreadable: the reader's own marker first, else which answer is missing. */
function incompleteReason({ accountRead, marker }: { accountRead: boolean; marker: string | undefined }): string {
  if (marker !== undefined) {
    const word = marker.slice(LIVE_MARKER_PREFIX.length).split(" ")[0]!;
    const known = MARKER_REASONS.get(word);
    if (known === undefined) {
      return `the reader reported ${word}`;
    }
    return known;
  }
  const missing = accountRead ? "account/rateLimits/read" : "account/read";
  return `no well-formed answer to ${missing}`;
}

/**
 * Read what one store answered.
 *
 * `account: null` is the signed-out answer regardless of what the rate-limit request said, because a
 * signed-out store's rate-limit request fails on exactly that ground. Everything short of a complete,
 * well-formed pair is `unreadable` — never a manufactured healthy reading.
 *
 * @param codexHome the store the lines came from
 * @param lines that store's own output lines, in arrival order, markers included
 * @param readAtIso the instant the whole read is judged at
 * @returns the store's live state
 */
export function parseCodexAccountLive({
  codexHome,
  lines,
  readAtIso,
}: {
  codexHome: string;
  lines: readonly string[];
  readAtIso: string;
}): CodexAccountLive {
  const unreadable = ({ reason }: { reason: string }): CodexAccountLive => ({
    codexHome,
    kind: "unreadable",
    readAtIso,
    reason,
  });
  const marker = lines.find((line) => line.startsWith(LIVE_MARKER_PREFIX));
  const json = lines.filter((line) => !line.startsWith(LIVE_MARKER_PREFIX));
  const responses = responsesOf({ lines: json });
  if ("reason" in responses) {
    return unreadable({ reason: responses.reason });
  }
  const account = accountWire.safeParse(responses.byId.get(ACCOUNT_REQUEST_ID)?.result);
  if (account.success && account.data.account === null) {
    return { codexHome, kind: "signed-out", readAtIso };
  }
  const limits = rateLimitsWire.safeParse(responses.byId.get(RATE_LIMITS_REQUEST_ID)?.result);
  if (!account.success || !limits.success) {
    return unreadable({ reason: incompleteReason({ accountRead: account.success, marker }) });
  }
  const gauges = gaugesOf({ readAtIso, response: limits.data });
  if ("reason" in gauges) {
    return unreadable({ reason: gauges.reason });
  }
  const signedIn = account.data.account!;
  return {
    accountId: present({ value: limits.data.accountId }),
    codexHome,
    email: present({ value: signedIn.email }),
    gauges: gauges.gauges,
    kind: "signed-in",
    ordinaryUsageAllowed: present({ value: limits.data.ordinaryUsageAllowed }),
    planType: present({ value: signedIn.planType }),
    readAtIso,
    resetCreditsAvailable: resetCreditsOf({ credits: limits.data.rateLimitResetCredits }),
    ...listedResetCreditsOf({ credits: limits.data.rateLimitResetCredits }),
  };
}

/**
 * Every exhaustion a live read establishes — one per exhausted bucket, plus one when the backend refuses
 * ordinary usage outright.
 *
 * @param live one store's live state
 * @returns the evidence, empty for anything but a signed-in read that found a cap
 */
export function evidenceFromLive({ live }: { live: CodexAccountLive }): readonly CodexQuotaEvidence[] {
  if (live.kind !== "signed-in") {
    return [];
  }
  const windows = live.gauges
    .map((gauge) => evidenceFromGauge({ gauge }))
    .filter((evidence): evidence is CodexQuotaEvidence => evidence !== undefined);
  if (live.ordinaryUsageAllowed !== false) {
    return windows;
  }
  // Unscoped on purpose: the permission is about the account, not one bucket, so no healthy bucket clears it.
  return [...windows, { kind: "usage-limit", observedAtIso: live.readAtIso }];
}

/**
 * Every bucket a live read measured, as the observations `survivingEvidence` tests older evidence against.
 * A healthy one clears an older exhaustion of the SAME `limit_id`; the strictly-later rule is unchanged.
 *
 * A bucket that MEASURED nothing — no window, nothing reached, no spent balance — is not an observation at all.
 * Handed on, its absent evidence would read as healthy and clear a cached cap with no percentage below 100%
 * anywhere in the answer.
 *
 * The wire's credit balance is a STRING, and `"0"` is what a healthy account with no purchased credits carries
 * (`bucket` in the unit test is that shape). It reaches `./gauge.ts` verbatim, which reads only a numeric
 * balance — exactly as it reads the rollout log's own `"balance":"0"` (`REAL_POST_CAP_PREMIUM_EMPTY_LINE`) — so
 * neither path ever calls a string balance spent; exhaustion arrives as a reached type or a window at 100%.
 *
 * @param live one store's live state
 * @returns one observation per bucket that measured something, empty for anything but a signed-in read
 */
export function quotaObservationsFromLive({ live }: { live: CodexAccountLive }): readonly CodexQuotaObservation[] {
  if (live.kind !== "signed-in") {
    return [];
  }
  return live.gauges
    .filter((gauge) => observedHealthOrCap({ gauge }))
    .map((gauge) => ({
      evidence: evidenceFromGauge({ gauge }),
      limitId: gauge.limitId,
      observedAtIso: gauge.observedAtIso,
    }));
}

/**
 * Whether a bucket says anything at all: a window with a percentage, a reached limit — recognised or not — or a
 * spent balance. A reached type this machine has never seen is still a live signal, so the bucket stays the
 * store's gauge and shows the wording as itself, exactly as the rollout path shows it (Codex review r2).
 */
function measuredAnything({ gauge }: { gauge: CodexGauge }): boolean {
  return gauge.windows.length > 0 || gauge.reachedType !== undefined || evidenceFromGauge({ gauge }) !== undefined;
}

/**
 * Whether a bucket may stand as an observation that tests older evidence: a cap it names, or windows with NO
 * reached type beside them. A reached type nobody has classified is neither healthy nor a known cap, so it clears
 * nothing — only a reading with no limit reached may say the account is spendable again.
 */
function observedHealthOrCap({ gauge }: { gauge: CodexGauge }): boolean {
  return evidenceFromGauge({ gauge }) !== undefined || (gauge.windows.length > 0 && gauge.reachedType === undefined);
}

/**
 * The bucket routing ranks on, read live — or undefined when this read measured none.
 *
 * @param live one store's live state
 * @returns the `codex` bucket's gauge, when a signed-in read carried one
 */
export function routingGaugeFromLive({ live }: { live: CodexAccountLive }): CodexGauge | undefined {
  if (live.kind !== "signed-in") {
    return undefined;
  }
  return live.gauges.find((gauge) => gauge.limitId === CODEX_ROUTING_LIMIT_ID);
}

/**
 * The reading policy ranks one destination on, and where it came from.
 *
 * A live `codex` bucket wins over a rollout line of any age — the rollout log reads the past, and a window the
 * owner has since reset still reads 100% there. A signed-out or missing store yields none at all — it is excluded
 * with its login line, and no number describes a store nobody is signed into. Every other live answer that did not
 * MEASURE the `codex` bucket — unreadable, no such bucket, or a bucket with nothing in it — falls back to the
 * rollout scan, which is exactly today's behaviour: absence is no reading, never a healthy one (Codex review r2).
 *
 * @param live the store's live state in this read
 * @param rolloutGauge the freshest reading the bounded rollout scan found, if any
 * @returns the effective gauge, and which source it is
 */
export function effectiveGauge({
  live,
  rolloutGauge,
}: {
  live: CodexAccountLive;
  rolloutGauge: CodexGauge | undefined;
}): { readonly gauge: CodexGauge | undefined; readonly source: "live" | "rollout" | "none" } {
  if (live.kind === "signed-out" || live.kind === "store-missing") {
    return { gauge: undefined, source: "none" };
  }
  const gauge = routingGaugeFromLive({ live });
  if (gauge !== undefined && measuredAnything({ gauge })) {
    return { gauge, source: "live" };
  }
  return rolloutGauge === undefined ? { gauge: undefined, source: "none" } : { gauge: rolloutGauge, source: "rollout" };
}

/**
 * Split the reader's tagged stdout into each store's own lines.
 *
 * Every line the reader prints is `<store index>\t<payload>`; a line without a known index is dropped, since
 * no store can own it.
 *
 * @param stdout everything the reader printed
 * @param storeCount how many stores the reader was handed
 * @returns one list of payload lines per store, in store order
 */
export function linesByStore({ stdout, storeCount }: { stdout: string; storeCount: number }): readonly string[][] {
  const buckets: string[][] = Array.from({ length: storeCount }, () => []);
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    const index = Number(line.slice(0, tab));
    if (tab > 0 && Number.isInteger(index) && index >= 0 && index < storeCount) {
      buckets[index]!.push(line.slice(tab + 1));
    }
  }
  return buckets;
}
