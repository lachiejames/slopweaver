import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { RESPONSE_HOOK } from "../../../browser/playwrightCli.js";

/**
 * The hook is a string because it runs inside the owner's browser, so the only way to exercise it here is
 * to write it into a module and drive it with a fake `page`. That fake is an injected seam — a plain object
 * the hook calls — not a mock.
 */
const workDir = mkdtempSync(join(tmpdir(), "slopweaver-response-hook-"));
const modulePath = join(workDir, "hook.mjs");
writeFileSync(
  modulePath,
  `export async function run({ page, maxResponses, maxBodyBytes }) {\n${RESPONSE_HOOK}  await page.emitAll();\n  await Promise.all(pending.splice(0, pending.length));\n  return { bodyFailed, bodySucceeded: responses.length, eligible, seen };\n}\n`,
);

afterAll(() => {
  rmSync(workDir, { force: true, recursive: true });
});

interface Accounting {
  readonly seen: number;
  readonly eligible: number;
  readonly bodySucceeded: number;
  readonly bodyFailed: number;
}

type Kind = "json" | "throws" | "oversize" | "html";

const response = ({ kind, index }: { kind: Kind; index: number }): unknown => ({
  headers: () => ({ "content-type": kind === "html" ? "text/html" : "application/json" }),
  request: () => ({ method: () => "GET" }),
  status: () => 200,
  text: async (): Promise<string> => {
    if (kind === "throws") {
      throw new Error("body disposed by navigation");
    }
    if (kind === "oversize") {
      return "x".repeat(2_000_000);
    }
    return JSON.stringify({ index });
  },
  url: () => `https://console.example.invalid/${String(index)}`,
});

const many = ({ kind, count }: { kind: Kind; count: number }): unknown[] =>
  Array.from({ length: count }, (_unused, index) => response({ index, kind }));

const account = async ({
  responses,
  maxResponses,
}: {
  responses: readonly unknown[];
  maxResponses: number;
}): Promise<Accounting> => {
  const handlers: ((value: unknown) => void)[] = [];
  const page = {
    emitAll: async (): Promise<void> => {
      for (const value of responses) {
        for (const handler of handlers) {
          handler(value);
        }
      }
    },
    // named-object-params-exempt: Playwright's own Page.on(event, handler) shape, which the snippet calls
    on: (_event: string, handler: (value: unknown) => void): void => {
      handlers.push(handler);
    },
  };
  const imported = (await import(modulePath)) as {
    run: (input: { page: unknown; maxResponses: number; maxBodyBytes: number }) => Promise<Accounting>;
  };
  return imported.run({ maxBodyBytes: 1_048_576, maxResponses, page });
};

describe("the response hook's accounting", () => {
  it("reads every eligible body when nothing is in the way", async () => {
    const accounting = await account({ maxResponses: 200, responses: many({ count: 5, kind: "json" }) });
    expect(accounting).toEqual({ bodyFailed: 0, bodySucceeded: 5, eligible: 5, seen: 5 });
  });

  it("counts a body the per-page cap refused, rather than losing it", async () => {
    // The regression: these six once returned before `eligible` was incremented, so the capture reported
    // itself complete (eligible 4, succeeded 4, failed 0) while six bodies had silently vanished.
    const accounting = await account({ maxResponses: 4, responses: many({ count: 10, kind: "json" }) });
    expect(accounting).toEqual({ bodyFailed: 6, bodySucceeded: 4, eligible: 10, seen: 10 });
  });

  it("counts a body that threw", async () => {
    const responses = [...many({ count: 3, kind: "json" }), response({ index: 9, kind: "throws" })];
    const accounting = await account({ maxResponses: 200, responses });
    expect(accounting).toEqual({ bodyFailed: 1, bodySucceeded: 3, eligible: 4, seen: 4 });
  });

  it("counts a body over the byte cap", async () => {
    const responses = [...many({ count: 3, kind: "json" }), response({ index: 9, kind: "oversize" })];
    const accounting = await account({ maxResponses: 200, responses });
    expect(accounting).toEqual({ bodyFailed: 1, bodySucceeded: 3, eligible: 4, seen: 4 });
  });

  it("sees a non-JSON response without ever calling it eligible", async () => {
    const responses = [...many({ count: 2, kind: "json" }), response({ index: 9, kind: "html" })];
    const accounting = await account({ maxResponses: 200, responses });
    expect(accounting).toEqual({ bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 3 });
  });
});
