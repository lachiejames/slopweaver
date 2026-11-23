import type { ElectronApplication } from "playwright-core";
import { describe, expect, it } from "vitest";

import { chooseE2eContext } from "../../../../../cli/commands/desktop/e2eContext.js";
import { unwrap } from "../../../../../lib/result.js";

describe("chooseE2eContext", () => {
  it("leaves an instance with no --context as it opened, never touching its windows", async () => {
    // An app with no methods: any read of a window would throw rather than pass.
    const untouched = {} as unknown as ElectronApplication;
    const chosen = await chooseE2eContext({ app: untouched, context: undefined });
    expect([chosen.isOk(), unwrap(chosen)]).toEqual([true, undefined]);
  });
});
