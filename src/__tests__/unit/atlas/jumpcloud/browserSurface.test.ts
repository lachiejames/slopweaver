/**
 * The console publisher over a whole generation in a temporary home, and the fill check reading it back.
 *
 * Walked through the fake transport and the REAL artifact writer, so every screenshot the fill check credits
 * is a file on disk — the property `kit/walkPublish.ts`'s on-disk check exists for.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  JUMPCLOUD_ADMIN_TITLE,
  JUMPCLOUD_CONSOLE_ORIGIN,
  JUMPCLOUD_CONSOLE_PAGES,
} from "../../../../atlas/jumpcloud/browserPages.js";
import { JUMPCLOUD_CONSOLE_SURFACE } from "../../../../atlas/jumpcloud/browserProjection.js";
import { publishJumpcloudConsoleWalk } from "../../../../atlas/jumpcloud/browserSurface.js";
import { walkJumpcloudConsole } from "../../../../atlas/jumpcloud/browserWalk.js";
import {
  type JumpcloudConsolePaths,
  jumpcloudConsolePaths,
  readJumpcloudConsole,
} from "../../../../atlas/jumpcloud/consoleStore.js";
import { jumpcloudConsoleFill } from "../../../../atlas/jumpcloud/surfaceFill.js";
import { verifiedArtifactWriter } from "../../../../atlas/kit/artifactWriter.js";
import { unwrap } from "../../../../lib/result.js";

import { renderedPng } from "../../../pngFixture.js";
import { type FakeVisit, fakeTransport } from "../../../walkTransportFake.js";

const FIRST = "2026-09-25T01:00:00.000Z";
const SECOND = "2026-09-25T02:00:00.000Z";
const SENT_HOME = JUMPCLOUD_CONSOLE_PAGES[4]!;

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** Fresh console paths in a throwaway home, with the artifacts directory the verb would create. */
function scratchPaths(): JumpcloudConsolePaths {
  const home = mkdtempSync(join(tmpdir(), "sw-jc-console-"));
  homes.push(home);
  const paths = jumpcloudConsolePaths({ home });
  mkdirSync(paths.pageArtifacts, { recursive: true });
  return paths;
}

/** A console that keeps every address and draws each visit differently, except for `sendHome`. */
function consoleAnswer({ sendHome }: { sendHome: string | null }) {
  return ({ url, visitIndex }: { url: string; visitIndex: number }): FakeVisit => {
    const sentHome = sendHome !== null && url === `${JUMPCLOUD_CONSOLE_ORIGIN}/#/${sendHome}`;
    const finalUrl = sentHome ? `${JUMPCLOUD_CONSOLE_ORIGIN}/#/home` : url;
    return {
      capture: { finalUrl, screenshotPng: renderedPng({ seed: visitIndex + 1 }), title: JUMPCLOUD_ADMIN_TITLE },
    };
  };
}

/** Walk the fake console into `paths` and publish it at `at`. */
async function walkAndPublish({
  paths,
  at,
  sendHome,
}: {
  paths: JumpcloudConsolePaths;
  at: string;
  sendHome: string | null;
}): Promise<void> {
  const fake = fakeTransport({ answer: consoleAnswer({ sendHome }) });
  const walked = unwrap(
    await walkJumpcloudConsole({
      transport: fake.transport,
      writeArtifact: verifiedArtifactWriter({ directory: paths.directory }),
    }),
  );
  unwrap(publishJumpcloudConsoleWalk({ at, paths, walk: walked }));
}

/** The fill check over what the store now holds. */
function fillOf({ paths }: { paths: JumpcloudConsolePaths }) {
  const snapshot = unwrap(readJumpcloudConsole({ paths }));
  return jumpcloudConsoleFill({
    evidence: { manifest: snapshot.manifest, pageFile: snapshot.files.page, unreadableBecause: null },
  });
}

