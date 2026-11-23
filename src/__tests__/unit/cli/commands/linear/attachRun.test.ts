/**
 * `linear attach upload` — the verb that puts a local image in front of a colleague on Linear.
 *
 * The cases below pin the three properties that make this verb worth having rather than a wrapper: the dry
 * run performs NO effect at all, a refused PUT never prints an asset URL, and the report hands back a
 * `media` block rather than rendered markdown, so the one renderer stays the one renderer.
 *
 * They also pin the finding this verb shipped from, because it is the kind that quietly rots: the upload
 * needs no browser session, only the same Linear API key every other verb on the noun uses. There is no
 * cookie dep in the bag below, and that absence is the assertion.
 *
 * Every edge is a plain injected function. No mocks.
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterAll, describe, expect, it } from "vitest";

import { parseLinearAttachArgs, uploadedMediaBlock } from "../../../../../cli/commands/linear/attachCore.js";
import type { LinearAttachDeps } from "../../../../../cli/commands/linear/attachDeps.js";
import { runLinearAttach } from "../../../../../cli/commands/linear/attachRun.js";
import { linearVerbErrorLines } from "../../../../../cli/commands/linear/errors.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { LinearAssetWriteApi, ReservedUpload } from "../../../../../corpus/linear/writeAssets.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { ok, type Result, unwrap } from "../../../../../lib/result.js";
import type { LinearAttachError } from "../../../../../outbound/linear/attach.errors.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../../../../linearWritePrivacyFixture.js";

/** Every scratch directory this file mints, removed in `afterAll` — see `.claude/rules/testing.md`. */
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-linear-attach-"));
  dirs.push(dir);
  return dir;
}

const RESERVATION: ReservedUpload = {
  assetUrl: "https://uploads.linear.test/ws/asset/1",
  contentType: "image/png",
  headers: [{ key: "Content-Type", value: "image/png" }],
  uploadUrl: "https://bucket.linear.test/put?sig=1",
};

/** A real 1x1 PNG's leading bytes — enough that the invented-visual gate reads a picture, not a page. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function ingestError({ message }: { message: string }): IngestError {
  return { kind: "http", message, operation: "linear.fileUpload", provider: "linear" };
}

function harness({
  reserve,
  putStatus = 200,
  bytes = PNG_BYTES,
  reservation = RESERVATION,
}: {
  reserve?: "ok" | "fail";
  putStatus?: number;
  bytes?: Uint8Array;
  reservation?: ReservedUpload;
}): {
  deps: LinearAttachDeps;
  calls: string[];
  out: string[];
  err: string[];
} {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const api: LinearAssetWriteApi = {
    readAllowedUploadTypes: () => okAsync(["image/png"]),
    reserveUpload: ({ contentType, fileName, byteLength }) => {
      calls.push(`reserve:${fileName}:${contentType}:${String(byteLength)}`);
      return reserve === "fail" ? errAsync(ingestError({ message: "over the limit" })) : okAsync(reservation);
    },
  };
  const readFileBytes = (): Result<Uint8Array, LinearAttachError> => ok(bytes);
  return {
    calls,
    deps: {
      doorLedger: memoryDoorLedger().port,
      err: (line) => err.push(line),
      fileSize: () => ok(PNG_BYTES.length),
      listSiblings: () => [],
      makeApi: () => api,
      out: (line) => out.push(line),
      privacy: () => NO_TERMS_LINEAR_PRIVACY,
      putFetch: ({ url }) => {
        calls.push(`put:${url}`);
        return Promise.resolve({ status: putStatus });
      },
      readFileBytes,
      resolveToken: () => "lin_api_fake",
    },
    err,
    out,
  };
}

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "linear", "attach", ...rest];
}

/** A real file on disk, so the classifier and the gate both see the same path a caller would give. */
function pngOnDisk(): string {
  const path = join(tempDir(), "probe.png");
  writeFileSync(path, PNG_BYTES);
  return path;
}

describe("parsing", () => {
  it("requires a sub-verb rather than treating a bare path as an upload", () => {
    const parsed = parseLinearAttachArgs({ rest: ["--file", "x.png"] });

    expect(parsed.isErr()).toBe(true);
    expect(linearVerbErrorLines({ error: parsed._unsafeUnwrapErr() })).toStrictEqual([
      "a sub-verb is required: upload",
    ]);
  });

  it("names an unknown sub-verb rather than ignoring it", () => {
    const parsed = parseLinearAttachArgs({ rest: ["status"] });

    expect(parsed.isErr()).toBe(true);
    expect(linearVerbErrorLines({ error: parsed._unsafeUnwrapErr() })).toStrictEqual([
      "unknown sub-verb status — expected upload",
    ]);
  });

  it("requires --file", () => {
    const parsed = parseLinearAttachArgs({ rest: ["upload"] });

    expect(parsed.isErr()).toBe(true);
    expect(linearVerbErrorLines({ error: parsed._unsafeUnwrapErr() })).toStrictEqual(["--file <path> is required"]);
  });

  it("refuses a bare --acknowledge, because a marker with no reason waives nothing", () => {
    const parsed = parseLinearAttachArgs({ rest: ["upload", "--file", "a.png", "--acknowledge", "because"] });

    expect(parsed.isErr()).toBe(true);
    expect(linearVerbErrorLines({ error: parsed._unsafeUnwrapErr() })[0]).toContain("at least 4 words");
  });

  it("accepts an acknowledgement that carries a real reason", () => {
    const parsed = parseLinearAttachArgs({
      rest: ["upload", "--file", "a.png", "--acknowledge", "the staging dashboard was down all morning"],
    });

    expect(unwrap(parsed).acknowledge).toBe("the staging dashboard was down all morning");
    expect(unwrap(parsed).file).toBe("a.png");
  });
});

