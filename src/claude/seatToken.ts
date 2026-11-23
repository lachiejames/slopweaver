/**
 * Every seat boots on its plan's SETUP TOKEN, handed over a file descriptor, against a store nothing routes on —
 * the re-architecture that makes "a sign-in replaced a slot" impossible rather than detected.
 *
 * ## The class, and why a token kills it at the mechanism
 *
 * Until this module a seat booted with `CLAUDE_SECURESTORAGE_CONFIG_DIR=<plan store>`, so the credential the
 * fleet spent WAS the store, and any `/login` inside any seat wrote straight into it. A refresh rotates the
 * refresh token too (measured, `keychain.ts`), so a store is also a revocation surface. Both are
 * properties of a stored, refreshing credential.
 *
 * A `claude setup-token` credential is neither. Read from Claude Code 2.1.270 to 2.1.272's own binary: a token
 * supplied through `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` carries no refresh token, the only writer of a
 * stored credential returns without writing when there is none, and the fd reader writes the value to disk only
 * under `CLAUDE_CODE_REMOTE`. Reproduce the variable's presence with
 * `strings ~/.local/share/claude/versions/2.1.272 | grep -c CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`.
 *
 * ## The one path back into the class, and why the seat's store is UNBOUND
 *
 * The same binary, on a `401` over an env or fd token, reads the credential STORE and ADOPTS its access token
 * when it differs and has not expired. So a token seat still pointed at its plan's store would, on one refusal,
 * quietly fall back onto that store — and a `/login` inside the seat would still write into it. The seat
 * therefore boots against `claude-accounts/unbound/<seat>`, a store no plan names: a sign-in there creates an
 * unbound credential and mutates nothing routing depends on, and a `401` finds nothing to adopt. That is the
 * invariant, stated so a design can be tested against it: **no seat's store is a store routing reads.**
 *
 * ## What is owed rather than proven
 *
 * The first minted token proves the rate-limit windows and plan identity
 * survive. {@link judgeSetupToken} is that proof, and `slopweaver claude token --plan <alias>` refuses to write
 * a token it has not seen answer with a gauge, a Fable week, and the account enrolled for that plan.
 */
