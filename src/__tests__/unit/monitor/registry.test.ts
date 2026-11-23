import { describe, expect, it } from "vitest";

import { postingRefusal } from "../../../hand/posting.js";
import { buildHandStep, fleetActorPhrase, UNBLOCKS_CAP, WHAT_CAP } from "../../../hand/step.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { buildArrival, clearedBy, composeHandStep, restartRepairRetireChoice } from "../../../monitor/card.js";
import { handStepId, isMonitorId, MONITORS, monitorDefinition } from "../../../monitor/registry.js";
import type { MonitorSubject } from "../../../monitor/types.js";

const NOW = "2026-09-19T06:00:00.000Z";

/** A subject whose id and label are long enough to be realistic without being contrived. */
function subject(over: Partial<MonitorSubject> = {}): MonitorSubject {
  return {
    id: "octo-self/slopweaver#891",
    key: "octo-self-slopweaver-32c2d0",
    label: "A step only the owner's hands can take reaches the owner where the owner is looking",
    ...over,
  };
}

describe("MONITORS", () => {
  it("declares at least one monitor, so every guard below is true of something", () => {
    expect(MONITORS.length).toBeGreaterThan(0);
  });

  it("declares a unique id and a unique prefix for each", () => {
    expect(new Set(MONITORS.map((monitor) => monitor.id)).size).toBe(MONITORS.length);
    expect(new Set(MONITORS.map((monitor) => monitor.prefix)).size).toBe(MONITORS.length);
  });

  it("names the owner as the actor on every card, which the hand register would otherwise refuse", () => {
    const offending = MONITORS.filter(
      (monitor) => fleetActorPhrase({ what: monitor.what({ subject: subject() }) }) !== undefined,
    );
    expect(offending.map((monitor) => monitor.id)).toEqual([]);
  });

  it("keeps every card's sentence inside the note's own cap", () => {
    const tooLong = MONITORS.filter((monitor) => monitor.what({ subject: subject() }).length > WHAT_CAP);
    expect(tooLong.map((monitor) => monitor.id)).toEqual([]);
  });

  it("says what makes each one stop, because a monitor with no resolve is an alert that never clears", () => {
    const silent = MONITORS.filter((monitor) => monitor.resolves.trim().length === 0);
    expect(silent.map((monitor) => monitor.id)).toEqual([]);
  });

  it("answers `isMonitorId` for every declared id and for nothing else", () => {
    const unknown = MONITORS.filter((monitor) => !isMonitorId(monitor.id));
    expect(unknown.map((monitor) => monitor.id)).toEqual([]);
    expect(isMonitorId("prs-piling-up")).toBe(false);
  });

  it("holds a card while firing only where its key lapses, so a held card never outlives its subject", () => {
    const holding = MONITORS.filter((monitor) => monitor.holdsWhileFiring === true);
    expect(holding.map((monitor) => [monitor.id, monitor.lapsesAt !== undefined])).toEqual([
      ["codex-fleet-capped", true],
      ["fleet-runs-dry", true],
      ["host-week-runs-out", true],
    ]);
  });

  it("looks one up by id", () => {
    expect(monitorDefinition({ monitorId: "prs-backed-up" }).prefix).toBe("prs");
  });

  it("keeps the chair card's two subjects saying different things", () => {
    const chair = monitorDefinition({ monitorId: "chair-off-fable" });
    expect(chair.what({ subject: subject({ key: "unpinned" }) })).toBe(
      "Seat a Fable chair — nothing holds the pin right now",
    );
    expect(chair.what({ subject: subject({ key: "model" }) })).toBe(
      "Seat the chair on Fable — it booted on another model",
    );
  });
});

describe("handStepId", () => {
  it("opens with the monitor prefix so the pass can find its own open steps", () => {
    expect(handStepId({ prefix: "prs", subject: subject() })).toBe("mon-prs-octo-self-slopweaver-32c2d0");
  });
});

describe("composeHandStep", () => {
  it("builds the draft a monitor posts, naming the action and what it unblocks", () => {
    const draft = unwrap(
      composeHandStep({
        definition: monitorDefinition({ monitorId: "prs-backed-up" }),
        nowIso: NOW,
        postedBy: "workspace:29",
        subject: subject(),
      }),
    );
    expect(draft.id).toBe("mon-prs-octo-self-slopweaver-32c2d0");
    expect(draft.what).toBe("Pick a code owner on octo-self/slopweaver#891, so it can land");
    expect(draft.witness).toBe("slopweaver monitor check --fire");
  });

  it("refuses rather than truncating when a subject's own name pushes the sentence past the cap", () => {
    const failure = unwrapErr(
      composeHandStep({
        definition: monitorDefinition({ monitorId: "prs-backed-up" }),
        nowIso: NOW,
        postedBy: "workspace:29",
        subject: subject({ id: "x".repeat(WHAT_CAP + 1) }),
      }),
    );
    expect(failure.code).toBe("CARD_TOO_LONG");
    expect(failure.message).toContain("refuses rather than truncating");
  });
});

