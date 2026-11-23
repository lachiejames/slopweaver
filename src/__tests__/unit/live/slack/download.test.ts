import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { DownloadFile } from "../../../../live/slack/download.js";
import { downloadSlackFile, redirectTarget, streamToFile } from "../../../../live/slack/download.js";
import { SlackFileDownloadErrors } from "../../../../live/slack/downloadErrors.js";
import { downloadThreadFiles } from "../../../../live/slack/fileDownloads.js";
import type { FilePlan, FileScopePreflight } from "../../../../live/slack/filePlan.js";

// register-class: one-item-failure-sinks-the-whole-batch (docs/recurring-failure-register/bindings.md)

/** The one-page fixture with a real text layer. */
const TEXT_SAMPLE = join(import.meta.dirname, "../../../fixtures/pdf/text-sample.pdf");

/** The two-page fixture drawn without a font, so it has no text layer at all. */
const SCANNED_SAMPLE = join(import.meta.dirname, "../../../fixtures/pdf/scanned-sample.pdf");

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-dl-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("downloadSlackFile — credential boundary", () => {
  it("refuses to send the bearer token to a non-Slack host", async () => {
    const result = await downloadSlackFile({
      destinationDir: tempDir(),
      expectedBytes: undefined,
      filename: "F1.png",
      token: "xoxp-secret",
      url: "https://evil.example.com/files-pri/T1-F1/download/x",
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("refusing to send Slack credentials to evil.example.com");
  });

  it("refuses a lookalike host that merely ends in something slack-ish", async () => {
    const result = await downloadSlackFile({
      destinationDir: tempDir(),
      expectedBytes: undefined,
      filename: "F1.png",
      token: "xoxp-secret",
      url: "https://files.slack.com.evil.test/x",
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("refusing to send Slack credentials");
  });

  it("refuses a download URL that is not a URL", async () => {
    const result = await downloadSlackFile({
      destinationDir: tempDir(),
      expectedBytes: undefined,
      filename: "F1.png",
      token: "xoxp-secret",
      url: "not-a-url",
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("is not a URL");
  });
});

/** A one-chunk in-memory body, so the write path is exercised without a network call. */
function bodyOf({ text }: { text: string }): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe("streamToFile — the write boundary", () => {
  it("writes the bytes and returns the count", async () => {
    const path = join(tempDir(), "F1.png");

    const written = await streamToFile({ body: bodyOf({ text: "hello bytes" }), localPath: path });

    expect(written).toBe(11);
    expect(readFileSync(path, "utf8")).toBe("hello bytes");
  });

  it("overwrites a previous download of the same file, so a re-read is idempotent", async () => {
    const path = join(tempDir(), "F1.png");
    writeFileSync(path, "stale and longer than the new content");

    await streamToFile({ body: bodyOf({ text: "fresh" }), localPath: path });

    expect(readFileSync(path, "utf8")).toBe("fresh");
  });

  it("does NOT follow a symlink planted at the destination filename (R3 regression)", async () => {
    // Found by an adversarial review pass. The basename comes from a Slack-controlled file id, and a
    // default open FOLLOWS a symlink — so a pre-placed link redirected the write outside the thread
    // directory and truncated whatever it pointed at. O_NOFOLLOW makes that ELOOP instead.
    const dir = tempDir();
    const outside = join(tempDir(), "outside.txt");
    writeFileSync(outside, "ORIGINAL CONTENTS");
    symlinkSync(outside, join(dir, "FATTACK.txt"));

    await expect(
      streamToFile({ body: bodyOf({ text: "SLACK BYTES" }), localPath: join(dir, "FATTACK.txt") }),
    ).rejects.toThrow(/ELOOP/);
    expect(readFileSync(outside, "utf8")).toBe("ORIGINAL CONTENTS");
  });

  it("cancels an endless body at maxBytes, writing nothing past it", async () => {
    const path = join(tempDir(), "F1.png");
    const events: string[] = [];
    const endless = new ReadableStream<Uint8Array>({
      cancel() {
        events.push("cancelled");
      },
      pull(controller) {
        events.push("pulled");
        controller.enqueue(new Uint8Array(4));
      },
    });

    const received = await streamToFile({ body: endless, localPath: path, maxBytes: 10 });

    expect(received).toBe(12);
    expect(readFileSync(path).length).toBe(8);
    expect(events.at(-1)).toBe("cancelled");
    expect(events.filter((event) => event === "pulled").length).toBeLessThan(6);
  });
});

describe("downloadThreadFiles — directory boundary", () => {
  it("refuses to write through a symlinked thread directory", async () => {
    // O_NOFOLLOW guards the last path component only; a symlinked DIRECTORY would redirect every
    // attachment with no flag able to notice, because `mkdir -p` succeeds against the link target.
    const root = tempDir();
    const elsewhere = tempDir();
    symlinkSync(elsewhere, join(root, "C123-1785114398557099"));

    const plan: FilePlan = {
      downloads: [
        {
          file: { id: "F1", isExternal: false, mimetype: "image/png", urlPrivateDownload: "https://files.slack.com/x" },
          filename: "F1.png",
          messageTs: "1785114398.557099",
          url: "https://files.slack.com/x",
        },
      ],
      skips: [],
    };

    const result = await downloadThreadFiles({
      downloadFile: async () => {
        throw new Error("the downloader must never be reached for a symlinked directory");
      },
      plan,
      preflight: { downloadsAtRisk: 0, granted: ["files:read"], missing: [], verdict: "sufficient" },
      rootDir: root,
      threadKey: "C123-1785114398557099",
      token: "xoxp-secret",
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("is not a real directory");
  });
});

/** A token proven to hold the file scope. */
const SCOPES_OK: FileScopePreflight = {
  downloadsAtRisk: 0,
  granted: ["files:read"],
  missing: [],
  verdict: "sufficient",
};

/** One planned PNG download per id. */
function planFor({ ids }: { ids: readonly string[] }): FilePlan {
  return {
    downloads: ids.map((id) => ({
      file: {
        id,
        isExternal: false,
        mimetype: "image/png",
        name: `${id}.png`,
        urlPrivateDownload: `https://files.slack.com/${id}`,
      },
      filename: `${id}.png`,
      messageTs: "1785114398.557099",
      url: `https://files.slack.com/${id}`,
    })),
    skips: [],
  };
}

describe("downloadThreadFiles — a failed download is reported, never fatal", () => {
  it("keeps every attachment that worked when one in the middle fails", async () => {
    // THE DEFECT THIS FIXES: this used to return `err`, throwing away the whole thread — every message and
    // every other attachment — to report one file Slack would not serve.
    const root = tempDir();
    const attempted: string[] = [];
    const outcome = unwrap(
      await downloadThreadFiles({
        downloadFile: async ({ filename, destinationDir }) => {
          attempted.push(filename);
          if (filename === "F222.png") {
            return err(
              SlackFileDownloadErrors.responseRejected({ filename, reason: "Slack returned HTTP 403 for the file" }),
            );
          }
          const localPath = join(destinationDir, filename);
          writeFileSync(localPath, "bytes");
          return ok({ bytes: 5, localPath });
        },
        plan: planFor({ ids: ["F111", "F222", "F333"] }),
        preflight: SCOPES_OK,
        rootDir: root,
        threadKey: "C123-1785114398557099",
        token: "xoxp-secret",
      }),
    );

    // The loop CONTINUED past the failure — the third file was still attempted and retrieved.
    expect(attempted).toEqual(["F111.png", "F222.png", "F333.png"]);
    expect(outcome.retrieved.map((f) => f.fileId)).toEqual(["F111", "F333"]);
    expect(outcome.unretrievable.length).toBe(1);
    expect(outcome.unretrievable[0]!.fileId).toBe("F222");
    expect(outcome.unretrievable[0]!.reason).toBe("download-failed");
    expect(outcome.unretrievable[0]!.method).toBe("slack.files.download");
    expect(outcome.unretrievable[0]!.detail).toContain("HTTP 403");
  });

  it("names the lost file in `limitations`, so it can never be silently absent", async () => {
    const outcome = unwrap(
      await downloadThreadFiles({
        downloadFile: async () => err(SlackFileDownloadErrors.emptyBody({ filename: "F111.png" })),
        plan: planFor({ ids: ["F111"] }),
        preflight: SCOPES_OK,
        rootDir: tempDir(),
        threadKey: "C123-1785114398557099",
        token: "xoxp-secret",
      }),
    );

    expect(outcome.retrieved).toEqual([]);
    expect(outcome.limitations.join(" ")).toContain("F111.png (F111)");
    expect(outcome.limitations.join(" ")).toContain("Slack returned an empty body");
  });
});

describe("downloadThreadFiles — the scope preflight", () => {
  it("attempts NO download and reports every file as scope-missing when the scope is absent", async () => {
    const outcome = unwrap(
      await downloadThreadFiles({
        downloadFile: async ({ filename }) => {
          throw new Error(`no download must be attempted without files:read, but one was for ${filename}`);
        },
        plan: planFor({ ids: ["F111", "F222"] }),
        preflight: {
          downloadsAtRisk: 2,
          granted: ["users:read"],
          missing: ["files:read"],
          verdict: "insufficient",
        },
        rootDir: tempDir(),
        threadKey: "C123-1785114398557099",
        token: "xoxp-secret",
      }),
    );

    expect(outcome.retrieved).toEqual([]);
    expect(outcome.unretrievable.length).toBe(2);
    expect(outcome.unretrievable[0]!.reason).toBe("scope-missing");
    expect(outcome.unretrievable[0]!.detail).toContain("token lacks files:read");
    expect(outcome.limitations.join(" ")).toContain("not attempted");
  });

  it("proceeds normally when the scope set is merely UNDETERMINED", async () => {
    // A diagnostic call that failed must not stop a thread read. The document says it was unverified.
    const root = tempDir();
    const outcome = unwrap(
      await downloadThreadFiles({
        downloadFile: async ({ filename, destinationDir }) => {
          const localPath = join(destinationDir, filename);
          writeFileSync(localPath, "bytes");
          return ok({ bytes: 5, localPath });
        },
        plan: planFor({ ids: ["F111"] }),
        preflight: { downloadsAtRisk: 0, granted: null, missing: [], verdict: "undetermined" },
        rootDir: root,
        threadKey: "C123-1785114398557099",
        token: "xoxp-secret",
      }),
    );

    expect(outcome.retrieved.length).toBe(1);
    expect(outcome.unretrievable).toEqual([]);
  });
});

/** One planned PDF download per id, so the attachment lane meets a real document. */
function pdfPlanFor({ ids }: { ids: readonly string[] }): FilePlan {
  return {
    downloads: ids.map((id) => ({
      file: {
        id,
        isExternal: false,
        mimetype: "application/pdf",
        name: `${id}.pdf`,
        urlPrivateDownload: `https://files.slack.com/${id}`,
      },
      filename: `${id}.pdf`,
      messageTs: "1785114398.557099",
      url: `https://files.slack.com/${id}`,
    })),
    skips: [],
  };
}

/** A download seam that serves one committed fixture's bytes, whatever id is asked for. */
function servingFixture({ fixture }: { fixture: string }): DownloadFile {
  const bytes = readFileSync(fixture);
  return async ({ filename, destinationDir }) => {
    const localPath = join(destinationDir, filename);
    writeFileSync(localPath, bytes);
    return ok({ bytes: bytes.byteLength, localPath });
  };
}

describe("downloadThreadFiles — a retrieved PDF carries its words, not just its path", () => {
  // THE DEFECT THIS FIXES: measured, a thread read reported a 321,706-byte report as a local
  // path and nothing else, so a session answering from that read had no access to what the report SAID.
  it("extracts the text of a retrieved PDF and reports its page count", async () => {
    const outcome = unwrap(
      await downloadThreadFiles({
        downloadFile: servingFixture({ fixture: TEXT_SAMPLE }),
        plan: pdfPlanFor({ ids: ["F111"] }),
        preflight: SCOPES_OK,
        rootDir: tempDir(),
        threadKey: "C123-1785114398557099",
        token: "xoxp-secret",
      }),
    );

    expect(outcome.retrieved.length).toBe(1);
    expect(outcome.retrieved[0]!.text).toContain("personnel and contractors");
    expect(outcome.retrieved[0]!.pdf).toEqual({ glyphless: false, pages: 1, pagesRead: 1 });
    expect(outcome.limitations).toEqual([]);
  });

  it("says a scanned PDF has no text layer instead of carrying an empty string", async () => {
    const outcome = unwrap(
      await downloadThreadFiles({
        downloadFile: servingFixture({ fixture: SCANNED_SAMPLE }),
        plan: pdfPlanFor({ ids: ["F222"] }),
        preflight: SCOPES_OK,
        rootDir: tempDir(),
        threadKey: "C123-1785114398557099",
        token: "xoxp-secret",
      }),
    );

    expect(outcome.retrieved[0]!.text).toBe(undefined);
    expect(outcome.retrieved[0]!.pdf).toEqual({ glyphless: true, pages: 2, pagesRead: 2 });
  });

  it("leaves a PNG alone — not a PDF is not a limitation", async () => {
    const outcome = unwrap(
      await downloadThreadFiles({
        downloadFile: async ({ filename, destinationDir }) => {
          const localPath = join(destinationDir, filename);
          writeFileSync(localPath, "\u0089PNG\r\n\u001a\nscreenshot");
          return ok({ bytes: 10, localPath });
        },
        plan: planFor({ ids: ["F333"] }),
        preflight: SCOPES_OK,
        rootDir: tempDir(),
        threadKey: "C123-1785114398557099",
        token: "xoxp-secret",
      }),
    );

    expect(outcome.retrieved[0]!.text).toBe(undefined);
    expect(outcome.retrieved[0]!.pdf).toBe(undefined);
    expect(outcome.limitations).toEqual([]);
  });

  it("keeps the file and names the failure when the bytes arrived but could not be read", async () => {
    const outcome = unwrap(
      await downloadThreadFiles({
        // The seam reports a path it never wrote, which is exactly the shape of a download that lied.
        downloadFile: async ({ filename, destinationDir }) =>
          ok({ bytes: 4, localPath: join(destinationDir, `missing-${filename}`) }),
        plan: pdfPlanFor({ ids: ["F444"] }),
        preflight: SCOPES_OK,
        rootDir: tempDir(),
        threadKey: "C123-1785114398557099",
        token: "xoxp-secret",
      }),
    );

    // Retrieved, because the download stage said it succeeded — and the missing words are said out loud.
    expect(outcome.retrieved.length).toBe(1);
    expect(outcome.retrieved[0]!.text).toBe(undefined);
    expect(outcome.unretrievable).toEqual([]);
    expect(outcome.limitations.join(" ")).toContain("F444.pdf: bytes retrieved, text not");
  });
});

describe("redirectTarget", () => {
  const from = new URL("https://files.slack.com/files-pri/T1-F1/download/transcript");

  it("resolves an absolute https Location", () => {
    const response = new Response(null, { headers: { location: "https://cdn.example.com/x" }, status: 302 });
    expect(redirectTarget({ from, response })?.href).toBe("https://cdn.example.com/x");
  });

  it("resolves a RELATIVE Location against the URL that produced it", () => {
    const response = new Response(null, { headers: { location: "/signin" }, status: 302 });
    expect(redirectTarget({ from, response })?.href).toBe("https://files.slack.com/signin");
  });

  it("refuses a downgrade to http, which must never carry the token", () => {
    const response = new Response(null, { headers: { location: "http://files.slack.com/x" }, status: 302 });
    expect(redirectTarget({ from, response })).toBe(undefined);
  });

  it("refuses a 3xx with no Location at all", () => {
    expect(redirectTarget({ from, response: new Response(null, { status: 302 }) })).toBe(undefined);
  });

  it("refuses a non-http scheme, which is the reachable half of the protocol guard", () => {
    // With a base URL almost any string RESOLVES, so "unparseable" is not the real defence here — the
    // https check is. A `data:`/`javascript:` Location parses cleanly and must still be refused.
    const response = new Response(null, { headers: { location: "data:text/html,<h1>hi" }, status: 302 });
    expect(redirectTarget({ from, response })).toBe(undefined);
  });
});
