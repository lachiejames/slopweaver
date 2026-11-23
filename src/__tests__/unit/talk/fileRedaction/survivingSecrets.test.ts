/*
 * `survivingSecrets`: what the hygiene gate still finds in a window, and nothing once `redactCredentials` masked
 * it.
 */
import { describe, expect, it } from "vitest";

import { redactCredentials, survivingSecrets } from "../../../../talk/fileRedaction.js";
import { SLACK } from "./harness.js";

describe("survivingSecrets", () => {
  it("names what the hygiene gate still finds, and nothing once masked", () => {
    expect(survivingSecrets({ denylist: [], text: `token ${SLACK}` }).length).toBeGreaterThan(0);
    const masked = redactCredentials({ denylist: [], source: false, text: `token ${SLACK}` }).text;
    expect(survivingSecrets({ denylist: [], text: masked })).toEqual([]);
  });
});
