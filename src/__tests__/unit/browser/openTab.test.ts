/**
 * `openTab`, the attach-and-goto `browser open` and `browser present` share: what it reports when it stops
 * BEFORE touching the browser. A home with no extension token is that case, and needs no browser to run.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listInteractionSessionIds,
  makeInteractionWorkspace,
  readInteractionSession,
} from "../../../browser/interactionSessionStore.js";
import { openTab } from "../../../cli/commands/browser/openTab.js";
import { unwrapErr } from "../../../lib/result.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "open-tab-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("openTab, stopped before the browser", () => {
  it("holds no tab, has not navigated, and names why", () => {
    const failure = unwrapErr(
      openTab({
        chromePinPath: join(home, "chrome-pin.sh"),
        home,
        placement: "background",
        url: "https://github.com/pulls",
      }),
    );
    expect(failure.mayHoldTab).toBe(undefined);
    expect(failure.navigated).toBe(false);
    expect(failure.problems.length).toBeGreaterThan(0);
  });

  it("leaves no session record behind for `browser sessions` to list", () => {
    openTab({
      chromePinPath: join(home, "chrome-pin.sh"),
      home,
      placement: "background",
      url: "https://github.com/pulls",
    });
    // `browser sessions` lists a session by its record; the directory stays, as it does after every close.
    const listed = listInteractionSessionIds({ home }).filter(
      (id) => readInteractionSession({ home, id }) !== undefined,
    );
    expect(listInteractionSessionIds({ home }).length).toBe(1);
    expect(listed).toEqual([]);
  });
});

describe("makeInteractionWorkspace", () => {
  it("makes the workspace and every directory above it owner-only", () => {
    const session = join(home, "sessions", "s-1");
    makeInteractionWorkspace({ workspace: join(session, "client") });
    expect(statSync(join(session, "client")).mode & 0o777).toBe(0o700);
    expect(statSync(session).mode & 0o777).toBe(0o700);
  });
});
