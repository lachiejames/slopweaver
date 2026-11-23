/**
 * The strict boundaries for the two reads about people: every person with the accounts each holds at every
 * source, and the team tree.
 *
 * Key sets MEASURED over every person, person-provider account and team the tenant answered, with a one-off
 * read that printed key paths and types and no values. Re-measure by running `slopweaver atlas trelica sync`: a
 * drifted key is refused by name (`src/lib/boundary.ts`) and the kind keeps what it held.
 *
 * A person's `externalId` at each source is declared and never read — it is the source's own account key, and
 * no question this atlas answers needs it.
 */
import { z } from "zod";

import { trelicaPageSchema, unreadTrelicaKeys } from "./boundaryShapes.js";
import { TRELICA_ENTITY_CALLS } from "./entityInventory.js";
import { defineTrelicaBoundary } from "./trelicaBoundary.js";

/** One account a person holds at one source: an identity provider, an app's usage feed, or Trelica itself. */
const trelicaPersonAccountSchema = z.strictObject({
  deletedDtm: z.string().optional(),
  externalStatus: z.string().optional(),
  instanceName: z.string().optional(),
  isDeleted: z.boolean().optional(),
  isLifecycle: z.boolean(),
  isSuspended: z.boolean().optional(),
  organizationalUnit: z.string().optional(),
  providerTitle: z.strictObject({ "en-US": z.string().optional(), ...unreadTrelicaKeys({ keys: ["en"] }) }).optional(),
  providerType: z.string(),
  suspendedDtm: z.string().optional(),
  ...unreadTrelicaKeys({
    keys: [
      "aliases",
      "createdDtm",
      "customFieldValues",
      "discoveredDtm",
      "email",
      "employeeId",
      "employeeType",
      "externalId",
      "firstName",
      "groups",
      "hasName",
      "instanceId",
      "is2FAEnabled",
      "jobTitle",
      "lastName",
      "leavingDate",
      "lineManager",
      "lineManagerEmail",
      "location",
      "locationId",
      "name",
      "personType",
      "profileUrl",
      "providerApplicationId",
      "providerId",
      "startDate",
      "timezone",
      "unconfirmedAliases",
      "userName",
    ],
  }),
});

/** One person, as the People page lists them. */
const trelicaPersonSchema = z.strictObject({
  annualSpend: z.number().optional(),
  applicationCount: z.number(),
  deleted: z.boolean(),
  email: z.string().optional(),
  employeeType: z.string().optional(),
  id: z.string(),
  isTrelicaUser: z.boolean(),
  jobTitle: z.string().optional(),
  leavingDate: z.string().optional(),
  lineManager: z
    .strictObject({ email: z.string(), name: z.string(), ...unreadTrelicaKeys({ keys: ["id", "personType"] }) })
    .optional(),
  mergedToPersonId: z.string().optional(),
  name: z.string(),
  personProviders: z.array(trelicaPersonAccountSchema),
  personType: z.string().optional(),
  removedDate: z.string().optional(),
  startDate: z.string().optional(),
  status: z.string(),
  statusFlags: z.strictObject({ changingTeam: z.boolean(), leaver: z.boolean(), newStarter: z.boolean() }),
  teams: z.array(
    z.strictObject({
      name: z.string(),
      ...unreadTrelicaKeys({ keys: ["externalUserId", "integrationId", "providerId", "source", "teamId"] }),
    }),
  ),
  ...unreadTrelicaKeys({
    keys: [
      "aliases",
      "avoidMergesWith",
      "browserExtensionLastSyncDtm",
      "browserExtensionLastSyncDtms",
      "calculatedPersonType",
      "calculatedPersonTypeRule",
      "canTakeOwnership",
      "createdByUser",
      "createdDtm",
      "customFieldValues",
      "customerId",
      "employeeId",
      "fieldSources",
      "firstName",
      "groups",
      "hasLifecycleProvider",
      "isEditable",
      "isOwner",
      "lastModifiedByUser",
      "lastModifiedDtm",
      "lastName",
      "lineManagerEmail",
      "location",
      "locationId",
      "noInvite",
      "organizationalUnit",
      "personCreatedDtm",
      "provisioningTasks",
      "referencedLocation",
      "sortIndex",
      "teamIds",
      "timezone",
      "unconfirmedAliases",
      "userDetails",
      "userName",
    ],
  }),
});

/** `POST /CoreApi/People/FilterItems` — every person this tenant knows about. */
export const trelicaPeopleBoundary = defineTrelicaBoundary({
  callId: TRELICA_ENTITY_CALLS.people.id,
  endpoint: "POST /CoreApi/People/FilterItems",
  schema: trelicaPageSchema({ item: trelicaPersonSchema }),
});

/** One person, as the boundary admits them. */
export type TrelicaPersonRecord = z.infer<typeof trelicaPersonSchema>;

/** One team in the tree, keyed by its own id in `teamsById`. */
const trelicaTeamSchema = z.strictObject({
  childIds: z.array(z.string()),
  id: z.string(),
  name: z.string(),
  personCount: z.number(),
  ...unreadTrelicaKeys({ keys: ["externalIds", "groupIds", "groupNames", "isPositionFixed"] }),
});

/** `GET /CoreApi/TeamStructure/FilteredTeamStructure` — the team tree, as a map rather than a page. */
export const trelicaTeamsBoundary = defineTrelicaBoundary({
  callId: TRELICA_ENTITY_CALLS.teams.id,
  endpoint: "GET /CoreApi/TeamStructure/FilteredTeamStructure",
  schema: z.strictObject({
    noTeamPersonCount: z.number(),
    rootTeamIds: z.array(z.string()),
    teamsById: z.record(z.string(), trelicaTeamSchema),
    totalPersonCount: z.number(),
    ...unreadTrelicaKeys({ keys: ["allTeamSources", "customerId", "filteredOutTeamCount", "updatedInLastTwoMinutes"] }),
  }),
});

/** One team, as the boundary admits it. */
export type TrelicaTeamRecord = z.infer<typeof trelicaTeamSchema>;