describe("clearedBy", () => {
  it("records the monitor's own resolve condition as what happened", () => {
    expect(clearedBy({ definition: monitorDefinition({ monitorId: "bot-off-the-air" }) })).toBe(
      "the monitor cleared: the next heartbeat reports the socket connected",
    );
  });
});

describe("recipe-stopped", () => {
  const recipe = monitorDefinition({ monitorId: "recipe-stopped" });
  const silent = subject({
    id: "vulnfix-digest-acme-admin",
    key: "vulnfix-digest-ev-ad-1a2b3c",
    label: "MISSED: 2 slot(s) of `30 9 * * *` went by unrun; it last ran 2026-09-16T03:46:41Z",
  });

  it("asks the owner to seat a repair nobody has — never to choose how it is fixed", () => {
    expect(recipe.what({ subject: silent })).toBe(
      "Seat a repair for vulnfix-digest-acme-admin — it stopped firing and no seat has it",
    );
  });

  it("offers no monitor card the restart / repair / retire choice, sentence or plain fallback", () => {
    const offering = MONITORS.filter(
      (monitor) =>
        restartRepairRetireChoice({
          texts: [monitor.what({ subject: silent }), monitor.plainWhat].filter((text) => text !== undefined),
        }) !== undefined,
    );
    expect(offering.map((monitor) => monitor.id)).toEqual([]);
  });

  it("declares the work context, which is what ranks its step team-blocked at the top of the queue", () => {
    expect(recipe.context).toBe("work");
    expect(
      unwrap(composeHandStep({ definition: recipe, nowIso: NOW, postedBy: "workspace:29", subject: silent })).context,
    ).toBe("work");
  });

  it("is one of the monitors raising their own floating note — held automations, Codex and a dry fleet, fleet health, a blocked turn's sign-in, a resync's sign-in, a published leak, a meeting entered without its page, a new incident, a steered deliverable at risk, a Claude plan's fault, a Codex reset claim that failed, and a model host's plan week projected to run out", () => {
    // `profile-unloaded` is not on this list: the session reloads its own profile, and the card reports that
    // recovery quietly.
    expect(MONITORS.filter((monitor) => monitor.floats === true).map((monitor) => monitor.id)).toEqual([
      "automation-held-on-you",
      "recipe-stopped",
      "recipe-repairing",
      "corpus-sync-stopped",
      "codex-plan-signed-out",
      "claude-plan-unusable",
      "turn-signed-out",
      "resync-signed-out",
      "publication-leak",
      "codex-fleet-capped",
      "codex-reset-failed",
      "fleet-runs-dry",
      "host-week-runs-out",
      "fleet-unhealthy",
      "org-health",
      "steer-at-risk",
      "meeting-prep-due",
    ]);
  });

  it("fits a recipe id far past the cap into a sentence the register still accepts, keeping the reason whole", () => {
    const long = subject({
      id: `resync-${"x".repeat(200)}`,
      key: "resync-xxxxxxxxxxxxx-abcdef",
      label: "y ".repeat(200),
    });
    const draft = unwrap(composeHandStep({ definition: recipe, nowIso: NOW, postedBy: "workspace:29", subject: long }));
    const step = unwrap(buildHandStep({ draft }));
    expect(step.what.length).toBe(WHAT_CAP);
    expect(step.what.endsWith(" — it stopped firing and no seat has it")).toBe(true);
    expect(fleetActorPhrase({ what: step.what })).toBe(undefined);
    expect(step.unblocks.length).toBeLessThanOrEqual(UNBLOCKS_CAP);
  });

  it("says what makes it stop, including a seat taking the repair", () => {
    expect(recipe.resolves).toBe(
      "the row fires again inside its own threshold, is disabled or held, or a seat takes its repair (`slopweaver automation repair`)",
    );
  });
});

