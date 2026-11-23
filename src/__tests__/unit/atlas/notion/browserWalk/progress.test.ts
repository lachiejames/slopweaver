/*
 * What `walkNotionBrowser` prints on progress: the surface it is on, and never a URL.
 */
import { describe, expect, it } from "vitest";

import { walkNotionBrowser } from "../../../../../atlas/notion/browserWalk.js";

import { fakeTransport } from "../../../../walkTransportFake.js";
import { probeVisit, recordingWriter } from "./harness.js";

describe("walkNotionBrowser progress", () => {
  it("names the surface and never a URL in its progress lines", async () => {
    const fake = fakeTransport({ visits: probeVisit() });
    const lines: string[] = [];
    await walkNotionBrowser({
      progress: ({ line }) => lines.push(line),
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(lines.filter((line) => line.includes("http"))).toEqual([]);
  });
});
