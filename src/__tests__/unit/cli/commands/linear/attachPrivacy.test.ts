/**
 * `linear attach upload` under the outbound privacy check: the file's name and text-like bytes are judged before a
 * slot is reserved, and the policy is read again immediately before the PUT, so a terms file that stops loading
 * after the reservation sends no bytes. Every edge is a plain injected function, the policy a real home's file.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import type { LinearAttachDeps } from "../../../../../cli/commands/linear/attachDeps.js";
import { runLinearAttach } from "../../../../../cli/commands/linear/attachRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { LinearAssetWriteApi } from "../../../../../corpus/linear/writeAssets.js";
import { err, ok } from "../../../../../lib/result.js";
import { putReservedAsset } from "../../../../../outbound/linear/assetUpload.js";
import { type LinearWritePrivacy, linearWritePrivacy } from "../../../../../outbound/linear/writePrivacy.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../../../../linearWritePrivacyFixture.js";
import { writePrivateTerms } from "../../../../privateTermsFixture.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "linear-attach-privacy-"));
  dirs.push(dir);
  return dir;
}

const RESERVATION = {
  assetUrl: "https://uploads.linear.test/ws/asset/1",
  contentType: "image/png",
  headers: [{ key: "Content-Type", value: "image/png" }],
  uploadUrl: "https://bucket.linear.test/put?sig=1",
};

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** A real PNG on disk under `name`, so the classifier and the gate see what a caller would give. */
function pngOnDisk({ name }: { name: string }): string {
  const path = join(tempDir(), name);
  writeFileSync(path, PNG_BYTES);
  return path;
}

/** The attach deps around counting fakes, judged under `privacy`. */
function harness({ privacy }: { privacy: (args: { home: string }) => LinearWritePrivacy }): {
  deps: LinearAttachDeps;
  calls: string[];
  errLines: string[];
} {
  const calls: string[] = [];
  const errLines: string[] = [];
  const api: LinearAssetWriteApi = {
    readAllowedUploadTypes: () => okAsync(["image/png"]),
    reserveUpload: ({ fileName }) => {
      calls.push(`reserve:${fileName}`);
      return okAsync(RESERVATION);
    },
  };
  return {
    calls,
    deps: {
      doorLedger: memoryDoorLedger().port,
      err: (line) => errLines.push(line),
      fileSize: () => ok(PNG_BYTES.length),
      listSiblings: () => [],
      makeApi: () => api,
      out: () => undefined,
      privacy,
      putFetch: ({ url }) => {
        calls.push(`put:${url}`);
        return Promise.resolve({ status: 200 });
      },
      readFileBytes: () => ok(PNG_BYTES),
      resolveToken: () => "lin_api_fake",
    },
    errLines,
  };
}

function argv({ path, home }: { path: string; home: string }): readonly string[] {
  return ["node", "slopweaver", "linear", "attach", "upload", "--file", path, "--home", home];
}

describe("linear attach upload under the privacy check", () => {
  it("refuses a file name carrying a private term before a slot is reserved, under the --home it names", async () => {
    const home = tempDir();
    writePrivateTerms({ home, rows: ["person\ti\tquillfeather\tsynthetic"] });
    const h = harness({ privacy: ({ home: given }) => linearWritePrivacy({ home: given }) });

    const code = await runLinearAttach({
      argv: argv({ home, path: pngOnDisk({ name: "quillfeather.png" }) }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.calls).toStrictEqual([]);
    expect(h.errLines.join("\n")).toContain(
      "linear attach upload fileName line 1: a private person term (redacted here)",
    );
    expect(h.errLines.join("\n")).not.toMatch(/quillfeather/iu);
  });

  it("sends no bytes when the policy stops loading after the slot was reserved", async () => {
    let resolved = 0;
    const flaky: LinearWritePrivacy = {
      resolve: async () => {
        resolved += 1;
        return resolved === 1 ? NO_TERMS_LINEAR_PRIVACY.resolve() : err("the private-terms file became unreadable");
      },
    };
    const h = harness({ privacy: () => flaky });

    const code = await runLinearAttach({
      argv: argv({ home: tempDir(), path: pngOnDisk({ name: "probe.png" }) }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.calls).toStrictEqual(["reserve:probe.png"]);
    expect(resolved).toBe(2);
    expect(h.errLines.join("\n")).toContain("the private-terms file became unreadable");
  });

  it("uploads a clean file, judging it twice", async () => {
    let resolved = 0;
    const counting: LinearWritePrivacy = {
      resolve: () => {
        resolved += 1;
        return NO_TERMS_LINEAR_PRIVACY.resolve();
      },
    };
    const h = harness({ privacy: () => counting });

    const code = await runLinearAttach({
      argv: argv({ home: tempDir(), path: pngOnDisk({ name: "probe.png" }) }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls).toStrictEqual(["reserve:probe.png", "put:https://bucket.linear.test/put?sig=1"]);
    expect(resolved).toBe(2);
  });
});

describe("putReservedAsset", () => {
  it("refuses a text-like file that is not valid UTF-8 before the PUT", async () => {
    const sent: string[] = [];
    const refused = await putReservedAsset({
      bytes: new Uint8Array([0xff, 0xfe, 0x00]),
      classified: { byteLength: 3, contentType: "text/plain", fileName: "notes.txt" },
      fetchImpl: ({ url }) => {
        sent.push(url);
        return Promise.resolve({ status: 200 });
      },
      privacy: NO_TERMS_LINEAR_PRIVACY,
      reservation: RESERVATION,
    });

    expect(refused._unsafeUnwrapErr().code).toBe("PRIVACY_REFUSED");
    expect(refused._unsafeUnwrapErr().message).toContain("a text-like file that is not valid UTF-8");
    expect(sent).toStrictEqual([]);
  });
});
