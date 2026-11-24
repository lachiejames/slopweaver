/**
 * `scripts/docs-site.sh`'s check before it serves a dev console — nothing but the top-level invocation, the shape
 * `src/checkouts/refMoveBuildCli.ts` uses and for the same reasons: run from SOURCE by `node_modules/.bin/tsx`, never
 * through `bin/slopweaver`, whose own staleness guard refuses before any verb could judge the build it guards; and
 * TOTAL, so a throw becomes one line rather than a tsx stack trace.
 *
 * Only a STALE build is refused (`./servingCheckout.ts`): one `docs-site:` line on stderr, {@link STALE_TOKEN} alone on
 * stdout, and exit {@link EXIT_STALE}. The script refuses only on BOTH the token and the exit, so a `tsx` that cannot
 * run at all — whatever code it happens to exit — never refuses a start. A check that could not judge the build says
 * so and exits 0, so the console is served exactly as it was before the check existed.
 */
import { checkServingCheckoutBuild } from "./servingCheckoutRead.js";

/** The exit the script reads, with {@link STALE_TOKEN}, as "do not serve": the build is stale. */
const EXIT_STALE = 3;

/** What stdout carries on a stale refusal and nothing else: a crash cannot print it by accident. */
const STALE_TOKEN = "stale";

/** A call without the checkout root: a defect in the script, never a judgement of the build. */
const EXIT_USAGE = 2;

const checkout = process.argv[2];
if (checkout === undefined || checkout === "") {
  process.stderr.write("docs-site: docsSiteStart.entry.ts takes the checkout root as its one argument\n");
  process.exit(EXIT_USAGE);
} else {
  try {
    const checked = checkServingCheckoutBuild({ checkout });
    if (checked.isErr()) {
      process.stderr.write(`docs-site: ${checked.error.message}\n`);
      process.stdout.write(`${STALE_TOKEN}\n`);
      process.exit(EXIT_STALE);
    }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`docs-site: could not check ${checkout}'s built CLI, so it was served unchecked: ${detail}\n`);
  }
}
