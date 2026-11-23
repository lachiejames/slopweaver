import { describe, expect, it } from "vitest";

import { canvasDocumentContent, canvasWireTitle } from "../../../../corpus/slack/writeApiCanvas.js";

const EMAIL = "jane.doe@example.com";
const IP = "203.0.113.7";
const BODY = `# Notes\n\nThe failing login was ${EMAIL} from ${IP}.\n`;

describe("canvasDocumentContent — the PII pass every canvas write crosses", () => {
  it("is fed a body that really carries the email and the IP", () => {
    expect(BODY).toContain(EMAIL);
    expect(BODY).toContain(IP);
  });

  it("sends neither, and puts the placeholders where they were", () => {
    expect(canvasDocumentContent({ markdown: BODY })).toEqual({
      markdown: "# Notes\n\nThe failing login was [email] from [ip].\n",
      type: "markdown",
    });
  });

  it("leaves a body with nothing to redact byte for byte", () => {
    const clean = "# Notes\n\nThe rollup was read at 18:15Z on node 24.11.1.\n";

    expect(canvasDocumentContent({ markdown: clean })).toEqual({ markdown: clean, type: "markdown" });
  });
});

describe("canvasWireTitle — the title both creates send crosses the same pass", () => {
  const TITLE = `Login failures for ${EMAIL} from ${IP}`;

  it("is fed a title that really carries the email and the IP", () => {
    expect(TITLE).toContain(EMAIL);
    expect(TITLE).toContain(IP);
  });

  it("sends neither, and puts the placeholders where they were", () => {
    expect(canvasWireTitle({ title: TITLE })).toBe("Login failures for [email] from [ip]");
  });

  it("leaves a title with nothing to redact byte for byte", () => {
    expect(canvasWireTitle({ title: "Staging pool notes, 18 Oct" })).toBe("Staging pool notes, 18 Oct");
  });
});
