/**
 * Every production file's word-carrying Slack write calls, per enclosing function and callee — the call-site half of
 * "never lead with the PR", beside the producer half in `./prLeadSeams.ts`, which classifies every file
 * named here. `src/__tests__/unit/outbound/slack/prLeadSeams/` walks each file's syntax tree and recounts.
 *
 * A function is keyed by the chain of named functions around it (`runEditAsMe/perform`), and two distinct functions
 * whose chains are equal by their order in the file (`guardPlacement/post#3`). A changed count, or a call moved into
 * another named function, means a write site changed; what the walk cannot see is the stated limits in
 * `./prLeadSeams.ts`'s header. Re-read whether that file's row in `PR_LEAD_PRODUCERS` still holds for it before
 * changing this table: the count is a prompt, never a number to bump.
 */

const SLACK = "src/cli/commands/slack";
const LISTEN = "src/cli/commands/listen";
const CORPUS = "src/corpus/slack";
const TURN = "src/live/turn";

/** Per production file, per enclosing function, how many times it calls each word-carrying write callee. */
export const PR_LEAD_CALL_SITES: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, number>>>>>> =
  {
    [`${LISTEN}/liveCapture.ts`]: { setCaptureStatus: { ".setAssistantStatus": 1 } },
    [`${LISTEN}/liveListenDeps.ts`]: { "liveRefusalHandler/postReply": { ".postDripMessage": 1 } },
    [`${LISTEN}/run.ts`]: { "stubAcknowledgeHandler/perform": { ".postDripMessage": 1 } },
    [`${LISTEN}/scheduledRecover.ts`]: {
      "captureSurvivors/postReply": { ".postDripMessage": 1 },
      "sweepNow/postReply": { ".postDripMessage": 1 },
    },
    "src/cli/commands/queue/queueReleaseDoor.ts": { "postReleasedPayload/perform": { runAssistantCompositeSend: 1 } },
    [`${SLACK}/canvasRun.ts`]: {
      createCanvas: { ".createCanvas": 1, ".createChannelCanvas": 1 },
      "runReplace/perform": { ".replaceCanvas": 1 },
    },
    [`${SLACK}/canvasWiring.ts`]: {
      "liveCanvasDeps/createCanvas": { ".createCanvas": 1 },
      "liveCanvasDeps/createChannelCanvas": { ".createChannelCanvas": 1 },
      "liveCanvasDeps/replaceCanvas": { ".replaceCanvas": 1 },
    },
    [`${SLACK}/cardSend.ts`]: { postByForm: { ".sendComposite": 1, ".sendNoFold": 1 } },
    [`${SLACK}/channelWiring.ts`]: {
      "liveChannelDeps/setPurpose": { ".setChannelPurpose": 1 },
      "liveChannelDeps/setTopic": { ".setChannelTopic": 1 },
    },
    [`${SLACK}/correctRun.ts`]: { "strikeThroughDoor/perform": { ".correctMessage": 1 } },
    [`${SLACK}/dripRun.ts`]: { sendOne: { ".sendDripMessage": 1 } },
    [`${SLACK}/dripSendPlan.ts`]: { runRenderProof: { ".sendDripMessage": 1 } },
    [`${SLACK}/lifecycleRunAsMe.ts`]: { "runEditAsMe/perform": { ".updateDripMessage": 1 } },
    [`${SLACK}/lifecycleRunEdit.ts`]: { "performCardEdit/perform": { ".updateCard": 1 } },
    [`${SLACK}/lifecycleRunEditChecklist.ts`]: { "performChecklistEdit/perform": { ".updateTurn": 1 } },
    [`${SLACK}/lifecycleRunEditPoll.ts`]: { "performPollEdit/perform": { ".updateCard": 1 } },
    [`${SLACK}/pollRun.ts`]: { "livePollDeps/postPoll": { ".postPoll": 1 }, postPollSettled: { ".postPoll": 1 } },
    "src/cli/commands/turn/ensureCard.ts": { postOwnCard: { ".postCard": 1 } },
    [`${CORPUS}/writeApi.ts`]: {
      "makeSlackWriteApi/sendComposite": { runCompositeSend: 1 },
      "makeSlackWriteApi/sendDripMessage": { runDripCompositeSend: 1 },
      "makeSlackWriteApi/sendNoFold": { ".postNoFold": 1 },
    },
    [`${CORPUS}/writeApiStream.ts`]: {
      "appendStreamCall/execute": { ".appendStream": 1 },
      "startStreamCall/execute": { ".startStream": 1 },
      "stopStreamCall/execute": { ".stopStream": 1 },
    },
    [`${CORPUS}/writeGuardHighStakes.ts`]: {
      "guardHighStakesReplies/postAssistantMessage": { ".postAssistantMessage": 1 },
      "guardHighStakesReplies/postCard": { ".postCard": 1 },
      "guardHighStakesReplies/postDripMessage": { ".postDripMessage": 1 },
      "guardHighStakesReplies/postNoFold": { ".postNoFold": 1 },
      "guardHighStakesReplies/postRecipeResponse": { ".postRecipeResponse": 1 },
      "guardHighStakesReplies/postTurn": { ".postTurn": 1 },
      "guardHighStakesReplies/startStream": { ".startStream": 1 },
      "guardHighStakesReplies/updateTurn": { ".updateTurn": 1 },
    },
    [`${CORPUS}/writeGuardPlacement.ts`]: {
      "guardPlacement/post#1": { ".postAssistantMessage": 1 },
      "guardPlacement/post#2": { ".postCard": 1 },
      "guardPlacement/post#3": { ".postDripMessage": 1 },
      "guardPlacement/post#4": { ".postNoFold": 1 },
      "guardPlacement/post#5": { ".postPoll": 1 },
      "guardPlacement/post#6": { ".postRecipeResponse": 1 },
      "guardPlacement/post#7": { ".postTurn": 1 },
      "guardPlacement/post#8": { ".startStream": 1 },
    },
    [`${CORPUS}/writeGuardPlacementRepair.ts`]: { postLink: { ".postDripMessage": 1 } },
    [`${CORPUS}/writeGuardRepeat.ts`]: {
      "guardRepeats/postAssistantMessage": { ".postAssistantMessage": 1 },
      "guardRepeats/postCard": { ".postCard": 1 },
      "guardRepeats/postDripMessage": { ".postDripMessage": 1 },
      "guardRepeats/postNoFold": { ".postNoFold": 1 },
      "guardRepeats/postPoll": { ".postPoll": 1 },
      "guardRepeats/postRecipeResponse": { ".postRecipeResponse": 1 },
    },
    [`${CORPUS}/writeGuardTypedRuns.ts`]: {
      "guardTypedRuns/attachAssistantMedia": { ".attachAssistantMedia": 1 },
      "guardTypedRuns/attachMedia": { ".attachMedia": 1 },
      "guardTypedRuns/attachRecipeResponseMedia": { ".attachRecipeResponseMedia": 1 },
      "guardTypedRuns/correctMessage": { ".correctMessage": 1 },
      "guardTypedRuns/postAssistantMessage": { ".postAssistantMessage": 1 },
      "guardTypedRuns/postCard": { ".postCard": 1 },
      "guardTypedRuns/postDripMessage": { ".postDripMessage": 1 },
      "guardTypedRuns/postNoFold": { ".postNoFold": 1 },
      "guardTypedRuns/postPoll": { ".postPoll": 1 },
      "guardTypedRuns/postRecipeResponse": { ".postRecipeResponse": 1 },
      "guardTypedRuns/postTurn": { ".postTurn": 1 },
      "guardTypedRuns/startStream": { ".startStream": 1 },
      "guardTypedRuns/stopStream": { ".stopStream": 1 },
      "guardTypedRuns/updateCard": { ".updateCard": 1 },
      "guardTypedRuns/updateDripMessage": { ".updateDripMessage": 1 },
      "guardTypedRuns/updateTurn": { ".updateTurn": 1 },
    },
    [`${CORPUS}/writeSend.ts`]: {
      runAssistantCompositeSend: { ".attachAssistantMedia": 1, ".postAssistantMessage": 1 },
      runCompositeSend: { ".attachMedia": 1, ".postCard": 1 },
      runDripCompositeSend: { ".postDripMessage": 1, ".updateDripMessage": 1 },
      runRecipeResponseCompositeSend: { ".attachRecipeResponseMedia": 1, ".postRecipeResponse": 1 },
    },
    [`${TURN}/posterAnswer.ts`]: {
      "nameThreadThroughDoor/perform": { ".setThreadTitle": 1 },
      sendAdmittedAnswer: { runAssistantCompositeSend: 1 },
    },
    [`${TURN}/posterStatus.ts`]: { setStatusOnce: { ".setAssistantStatus": 1 } },
    [`${TURN}/posterWorking.ts`]: {
      "advanceWorkingImpl/perform": { ".updateTurn": 1 },
      "finalizeWorkingImpl/perform": { ".updateTurn": 1 },
      "postNoticeImpl/perform": { ".postAssistantMessage": 1 },
      "postWorkingImpl/perform": { ".postTurn": 1 },
    },
  };