describe("the restart / repair / retire refusal", () => {
  const recipe = monitorDefinition({ monitorId: "recipe-stopped" });

  it("refuses a card whose sentence offers the old choice", () => {
    const offering = { ...recipe, what: () => "Choose restart, repair, or retire for x — stopped firing" };
    const failure = unwrapErr(
      composeHandStep({ definition: offering, nowIso: NOW, postedBy: "workspace:29", subject: subject() }),
    );
    expect(failure.code).toBe("SOURCE_SHAPE");
    expect(failure.message).toContain("restart / repair / retire");
  });

  it("refuses a card whose decision's options offer it, in inflected words", () => {
    const failure = unwrapErr(
      composeHandStep({
        definition: recipe,
        nowIso: NOW,
        postedBy: "workspace:29",
        subject: subject({
          decision: {
            lean: "A",
            options: [
              { letter: "A", option: "Restarting it", tradeoff: "it may stop again" },
              { letter: "B", option: "Retired for good", tradeoff: "the promise ends" },
            ],
            problem: "x stopped firing",
            stakes: { blastRadius: "one digest", risk: "a missed digest", stillReal: "slopweaver automation due" },
          },
        }),
      }),
    );
    // The sentence's own "Seat a repair" joins the two options' words: the choice is read across the whole card.
    expect(failure.message).toContain("offers the owner restart / repair / retire");
  });

  it("names two or more of the three, never one — a single repair is an act, not a choice", () => {
    expect(restartRepairRetireChoice({ texts: ["Seat a repair for x"] })).toBe(undefined);
    expect(restartRepairRetireChoice({ texts: ["restart it", "or retire it"] })).toEqual(["restart", "retire"]);
    expect(restartRepairRetireChoice({ texts: ["Repaired, restarts, retirement"] })).toEqual([
      "restart",
      "repair",
      "retire",
    ]);
  });
});

describe("recipe-repairing", () => {
  const repairing = monitorDefinition({ monitorId: "recipe-repairing" });
  const taken = subject({
    id: "vulnfix-digest-acme-admin",
    key: "vulnfix-digest-ev-ad-0123456789abcdef",
    label: "vulnfix-digest-acme-admin → seat fix-vulnfix-digest",
    repairedBy: "fix-vulnfix-digest",
  });
  const arrival = ({ over }: { over: Partial<MonitorSubject> }) =>
    unwrap(
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition: repairing,
        nowIso: NOW,
        postedBy: "workspace:29",
        subject: { ...taken, ...over },
      }),
    );

  it("floats a NOTICE naming the recipe and the seat, on no queue and in no context", () => {
    const step = arrival({ over: {} });
    expect(step.what).toBe("vulnfix-digest-acme-admin stopped firing — seat fix-vulnfix-digest is repairing it");
    expect([step.notice, step.context, step.url, step.decision]).toEqual([true, undefined, undefined, undefined]);
    expect(step.unaddressed).toBe(
      "nothing waits on you — the seat named here is repairing it, and this note goes when it is done",
    );
    expect(postingRefusal({ step })).toBeUndefined();
    expect([repairing.floats, repairing.notice !== undefined, repairing.context, repairing.perSubject]).toEqual([
      true,
      true,
      undefined,
      undefined,
    ]);
  });

  it("names a set by its count and leaves each pair to what it unblocks", () => {
    const step = arrival({
      over: { id: "2 stopped recipes", label: "a → seat fix-a; b → seat fix-b", repairedBy: undefined },
    });
    expect(step.what).toBe("2 stopped recipes are being repaired — each is named below with the seat repairing it");
    expect(step.unblocks).toBe("nothing — in hand: a → seat fix-a; b → seat fix-b");
  });

  it("fits a long recipe id and a long seat into one sentence, keeping both", () => {
    const step = arrival({ over: { id: `r-${"x".repeat(200)}`, repairedBy: `s-${"y".repeat(200)}` } });
    expect(step.what.length).toBeLessThanOrEqual(WHAT_CAP);
    expect(step.what.startsWith("r-xxx")).toBe(true);
    expect(step.what.endsWith(" is repairing it")).toBe(true);
    expect(step.what).toContain(" stopped firing — seat s-yyy");
  });
});

