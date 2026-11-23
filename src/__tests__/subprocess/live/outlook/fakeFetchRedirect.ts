/**
 * The one seam between the spawned `bin/slopweaver outlook …` and `fakeGraphServer.ts`: a preload that
 * rewrites `https://<host>/<path>` to `<origin>/<host>/<path>`. Production code carries no seam of its own.
 */

/**
 * The preload the spawned CLI imports first: every `fetch` to a Microsoft host goes to `origin` instead, and
 * any OTHER non-loopback host is refused outright, so a missed rewrite fails loudly rather than reaching out.
 * Plain ESM, written into the test's own temp directory, so it needs no loader of its own.
 *
 * @param origin the fake's `http://127.0.0.1:<port>`
 * @returns the module source
 */
export function fetchRedirectSource({ origin }: { origin: string }): string {
  return [
    "const realFetch = globalThis.fetch;",
    `const origin = ${JSON.stringify(origin)};`,
    'const rewritten = new Set(["graph.microsoft.com", "login.microsoftonline.com"]);',
    "globalThis.fetch = (input, init) => {",
    '  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;',
    "  const url = new URL(href);",
    "  if (rewritten.has(url.hostname)) {",
    "    const target = `${origin}/${url.hostname}${url.pathname}${url.search}`;",
    "    return input instanceof Request ? realFetch(new Request(target, input), init) : realFetch(target, init);",
    "  }",
    '  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {',
    "    return Promise.reject(new Error(`outlook fixture: refused a fetch to ${url.hostname}`));",
    "  }",
    "  return realFetch(input, init);",
    "};",
  ].join("\n");
}
