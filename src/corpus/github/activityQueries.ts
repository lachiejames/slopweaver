/**
 * The two GraphQL documents the GitHub activity lane sends, one per item: the pull-request one and the issue
 * one. `activity.ts` picks between them and parses what comes back.
 *
 * **The selection set is the capture.** Bronze keeps each parsed node's `raw` verbatim, so a field this
 * document does not ask for is a field no schema can ever fill — the review comment that does not know its
 * own file is the worked example. What the set may grow by is therefore bounded by ONE property, and it is
 * the property to check before adding a line here: **scalars and single-node sub-selections only, never a
 * new connection.** GitHub scores a GraphQL call off its connections' `first`/`last`, so widening
 * `PullRequest` with `additions`, or a review comment with `path`, costs the same points on the same one
 * call per item; a `files(first:n)` or `reviewRequests(first:n)` would not. That is what makes a refetch
 * under a wider set the same call count as the backfill that captured four fields per comment.
 */

/** The scalars every comment node carries, whichever connection it came from. */
const COMMENT_FIELDS = `id databaseId author{login __typename ... on User{databaseId}} authorAssociation createdAt updatedAt lastEditedAt url body isMinimized minimizedReason`;

export const PR_ACTIVITY_QUERY = `query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      id databaseId number title url state isDraft merged createdAt updatedAt closedAt mergedAt reviewDecision mergeable
      additions deletions changedFiles
      headRefName headRefOid baseRefName baseRefOid
      headRepository{nameWithOwner} baseRepository{nameWithOwner}
      mergedBy{login __typename ... on User{databaseId}} mergeCommit{oid}
      commits(last:1){nodes{commit{statusCheckRollup{state}}}}
      reviews(first:100){nodes{id databaseId author{login __typename ... on User{databaseId}} authorAssociation state submittedAt url body commit{oid}}}
      comments(first:100){nodes{${COMMENT_FIELDS}}}
      reviewThreads(first:100){nodes{id isResolved isOutdated isCollapsed path line startLine diffSide resolvedBy{login __typename ... on User{databaseId}}
        comments(first:100){nodes{${COMMENT_FIELDS} path line originalLine startLine originalStartLine diffHunk outdated state commit{oid} originalCommit{oid} replyTo{url}}}}}
      timelineItems(first:100,itemTypes:[MERGED_EVENT,CLOSED_EVENT,REOPENED_EVENT,READY_FOR_REVIEW_EVENT,CONVERT_TO_DRAFT_EVENT]){
        nodes{__typename
          ... on MergedEvent{createdAt actor{login __typename ... on User{databaseId}} mergeRefName commit{oid}}
          ... on ClosedEvent{createdAt actor{login __typename ... on User{databaseId}}}
          ... on ReopenedEvent{createdAt actor{login __typename ... on User{databaseId}}}
          ... on ReadyForReviewEvent{createdAt actor{login __typename ... on User{databaseId}}}
          ... on ConvertToDraftEvent{createdAt actor{login __typename ... on User{databaseId}}}}}}}}`;

export const ISSUE_ACTIVITY_QUERY = `query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    issue(number:$number){
      id databaseId number title url state stateReason createdAt updatedAt closedAt
      comments(first:100){nodes{${COMMENT_FIELDS}}}
      timelineItems(first:100,itemTypes:[CLOSED_EVENT,REOPENED_EVENT]){
        nodes{__typename
          ... on ClosedEvent{createdAt actor{login __typename ... on User{databaseId}} stateReason}
          ... on ReopenedEvent{createdAt actor{login __typename ... on User{databaseId}}}}}}}}`;
