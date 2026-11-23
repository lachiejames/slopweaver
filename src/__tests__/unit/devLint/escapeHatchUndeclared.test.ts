/* The escape-hatch gate's undeclared criteria, judged on one line against the real register. */
import { describe, expect, it } from "vitest";
import { REGISTER_PATH, undeclaredDoorTokens, undeclaredEnvHatches } from "../../../devLint/escapeHatchUndeclared.js";

describe("undeclaredEnvHatches", () => {
  it("passes a registered variable whether the family match or the syntax tree found it", () => {
    expect(
      undeclaredEnvHatches({
        at: 1,
        line: "SLOPWEAVER_ALLOW_POLL=1",
        path: "src/a.ts",
        shaped: [{ end: 30, name: "ALLOW_FABLE_OVERRIDE", start: 0 }],
      }),
    ).toEqual([]);
  });

  it("refuses a family mention inside a sentence and a shaped name, one hit each, naming the register", () => {
    const hits = undeclaredEnvHatches({
      at: 7,
      line: 'const why = "set SLOPWEAVER_ALLOW_NOTHING_HERE=1";',
      path: "src/a.ts",
      shaped: [{ end: 30, name: "ACME_ALLOW_EVERYONE", start: 0 }],
    });

    expect(hits.map((hit) => [hit.line, hit.criterion, hit.message.split(" ")[0]])).toEqual([
      [7, "undeclared", "SLOPWEAVER_ALLOW_NOTHING_HERE"],
      [7, "undeclared", "ACME_ALLOW_EVERYONE"],
    ]);
    expect(hits[0]!.message).toContain(`has no row in ${REGISTER_PATH}`);
  });

  it("leaves the door's own list variable to the door-token criterion", () => {
    const shaped = [{ end: 26, name: "SLOPWEAVER_DOOR_OVERRIDE", start: 0 }];
    expect(undeclaredEnvHatches({ at: 1, line: "", path: "src/a.ts", shaped })).toEqual([]);
  });

  it("drops a raw fragment only INSIDE the node that spells the longer name", () => {
    const line = 'const a = "note SLOPWEAVER_ALLOW_P"; const b = "SLOPWEAVER_ALLOW_POLL";';
    const elsewhere = [{ end: 70, name: "SLOPWEAVER_ALLOW_POLL", start: 47 }];
    const around = [{ end: 70, name: "SLOPWEAVER_ALLOW_POLL", start: 10 }];
    expect(line.slice(47, 70)).toBe('"SLOPWEAVER_ALLOW_POLL"');
    expect(
      undeclaredEnvHatches({ at: 1, line, path: "src/a.ts", shaped: elsewhere }).map(
        (hit) => hit.message.split(" ")[0],
      ),
    ).toEqual(["SLOPWEAVER_ALLOW_P"]);
    expect(undeclaredEnvHatches({ at: 1, line, path: "src/a.ts", shaped: around })).toEqual([]);
  });
});

describe("undeclaredDoorTokens", () => {
  it("refuses a token no row declares, in both spellings the tree uses", () => {
    const constant = undeclaredDoorTokens({ at: 2, line: 'const X_OVERRIDE = "acme.nothing:v1";', path: "src/a.ts" });
    const inline = undeclaredDoorTokens({ at: 3, line: 'override: "acme.nothing:v2",', path: "src/a.ts" });

    expect([...constant, ...inline].map((hit) => [hit.line, hit.message.split(" — ")[0]])).toEqual([
      [2, `door override token "acme.nothing:v1" has no row in ${REGISTER_PATH}`],
      [3, `door override token "acme.nothing:v2" has no row in ${REGISTER_PATH}`],
    ]);
  });

  it("clears a registered env name assigned to an _OVERRIDE constant", () => {
    expect(
      undeclaredDoorTokens({ at: 1, line: 'const DEFAULT_OVERRIDE = "SLOPWEAVER_ALLOW_POLL";', path: "src/a.ts" }),
    ).toEqual([]);
  });

  it("clears the door's own list variable assigned to an _OVERRIDE constant", () => {
    expect(
      undeclaredDoorTokens({ at: 1, line: 'const X_OVERRIDE = "SLOPWEAVER_DOOR_OVERRIDE";', path: "src/a.ts" }),
    ).toEqual([]);
  });
});
