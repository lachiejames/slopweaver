import { describe, expect, it } from "vitest";

import type { BlockFileResolution } from "../../../../live/slack/blockFiles.js";
import {
  DEFAULT_MAX_FILE_BYTES,
  describeScopePreflight,
  describeSkips,
  type FilePlan,
  planFile,
  planThreadFiles,
  scopePreflight,
  THREAD_FILE_SCOPES,
} from "../../../../live/slack/filePlan.js";
import type { VisibleSlackFile, VisibleSlackMessage } from "../../../../live/slack/types.js";

const URL = "https://files.slack.com/files-pri/T1-F1/download/x";

/** A thread whose Block Kit references were never looked up — the reconciliation backstop's input. */
const NO_BLOCK_FILES: BlockFileResolution = { resolved: [], unresolved: [] };

function fileOf({ overrides }: { overrides: Partial<VisibleSlackFile> }): VisibleSlackFile {
  return { id: "F0BKXLKV0QJ", isExternal: false, mimetype: "image/png", urlPrivateDownload: URL, ...overrides };
}

function plan({ file }: { file: VisibleSlackFile }) {
  return planFile({ file, maxBytes: DEFAULT_MAX_FILE_BYTES, messageTs: "1.000001" });
}

describe("planFile", () => {
  it("downloads a PNG, naming it from the FILE ID rather than Slack's name", () => {
    const planned = plan({ file: fileOf({ overrides: { name: "diagram.png" } }) });

    expect("url" in planned).toBe(true);
    expect(planned).toMatchObject({ filename: "F0BKXLKV0QJ.png", url: URL });
  });

  it("never lets a traversal-shaped remote name reach the filename", () => {
    const planned = plan({ file: fileOf({ overrides: { name: "../../secrets/slack-user-token" } }) });

    // The remote name survives as METADATA (it is what the human called the file); what must never
    // happen is it becoming a path component.
    expect(planned).toMatchObject({ filename: "F0BKXLKV0QJ.png" });
    expect("url" in planned ? planned.filename : "").not.toContain("/");
    expect(planned.file.name).toBe("../../secrets/slack-user-token");
  });

  it("downloads PDFs and markdown", () => {
    const pdf = plan({ file: fileOf({ overrides: { mimetype: "application/pdf" } }) });
    const md = plan({ file: fileOf({ overrides: { mimetype: "text/markdown" } }) });

    expect(pdf).toMatchObject({ filename: "F0BKXLKV0QJ.pdf" });
    expect(md).toMatchObject({ filename: "F0BKXLKV0QJ.md" });
  });

  it("downloads an unlisted text/* subtype as .txt", () => {
    const planned = plan({ file: fileOf({ overrides: { mimetype: "text/x-python" } }) });

    expect(planned).toMatchObject({ filename: "F0BKXLKV0QJ.txt" });
  });

  it("skips a video, because the model cannot read it", () => {
    const planned = plan({ file: fileOf({ overrides: { mimetype: "video/mp4", size: 213_000_000 } }) });

    expect(planned).toMatchObject({ reason: "not-model-readable" });
  });

  it("skips a Slack canvas instead of attempting a download that returns an HTML page", () => {
    // MEASURED on a real thread: a canvas carries a url_private_download like any other file, but the
    // fetch returns a 200 HTML sign-in page. Attempting it tripped the HTML guard and failed the WHOLE
    // thread read — the user got nothing for a thread whose other six attachments were fine.
    const canvas = fileOf({ overrides: { mimetype: "application/vnd.slack-docs", name: "Project notes" } });

    expect(plan({ file: canvas })).toMatchObject({ reason: "canvas-not-downloadable" });
  });

  it("reports a DELETED file as deleted, not as an unreadable type", () => {
    // MEASURED on a real 311-message thread: 12 attachments came back as {id, mode:"tombstone"} — Slack's
    // marker for a deleted file. They were being reported as "not a type the model can read
    // (video/audio/binary)", which is simply false: there was no video, the files were deleted.
    const tombstone: VisibleSlackFile = { id: "F0B64LMHG5N", isExternal: false, mode: "tombstone" };

    expect(plan({ file: tombstone })).toMatchObject({ reason: "deleted-from-slack" });
    expect(describeSkips({ count: 12, reason: "deleted-from-slack" })).toBe(
      "12 files not retrieved: deleted from Slack, so no bytes exist any more",
    );
  });

  it("skips an externally hosted file, which has no Slack bytes", () => {
    const file = fileOf({ overrides: { externalType: "gdrive", isExternal: true } });

    expect(plan({ file })).toMatchObject({ reason: "external-no-bytes" });
  });

  it("skips a file this token cannot read", () => {
    const planned = plan({ file: fileOf({ overrides: { fileAccess: "access_denied" } }) });

    expect(planned).toMatchObject({ reason: "access-denied" });
  });

  it("skips a file above the size cap", () => {
    const planned = plan({ file: fileOf({ overrides: { size: DEFAULT_MAX_FILE_BYTES + 1 } }) });

    expect(planned).toMatchObject({ reason: "over-size-cap" });
  });

  it("keeps a file exactly at the cap", () => {
    const planned = plan({ file: fileOf({ overrides: { size: DEFAULT_MAX_FILE_BYTES } }) });

    expect("url" in planned).toBe(true);
  });

  it("skips when Slack supplied no download URL", () => {
    const planned = planFile({
      file: { id: "F0BKXLKV0QJ", isExternal: false, mimetype: "image/png" },
      maxBytes: DEFAULT_MAX_FILE_BYTES,
      messageTs: "1.000001",
    });

    expect(planned).toMatchObject({ reason: "no-download-url" });
  });

  it("skips a file whose id is not Slack-shaped, so it can never build a path", () => {
    const planned = plan({ file: fileOf({ overrides: { id: "../etc/passwd" } }) });

    expect(planned).toMatchObject({ reason: "no-download-url" });
  });
});

