import { describe, expect, it } from "vitest";

import {
  acknowledgementCarriesAReason,
  addressesThisMachineOnly,
  carriesAChartStamp,
  inventedVisualPreflightLines,
  inventedVisualsIn,
  refersToAPage,
  sitsBesideARenderedPage,
  VISUAL_HEAD_BYTES,
} from "../../../admit/inventedVisual.js";

/**
 * The measured matplotlib stamp, as `savefig` writes it into a PNG `tEXt Software` chunk. Reproduced from
 * matplotlib 3.9.4 on this machine, where it lands at byte 50 — see `CHART_STAMPS` for the command.
 */
const MATPLOTLIB_PNG_HEAD = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("\u0000\u0000\u0000\rIHDR", "latin1"),
  Buffer.from("\u0000".repeat(21), "latin1"),
  Buffer.from("tEXtSoftware\u0000Matplotlib version3.9.4, https://matplotlib.org/", "latin1"),
]);

/** A raster header with no generator stamp at all — what a real screen capture looks like at the front. */
const PLAIN_PNG_HEAD = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("\u0000\u0000\u0000\rIHDR", "latin1"),
  Buffer.from("\u0000".repeat(64), "latin1"),
]);

describe("addressesThisMachineOnly", () => {
  it("catches the exact URL the incident captured", () => {
    expect(addressesThisMachineOnly({ ref: "http://127.0.0.1:8792/before.html" })).toBe(true);
  });

  it("catches the other three loopback spellings and a file path", () => {
    expect(addressesThisMachineOnly({ ref: "http://localhost:3000/chart.png" })).toBe(true);
    expect(addressesThisMachineOnly({ ref: "http://0.0.0.0:8080/x.png" })).toBe(true);
    expect(addressesThisMachineOnly({ ref: "http://[::1]:8791/vanta-BEFORE.html" })).toBe(true);
    expect(addressesThisMachineOnly({ ref: "file:///private/tmp/scratchpad/before.html" })).toBe(true);
  });

  it("catches a data: URI, which embeds the drawing rather than pointing at one", () => {
    expect(addressesThisMachineOnly({ ref: "data:image/png;base64,iVBORw0KGgo=" })).toBe(true);
  });

  it("catches a subdomain of localhost, and is case-insensitive", () => {
    expect(addressesThisMachineOnly({ ref: "http://app.localhost:8792/x.png" })).toBe(true);
    expect(addressesThisMachineOnly({ ref: "HTTP://127.0.0.1/X.PNG" })).toBe(true);
  });

  it("lets a real GitHub attachment URL through", () => {
    expect(addressesThisMachineOnly({ ref: "https://github.com/user-attachments/assets/uuid-1" })).toBe(false);
  });

  it("lets a plain absolute path through — a path is not a URL, and the sibling check judges it", () => {
    expect(addressesThisMachineOnly({ ref: "/private/tmp/scratchpad/01-before.jpg" })).toBe(false);
  });

  it("does not fire on a host that merely CONTAINS a loopback spelling", () => {
    expect(addressesThisMachineOnly({ ref: "https://localhost.example.com/shot.png" })).toBe(false);
    expect(addressesThisMachineOnly({ ref: "https://127.0.0.1.example.com/shot.png" })).toBe(false);
  });
});

describe("refersToAPage", () => {
  it("refuses a page or a vector handed to an image slot", () => {
    expect(refersToAPage({ ref: "/tmp/scratchpad/before.html" })).toBe(true);
    expect(refersToAPage({ ref: "/tmp/scratchpad/before.HTM" })).toBe(true);
    expect(refersToAPage({ ref: "/tmp/scratchpad/chart.svg" })).toBe(true);
  });

  it("ignores a query string when reading the extension", () => {
    expect(refersToAPage({ ref: "http://example.com/report.html?v=2" })).toBe(true);
  });

  it("lets every raster capture through", () => {
    expect(refersToAPage({ ref: "/tmp/01-before.jpg" })).toBe(false);
    expect(refersToAPage({ ref: "/tmp/shot.png" })).toBe(false);
  });
});

describe("sitsBesideARenderedPage", () => {
  it("fires on the scratchpad the shots were saved into", () => {
    expect(sitsBesideARenderedPage({ siblings: ["before.html", "after.html", "02-after.jpg", "03-proof.json"] })).toBe(
      true,
    );
  });

  it("does not fire on a directory holding only captures", () => {
    expect(sitsBesideARenderedPage({ siblings: ["01-before.jpg", "02-after.jpg"] })).toBe(false);
  });

  it("does not fire on an empty directory", () => {
    expect(sitsBesideARenderedPage({ siblings: [] })).toBe(false);
  });
});

