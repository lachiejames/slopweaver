/**
 * Turn the rate-limit headers an Anthropic API response carries into a typed {@link ClaudeAccountGauge},
 * and REFUSE anything it does not fully recognise.
 *
 * ## Where these headers come from, and why this parser is header-shaped rather than body-shaped
 *
 * Measured live against a Max plan: an ordinary `POST /v1/messages` answers `200` carrying
 * `anthropic-ratelimit-unified-5h-{status,utilization,reset}`, the matching `-7d-*` trio, an overall
 * `-status`, and `-representative-claim`. `utilization` is a FRACTION (`0.34` is 34%, not 34) and `reset` is
 * an ABSOLUTE epoch-second count, not an offset — both were misread once while reverse-engineering this and
 * both are the kind of mistake that silently rotates on the wrong number.
 *
 * The dedicated `GET /api/oauth/usage` endpoint returns a tidier body and the gauge does NOT use it (only
 * `claude reset` reads it, for the free-reset block, `./resetStatus.ts`): measured the same
 * night, it answered `429` with `retry-after: 3568` on a FIRST call, because its budget is shared with every
 * Claude Code session on the machine already calling it for `/usage`. A gauge that can be throttled out of
 * existence is not a gauge.
 *
 * ## The five-hour trio is gone on the Ultra plan, and the seven-day trio is the one that is required
 *
 * Anthropic renamed Max 20x to Ultra (Max 5x to Max) and removed the five-hour limit from Ultra in stages, so
 * the weekly limit can be spread across the week. MEASURED on the day of the notice
 * with this parser's own probe on every logged-in plan the owner holds: a `200` carrying the `7d` and `7d_oi`
 * trios, the overall `-status` and `-reset`, `-representative-claim: seven_day`, and NO `5h` header at all.
 * Requiring the five-hour trio is what read 0 of 5 plans and closed every spawn. So the `7d` trio is required
 * and the `5h` trio is read exactly like the Fable one — optional, all-or-nothing: absent entirely is a plan
 * with no five-hour limit, a partial trio is still a shape change and refused. Reproduce with
 * `slopweaver claude gauge --json` and read each plan's `gauge.fiveHour`.
 *
 * ## The Fable window is a separate trio, and it only appears when you ASK for it
 *
 * MEASURED against the owner's own three plans, by sending the same one-token request four times
 * over one credential with only the `model` field changed: a request naming a Fable model comes back with an
 * EXTRA `anthropic-ratelimit-unified-7d_oi-{status,utilization,reset}` trio, and requests naming Haiku, Opus
 * or Sonnet come back with no such headers at all. On the plan the owner had screenshotted at "All models
 * 100%, Fable 53%", the Fable probe read `7d-utilization = 1.0` beside `7d_oi-utilization = 0.52` — the two
 * numbers on the owner's screen, in one response. Reproduce on any plan:
 *
 * ```
 * slopweaver claude gauge --json | jq '.[].gauge | {sevenDay, sevenDayFable}'
 * ```
 *
 * That is why the probe asks for Fable rather than the cheapest model: a gauge taken with Haiku is BLIND to
 * the Fable budget, which is exactly how the fleet locked itself out of a plan while half that plan's Fable
 * week sat unspent. The trio is therefore parsed as OPTIONAL-BUT-ALL-OR-NOTHING — absent entirely is a
 * legitimate reading from a non-Fable probe, while a partial trio is a shape change and refused like any
 * other.
 *
 * A second measurement bounds what the split is worth, and it is the one that stops routing being wrong: a
 * Fable request against a plan whose PLAN-WIDE seven-day window reads `rejected` is itself refused `429`
 * ("This request would exceed your account's rate limit"), even with `7d_oi-status = allowed` and 48% of the
 * Fable week left. Fable headroom on a plan-wide-exhausted plan is therefore NOT spendable, so routing must
 * satisfy the plan-wide windows FIRST and only then rank on the Fable one.
 *
 * ## Fail closed — deliberately the opposite of the Codex side
 *
 * `src/codex/quotaGate.ts` treats absent evidence as healthy, and it is right to: it gates an opportunistic
 * spawn on evidence scraped from a rollout log. This parser sits immediately before a credential swap and an
 * account choice, so an unrecognised shape must stop the machine rather than wave it through. Every missing
 * or unparseable required field becomes {@link ClaudeRotationErrors.usageShapeChanged}, whose caller closes
 * the spawn gate and alerts, rather than an `undefined` that reads like "healthy".
 */
