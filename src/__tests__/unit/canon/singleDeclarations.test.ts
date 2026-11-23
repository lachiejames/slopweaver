/**
 * One declaration each — the properties an audit's trivial batch restored, held down.
 *
 * Every case reads this repository's real source, because the defect is that the SAME thing was declared more
 * than once and a reader (or a rename) could change one copy and miss the rest. A case that fed an inline
 * fixture to a predicate would prove the predicate, not the tree.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseOpenArgs, parsePeekArgs } from "../../../cli/commands/store/probeCore.js";
import { OPEN_USAGE, PEEK_USAGE } from "../../../cli/commands/store/probeUsage.js";
import { openMeta, peekMeta } from "../../../cli/manifests/storeDetectiveMeta.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REPO = join(SRC, "..");

/** Every non-test `.ts` file under `dir`, repo-relative to `src/`. */
function sourceFiles({ dir }: { dir: string }): readonly string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => relative(SRC, join(entry.parentPath, entry.name)))
    .filter((path) => !path.startsWith("__tests__"));
}

/** A file under `src/`, read whole. */
function read({ path }: { path: string }): string {
  return readFileSync(join(SRC, path), "utf8");
}

describe("the PreToolUse exit codes are declared once", () => {
  // browserDoorGuardRunner.ts is the one runner still declaring its own pair: another audit fix (finding 17)
  // owns that file. The entry stays here, and the equality below fails the day it stops declaring them.
  const STILL_DECLARING = ["admit/browserDoorGuardRunner.ts"];

  it("leaves only the dispatcher, plus the listed debt, declaring EXIT_BLOCK or EXIT_ALLOW", () => {
    const declaring = sourceFiles({ dir: join(SRC, "admit") })
      .filter((path) => /^(export )?const EXIT_(BLOCK|ALLOW) = /mu.test(read({ path })))
      .toSorted();
    expect(declaring).toEqual([...STILL_DECLARING, "admit/preToolUseDispatch.ts"].toSorted());
  });
});

describe("an error factory name is declared once", () => {
  it("never reuses one `<Domain>Errors` object name across two files", () => {
    const declarations = sourceFiles({ dir: SRC })
      .filter((each) => /errors?\.ts$/iu.test(each))
      .flatMap((path) =>
        [...read({ path }).matchAll(/^export const ([A-Za-z]+Errors) = \{/gmu)].map((match) => ({
          name: match[1]!,
          path,
        })),
      );
    const names = declarations.map((declaration) => declaration.name);
    expect(names.length).toBeGreaterThan(0);
    expect(declarations.filter((each) => names.indexOf(each.name) !== names.lastIndexOf(each.name))).toEqual([]);
  });
});

describe("the atlas spec fetch seam is declared once", () => {
  it("has no spec source declaring its own copy of the shared `(url, init) => Promise<{ ok, status, text }>` type", () => {
    const declaring = ["clerk", "geminiAiStudio", "microsoft365"]
      .map((atlas) => `atlas/${atlas}/specSource.ts`)
      .filter((path) => /^export type \w*FetchLike = /mu.test(read({ path })));
    expect(declaring).toEqual([]);
  });
});

describe("the Slopweaver home is resolved in one place", () => {
  it("has the onboarding evaluation store ask `userDefaultHome` rather than build `~/.slopweaver` itself", () => {
    expect(read({ path: "onboardEval/historyStore.ts" })).not.toContain("homedir");
  });
});

describe("a usage line lists every flag the verb accepts", () => {
  it("lists `--source` on `store peek`, which parses it", () => {
    expect(parsePeekArgs({ rest: ["--id", "dd:abc", "--source", "datadog"] }).isOk()).toBe(true);
    expect(PEEK_USAGE).toContain("--source");
  });

  it("lists `--source` on `store open`, which parses it", () => {
    expect(parseOpenArgs({ rest: ["--id", "dd:abc", "--source", "datadog"] }).isOk()).toBe(true);
    expect(OPEN_USAGE).toContain("--source");
  });

  it("shows the same usage in the dispatch-level `--help` manifest as in the verb's own refusal", () => {
    expect(peekMeta.usage).toBe(PEEK_USAGE);
    expect(openMeta.usage).toBe(OPEN_USAGE);
  });
});

describe("canon does not describe a header as stale once it is fixed", () => {
  it("says three Google doors where the document source names three", () => {
    expect(read({ path: "live/providerRead.ts" })).not.toContain("two Google doors");
    expect(readFileSync(join(REPO, ".claude", "rules", "area-live.md"), "utf8")).not.toContain("two Google doors");
  });
});
