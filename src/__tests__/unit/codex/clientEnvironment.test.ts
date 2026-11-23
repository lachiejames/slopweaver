/**
 * The environment a routed Codex pass hands the bundled CLI — `codex/client.ts`'s `codexClientEnvironment`.
 *
 * This is the half of pass routing that a comparison of aliases cannot reach. The SDK's `env` option
 * REPLACES `process.env` rather than extending it (`dist/index.js` assigns `envOverride` wholesale), so a
 * mapping that merely set `CODEX_HOME` would hand the CLI a process with no `PATH` and no `HOME` — and the
 * symptom would be a pass that fails to start, on the account it was correctly routed to.
 *
 * The environment is INJECTED rather than read, so nothing here touches the operator's own.
 */
import { describe, expect, it } from "vitest";

import { codexClientEnvironment } from "../../../codex/client.js";

const ROUTED = "/state/plan-seven/.codex";

describe("the environment a routed Codex pass hands the bundled CLI", () => {
  it("carries the caller's whole environment through, since the SDK's `env` replaces it rather than extending", () => {
    const resolved = codexClientEnvironment({
      codexHome: ROUTED,
      env: { HOME: "/Users/someone", PATH: "/usr/bin:/bin" },
    });

    expect(resolved["PATH"]).toBe("/usr/bin:/bin");
    expect(resolved["HOME"]).toBe("/Users/someone");
  });

  it("puts the ROUTED home in, beating an ambient one the caller already exported", () => {
    const resolved = codexClientEnvironment({
      codexHome: ROUTED,
      env: { CODEX_HOME: "/state/ambient/.codex", PATH: "/usr/bin" },
    });

    expect(resolved["CODEX_HOME"]).toBe(ROUTED);
  });

  // The falsifiable partner to the case above: the ambient value is really present in the input, so a
  // mapping that dropped the override would be caught rather than passing over an environment that had none.
  it("leaves the ambient value visible in its own input, so the override above is a real substitution", () => {
    const ambient = { CODEX_HOME: "/state/ambient/.codex", PATH: "/usr/bin" };

    expect(ambient.CODEX_HOME).toBe("/state/ambient/.codex");
    expect(codexClientEnvironment({ codexHome: ROUTED, env: ambient })["CODEX_HOME"]).not.toBe(ambient.CODEX_HOME);
  });

  it("drops an UNSET variable rather than passing `undefined` where the SDK expects a string map", () => {
    const resolved = codexClientEnvironment({ codexHome: ROUTED, env: { PATH: "/usr/bin", UNSET_ONE: undefined } });

    expect(Object.keys(resolved).toSorted()).toEqual(["CODEX_HOME", "PATH"]);
  });

  // A Codex review of this change reported the earlier version of this case as unfalsifiable, and
  // it was right: it fed an environment with no credential in it and asserted none came out, which is true
  // of a mapping that carries every credential straight through. The input now CARRIES all three, because
  // the failure being held down is an operator's own exported key silently outranking the routed home's
  // `auth.json` — a pass spent on an API-key account while every ledger row named the registered one.
  it("DROPS every credential the CLI would read instead of the routed home's own login", () => {
    const resolved = codexClientEnvironment({
      codexHome: ROUTED,
      env: {
        CODEX_ACCESS_TOKEN: "synthetic-access-token",
        CODEX_API_KEY: "synthetic-codex-key",
        OPENAI_API_KEY: "synthetic-openai-key",
        PATH: "/usr/bin",
      },
    });

    expect(Object.keys(resolved).toSorted()).toEqual(["CODEX_HOME", "PATH"]);
  });

  // The UNROUTED arm — the `eval/` lane's client — takes the same mapping, which is the second half of the
  // same review finding: choosing the ambient home is a choice about which home, never a licence to let an
  // exported key outrank that home's own login.
  it("leaves an ambient CODEX_HOME alone when no destination is routed, while still dropping the credential", () => {
    const resolved = codexClientEnvironment({
      codexHome: undefined,
      env: { CODEX_HOME: "/state/ambient/.codex", OPENAI_API_KEY: "synthetic-openai-key", PATH: "/usr/bin" },
    });

    expect(resolved["CODEX_HOME"]).toBe("/state/ambient/.codex");
    expect(Object.keys(resolved).toSorted()).toEqual(["CODEX_HOME", "PATH"]);
  });

  // The falsifiable partner to the drop above: a name that merely LOOKS credential-shaped is carried, so the
  // filter is the named set rather than a pattern that would quietly strip a pass's own tooling.
  it("carries a non-credential variable whose name is credential-SHAPED, rather than matching a pattern", () => {
    const resolved = codexClientEnvironment({
      codexHome: ROUTED,
      env: { CODEX_API_KEY: "synthetic-codex-key", GITHUB_TOKEN: "synthetic-github-token", PATH: "/usr/bin" },
    });

    expect(resolved["GITHUB_TOKEN"]).toBe("synthetic-github-token");
    expect(resolved["CODEX_API_KEY"]).toBeUndefined();
  });
});
