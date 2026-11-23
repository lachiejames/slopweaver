/**
 * What text each call of `github exposure` answers, field by field, with the locator a finding is reported under.
 *
 * The sweep reads exactly the pages the inventory reads, so this table is the whole of what it scans: one entry per
 * call id in `./exposureModel.ts`, each naming the fields that become public text. A field this table leaves out
 * is never scanned, which is why each choice is written down here rather than as a generic walk of every string in
 * a response — a login or an avatar URL is metadata about who acted, not text somebody wrote.
 *
 * A locator names the object (`pull <number>`, `commit <sha>`, `review comment <id> on pull <number>`) and lives
 * only in the state home with the finding. Nothing from this file is printed.
 */

import { isRecord } from "../../lib/parsers.js";
import { pageItems, stringAt } from "./exposureListing.js";
import type { GithubExposureCallId, GithubExposureSurfaceId } from "./exposureModel.js";
import {
  type GithubExposureParams,
  idOf,
  numberPart,
  paramOf,
  recordsAt,
  stringPart,
  tailOf,
  textsAt,
} from "./exposureTextParts.js";

/** One piece of text a surface publishes, and where it sits. */
export interface GithubExposureText {
  readonly surface: GithubExposureSurfaceId;
  readonly locator: string;
  readonly field: string;
  readonly text: string;
  /** Lines before this text's first, for a slice of a longer one (a job log read in batches); absent is none. */
  readonly lineOffset?: number;
}

/** A commit's message and both identities. */
function commitTexts({ item }: { item: unknown }): GithubExposureText[] {
  const locator = `commit ${stringPart({ item, path: ["sha"] })}`;
  return [
    ...textsAt({ fields: [["commit", "message"]], item, locator, surface: "commits" }),
    ...textsAt({
      fields: [
        ["commit", "author", "name"],
        ["commit", "author", "email"],
        ["commit", "committer", "name"],
        ["commit", "committer", "email"],
      ],
      item,
      locator,
      surface: "commit-identities",
    }),
  ];
}

/** A job's names and every step's name. */
function jobTexts({ item }: { item: unknown }): GithubExposureText[] {
  const locator = `job ${idOf({ item })}`;
  return [
    ...textsAt({ fields: [["name"], ["workflow_name"], ["head_branch"]], item, locator, surface: "actions-jobs" }),
    ...recordsAt({ item, key: "steps" }).flatMap((step, index) =>
      textsAt({
        fields: [["name"]],
        item: step,
        locator: `${locator} step ${String(index + 1)}`,
        surface: "actions-jobs",
      }),
    ),
  ];
}

/** A published release's text and its assets' names; a draft stays private and is not read. */
function releaseTexts({ item }: { item: unknown }): GithubExposureText[] {
  if (isRecord(item) && item["draft"] === true) {
    return [];
  }
  const locator = `release ${idOf({ item })}`;
  return [
    ...textsAt({ fields: [["name"], ["body"], ["tag_name"]], item, locator, surface: "releases" }),
    ...recordsAt({ item, key: "assets" }).flatMap((asset) =>
      textsAt({
        fields: [["name"], ["label"]],
        item: asset,
        locator: `${locator} asset ${idOf({ item: asset })}`,
        surface: "releases",
      }),
    ),
  ];
}

