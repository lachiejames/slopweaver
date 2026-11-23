/**
 * Turning the strict boundaries' records into entities for seven of the 15-Oct kinds — people, teams,
 * integrations, contracts, devices, access reviews and assessments. Workflows and runs are
 * `workflowProjection.ts`, because a run is joined to its definition.
 *
 * Pure, and on the `first-party-api` channel only. The provider id is the provider's own record id, except an
 * integration's, which is its CONNECTION's id: the catalogue lists every provider Trelica offers, a provider may hold more
 * than one connection, and a connection is what has a status, a last sync and an authorising user.
 */
import { unsetFieldAsNull } from "#lib/absent.js";

import { atlasChannelView, atlasEntityWithChannel, sortedById } from "../kit/channelProjection.js";

import type { TrelicaAccessReviewRecord, TrelicaAssessmentRecord, TrelicaDeviceRecord } from "./assuranceBoundaries.js";
import type {
  TrelicaAccessReviewDetail,
  TrelicaAssessmentDetail,
  TrelicaContractDetail,
  TrelicaDeviceDetail,
  TrelicaIntegrationDetail,
  TrelicaNamedPerson,
  TrelicaPersonDetail,
  TrelicaTeamDetail,
} from "./entityModel.js";
import type { TrelicaContractRecord, TrelicaIntegrationProviderRecord } from "./estateBoundaries.js";
import { trelicaEntityId } from "./identity.js";
import { emptyTrelicaChannels, type TrelicaAtlasEntity, type TrelicaAtlasKind } from "./model.js";
import type { TrelicaPersonRecord, TrelicaTeamRecord } from "./peopleBoundaries.js";
import { heldTrelicaProviderText } from "./providerText.js";

/**
 * One entity per record, each with only its first-party channel filled, sorted by id.
 *
 * @param kind the kind every entity is
 * @param records the boundary's admitted records
 * @param idOf the provider's own id for one record
 * @param detailOf the closed detail for one record
 * @param endpoint the operation the records were read from
 * @param at this run's ISO timestamp
 * @returns the entities
 */
export function trelicaFirstPartyEntities<R>({
  kind,
  records,
  idOf,
  detailOf,
  endpoint,
  at,
}: {
  kind: TrelicaAtlasKind;
  records: readonly R[];
  idOf: (record: R) => string;
  detailOf: (record: R) => unknown;
  endpoint: string;
  at: string;
}): readonly TrelicaAtlasEntity[] {
  const entities = records.map((record) => {
    const providerId = idOf(record);
    return atlasEntityWithChannel({
      channel: "first-party-api",
      empty: emptyTrelicaChannels(),
      id: trelicaEntityId({ kind, providerId }),
      kind,
      providerId,
      // Every page here is served under the TENANT origin, whose label this repository may not carry — so the
      // link is left unattempted rather than assembled, exactly as an application's own page is.
      view: atlasChannelView({
        artifacts: [],
        at,
        channel: "first-party-api",
        deepLink: null,
        deepLinkStatus: "unverified",
        detail: detailOf(record),
        endpoint,
      }),
    });
  });
  return sortedById({ entities });
}

/**
 * A person as an owner or assignee field names them.
 *
 * @param person the embedded record
 * @returns its name, address and terminated flag
 */
export function trelicaNamedPerson({ person }: { person: TrelicaNamedPerson }): TrelicaNamedPerson {
  return { email: person.email, name: person.name, terminated: person.terminated };
}

/**
 * One person's closed detail.
 *
 * @param record the boundary's person
 * @returns the detail held for them
 */
