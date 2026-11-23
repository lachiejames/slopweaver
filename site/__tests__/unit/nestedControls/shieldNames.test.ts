import { describe, expect, it } from "vitest";
import { SHIELD, scopesOf, shieldNames } from "./nestedControlsHarness.js";

describe("shieldNames", () => {
  it("holds InsideControl under each re-export and exported rename, and not a component drawing it", () => {
    const scopes = scopesOf({
      sources: [
        { path: "components/console/WarningMark.tsx", source: `export const InsideControl = createContext(false);` },
        { path: "components/console/Barrel.tsx", source: `export { InsideControl as Reset } from "./WarningMark";` },
        { path: "components/x/index.tsx", source: `export * from "../console/Barrel";` },
        { path: "components/y/Spaced.tsx", source: `export * as shields from "../console/WarningMark";` },
        {
          path: "components/z/Renamed.tsx",
          source: `import { Reset } from "../x"; export const Again = Reset;
          export const Wraps = ({ children }) => <Reset value>{children}</Reset>;`,
        },
      ],
    });
    expect([...shieldNames({ scopes })].toSorted()).toEqual([
      "components/console/Barrel#Reset",
      SHIELD,
      "components/x#Reset",
      "components/y/Spaced#shields.InsideControl",
      "components/z/Renamed#Again",
    ]);
  });
});
