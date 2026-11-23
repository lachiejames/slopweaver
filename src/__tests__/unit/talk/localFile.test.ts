/**
 * The read edge of `talk file`, over a throwaway home: a page reads, a symlink into a credential store is
 * refused on where it resolves, a non-file is refused without blocking, and a window cuts on a line break.
 */
import { execFileSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { TalkErrors } from "../../../talk/errors.js";
import {
  type LocalEntry,
  type LocalRead,
  type LocalReadPolicy,
  listLocalDir,
  readLocalFile,
} from "../../../talk/localFile.js";
import { LocalFileErrors } from "../../../talk/localFileErrors.js";
import { IMAGE_MAX_BYTES } from "../../../talk/localImage.js";
import { credentialStores } from "../../../talk/localPath.js";
import { PAGE_OUTLINE_MAX_BYTES } from "../../../talk/pageOutline.js";

/** A PNG's signature and the start of its header chunk, NUL bytes and all. */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

/** A JPEG's start-of-image and an APP0 marker. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

/** A WebP's RIFF header. */
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38]);

/**
 * Read a file and return its text window, throwing when it came back a picture or a failure — `unwrap` for the
 * text arm.
 *
 * @param input exactly what `readLocalFile` takes
 * @returns the text window
 */
function textRead(input: Parameters<typeof readLocalFile>[0]): LocalRead {
  const read = unwrap(readLocalFile(input));
  if (read.kind !== "text") {
    throw new Error(`expected a text window, got a ${read.mediaType} picture`);
  }
  return read;
}