describe("planThreadFiles", () => {
  it("partitions every attachment across the thread", () => {
    const messages = [
      {
        blockFileRefs: [],
        files: [fileOf({ overrides: {} }), fileOf({ overrides: { id: "F222", mimetype: "video/mp4" } })],
        ts: "1.000001",
      },
      {
        blockFileRefs: [],
        files: [fileOf({ overrides: { id: "F333", mimetype: "application/pdf" } })],
        ts: "1.000002",
      },
    ] as unknown as readonly VisibleSlackMessage[];

    const { downloads, skips } = planThreadFiles({ blockFiles: NO_BLOCK_FILES, messages });

    expect(downloads.length).toBe(2);
    expect(skips.length).toBe(1);
    expect(downloads[1]!.messageTs).toBe("1.000002");
    expect(skips[0]!.reason).toBe("not-model-readable");
  });
});

describe("planThreadFiles — Block Kit file references", () => {
  // MEASURED: a handful of such ids across a corpus of over a hundred thousand real messages, none of them
  // also present in top-level `files`. So
  // this is a genuine second channel for an attachment; before `files.info` was wired, every one of them was
  // reported and none of them retrieved.
  const messages = [
    { blockFileRefs: ["F0ASRB5L69X"], files: [], ts: "1.000001" },
  ] as unknown as readonly VisibleSlackMessage[];

  it("PLANS a resolved reference for download, by exactly the same rules as a top-level attachment", () => {
    const { downloads, skips } = planThreadFiles({
      blockFiles: {
        resolved: [
          {
            file: {
              id: "F0ASRB5L69X",
              isExternal: false,
              mimetype: "image/png",
              urlPrivateDownload: "https://files.slack.com/files-pri/T1-F1/download/x.png",
            },
            messageTs: "1.000001",
          },
        ],
        unresolved: [],
      },
      messages,
    });

    expect(skips).toEqual([]);
    expect(downloads.length).toBe(1);
    expect(downloads[0]!.filename).toBe("F0ASRB5L69X.png");
    expect(downloads[0]!.messageTs).toBe("1.000001");
  });

  it("applies the SIZE CAP to a resolved reference — a block-discovered file is not a special case", () => {
    const { downloads, skips } = planThreadFiles({
      blockFiles: {
        resolved: [
          {
            file: {
              id: "F0ASRB5L69X",
              isExternal: false,
              mimetype: "image/png",
              size: 26 * 1024 * 1024,
              urlPrivateDownload: "https://files.slack.com/files-pri/T1-F1/download/x.png",
            },
            messageTs: "1.000001",
          },
        ],
        unresolved: [],
      },
      messages,
    });

    expect(downloads).toEqual([]);
    expect(skips.length).toBe(1);
    expect(skips[0]!.reason).toBe("over-size-cap");
  });

  it("carries the provider's own words when the lookup failed", () => {
    const { downloads, skips } = planThreadFiles({
      blockFiles: {
        resolved: [],
        unresolved: [
          {
            detail: "files.info on F0ASRB5L69X failed: missing_scope",
            fileId: "F0ASRB5L69X",
            messageTs: "1.000001",
            reason: "block-lookup-failed",
          },
        ],
      },
      messages,
    });

    expect(downloads).toEqual([]);
    expect(skips.length).toBe(1);
    expect(skips[0]!.reason).toBe("block-lookup-failed");
    expect(skips[0]!.detail).toBe("files.info on F0ASRB5L69X failed: missing_scope");
  });

  it("still reports an id that NEITHER lane accounted for, rather than dropping it", () => {
    // The reconciliation backstop. A resolution that silently covered only some ids would otherwise remove
    // the rest from `files`, `skippedFiles` and `limitations` at once.
    const { downloads, skips } = planThreadFiles({ blockFiles: NO_BLOCK_FILES, messages });

    expect(downloads).toEqual([]);
    expect(skips.length).toBe(1);
    expect(skips[0]!.reason).toBe("block-referenced-only");
    expect(skips[0]!.file.id).toBe("F0ASRB5L69X");
  });

  it("keys the lookup by MESSAGE as well as id, so the same image on two messages is reported on both", () => {
    const twice = [
      { blockFileRefs: ["F0ASRB5L69X"], files: [], ts: "1.000001" },
      { blockFileRefs: ["F0ASRB5L69X"], files: [], ts: "1.000002" },
    ] as unknown as readonly VisibleSlackMessage[];
    const file = {
      id: "F0ASRB5L69X",
      isExternal: false,
      mimetype: "image/png",
      urlPrivateDownload: "https://files.slack.com/files-pri/T1-F1/download/x.png",
    };

    const { downloads } = planThreadFiles({
      blockFiles: {
        resolved: [
          { file, messageTs: "1.000001" },
          { file, messageTs: "1.000002" },
        ],
        unresolved: [],
      },
      messages: twice,
    });

    expect(downloads.map((d) => d.messageTs)).toEqual(["1.000001", "1.000002"]);
  });
});

