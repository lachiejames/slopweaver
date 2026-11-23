/**
 * The top-level `people` roster a verb prints beside its rows, each member's place in the organisation included.
 */
import { type Bag, bags, str, strings, sub } from "../../lib/bag";
import type { OrgFactSource, PersonOrg, SlackPeople, SlackPersonName } from "../../lib/slackPeople";
import { notFlag, notText } from "./readSlackDraftsRuns";

/** The stores an org-chart title may name as its source. */
const ORG_SOURCES: readonly OrgFactSource[] = ["google-admin", "vanta"];

/**
 * A roster row's `org` block — where the person sits in the organisation. Absent is none: a CLI older than it, or a
 * member neither store holds. Present and malformed is `null`, so the roster refuses rather than drawing a team the
 * CLI never said.
 *
 * @param row one `people` row
 * @returns the facts, `undefined` when absent, `null` when malformed
 */
function orgOf({ row }: { row: Bag }): PersonOrg | undefined | null {
  if (row["org"] === undefined) {
    return undefined;
  }
  const org = sub({ bag: row, key: "org" });
  if (org === undefined) {
    return null;
  }
  const groups = strings({ bag: org, key: "vantaGroups" });
  const badText = ["department", "orgUnit", "vantaStatus"].some((key) => notText({ bag: org, key }));
  if (groups === undefined || badText) {
    return null;
  }
  let title: PersonOrg["title"];
  if (org["title"] !== undefined) {
    const titleBag = sub({ bag: org, key: "title" });
    const value = titleBag === undefined ? undefined : str({ bag: titleBag, key: "value" });
    const source = ORG_SOURCES.find((known) => titleBag?.["source"] === known);
    if (value === undefined || source === undefined) {
      return null;
    }
    title = { source, value };
  }
  return {
    department: str({ bag: org, key: "department" }),
    orgUnit: str({ bag: org, key: "orgUnit" }),
    title,
    vantaGroups: groups,
    vantaStatus: str({ bag: org, key: "vantaStatus" }),
  };
}

/**
 * The top-level `people` roster. Absent reads as an empty roster (a CLI older than it); present and malformed,
 * or naming one id twice, is `undefined` — a roster that might put the wrong name on a draft is refused.
 *
 * @param payload the parsed stdout of a verb printing `people` beside its rows
 * @returns each member id's name, handle and picture, or `undefined` when the roster will not read
 */
export function peopleOf({ payload }: { payload: Bag }): SlackPeople | undefined {
  if (payload["people"] === undefined) {
    return new Map();
  }
  const rows = bags({ bag: payload, key: "people" });
  if (rows === undefined) {
    return undefined;
  }
  const out = new Map<string, SlackPersonName>();
  for (const row of rows) {
    const nativeId = str({ bag: row, key: "nativeId" });
    const badName = notText({ bag: row, key: "name" });
    const badHandle = notText({ bag: row, key: "handle" });
    const badAvatar = notText({ bag: row, key: "avatarUrl" });
    const badTitle = notText({ bag: row, key: "title" });
    const badUnique = notFlag({ bag: row, key: "firstNameUnique" }) || notFlag({ bag: row, key: "nameUnique" });
    const badLeft = notFlag({ bag: row, key: "deactivated" });
    const org = orgOf({ row });
    const badRow = badName || badHandle || badAvatar || badTitle || badUnique || badLeft || org === null;
    if (nativeId === undefined || badRow || out.has(nativeId)) {
      return undefined;
    }
    out.set(nativeId, {
      avatarUrl: str({ bag: row, key: "avatarUrl" }),
      deactivated: row["deactivated"] === true,
      firstNameUnique: row["firstNameUnique"] === true,
      handle: str({ bag: row, key: "handle" }),
      name: str({ bag: row, key: "name" }),
      nameUnique: row["nameUnique"] === true,
      org,
      title: str({ bag: row, key: "title" }),
    });
  }
  return out;
}