import { epochSecondsToIso } from "../lib/date.js";
import { err, ok, type Result } from "../lib/result.js";
import type {
  ClaudeAccountGauge,
  ClaudeRepresentativeClaim,
  ClaudeWindowReading,
  ClaudeWindowStatus,
} from "./contracts.js";
import { type ClaudeRotationError, ClaudeRotationErrors } from "./errors.js";

/** The header family this parser reads. Every name below is suffixed onto it. */
const PREFIX = "anthropic-ratelimit-unified";

/**
 * The header infix naming the Fable-only seven-day window.
 *
 * `oi` is the provider's own spelling and it is not expanded here on purpose — guessing at what it stands
 * for would put a claim in canon that no measurement supports. What IS measured is which requests carry it.
 */
const FABLE_WINDOW = "7d_oi";

/** The three window statuses a response can carry, as a set so an unknown value fails rather than defaults. */
const WINDOW_STATUSES: ReadonlySet<string> = new Set<ClaudeWindowStatus>(["allowed", "allowed_warning", "rejected"]);

/**
 * Every label a response is known to put in `-representative-claim`.
 *
 * An ABSENT label is fine; an UNKNOWN one is a shape change and refused, exactly like an unknown window
 * status. The label names the window currently binding the plan, so a value outside this set says a limit
 * exists that no trio here reads — a gauge routing on the `7d` reading alone would pick a plan walled by a
 * window it cannot see. The refusal names the header, so the fix is one entry in this set once measured.
 */
const REPRESENTATIVE_CLAIMS: ReadonlySet<string> = new Set<ClaudeRepresentativeClaim>([
  "five_hour",
  "seven_day",
  "seven_day_opus",
  "seven_day_sonnet",
  "seven_day_overage_included",
]);

/**
 * The one numeric spelling a utilization or reset header is measured to carry: plain non-negative decimal
 * (`0.34`, `1788459000`). `Number()` alone also takes `0x0`, `1e3`, `Infinity` and padded whitespace, each a
 * shape this parser has never seen, so each is refused rather than coerced.
 */
const DECIMAL = /^\d+(?:\.\d+)?$/;

/**
 * Read a numeric header as a plain decimal.
 *
 * @param raw the header's trimmed value, absent when not sent
 * @returns the number, or NaN for anything not a plain decimal so the caller's finiteness check refuses it
 */
function decimal({ raw }: { raw: string | undefined }): number {
  return raw !== undefined && DECIMAL.test(raw) ? Number(raw) : Number.NaN;
}

/** The windows this parser reads, each named by a duration infix. */
const WINDOW_FAMILIES: ReadonlySet<string> = new Set(["5h", "7d", FABLE_WINDOW]);

/**
 * Every `-status` family a response is measured to carry: the overall `-status`, the overage one, and the three
 * windows read here. A `-status` header is how the provider grades a LIMIT, so one outside this set is a limit no
 * trio here reads — a `30d-status: rejected` routed around on the week alone. Other unknown field names of a
 * KNOWN family (`7d_oi-surpassed-threshold`) grade nothing and are left alone: refusing every unknown name would blank the
 * fleet on the next harmless addition, the whole-gauge outage again.
 */
const STATUS_FAMILIES: ReadonlySet<string> = new Set(["", "overage", "5h", "7d", FABLE_WINDOW]);

/**
 * Every family a `-utilization` or `-reset` header is measured under. Each of those two fields belongs to a LIMIT
 * exactly as a `-status` does, so an unknown family sending only them — a `30d-utilization` with no status — is
 * the same unread limit, and refused the same way. The windows' own trios are read where each window is read.
 */
const LIMIT_FIELD_FAMILIES: Readonly<Record<string, ReadonlySet<string>>> = {
  reset: STATUS_FAMILIES,
  status: STATUS_FAMILIES,
  utilization: WINDOW_FAMILIES,
};

/**
 * A header infix spelled like a window — a duration (`5h`, `7d`, `30d`), optionally qualified (`7d_oi`). A family
 * of that shape IS a limit whatever field it sends, so an unknown one (a `30d-surpassed-threshold`) is a window
 * no trio here reads. A non-duration name (`fallback-percentage`) is not one and stays tolerated.
 *
 * The residue, on purpose: a limit family named by a WORD (`weekly-surpassed-threshold`) passes, because telling
 * it from a harmless addition needs a closed list of every header name, and refusing every unknown name is the
 * whole-gauge outage this shape exists to end. Every family the provider has ever sent is duration-spelled; one
 * that is not would still surface as a plan walling above the gauge's reading, which drawdown sampling sees.
 */
