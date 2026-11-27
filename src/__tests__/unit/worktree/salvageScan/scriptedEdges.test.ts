/**
 * The salvage scan's decision over scripted edges: what it allows, what it declines, and that every failure to
 * list or read what the push would send declines rather than passing unscanned.
 */
import { describe, expect, it } from "vitest";

import { type SalvageScanEdges, salvageScanDecline } from "../../../../worktree/salvageScan.js";
import { batchOf, IDENTIFIERS, ORG, REF, SHA_A, SHA_B, TOKEN } from "./harness.js";

/**
 * Scripted edges answering a fixed listing and a fixed set of blobs.
 *
 * @param blobs each blob's name, path and content
 * @param metadata what `git log` answers for the commit messages and changed paths
 * @returns the edges
 */
function scripted({
  blobs,
  metadata = "",
}: {
  blobs: readonly { sha: string; path: string; content: string }[];
  metadata?: string;
}): SalvageScanEdges {
  return {
    listBlobs: () => blobs.map(({ sha, path }) => `${sha} ${path}`).join("\n"),
    listMetadata: () => metadata,
    readBlobs: ({ shas }) => batchOf({ objects: blobs.filter((blob) => shas.includes(blob.sha)) }),
  };
}

describe("salvageScanDecline", () => {
  it("allows the push when nothing secret leaves", () => {
    const edges = scripted({ blobs: [{ content: "const a = 1;", path: "a.ts", sha: SHA_A }] });
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      null,
    );
  });

  it("applies a LOADED denylist to every blob", () => {
    const edges = scripted({ blobs: [{ content: "zanzibar-internal", path: "n.md", sha: SHA_A }] });
    expect(
      salvageScanDecline({
        denylist: { kind: "loaded", lines: ["zanzibar-internal"] },
        edges,
        identifiers: IDENTIFIERS,
        refName: REF,
      }),
    ).toBe("the work it would push carries 1 secret-class line(s) (denylist) in n.md — nothing was pushed");
  });

  it("declines on an UNREADABLE denylist without even listing", () => {
    let listed = 0;
    const edges: SalvageScanEdges = {
      listBlobs: () => {
        listed += 1;
        return "";
      },
      listMetadata: () => "",
      readBlobs: () => Buffer.alloc(0),
    };
    const decline = salvageScanDecline({
      denylist: { kind: "unreadable", path: "/home/hygiene-denylist.txt", reason: "EACCES" },
      edges,
      identifiers: IDENTIFIERS,
      refName: REF,
    });
    expect(decline).toBe(
      "the private denylist at /home/hygiene-denylist.txt could not be read (EACCES), so what it would push went unscanned — nothing was pushed",
    );
    expect(listed).toBe(0);
  });

  it("declines when the listing fails, because a scan that did not happen is not a clean one", () => {
    const edges: SalvageScanEdges = {
      listBlobs: () => {
        throw new Error("fatal: bad revision");
      },
      listMetadata: () => "",
      readBlobs: () => Buffer.alloc(0),
    };
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "what it would push could not be listed for the secrets scan — fatal: bad revision; nothing was pushed",
    );
  });

  it("declines when the changed paths cannot be listed", () => {
    const edges: SalvageScanEdges = {
      listBlobs: () => "",
      listMetadata: () => {
        throw new Error("fatal: bad object");
      },
      readBlobs: () => Buffer.alloc(0),
    };
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "the paths it would push could not be listed for the secrets scan — fatal: bad object; nothing was pushed",
    );
  });

  it("declines a secret in the salvage BRANCH NAME, which the push publishes and the tree's name builds", () => {
    const refName = `salvage/${TOKEN}-2ba73fd1`;
    const line = salvageScanDecline({
      denylist: { kind: "absent" },
      edges: scripted({ blobs: [] }),
      identifiers: IDENTIFIERS,
      refName,
    });
    expect(line).toBe(
      "the work it would push carries 1 secret-class line(s) (github-oauth-token) in the salvage branch name — nothing was pushed",
    );
    expect(refName).toContain(TOKEN);
    expect(line).not.toContain(TOKEN);
  });

  it("declines when a blob read fails", () => {
    const edges: SalvageScanEdges = {
      listBlobs: () => `${SHA_A} a.ts`,
      listMetadata: () => "",
      readBlobs: () => {
        throw new Error("stdout maxBuffer length exceeded");
      },
    };
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "what it would push could not be read for the secrets scan — stdout maxBuffer length exceeded; nothing was pushed",
    );
  });

  it("declines when git answers fewer objects than it listed", () => {
    const edges: SalvageScanEdges = {
      listBlobs: () => [`${SHA_A} a.ts`, `${SHA_B} b.ts`].join("\n"),
      listMetadata: () => "",
      readBlobs: () => batchOf({ objects: [{ content: "ok", sha: SHA_A }] }),
    };
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "git did not answer every object the push would send, so they went unscanned — nothing was pushed",
    );
  });

  it("scans every batch, finding a secret past the first two hundred blobs", () => {
    const blobs = Array.from({ length: 450 }, (_, index) => ({
      content: index === 430 ? TOKEN : `const n = ${String(index)};`,
      path: `f${String(index)}.ts`,
      sha: index.toString(16).padStart(40, "0"),
    }));
    expect(
      salvageScanDecline({
        denylist: { kind: "absent" },
        edges: scripted({ blobs }),
        identifiers: IDENTIFIERS,
        refName: REF,
      }),
    ).toBe(
      "the work it would push carries 1 secret-class line(s) (github-oauth-token) in f430.ts — nothing was pushed",
    );
  });
});

describe("salvageScanDecline over a forbidden identifier", () => {
  it("declines an uncommitted file naming the organisation, by class and path, never the word", () => {
    const content = `notes for ${ORG} only\n`;
    const edges = scripted({ blobs: [{ content, path: "notes.md", sha: SHA_A }] });
    const line = salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF });
    expect(line).toBe(
      "the work it would push carries 1 forbidden-identifier hit(s) (forbidden-word-ci) in notes.md, and the destination is public — nothing was pushed",
    );
    expect(content).toContain(ORG);
  });

  it("declines the organisation in a changed path's NAME, whose blob is clean", () => {
    const edges = scripted({ blobs: [{ content: "clean", path: "a.md", sha: SHA_A }], metadata: `${ORG}/a.md\u0000` });
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "the work it would push carries 1 forbidden-identifier hit(s) (forbidden-word-ci) in the changed paths, and the destination is public — nothing was pushed",
    );
  });

  it("declines a secret first when a push carries both", () => {
    const edges = scripted({ blobs: [{ content: `${ORG} ${TOKEN}`, path: "both.md", sha: SHA_A }] });
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "the work it would push carries 1 secret-class line(s) (github-oauth-token) in both.md — nothing was pushed",
    );
  });
});