let home = "";
let policy: LocalReadPolicy;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "talk-file-")));
  const slopweaverHome = join(home, ".slopweaver");
  mkdirSync(join(slopweaverHome, "pages", "voice"), { recursive: true });
  mkdirSync(join(slopweaverHome, "secrets"), { recursive: true });
  writeFileSync(join(slopweaverHome, "pages", "voice", "index.html"), "<h1>one</h1>\n<p>two</p>\n<p>three</p>\n");
  writeFileSync(join(slopweaverHome, "secrets", "slack-token"), "not-a-real-token\n");
  policy = {
    denylist: [],
    homeDir: home,
    protectedPaths: [],
    refusalsLifted: false,
    stores: credentialStores({ homeDir: home, homeEntries: [], slopweaverHomes: [slopweaverHome] }),
  };
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("readLocalFile", () => {
  it("reads a published page by ~/ path, whole", () => {
    const read = textRead({ budget: 4096, from: 0, policy, raw: "~/.slopweaver/pages/voice/index.html" });
    expect(read.text).toBe("<h1>one</h1>\n<p>two</p>\n<p>three</p>\n");
    expect(read.window).toEqual({ end: 37, nextFrom: null, start: 0, truncated: false });
    expect(read.redactions).toEqual([]);
  });

  it("cuts a truncated window after its last line break and offers where to continue", () => {
    const first = textRead({ budget: 20, from: 0, policy, raw: "~/.slopweaver/pages/voice/index.html" });
    expect(first.text).toBe("<h1>one</h1>\n");
    expect(first.window).toEqual({ end: 13, nextFrom: 13, start: 0, truncated: true });
    const next = textRead({ budget: 4096, from: 13, policy, raw: "~/.slopweaver/pages/voice/index.html" });
    expect(next.text).toBe("<p>two</p>\n<p>three</p>\n");
  });

  it("refuses a symlink whose target is in a credential store, and the store itself", () => {
    symlinkSync(join(home, ".slopweaver", "secrets", "slack-token"), join(home, "innocent.txt"));
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 0, policy, raw: "~/innocent.txt" }))).toEqual(
      LocalFileErrors.refused({ path: join(home, "innocent.txt"), rule: "credential-store" }),
    );
    expect(
      unwrapErr(readLocalFile({ budget: 4096, from: 0, policy, raw: "~/.slopweaver/secrets/slack-token" })).code,
    ).toBe("PATH_REFUSED");
  });

  it("refuses a store file and lists it refused when the store is known only by another spelling", () => {
    symlinkSync(join(home, ".slopweaver"), join(home, "second-spelling"));
    const aliased = {
      ...policy,
      stores: credentialStores({ homeDir: home, homeEntries: [], slopweaverHomes: [join(home, "second-spelling")] }),
    };
    const secret = join(home, ".slopweaver", "secrets", "slack-token");
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 0, policy: aliased, raw: secret }))).toEqual(
      LocalFileErrors.refused({ path: secret, rule: "credential-store" }),
    );
    const listing = unwrap(listLocalDir({ limit: 10, policy: aliased, raw: "~/.slopweaver" }));
    expect(listing.entries.find((entry) => entry.name === "secrets")!.refused).toBe(true);
  });

  it("refuses a copy beside a store, and a symlink to one", () => {
    writeFileSync(join(home, ".slopweaver", "secrets.old"), "not-a-real-token\n");
    symlinkSync(join(home, ".slopweaver", "secrets.old"), join(home, "notes.md"));
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 0, policy, raw: "~/notes.md" }))).toEqual(
      LocalFileErrors.refused({ path: join(home, "notes.md"), rule: "credential-store" }),
    );
    const listing = unwrap(listLocalDir({ limit: 10, policy, raw: "~/.slopweaver" }));
    expect(listing.entries.find((entry) => entry.name === "secrets.old")!.refused).toBe(true);
  });

  it("masks a token a window opens inside, whether the offset was chosen or a long line was cut", () => {
    const token = `${["gh", "p_"].join("")}${"A1".repeat(18)}`;
    writeFileSync(join(home, "notes.txt"), `gh ${token} done\n`);
    const opened = textRead({ budget: 4096, from: 16, policy, raw: "~/notes.txt" });
    expect(opened.text).toBe("[redacted:github-token] done\n");
    writeFileSync(join(home, "line.txt"), `${"x".repeat(20)} ${token} done`);
    const cut = textRead({ budget: 30, from: 0, policy, raw: "~/line.txt" });
    expect(cut.text).toBe(`${"x".repeat(20)} [redacted:github-token]`);
    const rest = textRead({ budget: 4096, from: cut.window.nextFrom!, policy, raw: "~/line.txt" });
    expect(rest.text).toBe("[redacted:github-token] done");
  });

  it("carries a page's outline on every window of it, the continuation's the same as the first's", () => {
    const first = textRead({ budget: 20, from: 0, policy, raw: "~/.slopweaver/pages/voice/index.html" });
    const next = textRead({ budget: 4096, from: 13, policy, raw: "~/.slopweaver/pages/voice/index.html" });
    expect(first.outline).toEqual([{ from: 0, level: 1, text: "one" }]);
    expect(next.outline).toEqual(first.outline);
  });

  it("outlines a .htm or .HTML page, and never the same markup in a .txt", () => {
    const markup = "<p>x</p>\n<h2>Options</h2>\n";
    writeFileSync(join(home, "page.HTM"), markup);
    writeFileSync(join(home, "page.HTML"), markup);
    writeFileSync(join(home, "page.txt"), markup);
    const outline = [{ from: 9, level: 2, text: "Options" }];
    expect(textRead({ budget: 4096, from: 0, policy, raw: "~/page.HTM" }).outline).toEqual(outline);
    expect(textRead({ budget: 4096, from: 0, policy, raw: "~/page.HTML" }).outline).toEqual(outline);
    expect(textRead({ budget: 4096, from: 0, policy, raw: "~/page.txt" }).outline).toEqual([]);
  });

  it("reads a page past the outline cap as an ordinary window with no outline", () => {
    const big = `<h2>Top</h2>\n${`${".".repeat(99)}\n`.repeat(Math.ceil(PAGE_OUTLINE_MAX_BYTES / 100))}`;
    writeFileSync(join(home, "big.html"), big);
    const read = textRead({ budget: 4096, from: 0, policy, raw: "~/big.html" });
    expect(Buffer.byteLength(big, "utf8")).toBeGreaterThan(PAGE_OUTLINE_MAX_BYTES);
    expect(read.outline).toEqual([]);
    expect(read.text.startsWith("<h2>Top</h2>\n")).toBe(true);
    expect(read.window.truncated).toBe(true);
  });

  it("masks a credential in a heading of the outline and keeps the headings around it", () => {
    const token = `${["gh", "p_"].join("")}${"A1".repeat(18)}`;
    writeFileSync(join(home, "leak.html"), `<h2>Plain</h2>\n<h2>key ${token}</h2>\n<p>body</p>\n`);
    const read = textRead({ budget: 10, from: 0, policy, raw: "~/leak.html" });
    expect(read.outline).toEqual([
      { from: 0, level: 2, text: "Plain" },
      { from: 15, level: 2, text: "key [redacted:github-token]" },
    ]);
    expect(read.redactions).toEqual([]);
  });

  it("masks a denylisted secret longer than a heading's cut whole, never leaving its prefix", () => {
    // Cut before masking, the first 80 of these 100 characters went out as the heading.
    const secret = "q".repeat(100);
    writeFileSync(join(home, "long.html"), `<h1>key ${secret}</h1><p>body</p>\n`);
    const read = textRead({ budget: 10, from: 0, policy: { ...policy, denylist: [secret] }, raw: "~/long.html" });
    expect(read.outline).toEqual([{ from: 0, level: 1, text: "key [redacted:denylist]" }]);
  });

  it("masks a denylisted secret spelled with markup before the markup is stripped, never leaving its prefix", () => {
    // Masked only after `<b>` was stripped, `q…qrest` matched nothing and the cut sent
    // the secret's first 80 characters out as the heading.
    const secret = `${"q".repeat(80)}<b>rest`;
    writeFileSync(join(home, "marked.html"), `<h1>${secret}</h1><p>body</p>\n`);
    const read = textRead({ budget: 10, from: 0, policy: { ...policy, denylist: [secret] }, raw: "~/marked.html" });
    expect(read.outline).toEqual([{ from: 0, level: 1, text: "[redacted:denylist]" }]);
  });

  it("masks a denylisted secret running on past the heading's own closing tag, as the window does", () => {
    // Masked on its own, the heading held only the secret's first 100 characters, which
    // matched nothing, and the cut sent 80 of them out.
    const secret = `${"q".repeat(100)}</h1>`;
    writeFileSync(join(home, "runs-on.html"), `<h1>${secret}<p>body</p>\n`);
    const read = textRead({ budget: 4096, from: 0, policy: { ...policy, denylist: [secret] }, raw: "~/runs-on.html" });
    expect(read.text).toBe("<h1>[redacted:denylist]<p>body</p>\n");
    expect(read.outline).toEqual([{ from: 0, level: 1, text: "[redacted:denylist]" }]);
  });

  it("refuses a hard link to a file in a credential store, which no path comparison sees", () => {
    linkSync(join(home, ".slopweaver", "secrets", "slack-token"), join(home, "linked.txt"));
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 0, policy, raw: "~/linked.txt" }))).toEqual(
      LocalFileErrors.refused({ path: join(home, "linked.txt"), rule: "credential-link" }),
    );
  });

  it("refuses a Codex login under a second Codex home, and a hard link to one", () => {
    mkdirSync(join(home, ".codex-four"));
    writeFileSync(join(home, ".codex-four", "auth.json"), "{}\n");
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 0, policy, raw: "~/.codex-four/auth.json" })).code).toBe(
      "PATH_REFUSED",
    );
    linkSync(join(home, ".codex-four", "auth.json"), join(home, "linked.json"));
    const withLogins = {
      ...policy,
      stores: credentialStores({ homeDir: home, homeEntries: [".codex-four"], slopweaverHomes: [] }),
    };
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 0, policy: withLogins, raw: "~/linked.json" }))).toEqual(
      LocalFileErrors.refused({ path: join(home, "linked.json"), rule: "credential-link" }),
    );
  });

  it("reads a refused path once the hatch lifts the refusal", () => {
    const lifted = { ...policy, refusalsLifted: true };
    const read = textRead({ budget: 4096, from: 0, policy: lifted, raw: "~/.slopweaver/secrets/slack-token" });
    expect(read.text).toBe("not-a-real-token\n");
  });

  it("refuses a directory, a named pipe and a device without blocking", () => {
    const fifo = join(home, "pipe");
    execFileSync("mkfifo", [fifo]);
    const kinds = [home, fifo, "/dev/zero"].map(
      (raw) => unwrapErr(readLocalFile({ budget: 64, from: 0, policy, raw })).code,
    );
    expect(kinds).toEqual(["NOT_READABLE_KIND", "NOT_READABLE_KIND", "NOT_READABLE_KIND"]);
  });

  it("refuses a binary file and names a missing one", () => {
    writeFileSync(join(home, "blob.bin"), Buffer.from([0x41, 0x00, 0x42]));
    const binary = unwrapErr(readLocalFile({ budget: 64, from: 0, policy, raw: "~/blob.bin" }));
    expect(binary).toEqual(LocalFileErrors.binary({ path: join(home, "blob.bin"), size: 3 }));
    expect(binary.message).toBe(
      `${join(home, "blob.bin")} is binary (3 bytes) and not a PNG, JPEG or WebP — there is no text or picture in it to read`,
    );
    expect(unwrapErr(readLocalFile({ budget: 64, from: 0, policy, raw: "~/nope.txt" })).message).toContain(
      "does not exist",
    );
  });

  it("reads a PNG, a JPEG and a WebP whole as pictures, by their bytes and whatever they are called", () => {
    writeFileSync(join(home, "shot.png"), PNG);
    writeFileSync(join(home, "photo.dat"), JPEG);
    writeFileSync(join(home, "frame.webp"), WEBP);
    const reads = ["~/shot.png", "~/photo.dat", "~/frame.webp"].map((raw) =>
      unwrap(readLocalFile({ budget: 4, from: 0, policy, raw })),
    );
    expect(reads).toEqual([
      {
        base64: PNG.toString("base64"),
        kind: "image",
        mediaType: "image/png",
        path: join(home, "shot.png"),
        resolvedPath: join(home, "shot.png"),
        size: PNG.length,
      },
      {
        base64: JPEG.toString("base64"),
        kind: "image",
        mediaType: "image/jpeg",
        path: join(home, "photo.dat"),
        resolvedPath: join(home, "photo.dat"),
        size: JPEG.length,
      },
      {
        base64: WEBP.toString("base64"),
        kind: "image",
        mediaType: "image/webp",
        path: join(home, "frame.webp"),
        resolvedPath: join(home, "frame.webp"),
        size: WEBP.length,
      },
    ]);
  });

  it("refuses a picture asked for from an offset, and a file only named like a picture stays binary", () => {
    writeFileSync(join(home, "shot.png"), PNG);
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 8, policy, raw: "~/shot.png" }))).toEqual(
      LocalFileErrors.imageWindowed({ from: 8, path: join(home, "shot.png") }),
    );
    writeFileSync(join(home, "fake.png"), Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]));
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 0, policy, raw: "~/fake.png" }))).toEqual(
      LocalFileErrors.binary({ path: join(home, "fake.png"), size: 12 }),
    );
  });

  it("judges the window before the picture sniff, so an offset past the end is an invalid window", () => {
    writeFileSync(join(home, "shot.png"), PNG);
    expect(unwrapErr(readLocalFile({ budget: 4096, from: PNG.length + 1, policy, raw: "~/shot.png" }))).toEqual(
      TalkErrors.windowInvalid({ from: PNG.length + 1, size: PNG.length }),
    );
  });

  it("refuses a picture past the cap, naming its size", () => {
    const big = Buffer.alloc(IMAGE_MAX_BYTES + 1);
    PNG.copy(big);
    writeFileSync(join(home, "huge.png"), big);
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 0, policy, raw: "~/huge.png" }))).toEqual(
      LocalFileErrors.imageTooLarge({ max: IMAGE_MAX_BYTES, path: join(home, "huge.png"), size: IMAGE_MAX_BYTES + 1 }),
    );
  });

  it("refuses a picture inside a credential store before it is sniffed", () => {
    writeFileSync(join(home, ".slopweaver", "secrets", "qr.png"), PNG);
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 0, policy, raw: "~/.slopweaver/secrets/qr.png" }))).toEqual(
      LocalFileErrors.refused({ path: join(home, ".slopweaver", "secrets", "qr.png"), rule: "credential-store" }),
    );
  });
});

