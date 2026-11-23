/**
 * The override that makes an Electron a Codex shell starts run as Node (`codex/electronSurface.ts`). The spelling is
 * the finding: a TOML string under `shell_environment_policy.set`, which `codex app-server --strict-config` accepts.
 */
import { describe, expect, it } from "vitest";

import { codexElectronRunAsNodeOverrides } from "../../../codex/electronSurface.js";

describe("codexElectronRunAsNodeOverrides", () => {
  it("sets ELECTRON_RUN_AS_NODE to the string 1 in Codex's child-shell policy, and nothing else", () => {
    expect(codexElectronRunAsNodeOverrides()).toEqual(['shell_environment_policy.set.ELECTRON_RUN_AS_NODE="1"']);
  });
});
