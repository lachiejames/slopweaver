/*
 * `classifyAttachment`: a file is matched to a media type by its extension and held to that type's measured
 * size ceiling, so an unsupported or oversized file is refused before any network call.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { ATTACHABLE_MEDIA, classifyAttachment } from "../../../../../outbound/github/attachment.js";

describe("classifyAttachment", () => {
  it("classifies a png against the 10 MiB image ceiling", () => {
    const result = classifyAttachment({ byteLength: 913213, fileName: "shot.png" });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).contentType).toBe("image/png");
    expect(unwrap(result).limitBytes).toBe(10485760);
  });

  it("classifies an mp4 against the 100 MiB video ceiling", () => {
    const result = classifyAttachment({ byteLength: 52428800, fileName: "side-by-side.mp4" });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).contentType).toBe("video/mp4");
    expect(unwrap(result).limitBytes).toBe(104857600);
  });

  it("accepts an image of exactly 10,485,760 bytes — the measured ceiling is inclusive", () => {
    const result = classifyAttachment({ byteLength: 10485760, fileName: "shot.png" });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).byteLength).toBe(10485760);
  });

  it("refuses an image one byte over the ceiling, before any network call", () => {
    const result = classifyAttachment({ byteLength: 10485761, fileName: "shot.png" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("FILE_TOO_LARGE");
    expect(unwrapErr(result).message).toContain("10.00 MiB");
  });

  it("accepts a video of exactly 104,857,600 bytes and refuses one byte more", () => {
    expect(classifyAttachment({ byteLength: 104857600, fileName: "clip.mp4" }).isOk()).toBe(true);
    const over = classifyAttachment({ byteLength: 104857601, fileName: "clip.mp4" });
    expect(over.isErr()).toBe(true);
    expect(unwrapErr(over).code).toBe("FILE_TOO_LARGE");
  });

  it("lets a video through at a size that would refuse an image — the two ceilings are distinct", () => {
    expect(classifyAttachment({ byteLength: 26214400, fileName: "clip.mp4" }).isOk()).toBe(true);
    expect(classifyAttachment({ byteLength: 26214400, fileName: "clip.png" }).isErr()).toBe(true);
  });

  it("refuses a media type GitHub's comment box does not take", () => {
    const result = classifyAttachment({ byteLength: 10, fileName: "notes.pdf" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("UNSUPPORTED_MEDIA");
  });

  it("refuses a file with no extension and says so in words", () => {
    const result = classifyAttachment({ byteLength: 10, fileName: "screenshot" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("a file with no extension");
  });

  it("matches an extension case-insensitively", () => {
    const result = classifyAttachment({ byteLength: 10, fileName: "SHOT.PNG" });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).contentType).toBe("image/png");
  });

  it("does not treat a leading dot as an extension", () => {
    const result = classifyAttachment({ byteLength: 10, fileName: ".png" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("UNSUPPORTED_MEDIA");
  });

  it("keeps the RAW file name — GitHub, not this code, decides what an asset is called", () => {
    const result = classifyAttachment({ byteLength: 10, fileName: "fastify-express-side-by-side (1).mp4" });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).fileName).toBe("fastify-express-side-by-side (1).mp4");
  });

  it("pairs every attachable extension with a non-zero ceiling", () => {
    const ceilings = Object.values(ATTACHABLE_MEDIA).map((media) => media.limitBytes);
    expect(ceilings.filter((limit) => limit > 0).length).toBe(ceilings.length);
  });
});
