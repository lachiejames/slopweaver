/**
 * An OPT-IN smoke test against the REAL cmux app running on this machine — cmux Option C's second half.
 * `socketProtocol.test.ts` and
 * `eventStream.test.ts` prove the tricky network-level plumbing against a free fake every push; this proves
 * the whole path still actually talks to the real thing, today, on a machine that has cmux running.
 *
 * Costs NOTHING — cmux is a local app, not a paid API — but it needs cmux actually running on this machine,
 * so it never runs in CI (nothing to connect to there) and is skipped by default everywhere else too, so a
 * plain `yarn test:subprocess` never depends on cmux being up.
 *
 * Run it explicitly: `CMUX_REAL_SMOKE=1 yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/cmux/realCmuxSmoke.test.ts`
 *
 * READ-ONLY by design (`identify`, `listWorkspaces`) — this doc's own "Do not" is explicit that the smoke
 * must never depend on, or disturb, a live workspace the owner is using, so it never creates, closes, sends
 * into, or renames anything.
 */
import { describe, expect, it } from "vitest";

import { realCmuxClient } from "../../../cmux/client.js";
import { unwrap } from "../../../lib/result.js";

const RUN_REAL_CMUX_SMOKE = process.env["CMUX_REAL_SMOKE"] === "1";

describe.skipIf(!RUN_REAL_CMUX_SMOKE)("realCmuxClient — read-only smoke against the real, running cmux app", () => {
  it("identifies the caller's own focused surface without error", async () => {
    const client = realCmuxClient();
    try {
      const identified = unwrap(await client.identify());
      // Exact shape check rather than a type check: `identify()` always returns these four keys, each
      // possibly `undefined` — the real values are session-dependent, but the contract is not.
      expect(Object.keys(identified).toSorted()).toEqual(["surfaceId", "surfaceRef", "workspaceId", "workspaceRef"]);
    } finally {
      client.close();
    }
  });

  it("lists every workspace across every window without error", async () => {
    const client = realCmuxClient();
    try {
      const workspaces = unwrap(await client.listWorkspaces());
      expect(Array.isArray(workspaces)).toBe(true);
    } finally {
      client.close();
    }
  });
});