describe("publishJumpcloudConsoleWalk", () => {
  it("refuses a walk that does not cover the declared list, before writing a byte", () => {
    const paths = scratchPaths();
    const published = publishJumpcloudConsoleWalk({
      at: FIRST,
      paths,
      walk: { pages: [], rootFound: true, sessionLost: false },
    });
    expect(published.isErr()).toBe(true);
    expect(unwrap(readJumpcloudConsole({ paths })).manifest).toBe(null);
  });

  it("publishes one page entity per declared page", async () => {
    const paths = scratchPaths();
    await walkAndPublish({ at: FIRST, paths, sendHome: null });
    const snapshot = unwrap(readJumpcloudConsole({ paths }));
    expect(snapshot.files.page!.entities).toHaveLength(JUMPCLOUD_CONSOLE_PAGES.length);
  });

  it("grades a walk that held every declared page as synced", async () => {
    const paths = scratchPaths();
    await walkAndPublish({ at: FIRST, paths, sendHome: null });
    const page = unwrap(readJumpcloudConsole({ paths })).files.page!;
    expect(page.coverage.find((cell) => cell.surface === JUMPCLOUD_CONSOLE_SURFACE)!.state).toBe("synced");
  });

  it("grades a walk one page short as deferred, with the fraction in its reason", async () => {
    const paths = scratchPaths();
    await walkAndPublish({ at: FIRST, paths, sendHome: SENT_HOME.route });
    const cell = unwrap(readJumpcloudConsole({ paths })).files.page!.coverage.find(
      (held) => held.surface === JUMPCLOUD_CONSOLE_SURFACE,
    )!;
    expect(cell.state).toBe("deferred");
    expect(cell.reason).toContain(
      `${String(JUMPCLOUD_CONSOLE_PAGES.length - 1)} of ${String(JUMPCLOUD_CONSOLE_PAGES.length)}`,
    );
  });

  it("opens a not-addressable gap on the page the client sent home", async () => {
    const paths = scratchPaths();
    await walkAndPublish({ at: FIRST, paths, sendHome: SENT_HOME.route });
    const gaps = unwrap(readJumpcloudConsole({ paths })).files.page!.gaps.filter((gap) => gap.status === "open");
    expect(gaps.filter((gap) => gap.scope === SENT_HOME.surface).map((gap) => gap.condition)).toEqual([
      "browser-page-not-addressable",
    ]);
  });

  it("always says its denominator is a hand list and its view state is not addressable", async () => {
    const paths = scratchPaths();
    await walkAndPublish({ at: FIRST, paths, sendHome: null });
    const conditions = unwrap(readJumpcloudConsole({ paths }))
      .files.page!.gaps.filter((gap) => gap.status === "open")
      .map((gap) => gap.condition)
      .toSorted();
    expect(conditions).toEqual(["console-view-state-not-addressable", "provider-publishes-no-browser-inventory"]);
  });

  it("closes a page's gap once a later walk holds it", async () => {
    const paths = scratchPaths();
    await walkAndPublish({ at: FIRST, paths, sendHome: SENT_HOME.route });
    await walkAndPublish({ at: SECOND, paths, sendHome: null });
    const gap = unwrap(readJumpcloudConsole({ paths })).files.page!.gaps.find(
      (held) => held.scope === SENT_HOME.surface,
    )!;
    expect(gap.status).toBe("closed");
  });
});

describe("jumpcloudConsoleFill over a published walk", () => {
  it("is filled when the latest walk held every declared page", async () => {
    const paths = scratchPaths();
    await walkAndPublish({ at: FIRST, paths, sendHome: null });
    expect(fillOf({ paths })).toEqual({
      declared: JUMPCLOUD_CONSOLE_PAGES.length,
      filled: true,
      held: JUMPCLOUD_CONSOLE_PAGES.length,
      outstanding: [],
      requested: JUMPCLOUD_CONSOLE_PAGES.length,
      walkedAt: FIRST,
    });
  });

  it("names the one page the latest walk did not hold", async () => {
    const paths = scratchPaths();
    await walkAndPublish({ at: FIRST, paths, sendHome: SENT_HOME.route });
    const fill = fillOf({ paths });
    expect(fill.filled).toBe(false);
    expect(fill.outstanding).toEqual([SENT_HOME.surface]);
  });

  // An earlier walk's success does not carry: the page must be held on the LATEST walk.
  it("does not credit a page an earlier walk held and the latest one did not", async () => {
    const paths = scratchPaths();
    await walkAndPublish({ at: FIRST, paths, sendHome: null });
    await walkAndPublish({ at: SECOND, paths, sendHome: SENT_HOME.route });
    expect(fillOf({ paths }).outstanding).toEqual([SENT_HOME.surface]);
  });
});
