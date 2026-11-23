/**
 * The store's schema, in one place — the single source of truth every client and every migration reads.
 *
 * Modelled on the archive's `shared/db/schema.ts`, and for the reason its own header gives: keeping the
 * table set in one module is what stops schema-type drift between the things that connect to it. Here
 * that matters more than it did there, because the types this exports are the ones the typed query layer
 * is built from — `ContentRow` is not a hand-written interface that has to be kept in step with the
 * table, it is `typeof contentTable.$inferSelect`, so a column rename is a compile error at every call
 * site rather than a runtime surprise at one.
 *
 * Types are derived from the database schema's auto-generated types, as the old repo did, and this
 * pointed the same way.
 */
export {
  type AtlasCoverageRow,
  type AtlasEntityChannelRow,
  type AtlasEntityRow,
  type AtlasGapRow,
  type AtlasKindStatusRow,
  atlasCoverageStateEnum,
  atlasCoverageTable,
  atlasEntityChannelTable,
  atlasEntityStateEnum,
  atlasEntityTable,
  atlasEvidenceRoleEnum,
  atlasGapTable,
  atlasKindStatusTable,
  type NewAtlasCoverageRow,
  type NewAtlasEntityChannelRow,
  type NewAtlasEntityRow,
  type NewAtlasGapRow,
  type NewAtlasKindStatusRow,
} from "./schema/atlas.js";
export {
  type AuthoredBodyRecord,
  type AuthoredFileRecord,
  authoredAbsentTable,
  authoredBodyTable,
  authoredFileTable,
  type NewAuthoredBodyRecord,
  type NewAuthoredFileRecord,
} from "./schema/authored.js";
export {
  type BoardRowRecord,
  boardKindEnum,
  boardOriginEnum,
  boardPriorityEnum,
  boardRowTable,
  boardSettlementEnum,
  boardStatusEnum,
  type NewBoardRowRecord,
} from "./schema/board.js";
export {
  CMUX_EVENTS_CONSUMER,
  CMUX_SESSION_WATCH_CONSUMER,
  type CmuxEventStateRow,
  cmuxEventStateTable,
  type NewCmuxEventStateRow,
} from "./schema/cmuxEventState.js";
export {
  type CodexFallbackReceiptRecord,
  type CodexFallbackRequestRecord,
  codexFallbackReceiptTable,
  codexFallbackRequestTable,
  type NewCodexFallbackReceiptRecord,
  type NewCodexFallbackRequestRecord,
} from "./schema/codexFallback.js";
export {
  CODEX_FLEET_CAP_ID,
  type CodexFleetCapRow,
  codexFleetCapTable,
  type NewCodexFleetCapRow,
} from "./schema/codexFleetCap.js";
export { type CodexSignInObservationRow, codexSignInObservationTable } from "./schema/codexSignInObservation.js";
export { type CodexSupersessionRow, codexSupersessionTable } from "./schema/codexSupersession.js";
export { type ContainerRow, containerTable, type NewContainerRow } from "./schema/container.js";
export { type ContentRow, contentTable, type NewContentRow } from "./schema/content.js";
export {
  containerKindEnum,
  contentKindEnum,
  contentSourceEnum,
  dataClassEnum,
  STORE_ROLES,
  visibilityEnum,
} from "./schema/enums.js";
export {
  FLEET_CONFIG_ID,
  FLEET_JOURNAL_IMPORT_SOURCES,
  FLEET_JOURNALS,
  type FleetConfigRow,
  type FleetJournalEventRow,
  type FleetJournalImportSource,
  type FleetJournalName,
  type FleetJournalRow,
  fleetConfigTable,
  fleetJournalEventTable,
  fleetJournalTable,
} from "./schema/fleet.js";
export {
  HOME_FILE_IMPORT_REGISTERS,
  type HomeFileImportRegister,
  type HomeFileImportRow,
  homeFileImportTable,
} from "./schema/homeFileImport.js";
export {
  type StoreImportApplicationRow,
  type StoreImportBatchRow,
  type StoreImportItemRow,
  type StoreImportPartRow,
  type StoreImportQuestionRow,
  type StoreImportResolutionRow,
  storeImportApplicationTable,
  storeImportBatchTable,
  storeImportItemTable,
  storeImportPartTable,
  storeImportQuestionTable,
  storeImportResolutionTable,
} from "./schema/importStaging.js";
export { type KnowledgeDomainRow, knowledgeDomainTable } from "./schema/knowledgeDomain.js";
export { type LandingPressRow, landingPressTable } from "./schema/landingPress.js";
export { type LandingReadCursorRow, landingReadCursorTable } from "./schema/landingReadCursor.js";
export {
  AUTONOMY_REGISTER_ID,
  type AutonomyEventRecord,
  autonomyEntryEnum,
  autonomyEventTable,
  autonomyRegisterTable,
  DOOR_REGISTER_ID,
  type DoorEventRecord,
  doorEventTable,
  doorProvenanceEnum,
  doorRegisterTable,
  type GrantRowRecord,
  grantRowTable,
  type NewAutonomyEventRecord,
  type NewDoorEventRecord,
  type NewGrantRowRecord,
} from "./schema/ledgers.js";
export {
  type MeasurementBlobRecord,
  type MeasurementLocationRecord,
  measurementBlobTable,
  measurementLocationTable,
  type NewMeasurementBlobRecord,
  type NewMeasurementLocationRecord,
} from "./schema/measurement.js";
export {
  type MemoryRecordingRow,
  memoriesTable,
  memoryKindEnum,
  memorySurfaceEnum,
  memoryTraceOutcomeEnum,
  memoryVerdictEnum,
  type NewMemoryRecordingRow,
} from "./schema/memories.js";
export { type MemoryRecallRow, memoryRecallsTable, recallOutcomeEnum } from "./schema/memoryRecalls.js";
export {
  type NewOrganisationRow,
  ORGANISATION_ID,
  type OrganisationRow,
  organisationTable,
} from "./schema/organisation.js";
export {
  ORG_HEALTH_ACKNOWLEDGEMENT_KINDS,
  ORG_HEALTH_ACKNOWLEDGEMENT_MARKER_ID,
  ORG_HEALTH_INCIDENT_ID,
  ORG_HEALTH_SIGHTING_ID,
  type OrgHealthAcknowledgementRow,
  type OrgHealthIncidentRow,
  type OrgHealthSightingRow,
  orgHealthAcknowledgementTable,
  orgHealthIncidentTable,
  orgHealthSightingTable,
} from "./schema/orgHealth.js";
export { type NewOwnerCaptureRecord, type OwnerCaptureRecord, ownerCaptureTable } from "./schema/ownerCapture.js";
export {
  judgementInstructionStateEnum,
  type OwnerCorrectionRow,
  type OwnerDirectiveRow,
  ownerCorrectionTable,
  ownerDirectiveTable,
  ownerJudgementOriginEnum,
} from "./schema/ownerJudgement.js";
export {
  type NewOwnerProfileRow,
  OWNER_PROFILE_ID,
  type OwnerProfileRow,
  ownerProfileTable,
} from "./schema/ownerProfile.js";
export {
  type NewOwnerTurnLocationRecord,
  type NewOwnerTurnRecord,
  type OwnerTurnLocationRecord,
  type OwnerTurnRecord,
  ownerTurnLocationTable,
  ownerTurnTable,
} from "./schema/ownerTurn.js";
export {
  type NewOwnerVoiceRegisterRow,
  type OwnerVoiceRegisterRow,
  ownerVoiceRegisterTable,
} from "./schema/ownerVoice.js";
export {
  isPersonResolvableSource,
  type NewPersonRow,
  PERSON_COLUMN_BY_SOURCE,
  PERSON_ID_SHAPES,
  PERSON_RESOLVABLE_SOURCES,
  type PersonResolvableSource,
  type PersonRow,
  personTable,
} from "./schema/person.js";
export {
  linkStatusEnum,
  type NewPersonLinkCandidateRow,
  type PersonLinkCandidateRow,
  personLinkCandidateTable,
} from "./schema/personLink.js";
export {
  type NewPlanRegisterRow,
  PLAN_REGISTER_ID,
  type PlanRegisterRow,
  planRegisterTable,
} from "./schema/planRegister.js";
export {
  type PublishedPageAliasRecord,
  type PublishedPageBlobRecord,
  type PublishedPageFileRecord,
  type PublishedPageRecord,
  type PublishedPageVersionRecord,
  publishedPageAliasTable,
  publishedPageBlobTable,
  publishedPageFileTable,
  publishedPageTable,
  publishedPageVersionTable,
} from "./schema/publishedPages.js";
export {
  type CodexPassRecord,
  codexPassTable,
  type NewCodexPassRecord,
  type NewRunEventRecord,
  type NewRunRecord,
  type RunEventRecord,
  type RunRecord,
  runEventTable,
  runPhaseEnum,
  runTable,
} from "./schema/runs.js";
export {
  type NewSingletonRegisterRow,
  SINGLETON_REGISTER_IDS,
  type SingletonRegisterId,
  type SingletonRegisterRow,
  singletonRegisterTable,
} from "./schema/singletonRegister.js";
export {
  type ContentGithubRow,
  type ContentLinearRow,
  type ContentNotionRow,
  type ContentSlackRow,
  contentGithubTable,
  contentLinearTable,
  contentNotionTable,
  contentSlackTable,
  hasSourceRowTable,
  type NewContentGithubRow,
  type NewContentLinearRow,
  type NewContentNotionRow,
  type NewContentSlackRow,
  SOURCE_ROW_PRESENCE_STATEMENTS,
  SOURCE_ROW_PRESENCE_TRIGGER,
  SOURCE_ROW_TABLES,
  SOURCES_WITH_ROW_TABLE,
  type SourceWithRowTable,
} from "./schema/sourceRows.js";
export { type NewSpendMerchantRow, type SpendMerchantRow, spendMerchantTable } from "./schema/spendMerchant.js";
export {
  standingAskCoverageTable,
  standingAskEventTable,
  standingAskOriginEnum,
  standingAskStateEnum,
  standingAskTable,
} from "./schema/standingAsks.js";
export {
  type SteerMeasurementRow,
  steerMeasurementOriginEnum,
  steerMeasurementTable,
} from "./schema/steerMeasurements.js";
export {
  WORKSTREAM_REGISTER_META_ID,
  type WorkstreamEntryRow,
  type WorkstreamLinkRow,
  type WorkstreamMilestoneAfterRow,
  type WorkstreamMilestoneRow,
  type WorkstreamRegisterMetaRow,
  type WorkstreamRow,
  workstreamEntryKindEnum,
  workstreamEntryTable,
  workstreamKindEnum,
  workstreamLinkKindEnum,
  workstreamLinkTable,
  workstreamMilestoneAfterTable,
  workstreamMilestoneTable,
  workstreamRegisterMetaTable,
  workstreamStatusEnum,
  workstreamTable,
  workstreamWorkspaceEnum,
} from "./schema/workstreams.js";