describe("listLocalDir", () => {
  it("lists one level, sorted, marking a credential store as refused and honouring the limit", () => {
    writeFileSync(join(home, ".env"), "FLAG=1\n");
    const listing = unwrap(listLocalDir({ limit: 10, policy, raw: "~" }));
    const expected: readonly LocalEntry[] = [
      { kind: "file", name: ".env", refused: true, size: 7 },
      { kind: "directory", name: ".slopweaver", refused: false, size: null },
    ];
    expect(listing.entries).toEqual(expected);
    expect(listing.total).toBe(2);
    const capped = unwrap(listLocalDir({ limit: 1, policy, raw: "~" }));
    expect(capped.truncated).toBe(true);
    expect(capped.entries.map((entry) => entry.name)).toEqual([".env"]);
  });

  it("marks a symlink and a hard link into a credential store as refused", () => {
    mkdirSync(join(home, "Downloads"));
    symlinkSync(join(home, ".slopweaver", "secrets", "slack-token"), join(home, "Downloads", "a-link"));
    linkSync(join(home, ".slopweaver", "secrets", "slack-token"), join(home, "Downloads", "b-hard"));
    writeFileSync(join(home, "Downloads", "c-plain.txt"), "plain\n");
    const listing = unwrap(listLocalDir({ limit: 10, policy, raw: "~/Downloads" }));
    expect(listing.entries.map((entry) => [entry.name, entry.refused])).toEqual([
      ["a-link", true],
      ["b-hard", true],
      ["c-plain.txt", false],
    ]);
  });

  it("refuses to list a credential store", () => {
    expect(unwrapErr(listLocalDir({ limit: 10, policy, raw: "~/.slopweaver/secrets" })).code).toBe("PATH_REFUSED");
  });
});