describe("the monitor roster", () => {
  it("watches no parked run — a parked run is already its own ask on the owner's queue, never a hand step", () => {
    expect(MONITORS.map((monitor) => monitor.id)).toEqual([
      "automation-held-on-you",
      "recipe-stopped",
      "recipe-repairing",
      "corpus-sync-stopped",
      "codex-plan-signed-out",
      "claude-plan-unusable",
      "secret-absent",
      "turn-signed-out",
      "resync-signed-out",
      "publication-leak",
      "codex-fleet-capped",
      "codex-reset-failed",
      "prs-backed-up",
      "bot-off-the-air",
      "chair-off-fable",
      "fseventsd-bloated",
      "store-rehearsal-failed",
      "fleet-runs-dry",
      "host-week-runs-out",
      "fleet-unhealthy",
      "console-sync-failed",
      "org-health",
      "profile-unloaded",
      "steer-at-risk",
      "meeting-prep-due",
    ]);
  });

  it("floats above the ordinary level only for a meeting's prep page", () => {
    expect(
      MONITORS.filter((monitor) => monitor.noteLevel !== undefined).map((monitor) => [monitor.id, monitor.noteLevel]),
    ).toEqual([["meeting-prep-due", "meeting-prep"]]);
  });

  it("floats every leveled monitor's note, since a level means nothing on a note never raised", () => {
    const leveled = MONITORS.filter((monitor) => monitor.noteLevel !== undefined);
    expect(leveled.length).toBeGreaterThan(0);
    expect(leveled.filter((monitor) => monitor.floats !== true).map((monitor) => monitor.id)).toEqual([]);
  });

  it("lets a card per subject only where each is the owner's own act or the owner's own deliverable — a held automation's answer, a code-owner pick, a Codex sign-in, a Claude plan's fault, a missing secret, a blocked turn's or a resync's sign-in, a published leak, a steered row at risk", () => {
    expect(MONITORS.filter((monitor) => monitor.perSubject === true).map((monitor) => monitor.id)).toEqual([
      "automation-held-on-you",
      "codex-plan-signed-out",
      "claude-plan-unusable",
      "secret-absent",
      "turn-signed-out",
      "resync-signed-out",
      "publication-leak",
      "prs-backed-up",
      "steer-at-risk",
    ]);
  });
});

describe("corpus-sync-stopped", () => {
  const corpus = monitorDefinition({ monitorId: "corpus-sync-stopped" });
  const stopped = subject({
    id: "7 corpus sources",
    key: "resync-corpus-calend-0123456789abcdef",
    label: "resync-corpus-calendar MISSED ×22; resync-corpus-fathom MISSED ×22",
  });

  it("asks the owner to seat the corpus resyncs, in a sentence the register accepts", () => {
    const step = unwrap(
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition: corpus,
        nowIso: NOW,
        postedBy: "workspace:29",
        subject: stopped,
      }),
    );
    expect(step.what).toBe("Seat the corpus resyncs — a corpus source stopped syncing");
    expect(step.unblocks).toBe(
      "every card, page and workstream reading the corpus — 7 corpus sources: resync-corpus-calendar MISSED ×22; resync-corpus-fathom MISSED ×22",
    );
    expect(step.context).toBe("work");
    expect(postingRefusal({ step })).toBeUndefined();
  });

  it("posts under a console base whose scheme is upper case, which is still an http(s) origin", () => {
    const step = unwrap(
      buildArrival({
        address: { consoleBase: "HTTPS://console.example.org", occurrence: 1 },
        definition: corpus,
        nowIso: NOW,
        postedBy: "workspace:29",
        subject: stopped,
      }),
    );
    expect(step.url).toMatch(/^HTTPS:\/\/console\.example\.org\/queue\?open=hand%3A/);
  });

  it("floats, and leads the queue by declaring it stops the owner's work, exactly as recipe-stopped does", () => {
    expect([corpus.floats, corpus.context, corpus.perSubject, corpus.stopsWork]).toEqual([
      true,
      "work",
      undefined,
      true,
    ]);
  });
});

describe("stopsWork — which cards lead the owner's Queue", () => {
  it("is declared by exactly the three monitors whose card stops the owner's work, by the registry's word and never a name", () => {
    expect(MONITORS.filter((monitor) => monitor.stopsWork === true).map((monitor) => monitor.id)).toEqual([
      "automation-held-on-you",
      "recipe-stopped",
      "corpus-sync-stopped",
    ]);
  });

  it("rides onto the drafted step for a stopping monitor, and is absent from one that is not", () => {
    const stopping = unwrap(
      composeHandStep({
        definition: monitorDefinition({ monitorId: "recipe-stopped" }),
        nowIso: NOW,
        postedBy: "workspace:29",
        subject: subject({ id: "vulnfix-topup" }),
      }),
    );
    const merely = unwrap(
      composeHandStep({
        definition: monitorDefinition({ monitorId: "secret-absent" }),
        nowIso: NOW,
        postedBy: "workspace:29",
        subject: subject({ id: "linear-token" }),
      }),
    );
    expect([stopping.stopsWork, merely.stopsWork]).toEqual([true, undefined]);
  });

  it("is never read off a similar name: a monitor carrying a stopping-sounding id but no declaration drafts no mark", () => {
    const lookalike = { ...monitorDefinition({ monitorId: "secret-absent" }), prefix: "stopped" };
    const draft = unwrap(
      composeHandStep({ definition: lookalike, nowIso: NOW, postedBy: "workspace:29", subject: subject() }),
    );
    expect(draft.stopsWork).toBe(undefined);
  });
});