const WINDOW_SHAPED = /^\d+[a-z]+(?:_[a-z0-9]+)*$/;

/**
 * The window-shaped family a header of this prefix names, when its first segment is spelled like a window.
 *
 * @param key the lower-cased header name
 * @returns the family, or undefined for a header outside this prefix or one not spelled like a window
 */
function windowFamilyOf({ key }: { key: string }): string | undefined {
  const opening = `${PREFIX}-`;
  if (!key.startsWith(opening)) {
    return undefined;
  }
  const family = key.slice(opening.length).split("-")[0]!;
  return WINDOW_SHAPED.test(family) ? family : undefined;
}

/**
 * Split a header name into the limit family and field it names, when it is a `-status`, `-utilization` or
 * `-reset` header of this prefix. The overall `-status` and `-reset` are the empty family.
 *
 * @param key the lower-cased header name
 * @returns the family and field, or undefined for any other header
 */
function limitField({ key }: { key: string }): { family: string; field: string } | undefined {
  for (const field of Object.keys(LIMIT_FIELD_FAMILIES)) {
    if (key === `${PREFIX}-${field}`) {
      return { family: "", field };
    }
    const opening = `${PREFIX}-`;
    const closing = `-${field}`;
    if (key.startsWith(opening) && key.endsWith(closing) && key.length > opening.length + closing.length) {
      return { family: key.slice(opening.length, -closing.length), field };
    }
  }
  return undefined;
}

/**
 * The first limit header this parser cannot vouch for: any header of a window-shaped family it does not read,
 * whatever its field; a `-status`, `-utilization` or `-reset` naming a family it does not read; or the overall or overage status or reset malformed — a status outside the known three, a
 * reset that is not a plain decimal. The window trios' own fields are checked where each window is read; the
 * overall and overage fields have no trio, so nothing else looks at them.
 *
 * @param headers every header received
 * @returns the full header name, or undefined when every limit header is known and well-formed
 */
function statusHeaderFault({ headers }: { headers: Readonly<Record<string, string>> }): string | undefined {
  return Object.entries(headers)
    .map(([key, value]) => ({ key: key.toLowerCase(), value: value.trim() }))
    .find(({ key, value }) => {
      const window = windowFamilyOf({ key });
      if (window !== undefined && !WINDOW_FAMILIES.has(window)) {
        return true;
      }
      const named = limitField({ key });
      if (named === undefined) {
        return false;
      }
      if (!LIMIT_FIELD_FAMILIES[named.field]!.has(named.family)) {
        return true;
      }
      const untrioed = named.family === "" || named.family === "overage";
      if (!untrioed) {
        return false;
      }
      if (named.field === "status") {
        return !isWindowStatus(value);
      }
      return !Number.isFinite(decimal({ raw: value }));
    })?.key;
}

/** Narrow a header value to a known window status. A predicate, so the compiler proves the narrowing. */
function isWindowStatus(value: string): value is ClaudeWindowStatus {
  return WINDOW_STATUSES.has(value);
}

/** Narrow a header value to a known representative label. A predicate, so the compiler proves the narrowing. */
function isRepresentativeClaim(value: string): value is ClaudeRepresentativeClaim {
  return REPRESENTATIVE_CLAIMS.has(value);
}

/**
 * Case-insensitive header lookup. Node lower-cases incoming header names and `fetch`'s `Headers` does too,
 * but a caller may hand this a plain object it built itself, so the lookup never assumes a casing.
 *
 * @param headers every header received, by name
 * @param name the header to find, without the shared prefix
 * @returns the trimmed value, or undefined when absent or blank
 */
function header({ headers, name }: { headers: Readonly<Record<string, string>>; name: string }): string | undefined {
  const wanted = `${PREFIX}-${name}`.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    }
  }
  return undefined;
}

/**
 * Read one window's trio of headers into a {@link ClaudeWindowReading}.
 *
 * @param headers every header received
 * @param window the header infix naming the window — `5h` or `7d`
 * @returns the reading, or the shape error naming the first field that failed
 */
