import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { UNRENDERED_SCREENSHOT_BECAUSE } from "../../../../../atlas/kit/browserWalk.js";
import type { DrivenSession } from "../../../../../atlas/slackApi/drivenSession.js";
import { storeSlackScreenshots } from "../../../../../cli/commands/atlas/slackDriveScreenshots.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { renderedPng, unrenderedPng } from "../../../../pngFixture.js";
import { walkedPage } from "../../../atlas/slackApi/slackAtlasFixtures.js";

const dirs: string[] = [];

/** A throwaway directory, removed after each case. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-slack-shots-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** One recorded walk holding exactly the pages given. */
function session({ pages }: { pages: DrivenSession["pages"] }): DrivenSession {
  return { pages, unreachable: [], workspaceId: "T0SYN1ABCDEFGH" };
}

/** Write a PNG into a scratch directory, returning its path. */
function pngAt({ bytes, dir }: { bytes: Uint8Array; dir: string }): string {
  const path = join(dir, "shot.png");
  writeFileSync(path, bytes);
  return path;
}

describe("storeSlackScreenshots", () => {
  it("stores a permitted page's picture under the digest of its own bytes", () => {
    const bytes = renderedPng();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const directory = scratch();
    const stored = storeSlackScreenshots({
      directory,
      session: session({ pages: [walkedPage({ screenshotPath: pngAt({ bytes, dir: scratch() }) })] }),
    });
    expect(stored.isOk()).toBe(true);
    const value = unwrap(stored);
    expect(value.refusals).toEqual([]);
    expect([...value.stored.entries()]).toEqual([
      [
        "/client/<team>/today",
        {
          byteLength: bytes.byteLength,
          kind: "page-png",
          mediaType: "image/png",
          relativePath: `artifacts/pages/${sha256}.png`,
          sha256,
        },
      ],
    ]);
    expect(existsSync(join(directory, "artifacts", "pages", `${sha256}.png`))).toBe(true);
  });

  it("refuses a page the surface map refuses a picture of, and writes nothing", () => {
    const directory = scratch();
    const stored = storeSlackScreenshots({
      directory,
      session: session({
        pages: [
          walkedPage({ path: "/client/<team>/dms", screenshotPath: pngAt({ bytes: renderedPng(), dir: scratch() }) }),
        ],
      }),
    });
    expect(stored.isOk()).toBe(true);
    const value = unwrap(stored);
    expect(value.stored.size).toBe(0);
    expect(value.refusals).toEqual([
      "not storing the picture the walk took of /client/<team>/dms — the surface map refuses a picture of" +
        " /client/<team>/dms: the direct-message pane, which opens on the most recent conversation",
    ]);
    expect(readdirSync(directory)).toEqual([]);
  });

  it("refuses a picture the browser never rendered", () => {
    const stored = storeSlackScreenshots({
      directory: scratch(),
      session: session({ pages: [walkedPage({ screenshotPath: pngAt({ bytes: unrenderedPng(), dir: scratch() }) })] }),
    });
    expect(stored.isOk()).toBe(true);
    expect(unwrap(stored).refusals).toEqual([
      `not storing the picture the walk took of /client/<team>/today — ${UNRENDERED_SCREENSHOT_BECAUSE}`,
    ]);
  });

  it("skips a page the walk reached but did not photograph", () => {
    const stored = storeSlackScreenshots({ directory: scratch(), session: session({ pages: [walkedPage()] }) });
    expect(stored.isOk()).toBe(true);
    const value = unwrap(stored);
    expect(value.stored.size).toBe(0);
    expect(value.refusals).toEqual([]);
  });

  it("names the page whose picture could not be read", () => {
    const stored = storeSlackScreenshots({
      directory: scratch(),
      session: session({ pages: [walkedPage({ screenshotPath: join(scratch(), "missing.png") })] }),
    });
    expect(stored.isErr()).toBe(true);
    expect(unwrapErr(stored).code).toBe("SCREENSHOT_UNREADABLE");
  });
});
