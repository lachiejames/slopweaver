/**
 * The site's Next config. `next build` must typecheck through the project's own `tsc` CLI, never TypeScript's JS
 * API loaded in process: the site is on TypeScript 7.1, whose JS API is not the one Next's in-process checker was
 * written against. The setting is read from its own module because `next.config.mjs` loads `nextra`, which the
 * root unit lane does not install.
 */
import { describe, expect, it } from "vitest";

import { experimental } from "../../nextExperimental.mjs";

describe("nextExperimental.mjs", () => {
  it("typechecks through the tsc CLI rather than the in-process JS API", () => {
    expect(experimental.useTypeScriptCli).toBe(true);
  });
});
