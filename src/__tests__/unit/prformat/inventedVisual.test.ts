import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { renderPrBody } from "../../../outbound/github/render.js";
import { inventedVisualErrors } from "../../../prformat/checkCore.js";
import { gatePrBody } from "../../../prformat/prBodyGate.js";
import { FIX_BODY, formOf } from "../outbound/github/fixtures.js";

/** A canonical C3 render with a third-party tail after it, the only part varied. */
function body({ tail }: { tail: string }): string {
  return `${unwrap(renderPrBody({ form: formOf({ body: FIX_BODY }) }))}\n${tail}\n`;
}

describe("inventedVisualErrors", () => {
  it("refuses the incident's own embed, naming the file and the way back", () => {
    const errors = inventedVisualErrors({ body: `<img src="http://127.0.0.1:8792/before.html">` });
    expect(errors.length).toBe(2);
    expect(errors[0]).toContain("http://127.0.0.1:8792/before.html");
    expect(errors[0]).toContain("capture the provider's OWN surface through the doored browser route");
    expect(errors[1]).toContain("an image slot was handed a page or a vector you composed");
  });

  it("refuses a markdown embed of a file:// path", () => {
    expect(inventedVisualErrors({ body: "![before](file:///tmp/scratch/before.png)" }).length).toBe(1);
  });

  it("lets a real GitHub user-attachments embed through", () => {
    expect(
      inventedVisualErrors({ body: `<img src="https://github.com/user-attachments/assets/uuid-1" width="600">` }),
    ).toStrictEqual([]);
  });

  it("lets the shields.io badge row through", () => {
    expect(
      inventedVisualErrors({
        body: "![CI](https://img.shields.io/badge/CI-passing-2ea44f)",
      }),
    ).toStrictEqual([]);
  });

  it("is waived by an acknowledgement carrying a real reason", () => {
    const withAck =
      `<img src="http://127.0.0.1:8792/before.html">\n` +
      `<!-- invented-visual-ack: vanta has no doorless surface to capture -->`;
    expect(inventedVisualErrors({ body: withAck })).toStrictEqual([]);
  });

  it("is NOT waived by a bare marker — a hatch with no reason waives nothing", () => {
    const bare = `<img src="http://127.0.0.1:8792/before.html">\n<!-- invented-visual-ack: yes -->`;
    expect(inventedVisualErrors({ body: bare }).length).toBe(2);
  });
});

describe("gatePrBody with an invented visual", () => {
  it("fails a C3 description followed by an embed of a locally served page", () => {
    const failing = body({ tail: `<img src="http://127.0.0.1:8792/before.html">` });
    const result = gatePrBody({ body: failing, owned: true });
    expect(result.errors.some((error) => error.includes("127.0.0.1:8792"))).toBe(true);
    // The C3 body itself is clean, so the embed's own refusals are the WHOLE verdict and nothing else fails it.
    expect(result).toStrictEqual({ errors: inventedVisualErrors({ body: failing }), shape: "c3" });
  });

  it("passes the same description once the embed is a real attachment", () => {
    const tail = `<img src="https://github.com/user-attachments/assets/uuid-1">`;
    expect(gatePrBody({ body: body({ tail }), owned: true })).toStrictEqual({ errors: [], shape: "c3" });
  });

  it("passes the locally served page once the description acknowledges it", () => {
    const tail =
      `<img src="http://127.0.0.1:8792/before.html">` +
      `<!-- invented-visual-ack: vanta has no doorless surface to capture -->`;
    expect(gatePrBody({ body: body({ tail }), owned: true })).toStrictEqual({ errors: [], shape: "c3" });
  });
});
