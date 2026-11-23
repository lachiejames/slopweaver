/**
 * `slopweaver checkout status` — is each declared main checkout current, and does its `node_modules`
 * actually reflect its lockfile?
 *
 * Exits non-zero when any checkout needs attention. That is a FINDING, not a broken tool — the same
 * `diagnostic` channel `doctor` uses — so a supervisor sweep can gate on the exit code and a human reading
 * the output gets the fix command named on the line that found the problem.
 */
import {
  type CheckoutFreshness,
  checkoutNeedsAttention,
  renderCheckoutFreshness,
} from "../../../checkouts/freshness.js";
import { inspectCheckout, type MainCheckoutConfig, productionInspectDeps } from "../../../checkouts/inspect.js";
import { logger } from "../../../lib/logger.js";
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { checkoutUsage, parseCheckoutArgs, selectCheckouts, stringFlag, VERB_ARG_OFFSET } from "./core.js";

/** The line printed when nothing is declared — never a clean bill, because nothing was checked. */
export const NOTHING_DECLARED =
  "checkout status: no main checkouts declared — add a `mainCheckouts` array to $SLOPWEAVER_HOME/profile.json " +
  "(each entry: { path, upstream?, rebaseOnto? }); see docs/main-checkouts.md";

/**
 * Read the declared main checkouts for a state home.
 *
 * @param home the state home holding `profile.json`, or undefined to resolve the default
 * @returns the declared checkouts
 */
export function declaredCheckouts({ home }: { home: string | undefined }): readonly MainCheckoutConfig[] {
  return mainCheckoutsFromProfile({ home: resolveHome({ named: home }) });
}

/** Commits behind the upstream, or `null` when the drift could not be measured — never a `0` that reads current. */
function behindUpstream({ freshness }: { freshness: CheckoutFreshness }): number | null {
  const { drift } = freshness;
  if (drift === undefined) {
    return null;
  }
  return drift.behind;
}

/** The checked-out branch, or `null` on a detached HEAD. */
function checkedOutBranch({ freshness }: { freshness: CheckoutFreshness }): string | null {
  const { branch } = freshness;
  if (branch === undefined) {
    return null;
  }
  return branch;
}

/** The upstream compared against, or `null` when the checkout has none. */
function comparedUpstream({ freshness }: { freshness: CheckoutFreshness }): string | null {
  const { upstream } = freshness;
  if (upstream === undefined) {
    return null;
  }
  return upstream;
}

/** Commits behind the declared rebase target, or `null` when the checkout declared none. */
function behindRebaseTarget({ freshness }: { freshness: CheckoutFreshness }): number | null {
  const { rebaseOnto } = freshness;
  if (rebaseOnto === undefined) {
    return null;
  }
  return rebaseOnto.behind;
}

/** The paths the rebase target stranded, or none when the checkout declared no rebase target. */
function strandedPaths({ freshness }: { freshness: CheckoutFreshness }): readonly string[] {
  const { rebaseOnto } = freshness;
  if (rebaseOnto === undefined) {
    return [];
  }
  return rebaseOnto.stranded.map((entry) => entry.path);
}

/** The machine-readable shape `--json` prints: the same verdicts, minus the rendering. */
function jsonReport({ measured }: { measured: readonly CheckoutFreshness[] }): string {
  return JSON.stringify(
    {
      checkouts: measured.map((freshness) => ({
        behind: behindUpstream({ freshness }),
        branch: checkedOutBranch({ freshness }),
        install: freshness.install,
        needsAttention: checkoutNeedsAttention({ freshness }),
        path: freshness.path,
        problems: freshness.problems,
        rebaseOntoBehind: behindRebaseTarget({ freshness }),
        strandedPaths: strandedPaths({ freshness }),
        upstream: comparedUpstream({ freshness }),
      })),
      needsAttention: measured.some((freshness) => checkoutNeedsAttention({ freshness })),
    },
    null,
    2,
  );
}

/** Parse `status`'s flags, printing help/errors as it goes. Returns the exit code to stop on, or the flags. */
function parseStatusVerb({ argv }: { argv: readonly string[] }): ParsedFlags | number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: checkoutUsage({ verb: "status" }) });
    return EXIT_OK;
  }
  const parsed = parseCheckoutArgs({ rest, verb: "status" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: checkoutUsage({ verb: "status" }) });
    return EXIT_USAGE;
  }
  return parsed.value;
}

/** Print the measured checkouts, as rendered text or as the machine-readable report. */
function printMeasured({ measured, json }: { measured: readonly CheckoutFreshness[]; json: boolean }): void {
  if (json) {
    logger.out({ line: jsonReport({ measured }) });
    return;
  }
  const nowMs = Date.now();
  for (const line of measured.flatMap((freshness) => renderCheckoutFreshness({ freshness, nowMs }))) {
    logger.out({ line });
  }
}

/**
 * `checkout status` — report each declared main checkout's drift and install state.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero when any checkout needs attention
 */
export function runCheckoutStatus(argv: readonly string[]): number {
  const parsed = parseStatusVerb({ argv });
  if (typeof parsed === "number") {
    return parsed;
  }
  const home = stringFlag({ name: "home", parsed });
  const path = stringFlag({ name: "path", parsed });
  const configs = selectCheckouts({ configs: declaredCheckouts({ home }), path });
  if (configs.length === 0) {
    logger.error({
      msg: path === undefined ? NOTHING_DECLARED : `checkout status: no declared main checkout at ${path}`,
    });
    return path === undefined ? EXIT_OK : EXIT_USAGE;
  }
  const deps = productionInspectDeps();
  // `--fetch` selects the THOROUGH rung: refresh the refs, read the working tree, and scan a rebase
  // target's removed paths for local references. One flag because it is one intent — "spend the time and
  // tell me everything" — and the default is the cheap rung, the same one `doctor` takes.
  const depth = parsed.values["fetch"] === true ? "thorough" : "cheap";
  const measured = configs.map((config) => inspectCheckout({ config, deps, depth }));
  printMeasured({ json: parsed.values["json"] === true, measured });
  return measured.some((freshness) => checkoutNeedsAttention({ freshness })) ? EXIT_ERROR : EXIT_OK;
}

export const checkoutStatusCommand = defineCommand({ run: runCheckoutStatus });
