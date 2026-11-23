/**
 * The failure kinds of `slopweaver claude mint`. They are members of `errors.ts`'s `ClaudeRotationError`
 * union — the same domain, split into its own file only so neither file outgrows the size ratchet — and
 * `ClaudeRotationErrors` spreads {@link MintErrors} in, so a caller constructs them there like any other.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";

/** `claude mint`'s argument tail was refused. */
export interface MintArgsInvalidError {
  readonly code: "MINT_ARGS_INVALID";
  readonly message: string;
  /** Every reason the argument tail was refused, in the order they were found. */
  readonly problems: readonly string[];
}

/**
 * The plan has no ENROLLED address to pre-fill, so the mint refuses before anything is spawned.
 *
 * The mint never falls back to `accounts.json`'s address: that is a hand-typed display cache
 * (`accountBinding.ts`), and a login pre-filled from it is the confusion the account binding exists to prevent.
 */
export interface MintAddressUnboundError {
  readonly code: "MINT_ADDRESS_UNBOUND";
  readonly message: string;
  readonly alias: string;
  /** Whether the plan is enrolled at all — which of the two repairs the message names. */
  readonly enrolled: boolean;
}

/** Which check the captured authorize URL failed. */
export type MintUrlDefect = "unparseable" | "not-https" | "host" | "path" | "redirect-not-localhost" | "hint-present";

/**
 * The authorize URL the login handed its browser is not the shape the mint was built against. The `host` arm
 * is a POLICY refusal carrying the registered `claude-mint-authorize-host` hatch's text; every other arm is a
 * fact about the URL, with no way past it.
 */
export interface MintAuthorizeUrlUnexpectedError {
  readonly code: "MINT_AUTHORIZE_URL_UNEXPECTED";
  readonly message: string;
  readonly because: MintUrlDefect;
}

/** A mint stage ran past its deadline. */
export interface MintTimedOutError {
  readonly code: "MINT_TIMED_OUT";
  readonly message: string;
  /** Which wait expired: the authorize URL reaching the capture script, or the token reaching the screen. */
  readonly stage: "authorize-url" | "token";
}

/** The pseudo-terminal the mint ran under failed. Its detail is a process fact, never screen text. */
export interface MintPtyFailedError {
  readonly code: "MINT_PTY_FAILED";
  readonly message: string;
  readonly detail: string;
}

/** The mint finished and its screen held no setup token. */
export interface MintNoTokenError {
  readonly code: "MINT_NO_TOKEN";
  readonly message: string;
}

/**
 * The sentence for each authorize-URL defect. The `host` arm is the registered hatch's refusal, because an
 * unexpected host is a policy judgement a fresh capture can overturn; every other arm is a fact about the URL.
 *
 * @param because which check failed
 * @param host the host the URL named, as this invocation's detail on the `host` arm
 * @returns the error's message
 */
function mintUrlMessage({ because, host }: { because: MintUrlDefect; host?: string }): string {
  switch (because) {
    case "host":
      return hatchRefusal({
        ...(host === undefined ? {} : { detail: `it named ${host}` }),
        hatch: hatchFor({ id: "claude-mint-authorize-host" }),
      });
    case "unparseable":
      return "the URL the login handed its browser does not parse — nothing was pre-filled or written";
    case "not-https":
      return "the authorize URL the login handed its browser is not https — refusing to pre-fill an address onto it";
    case "path":
      return "the authorize URL is not on the /cai/oauth/authorize path the mint was built against — nothing was pre-filled";
    case "redirect-not-localhost":
      return (
        "the authorize URL does not redirect to the login's own localhost callback, so it is the MANUAL flow, " +
        "which needs a code pasted back — the mint drives only the automatic one"
      );
    case "hint-present":
      return "the authorize URL already carries a login_hint, so the mint will not add a second one";
    default: {
      const unreachable: never = because;
      return String(unreachable);
    }
  }
}

/** Construct a mint failure. `ClaudeRotationErrors` spreads these in; callers construct them there. */
export const MintErrors = {
  mintAddressUnbound: ({ alias, enrolled }: { alias: string; enrolled: boolean }): MintAddressUnboundError => ({
    alias,
    code: "MINT_ADDRESS_UNBOUND",
    enrolled,
    message: enrolled
      ? `\`${alias}\` is enrolled with no address bound, so nothing verified can be pre-filled — bind one with ` +
        `\`slopweaver claude signin --reenroll ${alias}\`; the mint never pre-fills the unverified accounts.json cache`
      : `\`${alias}\` is not enrolled, so no address is bound to pre-fill — sign it in and enrol it with ` +
        `\`slopweaver claude signin --plan ${alias}\`; the mint never pre-fills the unverified accounts.json cache`,
  }),
  mintArgsInvalid: ({ problems }: { problems: readonly string[] }): MintArgsInvalidError => ({
    code: "MINT_ARGS_INVALID",
    message: `claude mint takes --plan <alias>: ${problems.join("; ")}`,
    problems,
  }),
  mintAuthorizeUrlUnexpected: ({
    because,
    host,
  }: {
    because: MintUrlDefect;
    host?: string;
  }): MintAuthorizeUrlUnexpectedError => ({
    because,
    code: "MINT_AUTHORIZE_URL_UNEXPECTED",
    message: mintUrlMessage({ because, ...(host === undefined ? {} : { host }) }),
  }),
  mintNoToken: (): MintNoTokenError => ({
    code: "MINT_NO_TOKEN",
    message: "the mint finished and its screen held no setup token — nothing was written",
  }),
  mintPtyFailed: ({ detail }: { detail: string }): MintPtyFailedError => ({
    code: "MINT_PTY_FAILED",
    detail,
    message: `the terminal the mint ran in failed (${detail}) — nothing was written`,
  }),
  mintTimedOut: ({ stage }: { stage: "authorize-url" | "token" }): MintTimedOutError => ({
    code: "MINT_TIMED_OUT",
    message:
      stage === "authorize-url"
        ? "the setup-token login never handed its browser an authorize URL in time — nothing was minted or written"
        : "no setup token reached the mint's screen before its deadline — nothing was written",
    stage,
  }),
} as const;