describe("uploadedMediaBlock", () => {
  const asset = { assetUrl: "https://uploads.linear.app/a/shot.png", contentType: "image/png", fileName: "shot.png" };

  it("uses the --alt value when it was passed", () => {
    expect(uploadedMediaBlock({ alt: "the staging dashboard", asset })).toEqual({
      alt: "the staging dashboard",
      kind: "media",
      mime: "image/png",
      url: "https://uploads.linear.app/a/shot.png",
    });
  });

  it("falls to the file's own name, the documented default, when --alt was not passed", () => {
    expect(uploadedMediaBlock({ alt: undefined, asset })).toEqual({
      alt: "shot.png",
      kind: "media",
      mime: "image/png",
      url: "https://uploads.linear.app/a/shot.png",
    });
  });

  it("keeps an explicitly empty --alt rather than treating it as unpassed", () => {
    expect(uploadedMediaBlock({ alt: "", asset }).alt).toBe("");
  });
});

describe("the dry run", () => {
  it("classifies, prints the plan, and performs NO effect — no token, no reservation, no PUT", async () => {
    const h = harness({});

    const code = await runLinearAttach({
      argv: argv({ rest: ["upload", "--file", pngOnDisk(), "--dry-run", "--json"] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls).toStrictEqual([]);
    expect(JSON.parse(h.out[0]!)).toStrictEqual({
      byteLength: 12,
      contentType: "image/png",
      embedsInline: true,
      fileName: "probe.png",
      outcome: "would upload",
    });
  });

  it("says a PDF would render as a link rather than letting an author discover it after posting", async () => {
    const path = join(tempDir(), "report.pdf");
    writeFileSync(path, "%PDF-1.4");
    const h = harness({});

    await runLinearAttach({ argv: argv({ rest: ["upload", "--file", path, "--dry-run"] }), deps: h.deps });

    expect(h.out.some((line) => line.includes("file LINK"))).toBe(true);
  });
});

describe("the live upload", () => {
  it("reserves the slot with the classified size, PUTs to the URL Linear gave, and prints the media block", async () => {
    const path = pngOnDisk();
    const h = harness({});

    const code = await runLinearAttach({
      argv: argv({ rest: ["upload", "--file", path, "--alt", "the panel", "--home", tempDir()] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls).toStrictEqual(["reserve:probe.png:image/png:12", "put:https://bucket.linear.test/put?sig=1"]);
    expect(h.out[1]).toBe("https://uploads.linear.test/ws/asset/1");
    expect(JSON.parse(h.out[2]!.replace("media block: ", ""))).toStrictEqual({
      alt: "the panel",
      kind: "media",
      mime: "image/png",
      url: "https://uploads.linear.test/ws/asset/1",
    });
  });

  it("defaults the alt text to the file's own name", async () => {
    const path = pngOnDisk();
    const h = harness({});

    await runLinearAttach({
      argv: argv({ rest: ["upload", "--file", path, "--json", "--home", tempDir()] }),
      deps: h.deps,
    });

    expect(JSON.parse(h.out[0]!).mediaBlock.alt).toBe("probe.png");
  });

  it("prints NO asset URL when the bucket refused the PUT — the URL exists and has no bytes behind it", async () => {
    const path = pngOnDisk();
    const h = harness({ putStatus: 403 });

    const code = await runLinearAttach({
      argv: argv({ rest: ["upload", "--file", path, "--home", tempDir()] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.out).toStrictEqual([]);
    expect(h.err[0]).toContain("Do not embed it");
  });

  it("refuses a file whose bytes carry a dead Datadog host, before a slot is reserved", async () => {
    const path = pngOnDisk();
    const h = harness({ bytes: new TextEncoder().encode("see https://app.ap1.datadoghq.com/monitors/1") });

    const code = await runLinearAttach({
      argv: argv({ rest: ["upload", "--file", path, "--home", tempDir()] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.calls).toStrictEqual([]);
    expect(h.err.join("\n")).toContain("use ap1.datadoghq.com — found at file");
  });

  it("refuses a reservation Linear hands back carrying a dead Datadog host, before the PUT", async () => {
    const path = pngOnDisk();
    const h = harness({
      reservation: { ...RESERVATION, uploadUrl: "https://bucket.linear.test/put?next=https://app.ap1.datadoghq.com/" },
    });

    const code = await runLinearAttach({
      argv: argv({ rest: ["upload", "--file", path, "--home", tempDir()] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.calls).toStrictEqual(["reserve:probe.png:image/png:12"]);
    expect(h.err.join("\n")).toContain("use ap1.datadoghq.com — found at uploadUrl");
  });

  it("reports Linear's own refusal when the reservation itself was declined", async () => {
    const path = pngOnDisk();
    const h = harness({ reserve: "fail" });

    const code = await runLinearAttach({
      argv: argv({ rest: ["upload", "--file", path, "--home", tempDir()] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.calls).toStrictEqual(["reserve:probe.png:image/png:12"]);
    expect(h.err[0]).toContain("over the limit");
  });

  it("refuses an unsupported extension before it resolves a token or touches the network", async () => {
    const path = join(tempDir(), "diagram.svg");
    writeFileSync(path, "<svg/>");
    const h = harness({});

    const code = await runLinearAttach({
      argv: argv({ rest: ["upload", "--file", path, "--home", tempDir()] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.calls).toStrictEqual([]);
    expect(h.err[0]).toContain(".svg is not a content type this door uploads");
  });
});
