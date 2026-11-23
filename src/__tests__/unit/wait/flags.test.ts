/**
 * The shared `--wait`/`--timeout-seconds` parse every waiting verb goes through.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseWaitOptions } from "../../../wait/flags.js";
import { DEFAULT_WAIT_TIMEOUT_SECONDS } from "../../../wait/loop.js";

describe("parseWaitOptions", () => {
  it("defaults to no wait and the default timeout when neither flag is given", () => {
    expect(unwrap(parseWaitOptions({ values: {} }))).toEqual({
      timeoutSeconds: DEFAULT_WAIT_TIMEOUT_SECONDS,
      wait: false,
    });
  });

  it("takes an explicit timeout alongside --wait", () => {
    expect(unwrap(parseWaitOptions({ values: { "timeout-seconds": "120", wait: true } }))).toEqual({
      timeoutSeconds: 120,
      wait: true,
    });
  });

  it("refuses a timeout with no --wait to bound", () => {
    expect(unwrapErr(parseWaitOptions({ values: { "timeout-seconds": "120" } }))).toEqual([
      "--timeout-seconds only means something with --wait",
    ]);
  });

  it("refuses a timeout that is not a positive whole number", () => {
    expect(unwrapErr(parseWaitOptions({ values: { "timeout-seconds": "0", wait: true } }))).toEqual([
      "--timeout-seconds must be a positive whole number",
    ]);
  });
});
