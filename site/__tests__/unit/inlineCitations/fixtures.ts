/*
 * What the inlineCitations tests share: the pull-request address builder, the acme-admin four-PRs question, the
 * Quinn roster card, the acme-admin row's references and the team-keys card. Moved out of inlineCitations.test.ts
 * unchanged.
 *
 * A pull request a card names reads as its number, the number the link — never the number with its URL in brackets
 * after it: a four-PR card whose what shows `#N (https://…)` doubles every address. And every spelling a card uses is a
 * link, ticket keys included, so a hand card whose heading reads `Open acme-admin 17564:` in plain text still links.
 */

import { type CardReferences, NO_CARD_REFERENCES } from "../../../lib/inlineCitations";
import { cardPeople, NO_CARD_PEOPLE } from "../../../lib/personMentions";

/**
 * The acme-admin pull request of one number, as its address.
 * @returns the pull request's GitHub URL
 */
export const pr = ({ n }: { n: number }): string => `https://github.com/acme/acme-admin/pull/${String(n)}`;

/** The acme-admin four-PRs ask's recorded question, as `handover list --json` publishes it. */
export const ACME_ADMIN_QUESTION =
  `Should the fleet bump #16676 (${pr({ n: 16676 })}) and send #16670 (${pr({ n: 16670 })}) its first review ask now, or hold ` +
  `each until the PR below it lands (#16672 ${pr({ n: 16672 })}, #16367 ${pr({ n: 16367 })})? #17560 (${pr({ n: 17560 })}) and #16672, ` +
  "the two red ones in the doc, are now 93/93 green with CodeRabbit clean on their content, and #16672 was chased last week.";

/** A card whose drafts reading names Quinn. */
export const WITH_PEOPLE: CardReferences = {
  ...NO_CARD_REFERENCES,
  people: cardPeople({
    board: [],
    owner: undefined,
    roster: new Map([["U0QUINN", { firstNameUnique: true, handle: "quinn", name: "Quinn Riley" }]]),
  }),
};

/*
 * A number or key no address names, resolved through what the row knows instead: a drawer for acme-admin 16406 whose
 * ask carried no address at all still shows every plain-text PR number and Linear ticket id as a link.
 */

/** The Linear issue QQQQ-134's address. */
export const SECU = "https://linear.app/acme/issue/QQQQ-134";

/** The acme-admin row's references: acme-admin home, slopweaver also checked out, two Linear teams. */
export const ACME_ADMIN: CardReferences = {
  attested: new Map([
    ["acme/acme-admin", 17648],
    ["lachiejames/slopweaver", 1324],
  ]),
  boardSlugs: new Set(),
  checkouts: new Set(["acme/acme-admin", "lachiejames/slopweaver"]),
  home: "acme/acme-admin",
  linearTeamKeys: ["QQQQ", "JJJJ"],
  linearWorkspace: "acme",
  named: [],
  people: NO_CARD_PEOPLE,
  records: NO_CARD_REFERENCES.records,
};

/** A card that knows two Linear teams and no workspace to address them in. */
export const TEAM: CardReferences = {
  ...NO_CARD_REFERENCES,
  linearTeamKeys: ["III", "QQQQ"],
  linearWorkspace: undefined,
};
