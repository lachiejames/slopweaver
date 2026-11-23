/**
 * Unit: the read-only rail on the Google SecOps door — what its code must never be able to express.
 *
 * SecOps is approved as a read-only data source: nothing ever writes onto SecOps, neither via API nor the
 * browser. The `chronicle.readonly` scope cannot carry that alone —
 * it gates several POST methods Chronicle classes as reads, and a later `cloud-platform` would gate every
 * write — so the rail is the CODE: one HTTP method, one host family, no SDK that exposes a write. These read
 * source rather than behaviour because the property is an absence, and an absence has no call to observe.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

import { GOOGLE_SECOPS_SURFACES } from "../../../../atlas/googleSecops/generated/surfaces.js";
import type { SecopsHttpMethod } from "../../../../live/googleSecops/transport.js";

/** The door's three trees: its transport, its atlas, and its verb. */
const ROOTS = ["src/live/googleSecops", "src/atlas/googleSecops", "src/cli/commands/atlas/googleSecops"];

/** Every TypeScript file under one directory, recursively. */
function tsFilesUnder({ dir }: { dir: string }): readonly string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return tsFilesUnder({ dir: path });
    }
    return name.endsWith(".ts") ? [path] : [];
  });
}

/** Every source file of the door, read once. */
function doorSources(): readonly { readonly path: string; readonly text: string }[] {
  return ROOTS.flatMap((dir) => tsFilesUnder({ dir })).map((path) => ({ path, text: readFileSync(path, "utf8") }));
}

/** Every string a file's CODE spells — literals and template text, never a comment. */
function codeStrings({ path, text }: { path: string; text: string }): readonly string[] {
  const found: string[] = [];
  const visit: NodeVisitor = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push(node.text);
    }
    if (ts.isTemplateExpression(node)) {
      found.push([node.head.text, ...node.templateSpans.map((span) => `\${}${span.literal.text}`)].join(""));
    }
    forEachChild({ node, visit });
  };
  withSourceFile({ fileName: path, text, use: (source) => visit(source) });
  return found;
}

/**
 * The only `https://` prefixes the door's code may spell: its instance's regional host, Google's OAuth
 * scope identifiers (names, never called), and — in the pinned lock only — the commit-addressed raw files
 * `tools/` fetched at build time.
 */
function permittedUrl({ path, url }: { path: string; url: string }): boolean {
  if (/^https:\/\/\$\{\}-chronicle\.googleapis\.com$/.test(url)) {
    return true;
  }
  if (url.startsWith("https://www.googleapis.com/auth/")) {
    return true;
  }
  return path.endsWith("generated/protoLock.ts") && url.startsWith("https://raw.githubusercontent.com/googleapis/");
}

describe("the SecOps door can only send a GET", () => {
  it("finds the door's sources (an empty glob would pass every check below vacuously)", () => {
    expect(doorSources().length).toBeGreaterThan(0);
  });

  it("spells no HTTP method but GET as a `method:` value anywhere in the door", () => {
    const offenders = doorSources().flatMap(({ path, text }) =>
      [...text.matchAll(/\bmethod:\s*["'`]([A-Za-z]+)["'`]/g)]
        .map((match) => match[1]!)
        .filter((method) => method !== "GET")
        .map((method) => `${path}: ${method}`),
    );
    expect(offenders).toStrictEqual([]);
  });

  it("types the method as a union of one, so a second member is a compile error rather than a review note", () => {
    const get: SecopsHttpMethod = "GET";
    // @ts-expect-error — POST is not a method this door can send.
    const post: SecopsHttpMethod = "POST";
    expect([get, post]).toStrictEqual(["GET", "POST"]);
  });

  it("marks only GET rows of the pinned inventory as entity reads", () => {
    expect(GOOGLE_SECOPS_SURFACES.length).toBeGreaterThan(0);
    const writes = GOOGLE_SECOPS_SURFACES.filter((row) => row.disposition === "entity" && row.httpMethod !== "GET");
    expect(writes.map((row) => row.id)).toStrictEqual([]);
  });
});

describe("the SecOps door can only reach its own instance's host", () => {
  it("spells no URL in code outside the instance's regional host, the scope names and the pinned lock", () => {
    const urls = doorSources().flatMap(({ path, text }) =>
      codeStrings({ path, text })
        .filter((value) => value.includes("https://"))
        .map((value) => ({ path, url: value.slice(value.indexOf("https://")) })),
    );
    expect(urls.length).toBeGreaterThan(0);
    const offenders = urls.filter(({ path, url }) => !permittedUrl({ path, url }));
    expect(offenders).toStrictEqual([]);
  });

  it("imports no Google SDK that carries the write methods on the same client", () => {
    const offenders = doorSources().filter(({ text }) =>
      /from\s+["'](?:@google-cloud\/chronicle|googleapis|google-auth-library)(?:\/[^"']*)?["']/.test(text),
    );
    expect(offenders.map(({ path }) => path)).toStrictEqual([]);
  });
});
