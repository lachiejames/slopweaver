/**
 * What each of the nine kinds a raised Trelica role opened holds per entity: the closed detail
 * a projection in `entityProjection.ts` or `workflowProjection.ts` builds out of a strict boundary's record.
 *
 * Every field is one a reader asks for. A provider record carries far more, and `descriptor.ts`'s `excludes`
 * says what is dropped and why; a field the provider may omit is `null` here, never a guessed default.
 */
import type { TrelicaStepSettings } from "./stepSettings.js";

/** A person as another record names them: a workflow owner, a contract owner, a device's assignee. */
export interface TrelicaNamedPerson {
  readonly name: string;
  readonly email: string;
  /** Whether Trelica records them as terminated — a leaver still named as an owner is a finding. */
  readonly terminated: boolean;
}

/** One step of a workflow definition. */
export interface TrelicaWorkflowStep {
  readonly id: string;
  /** The step's own custom name when it has one, else the platform's name for its activity. */
  readonly name: string;
  readonly activityType: string;
  readonly category: string;
  /** The integration the step acts through, e.g. Google Workspace, when it acts through one. */
  readonly provider: string | null;
  /** What an integration step does there, e.g. `Suspend` or `RemoveLicense`, for a step that names one. */
  readonly action: string | null;
  /** Whether a group step strips every group rather than a chosen few, for a step that carries the setting. */
  readonly removeAllGroups: boolean | null;
  /** Whether a failure of this step lets the run carry on — the setting behind a "completed with errors" run. */
  readonly continueOnError: boolean;
  /** What the step is configured to do: its pipeline, timing, licence and recipients, never a secret-bearing key. */
  readonly settings: TrelicaStepSettings;
}

/** One workflow, at its latest version, with the platform's own run counts. */
export interface TrelicaWorkflowDetail {
  readonly name: string;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly archived: boolean;
  /** `Offboarding`, `Onboarding`, `Custom`, as the platform classes it. */
  readonly flowType: string;
  readonly tag: string | null;
  readonly version: number;
  readonly latestPublishedVersion: number;
  readonly createdAt: string;
  readonly lastModifiedAt: string;
  readonly trigger: {
    readonly activityType: string;
    readonly name: string;
    readonly personTypes: readonly string[];
    /** Days after (or, negative, before) a leaving date the trigger fires, for a leaver trigger. */
    readonly leavingDateDaysOffset: number | null;
    readonly requireApproval: boolean | null;
  };
  readonly owners: readonly TrelicaNamedPerson[];
  readonly steps: readonly TrelicaWorkflowStep[];
  readonly runCounts: {
    readonly total: number;
    readonly active: number;
    readonly completed: number;
    readonly completedWithErrors: number;
    readonly failed: number;
    readonly needsInput: number;
    readonly terminated: number;
    readonly waitingForUser: number;
  };
}

/** What one step of one run did. */
export interface TrelicaRunStep {
  readonly stepId: string;
  /** The step's name in the definition version the run ran, or `null` for the trigger, which has none. */
  readonly name: string | null;
  /** `Completed`, `SkippedWithError`, `Failed`, `Skipped`, `NotStarted`, `Blocked`, as the platform records it. */
  readonly status: string;
  readonly failureCount: number;
  /** The platform's own failure message, held only as a closed value by `providerText.ts`. */
  readonly failureMessage: string | null;
  readonly resultAt: string | null;
}

/** One run of one workflow, with the evidence of what each step did. */
export interface TrelicaWorkflowRunDetail {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly version: number;
  readonly label: string | null;
  /** The platform's run status: `Completed`, `Blocked`, `Failed`, `Terminated`. */
  readonly status: string;
  /** The status the Runs page shows: `CompletedWithErrors`, `NeedsInput`, `WaitingForUser` and the rest. */
  readonly uiStatus: string;
  /** The step the run is on, or stopped on. */
  readonly currentStep: string;
  readonly blockedReason: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly terminatedAt: string | null;
  readonly lastModifiedAt: string;
  readonly manuallyTriggered: boolean;
  readonly startedBy: string;
  readonly terminatedBy: string | null;
  readonly errorCount: number;
  /** How many steps failed and were carried past because they continue on error. */
  readonly failedAndContinuedCount: number;
  /** The person the run is about, for a person-scoped workflow. */
  readonly person: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly leavingDate: string | null;
  } | null;
  readonly app: { readonly id: string; readonly name: string } | null;
  readonly firedErrors: readonly { readonly at: string; readonly message: string | null }[];
  /** Every step's outcome, or `null` when this run's detail could not be read this time. */
  readonly steps: readonly TrelicaRunStep[] | null;
}

/**
 * One account a person holds at one source.
 * @internal
 */
