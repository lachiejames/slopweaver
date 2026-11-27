/**
 * The salvage scan's decision over scripted edges: what it allows, what it declines, and that every failure to
 * list or read what the push would send declines rather than passing unscanned.
 */
import { describe, expect, it } from "vitest";

import { type SalvageScanEdges, salvageScanDecline } from "../../../../worktree/salvageScan.js";
import { batchOf, IDENTIFIERS, ORG, REF, rawRecord, SHA_A, SHA_B, TOKEN } from "./harness.js";

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
    const edges = scripted({
      blobs: [{ content: "clean", path: "a.md", sha: SHA_A }],
      metadata: rawRecord({ path: `${ORG}/a.md`, sha: SHA_A }),
    });
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "the work it would push carries 1 forbidden-identifier hit(s) (forbidden-word-ci) in the changed paths, and the destination is public — nothing was pushed",
    );
  });

  it("declines a forbidden word at EVERY path its one blob is written at, counting each copy", () => {
    const edges = scripted({
      blobs: [{ content: `notes for ${ORG}\n`, path: "a.md", sha: SHA_A }],
      metadata: rawRecord({ path: "a.md", sha: SHA_A }) + rawRecord({ path: "b.md", sha: SHA_A }),
    });
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "the work it would push carries 2 forbidden-identifier hit(s) (forbidden-word-ci) in a.md, b.md, and the destination is public — nothing was pushed",
    );
  });
});

describe("salvageScanDecline over the raw metadata walk", () => {
  it("scans a SECRET once per object, however many paths write it", () => {
    const edges = scripted({
      blobs: [{ content: `token=${TOKEN}\n`, path: "a.env", sha: SHA_A }],
      metadata: rawRecord({ path: "a.env", sha: SHA_A }) + rawRecord({ path: "b.env", sha: SHA_A }),
    });
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "the work it would push carries 1 secret-class line(s) (github-oauth-token) in a.env — nothing was pushed",
    );
  });

  it("declines a walk it cannot parse without quoting it, since a partial map would leave a copy unjudged", () => {
    const edges = scripted({ blobs: [{ content: "clean", path: "a.md", sha: SHA_A }], metadata: `${ORG}/a.md\u0000` });
    const line = salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF });
    expect(line).toBe("the paths it would push were in a git listing the scan could not read — nothing was pushed");
  });

  it("declines a secret first when a push carries both", () => {
    const edges = scripted({ blobs: [{ content: `${ORG} ${TOKEN}`, path: "both.md", sha: SHA_A }] });
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "the work it would push carries 1 secret-class line(s) (github-oauth-token) in both.md — nothing was pushed",
    );
  });
});

/**
 * Scripted edges whose listing names nothing, as when every blob a range commit writes is one the destination's
 * default branch already reaches, while git can still answer each of them.
 *
 * @param held each blob the destination holds and git answers, by name and content
 * @param metadata what `git log` answers for the changed paths
 * @returns the edges
 */
function destinationHeld({
  held,
  metadata,
}: {
  held: readonly { sha: string; content: string }[];
  metadata: string;
}): SalvageScanEdges {
  return {
    listBlobs: () => "",
    listMetadata: () => metadata,
    readBlobs: ({ shas }) => batchOf({ objects: held.filter((blob) => shas.includes(blob.sha)) }),
  };
}

