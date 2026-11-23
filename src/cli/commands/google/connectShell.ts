/**
 * The effectful shell every Google `connect` verb runs — the one verb shape in this product that opens a
 * listening socket, and the only one that hands the owner a browser and waits.
 *
 * `--status` is a genuinely separate path rather than a flag the flow checks late: it reads the stored grant
 * and stops. No consent URL, no socket, no browser. That matters because the ordinary reason to ask "am I
 * connected, and as which account?" must never be answerable only by starting a new consent round trip.
 *
 * The grant that lands is the one Google ACTUALLY approved, not the one that was requested. Google's consent
 * screen lets a user tick a narrower set than the application asked for, and a store that recorded the
 * request would then refuse nothing and fail at the API instead — with a 403 that names no scope. Recording
 * the granted set is what lets each door's client resolver refuse before the call and name what is missing.
 *
 * It is generic over the door because the mail door and the Drive door differ here in exactly three things:
 * the word they print, the capability vocabulary their parser produces, and the grant file they write. Each
 * of those is a parameter, and everything else — the status path, the withheld-scope warning, the exit codes
 * — is behaviour both doors must not be able to drift apart on.
 */
import { parseIsoMs } from "#lib/date.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { ConsentOutcome } from "../../../live/google/consent.js";
import { landingLapseNotice, refreshLapseField, statusLapseWarning } from "../../../live/google/refreshLapse.js";
import type { RevokeOutcome } from "../../../live/google/revoke.js";
import {
  type GoogleScopeTable,
  notReadOnlyScopes,
  parseGrantedScopes,
  scopesToRequest,
} from "../../../live/google/scopes.js";
import type { GoogleGrant, GoogleGrantStatus } from "../../../secrets/googleGrant.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

/** What a door's own `connect` parser must produce. */
export interface GoogleConnectArgs<TCapability extends string> {
  readonly home: string | undefined;
  readonly capabilities: readonly TCapability[];
  readonly json: boolean;
  /** Report the stored grant and stop, without opening a browser or a socket. */
  readonly statusOnly: boolean;
  /** Withdraw the stored grant at Google and delete the file, without opening a browser or a socket. */
  readonly revoke: boolean;
}

