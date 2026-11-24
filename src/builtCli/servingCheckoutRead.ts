/**
 * The effectful half of `./servingCheckout.ts`: read a checkout's built CLI once and judge whether its console may be
 * served or walked. One manifest read and, over a valid manifest, one source scan — the guard's own.
 */
import { join } from "node:path";

import type { Result } from "#lib/result.js";

import { readBuiltState } from "./builtStateRead.js";
import { DEFAULT_OUT } from "./layout.js";
import { judgeServingCheckoutBuild, type ServingCheckoutError } from "./servingCheckout.js";

/**
 * Check a checkout's built CLI before its console is served or walked.
 *
 * @param checkout the checkout root, absolute; its built CLI is the `dist-cli` beside its `bin/slopweaver`
 * @returns ok when the console may be served, or the stale-build refusal naming `slopweaver dev build`
 */
export function checkServingCheckoutBuild({ checkout }: { checkout: string }): Result<void, ServingCheckoutError> {
  return judgeServingCheckoutBuild({ checkout, state: readBuiltState({ builtRoot: join(checkout, DEFAULT_OUT) }) });
}