import { mkdirSync, readFileSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { normaliseSecretInput } from "../secrets/store.js";
import type { ClaudeAccountAlias, ClaudeAccountGauge, ClaudeWindowReading } from "./contracts.js";
import { type ClaudeRotationError, ClaudeRotationErrors } from "./errors.js";
import type { ProbeCost } from "./gaugeProbe.js";
import { assessIdentity, type ClaudeIdentityAssertion } from "./identityAssertions.js";

/** The file inside a plan's store directory that holds its setup token, mode `0600`. */
const SETUP_TOKEN_FILE = "setup-token";

/** The descriptor a seat's boot line opens the token on, and names in the variable Claude Code reads. */
export const SETUP_TOKEN_FD = 3;

/** The variable Claude Code reads a token's file descriptor number from at boot. */
export const SETUP_TOKEN_FD_ENV = "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR";

/** Where each seat's unbound store lives, relative to the Slopweaver home. */
const UNBOUND_SEATS_DIR = "claude-accounts/unbound";

/**
 * What `claude setup-token` prints begins with this, so a paste of anything else — an API key, a
 * half-copied line — is refused before a request is spent on it. The prefix names a kind, not a secret.
 */
const SETUP_TOKEN_PREFIX = "sk-ant-oat";

/** What a plan's store directory holds by way of a setup token. */
export type SetupTokenFile =
  /** No token file: the plan still boots on its store, exactly as before this module. */
  | { readonly kind: "absent" }
  /** A token file this process could not read, or one holding nothing. Never a reason to fall back. */
  | { readonly kind: "unreadable" }
  /** A readable token. The value never leaves the caller that asked for it. */
  | { readonly kind: "token"; readonly token: string };

/**
 * The path of one plan's setup token.
 *
 * Inside the store directory so it follows the alias exactly as the keychain service does: a rename is a
 * re-enrollment for the token too (`skills/supervisor/reference/plan-routing.md` § A RENAME IS A RE-ENROLLMENT).
 *
 * @param storeDir the plan's store directory
 * @returns the token file's path
 */
export function setupTokenPath({ storeDir }: { storeDir: string }): string {
  return `${storeDir}/${SETUP_TOKEN_FILE}`;
}

/**
 * Read one plan's setup token file, telling ABSENT apart from present-and-unusable.
 *
 * The distinction is the invariant: a token file that will not read must refuse a spawn, never boot it on the
 * plan's store, because booting on the store is exactly the state this module exists to leave.
 *
 * @param storeDir the plan's store directory
 * @returns the token, or which of the two non-token states the file is in
 */
export function readSetupTokenFile({ storeDir }: { storeDir: string }): SetupTokenFile {
  try {
    const token = readFileSync(setupTokenPath({ storeDir }), "utf8").trim();
    return token === "" ? { kind: "unreadable" } : { kind: "token", token };
  } catch (cause) {
    const code = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
    return code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable" };
  }
}

/**
 * Clean a pasted value and refuse anything that is not a setup token.
 *
 * @param input the raw captured value, from a no-echo prompt or piped stdin, never argv
 * @returns the single-line token, or why it was refused
 */
export function validateSetupToken({ input }: { input: string }): Result<string, ClaudeRotationError> {
  const normalised = normaliseSecretInput({ input });
  if (normalised.isErr()) {
    return err(ClaudeRotationErrors.setupTokenInvalid({ problem: normalised.error.message }));
  }
  if (!normalised.value.startsWith(SETUP_TOKEN_PREFIX)) {
    return err(
      ClaudeRotationErrors.setupTokenInvalid({
        problem: `\`claude setup-token\` prints one beginning ${SETUP_TOKEN_PREFIX}`,
      }),
    );
  }
  return ok(normalised.value);
}

/**
 * Write a verified token into its plan's store directory, atomically, at `0600` under a `0700` directory.
 *
 * @param storeDir the plan's store directory
 * @param token the token {@link judgeSetupToken} has already accepted
 * @returns the path written, or why the write failed — never the value
 */
export function writeSetupToken({
  storeDir,
  token,
}: {
  storeDir: string;
  token: string;
}): Result<string, ClaudeRotationError> {
  const path = setupTokenPath({ storeDir });
  try {
    writeFileAtomic({ contents: token, dirMode: 0o700, fileMode: 0o600, path });
  } catch (cause) {
    return err(ClaudeRotationErrors.setupTokenWriteFailed({ cause, path }));
  }
  return ok(path);
}

/**
 * Create a seat's unbound store directory at `0700`, under `$SLOPWEAVER_HOME/claude-accounts/unbound/`.
 *
 * @param storeDir the unbound store {@link seatCredential} named
 */
function ensureUnboundStore({ storeDir }: { storeDir: string }): void {
  mkdirSync(storeDir, { mode: 0o700, recursive: true });
}

/** How one seat will authenticate, decided from the store the routing gate chose. */
export type SeatCredential =
  /** The plan has no token yet, so the seat boots on its store as it always did. */
  | { readonly kind: "store"; readonly storeDir: string }
  /** The seat boots on the token over a descriptor, against an unbound store of its own. */
  | { readonly kind: "setup-token"; readonly storeDir: string; readonly tokenPath: string }
  /** The plan HAS a token file that will not read. Refused, never downgraded to the store. */
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Decide how a seat authenticates on the plan routing chose. Pure.
 *
 * @param home the Slopweaver home the unbound stores live under
 * @param seat the seat's own name — its worktree's directory name — so no two seats share an unbound store
 * @param storeDir the store the routing gate chose for this spawn
 * @param tokenFile what that store directory holds by way of a token
 * @returns the store to boot against and, when there is one, the token file to open on the descriptor
 */
export function seatCredential({
  home,
  seat,
  storeDir,
  tokenFile,
}: {
  home: string;
  seat: string;
  storeDir: string;
  tokenFile: SetupTokenFile;
}): SeatCredential {
  if (tokenFile.kind === "absent") {
    return { kind: "store", storeDir };
  }
  if (tokenFile.kind === "unreadable") {
    return {
      kind: "refused",
      reason:
        `claude credential: ${setupTokenPath({ storeDir })} exists and holds no readable token — REFUSING rather ` +
        `than booting this seat on the plan's store, which is the state setup tokens exist to leave; fix its ` +
        `permissions or replace it with \`slopweaver claude token --plan <alias>\``,
    };
  }
  return {
    kind: "setup-token",
    storeDir: `${home}/${UNBOUND_SEATS_DIR}/${seat}`,
    tokenPath: setupTokenPath({ storeDir }),
  };
}

/**
 * Turn the store a routing gate chose into what the boot line carries: read its token file, decide the seat's
 * credential, and create the unbound store when the seat boots on a token.
 *
 * The ONE step both `cmux spawn` (`../cmux/spawnDeps.ts`) and `cmux reseat` (`../cli/commands/cmux/reseatEffects.ts`)
 * take after the gate, so a fresh seat and a relaunched one can never authenticate differently on one plan.
 *
 * @param home the Slopweaver home the unbound stores live under
 * @param seat the seat's own name — its worktree's directory name
 * @param storeDir the store the routing gate chose
 * @returns the store to boot against, the token file when the plan holds one, or the refusal
 */
export function bootCredentialForStore({
  home,
  seat,
  storeDir,
}: {
  home: string;
  seat: string;
  storeDir: string;
}): Result<{ readonly storeDir: string; readonly tokenPath?: string }, string> {
  const credential = seatCredential({ home, seat, storeDir, tokenFile: readSetupTokenFile({ storeDir }) });
  if (credential.kind === "refused") {
    return err(credential.reason);
  }
  if (credential.kind === "store") {
    return ok({ storeDir: credential.storeDir });
  }
  ensureUnboundStore({ storeDir: credential.storeDir });
  return ok({ storeDir: credential.storeDir, tokenPath: credential.tokenPath });
}

/** What a token's one probe established, as {@link judgeSetupToken} reads it. */
export interface SetupTokenProbe {
  readonly reading: Result<ClaudeAccountGauge, ClaudeRotationError>;
  /** The organisation the response named. A private identifier: compared here, never rendered. */
  readonly organizationId?: string;
  /** What the probe cost, when its response said — carried so a setup-token plan's gauge prints it too. */
  readonly probeCost?: ProbeCost;
}

/**
 * Whether a pasted token may become its plan's credential: the owner's proof that windows and identity survive.
 *
 * Three things must hold, and each refusal names which: the provider answered with a gauge; that gauge carries
 * the Fable week, without which Fable routing is blind to this plan (`gaugeProbe.ts` § PROBE_MODEL); and the
 * account the response named is the one ENROLLED for this plan — never merely some account, because a token
 * minted while signed into the wrong plan is the slot replacement this module exists to end.
 *
 * @param alias the plan the token is offered for
 * @param assertion the plan's standing enrollment, when it has one
 * @param probe what one request made with the token established
 * @returns the lines to print and whether the token may be written
 */
export function judgeSetupToken({
  alias,
  assertion,
  probe,
}: {
  alias: ClaudeAccountAlias;
  assertion?: ClaudeIdentityAssertion;
  probe: SetupTokenProbe;
}): { readonly ok: boolean; readonly lines: readonly string[] } {
  const refuse = ({ why }: { why: string }): { ok: boolean; lines: readonly string[] } => ({
    lines: [`${alias}: setup token NOT written — ${why}`],
    ok: false,
  });
  if (probe.reading.isErr()) {
    return refuse({ why: probe.reading.error.message });
  }
  const gauge = probe.reading.value;
  if (gauge.sevenDayFable === undefined) {
    return refuse({
      why: "the response carried no Fable week, so Fable routing could not see this plan on this token",
    });
  }
  const identity = assessIdentity({
    alias,
    ...(assertion === undefined ? {} : { assertion }),
    ...(probe.organizationId === undefined ? {} : { observedOrganizationId: probe.organizationId }),
  });
  if (identity.kind === "unbound") {
    return refuse({
      why: `no account is enrolled for ${alias} to check it against; enrol one with \`slopweaver claude signin --enroll ${alias}\``,
    });
  }
  if (identity.kind === "unobserved") {
    return refuse({ why: "the response named no account, so which plan this token spends could not be proven" });
  }
  if (identity.kind === "changed") {
    return refuse({
      why: `this token belongs to a DIFFERENT account from the one enrolled for ${alias}; mint it signed into that plan's account`,
    });
  }
  const spent = (window: ClaudeWindowReading): string => `${String(Math.round(window.utilization * 100))}%`;
  // A five-hour window is named only when the plan carries one, which no plan does any more (`contracts.ts`).
  const fiveHour = gauge.fiveHour === undefined ? "" : `5h ${spent(gauge.fiveHour)}, `;
  return {
    lines: [
      `${alias}: setup token VERIFIED — windows survive (${fiveHour}week ${spent(gauge.sevenDay)}, fable ${spent(gauge.sevenDayFable)}) and the account is the one enrolled`,
    ],
    ok: true,
  };
}
