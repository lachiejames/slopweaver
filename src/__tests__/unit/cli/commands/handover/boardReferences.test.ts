/**
 * Each doc's `repo:` path becomes the `owner/repo` a card resolves a bare number against — a captured card named its
 * pull request by number alone, and the local path was the one field saying whose they were.
 */
import { describe, expect, it } from "vitest";
import { ORIGIN_READS_BUDGET_MS, repositorySlugs } from "../../../../../cli/commands/handover/boardReferences.js";
import type { Repository } from "../../../../../config.js";
import { err, ok, type Result } from "../../../../../lib/result.js";

describe("repositorySlugs", () => {
  it("maps each distinct path to its origin, asking once per path, and drops one with no origin", () => {
    const asked: string[] = [];
    const resolve = ({ cwd }: { cwd: string }): Result<Repository> => {
      asked.push(cwd);
      if (cwd === "/dev/acme-admin") {
        return ok({ owner: "acme", repo: "acme-admin" });
      }
      return err(["no `origin` git remote found"]);
    };

    const slugs = repositorySlugs({
      now: () => 0,
      paths: ["/dev/acme-admin", "/tmp/loose", "/dev/acme-admin"],
      resolve,
    });

    expect([...slugs]).toEqual([["/dev/acme-admin", "acme/acme-admin"]]);
    expect(asked).toEqual(["/dev/acme-admin", "/tmp/loose"]);
  });

  it("is empty for no paths", () => {
    expect(repositorySlugs({ now: () => 0, paths: [], resolve: () => ok({ owner: "o", repo: "r" }) }).size).toBe(0);
  });

  it("stops reading origins once the budget is spent, keeping what it read — the stalled paths", () => {
    let clock = 0;
    const asked: string[] = [];
    const resolve = ({ cwd }: { cwd: string }): Result<Repository> => {
      asked.push(cwd);
      clock += 10_000;
      return ok({ owner: "acme", repo: cwd.slice(1) });
    };
    const paths = ["/a", "/b", "/c", "/d"];

    const slugs = repositorySlugs({ now: () => clock, paths, resolve });

    expect(ORIGIN_READS_BUDGET_MS).toBe(20_000);
    expect(asked).toEqual(["/a", "/b"]);
    expect([...slugs.values()]).toEqual(["acme/a", "acme/b"]);
  });

  it("stops at the command's own deadline, which the probe sweep before it may already have spent", () => {
    const asked: string[] = [];
    let spent = false;
    const resolve = ({ cwd }: { cwd: string }): Result<Repository> => {
      asked.push(cwd);
      spent = true;
      return ok({ owner: "acme", repo: cwd.slice(1) });
    };

    const slugs = repositorySlugs({ deadline: { expired: () => spent }, now: () => 0, paths: ["/a", "/b"], resolve });

    expect(asked).toEqual(["/a"]);
    expect([...slugs.values()]).toEqual(["acme/a"]);
    expect(repositorySlugs({ deadline: { expired: () => true }, now: () => 0, paths: ["/a"], resolve }).size).toBe(0);
  });
});
