/**
 * The one place a plan's remaining budget is actually read — extracted so `gauge` and `watch` share a probe
 * rather than each keeping its own.
 *
 * That sharing is the point rather than tidiness. This workstream's recurring defect was a piece correct in
 * isolation and wrong where it met the next one, and two copies of a probe is exactly how the loop ends up
 * judging a differently-shaped reading from the one the read-only verb prints.
 *
 * The credential is opaque here and never leaves the function: it comes out of the keychain, goes straight
 * into one request's `authorization` header, and nothing on this path can log it. What comes back is
 * headers, which is where a gauge lives.
 *
 * ## Why the account comes back BESIDE the reading rather than inside it
 *
 * The same response also names the organisation the credential belongs to, which is what lets the watch loop
 * say which plan the fleet is on. But `ClaudeGaugeOutcome` is a RENDERABLE type — `claude gauge --json`
 * prints it verbatim — and an organisation id is a private identifier this repository may not emit. Putting
 * it on that type would leak it to stdout the moment anyone ran the read-only verb.
 *
 * So the two travel separately: the reading, which is safe to print, and the identity, which the caller
 * either files under the Slopweaver home or drops. A field that cannot be reached from a rendered document
 * is a stronger guarantee than a reviewer remembering to strip one.
 *
 * ## Why the TYPED result travels beside the renderable one
 *
 * `ClaudeGaugeOutcome` carries a failure as one `problem: string`, and that flattening is what made an expired
 * token look like an outage. A `401` and a dead network arrive as two sentences, so the only way to tell them
 * apart downstream was to match text — and the routing gate has to tell them apart exactly, because one is
 * repairable on demand and the other must attempt nothing at all. So {@link ClaudeProbeResult} carries the
 * real `Result` the parser already produced, and the printable outcome is DERIVED from it rather than computed
 * beside it. The gate branches on `code`; nothing branches on a message.
 *
 * **This function is one probe and never a refresh.** The repair is orchestrated by `probeRepair.ts`, which
 * calls this twice around a refresh it performs itself, for the routing gate and the keep-alive watch. Putting
 * the refresh in here would silently turn the read-only `claude gauge` verb and `claude signin --status` into
 * credential writers, because they share this probe — which is the whole reason it was extracted.
 */
import { isRecord } from "../lib/parsers.js";
import { err, type Result } from "../lib/result.js";
import type { ClaudeAccount, ClaudeAccountGauge } from "./contracts.js";
import { credentialHasAccessToken, readClaudeCredential } from "./credentialDocument.js";
import type { StoreLife } from "./credentialRepair.js";
import { type ClaudeRotationError, ClaudeRotationErrors } from "./errors.js";
import {
  headerRecord,
  organizationId,
  PROBE_URL,
  type ProbeCost,
  probeBody,
  probeHeaders,
  readProbeCost,
} from "./gaugeProbe.js";
import type { ClaudeGaugeOutcome } from "./gaugeRender.js";
import { readCredentialDocument } from "./keychain.js";
import { readSetupTokenFile, type SetupTokenFile, type SetupTokenProbe } from "./seatToken.js";
import { type CredentialDocumentReader, readStoreLife } from "./storeRefresh.js";
import { readGaugeResponse } from "./usage.js";

/** How long one probe may take before it is reported as unreadable. */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * What one probe learned: the reading a caller may print, and the account it may not.
 *
 * @internal — the value {@link probePlan} returns; the two shells destructure it rather than building one.
 */
export interface ClaudeProbeResult {
  /** The reading, safe to render — this is the half `claude gauge --json` prints. */
  readonly outcome: ClaudeGaugeOutcome;
  /**
   * The same conclusion as a typed result, which is what a caller BRANCHES on. `outcome` is derived from this
   * one value rather than computed beside it, so the printed sentence and the code can never disagree.
   */
  readonly reading: Result<ClaudeAccountGauge, ClaudeRotationError>;
  /**
   * The store's own lifetime metadata, read out of the SAME keychain document the request's token came from.
   * One read, so the expiry a repair decision is taken on is the expiry of the token that was actually
   * presented.
   */
  readonly life: StoreLife;
  /** The organisation the credential belongs to. A private identifier: file it, never print it. */
  readonly organizationId?: string;
  /** What the probe cost, when its response said — the same value `outcome.probeCost` prints. */
  readonly probeCost?: ProbeCost;
}

/**
 * The request seam, so a unit test can answer a probe without reaching the provider.
 *
 * @internal — a field type of {@link ProbePlanDeps}; callers build that object rather than naming this.
 */
export interface ProbeRequester {
  (options: { accessToken: string }): Promise<ProbeResponse>;
}

