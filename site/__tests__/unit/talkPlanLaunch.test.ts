/*
 * The plan call's child inherits this server's environment LESS every credential the verb names, so an exported
 * API key can never outrank the owner's ChatGPT login — and with `CODEX_HOME` set to the register row the call routed to,
 * so that row's plan pays whatever the server's own environment says.
 */
import { describe, expect, it } from "vitest";

import { planChildEnvironment } from "../../lib/talkPlanLaunch";

const ROUTED = "/stores/codex-one";

describe("planChildEnvironment", () => {
  it("drops every named credential, keeps the rest, and sets the routed home", () => {
    const env = { CODEX_API_KEY: "k2", HOME: "/h", NODE_ENV: "test" as const, OPENAI_API_KEY: "k1", PATH: "/bin" };
    expect(planChildEnvironment({ codexHome: ROUTED, env, unsetEnv: ["OPENAI_API_KEY", "CODEX_API_KEY"] })).toEqual({
      CODEX_HOME: ROUTED,
      HOME: "/h",
      NODE_ENV: "test",
      PATH: "/bin",
    });
  });

  it("overrides an ambient CODEX_HOME in the server's environment with the routed one", () => {
    const env = { CODEX_HOME: "/ambient/codex", NODE_ENV: "test" as const };
    expect(planChildEnvironment({ codexHome: ROUTED, env, unsetEnv: [] })["CODEX_HOME"]).toBe(ROUTED);
  });

  it("leaves the server's own environment untouched", () => {
    const env = { CODEX_HOME: "/ambient/codex", NODE_ENV: "test" as const, OPENAI_API_KEY: "k1" };
    planChildEnvironment({ codexHome: ROUTED, env, unsetEnv: ["OPENAI_API_KEY"] });
    expect(env).toEqual({ CODEX_HOME: "/ambient/codex", NODE_ENV: "test", OPENAI_API_KEY: "k1" });
  });
});
