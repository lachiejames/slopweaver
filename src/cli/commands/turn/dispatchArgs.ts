/**
 * The argument and file layer of `slopweaver turn dispatch` — everything the verb decides BEFORE it acts.
 *
 * Depth 0 of the family: it imports nothing the verb owns, so a parse, a decision read or a whitelist check
 * cannot reach a mode that posts, records or launches anything.
 */
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { responderHatchOpenNow } from "../../../live/listen/responderHatch.js";
import { admitResponder } from "../../../live/listen/whitelist.js";
import { loadResponderWhitelist } from "../../../live/listen/whitelistStore.js";
import { parseRoutingDecision, type RoutingDecision } from "../../../live/turn/judgement.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { readOrReport, str, TURN_DISPATCH_FLAG_SPEC } from "./core.js";
import { type TurnCommandError, TurnCommandErrors } from "./errors.js";
import { TURN_DISPATCH_USAGE } from "./usage.js";

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn dispatch`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnDispatchArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_DISPATCH_FLAG_SPEC.boolean], string: [...TURN_DISPATCH_FLAG_SPEC.string] },
  });
}

/**
 * Read and parse a RoutingDecision file — either arm; the caller decides what each arm means here.
 *
 * @returns the parsed decision, or the rejections the read or the parse produced
 */
export function readDecisionFile({ path }: { path: string }): Result<RoutingDecision, TurnCommandError> {
  const text = readOrReport({ path, what: "decision" });
  if (text.isErr()) {
    return err(text.error);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.value);
  } catch (error) {
    return err(TurnCommandErrors.documentNotJson({ cause: error, what: "decision" }));
  }
  return parseRoutingDecision({ value: raw }).mapErr((reasons) => TurnCommandErrors.upstreamRefused({ reasons }));
}

/**
 * The required `--brief`/`--decision` pair, or the usage refusal naming whichever is missing.
 *
 * @returns both paths, or the exit code a refusal has already printed
 */
export function requiredBriefAndDecisionPaths({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): { readonly briefPath: string; readonly decisionPath: string } | { readonly errors: readonly string[] } {
  const briefPath = str({ key: "brief", values });
  const decisionPath = str({ key: "decision", values });
  if (briefPath === undefined || decisionPath === undefined) {
    return {
      errors: [
        ...(briefPath === undefined ? ["--brief is required"] : []),
        ...(decisionPath === undefined ? ["--decision is required"] : []),
        TURN_DISPATCH_USAGE,
      ],
    };
  }
  return { briefPath, decisionPath };
}

/**
 * Whether `userId` is refused by the responder whitelist, logging why when it is.
 *
 * @returns true when the whitelist refuses this user, so the caller must not act for them
 */
export function responderRefused({ home, userId }: { home: string; userId: string }): boolean {
  const responder = admitResponder({
    openOverride: responderHatchOpenNow({ home }),
    userId,
    whitelist: loadResponderWhitelist({ home }),
  });
  if (!responder.admitted) {
    logger.error({ msg: `turn dispatch: responder refused: ${responder.why}` });
  }
  return !responder.admitted;
}

/**
 * The state home this invocation reads and writes — `--home` when the caller named one, the ambient home
 * otherwise.
 *
 * Written as an `if` that returns rather than a coalesce, because the two arms are not the same kind of
 * answer: one is an operator's explicit choice and the other is whatever this machine happens to be
 * configured for, and a test pointing a verb at a sandbox depends on the difference.
 *
 * @returns the resolved state home directory
 */
export function resolvedHome({ values }: { values: Readonly<Record<string, string | boolean>> }): string {
  const named = str({ key: "home", values });
  if (named !== undefined) {
    return named;
  }
  return slopweaverHome();
}