/**
 * What one probe request answered: its status, its headers, and what it cost when the body said so.
 *
 * @internal — the value a {@link ProbeRequester} resolves to.
 */
export interface ProbeResponse {
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
  /** Absent when the body stated no usage — UNMEASURED, never zero (`./gaugeProbe.ts` § the exemption). */
  readonly cost?: ProbeCost;
}

/* The cost as an optional field to spread, so an unmeasured probe carries no key rather than an undefined one. */
function costField({ cost }: { cost: ProbeCost | undefined }): { readonly probeCost?: ProbeCost } {
  return cost === undefined ? {} : { probeCost: cost };
}

/** The two effects {@link probePlan} performs, injectable so its whole decision table is unit-testable. */
export interface ProbePlanDeps {
  /** Read one store's keychain document. */
  readonly read?: CredentialDocumentReader;
  /** Make the one probe request. */
  readonly request?: ProbeRequester;
  /** Read the plan's setup token file. */
  readonly readToken?: (options: { storeDir: string }) => SetupTokenFile;
}

/**
 * Make one probe request over a setup token, and read what it proved.
 *
 * Shared by the routing gate's sweep and by `claude token`, which runs it BEFORE a token is written — so the
 * reading that accepted a token and the reading every later spawn routes on come from one function.
 *
 * @param alias the plan's neutral label
 * @param nowIso the instant to stamp the reading with
 * @param request the request seam, defaulting to the real probe — injected only by tests
 * @param token the setup token — passed straight into one request's header, never stored or logged here
 * @returns the reading, with a refusal named as the token's, and the account when the response named one
 */
export async function probeSetupToken({
  alias,
  nowIso,
  request = fetchProbe,
  token,
}: {
  alias: string;
  nowIso: string;
  request?: ProbeRequester;
  token: string;
}): Promise<SetupTokenProbe> {
  try {
    const { cost, headers, status } = await request({ accessToken: token });
    const organization = organizationId({ headers });
    const parsed = readGaugeResponse({ alias, headers, observedAtIso: nowIso, status });
    const refused = parsed.isErr() && parsed.error.code === "CREDENTIAL_REJECTED";
    const reading: Result<ClaudeAccountGauge, ClaudeRotationError> = refused
      ? err(ClaudeRotationErrors.setupTokenRejected({ alias, status }))
      : parsed;
    return {
      reading,
      ...costField({ cost }),
      ...(organization === undefined ? {} : { organizationId: organization }),
    };
  } catch {
    // The network, not the token — the caught value is discarded because it can hold the whole request.
    return { reading: err(ClaudeRotationErrors.probeTransportFailed({ alias })) };
  }
}

/**
 * Which organisation one OAuth login belongs to, read off the same one-token probe the gauge sends.
 *
 * `claude reset` binds a login to a plan with this before it reads or claims anything on it, so a login is never
 * credited to the wrong plan by its address. It is the gauge's own request rather than a copy, and a 429 at a
 * plan-wide limit still carries the header whenever the gauge grades identity on a spent plan.
 *
 * @param accessToken the login's access token — passed straight into one request's header, never stored or logged
 * @param request the request seam, defaulting to the real probe — injected only by tests
 * @returns the HTTP status and the organisation named, or that the network failed
 */
export async function probeOrganization({
  accessToken,
  request = fetchProbe,
}: {
  accessToken: string;
  request?: ProbeRequester;
}): Promise<{ readonly status: number; readonly organizationId?: string } | { readonly failed: "network" }> {
  try {
    const { headers, status } = await request({ accessToken });
    const organization = organizationId({ headers });
    return { status, ...(organization === undefined ? {} : { organizationId: organization }) };
  } catch {
    // The caught value is discarded: it can hold the whole request, bearer included.
    return { failed: "network" };
  }
}

/**
 * Probe a plan on its setup token, when its store directory holds a token file at all.
 *
 * @param alias the plan's neutral label
 * @param nowIso the instant to stamp the reading with
 * @param request the request seam
 * @param tokenFile what the plan's store directory holds by way of a token
 * @returns the token's probe, an unreadable-token refusal, or undefined when the plan has no token file
 */
async function probeTokenPlan({
  alias,
  nowIso,
  request,
  tokenFile,
}: {
  alias: string;
  nowIso: string;
  request: ProbeRequester;
  tokenFile: SetupTokenFile;
}): Promise<SetupTokenProbe | undefined> {
  if (tokenFile.kind === "absent") {
    return undefined;
  }
  if (tokenFile.kind === "unreadable") {
    return { reading: err(ClaudeRotationErrors.setupTokenUnreadable({ alias })) };
  }
  return probeSetupToken({ alias, nowIso, request, token: tokenFile.token });
}

