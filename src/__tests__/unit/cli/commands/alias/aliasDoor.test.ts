/*
 * The door request an alias write makes, and the exit code a write the door did not perform ends on: the
 * zone is the request's destination, and only a store that could not record the decision is an error.
 */
import { describe, expect, it } from "vitest";

import type { NotPerformed } from "../../../../../admit/doorRefusal.js";
import { DoorStoreErrors } from "../../../../../admit/doorStoreErrors.js";
import type { DoorDecision } from "../../../../../admit/types.js";
import { aliasDoorRequest, notPerformedExit } from "../../../../../cli/commands/alias/aliasDoor.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../../../../cli/exitCodes.js";

/** A door that warned on one registered finding, so it admitted nothing. */
const WARNING_DECISION: DoorDecision = {
  findings: [
    {
      code: "answer.skill-load",
      correction: "read the skill, then name it in grounding.provenance.skillsLoaded",
      override: "answer.skill-load:v1",
      severity: "warn",
      summary: "no skill was loaded for an ask a skill covers",
    },
  ],
  overridden: [],
  status: "warn",
};

describe("aliasDoorRequest", () => {
  it("names the mailbox as the artifact and the zone as where a provision lands", () => {
    expect(
      aliasDoorRequest({ address: "claude-five@acme.com", home: "/fixture/home", verb: "provision", zone: "acme.com" }),
    ).toStrictEqual({
      action: { kind: "verb", noun: "alias", verb: "provision" },
      artifact: { address: "claude-five@acme.com", destination: "acme.com", id: "alias:claude-five@acme.com" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/fixture/home", requiresApproval: false },
    });
  });

  it("carries a catch-all's wildcard address through unchanged", () => {
    expect(
      aliasDoorRequest({ address: "*@acme.com", home: "/fixture/home", verb: "catch-all", zone: "acme.com" }),
    ).toStrictEqual({
      action: { kind: "verb", noun: "alias", verb: "catch-all" },
      artifact: { address: "*@acme.com", destination: "acme.com", id: "alias:*@acme.com" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/fixture/home", requiresApproval: false },
    });
  });
});

describe("notPerformedExit", () => {
  it("ends a write the door declined on expected-empty", () => {
    const through = { decision: WARNING_DECISION, kind: "door-refused", performed: false } satisfies NotPerformed;
    expect(notPerformedExit({ through })).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("ends a write whose decision the store could not record on an error", () => {
    const through = {
      decision: { findings: [], overridden: [], status: "pass" },
      error: DoorStoreErrors.storeUnavailable({ doing: "be opened", reason: "fixture: the store is down" }),
      kind: "recording-refused",
      performed: false,
    } satisfies NotPerformed;
    expect(notPerformedExit({ through })).toBe(EXIT_ERROR);
  });
});