export function trelicaPersonDetail({ record }: { record: TrelicaPersonRecord }): TrelicaPersonDetail {
  return {
    accounts: record.personProviders.map((account) => ({
      deleted: unsetFieldAsNull({ key: "isDeleted", record: account }),
      deletedAt: unsetFieldAsNull({ key: "deletedDtm", record: account }),
      externalStatus: unsetFieldAsNull({ key: "externalStatus", record: account }),
      instance: unsetFieldAsNull({ key: "instanceName", record: account }),
      lifecycle: account.isLifecycle,
      organizationalUnit: unsetFieldAsNull({ key: "organizationalUnit", record: account }),
      providerType: account.providerType,
      source: unsetFieldAsNull({ key: "en-US", record: account.providerTitle }),
      suspended: unsetFieldAsNull({ key: "isSuspended", record: account }),
      suspendedAt: unsetFieldAsNull({ key: "suspendedDtm", record: account }),
    })),
    annualSpend: unsetFieldAsNull({ key: "annualSpend", record }),
    applicationCount: record.applicationCount,
    changingTeam: record.statusFlags.changingTeam,
    deleted: record.deleted,
    email: unsetFieldAsNull({ key: "email", record }),
    employeeType: unsetFieldAsNull({ key: "employeeType", record }),
    isTrelicaUser: record.isTrelicaUser,
    jobTitle: unsetFieldAsNull({ key: "jobTitle", record }),
    leaver: record.statusFlags.leaver,
    leavingDate: unsetFieldAsNull({ key: "leavingDate", record }),
    lineManager:
      record.lineManager === undefined ? null : { email: record.lineManager.email, name: record.lineManager.name },
    mergedInto: unsetFieldAsNull({ key: "mergedToPersonId", record }),
    name: record.name,
    newStarter: record.statusFlags.newStarter,
    personType: unsetFieldAsNull({ key: "personType", record }),
    removedDate: unsetFieldAsNull({ key: "removedDate", record }),
    startDate: unsetFieldAsNull({ key: "startDate", record }),
    status: record.status,
    teams: record.teams.map((team) => team.name).toSorted(),
  };
}

/**
 * One team's closed detail.
 *
 * @param record the boundary's team
 * @param rootIds the ids the tree names as its roots
 * @returns the detail held for it
 */
export function trelicaTeamDetail({
  record,
  rootIds,
}: {
  record: TrelicaTeamRecord;
  rootIds: ReadonlySet<string>;
}): TrelicaTeamDetail {
  return {
    childIds: [...record.childIds].toSorted(),
    isRoot: rootIds.has(record.id),
    name: record.name,
    personCount: record.personCount,
  };
}

/** One connection, with the provider it belongs to. */
export interface TrelicaConnection {
  readonly provider: TrelicaIntegrationProviderRecord;
  readonly connection: NonNullable<TrelicaIntegrationProviderRecord["integrations"]>[number];
}

/**
 * Every connection this tenant holds, out of the whole catalogue.
 *
 * @param providers the catalogue's providers
 * @returns one entry per connection
 */
export function trelicaConnections({
  providers,
}: {
  providers: readonly TrelicaIntegrationProviderRecord[];
}): readonly TrelicaConnection[] {
  return providers.flatMap((provider) => {
    if (provider.integrations === undefined) {
      return [];
    }
    return provider.integrations.map((connection) => ({ connection, provider }));
  });
}

/**
 * One connection's closed detail.
 *
 * @param entry the connection and its provider
 * @returns the detail held for it
 */
export function trelicaIntegrationDetail({ entry }: { entry: TrelicaConnection }): TrelicaIntegrationDetail {
  const { connection, provider } = entry;
  const result = connection.lastResult;
  return {
    app: connection.app.name,
    authorisedBy: {
      email: unsetFieldAsNull({ key: "email", record: connection.authorisedUserInfo }),
      name: unsetFieldAsNull({ key: "name", record: connection.authorisedUserInfo }),
    },
    enabled: connection.enabled,
    issueCount: connection.issueCount,
    lastError: heldTrelicaProviderText({
      text: unsetFieldAsNull({ key: "lastErrorFriendlyMessage", record: connection }),
    }),
    lastSync: {
      failedApps: result.failedAppCount,
      failedAssets: result.failedAssetCount,
      failedUsers: result.failedUserCount,
      newUsers: result.newUserCount,
      sourceApps: result.sourceAppCount,
      sourceAssets: result.sourceAssetCount,
      sourceUsers: result.sourceUserCount,
    },
    lastSyncAt: connection.lastSyncDate,
    needsReconnect: connection.needsReconnect,
    provider: provider.applicationName,
    status: connection.status,
    supportsDeprovision: provider.supportsDeprovision,
    supportsProvisioning: provider.supportsProvisioning,
    supportsRevoke: provider.supportsRevoke,
  };
}