/** The seams the connect shell performs its effects through. */
export interface GoogleConnectDeps<TError> {
  /** Run the browser consent round trip and return the granted tokens plus the bound account. */
  readonly consent: (args: { home: string; scopes: readonly string[] }) => Promise<Result<ConsentOutcome, TError>>;
  /** Persist a completed grant, returning the path it was written to. */
  readonly persist: (args: { home: string; grant: GoogleGrant }) => Result<string>;
  /** Read the stored grant's token-free status, or undefined when nothing is stored. */
  readonly status: (args: { home: string }) => Result<GoogleGrantStatus | undefined>;
  /** Withdraw the stored grant at Google and delete it, or report that there was none to withdraw. */
  readonly revoke: (args: { home: string }) => Promise<Result<RevokeOutcome | undefined, TError>>;
  readonly nowIso: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** The door's own vocabulary — what it is called, and how it names a consent failure. */
export interface GoogleConnectDoor<TError, TCapability extends string> {
  /** The noun the verb lives under, leading every human line: `gmail`, `drive`. */
  readonly noun: string;
  /** The command that re-establishes the grant, named when Google withholds a refresh token. */
  readonly connectVerb: string;
  /** This door's scope vocabulary, used to turn requested capabilities into scope URIs. */
  readonly scopeTable: GoogleScopeTable<TCapability>;
  /** This door's failure factory — see `src/live/google/consent.ts` for why it is injected. */
  readonly consentFailed: (args: { message: string; cause?: unknown }) => TError;
  /**
   * Present on a door whose grant must never carry a write: a landed grant holding any scope not provably
   * read-only is refused BEFORE it is stored. The Google Admin door sets it — what Google merges onto a
   * grant is outside this repository, so the store is where the owner's read-only ruling can be held.
   */
  readonly readOnly?: true;
}

/** Render a grant status for a human — account, scopes, and where the file lives. Never a token. */
function renderStatus({ noun, status }: { noun: string; status: GoogleGrantStatus }): string {
  return [
    `${noun}: connected as ${status.account}`,
    `granted at: ${status.grantedAtIso}`,
    ...(status.refreshTokenExpiresAtIso === undefined
      ? []
      : [`refresh token lapses at: ${status.refreshTokenExpiresAtIso}`]),
    "scopes:",
    ...status.scopes.map((scope) => `  - ${scope}`),
    `grant file: ${status.path} (owner-only)`,
  ].join("\n");
}

/**
 * Report the stored grant and stop. `EXIT_EXPECTED_EMPTY` when nothing is connected — a finding, not a fault. A
 * refresh token lapsing within 48 hours, or already lapsed, adds one diagnostic naming the door's connect verb;
 * the exit stays `EXIT_OK`, because the report itself is complete.
 */
function reportStatus<TError, TCapability extends string>({
  home,
  json,
  door,
  deps,
}: {
  home: string;
  json: boolean;
  door: GoogleConnectDoor<TError, TCapability>;
  deps: GoogleConnectDeps<TError>;
}): number {
  const { noun } = door;
  const status = deps.status({ home });
  if (status.isErr()) {
    for (const problem of status.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  if (status.value === undefined) {
    deps.writeOut(json ? JSON.stringify({ connected: false }, undefined, 2) : `${noun}: not connected`);
    return EXIT_EXPECTED_EMPTY;
  }
  deps.writeOut(
    json
      ? JSON.stringify({ connected: true, ...status.value }, undefined, 2)
      : renderStatus({ noun, status: status.value }),
  );
  const warning = statusLapseWarning({
    expiresAtIso: status.value.refreshTokenExpiresAtIso,
    readNowIso: deps.nowIso,
    reconnectVerb: door.connectVerb,
  });
  if (warning !== undefined) {
    deps.writeDiagnostic(`${noun}: ${warning}`);
  }
  return EXIT_OK;
}

/** Turn a completed consent round trip into the grant that gets stored. */
function grantFrom<TError, TCapability extends string>({
  outcome,
  nowIso,
  door,
}: {
  outcome: ConsentOutcome;
  nowIso: () => string;
  door: GoogleConnectDoor<TError, TCapability>;
}): Result<GoogleGrant, TError> {
  const { tokens, account } = outcome;
  if (tokens.refreshToken === undefined) {
    return err(
      door.consentFailed({
        message:
          "Google returned no refresh token, so the grant would stop working within the hour. This happens when a " +
          `grant for this client already exists on the account — withdraw it with \`${door.connectVerb} --revoke\`, ` +
          `or at https://myaccount.google.com/permissions, and run \`${door.connectVerb}\` again`,
      }),
    );
  }
  // One clock read serves both fields, so the expiry is exactly `expires_in` after the instant the grant
  // says it landed. Without `expiryMs` the auth client treats the cached access token as never expiring and
  // never refreshes it ahead of time, so the first call after it lapses is a 401 rather than a refresh.
  const grantedAtIso = nowIso();
  const grantedAtMs = parseIsoMs({ tsIso: grantedAtIso });
  if (grantedAtMs === undefined) {
    return err(
      door.consentFailed({
        message: `the grant's own timestamp ${grantedAtIso} is not an ISO instant, so its access token's expiry cannot be recorded`,
      }),
    );
  }
  const lapse = refreshLapseField({ grantedAtMs, lifetimeSeconds: tokens.refreshTokenExpiresInSeconds });
  if (lapse === undefined) {
    return err(
      door.consentFailed({
        message: `Google gave the refresh token a lifetime of ${String(tokens.refreshTokenExpiresInSeconds)} seconds, which ends past any instant that can be recorded`,
      }),
    );
  }
  return ok({
    account,
    grantedAtIso,
    refreshToken: tokens.refreshToken,
    scopes: parseGrantedScopes({ scope: tokens.scope }),
    accessToken: tokens.accessToken,
    expiryMs: grantedAtMs + tokens.expiresInSeconds * 1000,
    ...lapse,
  });
}

/** Report what landed, and warn loudly when the approved grant is narrower than what was asked for. */
function reportGranted<TError, TCapability extends string>({
  capabilities,
  deps,
  door,
  grant,
  path,
  json,
}: {
  capabilities: readonly TCapability[];
  deps: GoogleConnectDeps<TError>;
  door: GoogleConnectDoor<TError, TCapability>;
  grant: GoogleGrant;
  path: string;
  json: boolean;
}): number {
  const requested = scopesToRequest({ capabilities, table: door.scopeTable });
  const withheld = requested.filter((scope) => !grant.scopes.includes(scope));
  for (const scope of withheld) {
    deps.writeDiagnostic(`this grant does NOT carry ${scope} — the verbs needing it will refuse`);
  }
  if (grant.refreshTokenExpiresAtIso !== undefined) {
    deps.writeDiagnostic(
      landingLapseNotice({ expiresAtIso: grant.refreshTokenExpiresAtIso, reconnectVerb: door.connectVerb }),
    );
  }
  // The status is built from the write's OWN return value rather than re-derived, so the path printed is
  // provably the file that was just written rather than a second computation of where it should have gone.
  const status: GoogleGrantStatus = {
    account: grant.account,
    grantedAtIso: grant.grantedAtIso,
    path,
    scopes: grant.scopes,
    ...(grant.refreshTokenExpiresAtIso === undefined
      ? {}
      : { refreshTokenExpiresAtIso: grant.refreshTokenExpiresAtIso }),
  };
  deps.writeOut(
    json
      ? JSON.stringify({ connected: true, withheld, ...status }, undefined, 2)
      : renderStatus({ noun: door.noun, status }),
  );
  return EXIT_OK;
}

/**
 * Withdraw the stored grant and say what went. `EXIT_EXPECTED_EMPTY` when there was nothing stored — the
 * same shape `--status` uses for not-connected, because "there was no grant to withdraw" is a finding
 * rather than a fault.
 */
async function reportRevoked<TError extends { readonly message: string }, TCapability extends string>({
  home,
  json,
  door,
  deps,
}: {
  home: string;
  json: boolean;
  door: GoogleConnectDoor<TError, TCapability>;
  deps: GoogleConnectDeps<TError>;
}): Promise<number> {
  const revoked = await deps.revoke({ home });
  if (revoked.isErr()) {
    deps.writeDiagnostic(revoked.error.message);
    return EXIT_ERROR;
  }
  if (revoked.value === undefined) {
    deps.writeOut(json ? JSON.stringify({ revoked: false }, undefined, 2) : `${door.noun}: nothing to revoke`);
    return EXIT_EXPECTED_EMPTY;
  }
  deps.writeOut(
    json
      ? JSON.stringify({ revoked: true, ...revoked.value }, undefined, 2)
      : [
          `${door.noun}: withdrew the grant for ${revoked.value.account} and deleted ${revoked.value.path}`,
          "Google revokes the whole (client, account) grant at once, so every door sharing this OAuth client",
          `is now disconnected too — re-run \`${door.connectVerb}\` and each of theirs to consent again`,
        ].join("\n"),
  );
  return EXIT_OK;
}

/**
 * Run one door's `connect` verb against injected edges.
 *
 * @param rest argv after `<noun> connect`
 * @param parse the door's own pure parser for that tail
 * @param door the door's vocabulary and scope table
 * @param deps the consent, storage and output seams
 * @returns the process exit code
 */
export async function runGoogleConnect<TError extends { readonly message: string }, TCapability extends string>({
  rest,
  parse,
  door,
  deps,
}: {
  rest: readonly string[];
  parse: (args: { rest: readonly string[] }) => Result<GoogleConnectArgs<TCapability>>;
  door: GoogleConnectDoor<TError, TCapability>;
  deps: GoogleConnectDeps<TError>;
}): Promise<number> {
  const parsed = parse({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: parsed.value.home });
  if (parsed.value.statusOnly && parsed.value.revoke) {
    deps.writeDiagnostic(
      "--status and --revoke ask for opposite things: one reports the grant, the other destroys it. Pick one",
    );
    return EXIT_USAGE;
  }
  if (parsed.value.statusOnly) {
    return reportStatus({ deps, door, home, json: parsed.value.json });
  }
  if (parsed.value.revoke) {
    return reportRevoked({ deps, door, home, json: parsed.value.json });
  }
  const outcome = await deps.consent({
    home,
    scopes: scopesToRequest({ capabilities: parsed.value.capabilities, table: door.scopeTable }),
  });
  if (outcome.isErr()) {
    deps.writeDiagnostic(outcome.error.message);
    return EXIT_ERROR;
  }
  const grant = grantFrom({ door, nowIso: deps.nowIso, outcome: outcome.value });
  if (grant.isErr()) {
    deps.writeDiagnostic(grant.error.message);
    return EXIT_ERROR;
  }
  const path = storeGrant({ deps, door, grant: grant.value, home });
  if (path === undefined) {
    return EXIT_ERROR;
  }
  return reportGranted({
    capabilities: parsed.value.capabilities,
    deps,
    door,
    grant: grant.value,
    json: parsed.value.json,
    path,
  });
}

/**
 * Store a landed grant, unless the door is read-only and the grant carries a scope not provably read-only.
 *
 * @param grant the grant Google returned, not yet on disk
 * @param door the door whose `readOnly` decides whether a write scope is refused
 * @param deps the storage and diagnostic seams
 * @param home the state home the grant is written into
 * @returns the stored file's path, or undefined once every reason it was not stored has been written
 */
function storeGrant<TError, TCapability extends string>({
  grant,
  door,
  deps,
  home,
}: {
  grant: GoogleGrant;
  door: GoogleConnectDoor<TError, TCapability>;
  deps: GoogleConnectDeps<TError>;
  home: string;
}): string | undefined {
  const writes = door.readOnly === true ? notReadOnlyScopes({ scopes: grant.scopes }) : [];
  if (writes.length > 0) {
    deps.writeDiagnostic(
      `${door.noun}: refused to store the grant — this door is read-only and Google returned ${writes.join(", ")}. ` +
        "A client that has ever been granted a write scope on this account can be issued one again, so consent " +
        "through an OAuth client that has never been shown one",
    );
    return undefined;
  }
  const written = deps.persist({ grant, home });
  if (written.isErr()) {
    for (const problem of written.error) {
      deps.writeDiagnostic(problem);
    }
    return undefined;
  }
  return written.value;
}