describe("carriesAChartStamp", () => {
  it("finds the measured matplotlib stamp in a savefig PNG head", () => {
    expect(carriesAChartStamp({ head: MATPLOTLIB_PNG_HEAD })).toBe(true);
  });

  it("finds it in an SVG, where the same string appears in the document text", () => {
    const svg = Buffer.from('<?xml version="1.0"?><!-- Created with Matplotlib version3.9.4 --><svg></svg>', "latin1");
    expect(carriesAChartStamp({ head: svg })).toBe(true);
  });

  it("leaves an unstamped capture alone", () => {
    expect(carriesAChartStamp({ head: PLAIN_PNG_HEAD })).toBe(false);
  });

  it("leaves an empty head alone", () => {
    expect(carriesAChartStamp({ head: new Uint8Array([]) })).toBe(false);
  });
});

describe("VISUAL_HEAD_BYTES", () => {
  it("covers the deepest measured stamp offset with room to spare", () => {
    expect(VISUAL_HEAD_BYTES).toBe(4096);
  });
});

describe("inventedVisualsIn", () => {
  it("finds nothing in a real capture from a real host", () => {
    expect(
      inventedVisualsIn({
        visuals: [
          {
            head: PLAIN_PNG_HEAD,
            ref: "https://github.com/user-attachments/assets/uuid-1",
            seam: "answer-image",
            siblings: ["02-after.jpg"],
          },
        ],
      }),
    ).toStrictEqual([]);
  });

  it("names the incident's own URL with the local-render reason", () => {
    const found = inventedVisualsIn({
      visuals: [{ ref: "http://127.0.0.1:8792/before.html", seam: "pr-embed" }],
    });
    expect(found.length).toBe(2);
    expect(found[0]!.reason).toBe("local-render-url");
    expect(found[0]!.seam).toBe("pr-embed");
    expect(found[0]!.ref).toBe("http://127.0.0.1:8792/before.html");
    expect(found[1]!.reason).toBe("page-not-capture");
  });

  it("gives a file that is wrong two ways one entry per reason", () => {
    const found = inventedVisualsIn({
      visuals: [
        {
          head: MATPLOTLIB_PNG_HEAD,
          ref: "/tmp/scratchpad/01-before.jpg",
          seam: "attachment",
          siblings: ["before.html"],
        },
      ],
    });
    expect(found.map((entry) => entry.reason)).toStrictEqual(["rendered-page-sibling", "generated-chart"]);
  });

  it("does not double-count a page as its own rendered sibling", () => {
    const found = inventedVisualsIn({
      visuals: [{ ref: "/tmp/scratchpad/before.html", seam: "attachment", siblings: ["after.html"] }],
    });
    expect(found.map((entry) => entry.reason)).toStrictEqual(["page-not-capture"]);
  });

  it("decides only the reference-only reasons when a seam holds no bytes", () => {
    const found = inventedVisualsIn({
      visuals: [{ ref: "/tmp/scratchpad/01-before.jpg", seam: "answer-image" }],
    });
    expect(found).toStrictEqual([]);
  });

  it("carries the real path back on every finding", () => {
    const found = inventedVisualsIn({ visuals: [{ ref: "file:///tmp/x.png", seam: "attachment" }] });
    expect(found[0]!.real).toBe(
      "capture the provider's OWN surface through the doored browser route, or link the deployed thing itself",
    );
  });

  it("finds nothing in an empty candidate list", () => {
    expect(inventedVisualsIn({ visuals: [] })).toStrictEqual([]);
  });
});

describe("acknowledgementCarriesAReason", () => {
  it("accepts a reason of four words or more", () => {
    expect(acknowledgementCarriesAReason({ reason: "vanta has no doorless ui" })).toBe(true);
  });

  it("refuses a bare marker and a three-word shrug", () => {
    expect(acknowledgementCarriesAReason({ reason: "yes" })).toBe(false);
    expect(acknowledgementCarriesAReason({ reason: "it is fine" })).toBe(false);
    expect(acknowledgementCarriesAReason({ reason: "   " })).toBe(false);
  });
});

describe("inventedVisualPreflightLines", () => {
  it("leads with the rule and names the hatch", () => {
    const lines = inventedVisualPreflightLines();
    expect(lines[0]).toBe(
      "REAL SURFACES ONLY — a picture you rendered is never a substitute for a picture of the real thing:",
    );
    expect(lines.join("\n")).toContain('--acknowledge "<reason>"');
  });

  it("states the tripwire property, so an absent block is never read as a pass", () => {
    expect(inventedVisualPreflightLines().join("\n")).toContain("The absence of one means nothing");
  });
});
