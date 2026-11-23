/*
 * How `walkNotionBrowser` carries on when the workspace probe's own navigation fails: it walks every page that
 * does not hang off the workspace root, names the probe failure as why the other two were never addressed,
 * and puts no address or raw reason in any record or progress line.
 */
import { describe, expect, it } from "vitest";

import { NOTION_BROWSER_PAGES, NOTION_WEB_ORIGIN } from "../../../../../atlas/notion/browserPages.js";
import { type NotionBrowserWalkResult, walkNotionBrowser } from "../../../../../atlas/notion/browserWalk.js";
import { BrowserTransportErrors } from "../../../../../browser/pageTransport.js";
import { unwrap } from "../../../../../lib/result.js";

import { fakeTransport } from "../../../../walkTransportFake.js";
import { recordingWriter } from "./harness.js";

describe("walkNotionBrowser, when the workspace probe's own navigation fails", () => {
  /** The client kill a scheduled firing met, with `because` and `reason` kept distinct so a leak shows. */
  const PROBE_FAILURE = BrowserTransportErrors.navigationFailed({
    because: "the fake client was killed after its navigation bound",
    reason: "spawnSync node ETIMEDOUT",
    url: `${NOTION_WEB_ORIGIN}/`,
  });

  /** Walk with the probe failing to navigate, collecting every progress line. */
  async function walkWithFailedProbe(): Promise<{ walked: NotionBrowserWalkResult; lines: string[] }> {
    const fake = fakeTransport({ visits: { [`${NOTION_WEB_ORIGIN}/`]: { failWith: PROBE_FAILURE } } });
    const lines: string[] = [];
    const walked = unwrap(
      await walkNotionBrowser({
        progress: ({ line }) => lines.push(line),
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    return { lines, walked };
  }

  it("walks rather than refusing, and reports no workspace root", async () => {
    const { walked } = await walkWithFailedProbe();
    expect(walked.workspaceRootFound).toBe(false);
  });

  it("still attempts every page that does not hang off the workspace root", async () => {
    const { walked } = await walkWithFailedProbe();
    expect(walked.pages.filter((page) => page.attempted).length).toBe(NOTION_BROWSER_PAGES.length - 2);
  });

  it("leaves exactly the two workspace-rooted pages unattempted", async () => {
    const { walked } = await walkWithFailedProbe();
    expect(
      walked.pages
        .filter((page) => !page.attempted)
        .map((page) => page.surface)
        .toSorted(),
    ).toEqual(["workspace-members", "workspace-settings"]);
  });

  it("records the probe's own navigation failure as why those two were never addressed", async () => {
    const { walked } = await walkWithFailedProbe();
    expect(walked.pages.filter((page) => !page.attempted).map((page) => page.unreachableBecause)).toEqual([
      "this page hangs off the workspace root, but the workspace-root probe navigation failed: the fake client was killed after its navigation bound",
      "this page hangs off the workspace root, but the workspace-root probe navigation failed: the fake client was killed after its navigation bound",
    ]);
  });

  it("never records the transport's address-bearing message or its raw reason", async () => {
    const { walked } = await walkWithFailedProbe();
    const reasons = walked.pages.filter((page) => !page.attempted).map((page) => page.unreachableBecause!);
    expect(PROBE_FAILURE.message).toContain("http");
    expect(reasons.filter((reason) => reason.includes("http") || reason.includes("ETIMEDOUT"))).toEqual([]);
  });

  it("says once, on progress, that it is continuing without a workspace root", async () => {
    const { lines } = await walkWithFailedProbe();
    expect(lines.filter((line) => line.includes("workspace-root probe"))).toEqual([
      "notion browser: workspace-root probe navigation failed — the fake client was killed after its navigation bound; continuing without a workspace root",
    ]);
  });

  it("puts no URL on progress while recovering", async () => {
    const { lines } = await walkWithFailedProbe();
    expect(lines.filter((line) => line.includes("http"))).toEqual([]);
  });
});
