import { describe, expect, it } from "vitest";

import { orgLines, positionOf } from "../../lib/personOrg";
import type { PersonOrg, SlackPersonName } from "../../lib/slackPeople";

const ORG: PersonOrg = {
  department: "Engineering",
  orgUnit: "/Acme/Platform",
  title: { source: "google-admin", value: "Platform engineer" },
  vantaGroups: ["Acme reviewers", "Acme engineering", "All staff"],
  vantaStatus: "ON_LEAVE",
};

function person({ title, org }: { title?: string; org?: PersonOrg }): SlackPersonName {
  return { handle: "rosa", name: "Rosa Lindqvist", org, title };
}

describe("orgLines", () => {
  it("words every fact in reading order, each naming the store it came from", () => {
    expect(orgLines({ person: person({ org: ORG, title: "Infra/Build/Tooling" }) })).toEqual([
      { label: "Title", source: "Google Admin", value: "Platform engineer" },
      { label: "On Slack", source: "Slack", value: "Infra/Build/Tooling" },
      { label: "Team", source: "Google Admin", value: "Engineering" },
      { label: "Org unit", source: "Google Admin", value: "Acme › Platform" },
      { label: "Groups", source: "Vanta", value: "Acme reviewers · Acme engineering · All staff" },
      { label: "Status", source: "Vanta", value: "On leave" },
    ]);
  });

  it("drops Slack's title when it says what the org chart already does, and draws nothing with no org block", () => {
    const same = person({ org: { ...ORG, title: { source: "vanta", value: "CEO" } }, title: "ceo" });
    expect([orgLines({ person: same }).slice(0, 2), orgLines({ person: person({ title: "CEO" }) })]).toEqual([
      [
        { label: "Title", source: "Vanta", value: "CEO" },
        { label: "Team", source: "Google Admin", value: "Engineering" },
      ],
      [],
    ]);
  });

  it("draws no org unit line for a path with no unit in it", () => {
    const lines = orgLines({ person: person({ org: { ...ORG, orgUnit: "/" } }) });
    expect(lines.map((line) => line.label)).toEqual(["Title", "Team", "Groups", "Status"]);
  });
});

describe("positionOf", () => {
  it("prefers the org chart's title, and keeps Slack's when the org chart holds none", () => {
    expect([
      positionOf({ person: person({ org: ORG, title: "DevOps" }) }),
      positionOf({ person: person({ org: { ...ORG, title: undefined }, title: "DevOps" }) }),
      positionOf({ person: person({}) }),
    ]).toEqual(["Platform engineer", "DevOps", undefined]);
  });
});
