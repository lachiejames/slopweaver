import { describe, expect, it } from "vitest";

import { uploadedFileId } from "../../../../corpus/slack/writeApiUpload.js";

describe("uploadedFileId", () => {
  it("reads the id off a file at the top level", () => {
    expect(uploadedFileId({ result: { files: [{ id: "F_top" }] } })).toBe("F_top");
  });

  it("reads the id off the nested files array the method has also answered with", () => {
    expect(uploadedFileId({ result: { files: [{ files: [{ id: "F_nested" }] }] } })).toBe("F_nested");
  });

  it("answers undefined when neither depth carries an id", () => {
    expect(uploadedFileId({ result: { files: [{ name: "x.png" }, "not-a-record"] } })).toBe(undefined);
    expect(uploadedFileId({ result: { ok: true } })).toBe(undefined);
    expect(uploadedFileId({ result: undefined })).toBe(undefined);
  });
});