/** A deployment's payload as text, or nothing when it carries none: a string verbatim, anything else serialised. */
function deploymentPayloadText({ item }: { item: unknown }): string | undefined {
  const payload = isRecord(item) ? item["payload"] : undefined;
  if (payload === undefined) {
    return undefined;
  }
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

/** A deployment's text, its free-form payload serialised whole: GitHub stores whatever the deployer sent. */
function deploymentTexts({ item }: { item: unknown }): GithubExposureText[] {
  const locator = `deployment ${idOf({ item })}`;
  const payloadText = deploymentPayloadText({ item });
  return [
    ...textsAt({
      fields: [["description"], ["environment"], ["ref"], ["task"]],
      item,
      locator,
      surface: "deployments",
    }),
    ...(payloadText === undefined || payloadText === "{}" || payloadText === '""'
      ? []
      : [{ field: "payload", locator, surface: "deployments" as const, text: payloadText }]),
  ];
}

/**
 * The text an event's payload carries: pushed commits (which may no longer be reachable from any ref), and the
 * titles and bodies a pull request, issue, comment, review or release event embeds.
 */
function eventTexts({ item }: { item: unknown }): GithubExposureText[] {
  const locator = `event ${stringPart({ item, path: ["id"] })}`;
  const payload = isRecord(item) ? item["payload"] : undefined;
  const embedded = [
    ["ref"],
    ["description"],
    ["pull_request", "title"],
    ["pull_request", "body"],
    ["issue", "title"],
    ["issue", "body"],
    ["comment", "body"],
    ["review", "body"],
    ["release", "name"],
    ["release", "body"],
  ] as const;
  return [
    ...textsAt({ fields: embedded, item: payload, locator, surface: "events" }),
    ...recordsAt({ item: payload, key: "commits" }).flatMap((commit, index) =>
      textsAt({
        fields: [["message"], ["author", "name"], ["author", "email"]],
        item: commit,
        locator: `${locator} commit ${String(index + 1)} ${stringPart({ item: commit, path: ["sha"] })}`,
        surface: "events",
      }),
    ),
  ];
}

/** The text of one listed item, by the call that listed it. */
const ITEM_TEXTS: Readonly<
  Record<
    Exclude<GithubExposureCallId, "commit-detail" | "git-blob" | "git-ref" | "git-tree" | "pages" | "repository">,
    (args: { item: unknown; params: GithubExposureParams }) => GithubExposureText[]
  >
> = {
  "actions-artifacts": ({ item }) =>
    textsAt({ fields: [["name"]], item, locator: `artifact ${idOf({ item })}`, surface: "actions-artifacts" }),
  "actions-jobs": ({ item }) => jobTexts({ item }),
  "actions-runs": ({ item }) =>
    textsAt({
      fields: [["name"], ["display_title"], ["head_branch"], ["path"]],
      item,
      locator: `run ${idOf({ item })}`,
      surface: "actions-runs",
    }),
  "actions-workflows": ({ item }) =>
    textsAt({
      fields: [["name"], ["path"]],
      item,
      locator: `workflow ${idOf({ item })}`,
      surface: "actions-workflows",
    }),
  "check-runs": ({ item, params }) =>
    textsAt({
      fields: [
        ["name"],
        ["external_id"],
        ["details_url"],
        ["output", "title"],
        ["output", "summary"],
        ["output", "text"],
      ],
      item,
      locator: `check run ${idOf({ item })} on ${paramOf({ key: "ref", params })}`,
      surface: "check-runs",
    }),
  "commit-comments": ({ item }) =>
    textsAt({
      fields: [["body"], ["path"]],
      item,
      locator: `commit comment ${idOf({ item })} on ${stringPart({ item, path: ["commit_id"] })}`,
      surface: "commit-comments",
    }),
  "commit-statuses": ({ item, params }) =>
    textsAt({
      fields: [["context"], ["description"], ["target_url"]],
      item,
      locator: `status ${idOf({ item })} on ${paramOf({ key: "ref", params })}`,
      surface: "commit-statuses",
    }),
  commits: ({ item }) => commitTexts({ item }),
  deployments: ({ item }) => deploymentTexts({ item }),
  environments: ({ item }) =>
    textsAt({ fields: [["name"]], item, locator: `environment ${idOf({ item })}`, surface: "environments" }),
  events: ({ item }) => eventTexts({ item }),
  "issue-comments": ({ item }) =>
    textsAt({
      fields: [["body"]],
      item,
      locator: `issue comment ${idOf({ item })} on #${tailOf({ item, key: "issue_url" })}`,
      surface: "issue-comments",
    }),
  issues: ({ item }) =>
    isRecord(item) && "pull_request" in item
      ? []
      : textsAt({
          fields: [["title"], ["body"]],
          item,
          locator: `issue #${numberPart({ item, path: ["number"] })}`,
          surface: "issues",
        }),
  labels: ({ item }) =>
    textsAt({ fields: [["name"], ["description"]], item, locator: `label ${idOf({ item })}`, surface: "labels" }),
  "matching-refs": ({ item }) => {
    const ref = stringAt({ path: ["ref"], value: item });
    return ref === undefined ? [] : [{ field: "ref", locator: `ref ${ref}`, surface: "refs", text: ref }];
  },
  milestones: ({ item }) =>
    textsAt({
      fields: [["title"], ["description"]],
      item,
      locator: `milestone #${numberPart({ item, path: ["number"] })}`,
      surface: "milestones",
    }),
  "pull-reviews": ({ item, params }) =>
    textsAt({
      fields: [["body"]],
      item,
      locator: `review ${idOf({ item })} on pull #${paramOf({ key: "pull_number", params })}`,
      surface: "pull-reviews",
    }),
  pulls: ({ item }) =>
    textsAt({
      // Not `head.label`: GitHub writes it as `<owner>:<branch>`, the owner public with the repository itself.
      fields: [["title"], ["body"], ["head", "ref"], ["base", "ref"]],
      item,
      locator: `pull #${numberPart({ item, path: ["number"] })}`,
      surface: "pull-requests",
    }),
  releases: ({ item }) => releaseTexts({ item }),
  "review-comments": ({ item }) =>
    textsAt({
      fields: [["body"], ["path"], ["diff_hunk"]],
      item,
      locator: `review comment ${idOf({ item })} on pull #${tailOf({ item, key: "pull_request_url" })}`,
      surface: "review-comments",
    }),
};

/** The text of one single-object answer: the repository document, a probed ref, a tree, the Pages config. */
function documentTexts({ call, data }: { call: GithubExposureCallId; data: unknown }): GithubExposureText[] {
  if (call === "repository") {
    const topics = recordsAt({ item: data, key: "topics" }).filter((topic) => typeof topic === "string");
    return [
      ...textsAt({
        fields: [["name"], ["description"], ["homepage"]],
        item: data,
        locator: "repository",
        surface: "repository-settings",
      }),
      ...(topics.length === 0
        ? []
        : [
            { field: "topics", locator: "repository", surface: "repository-settings" as const, text: topics.join(" ") },
          ]),
    ];
  }
  if (call === "git-ref") {
    const ref = stringAt({ path: ["ref"], value: data });
    return ref === undefined ? [] : [{ field: "ref", locator: `ref ${ref}`, surface: "refs", text: ref }];
  }
  if (call === "git-tree") {
    return recordsAt({ item: data, key: "tree" }).flatMap((entry) => {
      const path = stringAt({ path: ["path"], value: entry });
      return path === undefined
        ? []
        : [{ field: "path", locator: `path ${path}`, surface: "file-history", text: path }];
    });
  }
  return textsAt({ fields: [["cname"], ["html_url"]], item: data, locator: "pages", surface: "pages" });
}

/**
 * Every piece of public text one REST answer carries. Pure.
 *
 * @param call the call that was answered
 * @param params the parameters it was made with, which name a fanned-out item's parent
 * @param data the answer as GitHub sent it
 * @returns the texts with their surfaces and locators; none for an answer that is not the expected shape
 */
export function githubExposureTexts({
  call,
  params,
  data,
}: {
  call: GithubExposureCallId;
  params: GithubExposureParams;
  data: unknown;
}): readonly GithubExposureText[] {
  if (call === "repository" || call === "git-ref" || call === "git-tree" || call === "pages") {
    return documentTexts({ call, data });
  }
  // A commit's files and a blob are read by the sweep's own contents stage (`./exposureContents.ts`), which takes
  // them one at a time; the inventory never makes either call.
  if (call === "commit-detail" || call === "git-blob") {
    return [];
  }
  const page = pageItems({ call, data });
  if (page.isErr()) {
    return [];
  }
  const extract = ITEM_TEXTS[call];
  return page.value.items.flatMap((item) => extract({ item, params }));
}
