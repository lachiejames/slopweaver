/**
 * Fails a run in which any test was skipped. The lane's green is a claim that every spec ran: a `test.skip`,
 * `test.fixme` or a conditional skip left in a spec would otherwise drop it from the run and still exit 0.
 * `forbidOnly` in the config closes the same hole for a focused `test.only`.
 */
import type { FullResult, Reporter, Suite } from "@playwright/test/reporter";

/** The reporter Playwright loads by path from `config/playwright/console.ts`. */
export default class NoSkipReporter implements Reporter {
  private root: Suite | undefined;

  /**
   * Keep the run's root suite, which holds every test the run collected.
   *
   * @param _config the run's config, not read
   * @param suite the root suite
   */
  // named-object-params-exempt: Playwright invokes Reporter.onBegin(config, suite) positionally
  onBegin(_config: unknown, suite: Suite): void {
    this.root = suite;
  }

  /**
   * Turn a passed run with any skipped test into a failed one, naming each skipped test.
   *
   * @param result the run's own verdict
   * @returns a failed status when a test was skipped, else nothing, leaving Playwright's verdict as it is
   */
  // Async because `Reporter.onEnd` types a returned status only inside a promise.
  // named-object-params-exempt: Playwright invokes Reporter.onEnd(result) positionally and reads its returned status
  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] } | undefined> {
    if (this.root === undefined) {
      return undefined;
    }
    const skipped = this.root.allTests().filter((test) => test.outcome() === "skipped");
    if (skipped.length === 0) {
      return undefined;
    }
    for (const test of skipped) {
      process.stderr.write(`desktop-e2e: skipped, so the lane cannot pass: ${test.titlePath().join(" › ")}\n`);
    }
    return { status: result.status === "passed" ? "failed" : result.status };
  }
}
