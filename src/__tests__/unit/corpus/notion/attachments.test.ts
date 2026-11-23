import { describe, expect, it } from "vitest";

import {
  ceilingVerdict,
  classifyAttachment,
  markdownMediaSource,
  totalFromContentRange,
} from "../../../../corpus/notion/attachments.js";

describe("classifyAttachment", () => {
  it("calls a Notion-hosted signed url fetchable", () => {
    const verdict = classifyAttachment({
      src: "https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/def/policy.pdf?X-Amz-Signature=xyz",
    });
    expect(verdict.kind).toBe("hosted");
  });

  it("calls an author's link to another site external, so nothing fetches it", () => {
    expect(classifyAttachment({ src: "https://www.loom.com/share/271f42cc" }).kind).toBe("external");
    expect(classifyAttachment({ src: "https://www.youtube.com/watch?v=6G5V3Mbvmmg" }).kind).toBe("external");
  });

  it("treats a stored reference with no url as nothing to fetch", () => {
    expect(classifyAttachment({ src: "file: The Black Book of Questions (1).pdf" }).kind).toBe("nameOnly");
    expect(classifyAttachment({ src: undefined }).kind).toBe("nameOnly");
    expect(classifyAttachment({ src: "" }).kind).toBe("nameOnly");
  });

  it("matches the host SUFFIX, so a lookalike domain is external and not hosted", () => {
    // A substring test would have called this one Notion's own, and handed a signed-url fetch to an
    // attacker-controlled host. It is the reason the check is on the parsed hostname rather than the string.
    expect(classifyAttachment({ src: "https://notion.so.evil.test/x.pdf" }).kind).toBe("external");
    expect(classifyAttachment({ src: "https://evilnotion.so/x.pdf" }).kind).toBe("external");
    expect(classifyAttachment({ src: "https://files.notion.so/x.pdf" }).kind).toBe("hosted");
  });

  it("refuses a non-http scheme rather than treating it as a url", () => {
    expect(classifyAttachment({ src: "file:///etc/passwd" }).kind).toBe("nameOnly");
    expect(classifyAttachment({ src: "data:text/plain;base64,aGk=" }).kind).toBe("nameOnly");
  });
});

describe("totalFromContentRange", () => {
  it("reads the TOTAL after the slash, not the range before it", () => {
    // The shape a real signed url answered a 1 KiB probe with.
    expect(totalFromContentRange({ header: "bytes 0-1023/272299" })).toBe(272299);
  });

  it("returns undefined when the total is unknown", () => {
    expect(totalFromContentRange({ header: "bytes 0-1023/*" })).toBeUndefined();
  });

  it("returns undefined for an absent or malformed header", () => {
    expect(totalFromContentRange({ header: undefined })).toBeUndefined();
    expect(totalFromContentRange({ header: null })).toBeUndefined();
    expect(totalFromContentRange({ header: "" })).toBeUndefined();
    expect(totalFromContentRange({ header: "1024" })).toBeUndefined();
    expect(totalFromContentRange({ header: "items 0-1023/50" })).toBeUndefined();
  });
});

describe("markdownMediaSource", () => {
  it("unwraps the file:// envelope a markdown media tag carries", () => {
    const envelope = encodeURIComponent(
      JSON.stringify({ permissionRecord: { id: "b1" }, source: "https://x.test/a.pdf" }),
    );
    expect(markdownMediaSource({ src: `file://${envelope}` })).toBe("https://x.test/a.pdf");
  });

  it("returns the attachment handle when that is what the envelope carries", () => {
    // MEASURED: on the attachment-richest real pages these outnumbered urls by more than seventy to one.
    const envelope = encodeURIComponent(
      JSON.stringify({ source: "attachment:dd101733-4228-4ddc-98df-7198269af13c:call.mp3" }),
    );
    expect(markdownMediaSource({ src: `file://${envelope}` })).toBe(
      "attachment:dd101733-4228-4ddc-98df-7198269af13c:call.mp3",
    );
  });

  it("returns undefined for anything that is not the envelope", () => {
    expect(markdownMediaSource({ src: "https://x.test/a.pdf" })).toBeUndefined();
    expect(markdownMediaSource({ src: "file://not-encoded-json" })).toBeUndefined();
    expect(markdownMediaSource({ src: "file://%7B%22no-source%22%3A1%7D" })).toBeUndefined();
  });
});

describe("ceilingVerdict", () => {
  it("lets a file under the ceiling through", () => {
    expect(ceilingVerdict({ ceilingBytes: 1000, declaredBytes: 999 })).toBeUndefined();
  });

  it("lets a file exactly ON the ceiling through", () => {
    expect(ceilingVerdict({ ceilingBytes: 1000, declaredBytes: 1000 })).toBeUndefined();
  });

  it("refuses a file over the ceiling on the probe's total, before the file is read", () => {
    const verdict = ceilingVerdict({ ceilingBytes: 1000, declaredBytes: 1001 });
    expect(verdict).toEqual({ bytes: 1001, kind: "too-large" });
  });

  it("does not treat an unknown total as small enough to try", () => {
    // The ceiling exists because this machine cannot be asked to hold what it has no room for. A fetch that
    // must read the body to measure it has already spent whatever the file costs, so an undeclared size is
    // its own outcome rather than an optimistic attempt.
    expect(ceilingVerdict({ ceilingBytes: 1000, declaredBytes: undefined })).toEqual({ kind: "size-unknown" });
  });
});
