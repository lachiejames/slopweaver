import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SpecFetchLike } from "../../../../atlas/kit/specFetch.js";
import { MICROSOFT365_SPEC_PIN } from "../../../../atlas/microsoft365/specLock.js";
import { loadMicrosoft365Spec, microsoft365SpecCachePath } from "../../../../atlas/microsoft365/specSource.js";
import { unwrapErr } from "../../../../lib/result.js";

const roots: string[] = [];

/** A scratch atlas root, removed in `afterEach` so a long-lived dev machine does not accumulate them. */
function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-m365-spec-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { force: true, recursive: true });
  }
});

/** A fetch seam that always answers the same body, and records what it was asked for. */
function servingFetch({ body, asked }: { body: string; asked: string[] }): SpecFetchLike {
  return (url) => {
    asked.push(url);
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
  };
}

describe("loadMicrosoft365Spec", () => {
  it("asks for exactly the pinned address, which no caller supplies", async () => {
    const asked: string[] = [];
    await loadMicrosoft365Spec({ fetchImpl: servingFetch({ asked, body: "x" }), root: scratchRoot() });
    expect(asked).toEqual([MICROSOFT365_SPEC_PIN.url]);
  });

  it("refuses bytes that do not hash to the pin, and caches nothing", async () => {
    const root = scratchRoot();
    const loaded = await loadMicrosoft365Spec({
      fetchImpl: servingFetch({ asked: [], body: "not the document" }),
      root,
    });
    expect(loaded.isErr()).toBe(true);
    expect(unwrapErr(loaded)[0]).toContain("did not hash to its pin");
    expect(() => readFileSync(microsoft365SpecCachePath({ root }), "utf8")).toThrow();
  });

  it("discards a cache whose bytes are not the pinned ones rather than trusting the filename", async () => {
    const root = scratchRoot();
    const path = microsoft365SpecCachePath({ root });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "a truncated or hand-edited document", "utf8");
    const asked: string[] = [];
    const loaded = await loadMicrosoft365Spec({ fetchImpl: servingFetch({ asked, body: "still wrong" }), root });
    expect(asked).toEqual([MICROSOFT365_SPEC_PIN.url]);
    expect(loaded.isErr()).toBe(true);
  });

  it("reports the HTTP status rather than a generic failure", async () => {
    const loaded = await loadMicrosoft365Spec({
      fetchImpl: () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") }),
      root: scratchRoot(),
    });
    expect(unwrapErr(loaded)[0]).toContain("HTTP 404");
  });

  it("reports a thrown transport failure with its own message", async () => {
    const loaded = await loadMicrosoft365Spec({
      fetchImpl: () => Promise.reject(new Error("getaddrinfo ENOTFOUND")),
      root: scratchRoot(),
    });
    expect(unwrapErr(loaded)[0]).toContain("getaddrinfo ENOTFOUND");
  });
});

describe("MICROSOFT365_SPEC_PIN", () => {
  it("addresses an immutable commit, so the URL can never serve different bytes", () => {
    expect(MICROSOFT365_SPEC_PIN.url).toContain(MICROSOFT365_SPEC_PIN.commit);
    expect(MICROSOFT365_SPEC_PIN.commit).toHaveLength(40);
    expect(MICROSOFT365_SPEC_PIN.sha256).toHaveLength(64);
  });
});
