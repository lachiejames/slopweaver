import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { CandidatesErrors } from "../../../workstreams/candidateErrors.js";
import { parseCandidatesFile } from "../../../workstreams/candidates.js";
import { validCandidates } from "./candidatesFixture.js";

describe("parseCandidatesFile", () => {
  it("refuses a repeated number, naming it", () => {
    const value = validCandidates();
    const candidates = value["candidates"] as Record<string, unknown>[];
    candidates[2]!["n"] = 2;
    const refused = unwrapErr(parseCandidatesFile({ value }));
    expect(refused.code).toBe("CANDIDATES_INVALID");
    expect(refused.message).toContain("candidate number 2 appears twice");
  });

  it("refuses evidence that carries neither a link nor an anchor", () => {
    const value = validCandidates();
    const candidates = value["candidates"] as Record<string, unknown>[];
    candidates[2]!["evidence"] = [{ anchor: null, date: "2026-06-01", href: null, quote: "q" }];
    expect(unwrapErr(parseCandidatesFile({ value })).message).toContain("evidence carries a link or an anchor");
  });
});

describe("parseCandidatesFile enrichment", () => {
  /** The fixture with c-002's definitions of done replaced. */
  function withOptions({ options }: { options: Record<string, unknown>[] }): Record<string, unknown> {
    const value = validCandidates();
    (value["candidates"] as { doneOptions: unknown }[])[1]!.doneOptions = options;
    return value;
  }
  const RESULT = { id: "a", lens: "result", text: "it ships", tradeoff: "fast, shallow" };
  const PEOPLE = { id: "b", lens: "people", text: "they own it", tradeoff: "slow, durable" };

  it("reads an older mine with no enrichment as none offered", () => {
    const parsed = unwrap(parseCandidatesFile({ value: validCandidates() }));
    expect([parsed.candidates[2]!.doneOptions, parsed.candidates[2]!.loopIn, parsed.candidates[2]!.stalled]).toEqual([
      [],
      [],
      null,
    ]);
    expect(parsed.minedSources).toEqual([]);
  });

  it("refuses one lone definition of done", () => {
    const refused = unwrapErr(parseCandidatesFile({ value: withOptions({ options: [PEOPLE] }) }));
    expect(refused.message).toContain("a candidate offers two or three definitions of done, or none");
  });

  it("refuses options none of which is judged by the people it changes", () => {
    const refused = unwrapErr(
      parseCandidatesFile({ value: withOptions({ options: [RESULT, { ...RESULT, id: "c" }] }) }),
    );
    expect(refused.message).toContain("at least one definition of done is judged by the people it changes");
  });

  it("refuses two options sharing an id", () => {
    const refused = unwrapErr(
      parseCandidatesFile({ value: withOptions({ options: [PEOPLE, { ...RESULT, id: "b" }] }) }),
    );
    expect(refused.message).toContain("each definition of done has its own id");
  });

  it("refuses a person to loop in named by anything but a Slack member id", () => {
    const value = validCandidates();
    (value["candidates"] as { loopIn: { slack: string }[] }[])[1]!.loopIn[0]!.slack = "ari";
    expect(unwrapErr(parseCandidatesFile({ value })).message).toContain("a person is their Slack member id");
  });
});

describe("parseCandidatesFile channels", () => {
  it("refuses evidence linking into a Slack channel the file does not name", () => {
    const value = { ...validCandidates(), channels: {} };
    expect(unwrapErr(parseCandidatesFile({ value }))).toEqual(
      CandidatesErrors.invalid({
        problems: ["evidence links into Slack channel C0SYNINCIDENTS, which channels does not name"],
      }),
    );
  });
});

describe("parseCandidatesFile names", () => {
  it("refuses two candidates whose names would become one register id", () => {
    const value = validCandidates();
    (value["candidates"] as { name: string }[])[2]!.name = "postmortems, that happen!";
    const refused = unwrapErr(parseCandidatesFile({ value }));
    expect(refused.message).toContain(
      `c-003 "postmortems, that happen!" names the same workstream as c-002 — merge them into one candidate`,
    );
  });
});
