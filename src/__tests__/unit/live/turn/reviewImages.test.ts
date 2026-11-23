import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exampleImageObservations, reviewImageSectionLines } from "../../../../live/turn/reviewImageSection.js";
import { hasUnavailableImage, resolveReviewPacketImages } from "../../../../live/turn/reviewImages.js";
import { imageDigestOf } from "../../../../visualEvidence/imageIo.js";

/** A real 2x2 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4AWP8z8DwnwEImBigAAAfFwICgH3ifwAAAABJRU5ErkJggg==",
  "base64",
);
/** A second, different real PNG — 3x3. */
const PNG_B = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAYAAABWKLW/AAAAF0lEQVR4AWNkYPj/nwEKmBiQABMDEgAAR1UCBM8FsaoAAAAASUVORK5CYII=",
  "base64",
);

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slopweaver-packet-images-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

const write = ({ name, bytes }: { name: string; bytes: Buffer }): string => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};

describe("resolveReviewPacketImages", () => {
  it("is empty for an answer that attaches nothing", async () => {
    expect(await resolveReviewPacketImages({ paths: [] })).toEqual([]);
  });

  it("reports each picture's real digest and decoded size, in attach order", async () => {
    const first = write({ bytes: PNG, name: "pool.png" });
    const second = write({ bytes: PNG_B, name: "errors.png" });

    expect(await resolveReviewPacketImages({ paths: [first, second] })).toEqual([
      { artifact: { digest: imageDigestOf({ bytes: PNG }), heightPx: 2, widthPx: 2 }, kind: "ready", path: first },
      { artifact: { digest: imageDigestOf({ bytes: PNG_B }), heightPx: 3, widthPx: 3 }, kind: "ready", path: second },
    ]);
  });

  it("keeps a path it could not read as a ROW, never a dropped entry", async () => {
    const missing = join(dir, "never-written.png");

    const resolved = await resolveReviewPacketImages({ paths: [missing] });

    expect(resolved.length).toBe(1);
    expect(resolved[0]!.kind).toBe("unavailable");
    expect(resolved[0]!.path).toBe(missing);
  });

  it("keeps a file that is not an image as a row that says so", async () => {
    const notAnImage = write({ bytes: Buffer.from("plain text, not a PNG"), name: "notes.txt" });

    const resolved = await resolveReviewPacketImages({ paths: [notAnImage] });

    expect(resolved[0]!.kind).toBe("unavailable");
    expect(resolved[0]!.kind === "unavailable" ? resolved[0]!.issues.join(" ") : "").toContain("could not be decoded");
  });

  it("still lists the good attachment beside a bad one", async () => {
    const good = write({ bytes: PNG, name: "pool.png" });

    const resolved = await resolveReviewPacketImages({ paths: [join(dir, "gone.png"), good] });

    expect(resolved.map((image) => image.kind)).toEqual(["unavailable", "ready"]);
    expect(hasUnavailableImage({ images: resolved })).toBe(true);
  });
});

describe("reviewImageSectionLines", () => {
  it("renders nothing when the answer attaches no pictures", async () => {
    expect(reviewImageSectionLines({ images: await resolveReviewPacketImages({ paths: [] }) })).toEqual([]);
  });

  it("prints each picture's path, size and digest, and tells the reviewer to open it", async () => {
    const path = write({ bytes: PNG, name: "pool.png" });
    const images = await resolveReviewPacketImages({ paths: [path] });

    const section = reviewImageSectionLines({ images }).join("\n");

    expect(section).toContain(`- ${path} — 2x2 px, \`${imageDigestOf({ bytes: PNG })}\``);
    expect(section).toContain("OPEN every file listed above");
    expect(section).toContain("could a reader check the claim at the size Slack renders the PREVIEW");
    expect(section).toContain("## 1c. Every attached image — OPEN it, and record what you saw");
  });

  it("says an unreadable attachment is not section 1b's absent screenshot", async () => {
    const images = await resolveReviewPacketImages({ paths: [join(dir, "gone.png")] });

    const section = reviewImageSectionLines({ images }).join("\n");

    expect(section).toContain("COULD NOT BE READ");
    expect(section).toContain("section 1b does");
    expect(section).toContain("return `incomplete`");
  });
});

describe("exampleImageObservations", () => {
  it("is empty when nothing is attached", async () => {
    expect(exampleImageObservations({ images: await resolveReviewPacketImages({ paths: [] }) })).toEqual([]);
  });

  it("gives one entry per readable picture, carrying its real path and digest", async () => {
    const path = write({ bytes: PNG, name: "pool.png" });

    const examples = exampleImageObservations({ images: await resolveReviewPacketImages({ paths: [path] }) });

    expect(examples).toEqual([
      {
        artifactDigest: imageDigestOf({ bytes: PNG }),
        contextRetained: true,
        legible: true,
        observedContent: "REPLACE THIS with what you actually saw after opening the file",
        path,
        targetState: "data",
      },
    ]);
  });

  it("offers no example for a picture the packet could not open", async () => {
    const images = await resolveReviewPacketImages({ paths: [join(dir, "gone.png")] });

    expect(exampleImageObservations({ images })).toEqual([]);
  });
});