describe("describeSkips", () => {
  it("states the count and the reason", () => {
    expect(describeSkips({ count: 3, reason: "not-model-readable" })).toBe(
      "3 files not retrieved: not a type the model can read (video/audio/binary)",
    );
    expect(describeSkips({ count: 1, reason: "over-size-cap" })).toBe(
      "1 file not retrieved: larger than the per-file size cap",
    );
  });
});

/** A plan with `count` downloads and no skips — the population a scope gap puts at risk. */
function planWithDownloads({ count }: { count: number }): FilePlan {
  return {
    downloads: Array.from({ length: count }, (_unused, index) => ({
      file: fileOf({ overrides: { id: `F0BKXLKV0Q${String(index)}` } }),
      filename: `F0BKXLKV0Q${String(index)}.png`,
      messageTs: "1.000001",
      url: URL,
    })),
    skips: [],
  };
}

describe("scopePreflight", () => {
  it("names files:read as the one scope the attachment lane needs", () => {
    expect(THREAD_FILE_SCOPES).toEqual(["files:read"]);
  });

  it("is sufficient when the granted set holds the file scope", () => {
    const preflight = scopePreflight({
      grantedScopes: ["channels:history", "files:read", "users:read"],
      plan: planWithDownloads({ count: 3 }),
    });

    expect(preflight.verdict).toBe("sufficient");
    expect(preflight.missing).toEqual([]);
    expect(preflight.downloadsAtRisk).toBe(0);
    expect(preflight.granted).toEqual(["channels:history", "files:read", "users:read"]);
  });

  it("is insufficient when the file scope is absent, and counts every download it puts at risk", () => {
    const preflight = scopePreflight({
      grantedScopes: ["channels:history", "users:read"],
      plan: planWithDownloads({ count: 4 }),
    });

    expect(preflight.verdict).toBe("insufficient");
    expect(preflight.missing).toEqual(["files:read"]);
    expect(preflight.downloadsAtRisk).toBe(4);
  });

  it("is UNDETERMINED rather than insufficient when the scope set could not be read", () => {
    const preflight = scopePreflight({ grantedScopes: undefined, plan: planWithDownloads({ count: 2 }) });

    // `null`, not `[]`: "we could not ask" must never be storable as "Slack said none".
    expect(preflight.granted).toBe(null);
    expect(preflight.verdict).toBe("undetermined");
    // No scope is claimed missing on no evidence, and no download is put at risk — the read proceeds.
    expect(preflight.missing).toEqual([]);
    expect(preflight.downloadsAtRisk).toBe(0);
  });

  it("reports an EMPTY granted list as insufficient — that IS an answer from Slack", () => {
    const preflight = scopePreflight({ grantedScopes: [], plan: planWithDownloads({ count: 1 }) });

    expect(preflight.verdict).toBe("insufficient");
    expect(preflight.granted).toEqual([]);
    expect(preflight.missing).toEqual(["files:read"]);
  });
});

describe("describeScopePreflight", () => {
  it("says nothing when the token demonstrably holds the file scope", () => {
    expect(
      describeScopePreflight({
        preflight: { downloadsAtRisk: 0, granted: ["files:read"], missing: [], verdict: "sufficient" },
      }),
    ).toBe(undefined);
  });

  it("states the missing scope, the count lost, and refuses to recommend pasting a manifest", () => {
    const sentence = describeScopePreflight({
      preflight: { downloadsAtRisk: 5, granted: ["users:read"], missing: ["files:read"], verdict: "insufficient" },
    });

    expect(sentence).toContain("missing the Slack scope(s) files:read");
    expect(sentence).toContain("5 attachment(s) were NOT downloaded");
    // A manifest applies WHOLE, so the advice must never be "paste the manifest".
    expect(sentence).toContain("do not paste an app manifest");
  });

  it("says outright that an undetermined scope set was NOT verified", () => {
    const sentence = describeScopePreflight({
      preflight: { downloadsAtRisk: 0, granted: null, missing: [], verdict: "undetermined" },
    });

    expect(sentence).toContain("could not be established");
    expect(sentence).toContain("NOT verified");
  });
});
