/**
 * `github stack push`'s body gates, called directly: a live push refuses a body the PR gate rejects and prints
 * why, a dry run carries on past the same body so the preview can print it, and the identifiers the reader
 * returned are carried forward on the verdict so the create is gated with the value its preview was.
 */
import { describe, expect, it } from "vitest";

import { stackPushBodyVerdict } from "../../../../../cli/commands/github/stackPushBodyVerdict.js";
import { parseGithubStackPushArgs } from "../../../../../cli/commands/github/stackPushCore.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import type { PrFormDraft } from "../../../../../outbound/github/types.js";
import { fakeApi } from "../../../../githubPrHarness.js";
import { harness, tempHome, useTempHomes } from "./stackPushRun/harness.js";

useTempHomes();

// Assembled at runtime, so this file never carries a credential shape of its own.
const TOKEN = `ghp_${"a".repeat(30)}`;
const LEAKING: PrFormDraft = { ...EXAMPLE_PR_FORM, explainer: [{ kind: "text", text: `rotated ${TOKEN} today` }] };

function argsFor({ dryRun }: { dryRun: boolean }): ReturnType<typeof parseGithubStackPushArgs> {
  return parseGithubStackPushArgs({ argv: ["--form", "{}", ...(dryRun ? ["--dry-run"] : [])] });
}

describe("stackPushBodyVerdict", () => {
  it("refuses a live push whose body fails the PR gate, printing the refusal", async () => {
    const { deps, lines } = harness({ api: fakeApi({}) });
    const verdict = await stackPushBodyVerdict({
      args: unwrap(argsFor({ dryRun: false })),
      deps,
      form: LEAKING,
      home: tempHome(),
    });
    expect(unwrapErr(verdict)).toBe(EXIT_ERROR);
    expect(lines.filter((line) => line.startsWith("refused: the rendered body fails the PR gate"))).toHaveLength(1);
  });

  it("does not refuse the same body on a dry run, which prints rather than refuses", async () => {
    const { deps, lines } = harness({ api: fakeApi({}) });
    const verdict = await stackPushBodyVerdict({
      args: unwrap(argsFor({ dryRun: true })),
      deps,
      form: LEAKING,
      home: tempHome(),
    });
    expect(lines.filter((line) => line.startsWith("refused: the rendered body fails the PR gate"))).toStrictEqual([]);
    expect(unwrap(verdict).installationIdentifiers).toBeUndefined();
  });

  it("carries the identifiers the reader returned forward on the verdict", async () => {
    const { deps: base } = harness({ api: fakeApi({}) });
    const identifiers = { linearTeamKeys: ["ZZT"], personNames: [], providerLocationLabels: ["wobble"] };
    const deps = { ...base, installationIdentifiers: () => Promise.resolve({ identifiers, unread: [] }) };
    const verdict = await stackPushBodyVerdict({
      args: unwrap(argsFor({ dryRun: true })),
      deps,
      form: EXAMPLE_PR_FORM,
      home: tempHome(),
    });
    expect(unwrap(verdict).installationIdentifiers).toStrictEqual(identifiers);
  });
});
