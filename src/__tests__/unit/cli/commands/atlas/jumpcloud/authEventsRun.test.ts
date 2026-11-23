/**
 * The clause `atlas jumpcloud auth-events` prints for what stopped each service's walk.
 *
 * The verb's shell reads the real clock, a credential and the network, so it is not driven here;
 * `describeAuthWalkEnding` is the one decision in the report that a reader's conclusion rests on.
 */
import { describe, expect, it } from "vitest";

import type { AuthWalkEnding, ServiceWalk } from "../../../../../../atlas/jumpcloud/authEventsRead.js";
import { describeAuthWalkEnding } from "../../../../../../cli/commands/atlas/jumpcloud/authEventsRun.js";

/** One service's walk ending as given, with counts that do not appear in the clause. */
function walkEndingOn({ ending }: { ending: AuthWalkEnding }): ServiceWalk {
  return { ending, eventsRead: 1000, pagesRead: 7, service: "systems" };
}

describe("describeAuthWalkEnding", () => {
  it("says a window-exhausted walk proves an absent identity did not authenticate", () => {
    expect(describeAuthWalkEnding({ walk: walkEndingOn({ ending: { kind: "window-exhausted" } }) })).toBe(
      "reached the start of the window, so an identity absent above did not authenticate on it",
    );
  });

  it("says a walk with no further cursor bounds a silence to the oldest instant", () => {
    expect(describeAuthWalkEnding({ walk: walkEndingOn({ ending: { kind: "no-cursor" } }) })).toBe(
      "the provider offered no further cursor, so a silence on this service holds only back to the oldest instant named",
    );
  });

  it("names the page ceiling a capped walk hit, and the --max-pages flag that raises it", () => {
    expect(describeAuthWalkEnding({ walk: walkEndingOn({ ending: { kind: "page-cap", pages: 7 } }) })).toBe(
      "the 7-page ceiling stopped it short, so a silence on this service holds only back to the oldest instant named — raise it with --max-pages",
    );
  });
});
