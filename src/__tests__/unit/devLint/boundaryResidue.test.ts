import { describe, expect, it } from "vitest";
import { isScannablePath, scanBoundaryContent, stripNoise } from "../../../devLint/boundaryResidue.js";

describe("scanBoundaryContent (pure)", () => {
  it("flags a raw boundary try/catch (an unwrapped SDK call in a try body)", () => {
    const content = ["try {", "  const r = await client.conversations.history({ channel });", "} catch (e) {}"].join(
      "\n",
    );
    const hits = scanBoundaryContent({ content, path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.label).toBe("sdk-client-call");
    expect(hits[0]!.line).toBe(2);
  });

  it("flags a direct SDK / rawRequest / complete call outside a wrapper", () => {
    const content = [
      "const a = await client.search({ query });",
      "const c = await api.rawRequest(q, v);",
      "const d = await llm.complete(params);",
    ].join("\n");
    const labels = scanBoundaryContent({ content, path: "src/x.ts" }).map((h) => h.label);
    expect(labels).toEqual(["sdk-client-call", "graphql-raw-request", "llm-complete"]);
  });

  it("passes a boundary token wrapped in the wrapper that sanctions IT (single- and multi-line)", () => {
    const content = [
      "const res = orThrow({ result: await safeProviderCall({",
      "  execute: () => client.conversations.history({ channel }),",
      '  operation: "slack.conversations.history",',
      '  provider: "slack",',
      "}) });",
      'const w = safeFs({ execute: () => writeFileSync(p, s), operation: "w" });',
    ].join("\n");
    expect(scanBoundaryContent({ content, path: "src/ok.ts" })).toEqual([]);
  });

  it("flags an SDK call inside safeApiCall — only safeProviderCall sanctions a provider boundary", () => {
    const content = [
      "const res = orThrow({ result: await safeApiCall({",
      "  execute: () => client.conversations.history({ channel }),",
      '  operation: "slack.conversations.history",',
      "}) });",
    ].join("\n");
    const hits = scanBoundaryContent({ content, path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.label).toBe("sdk-client-call");
    expect(hits[0]!.line).toBe(2);
  });

  it("flags an SDK call nested in safeFsAsync — the hole that let a provider call skip the 429 block", () => {
    const content = [
      "const res = await safeFsAsync({",
      "  execute: () => client.chat.postMessage({ channel, text }),",
      '  operation: "sneaky",',
      "});",
    ].join("\n");
    const hits = scanBoundaryContent({ content, path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.label).toBe("sdk-client-call");
  });

  it("passes an SDK call whose INNER wrapper is the provider door, even nested inside another safe*", () => {
    const content = [
      "const res = await safeFsAsync({",
      "  execute: () =>",
      "    safeProviderCall({",
      "      execute: () => client.chat.postMessage({ channel, text }),",
      '      operation: "slack.chat.postMessage",',
      "    }),",
      '  operation: "outer",',
      "});",
    ].join("\n");
    expect(scanBoundaryContent({ content, path: "src/ok.ts" })).toEqual([]);
  });

  it("flags a raw Octokit REST / GraphQL call — the GitHub blind spot this gate used to have", () => {
    const content = [
      "const a = await client.rest.repos.get({ owner, repo });",
      "const b = await client.graphql(q);",
    ].join("\n");
    const labels = scanBoundaryContent({ content, path: "src/x.ts" }).map((h) => h.label);
    expect(labels).toEqual(["octokit-call", "octokit-call"]);
  });

  it("passes an Octokit call inside safeProviderCall", () => {
    const content = [
      "const res = orThrow({ result: await safeProviderCall({",
      "  execute: () => client.rest.repos.get({ owner, repo }),",
      '  operation: "github.repos.get",',
      "}) });",
    ].join("\n");
    expect(scanBoundaryContent({ content, path: "src/ok.ts" })).toEqual([]);
  });

  it("flags a raw client.request call — the escape hatch used for endpoints with no typed method", () => {
    const content = 'const a = await client.request("POST /repos/{owner}/{repo}/stacks", { owner, repo });';
    const labels = scanBoundaryContent({ content, path: "src/x.ts" }).map((h) => h.label);
    expect(labels).toEqual(["octokit-call"]);
  });

  it("passes a client.request call inside safeProviderCall", () => {
    const content = [
      "const res = orThrow({ result: await safeProviderCall({",
      '  execute: () => client.request("POST /repos/{owner}/{repo}/stacks", { owner, repo }),',
      '  operation: "github.stacks.create",',
      "}) });",
    ].join("\n");
    expect(scanBoundaryContent({ content, path: "src/ok.ts" })).toEqual([]);
  });

  it("flags a raw Graph request and each raw MSAL network call outside the provider door", () => {
    const content = [
      'const me = await graph.api("/me").get();',
      "const paged = await graph",
      "  .api(link).get();",
      "await app.getAuthCodeUrl({ scopes });",
      "await app.acquireTokenByCode({ code });",
      "await app.acquireTokenSilent({ account });",
    ].join("\n");
    const labels = scanBoundaryContent({ content, path: "src/live/outlook/x.ts" }).map((h) => h.label);
    expect(labels).toEqual([
      "graph-api-call",
      "graph-api-call",
      "msal-token-call",
      "msal-token-call",
      "msal-token-call",
    ]);
  });

  it("passes a Graph request and an MSAL call inside safeProviderCall", () => {
    const content = [
      "const me = await safeProviderCall({",
      '  execute: () => graph.api("/me").header("Prefer", p).get(),',
      '  operation: "outlook.me.get",',
      "});",
      "const token = await safeProviderCall({",
      "  execute: () => app.acquireTokenSilent({ account, scopes }),",
      '  operation: "outlook.msal.acquireTokenSilent",',
      "});",
    ].join("\n");
    expect(scanBoundaryContent({ content, path: "src/live/outlook/ok.ts" })).toEqual([]);
  });

  it("does NOT flag a seam merely named `api` — only the Graph client's `graph.api(` is the boundary", () => {
    const content = "const state = await deps.api({ number });";
    expect(scanBoundaryContent({ content, path: "src/review/x.ts" })).toEqual([]);
  });

  it("does NOT flag a boundary token NAMED in a comment or string (noise is stripped)", () => {
    const content = [
      "// the raw client.conversations boundary is wrapped elsewhere",
      'const label = "client.search";',
      "/* embedder.embedQuery is described here */",
    ].join("\n");
    expect(scanBoundaryContent({ content, path: "src/ok.ts" })).toEqual([]);
  });

  it("flags a raw Codex model call in the SDK-importing file — the blind spot this gate had for Codex", () => {
    const content = [
      'import { Codex } from "@openai/codex-sdk";',
      "const turn = await thread.run(prompt, { outputSchema });",
      "const streamed = await thread.runStreamed(prompt, {});",
    ].join("\n");
    const hits = scanBoundaryContent({ content, path: "src/codex/client.ts" });
    expect(hits.map((h) => h.label)).toEqual(["codex-thread-call", "codex-thread-call"]);
    expect(hits.map((h) => h.line)).toEqual([2, 3]);
  });

  it("does NOT flag thread CREATION — that is schedulerBypass's job, not this gate's", () => {
    // Creation is synchronous and returns an object, so it cannot sit inside an async `safe*` wrapper.
    // `schedulerBypass` restricts both the SDK import and the construction site to one sanctioned factory,
    // so the invariant is still mechanical — it is just enforced by the gate that can express it.
    const content = [
      'import { Codex } from "@openai/codex-sdk";',
      "const thread = codex.startThread(opts);",
      "const back = codex.resumeThread(id, opts);",
    ].join("\n");
    expect(scanBoundaryContent({ content, path: "src/codex/client.ts" })).toEqual([]);
  });

  it("passes a Codex thread call wrapped in safeCodex", () => {
    const content = [
      'import { Codex } from "@openai/codex-sdk";',
      "const turn = await safeCodex({",
      "  execute: () => thread.run(prompt, { outputSchema, signal }),",
      '  operation: "codex.run",',
      "});",
    ].join("\n");
    expect(scanBoundaryContent({ content, path: "src/codex/client.ts" })).toEqual([]);
  });

  it("flags a Codex call sanctioned by the WRONG wrapper — only safeCodex counts", () => {
    const content = [
      'import { Codex } from "@openai/codex-sdk";',
      "const turn = await safeFs({",
      "  execute: () => thread.run(prompt, { outputSchema, signal }),",
      '  operation: "codex.run",',
      "});",
    ].join("\n");
    const hits = scanBoundaryContent({ content, path: "src/codex/client.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.label).toBe("codex-thread-call");
    expect(hits[0]!.line).toBe(3);
  });

  it("flags `.complete(` even inside another safe wrapper because no headless transport is sanctionable", () => {
    const content = [
      "const turn = await safeCodex({",
      "  execute: () => llm.complete(prompt),",
      '  operation: "codex.run",',
      "});",
    ].join("\n");
    const hits = scanBoundaryContent({ content, path: "src/x.ts" });
    expect(hits.map((hit) => hit.label)).toEqual(["llm-complete"]);
    expect(hits[0]!.line).toBe(2);
  });

  it("does NOT flag `.run(` in a file that does not import the Codex SDK (a limiter's job.run)", () => {
    const content = ["const out = await job.run();", "const r = limiter.run(() => task());"].join("\n");
    expect(scanBoundaryContent({ content, path: "src/lib/resilience.ts" })).toEqual([]);
  });

  it("does NOT flag completeStructured (only a `.complete(` call is the LLM boundary)", () => {
    expect(
      scanBoundaryContent({ content: "const r = await completeStructured({ client });", path: "src/ok.ts" }),
    ).toEqual([]);
  });
});

describe("stripNoise", () => {
  it("blanks comment and string interiors but preserves code + newlines", () => {
    const stripped = stripNoise({ content: 'const x = "client.search"; // client.conversations\ncode()' });
    expect(stripped).not.toContain("client.search");
    expect(stripped).not.toContain("client.conversations");
    expect(stripped).toContain("code()");
    expect(stripped.split("\n")).toHaveLength(2); // newline preserved ⇒ line numbers intact
  });
});

describe("isScannablePath", () => {
  it("includes a non-test TypeScript source under src/", () => {
    expect(isScannablePath({ path: "src/corpus/slack/fetch.ts" })).toBe(true);
  });

  it("excludes the scanner's own files, test files, and non-src/non-ts paths", () => {
    expect(isScannablePath({ path: "src/devLint/boundaryResidue.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/corpus/slack/fetch.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "STACK.md" })).toBe(false);
  });
});