/**
 * The printable half of a reading, derived from the typed one so the two cannot drift.
 *
 * @param alias the plan's neutral label
 * @param probeCost what the probe cost, when its response said
 * @param reading what the probe concluded
 * @returns the outcome `claude gauge --json` prints
 */
function outcomeFor({
  alias,
  probeCost,
  reading,
}: {
  alias: string;
  probeCost?: ProbeCost | undefined;
  reading: Result<ClaudeAccountGauge, ClaudeRotationError>;
}): ClaudeGaugeOutcome {
  const cost = costField({ cost: probeCost });
  return reading.isErr()
    ? { alias, problem: reading.error.message, ...cost }
    : { alias, gauge: reading.value, ...cost };
}

/* The body's cost, or undefined when the body could not be read at all — a valid header gauge still stands. */
async function bodyCost({ response }: { response: Response }): Promise<ProbeCost | undefined> {
  try {
    return readProbeCost({ text: await response.text() });
  } catch {
    return undefined;
  }
}

/**
 * The real probe request, isolated so the injected seam and the production call cannot drift.
 *
 * @param accessToken the plan's OAuth access token — passed straight through, never stored or logged
 * @returns the response's status, its headers by lowercase name, and what it cost when the body said
 */
async function fetchProbe({ accessToken }: { accessToken: string }): Promise<ProbeResponse> {
  const response = await fetch(PROBE_URL, {
    body: probeBody(),
    headers: probeHeaders({ accessToken }),
    method: "POST",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const cost = await bodyCost({ response });
  return {
    headers: headerRecord({ headers: response.headers }),
    status: response.status,
    ...(cost === undefined ? {} : { cost }),
  };
}

/**
 * Probe one plan and turn the response headers into a gauge, an account, and that store's own lifetime.
 *
 * ONE probe. It never refreshes anything: `probeRepair.ts` calls it either side of a refresh it performs
 * itself, precisely so the read-only `claude gauge` verb and the keep-alive watch — which share this probe —
 * do not quietly become credential writers.
 *
 * @param alias the plan's neutral label, for the reading and any problem
 * @param deps the keychain and request seams, defaulting to the real ones — injected only by tests
 * @param storeDir that plan's credential store
 * @param nowIso the instant to stamp the reading with
 * @returns the typed reading, its printable form, the store's lifetime, and the account when one was named
 */
export async function probePlan({
  alias,
  deps = {},
  nowIso,
  storeDir,
}: {
  alias: string;
  deps?: ProbePlanDeps;
  nowIso: string;
  storeDir: string;
}): Promise<ClaudeProbeResult> {
  const { read = readCredentialDocument, readToken = readSetupTokenFile, request = fetchProbe } = deps;
  const account: ClaudeAccount = { alias, storeDir };
  // The metadata and the token come from ONE read of one document, so a repair decision is never taken on
  // the expiry of a credential other than the one the provider refused.
  const document = read({ storeDir });
  const life = readStoreLife({ account, read: () => document });
  // A plan holding a setup token is read ON that token, because that is what every seat routed to it spends.
  // Its refusal is SETUP_TOKEN_REJECTED, never CREDENTIAL_REJECTED, so the on-demand repair — which refreshes
  // the STORE — cannot mistake a dead token for an expired store. An unreadable token file is never read past.
  const tokenProbe = await probeTokenPlan({ alias, nowIso, request, tokenFile: readToken({ storeDir }) });
  if (tokenProbe !== undefined) {
    return {
      life,
      outcome: outcomeFor({ alias, probeCost: tokenProbe.probeCost, reading: tokenProbe.reading }),
      ...tokenProbe,
    };
  }
  const slice = readClaudeCredential({ document });
  // An EMPTIED credential and an absent one are the same answer to the only question this gate asks: there
  // is nothing to present. Reporting them apart cost a request and said the wrong thing — the emptied shape
  // carries an access token of the empty string, which passed the old type-only guard and went to the
  // provider as `Bearer `, and its old wording blamed the build rather than naming the sign-in that repairs
  // it. `credentialDocument.ts` carries the measurement.
  const credential = slice?.credential;
  if (!credentialHasAccessToken({ slice })) {
    const reading = err(ClaudeRotationErrors.storeNotReady({ alias }));
    return { life, outcome: outcomeFor({ alias, reading }), reading };
  }
  const accessToken =
    isRecord(credential) && typeof credential["accessToken"] === "string" ? credential["accessToken"] : "";
  return probeStoreLogin({ accessToken, alias, life, nowIso, request });
}

/**
 * The one request over a store's own login, once {@link probePlan} has a token to present.
 *
 * @param accessToken the store's OAuth access token — passed straight through, never stored or logged
 * @param alias the plan's neutral label, for the reading and any problem
 * @param life the store's lifetime, read out of the same document the token came from
 * @param nowIso the instant to stamp the reading with
 * @param request the request seam
 * @returns the typed reading, its printable form, the store's lifetime, the cost and the account when named
 */
async function probeStoreLogin({
  accessToken,
  alias,
  life,
  nowIso,
  request,
}: {
  accessToken: string;
  alias: string;
  life: StoreLife;
  nowIso: string;
  request: ProbeRequester;
}): Promise<ClaudeProbeResult> {
  try {
    const { cost, headers, status } = await request({ accessToken });
    // The account is read whether or not the reading parses: a store the provider answered at all has proved
    // which account it holds, and that fact is what stops the keep-alive loop refusing to touch anything.
    const organization = organizationId({ headers });
    const identity = organization === undefined ? {} : { organizationId: organization };
    const reading = readGaugeResponse({ alias, headers, observedAtIso: nowIso, status });
    return {
      life,
      outcome: outcomeFor({ alias, probeCost: cost, reading }),
      reading,
      ...costField({ cost }),
      ...identity,
    };
  } catch {
    // A thrown or aborted request is the NETWORK, not a statement about the credential, and the gate must
    // attempt no refresh for it — `credentialRepair.ts` § Eligibility is NARROW carries the owner's own
    // naming of this case. The caught value is deliberately discarded: it can hold the whole request.
    const reading = err(ClaudeRotationErrors.probeTransportFailed({ alias }));
    return { life, outcome: outcomeFor({ alias, reading }), reading };
  }
}

/**
 * What the active slot answered: which account it belongs to, and how much of that account's budget is left.
 *
 * @internal — the value {@link probeActiveSlot} returns; the loop destructures it rather than building one.
 */
export interface ClaudeActiveProbe {
  /** The organisation the active credential belongs to. A private identifier: file it, never print it. */
  readonly organizationId?: string;
  /** Both plan-wide windows, under a placeholder alias the caller re-stamps once it knows the real one. */
  readonly gauge?: ClaudeAccountGauge;
  /** What the probe cost, when its response said. */
  readonly probeCost?: ProbeCost;
}

/**
 * The alias a reading carries before the caller knows which plan the active slot is checked out from.
 *
 * A gauge cannot be parsed without one, and the answer to "which plan" is downstream of this probe. So the
 * reading is stamped with a name no configured plan may take — `config.ts` refuses an alias with a `:` in
 * it — and re-stamped once the plan is resolved. A placeholder that could collide with a real alias would
 * silently attribute the active slot's budget to whichever plan happened to share the name.
 *
 * @internal — exported so a test can assert the placeholder is one no configured alias could take.
 */
export const ACTIVE_SLOT_ALIAS = "active:slot";

/**
 * Probe whatever credential the ACTIVE slot currently holds.
 *
 * ## The reading is the point, not a bonus
 *
 * The active plan is the one whose budget the fleet is actually spending, and it is also the plan whose
 * STORE a probe most often cannot read — the slot has refreshed past the credential the store still holds,
 * so that store answers 401. MEASURED on one machine: `plan-two` and `plan-three` answered 200
 * while `plan-one`, the plan the fleet was running on, answered 401. A loop reading only the stores is
 * therefore blind to the one gauge that decides whether it should rotate.
 *
 * The active slot itself answers 200 and its headers carry that same account's windows, so the reading the
 * trigger needs was one request away the whole time. Reproduce with `slopweaver claude watch --once`.
 *
 * The active slot has no alias of its own — that is the question this probe half answers — so the reading
 * comes back under {@link ACTIVE_SLOT_ALIAS} for the caller to re-stamp.
 *
 * @param nowIso the instant to stamp the reading with
 * @returns the account and the reading, each absent when the probe could not establish it
 */
export async function probeActiveSlot({ nowIso }: { nowIso: string }): Promise<ClaudeActiveProbe> {
  const slice = readClaudeCredential({ document: readCredentialDocument({}) });
  const credential = slice?.credential;
  if (!credentialHasAccessToken({ slice })) {
    return {};
  }
  const accessToken =
    isRecord(credential) && typeof credential["accessToken"] === "string" ? credential["accessToken"] : "";
  try {
    const { cost, headers, status } = await fetchProbe({ accessToken });
    const organization = organizationId({ headers });
    const parsed = readGaugeResponse({ alias: ACTIVE_SLOT_ALIAS, headers, observedAtIso: nowIso, status });
    return {
      ...(organization === undefined ? {} : { organizationId: organization }),
      ...(parsed.isErr() ? {} : { gauge: parsed.value }),
      ...costField({ cost }),
    };
  } catch {
    return {};
  }
}