/**
 * One contract's closed detail.
 *
 * @param record the boundary's contract
 * @returns the detail held for it
 */
export function trelicaContractDetail({ record }: { record: TrelicaContractRecord }): TrelicaContractDetail {
  return {
    agreementDate: record.agreementDate,
    annualValue: record.annualContractValue,
    app: record.mainCustomerAppName,
    automaticRenewal: unsetFieldAsNull({ key: "automaticRenewal", record }),
    currency: unsetFieldAsNull({ key: "currencyCode", record }),
    current: record.isCurrent,
    name: record.name,
    noticeDays: record.noticeDays,
    noticeDeadline: unsetFieldAsNull({ key: "noticeDeadline", record }),
    overdue: record.isOverdue,
    owners: record.owners.map((person) => trelicaNamedPerson({ person })),
    paymentMethod: record.paymentMethod,
    renewalDate: unsetFieldAsNull({ key: "renewalDate", record }),
    renewalDecision: unsetFieldAsNull({ key: "renewalDecision", record }),
    rolling: record.isRolling,
    startDate: record.startDate,
    status: record.status,
    totalValue: record.totalContractValue,
    vendor: record.vendorName,
  };
}

/**
 * One device's closed detail.
 *
 * @param record the boundary's device
 * @returns the detail held for it
 */
export function trelicaDeviceDetail({ record }: { record: TrelicaDeviceRecord }): TrelicaDeviceDetail {
  return {
    assignedTo: record.assignedTo === undefined ? null : trelicaNamedPerson({ person: record.assignedTo }),
    disposalDate: unsetFieldAsNull({ key: "disposalDate", record }),
    encrypted: record.isEncrypted,
    enrolledAt: unsetFieldAsNull({ key: "enrolledDtm", record }),
    lastSyncAt: record.lastSyncDtm,
    manufacturer: record.manufacturerVendorName,
    model: record.modelName,
    name: unsetFieldAsNull({ key: "deviceName", record }),
    osVersion: unsetFieldAsNull({ key: "osVersion", record }),
    platform: unsetFieldAsNull({ key: "platform", record }),
    serialNumber: unsetFieldAsNull({ key: "serialNumber", record }),
    sources: record.providers.map((source) => ({
      lastSyncAt: unsetFieldAsNull({ key: "lastSyncDtm", record: source }),
      name: unsetFieldAsNull({ key: "providerName", record: source }),
      status: unsetFieldAsNull({ key: "status", record: source }),
    })),
    status: record.status,
    type: record.assetTypeName["en-US"],
  };
}

/**
 * One access-review schedule's closed detail.
 *
 * @param record the boundary's schedule
 * @returns the detail held for it
 */
export function trelicaAccessReviewDetail({
  record,
}: {
  record: TrelicaAccessReviewRecord;
}): TrelicaAccessReviewDetail {
  return {
    dueWorkingDays: record.dueWorkingDays,
    enrollmentStatus: record.enrollmentStatus,
    enrollmentType: record.enrollmentType,
    frequency: record.frequency,
    name: record.name,
    snapshots: record.allSnapshots.map((snapshot) => ({
      completedApps: snapshot.completedAppCount,
      draftApps: snapshot.draftAppCount,
      dueAt: snapshot.dueDtm,
      openApps: snapshot.openAppCount,
      status: snapshot.status,
      takenAt: snapshot.snapshotDtm,
      totalApps: snapshot.totalAppCount,
    })),
    startDate: record.startDate,
    status: record.status,
  };
}

/**
 * One assessment's closed detail.
 *
 * @param record the boundary's assessment
 * @returns the detail held for it
 */
export function trelicaAssessmentDetail({ record }: { record: TrelicaAssessmentRecord }): TrelicaAssessmentDetail {
  return {
    answeredQuestions: record.answeredQuestions,
    application: record.applicationName,
    assignedTo: { email: record.assignedToPerson.email, name: record.assignedToPerson.name },
    dueAt: record.dueDtm,
    overdue: record.isOverdue,
    status: record.status,
    survey: record.surveyName["en-US"],
    totalQuestions: record.totalQuestions,
    type: record.type,
  };
}
