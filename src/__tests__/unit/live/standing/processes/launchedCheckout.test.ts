/*
 * `launchedCheckout` — the checkout a watch record names is the tree the gauge will read back off the process
 * table, spelled exactly as `decodeClaudeWatch` spells it, never the directory the caller stood in. It was split
 * out when the process-snapshot suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { decodeClaudeWatch, launchedCheckout, type ProcessRow } from "../../../../../live/standing/processes.js";

describe("launchedCheckout — the record names the tree the gauge will read back, not where the caller stood", () => {
  // `cd /tmp && /repo/slopweaver/bin/slopweaver claude watch --wait` stamped `/tmp`
  // while `ps` showed `/repo/slopweaver`, so the released owner read NOT running.
  it("reads the checkout out of the entrypoint, whatever the caller's working directory", () => {
    const argv = ["/node", "/repo/slopweaver/bin/../src/cli/index.ts", "claude", "watch", "--wait"];
    expect(launchedCheckout({ argv, fallback: "/tmp" })).toBe("/repo/slopweaver");
  });

  it("spells it exactly as the process-table decoder will", () => {
    const argv = ["/node", "/repo/slopweaver/bin/../src/cli/index.ts", "claude", "watch", "--wait"];
    const row: ProcessRow = { argv: `node --require x/preflight.cjs ${argv.slice(1).join(" ")}`, pid: 1, ppid: 0 };
    expect(launchedCheckout({ argv, fallback: "/tmp" })).toBe(decodeClaudeWatch({ row })?.cwd);
  });

  // node normalises its own argv[1], so the built CLI's record spells `/repo/slopweaver/dist-cli/…` while `ps`
  // prints the `bin/..` spelling it was exec'd with. Both must read back as the one checkout.
  it("spells the BUILT entrypoint exactly as the process-table decoder will", () => {
    const argv = ["/node", "/repo/slopweaver/dist-cli/cli/index.js", "claude", "watch", "--wait"];
    const row: ProcessRow = {
      argv: "/node /repo/slopweaver/bin/../dist-cli/cli/index.js claude watch --wait",
      pid: 1,
      ppid: 0,
    };
    expect(launchedCheckout({ argv, fallback: "/tmp" })).toBe("/repo/slopweaver");
    expect(decodeClaudeWatch({ row })?.cwd).toBe("/repo/slopweaver");
  });

  it("falls back when the argv names no entrypoint", () => {
    expect(launchedCheckout({ argv: ["/node", "/x/y.js"], fallback: "/tmp" })).toBe("/tmp");
  });
});
