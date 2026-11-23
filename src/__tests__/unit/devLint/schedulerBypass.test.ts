import { describe, expect, it } from "vitest";
import {
  bypassMessage,
  isScannablePath,
  RESTRICTED_PACKAGE_OWNERS,
  SANCTIONED_CLIENT_FACTORIES,
  scanSchedulerBypass,
} from "../../../devLint/schedulerBypass.js";

const MARKER = "// devlint: sdk-factory -- the reason this client exists";

describe("scanSchedulerBypass (pure)", () => {
  it("flags an SDK client constructed in a file that is not a sanctioned factory", () => {
    const content = ["const client = new WebClient(token);"].join("\n");
    const hits = scanSchedulerBypass({ content, path: "src/somewhere/new.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.label).toBe("slack-web-client");
    expect(hits[0]!.reason).toBe("unsanctioned-factory");
    expect(hits[0]!.line).toBe(1);
  });

  it("flags every policed constructor shape", () => {
    const content = [
      "const a = new WebClient(token);",
      "const b = new Octokit({ auth });",
      "const c = new LinearClient({ apiKey });",
      "const d = new Client({ auth: token });",
      "const e = new Codex();",
    ].join("\n");
    const labels = scanSchedulerBypass({ content, path: "src/somewhere/new.ts" }).map((h) => h.label);
    expect(labels).toEqual(["slack-web-client", "octokit-client", "linear-client", "notion-client", "codex-client"]);
  });

  it("passes a sanctioned factory whose construction line carries the marker", () => {
    const content = [`const client = new WebClient(token); ${MARKER}`].join("\n");
    expect(scanSchedulerBypass({ content, path: "src/corpus/slack/api.ts" })).toEqual([]);
  });

  it("passes a sanctioned factory whose marker sits on the line ABOVE the construction", () => {
    const content = [MARKER, "const client = new WebClient(token);"].join("\n");
    expect(scanSchedulerBypass({ content, path: "src/corpus/slack/api.ts" })).toEqual([]);
  });

  it("flags a sanctioned factory that constructs a client with NO marker anywhere", () => {
    const content = ["const client = new WebClient(token);"].join("\n");
    const hits = scanSchedulerBypass({ content, path: "src/corpus/slack/api.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.reason).toBe("missing-marker");
  });

  it("flags a marker used in a file that is NOT allowlisted — the marker cannot smuggle a client in", () => {
    const content = [`const client = new WebClient(token); ${MARKER}`].join("\n");
    const hits = scanSchedulerBypass({ content, path: "src/somewhere/sneaky.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.label).toBe("marker");
    expect(hits[0]!.reason).toBe("marker-outside-allowlist");
  });

  it("does not read past the start of the file when a construction is on line 1", () => {
    const content = ["const client = new Codex();", "const other = 1;"].join("\n");
    const hits = scanSchedulerBypass({ content, path: "src/codex/client.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.reason).toBe("missing-marker");
    expect(hits[0]!.line).toBe(1);
  });

  it("returns no hits for a file that constructs nothing", () => {
    expect(scanSchedulerBypass({ content: "export const x = 1;\n", path: "src/pure/thing.ts" })).toEqual([]);
  });
});

describe("the Codex factory choke point", () => {
  it("flags a raw `new Codex()` outside the one sanctioned factory — it would inherit the machine's sandbox", () => {
    const hits = scanSchedulerBypass({ content: "const codex = new Codex();", path: "src/codex/runTurn.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.label).toBe("codex-client");
    expect(hits[0]!.reason).toBe("unsanctioned-factory");
  });

  it("passes the sole sanctioned Codex factory when it is marked", () => {
    const content = [
      "// devlint: sdk-factory -- the sole closed Codex factory; every thread gets locked options",
      "const codex = new Codex();",
    ].join("\n");
    expect(scanSchedulerBypass({ content, path: "src/codex/client.ts" })).toEqual([]);
  });

  it("lists src/codex/client.ts as a sanctioned factory with a non-empty reason", () => {
    expect(SANCTIONED_CLIENT_FACTORIES["src/codex/client.ts"]).toBe(
      "the sole closed Codex factory — the choke point for the sandbox, not for pacing",
    );
  });
});

describe("the Outlook factory choke point", () => {
  it("flags an MSAL public client and a Graph client built outside the Outlook factory", () => {
    const content = [
      "const app = new PublicClientApplication({ auth });",
      "const graph = Client.initWithMiddleware({ middleware });",
      "const other = Client.init({ authProvider });",
    ].join("\n");
    const hits = scanSchedulerBypass({ content, path: "src/live/outlook/api.ts" });
    expect(hits.map((hit) => `${hit.label}:${hit.reason}`)).toEqual([
      "msal-public-client:unsanctioned-factory",
      "graph-client:unsanctioned-factory",
      "graph-client:unsanctioned-factory",
    ]);
  });

  it("passes the Outlook factory when each construction carries its marker above it", () => {
    const content = [
      MARKER,
      "return new PublicClientApplication({ auth });",
      MARKER,
      "return Client.initWithMiddleware({ middleware });",
    ].join("\n");
    expect(scanSchedulerBypass({ content, path: "src/live/outlook/client.ts" })).toEqual([]);
  });

  it("flags an unmarked Graph construction even in the Outlook factory", () => {
    const content = "return Client.initWithMiddleware({ middleware });";
    const hits = scanSchedulerBypass({ content, path: "src/live/outlook/client.ts" });
    expect(hits.map((hit) => hit.reason)).toEqual(["missing-marker"]);
  });

  it("holds both Microsoft SDK packages to the Outlook factory, aliased and dynamic imports included", () => {
    const content = [
      'import { PublicClientApplication as App } from "@azure/msal-node";',
      'const graphSdk = await import("@microsoft/microsoft-graph-client");',
    ].join("\n");
    const hits = scanSchedulerBypass({ content, path: "src/live/outlook/session.ts" });
    expect(hits.map((hit) => `${hit.label}:${hit.reason}`)).toEqual([
      "@azure/msal-node:restricted-import",
      "@microsoft/microsoft-graph-client:restricted-import",
    ]);
    expect(RESTRICTED_PACKAGE_OWNERS["@azure/msal-node"]).toBe("src/live/outlook/client.ts");
    expect(RESTRICTED_PACKAGE_OWNERS["@microsoft/microsoft-graph-client"]).toBe("src/live/outlook/client.ts");
  });
});

describe("restricted SDK package import", () => {
  it("flags a plain named import of the Codex SDK outside its owning file", () => {
    const hits = scanSchedulerBypass({
      content: 'import { Codex } from "@openai/codex-sdk";',
      path: "src/codex/runPass.ts",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.reason).toBe("restricted-import");
    expect(hits[0]!.label).toBe("@openai/codex-sdk");
    expect(hits[0]!.line).toBe(1);
  });

  it("flags an ALIASED import — the exact shape a `new Codex(` regex cannot see", () => {
    const hits = scanSchedulerBypass({
      content: 'import { Codex as Brain } from "@openai/codex-sdk";\nconst b = new Brain();',
      path: "src/codex/sneaky.ts",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.reason).toBe("restricted-import");
  });

  it("flags a namespace import and a dynamic import", () => {
    const content = [
      'import * as codexSdk from "@openai/codex-sdk";',
      'const mod = await import("@openai/codex-sdk");',
    ].join("\n");
    const hits = scanSchedulerBypass({ content, path: "src/codex/other.ts" });
    expect(hits.map((h) => h.line)).toEqual([1, 2]);
    expect(hits.every((h) => h.reason === "restricted-import")).toBe(true);
  });

  it("flags a single-quoted specifier too", () => {
    const hits = scanSchedulerBypass({
      content: "import { Codex } from '@openai/codex-sdk';",
      path: "src/elsewhere.ts",
    });
    expect(hits).toHaveLength(1);
  });

  it("allows the owning file to import the SDK", () => {
    const content = [
      'import { Codex } from "@openai/codex-sdk";',
      "// devlint: sdk-factory -- the sole closed Codex factory",
      "const codex = new Codex();",
    ].join("\n");
    expect(scanSchedulerBypass({ content, path: "src/codex/client.ts" })).toEqual([]);
  });

  it("flags a side-effect import and a require", () => {
    const content = ['import "@openai/codex-sdk";', 'const m = require("@openai/codex-sdk");'].join("\n");
    const hits = scanSchedulerBypass({ content, path: "src/elsewhere.ts" });
    expect(hits.map((h) => h.line)).toEqual([1, 2]);
  });

  it("flags a MULTI-LINE import whose specifier sits on the closing line", () => {
    const content = ["import {", "  Codex,", '} from "@openai/codex-sdk";'].join("\n");
    const hits = scanSchedulerBypass({ content, path: "src/elsewhere.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toBe(3);
  });

  it("does NOT flag a file that merely NAMES the package in a string constant — a gate is not an import", () => {
    const content = [
      'const CODEX_SDK_SPECIFIER = "@openai/codex-sdk";',
      'const owners = { "@openai/codex-sdk": "src/codex/client.ts" };',
    ].join("\n");
    expect(scanSchedulerBypass({ content, path: "src/devLint/boundaryResidue.ts" })).toEqual([]);
  });

  it("names src/codex/client.ts as the sole owner of the Codex SDK package", () => {
    expect(RESTRICTED_PACKAGE_OWNERS["@openai/codex-sdk"]).toBe("src/codex/client.ts");
  });
});

describe("bypassMessage", () => {
  it("tells a restricted-import author to use the adapter rather than the SDK", () => {
    const message = bypassMessage({
      hit: {
        excerpt: 'import { Codex as Brain } from "@openai/codex-sdk";',
        label: "@openai/codex-sdk",
        line: 2,
        path: "src/codex/runPass.ts",
        reason: "restricted-import",
      },
    });
    expect(message).toContain("src/codex/runPass.ts:2");
    expect(message).toContain("src/codex/client.ts");
    expect(message).toContain("Import the adapter, not the SDK");
  });

  it("explains an unsanctioned factory without claiming Codex belongs to the rate registry", () => {
    const message = bypassMessage({
      hit: {
        excerpt: "new Codex(",
        label: "codex-client",
        line: 7,
        path: "src/codex/runTurn.ts",
        reason: "unsanctioned-factory",
      },
    });
    expect(message).toContain("src/codex/runTurn.ts:7");
    expect(message).toContain("SANCTIONED_CLIENT_FACTORIES");
    expect(message).toContain("codex-client");
    expect(message).toContain("closed locked options");
    // The remedy must NOT send a Codex author to the rate door: Codex has no rate registry to belong to.
    expect(message).not.toContain("providerCall.ts");
  });

  it("still explains the rate block for a PROVIDER client, whose choke point is the 429 door", () => {
    const message = bypassMessage({
      hit: {
        excerpt: "new WebClient(",
        label: "slack-web-client",
        line: 4,
        path: "src/somewhere/new.ts",
        reason: "unsanctioned-factory",
      },
    });
    expect(message).toContain("src/lib/providerCall.ts");
    expect(message).not.toContain("read-only");
  });

  it("names the missing marker for a sanctioned factory", () => {
    const message = bypassMessage({
      hit: {
        excerpt: "new WebClient(",
        label: "slack-web-client",
        line: 3,
        path: "src/corpus/slack/api.ts",
        reason: "missing-marker",
      },
    });
    expect(message).toContain("src/corpus/slack/api.ts:3");
    expect(message).toContain("devlint: sdk-factory");
  });
});

describe("isScannablePath", () => {
  it("accepts a non-test source under src/ or eval/ and rejects tests, non-ts and the gate's own files", () => {
    expect(isScannablePath({ path: "src/codex/client.ts" })).toBe(true);
    expect(isScannablePath({ path: "eval/askProvider.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/codex/client.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/codex/notes.md" })).toBe(false);
    expect(isScannablePath({ path: "scripts/build.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/schedulerBypass.ts" })).toBe(false);
  });
});