function readWindow({
  headers,
  window,
}: {
  headers: Readonly<Record<string, string>>;
  window: string;
}): Result<ClaudeWindowReading, ClaudeRotationError> {
  const rawStatus = header({ headers, name: `${window}-status` });
  if (rawStatus === undefined || !isWindowStatus(rawStatus)) {
    return err(ClaudeRotationErrors.usageShapeChanged({ field: `${PREFIX}-${window}-status` }));
  }
  const utilization = decimal({ raw: header({ headers, name: `${window}-utilization` }) });
  // No upper bound, deliberately. A reading past 1 fails SAFE — every spend cap excludes it (`select.ts`) — so
  // refusing it would only blank the whole gauge over a plan already past its wall, the whole-gauge outage in small.
  if (!Number.isFinite(utilization) || utilization < 0) {
    return err(ClaudeRotationErrors.usageShapeChanged({ field: `${PREFIX}-${window}-utilization` }));
  }
  const resetSeconds = decimal({ raw: header({ headers, name: `${window}-reset` }) });
  const resetAtIso = Number.isFinite(resetSeconds) ? epochSecondsToIso({ seconds: resetSeconds }) : undefined;
  if (resetAtIso === undefined) {
    return err(ClaudeRotationErrors.usageShapeChanged({ field: `${PREFIX}-${window}-reset` }));
  }
  return ok({ resetAtIso, status: rawStatus, utilization });
}

/**
 * Read a window whose whole trio may legitimately be absent, all-or-nothing.
 *
 * Absent means every one of the three headers is missing, which is what a response to a request that did not
 * name that window's model looks like. A PARTIAL trio is not a lesser reading — it is the header contract
 * having changed underneath this parser — so it takes the same shape error as any other unrecognised field
 * rather than being quietly rounded down to absent.
 *
 * @param headers every header received
 * @param window the header infix naming the window
 * @returns the reading, `undefined` when the whole trio is absent, or the shape error
 */
function readOptionalWindow({
  headers,
  window,
}: {
  headers: Readonly<Record<string, string>>;
  window: string;
}): Result<ClaudeWindowReading | undefined, ClaudeRotationError> {
  // Presence is the header NAME being sent, never a non-blank value: a blank `5h-status` is a sent, malformed
  // field, so it falls through to `readWindow` and refuses rather than reading as an Ultra plan's absent trio.
  const names = new Set(
    ["status", "utilization", "reset"].map((field) => `${PREFIX}-${window}-${field}`.toLowerCase()),
  );
  const sent = Object.keys(headers).some((key) => names.has(key.toLowerCase()));
  if (!sent) {
    return ok(undefined);
  }
  return readWindow({ headers, window });
}

/**
 * The first header name this prefix carries twice under two casings.
 *
 * @param headers every header received
 * @returns the lower-cased name sent twice, or undefined when every name is sent once
 */
function casingCollision({ headers }: { headers: Readonly<Record<string, string>> }): string | undefined {
  const seen = new Set<string>();
  for (const key of Object.keys(headers)) {
    const name = key.toLowerCase();
    if (name.startsWith(PREFIX) && seen.has(name)) {
      return name;
    }
    seen.add(name);
  }
  return undefined;
}

/**
 * Parse a response's headers into one account's plan-wide gauge.
 *
 * @param headers every header the response carried, by name (any casing)
 * @param alias which configured plan this reading belongs to
 * @param observedAtIso when the read happened — injected so a gauge is never stamped from a hidden clock
 * @returns the gauge, or {@link ClaudeRotationErrors.usageShapeChanged} naming the field that failed
 */
