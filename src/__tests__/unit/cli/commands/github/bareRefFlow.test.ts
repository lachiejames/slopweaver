/**
 * The bare-reference gate a pull-request write passes through: a resolvable bare number becomes a link in every
 * field it appears in, a number too large to be the target repo's own is refused, and every refusal is
 * printed on the `refused:` channel before the flow returns nothing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { linkifiedPrFormOrReported } from "../../../../../cli/commands/github/bareRefFlow.js";
import type { GithubPrDeps } from "../../../../../cli/commands/github/prDeps.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import type { PrFormDraft } from "../../../../../outbound/github/types.js";
import { bareRefsEscapeSentence } from "../../../../../outbound/linkify/bareRefsHatch.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** An explicit, empty home: no grant journal, so the bare-reference hatch is closed. */
function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-bare-ref-flow-"));
  fixtureDirs.push(dir);
  return dir;
}

/** The two edges the gate reads: an environment with nothing set, and a sink recording every line. */
function deps(): { deps: Pick<GithubPrDeps, "env" | "out">; lines: string[] } {
  const lines: string[] = [];
  const env: GithubPrDeps["env"] = () => undefined;
  const out: GithubPrDeps["out"] = ({ line }) => {
    lines.push(line);
  };
  return { deps: { env, out }, lines };
}

/** The canonical example form with its explainer and its one check replaced. */
function formSaying({ explainer, check }: { explainer: string; check: string }): PrFormDraft {
  return {
    ...EXAMPLE_PR_FORM,
    checks: [[{ kind: "text", text: check }]],
    explainer: [{ kind: "text", text: explainer }],
  };
}

describe("linkifiedPrFormOrReported", () => {
  it("returns a form with no bare reference unchanged and prints nothing", () => {
    const { deps: edges, lines } = deps();
    const result = linkifiedPrFormOrReported({ deps: edges, form: EXAMPLE_PR_FORM, home: freshHome() });
    expect(result).toEqual(EXAMPLE_PR_FORM);
    expect(lines).toEqual([]);
  });

  it("on an update, linkifies a same-repo number in every field it appears in, against the known number", () => {
    const { deps: edges, lines } = deps();
    const result = linkifiedPrFormOrReported({
      deps: edges,
      form: formSaying({ check: "#34 reads back", explainer: "follows #12 closely" }),
      home: freshHome(),
      knownNumber: 40,
    });
    expect(result).toEqual({
      ...EXAMPLE_PR_FORM,
      checks: [
        [
          { kind: "link", text: "#34", url: "https://github.com/acme/widgets/issues/34" },
          { kind: "text", text: " reads back" },
        ],
      ],
      explainer: [
        { kind: "text", text: "follows " },
        { kind: "link", text: "#12", url: "https://github.com/acme/widgets/issues/12" },
        { kind: "text", text: " closely" },
      ],
    });
    expect(lines).toEqual([]);
  });

  it("on a create, refuses the same two-digit number once the form's own links attest only one digit", () => {
    // The explainer links issue 1 of acme/widgets, so with no known number the largest number proven to exist in
    // acme/widgets is 1, and a two-digit bare number cannot be one of its own.
    const { deps: edges, lines } = deps();
    const explainer = [{ kind: "link" as const, text: "the issue", url: "https://github.com/acme/widgets/issues/1" }];
    const result = linkifiedPrFormOrReported({
      deps: edges,
      form: { ...EXAMPLE_PR_FORM, checks: [[{ kind: "text", text: "follows #12 closely" }]], explainer },
      home: freshHome(),
      knownNumber: undefined,
    });
    expect(result).toBeUndefined();
    expect(lines).toEqual([
      'refused: checks.0: "#12" would resolve to acme/widgets#12, but the largest number known to exist in ' +
        "acme/widgets here is 1 — a 2-digit number cannot be one of its own. Write it as " +
        `"owner/repo#12" so it points at the repository it is from. ${bareRefsEscapeSentence()}`,
    ]);
  });

  it("refuses every implausibly large number, printing one refusal per reference in field order", () => {
    const { deps: edges, lines } = deps();
    const result = linkifiedPrFormOrReported({
      deps: edges,
      form: formSaying({ check: "#15900 regressed and #12 was fine", explainer: "ports #16658 here" }),
      home: freshHome(),
      knownNumber: 40,
    });
    expect(result).toBeUndefined();
    expect(lines).toEqual([
      'refused: explainer: "#16658" would resolve to acme/widgets#16658, but the largest number known to exist in ' +
        "acme/widgets here is 40 — a 5-digit number cannot be one of its own. Write it as " +
        `"owner/repo#16658" so it points at the repository it is from. ${bareRefsEscapeSentence()}`,
      'refused: checks.0: "#15900" would resolve to acme/widgets#15900, but the largest number known to exist in ' +
        "acme/widgets here is 40 — a 5-digit number cannot be one of its own. Write it as " +
        `"owner/repo#15900" so it points at the repository it is from. ${bareRefsEscapeSentence()}`,
    ]);
  });
});
