import { describe, expect, it } from "vitest";

import { codexPluginHomes } from "../../../codexPlugin/homes.js";

describe("codexPluginHomes", () => {
  it("keeps every registered home in register order, then the ambient one", () => {
    const homes = codexPluginHomes({
      ambientCodexHome: "/u/.codex",
      destinations: [
        { alias: "codex-2", codexHome: "/s/two" },
        { alias: "codex-1", codexHome: "/s/one" },
      ],
    });
    expect(homes).toEqual([
      { codexHome: "/s/two", registered: true },
      { codexHome: "/s/one", registered: true },
      { codexHome: "/u/.codex", registered: false },
    ]);
  });

  it("keeps a home named twice once, by its first spelling, and an ambient home the register names as registered", () => {
    const homes = codexPluginHomes({
      ambientCodexHome: "/s/one/",
      destinations: [
        { alias: "codex-1", codexHome: "/s/one" },
        { alias: "codex-2", codexHome: "/s/x/../one" },
      ],
    });
    expect(homes).toEqual([{ codexHome: "/s/one", registered: true }]);
  });

  it("is the ambient home alone for an empty register", () => {
    expect(codexPluginHomes({ ambientCodexHome: "/u/.codex", destinations: [] })).toEqual([
      { codexHome: "/u/.codex", registered: false },
    ]);
  });
});
