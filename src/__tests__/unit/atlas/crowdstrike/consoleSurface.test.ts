import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { publishConsoleWalk } from "../../../../atlas/crowdstrike/consoleSurface.js";
import { crowdstrikeAtlasPaths } from "../../../../atlas/crowdstrike/store.js";
import { unwrapErr } from "../../../../lib/result.js";

const homes: string[] = [];

/** A throwaway state home, removed in afterEach. */
function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-cs-console-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("publishConsoleWalk", () => {
  it("refuses a walk with an unstorable request, one line per problem, and writes no manifest", () => {
    const paths = crowdstrikeAtlasPaths({ home: makeHome() });
    const problems = unwrapErr(
      publishConsoleWalk({
        at: "2026-09-04T00:00:00.000Z",
        origin: "https://falcon.example-cloud.test",
        paths,
        walk: {
          artifactsWritten: 0,
          incompletePages: [],
          notAttempted: [],
          pages: [],
          requests: [
            {
              method: "GET",
              observedOnPages: ["/hosts"],
              paramNames: [],
              pathShape: "/devices/queries/devices/v1",
              responseFieldPaths: [],
              statusCodes: [1.5],
            },
          ],
          unrenderedPages: [],
        },
      }),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("projected console-request is not storable — statusCodes.0: ");
    expect(problems[1]).toBe("nothing was written — this walk is not published");
    expect(existsSync(paths.manifest)).toBe(false);
  });
});
