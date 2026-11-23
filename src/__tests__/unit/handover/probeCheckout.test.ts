import { describe, expect, it } from "vitest";

import { classifyProbeCheckout, type ProbeCheckout, probeCheckoutNotice } from "../../../handover/probeCheckout.js";

/** A comparison seam that is plain string equality — a fake passed in, so the rule is tested over literals. */
const samePlace = ({ left, right }: { left: string; right: string }): boolean => left === right;

const MAIN = "/repos/slopweaver";
const WORKTREE = "/repos/slopweaver/.claude/worktrees.noindex/some-slug";

describe("classifyProbeCheckout", () => {
  it("substitutes the session's worktree when it is a linked worktree of the doc's repo", () => {
    const checkout = classifyProbeCheckout({
      cwdMainCheckout: MAIN,
      cwdRoot: () => WORKTREE,
      docRepo: MAIN,
      samePlace,
    });
    expect(checkout.kind).toBe("session-worktree");
    expect(checkout.dir).toBe(WORKTREE);
  });

  it("keeps the doc's repo when the caller stands in that repo itself", () => {
    const checkout = classifyProbeCheckout({
      cwdMainCheckout: MAIN,
      cwdRoot: () => MAIN,
      docRepo: MAIN,
      samePlace,
    });
    expect(checkout.kind).toBe("doc-repo");
    expect(checkout.dir).toBe(MAIN);
  });

  it("keeps the doc's repo when the caller stands in a worktree of a DIFFERENT repository", () => {
    const checkout = classifyProbeCheckout({
      cwdMainCheckout: "/repos/other",
      cwdRoot: () => "/repos/other/.claude/worktrees.noindex/x",
      docRepo: MAIN,
      samePlace,
    });
    expect(checkout.kind).toBe("doc-repo");
    expect(checkout.dir).toBe(MAIN);
  });

  it("keeps the doc's repo, WITHOUT reading a toplevel, when the caller is not in a repository at all", () => {
    // The witness for the laziness: `git rev-parse --show-toplevel` prints a fatal on a cwd outside a
    // repository, and this decision is reached on every lifecycle verb.
    let reads = 0;
    const checkout = classifyProbeCheckout({
      cwdMainCheckout: undefined,
      cwdRoot: () => {
        reads += 1;
        return "/tmp/nowhere";
      },
      docRepo: MAIN,
      samePlace,
    });
    expect(reads).toBe(0);
    expect(checkout.kind).toBe("doc-repo");
    expect(checkout.dir).toBe(MAIN);
  });

  it("reads the toplevel once the caller IS in a repository, so the laziness witness can fire", () => {
    let reads = 0;
    const checkout = classifyProbeCheckout({
      cwdMainCheckout: MAIN,
      cwdRoot: () => {
        reads += 1;
        return WORKTREE;
      },
      docRepo: MAIN,
      samePlace,
    });
    expect(reads).toBe(1);
    expect(checkout.kind).toBe("session-worktree");
  });

  it("folds a spelling difference through the comparison seam rather than comparing strings itself", () => {
    // `/private`-prefixed on darwin, the worktrees alias, a symlinked parent — `sameDirectory` resolves all
    // three, and the classifier must ask it rather than deciding on bytes.
    const foldsPrivate = ({ left, right }: { left: string; right: string }): boolean =>
      left.replace("/private", "") === right.replace("/private", "");
    const checkout = classifyProbeCheckout({
      cwdMainCheckout: "/private/repos/slopweaver",
      cwdRoot: () => WORKTREE,
      docRepo: MAIN,
      samePlace: foldsPrivate,
    });
    expect(checkout.kind).toBe("session-worktree");
    expect(checkout.dir).toBe(WORKTREE);
  });
});

describe("probeCheckoutNotice", () => {
  it("names both trees when the probes moved", () => {
    const checkout: ProbeCheckout = { dir: WORKTREE, kind: "session-worktree" };
    expect(probeCheckoutNotice({ checkout, docRepo: MAIN, said: new Set() })).toBe(
      `  probes resolve against this session's worktree ${WORKTREE}, not the main checkout ${MAIN}`,
    );
  });

  it("says the line once, because a verb evaluates its probes more than once per invocation", () => {
    const checkout: ProbeCheckout = { dir: WORKTREE, kind: "session-worktree" };
    const said = new Set<string>();
    const first = probeCheckoutNotice({ checkout, docRepo: MAIN, said });
    expect(first).toBe(`  probes resolve against this session's worktree ${WORKTREE}, not the main checkout ${MAIN}`);
    expect(probeCheckoutNotice({ checkout, docRepo: MAIN, said })).toBe(undefined);
    expect(probeCheckoutNotice({ checkout, docRepo: MAIN, said: new Set() })).toBe(first);
  });

  it("says nothing when the doc's own repo was used", () => {
    const checkout: ProbeCheckout = { dir: MAIN, kind: "doc-repo" };
    expect(probeCheckoutNotice({ checkout, docRepo: MAIN, said: new Set() })).toBe(undefined);
  });
});