export interface TrelicaPersonAccount {
  /** The source's title, e.g. Google Workspace. */
  readonly source: string | null;
  readonly instance: string | null;
  /** `Identity`, `Usage`, `Trelica` or `Custom`. */
  readonly providerType: string;
  /** Whether this source drives the person's lifecycle — joining and leaving. */
  readonly lifecycle: boolean;
  readonly suspended: boolean | null;
  readonly deleted: boolean | null;
  readonly externalStatus: string | null;
  readonly organizationalUnit: string | null;
  readonly suspendedAt: string | null;
  readonly deletedAt: string | null;
}

/** One person, with every account they hold. */
export interface TrelicaPersonDetail {
  readonly name: string;
  readonly email: string | null;
  /** `Active`, `Terminated`, `New`, `Unknown`. */
  readonly status: string;
  readonly personType: string | null;
  readonly employeeType: string | null;
  readonly jobTitle: string | null;
  readonly startDate: string | null;
  readonly leavingDate: string | null;
  readonly removedDate: string | null;
  readonly leaver: boolean;
  readonly newStarter: boolean;
  readonly changingTeam: boolean;
  readonly deleted: boolean;
  readonly isTrelicaUser: boolean;
  readonly mergedInto: string | null;
  readonly applicationCount: number;
  readonly annualSpend: number | null;
  readonly lineManager: { readonly name: string; readonly email: string } | null;
  readonly teams: readonly string[];
  readonly accounts: readonly TrelicaPersonAccount[];
}

/** One connection this tenant holds to an integration provider. */
export interface TrelicaIntegrationDetail {
  readonly provider: string;
  readonly app: string;
  readonly enabled: boolean;
  /** `Success` or `Failure`, as the last sync left it. */
  readonly status: string;
  readonly needsReconnect: boolean;
  readonly issueCount: number;
  readonly lastSyncAt: string;
  readonly lastError: string | null;
  readonly authorisedBy: { readonly name: string | null; readonly email: string | null };
  readonly supportsProvisioning: boolean;
  readonly supportsDeprovision: boolean;
  readonly supportsRevoke: boolean;
  readonly lastSync: {
    readonly sourceUsers: number;
    readonly newUsers: number;
    readonly failedUsers: number;
    readonly sourceApps: number;
    readonly failedApps: number;
    readonly sourceAssets: number;
    readonly failedAssets: number;
  };
}

/** One contract. */
export interface TrelicaContractDetail {
  readonly name: string;
  readonly vendor: string;
  readonly app: string;
  readonly status: string;
  readonly current: boolean;
  readonly overdue: boolean;
  readonly rolling: boolean;
  readonly automaticRenewal: boolean | null;
  readonly startDate: string;
  readonly agreementDate: string;
  readonly renewalDate: string | null;
  readonly noticeDeadline: string | null;
  readonly noticeDays: number;
  readonly renewalDecision: string | null;
  readonly annualValue: number;
  readonly totalValue: number;
  readonly currency: string | null;
  readonly paymentMethod: string;
  readonly owners: readonly TrelicaNamedPerson[];
}

/** One device, merged across every source that reported it. */
export interface TrelicaDeviceDetail {
  readonly name: string | null;
  readonly type: string;
  readonly platform: string | null;
  readonly osVersion: string | null;
  readonly model: string;
  readonly manufacturer: string;
  readonly status: string;
  readonly encrypted: boolean;
  readonly enrolledAt: string | null;
  readonly lastSyncAt: string;
  readonly serialNumber: string | null;
  readonly disposalDate: string | null;
  readonly assignedTo: TrelicaNamedPerson | null;
  readonly sources: readonly {
    readonly name: string | null;
    readonly status: string | null;
    readonly lastSyncAt: string | null;
  }[];
}

/** One team in the tree. */
export interface TrelicaTeamDetail {
  readonly name: string;
  readonly personCount: number;
  readonly childIds: readonly string[];
  readonly isRoot: boolean;
}

/** One access-review schedule. */
export interface TrelicaAccessReviewDetail {
  readonly name: string;
  readonly status: string;
  readonly frequency: string;
  readonly startDate: string;
  readonly dueWorkingDays: number;
  readonly enrollmentType: string;
  readonly enrollmentStatus: string;
  readonly snapshots: readonly {
    readonly status: string;
    readonly takenAt: string;
    readonly dueAt: string;
    readonly totalApps: number;
    readonly completedApps: number;
    readonly openApps: number;
    readonly draftApps: number;
  }[];
}

/** One assessment. */
export interface TrelicaAssessmentDetail {
  readonly survey: string;
  readonly type: string;
  readonly status: string;
  readonly application: string;
  readonly assignedTo: { readonly name: string; readonly email: string };
  readonly dueAt: string;
  readonly overdue: boolean;
  readonly answeredQuestions: number;
  readonly totalQuestions: number;
}
