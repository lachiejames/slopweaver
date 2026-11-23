/*
 * `parseAnswerArm`'s bare-reference resolution: a resolvable reference in the body is linkified, an unresolved
 * one is refused by name, and only this session's live bare-refs grant, read from the home the verb resolved,
 * sends it unchanged. It moved here when `parseAnswerArm.test.ts` was split by behaviour.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { parseAnswerArm } from "../../../../../outbound/assistant/answerForm.js";
import type { BareRefContext } from "../../../../../outbound/linkify/bareRefs.js";
import { grantedEnv } from "../../../../hatchGrantFixture.js";
import { answerRaw, envGranting, envWithoutGrant, NO_CONTEXT, useHomes } from "./harness.js";

const ONE_REPO: BareRefContext = { repos: [{ owner: "acme", repo: "widget" }] };

const homes = useHomes();

describe("parseAnswerArm — bare-reference resolution", () => {
  it("linkifies a resolvable bare reference in the body", () => {
    const answer = unwrap(
      parseAnswerArm({ context: ONE_REPO, raw: answerRaw({ bodyText: "fixed in #42 today", leadText: "fixed" }) }),
    );
    expect(answer.body).toEqual([
      {
        runs: [
          { text: "fixed in ", type: "text" },
          { label: "#42", type: "link", url: "https://github.com/acme/widget/issues/42" },
          { text: " today", type: "text" },
        ],
        type: "paragraph",
      },
    ]);
  });

  it("refuses when a bare reference cannot resolve, naming it", () => {
    const result = parseAnswerArm({
      context: NO_CONTEXT,
      raw: answerRaw({ bodyText: "closed: 100, 200", leadText: "closed" }),
    });
    expect(result.isErr()).toBe(true);
    expect(result.isErr() ? result.error.length : 0).toBe(2);
  });

  it("sends the answer unchanged under a live bare-refs grant, even with an unresolved reference", () => {
    const raw = answerRaw({ bodyText: "closed: 100, 200", leadText: "closed" });
    const result = parseAnswerArm({ context: NO_CONTEXT, env: envGranting({ hatchIds: ["bare-refs"] }), raw });
    expect(result.isOk()).toBe(true);
  });

  it("reads the grant from the home the verb resolved, never the ambient home the environment names", () => {
    const raw = answerRaw({ bodyText: "closed: 100, 200", leadText: "closed" });
    const ambientHome = mkdtempSync(join(tmpdir(), "parse-answer-arm-"));
    const verbHome = mkdtempSync(join(tmpdir(), "parse-answer-arm-"));
    homes.push(ambientHome, verbHome);
    const env = grantedEnv({ hatchIds: ["bare-refs"], home: ambientHome });
    const refusals = unwrapErr(parseAnswerArm({ context: NO_CONTEXT, env, home: verbHome, raw }));
    expect(refusals.length).toBe(2);
    expect(refusals[0]).toContain("slopweaver hatch open bare-refs");
    expect(parseAnswerArm({ context: NO_CONTEXT, env, home: ambientHome, raw }).isOk()).toBe(true);
  });

  it("still refuses an unresolved reference with the old variable set and no grant", () => {
    const raw = answerRaw({ bodyText: "closed: 100, 200", leadText: "closed" });
    const env = envWithoutGrant({ variables: { SLOPWEAVER_ALLOW_BARE_REFS: "1" } });
    const refusals = unwrapErr(parseAnswerArm({ context: NO_CONTEXT, env, raw }));
    expect(refusals.length).toBe(2);
    expect(refusals[0]).toContain("slopweaver hatch open bare-refs");
  });

  it("refuses a bare reference in the plain-string lead, which has no run to become", () => {
    const result = parseAnswerArm({
      context: NO_CONTEXT,
      raw: answerRaw({ bodyText: "nothing here", leadText: "closed: 100, 200" }),
    });
    expect(result.isErr()).toBe(true);
    expect(result.isErr() ? result.error[0] : "").toContain("lead");
  });
});
