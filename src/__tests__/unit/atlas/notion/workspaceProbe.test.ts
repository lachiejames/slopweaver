import { describe, expect, it } from "vitest";

import { NOTION_WEB_ORIGIN } from "../../../../atlas/notion/browserPages.js";
import { resolveWorkspaceRoot } from "../../../../atlas/notion/workspaceProbe.js";
import { BrowserTransportErrors } from "../../../../browser/pageTransport.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { type FakeVisit, fakeTransport } from "../../../walkTransportFake.js";

/** The address the probe asks for: the bare origin. */
const PROBE_URL = `${NOTION_WEB_ORIGIN}/`;

/** Resolve against a fake whose probe answers with `visit`, collecting every progress line. */
async function resolveWith({ visit }: { visit: FakeVisit }): Promise<{
  resolved: Awaited<ReturnType<typeof resolveWorkspaceRoot>>;
  lines: string[];
}> {
  const fake = fakeTransport({ visits: { [PROBE_URL]: visit } });
  const lines: string[] = [];
  const resolved = await resolveWorkspaceRoot({
    progress: ({ line }) => lines.push(line),
    settleMs: 0,
    transport: fake.transport,
  });
  return { lines, resolved };
}

describe("resolveWorkspaceRoot", () => {
  it("learns the root from where a signed-in client landed", async () => {
    const { resolved } = await resolveWith({
      visit: { capture: { finalUrl: `${NOTION_WEB_ORIGIN}/p/acme/Notes-0123456789abcdef0123456789abcdef` } },
    });
    expect(unwrap(resolved)).toEqual({ root: `${NOTION_WEB_ORIGIN}/p/acme`, rootMissingBecause: null });
  });

  it("says the probe landed with no workspace segment when it did", async () => {
    const { resolved } = await resolveWith({ visit: { capture: { finalUrl: `${NOTION_WEB_ORIGIN}/space/home` } } });
    expect(unwrap(resolved)).toEqual({
      root: null,
      rootMissingBecause:
        "this page hangs off the workspace root and the probe found no workspace segment in the client's own landing URL",
    });
  });

  it("answers no root, with the transport's own because, when the probe's navigation failed", async () => {
    const { resolved } = await resolveWith({
      visit: {
        failWith: BrowserTransportErrors.navigationFailed({
          because: "the fake client was killed after its navigation bound",
          reason: "spawnSync node ETIMEDOUT",
          url: PROBE_URL,
        }),
      },
    });
    expect(unwrap(resolved)).toEqual({
      root: null,
      rootMissingBecause:
        "this page hangs off the workspace root, but the workspace-root probe navigation failed: the fake client was killed after its navigation bound",
    });
  });

  it("reports nothing on progress when the probe simply landed", async () => {
    const { lines } = await resolveWith({ visit: { capture: { finalUrl: `${NOTION_WEB_ORIGIN}/space/home` } } });
    expect(lines).toEqual([]);
  });

  it("still refuses on a lost session, quoting the bare-origin message", async () => {
    const failure = BrowserTransportErrors.sessionLost({ reason: "signed out" });
    const { resolved } = await resolveWith({ visit: { failWith: failure } });
    expect(unwrapErr(resolved)).toEqual([
      `could not reach the Notion web client to learn its workspace: ${failure.message}`,
    ]);
  });
});
