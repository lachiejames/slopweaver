/**
 * The install's Linear workspace and team keys, read best-effort off the silver directory — what turns a bare
 * `QQQQ-134` into its address on a queue card and in an outbound write.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { linearReferenceFacts } from "../../../cli/linearReferenceFacts.js";
import { silverStructuresPath } from "../../../corpus/corpusPaths.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home whose silver directory holds exactly `text`, or nothing when `text` is absent. */
function homeWith({ text }: { text?: string }): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-linear-facts-"));
  homes.push(home);
  if (text !== undefined) {
    const structures = silverStructuresPath({ home });
    mkdirSync(dirname(structures), { recursive: true });
    writeFileSync(structures, text);
  }
  return home;
}

describe("linearReferenceFacts", () => {
  it("reads the workspace slug and every team key the directory names", () => {
    const home = homeWith({
      text: JSON.stringify({
        directory: {
          orgs: [{ slug: "acme", source: "linear" }],
          teams: [
            { slug: "SECU", source: "linear" },
            { slug: "INFR", source: "linear" },
          ],
        },
      }),
    });

    expect(linearReferenceFacts({ home })).toEqual({ teamKeys: ["SECU", "INFR"], workspaceSlug: "acme" });
  });

  it("is empty when derive never wrote a directory", () => {
    expect(linearReferenceFacts({ home: homeWith({}) })).toEqual({ teamKeys: [], workspaceSlug: undefined });
  });

  it("is empty when the file is not JSON", () => {
    expect(linearReferenceFacts({ home: homeWith({ text: "{not json" }) })).toEqual({
      teamKeys: [],
      workspaceSlug: undefined,
    });
  });

  it("keeps the team keys when the directory names no workspace", () => {
    const home = homeWith({ text: JSON.stringify({ directory: { teams: [{ slug: "SECU", source: "linear" }, {}] } }) });

    expect(linearReferenceFacts({ home })).toEqual({ teamKeys: ["SECU"], workspaceSlug: undefined });
  });

  it("reads Linear's own org and teams, never another provider's that the directory lists first", () => {
    const home = homeWith({
      text: JSON.stringify({
        directory: {
          orgs: [
            { slug: null, source: "github" },
            { slug: "acme-group", source: "slack" },
            { slug: "acme", source: "linear" },
          ],
          teams: [
            { slug: "acme-eng", source: "github" },
            { slug: "SECU", source: "linear" },
          ],
        },
      }),
    });

    expect(linearReferenceFacts({ home })).toEqual({ teamKeys: ["SECU"], workspaceSlug: "acme" });
  });

  it("names no workspace when the directory holds two Linear orgs — a retained old workspace", () => {
    const home = homeWith({
      text: JSON.stringify({
        directory: {
          orgs: [
            { slug: "acme", source: "linear" },
            { slug: "acme-old", source: "linear" },
          ],
          teams: [{ slug: "SECU", source: "linear" }],
        },
      }),
    });

    expect(linearReferenceFacts({ home })).toEqual({ teamKeys: ["SECU"], workspaceSlug: undefined });
  });

  it("names no workspace when the one Linear slug is not a URL key — an unvalidated interpolation", () => {
    const slugs = ["evil/../x", "a b", "x)](https://evil.test)", "..", "-lead", "", "acme.hq"];
    const facts = slugs.map((slug) =>
      linearReferenceFacts({
        home: homeWith({
          text: JSON.stringify({
            directory: { orgs: [{ slug, source: "linear" }], teams: [{ slug: "SECU", source: "linear" }] },
          }),
        }),
      }),
    );

    expect(facts).toEqual(slugs.map(() => ({ teamKeys: ["SECU"], workspaceSlug: undefined })));
  });

  it("stays ambiguous when one of two Linear orgs is malformed, never selecting the valid one", () => {
    const home = homeWith({
      text: JSON.stringify({
        directory: {
          orgs: [
            { slug: "acme", source: "linear" },
            { slug: "x)/../evil", source: "linear" },
          ],
          teams: [],
        },
      }),
    });

    expect(linearReferenceFacts({ home })).toEqual({ teamKeys: [], workspaceSlug: undefined });
  });

  it("keeps a URL key carrying digits, a hyphen and an underscore", () => {
    const home = homeWith({
      text: JSON.stringify({ directory: { orgs: [{ slug: "acme_hq-2", source: "linear" }], teams: [] } }),
    });

    expect(linearReferenceFacts({ home })).toEqual({ teamKeys: [], workspaceSlug: "acme_hq-2" });
  });

  it("never opens a FIFO at the path — a hang", () => {
    const home = homeWith({});
    const structures = silverStructuresPath({ home });
    mkdirSync(dirname(structures), { recursive: true });
    execFileSync("mkfifo", [structures]);

    expect(linearReferenceFacts({ home })).toEqual({ teamKeys: [], workspaceSlug: undefined });
  });

  it("reads a null directory, a non-array list and a non-string slug as nothing — a crash", () => {
    const shapes = [
      { directory: null },
      { directory: { orgs: "acme", teams: { slug: "SECU" } } },
      { directory: { orgs: [null, { slug: 7 }], teams: [42, { slug: ["SECU"] }] } },
      [],
    ];

    expect(shapes.map((shape) => linearReferenceFacts({ home: homeWith({ text: JSON.stringify(shape) }) }))).toEqual(
      shapes.map(() => ({ teamKeys: [], workspaceSlug: undefined })),
    );
  });
});
