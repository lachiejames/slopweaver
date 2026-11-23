import { describe, expect, it } from "vitest";
import { MARK, markDrawers, SHIELD, scopesOf } from "./nestedControlsHarness.js";
import { nestedScan } from "./nestedControlsScan.js";

describe("nestedScan", () => {
  const drawers = new Set([MARK, "components/live/LiveMarks#ReadMark", "components/live/LiveMarks#default"]);
  const shields = new Set([SHIELD, "components/console/Barrel#Reset"]);
  const imports = `import { InsideControl, WarningMark } from "../console/WarningMark"; import { ReadMark } from "../live/LiveMarks";`;

  it("refuses a mark drawer inside a button or a link, however deep", () => {
    const source = `${imports}
    const A = () => (<div>
      <button type="button"><span><ReadMark /></span></button>
      <a href="/x"><WarningMark facts={[]} /></a>
    </div>);`;
    expect(nestedScan({ drawers, shields, path: "components/x/A.tsx", source })).toEqual({
      refused: [
        { line: 3, mark: "ReadMark", path: "components/x/A.tsx" },
        { line: 4, mark: "WarningMark", path: "components/x/A.tsx" },
      ],
      shielded: [],
    });
  });

  it("shields a mark drawer with InsideControl between it and the control", () => {
    const source = `${imports}
    const A = () => (<button type="button">
      <InsideControl value={true}><span><ReadMark /></span></InsideControl>
    </button>);`;
    expect(nestedScan({ drawers, shields, path: "components/x/A.tsx", source })).toEqual({
      refused: [],
      shielded: [{ line: 3, mark: "ReadMark", path: "components/x/A.tsx" }],
    });
  });

  it("refuses a mark drawer under a same-named InsideControl it never imported from the mark", () => {
    const source = `import { ReadMark } from "../live/LiveMarks"; const InsideControl = () => <i />;
    const A = () => (<button type="button"><InsideControl value={true}><ReadMark /></InsideControl></button>);`;
    expect(nestedScan({ drawers, shields, path: "components/x/A.tsx", source })).toEqual({
      refused: [{ line: 2, mark: "ReadMark", path: "components/x/A.tsx" }],
      shielded: [],
    });
  });

  it("refuses a mark drawer under an InsideControl that is off, missing its value or computed at run time", () => {
    const source = `${imports}
    const A = ({ on }: { on: boolean }) => (<div>
      <button type="button"><InsideControl value={false}><ReadMark /></InsideControl></button>
      <button type="button"><InsideControl><ReadMark /></InsideControl></button>
      <button type="button"><InsideControl value={on}><ReadMark /></InsideControl></button>
      <button type="button"><InsideControl value><ReadMark /></InsideControl></button>
    </div>);`;
    expect(nestedScan({ drawers, shields, path: "components/x/A.tsx", source })).toEqual({
      refused: [
        { line: 3, mark: "ReadMark", path: "components/x/A.tsx" },
        { line: 4, mark: "ReadMark", path: "components/x/A.tsx" },
        { line: 5, mark: "ReadMark", path: "components/x/A.tsx" },
      ],
      shielded: [{ line: 6, mark: "ReadMark", path: "components/x/A.tsx" }],
    });
  });

  it("refuses a mark drawer whose shield a re-exported InsideControl turns back off, and credits a renamed one on", () => {
    const source = `${imports} import { Reset } from "../console/Barrel"; const On = InsideControl;
    const A = () => (<div>
      <button type="button"><InsideControl value><Reset value={false}><ReadMark /></Reset></InsideControl></button>
      <button type="button"><On value><ReadMark /></On></button>
    </div>);`;
    expect(nestedScan({ drawers, shields, path: "components/x/A.tsx", source })).toEqual({
      refused: [{ line: 3, mark: "ReadMark", path: "components/x/A.tsx" }],
      shielded: [{ line: 4, mark: "ReadMark", path: "components/x/A.tsx" }],
    });
  });

  it("refuses a mark reached inside a control by a call, a top-level element or an object's member", () => {
    const source = `${imports}
    function renderMark() { return <WarningMark facts={[]} />; }
    const markElement = <WarningMark facts={[]} />; const marks = { draw: () => <WarningMark facts={[]} /> };
    const A = () => (<div>
      <button type="button">{renderMark()}</button>
      <a href="/x">{markElement}</a>
      <button type="button">{marks.draw()}<marks.draw /></button>
      <button type="button">{marks?.draw()}{marks!.draw()}</button>
    </div>);`;
    const local = markDrawers({ scopes: scopesOf({ sources: [{ path: "components/x/A.tsx", source }] }) });
    expect(nestedScan({ drawers: local, shields, path: "components/x/A.tsx", source })).toEqual({
      refused: [
        { line: 5, mark: "renderMark", path: "components/x/A.tsx" },
        { line: 6, mark: "markElement", path: "components/x/A.tsx" },
        { line: 7, mark: "marks.draw", path: "components/x/A.tsx" },
        { line: 7, mark: "marks.draw", path: "components/x/A.tsx" },
        { line: 8, mark: "marks.draw", path: "components/x/A.tsx" },
        { line: 8, mark: "marks.draw", path: "components/x/A.tsx" },
      ],
      shielded: [],
    });
  });

  it("refuses a mark drawer reached by a default or a namespace import, renamed or not", () => {
    const source = `import Mark from "../live/LiveMarks"; import * as live from "../live/LiveMarks"; const Renamed = live;
    const A = () => (<div>
      <button type="button"><Mark /></button>
      <a href="/x"><live.ReadMark /></a>
      <a href="/x"><Renamed.ReadMark /></a>
      <a href="/x">{live?.ReadMark({})}{(live)!.ReadMark({})}</a>
    </div>);`;
    expect(nestedScan({ drawers, shields, path: "components/x/A.tsx", source })).toEqual({
      refused: [
        { line: 3, mark: "Mark", path: "components/x/A.tsx" },
        { line: 4, mark: "live.ReadMark", path: "components/x/A.tsx" },
        { line: 5, mark: "Renamed.ReadMark", path: "components/x/A.tsx" },
        { line: 6, mark: "live.ReadMark", path: "components/x/A.tsx" },
        { line: 6, mark: "live.ReadMark", path: "components/x/A.tsx" },
      ],
      shielded: [],
    });
  });

  it("passes a mark drawer outside any control, a control drawing no mark, and a same-named tag it never imported", () => {
    const source = `const ReadMark = () => <i />;
    const A = () => (<div><button type="button"><ReadMark /></button><button type="button">open</button></div>);`;
    expect(nestedScan({ drawers, shields, path: "components/x/A.tsx", source })).toEqual({ refused: [], shielded: [] });
  });
});
