/**
 * The create, visibility and Actions-policy half of {@link GithubVerbErrors}: the facts that refuse one of those
 * writes before anything is sent, and the read-backs that do not show it landed. Composed into the one factory by
 * `./errors.ts`; import that, not this.
 *
 * None of these messages advises sending the write again. A create's name is claimed or not, a repository once
 * public has been readable, and an Actions policy that stopped part-way says exactly which steps landed — the next
 * act is a fresh preview, which prints a fresh digest over what is now there.
 */
import type { GithubAuthorizationFailedError, GithubFactRefusedError, GithubWriteUnconfirmedError } from "./errors.js";

/** The factory methods for repository lifecycle writes, composed into `GithubVerbErrors`. */
export const githubRepoLifecycleErrorFactories = {
  repoActionsIncomplete: ({
    fullName,
    landed,
    failedStep,
    actionsOn,
    causes,
  }: {
    fullName: string;
    landed: readonly string[];
    failedStep: string;
    actionsOn: boolean | undefined;
    /** GitHub's own words for each failed send or read at that step, empty when every call answered. */
    causes: readonly string[];
  }): GithubWriteUnconfirmedError => {
    let switchState = "whether Actions is on now is unknown; read it before anything else";
    if (actionsOn === true) {
      switchState = "Actions is ON";
    } else if (actionsOn === false) {
      switchState = "Actions is OFF";
    }
    const done = landed.length === 0 ? "nothing was confirmed" : `confirmed: ${landed.join(", ")}`;
    return {
      code: "WRITE_UNCONFIRMED",
      message:
        `the Actions policy on ${fullName} stopped at "${failedStep}" (${done}; ${switchState}). No policy setting ` +
        "is rolled back; preview again for a fresh digest over what is there now, never re-send the old approval" +
        (causes.length === 0 ? "" : `. GitHub said: ${causes.join("; ")}`),
      subject: fullName,
    };
  },
  repoActionsNotPublic: ({
    fullName,
    visibility,
  }: {
    fullName: string;
    visibility: string;
  }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message:
      `${fullName} is ${visibility}, and the policy's fork pull request approval is GitHub's setting for a public ` +
      "repository (a private one's fork workflows are a different setting), so it cannot be established here; " +
      "publish it first with --set-public, then preview --enable-actions again",
    subject: fullName,
  }),
  repoActionsRunnerScopeUnproven: ({
    fullName,
    ownerType,
  }: {
    fullName: string;
    ownerType: string;
  }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message:
      `${fullName} is owned by a${ownerType === "Organization" ? "n" : ""} ${ownerType}, and a repository read ` +
      "cannot prove that no organisation or enterprise runner group reaches it, so GitHub-hosted-only cannot be " +
      "established; --enable-actions acts on a repository a personal account owns",
    subject: fullName,
  }),
  repoActionsSelfHostedRunner: ({
    fullName,
    count,
    landed,
  }: {
    fullName: string;
    count: number;
    landed: readonly string[];
  }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message:
      `${fullName} has ${String(count)} self-hosted runner(s) registered, so Actions stays off: the policy is ` +
      "GitHub-hosted runners only. Remove the runner(s), then preview again" +
      (landed.length === 0 ? "" : ` (already confirmed before this was found: ${landed.join(", ")})`),
    subject: fullName,
  }),
  repoAddressTaken: ({ fullName, id }: { fullName: string; id: number }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message:
      `${fullName} already holds a repository (id ${String(id)}), so there is nothing to create; a repository ` +
      "that is already there was not shown to be the one this create would make",
    subject: fullName,
  }),
  repoCreateUnconfirmed: ({
    target,
    id,
    cause,
  }: {
    target: string;
    id: number | undefined;
    /** The failed read-back's own words, naming its operation and status; undefined when the read answered. */
    cause: string | undefined;
  }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message:
      (id === undefined
        ? `the create of ${target} did not return a repository id, so whatever stands there now cannot be ` +
          "attributed to it; read the address before anything else, and do not send the create again"
        : `GitHub accepted creating ${target} (id ${String(id)}) but the read-back does not show that repository ` +
          "there with the privacy asked for; read the address before anything else, and do not send the create again") +
      (cause === undefined ? "" : `. GitHub said: ${cause}`),
    subject: target,
  }),
  repoOwnerNotCreatable: ({ owner, account }: { owner: string; account: string }): GithubAuthorizationFailedError => ({
    code: "AUTHORIZATION_FAILED",
    message:
      `${owner} is neither the token's own account (${account}) nor an organisation, so this token cannot create ` +
      "a repository there",
    subject: owner,
  }),
  repoCutStandingUnreadable: ({ subject, why }: { subject: string; why: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message: `what ${subject}'s re-cut records say could not be read, so nothing is sent: ${why}`,
    subject,
  }),
  repoPublicCutUnverified: ({ repository, why }: { repository: string; why: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message:
      `${repository} stays private: ${why}. A re-cut repository goes public only once the latest fresh-cut ` +
      "verify of its cut reads clear",
    subject: repository,
  }),
  repoPushFreshCutRefused: ({ subject, why }: { subject: string; why: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message: `the fresh cut's root is not pushed to ${subject}: ${why}`,
    subject,
  }),
  repoPushFreshCutUnconfirmed: ({ subject, refs }: { subject: string; refs: string }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message:
      `git accepted pushing the fresh cut's root to ${subject}, but its refs read back as ${refs}, not main at the ` +
      "root alone; read the repository before anything else, and do not push again",
    subject,
  }),
  repoVisibilityUnconfirmed: ({
    fullName,
    cause,
  }: {
    fullName: string;
    /** The failed read-back's own words, naming its operation and status; undefined when the read answered. */
    cause: string | undefined;
  }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message:
      `GitHub accepted making ${fullName} public but the read-back does not show the same repository public at ` +
      "the same address; read it before anything else" +
      (cause === undefined ? "" : `. GitHub said: ${cause}`),
    subject: fullName,
  }),
} as const;
