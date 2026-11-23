/**
 * `browser console-shot`'s pure half: the one value it takes from the installation, the observation its spec leaves,
 * and the receipt `github attach` reads.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { captureReceiptSchema } from "../../../visualEvidence/captureRecord.js";
import {
  type ConsoleObservation,
  consoleMaintenanceUrl,
  consoleShotReceipt,
  parseConsoleObservation,
} from "../../../visualEvidence/consoleShot.js";
import { CONSOLE_WALKS, consoleWalkNamed } from "../../../visualEvidence/consoleWalks.js";

/** The registered walk every case runs. */
const WALK = consoleWalkNamed({ name: "automations-context" })!;

/** One text walk: a heading and a row inside `main`, and a sidebar word outside it. */
const TEXT = {
  nodes: [
    { rect: { height: 20, width: 120, x: 300, y: 40 }, text: "Automations" },
    { rect: { height: 20, width: 200, x: 300, y: 80 }, text: "acme-store-compact" },
    { rect: { height: 20, width: 80, x: 10, y: 40 }, text: "Queue" },
  ],
  opaque: [],
  truncated: false,
};

/** What the spec leaves for a 1920x1080 viewport with `main` at x 280. */
const OBSERVATION: ConsoleObservation = {
  after: TEXT,
  before: TEXT,
  finalPath: "/automations?context=slopweaver",
  initialPath: WALK.initialPath,
  regionCss: { height: 1080, width: 1640, x: 280, y: 0 },
  schemaVersion: 1,
  viewport: { deviceScaleFactor: 1, heightPx: 1080, widthPx: 1920 },
  walk: WALK.name,
  witnessesSeen: [...WALK.witnesses],
};

/** The final picture: exactly the region. */
const FINAL = { digest: `sha256:${"a".repeat(64)}`, heightPx: 1080, path: "/out/shot.png", widthPx: 1640 };

describe("consoleMaintenanceUrl", () => {
  it("names the server's postgres database on the selected store's own server and credentials", () => {
    const url = consoleMaintenanceUrl({
      storeUrl: "postgresql://acme:FIXTURE@127.0.0.1:55322/acme_store?sslmode=disable",
    });
    expect(unwrap(url)).toBe("postgresql://acme:FIXTURE@127.0.0.1:55322/postgres?sslmode=disable");
  });

  it("refuses a store that lives in the postgres database itself, which the connection would open", () => {
    const url = consoleMaintenanceUrl({ storeUrl: "postgresql://acme:FIXTURE@127.0.0.1:55322/postgres" });
    expect(unwrapErr(url).code).toBe("CONSOLE_STORE_UNAVAILABLE");
    expect(unwrapErr(url).message).toContain("installation's own store");
  });

  it("refuses a store whose URL names no database, which a client may resolve to the postgres database", () => {
    const url = consoleMaintenanceUrl({ storeUrl: "postgresql://postgres:FIXTURE@127.0.0.1:55322" });
    expect(unwrapErr(url).code).toBe("CONSOLE_STORE_UNAVAILABLE");
    expect(unwrapErr(url).message).toContain("names no database");
  });

  it("refuses a store that is not on this machine", () => {
    const url = consoleMaintenanceUrl({ storeUrl: "postgresql://acme:FIXTURE@db.example.com:5432/acme_store" });
    expect(unwrapErr(url).code).toBe("CONSOLE_STORE_UNAVAILABLE");
    expect(unwrapErr(url).message).toContain("not on this machine");
  });
});

describe("parseConsoleObservation", () => {
  it("accepts the walk that was asked for", () => {
    expect(unwrap(parseConsoleObservation({ value: OBSERVATION, walk: WALK })).finalPath).toBe(
      "/automations?context=slopweaver",
    );
  });

  it("refuses another walk's observation", () => {
    const parsed = parseConsoleObservation({ value: { ...OBSERVATION, walk: "elsewhere" }, walk: WALK });
    expect(unwrapErr(parsed).message).toContain("it is walk 'elsewhere'");
  });

  it("refuses an observation that never saw one of the walk's witnesses", () => {
    const parsed = parseConsoleObservation({ value: { ...OBSERVATION, witnessesSeen: ["main"] }, walk: WALK });
    expect(unwrapErr(parsed).message).toContain('the walk never saw [data-context="slopweaver"]');
  });

  it("refuses an unknown field rather than dropping it", () => {
    const parsed = parseConsoleObservation({ value: { ...OBSERVATION, home: "/Users/acme/.slopweaver" }, walk: WALK });
    expect(unwrapErr(parsed).code).toBe("CONSOLE_OBSERVATION_INVALID");
  });
});

describe("consoleShotReceipt", () => {
  const build = ({ observation, final = FINAL }: { observation: ConsoleObservation; final?: typeof FINAL }) =>
    consoleShotReceipt({
      capturedAtIso: "2026-11-21T12:00:00.000Z",
      captureId: "cap-aaaaaaaaaaaaaaaa",
      final,
      observation,
      walk: WALK,
    });

  it("files a receipt the capture-receipt schema accepts, its frame text the words inside the region", () => {
    const receipt = unwrap(build({ observation: OBSERVATION }));
    expect(captureReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(receipt.frameText.kind).toBe("exact");
    expect(receipt.frameText.items.map((item) => item.text)).toEqual(["Automations", "acme-store-compact"]);
    expect(receipt.cropRect).toEqual({ height: 1080, width: 1640, x: 280, y: 0 });
  });

  it("records the walk, not the throwaway server's address", () => {
    const receipt = unwrap(build({ observation: OBSERVATION }));
    expect(receipt).toEqual(
      expect.objectContaining({
        detail: {
          finalPath: "/automations?context=slopweaver",
          fixture: "acme",
          initialPath: "/automations?context=work",
          region: ["main"],
          viewport: { deviceScaleFactor: 1, heightPx: 1080, widthPx: 1920 },
          walk: "automations-context",
          witnesses: ['[data-context="slopweaver"]', "main"],
        },
        verb: "browser console-shot",
      }),
    );
  });

  it("marks the frame text incomplete when the page changed across the shutter", () => {
    const after = { ...TEXT, nodes: TEXT.nodes.slice(1) };
    const receipt = unwrap(build({ observation: { ...OBSERVATION, after } }));
    expect(receipt.frameText.kind).toBe("incomplete");
  });

  it("refuses a region that is the whole viewport", () => {
    const whole = { ...OBSERVATION, regionCss: { height: 1080, width: 1920, x: 0, y: 0 } };
    const receipt = build({ final: { ...FINAL, widthPx: 1920 }, observation: whole });
    expect(unwrapErr(receipt).code).toBe("CONSOLE_WHOLE_FRAME");
  });
});

describe("CONSOLE_WALKS", () => {
  it("names each walk once, each opening a path and cutting at least one region", () => {
    expect(CONSOLE_WALKS.length).toBeGreaterThan(0);
    const names = CONSOLE_WALKS.map((walk) => walk.name);
    expect(new Set(names).size).toBe(names.length);
    expect(CONSOLE_WALKS.filter((walk) => !walk.initialPath.startsWith("/") || walk.region.length === 0)).toEqual([]);
  });
});