describe("salvageScanDecline over a blob the destination already holds", () => {
  it("declines a forbidden word at the new path a range commit writes it at, though the listing omits it", () => {
    const edges = destinationHeld({
      held: [{ content: `notes for ${ORG}\n`, sha: SHA_B }],
      metadata: rawRecord({ path: "docs/n.md", sha: SHA_B }),
    });
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "the work it would push carries 1 forbidden-identifier hit(s) (forbidden-word-ci) in docs/n.md, and the destination is public — nothing was pushed",
    );
  });

  it("declines when git cannot answer that blob, since a written path it could not read went unjudged", () => {
    const edges = destinationHeld({ held: [], metadata: rawRecord({ path: "docs/n.md", sha: SHA_B }) });
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "git did not answer every object the push would send, so they went unscanned — nothing was pushed",
    );
  });

  it("declines when git answers that blob's name with an object of another kind, whose bytes are not the blob's", () => {
    const edges: SalvageScanEdges = {
      listBlobs: () => "",
      listMetadata: () => rawRecord({ path: "docs/n.md", sha: SHA_B }),
      readBlobs: () => Buffer.from(`${SHA_B} tree 0\n\n`),
    };
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "git did not answer every object the push would send, so they went unscanned — nothing was pushed",
    );
  });

  it("declines when git answers that blob's name twice, so a clean second copy cannot hide a forbidden first", () => {
    const edges: SalvageScanEdges = {
      listBlobs: () => "",
      listMetadata: () => rawRecord({ path: "docs/n.md", sha: SHA_B }),
      readBlobs: () =>
        batchOf({
          objects: [
            { content: `notes for ${ORG}\n`, sha: SHA_B },
            { content: "ok", sha: SHA_B },
          ],
        }),
    };
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "git did not answer every object the push would send, so they went unscanned — nothing was pushed",
    );
  });

  it("declines a LISTED blob answered as another kind the same way", () => {
    const edges: SalvageScanEdges = {
      listBlobs: () => `${SHA_A} a.md`,
      listMetadata: () => "",
      readBlobs: () => Buffer.from(`${SHA_A} commit 0\n\n`),
    };
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "git did not answer every object the push would send, so they went unscanned — nothing was pushed",
    );
  });

  it("judges its identifiers only, never a secret, whose bytes the destination already publishes", () => {
    const edges = destinationHeld({
      held: [{ content: `token=${TOKEN}\n`, sha: SHA_B }],
      metadata: rawRecord({ path: "docs/n.env", sha: SHA_B }),
    });
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      null,
    );
    expect(
      salvageScanDecline({
        denylist: { kind: "absent" },
        edges: scripted({ blobs: [{ content: `token=${TOKEN}\n`, path: "docs/n.env", sha: SHA_B }] }),
        identifiers: IDENTIFIERS,
        refName: REF,
      }),
    ).toBe(
      "the work it would push carries 1 secret-class line(s) (github-oauth-token) in docs/n.env — nothing was pushed",
    );
  });

  it("reads every batch of them, finding a forbidden word past the first two hundred", () => {
    const held = Array.from({ length: 450 }, (_, index) => ({
      content: index === 430 ? `notes for ${ORG}\n` : `const n = ${String(index)};`,
      sha: index.toString(16).padStart(40, "0"),
    }));
    const edges = destinationHeld({
      held,
      metadata: held.map(({ sha }, index) => rawRecord({ path: `f${String(index)}.md`, sha })).join(""),
    });
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "the work it would push carries 1 forbidden-identifier hit(s) (forbidden-word-ci) in f430.md, and the destination is public — nothing was pushed",
    );
  });

  it("does not judge a LISTED blob twice, counting one hit per path written", () => {
    const edges = scripted({
      blobs: [{ content: `notes for ${ORG}\n`, path: "a.md", sha: SHA_A }],
      metadata: rawRecord({ path: "a.md", sha: SHA_A }),
    });
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "the work it would push carries 1 forbidden-identifier hit(s) (forbidden-word-ci) in a.md, and the destination is public — nothing was pushed",
    );
  });
});

describe("salvageScanDecline's secret precedence over a held blob", () => {
  it("declines a listed secret first when a held blob carries a forbidden word", () => {
    const blobs = [
      { content: `token=${TOKEN}\n`, sha: SHA_A },
      { content: `notes for ${ORG}\n`, sha: SHA_B },
    ];
    const edges: SalvageScanEdges = {
      listBlobs: () => `${SHA_A} a.env`,
      listMetadata: () => rawRecord({ path: "a.env", sha: SHA_A }) + rawRecord({ path: "docs/n.md", sha: SHA_B }),
      readBlobs: ({ shas }) => batchOf({ objects: blobs.filter((blob) => shas.includes(blob.sha)) }),
    };
    expect(salvageScanDecline({ denylist: { kind: "absent" }, edges, identifiers: IDENTIFIERS, refName: REF })).toBe(
      "the work it would push carries 1 secret-class line(s) (github-oauth-token) in a.env — nothing was pushed",
    );
  });
});
