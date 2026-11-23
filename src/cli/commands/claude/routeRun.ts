/**
 * `slopweaver claude route --model <model>` — ask, without spawning anything, which plan a spawn of that
 * model would land on and why.
 *
 * It is the SAME call EVERY spawn makes ({@link routeSpawnStore}, through the pre-spawn gate in
 * `claude/spawnStore.ts`), not a restatement of it, which is the whole reason the verb exists: a routing
 * decision that can only be seen by opening a workspace cannot be checked before opening one, and this
 * workstream's recurring defect was a piece correct in isolation and wrong where it met the next one.
 *
 * ## It opens no session, and it CAN refresh a credential
 *
 * This file used to promise that no code path it reaches writes a credential. That is no longer true and the
 * change is deliberate rather than a leak: the gate it calls repairs a store the provider refused whose access
 * token has merely expired, by running the CLI's own OAuth refresh under that store
 * (`claude/probeRepair.ts`). Being the same call as a spawn's is the property this verb exists for, so it gets
 * the repair too — and a reader who wants the gauges without any chance of a write has `claude gauge`, which
 * shares the probe and not the wrapper.
 *
 * So the accurate promise is narrower and still worth making: it opens no session, starts no model, and
 * performs exactly the credential repair a spawn of the same model would have performed a moment later.
 */
import { resolveAmbientCredential } from "../../../claude/ambientCredentialRead.js";
import { claudePlanProbesPort } from "../../../claude/planProbes.js";
import { routeSpawnStore, unreadablePlanHatchOpen } from "../../../claude/spawnStore.js";
import { ALLOW_UNREADABLE_PLAN_ENV } from "../../../claude/spawnStoreRefusals.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { planRegisterPort } from "../../../plans/port.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";

/** The flags this verb accepts, and the ONLY place they are named — its usage is held to this by `helpTruth`. */
const ROUTE_FLAG_SPEC = { string: ["model"] } as const;

/** Where this verb's own arguments start in `process.argv`: `[node, cli, claude, route, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Every flag this verb advertises, derived from the spec it actually parses with so the two cannot drift.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const CLAUDE_ROUTE_FLAG_NAMES: readonly string[] = ROUTE_FLAG_SPEC.string.map((name) => `--${name}`);

/**
 * Parse this verb's own argument tail, strictly — an unknown flag is refused rather than ignored.
 *
 * @param rest the argv tail, after `claude route`
 * @returns the model to route, when one was named, or every rejection at once
 */
export function parseClaudeRouteArgs({ rest }: { readonly rest: readonly string[] }): Result<{ model?: string }> {
  const parsed = parseFlags({ args: rest, spec: ROUTE_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const model = parsed.value.values["model"];
  return ok(typeof model === "string" ? { model } : {});
}

/**
 * Print where a spawn of the given model would go.
 *
 * @param argv the FULL process argv — the router passes it whole
 * @returns the process exit code
 */
async function runClaudeRoute(argv: readonly string[]): Promise<number> {
  const parsed = parseClaudeRouteArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    logger.error({ msg: `claude route: ${parsed.error.join("; ")}` });
    return EXIT_USAGE;
  }
  const routing = await routeSpawnStore({
    context: {
      ambient: resolveAmbientCredential(),
      port: planRegisterPort(),
      probesPort: claudePlanProbesPort(),
      unreadableHatchOpen: unreadablePlanHatchOpen({ env: process.env[ALLOW_UNREADABLE_PLAN_ENV] }),
    },
    model: parsed.value.model,
  });
  // The REFUSAL first, and that order is the fix rather than a tidy-up: this used to test `route === undefined`
  // before looking at the refusal, so a gate that had refused for a named reason — a configuration it could not
  // read, no gauge readable at all — printed "configure accounts.json, or sign a store in" instead of the
  // reason it actually had. The refusal is the gate's own four-line block and says what to do.
  if (routing.refusal !== undefined) {
    logger.error({ msg: routing.refusal });
    return EXIT_ERROR;
  }
  if (routing.basis === "unconfigured") {
    logger.error({
      msg:
        "claude route: this install registers no Claude destination, so nothing is routed and a session boots " +
        "on the ambient credential — `slopweaver plans add --provider claude` registers one",
    });
    return EXIT_OK;
  }
  if (routing.route === undefined) {
    // An allowed outcome with no gauge-based choice behind it: the unreadable-plan hatch is open and the gate
    // named a store in configured order. It printed its own warning; this is a success, not a failure.
    return EXIT_OK;
  }
  // The route line itself was already printed by `routeSpawnStore`, so that a reader sees byte-identically
  // what a spawn would print rather than a second rendering of the same decision.
  return EXIT_OK;
}

export const claudeRouteCommand = defineCommand({ run: runClaudeRoute });
