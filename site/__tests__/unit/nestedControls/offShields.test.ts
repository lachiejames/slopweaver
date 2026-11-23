import { describe, expect, it } from "vitest";
import { SHIELD } from "./nestedControlsHarness.js";
import { offShields } from "./nestedControlsScan.js";

describe("offShields", () => {
  it("reports the mark's own InsideControl drawn off, or self-closing even when on, and passes one drawn on or a lookalike", () => {
    const source = `import { InsideControl } from "../console/WarningMark"; import { InsideControl as Other } from "./other";
    const A = ({ on }: { on: boolean }) => (<div>
      <InsideControl value={false}><i /></InsideControl>
      <InsideControl value={on}><i /></InsideControl>
      <InsideControl />
      <InsideControl value={true} />
      <InsideControl value={true}><i /></InsideControl>
      <Other value={false}><i /></Other>
    </div>);`;
    expect(offShields({ path: "components/x/A.tsx", shields: new Set([SHIELD]), source })).toEqual([3, 4, 5, 6]);
  });

  it("reports InsideControl reached through a re-export or a local rename, drawn off", () => {
    const source = `import { Reset } from "../console/Barrel"; import { InsideControl } from "../console/WarningMark";
    const Off = InsideControl;
    const A = () => (<div>
      <Reset value={false}><i /></Reset>
      <Off value={false}><i /></Off>
    </div>);`;
    const shields = new Set([SHIELD, "components/console/Barrel#Reset"]);
    expect(offShields({ path: "components/x/A.tsx", shields, source })).toEqual([4, 5]);
  });
});
