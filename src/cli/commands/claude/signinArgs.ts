/**
 * `claude signin`'s argument tail: the flags it accepts, the combinations it refuses, and which path one
 * invocation takes.
 *
 * Split out of `signinRun.ts` along the seam between READING what was asked and DOING it, the same split
 * `watchArgs.ts` makes for `claude watch`. Everything here is pure, so the one place a read can be told apart
 * from a sign-in is testable without a store, a terminal or a browser.
 */
import { err, ok } from "../../../lib/result.js";
import { parseFlags } from "../../parseFlags.js";
import { type ClaudeCommandError, ClaudeCommandErrors, type ClaudeCommandResult } from "./errors.js";

/** The flags this verb accepts. */
const SIGNIN_FLAG_SPEC = {
  boolean: ["status", "json", "page"],
  string: ["plan", "enroll", "reenroll", "out"],
} as const;

/**
 * Every flag this verb advertises, derived from the spec it parses with so the two cannot drift.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const CLAUDE_SIGNIN_FLAG_NAMES: readonly string[] = [
  ...SIGNIN_FLAG_SPEC.string.map((name) => `--${name}`),
  ...SIGNIN_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** What one invocation was asked to do. */
export interface ClaudeSigninArgs {
  readonly wantsStatus: boolean;
  readonly wantsJson: boolean;
  readonly wantsPage: boolean;
  /** Sign in exactly this store, without an interactive loop. */
  readonly only?: string;
  /** Enroll this store's current account as its expected identity, signing nothing in. */
  readonly enroll?: string;
  /** Replace these stores' standing enrollments with the accounts they hold now — the deliberate re-enroll. */
  readonly reenroll?: readonly string[];
  /** Where to write the page. */
  readonly out?: string;
}

/**
 * The refusal one combination of flags earns, or undefined when they may run together.
 *
 * A read flag beside a store act used to be routed to the ACT: `--status --plan plan-five` launched
 * `claude auth login` and opened a browser sign-in tab for a session that asked only to
 * read. Refused at parse time so no routing order can turn a read into a sign-in again. `--out` alone is not a
 * read the router recognises either, so it used to fall through to the walk, which signs stores in.
 *
 * @param enroll the store `--enroll` named
 * @param only the store `--plan` named
 * @param page whether `--page` was asked for, the one flag `--out` belongs to
 * @param reads whether any read flag was asked for: `--status`, `--page`, `--json` or `--out`
 * @param reenroll the raw `--reenroll` list
 * @param target the path `--out` named
 * @returns the refusal, or undefined
 */
function combinationRefusal({
  enroll,
  only,
  page,
  reads,
  reenroll,
  target,
}: {
  enroll?: string;
  only?: string;
  page: boolean;
  reads: boolean;
  reenroll?: string;
  target?: string;
}): ClaudeCommandError | undefined {
  if (only !== undefined && enroll !== undefined) {
    return ClaudeCommandErrors.planAndEnrollTogether();
  }
  if (reads && only !== undefined) {
    return ClaudeCommandErrors.readBesideStoreAct({ flag: "--plan" });
  }
  if (reads && enroll !== undefined) {
    return ClaudeCommandErrors.readBesideStoreAct({ flag: "--enroll" });
  }
  const storeAct = only !== undefined || enroll !== undefined;
  if (reenroll !== undefined && (reads || storeAct)) {
    return ClaudeCommandErrors.reenrollNotAlone();
  }
  if (target !== undefined && !page) {
    return ClaudeCommandErrors.outWithoutPage();
  }
  return undefined;
}

/**
 * A string flag's value, or undefined when it was not given.
 *
 * @param value what the shared parser read for one flag
 * @returns the value when it is a string
 */
function stringValue({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse this verb's own argument tail.
 *
 * Exported so the help ratchet probes the REAL parser rather than a restatement of it.
 *
 * @param rest the argv tail, after `claude signin`
 * @returns what was asked for, or every rejection at once
 */
export function parseClaudeSigninArgs({ rest }: { rest: readonly string[] }): ClaudeCommandResult<ClaudeSigninArgs> {
  // Ahead of the shared parser, which refuses any repeated value flag too, because this refusal names the
  // comma-separated list `--reenroll plan-two --reenroll plan-three` was reaching for.
  if (rest.filter((arg) => arg === "--reenroll" || arg.startsWith("--reenroll=")).length > 1) {
    return err(ClaudeCommandErrors.reenrollRepeated());
  }
  const parsed = parseFlags({ args: rest, spec: SIGNIN_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(ClaudeCommandErrors.flagsRefused({ reasons: parsed.error }));
  }
  const values = parsed.value.values;
  const only = stringValue({ value: values["plan"] });
  const enroll = stringValue({ value: values["enroll"] });
  const reenroll = stringValue({ value: values["reenroll"] });
  const target = stringValue({ value: values["out"] });
  const wantsStatus = values["status"] === true;
  const wantsPage = values["page"] === true;
  const wantsJson = values["json"] === true;
  const reads = wantsStatus || wantsPage || wantsJson || target !== undefined;
  const refusal = combinationRefusal({
    page: wantsPage,
    reads,
    ...(only === undefined ? {} : { only }),
    ...(enroll === undefined ? {} : { enroll }),
    ...(reenroll === undefined ? {} : { reenroll }),
    ...(target === undefined ? {} : { target }),
  });
  if (refusal !== undefined) {
    return err(refusal);
  }
  const reenrolled = reenroll?.split(",").map((alias) => alias.trim());
  if (reenrolled?.includes("") === true) {
    return err(ClaudeCommandErrors.reenrollEmptyEntry({ got: String(reenroll) }));
  }
  return ok({
    wantsJson,
    wantsPage,
    wantsStatus,
    ...(only === undefined ? {} : { only }),
    ...(enroll === undefined ? {} : { enroll }),
    ...(reenrolled === undefined ? {} : { reenroll: reenrolled }),
    ...(target === undefined ? {} : { out: target }),
  });
}

/** Which of the verb's paths one invocation takes, with the store it names. Only `reenroll` replaces. */
export type SigninRoute =
  | { readonly kind: "reenroll"; readonly aliases: readonly string[] }
  | { readonly kind: "enroll"; readonly alias: string }
  | { readonly kind: "plan"; readonly alias: string }
  | { readonly kind: "report" }
  | { readonly kind: "walk" };

/**
 * Decide which path an invocation takes — the one place the replace/establish split lives.
 *
 * @param args what was asked for
 * @returns the path to run, carrying the store it names when it names one
 */
export function signinRoute({ args }: { args: ClaudeSigninArgs }): SigninRoute {
  if (args.reenroll !== undefined) {
    return { aliases: args.reenroll, kind: "reenroll" };
  }
  if (args.enroll !== undefined) {
    return { alias: args.enroll, kind: "enroll" };
  }
  if (args.only !== undefined) {
    return { alias: args.only, kind: "plan" };
  }
  if (args.wantsStatus || args.wantsPage || args.wantsJson) {
    return { kind: "report" };
  }
  return { kind: "walk" };
}
