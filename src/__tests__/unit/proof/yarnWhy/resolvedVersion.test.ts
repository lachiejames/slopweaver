import { describe, expect, it } from "vitest";

import { extractResolvedVersion, NOT_PRESENT } from "../../../../proof/yarnWhy/resolvedVersion.js";

describe("extractResolvedVersion", () => {
  it("extracts the resolved fragment from a real berry tree", () => {
    const output = "└─ slopweaver@workspace:.\n   └─ @datadog/datadog-api-client@npm:1.62.0 (via npm:1.62.0)\n";

    expect(extractResolvedVersion({ dependency: "@datadog/datadog-api-client", output })).toBe(
      "@datadog/datadog-api-client@npm:1.62.0",
    );
  });

  it("returns NOT_PRESENT when the dependency is absent from the tree", () => {
    expect(extractResolvedVersion({ dependency: "@datadog/datadog-api-client", output: "" })).toBe(NOT_PRESENT);
  });

  it("does not match a scoped dependency's name as a substring of another", () => {
    const output = "└─ @datadog/datadog-api-client-extra@npm:9.9.9\n";

    expect(extractResolvedVersion({ dependency: "@datadog/datadog-api-client", output })).toBe(NOT_PRESENT);
  });

  it("escapes regex metacharacters in the dependency name", () => {
    const output = "└─ left-pad@npm:1.3.0\n";

    expect(extractResolvedVersion({ dependency: "left-pad", output })).toBe("left-pad@npm:1.3.0");
  });

  it("reports every distinct coexisting version, not just the first match", () => {
    const output = [
      "├─ @clerk/backend@npm:0.38.15",
      "│  └─ @clerk/shared@npm:1.4.2 [d00e7] (via npm:1.4.2 [d00e7])",
      "├─ @clerk/backend@npm:1.34.0",
      "│  └─ @clerk/shared@npm:3.22.0 (via npm:^3.9.5)",
      "├─ @clerk/clerk-js@npm:6.14.0",
      "│  └─ @clerk/shared@npm:4.15.0 [0acbd] (via npm:^4.15.0 [0acbd])",
    ].join("\n");

    expect(extractResolvedVersion({ dependency: "@clerk/shared", output })).toBe(
      "@clerk/shared@npm:1.4.2, @clerk/shared@npm:3.22.0, @clerk/shared@npm:4.15.0",
    );
  });

  it("de-duplicates the same version repeated across multiple hoisting instances", () => {
    const output = ["│  └─ shell-quote@npm:1.8.4 (via npm:1.8.4)", "│  └─ shell-quote@npm:1.8.4 (via npm:1.8.4)"].join(
      "\n",
    );

    expect(extractResolvedVersion({ dependency: "shell-quote", output })).toBe("shell-quote@npm:1.8.4");
  });
});