export function parseClaudeGauge({
  alias,
  headers,
  observedAtIso,
}: {
  alias: string;
  headers: Readonly<Record<string, string>>;
  observedAtIso: string;
}): Result<ClaudeAccountGauge, ClaudeRotationError> {
  // Every lookup here takes the FIRST case-insensitive match, so two casings of one name would leave the second
  // unread. A fetch `Headers` never yields that (`headerRecord` lower-cases and merges), but the contract is "any
  // casing", so a record that carries one is refused rather than half-read.
  const collision = casingCollision({ headers });
  if (collision !== undefined) {
    return err(ClaudeRotationErrors.usageShapeChanged({ field: collision }));
  }
  const sevenDay = readWindow({ headers, window: "7d" });
  if (sevenDay.isErr()) {
    return err(sevenDay.error);
  }
  const statusFault = statusHeaderFault({ headers });
  if (statusFault !== undefined) {
    return err(ClaudeRotationErrors.usageShapeChanged({ field: statusFault }));
  }
  const fiveHour = readOptionalWindow({ headers, window: "5h" });
  if (fiveHour.isErr()) {
    return err(fiveHour.error);
  }
  const sevenDayFable = readOptionalWindow({ headers, window: FABLE_WINDOW });
  if (sevenDayFable.isErr()) {
    return err(sevenDayFable.error);
  }
  const representativeClaim = readClaim({ fiveHourSent: fiveHour.value !== undefined, headers });
  if (representativeClaim.isErr()) {
    return err(representativeClaim.error);
  }
  return ok({
    alias,
    observedAtIso,
    sevenDay: sevenDay.value,
    ...(fiveHour.value === undefined ? {} : { fiveHour: fiveHour.value }),
    ...(sevenDayFable.value === undefined ? {} : { sevenDayFable: sevenDayFable.value }),
    ...(representativeClaim.value === undefined ? {} : { representativeClaim: representativeClaim.value }),
  });
}

/**
 * Read the optional representative-claim header, refusing one that is malformed or contradicts the windows sent.
 *
 * @param headers every header received
 * @param fiveHourSent whether the five-hour trio was sent, which a `five_hour` claim requires
 * @returns the claim, `undefined` when no header of that name was sent, or the shape error naming it
 */
function readClaim({
  fiveHourSent,
  headers,
}: {
  fiveHourSent: boolean;
  headers: Readonly<Record<string, string>>;
}): Result<ClaudeRepresentativeClaim | undefined, ClaudeRotationError> {
  // Presence is the header NAME being sent, as in `readOptionalWindow`: a blank claim is sent and malformed.
  const claimName = `${PREFIX}-representative-claim`;
  const claimSent = Object.keys(headers).some((key) => key.toLowerCase() === claimName);
  if (!claimSent) {
    return ok(undefined);
  }
  const rawClaim = header({ headers, name: "representative-claim" });
  if (rawClaim === undefined || !isRepresentativeClaim(rawClaim)) {
    return err(ClaudeRotationErrors.usageShapeChanged({ field: claimName }));
  }
  // A claim naming the five-hour window as binding while no five-hour trio was sent contradicts itself: routing
  // on the week alone would ignore the very window the provider says binds.
  if (rawClaim === "five_hour" && !fiveHourSent) {
    return err(ClaudeRotationErrors.usageShapeChanged({ field: claimName }));
  }
  return ok(rawClaim);
}

/**
 * The HTTP statuses that mean the CREDENTIAL was refused, rather than the reading being unreadable.
 *
 * Only the two authentication answers, deliberately. Every other non-2xx keeps the fail-closed shape path:
 * a `429` still carries the rate-limit headers this parser exists to read, and a `5xx` is a provider fault
 * rather than a statement about a credential, so calling either of them a refusal would send a reader to
 * sign in over an outage the owner cannot fix.
 */
const CREDENTIAL_REFUSAL_STATUSES: ReadonlySet<number> = new Set([401, 403]);

/**
 * Read one probe response into a gauge, judging the STATUS before the headers.
 *
 * The order is the whole point and it is what {@link parseClaudeGauge} alone cannot do. A refused credential
 * answers with no `anthropic-ratelimit-*` headers at all, so a parser handed only the headers reports the
 * first field it could not find and blames the header contract — which is exactly what
 * {@link ClaudeRotationErrors.credentialRejected} carries the measurement for. The status is the evidence
 * that separates "this plan is dead" from "this response is a shape I do not know", and it was thrown away
 * at the call site rather than being unavailable.
 *
 * @param alias which configured plan this reading belongs to
 * @param headers every header the response carried, by name (any casing)
 * @param observedAtIso when the read happened — injected so a gauge is never stamped from a hidden clock
 * @param status the HTTP status the provider answered with
 * @returns the gauge, the refusal, or the shape error naming the field that failed
 */
export function readGaugeResponse({
  alias,
  headers,
  observedAtIso,
  status,
}: {
  alias: string;
  headers: Readonly<Record<string, string>>;
  observedAtIso: string;
  status: number;
}): Result<ClaudeAccountGauge, ClaudeRotationError> {
  if (CREDENTIAL_REFUSAL_STATUSES.has(status)) {
    return err(ClaudeRotationErrors.credentialRejected({ alias, status }));
  }
  return parseClaudeGauge({ alias, headers, observedAtIso });
}
