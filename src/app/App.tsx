import { useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CreateSnapshot } from "../components/CreateSnapshot";
import { DqRequestDialog } from "../components/DqRequestDialog";
import { useDqCameraScan } from "../hooks/useDqCameraScan";
import { useSenderProfile } from "../hooks/useSenderProfile";
import { useMobileInputPortal } from "../hooks/useMobileInputPortal";
import { useCallSync } from "../hooks/useCallSync";
import { resolveCallPhaseName, useCallMessageDraft } from "../hooks/useCallMessageDraft";
import { useDqRequestNavigation } from "../hooks/useDqRequestNavigation";
import {
  BRACKET_ZOOM_LEVELS,
  MOBILE_INPUT_POLLING_MS_MAX,
  MOBILE_INPUT_POLLING_MS_MIN,
  normalizeBracketZoomLevel,
  normalizeMobileInputPollingMs,
  useAppPreferences,
} from "../hooks/useAppPreferences";
import { toApiSlug, toEventApiSlug } from "../domain/slugUtils";
import { SettingsScreen } from "../components/SettingMenu";
import { StatusBoard, StatusBoardHero } from "../components/StatusBoard";
import { PlayerListInfo } from "../components/PlayerListInfo";
import { MessageBox } from "../components/MessageBox";
import { ItemListEditor } from "../components/ItemListEditor";
import { EventSelector, type LocalSnapshotEventListItem } from "../components/EventSelector";
import { EventSetting } from "../components/EventSetting";
import { AppShell, type AppStatusProgress, type AppTab, useAppVersion } from "../components/AppShell";
import { OverlayControl } from "../components/OverlayControl";
import { isOverlayActiveForSet, useObsOverlay } from "../hooks/useObsOverlay";
import { useObsOverlaySetActions } from "../hooks/useObsOverlaySetActions";
import { usePhasePoolSelection } from "../hooks/usePhasePoolSelection";
import { useMatchSideDraftActions } from "../hooks/useMatchSideDraftActions";
import { buildMatchSideDrafts, resolveMatchSideDraftSavePlan } from "../domain/matchSideDrafts";
import { BracketTab } from "../components/BracketTab";
import { BracketDialogs } from "../components/BracketDialogs";
import { MatchDetailDialog } from "../components/MatchDetailDialog";
import { useBracketContentView } from "../hooks/useBracketContentView";
import { useSelectedEventEntrants } from "../hooks/useSelectedEventEntrants";
import { useSnapshotEventListRefresh } from "../hooks/useSnapshotEventListRefresh";

import { useBracketReport } from "../hooks/useBracketReport";
import {
  useSetResultDrafts,
  type ResultConfirmationState,
} from "../hooks/useSetResultDrafts";
import { buildMatchDialogPlayers, resolveWorkspaceMatchDraftState } from "../domain/matchDialogDraft";
import {
  buildScoreDraftsFromSet,
  buildSlotScoresForSave,
  isDqScoreValue,
  resolveWinnerIdFromDrafts,
} from "../domain/setResultDrafts";
import { useSetResultPersistence } from "../hooks/useSetResultPersistence";
import { usePlayerMetaDrafts } from "../hooks/usePlayerMetaDrafts";
import { useEventManagementSettings } from "../hooks/useEventManagementSettings";
import { buildEventManagementSettingKey } from "../domain/eventManagement";
import { useEventSnapshotMaintenance } from "../hooks/useEventSnapshotMaintenance";
import { useSetSideAssignment } from "../hooks/useSetSideAssignment";
import { useMatchDialogActions } from "../hooks/useMatchDialogActions";
import { useTournamentCreation } from "../hooks/useTournamentCreation";
import { useUserCards } from "../hooks/useUserCards";
import { useItemLists } from "../hooks/useItemLists";
import { useMailbox } from "../hooks/useMailbox";
import {
  CALL_LIST_COLOR_SECONDS_MAX,
  CALL_LIST_COLOR_SECONDS_MIN,
  CALL_LIST_ROTATE_SECONDS_MAX,
  CALL_LIST_ROTATE_SECONDS_MIN,
  normalizeCallListRotateSeconds,
  useCallList,
} from "../hooks/useCallList";
import {
  useTournamentWorkspace,
  type PlaySide,
  type TournamentWorkspace,
} from "../hooks/useTournamentWorkspace";
import { usePersistSnapshotSelection } from "../hooks/usePersistSnapshotSelection";
import { useSnapshotStartupRestore } from "../hooks/useSnapshotStartupRestore";
import { useBracketSectionView } from "../hooks/useBracketSectionView";
import { useMessageScopes } from "../hooks/useMessageScopes";
import { useSnapshotSelectionView, useSnapshotTabAutoLoad } from "../hooks/useSnapshotSelection";
import {
  formatScoreValue,
  isCompletedSet,
  isMatchupReady,
  type EventSnapshot,
} from "../domain/bracketDisplay";
import {
  getMailboxMethodLabel,
  canBroadcastCallListSync as resolveCanBroadcastCallListSync,
  formatSenderProfileLabel,
  hasSenderIdCollision,
  isSenderProfileReadyForMessaging as resolveSenderProfileReadiness,
  isDqRequestMessage,
  resolveSenderSettingsStatus,
} from "../domain/messageUtils";
import {
  type SetSnapshot,
} from "../domain/bracketProgression";
import { useSelectedEventData } from "../hooks/useSelectedEventData";
import "./App.css";

const STARTGG_FETCH_PER_PAGE = 50;

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("create");
  const appVersion = useAppVersion();
  const [slug, setSlug] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedPhaseName, setSelectedPhaseName] = useState("");
  const [selectedPhasePoolKey, setSelectedPhasePoolKey] = useState("");
  const [activeMatchSetId, setActiveMatchSetId] = useState("");
  const {
    scoreDrafts,
    setScoreDrafts,
    directWinnerId,
    setDirectWinnerId,
    initializeMatchDraft,
    resultConfirmation,
    requestResultConfirmation,
    clearResultConfirmation,
    adjustScoreDraft,
    changeScoreDraft,
    toggleDirectWinnerDraft,
    setDisqualificationDraft,
    interimScoreDraftsBySetId,
    saveSetDraft,
    removeInterimDraft,
    removeDraftsForSet,
    clearAllDrafts,
  } = useSetResultDrafts();
  const [activeMatchSideDrafts, setActiveMatchSideDrafts] = useState<Record<string, PlaySide | "">>({});
  const [deletingSnapshotKey, setDeletingSnapshotKey] = useState("");
  const [callingEntrantId, setCallingEntrantId] = useState("");
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const {
    displayBracketPlayersBySide,
    setDisplayBracketPlayersBySide,
    bracketZoomLevel,
    setBracketZoomLevel,
    mobileInputPollingMs,
    changeMobileInputPollingMs,
    commitMobileInputPollingMs,
    disableLocalCommunication,
    setDisableLocalCommunication,
  } = useAppPreferences();
  const {
    senderProfile,
    senderProfileReady,
    senderNameDraft,
    setSenderNameDraft,
    senderUserIdDraft,
    changeSenderUserIdDraft,
    normalizedSenderNameDraft,
    normalizedSenderUserIdDraft,
    normalizedBindIpDraft: normalizedSenderBindIpDraft,
    normalizedSubnetMaskDraft: normalizedBroadcastSubnetMaskDraft,
    networkCandidateOptions: senderNetworkCandidateOptions,
    selectedNetworkCandidateKey: selectedSenderNetworkCandidateKey,
    setSelectedNetworkCandidateKey: setSelectedSenderNetworkCandidateKey,
    networkCandidatesLoading: senderNetworkCandidatesLoading,
    selectedNetworkCandidate: selectedSenderNetworkCandidate,
    refreshNetworkCandidates: refreshLocalNetworkSettingsCandidates,
    shouldRecommendMailboxClearForIdentityChange,
    setIdentityChangedSinceMailboxClear: setSenderIdentityChangedSinceMailboxClear,
    fillRandomSenderUserId,
    canSaveSenderProfile,
    saveSenderProfile,
  } = useSenderProfile(setError, setMessage, activeTab);
  const {
    obsOverlayState,
    obsOverlayBusy,
    testOverlayRedName,
    setTestOverlayRedName,
    testOverlayBlueName,
    setTestOverlayBlueName,
    testOverlayRedWins,
    setTestOverlayRedWins,
    testOverlayBlueWins,
    setTestOverlayBlueWins,
    isTestOverlayActive,
    overlayPreviewWrapRef,
    overlayPreviewIframeRef,
    refreshObsOverlayState,
    updateObsOverlayNameFitMode,
    updateObsOverlayShowSetInfo,
    updateObsOverlayShowEventAlias,
    setObsOverlayFullyStopped,
    toggleObsOverlaySet,
    toggleTestOverlay,
    handlePreviewLoad,
  } = useObsOverlay({ activeTab, slug, selectedEventId, setError });
  const {
    workspace,
    setWorkspace,
    localSnapshotEvents,
    setLocalSnapshotEvents,
    loadingLocalSnapshotEvents,
    fetchLocalSnapshotEvents,
    loadWorkspace,
    refreshRemoteSnapshot,
    restoreWorkspaceGraph,
    saveEventManagementMeta,
    saveEventAlias,
    saveLocalPlayerMeta,
    saveLocalSetPlaySide,
  } = useTournamentWorkspace({
    activeTab,
    slug,
    selectedEventId,
    busy,
    createBusy,
    onWorkspaceUpdated: (result) => {
      clearAllDrafts();
      const refreshedDraft = resolveWorkspaceMatchDraftState(
        result,
        selectedEventId,
        activeMatchSetId,
        getSetSlotSide,
      );
      if (!refreshedDraft) {
        return;
      }

      setScoreDrafts(refreshedDraft.scoreDrafts);
      setDirectWinnerId(refreshedDraft.directWinnerId);
      setActiveMatchSideDrafts(refreshedDraft.sideDrafts);
    },
  });
  const {
    saveMatchResult: persistMatchResult,
    discardDraftsForEvent,
    discardDraftForMatch,
    resetMatchResultCascade,
  } = useSetResultPersistence<TournamentWorkspace>({
    setWorkspace,
    setBusy,
    setError,
    setMessage,
    saveSides: (event, set, sideDrafts) => saveMatchSidesIfNeeded(event, set, sideDrafts),
    buildSlotScores: buildSlotScoresForSave,
    resolveWinnerId: resolveWinnerIdFromDrafts,
    syncOverlayScores: syncObsOverlayScoresForSet,
    saveSetDraft,
    removeInterimDraft,
    removeDraftsForSet,
    clearAllDrafts,
    restoreSetDraftState: (restoredWorkspace, eventId, targetSetId) => {
      const restoredSet = restoredWorkspace.snapshot.events
        .find((event) => event.eventId === eventId)
        ?.sets.find((set) => set.setId === targetSetId);

      if (!restoredSet) {
        closeMatchDialog();
        return;
      }

      setScoreDrafts(buildScoreDraftsFromSet(restoredSet));
      const sideMap = new Map(
        (restoredWorkspace.localMeta.setPlaySides ?? []).map(
          (item) => [`${item.setId}:${item.entrantId}`, item.playSide] as const,
        ),
      );
      const sideDrafts = buildMatchSideDrafts(
        restoredSet,
        (setId, entrantId) => sideMap.get(`${setId}:${entrantId}`) ?? "",
      );
      setActiveMatchSideDrafts(sideDrafts);
    },
    refreshSnapshotEvents: refreshLocalSnapshotEvents,
    closeMatchDialog,
  });
  const {
    itemLists,
    itemListName,
    setItemListName,
    itemCategoryName,
    setItemCategoryName,
    itemListText,
    setItemListText,
    itemListSearchInput,
    setItemListSearchInput,
    editingItemListId,
    filteredItemLists,
    resetItemListEditor,
    editItemList,
    saveItemList,
    removeItemList,
  } = useItemLists({ onError: setError, onMessage: setMessage });
  const refreshLocalSnapshotEventsRef = useRef<() => Promise<void>>(async () => undefined);
  async function refreshLocalSnapshotEvents() {
    await refreshLocalSnapshotEventsRef.current();
  }
  const selectLocalSnapshotEventRef = useRef<
    (item: LocalSnapshotEventListItem) => Promise<unknown>
  >(async () => undefined);
  const {
    startupSavedSlugRef,
    startupSavedEventIdRef,
    markSnapshotEventsLoaded,
    markStartupAutoRestoreDone,
    clearStartupSelection,
  } = useSnapshotStartupRestore({
    localSnapshotEvents,
    loadingLocalSnapshotEvents,
    workspace,
    loadWorkspace,
    refreshLocalSnapshotEvents,
    selectLocalSnapshotEvent: (item) => selectLocalSnapshotEventRef.current(item),
    setSlug,
    setSelectedEventId,
    setSelectedPhaseName,
    setSelectedPhasePoolKey,
    setError,
  });
  const {
    cameraActive: dqCameraActive,
    videoRef: dqCameraVideoRef,
    canvasRef: dqCameraCanvasRef,
    startDqCameraScan,
    stopDqCameraScan,
  } = useDqCameraScan();
  const tournamentCreation = useTournamentCreation({
    slug,
    perPage: STARTGG_FETCH_PER_PAGE,
    setCreateBusy,
    setBusy,
    setError,
    setMessage,
    onSnapshotCreated: async () => {
      setWorkspace(null);
      markStartupAutoRestoreDone();
      await refreshLocalSnapshotEvents();
      setActiveTab("create");
    },
  });
  const {
    token,
    setToken,
    createPreview,
    createPreviewLoadFailed,
    createSelectedEventId,
    createEventSearchInput,
    setCreateEventSearchInput,
    createEventAlias,
    setCreateEventAlias,
    createSnapshotProgress,
    setCreateSnapshotProgress,
    createFilteredEvents,
    createSnapshotProgressPercent,
    createSnapshotProgressLabel,
    saveToken,
    loadCreatePreview,
    handleCreateEventDropdownChange,
    createEventSnapshotBySlug,
  } = tournamentCreation;
  const {
    snapshot,
    pendingSetResults,
    pendingGrandFinalResetResults,
    confirmedReportableCount,
    draftPendingCount,
    setPlaySideMap,
    getSetSlotSide,
    getSetSlotSideLabel,
    allSets,
    selectedEvent,
    resolvedEventSetsById,
    selectedEventMeta,
    eventAliasDraft,
    setEventAliasDraft,
  } = useSelectedEventData(workspace, selectedEventId);
  const mobileInputPortal = useMobileInputPortal({
    slug,
    selectionKey: selectedEventId,
    eventId: selectedEvent?.eventId ?? null,
    pollingMs: normalizeMobileInputPollingMs(mobileInputPollingMs),
    setError,
    setMessage,
  });
  const {
    busy: mobileInputPortalBusy,
    open: mobileInputPortalOpen,
    portalInfo: mobileInputPortalDialog,
    candidates: mobileInputPortalCandidates,
    issuedUrl: mobileInputIssuedUrl,
    issuedUrlDisplayIp: mobileInputIssuedUrlDisplayIp,
    qrUrl: mobileInputPortalQrUrl,
    closeDialog: closeMobileInputPortalDialog,
    openDialog: openMobileInputPortalDialog,
    issueUrl: issueMobileInputPortalUrl,
    refreshDialog: refreshMobileInputPortalDialog,
    copyUrl: copyMobileInputUrl,
  } = mobileInputPortal;

  const bracketReport = useBracketReport<TournamentWorkspace>({
    slug: toApiSlug(slug),
    eventId: selectedEvent?.eventId ?? null,
    perPage: STARTGG_FETCH_PER_PAGE,
    reportableCount: confirmedReportableCount,
    setWorkspace,
    closeMatchDialog,
    setBusy,
    setError,
    setMessage,
    clearSnapshotProgress: () => setCreateSnapshotProgress(null),
  });

  const { selectedMessageScope, selectedMailboxScope } = useMessageScopes({
    snapshot,
    selectedEvent,
    selectedPhaseName,
    selectedPhasePoolKey,
  });

  const {
    genericMessages,
    mailboxMethodDraft,
    setMailboxMethodDraft,
    mailboxSubjectDraft,
    setMailboxSubjectDraft,
    messageDeliveryMode,
    setMessageDeliveryMode,
    messageDeliveryIpDraft,
    setMessageDeliveryIpDraft,
    composeFixedBodyDraft,
    setComposeFixedBodyDraft,
    genericMessageBodyDraft,
    setGenericMessageBodyDraft,
    replyBodyDraft,
    setReplyBodyDraft,
    setSelectedThreadId,
    mailboxServiceStarted,
    setComposeMessageMeta,
    mailboxFilterSetting,
    updateMailboxFilter,
    mailboxThreadSummaries,
    unreadMessageCount,
    mailboxThreads,
    activeThread,
    activeThreadMessages,
    activeThreadResolved,
    canResolveActiveThread,
    resolveActiveThread: resolveMailboxThread,
    canSendGenericMessage,
    canReplyToThread,
    canDeleteActiveThread,
    canOpenDqDialog,
    postGenericMessage,
    replyToThread,
    openDqRequestDialog,
    closeDqRequestDialog,
    submitDqRequest,
    deleteActiveThread,
    forceClearMessages: forceClearMailboxMessages,
    dqDialog,
    dqPlayerIdDraft,
    setDqPlayerIdDraft,
    dqReasonDraft,
    setDqReasonDraft,
    dqDialogError,
    setDqDialogError,
    dqSubmitting,
  } = useMailbox({
    activeTab,
    scope: selectedMailboxScope,
    senderProfile,
    senderProfileReady,
    disableLocalCommunication,
    onError: setError,
    onMessage: setMessage,
    onStopDqCameraScan: stopDqCameraScan,
    onForceClearComplete: () => {
      resetCallListDisplay({ clearOwnOnly: true });
      setSenderIdentityChangedSinceMailboxClear(false);
    },
  });

  const {
    displayGroups: callListDisplayGroups,
    hasCallListMessages,
    eventGroups: unresolvedCallEventGroups,
    activePage: activeUnresolvedCallEventPage,
    rootCounts: unresolvedCallRootCounts,
    focusOwnUnresolved: callListFocusOwnUnresolved,
    eventSortStrategy: callListEventSortStrategy,
    toggleSort: toggleCallListSort,
    currentPage: callListCurrentPage,
    totalPages: callListTotalPages,
    pageSwitchedAtMs: callListPageSwitchedAtMs,
    pageProgressPercent: normalizedCallListPageProgressPercent,
    pageRotateSeconds: callListPageRotateSeconds,
    changePageRotateSeconds: changeCallListPageRotateSeconds,
    commitPageRotateSeconds: commitCallListPageRotateSeconds,
    colorSeconds: callListColorSeconds,
    changeColorSeconds: changeCallListColorSeconds,
    commitColorSeconds: commitCallListColorSeconds,
    colorToRedSeconds: callListColorToRedSeconds,
    resetDisplay: resetCallListDisplay,
    advancePage: advanceCallListPage,
  } = useCallList({
    activeTab,
    genericMessages,
    senderUserId: senderProfile.senderUserId,
  });

  const {
    homeSnapshotSearchInput,
    setHomeSnapshotSearchInput,
    setHomeSelectedSnapshotKey,
    homeFilteredSnapshotEvents,
    homeSelectedSnapshotItem,
    selectedSummaryName,
    selectedSidebarItem,
  } = useSnapshotSelectionView({
    localSnapshotEvents,
    snapshot,
    selectedEvent,
    selectedEventMeta,
    selectedEventId,
    setSelectedEventId,
    startupSavedSlugRef,
    startupSavedEventIdRef,
  });

  const { resetLastPersistedSnapshotSelection } = usePersistSnapshotSelection({
    snapshot,
    selectedEvent,
    selectedMessageScope,
    selectedPhaseName,
    selectedPhasePoolKey,
    setLocalSnapshotEvents,
    setError,
  });
  const { refreshLocalSnapshotEvents: refreshSnapshotEventList } = useSnapshotEventListRefresh({
    activeTab,
    fetchLocalSnapshotEvents,
    startupSavedSlugRef,
    startupSavedEventIdRef,
    clearStartupSelection,
    markSnapshotEventsLoaded,
    resetLastPersistedSnapshotSelection,
    setWorkspace,
    setSelectedEventId,
    setSelectedPhaseName,
    setSelectedPhasePoolKey,
    setHomeSelectedSnapshotKey,
    setError,
  });
  refreshLocalSnapshotEventsRef.current = refreshSnapshotEventList;

  const selectedEventSettingKey = snapshot && selectedEvent
    ? buildEventManagementSettingKey(snapshot.slug, selectedEvent.eventId)
    : "";

  const {
    eventMgmtSettings,
    sideDecisionMethod,
    setSideDecisionMethod,
    selectedEventItemListSnapshots,
    configuredCategorySlots,
    selectedCategoryUsageList,
    categorySlotListIds,
    categorySlotMinCounts,
    categorySlotMaxCounts,
    categorySlotAllowDuplicates,
    totalItemMinCount,
    totalItemMaxCount,
    setEventMgmtSettings,
    setCategoryListSlot,
    handleCategorySlotMinChange,
    handleCategorySlotMaxChange,
    handleCategorySlotAllowDuplicatesChange,
    handleTotalItemMinChange,
    handleTotalItemMaxChange,
    removeItemListSettings,
    saveEventManagementSetting,
  } = useEventManagementSettings({
    selectedEventSettingKey,
    selectedEventMeta,
    selectedEvent,
    slug,
    itemLists,
    saveEventManagementMeta,
    setBusy,
    setError,
    setMessage,
  });

  const {
    selectLocalSnapshotEvent,
    deleteLocalSnapshotEvent,
    saveSelectedEventAlias,
    updateSnapshot,
    restoreGraphFromSnapshot,
  } = useEventSnapshotMaintenance({
    slug,
    selectedEventId,
    selectedEvent,
    eventAliasDraft,
    perPage: STARTGG_FETCH_PER_PAGE,
    setBusy,
    setError,
    setMessage,
    setCreateSnapshotProgress,
    setRestoreDialogOpen,
    setSlug,
    setSelectedEventId,
    setSelectedPhaseName,
    setSelectedPhasePoolKey,
    setDeletingSnapshotKey,
    setWorkspace,
    setEventMgmtSettings,
    eventSettingKey: buildEventManagementSettingKey,
    snapshot,
    saveEventAlias,
    refreshRemoteSnapshot,
    restoreWorkspaceGraph,
    refreshLocalSnapshotEvents,
    loadWorkspace,
    clearAllDrafts,
    closeMatchDialog,
  });
  selectLocalSnapshotEventRef.current = selectLocalSnapshotEvent;

  useSnapshotTabAutoLoad({
    activeTab,
    busy,
    loadingLocalSnapshotEvents,
    selectedSidebarItem,
    workspace,
    selectLocalSnapshotEvent,
  });

  const {
    entrants: selectedEventEntrants,
    selectedEntrant: selectedTournamentEntrant,
    setSelectedEntrantId: setSelectedTournamentEntrantId,
  } = useSelectedEventEntrants(selectedEvent);

  const {
    selectedEntrantDraftSelectionsBySlot,
    selectedEntrantValidationErrors,
    addSelectedEntrantDraftSelection,
    removeSelectedEntrantDraftSelection,
    saveSelectedEntrantMeta,
  } = usePlayerMetaDrafts({
    selectedEvent,
    selectedEventMeta,
    selectedEventEntrants,
    selectedEntrant: selectedTournamentEntrant,
    categorySlotListIds,
    categorySlotAllowDuplicates,
    totalItemMinCount,
    totalItemMaxCount,
    itemLists,
    selectedEventItemListSnapshots,
    slug,
    configuredCategorySlots,
    saveLocalPlayerMeta,
    setBusy,
    setError,
    setMessage,
  });

  const {
    players: userCardPlayers,
    selectedPlayerIds: selectedUserCardPlayerIds,
    selectedPlayer: selectedUserCardPlayer,
    selectedPlayerPreviewUrl: selectedUserCardPreviewUrl,
    busy: userCardBusy,
    handlePlayerSelect: handleUserCardPlayerSelect,
    selectAllPlayers: selectAllUserCardPlayers,
    clearPlayerSelection: clearAllUserCardPlayersSelection,
    saveSelectedCards: saveSelectedUserCardImage,
    exportSelectedCardsAsA4Sheet: exportSelectedPlayerCardsAsA4Sheet,
  } = useUserCards({
    tournamentId: snapshot?.tournamentId ?? null,
    tournamentName: snapshot?.name ?? "",
    eventId: selectedEvent?.eventId ?? null,
    eventName: selectedEvent?.name ?? "",
    eventAlias: selectedEventMeta?.eventAlias ?? null,
    entrants: selectedEventEntrants,
    disableLocalCommunication,
    onError: setError,
    onMessage: setMessage,
  });

  const shouldShowBracketSnapshotRefreshProgress = useMemo(() => {
    const isReportSnapshotRefresh = bracketReport.progress?.phase === "refreshingSnapshot";
    const isManualBracketRefresh = busy && !createBusy && createSnapshotProgress !== null;
    return (isReportSnapshotRefresh || isManualBracketRefresh) && createSnapshotProgress !== null;
  }, [bracketReport.progress, busy, createBusy, createSnapshotProgress]);

  const hasSelectedSenderNetworkDevice = selectedSenderNetworkCandidate !== null;
  const senderIdCollision = useMemo(() => hasSenderIdCollision(
    genericMessages,
    normalizedSenderUserIdDraft,
    normalizedSenderNameDraft,
  ), [genericMessages, normalizedSenderNameDraft, normalizedSenderUserIdDraft]);

  const isSenderProfileReadyForMessaging = resolveSenderProfileReadiness(senderProfile);
  const canBroadcastCallListSync = resolveCanBroadcastCallListSync(senderProfile, disableLocalCommunication);

  const {
    requestUnresolvedCallSyncBroadcast,
    clearCallListThreads,
  } = useCallSync({
    messages: genericMessages,
    displayGroups: callListDisplayGroups,
    senderProfile,
    communicationDisabled: disableLocalCommunication,
    canBroadcastSync: canBroadcastCallListSync,
    shouldWarnIdentityChange: shouldRecommendMailboxClearForIdentityChange,
    resetDisplay: resetCallListDisplay,
    onError: setError,
    onMessage: setMessage,
  });

  const {
    applySideDecisionMethodToAllUnconfirmedSets,
    saveMatchSideDraftsForResult,
  } = useSetSideAssignment({
    slug,
    selectedEvent,
    resolvedEventSetsById,
    setPlaySideMap,
    selectedEventSettingKey,
    sideDecisionMethod,
    eventMgmtSettings,
    saveLocalSetPlaySide,
    resolveMatchSideDraftSavePlan: (set, sideDrafts) => resolveMatchSideDraftSavePlan(
      set,
      sideDrafts,
      getSetSlotSide,
      (setId, entrantId, slotIndex) => getSetSlotSideLabel(setId, entrantId, {
        fallbackBySlotIndex: slotIndex,
        matchupReady: true,
      }),
    ),
    syncOverlayScores: syncObsOverlayScoresForSet,
    setBusy,
    setError,
    setMessage,
  });

  function deleteItemList(itemListId: string) {
    removeItemList(itemListId);
    removeItemListSettings(itemListId);
    setMessage("アイテムリストを削除しました。");
  }

  async function syncObsOverlayScoresForSet(
    set: SetSnapshot,
    slotScores: Array<{ entrantId: string; score: number }>,
    sideOverrides?: Record<string, PlaySide | "">,
  ) {
    await syncOverlayScoresForSet(set, slotScores, sideOverrides);
  }

  const {
    phaseNames,
    phaseScopedPoolGroups,
    selectedPhasePoolGroup,
    activeMatch,
    activeObsOverlaySet,
    isActiveMatchDqDraft,
    renderedBracketSectionsForView,
    bracketScaleStyle,
    setDisplayCodeById,
    resolveTbdSourceLabel,
  } = useBracketSectionView({
    selectedEvent,
    allSets,
    resolvedEventSetsById,
    selectedPhaseName,
    selectedPhasePoolKey,
    activeMatchSetId,
    pendingGrandFinalResetResults,
    bracketZoomLevel,
    obsOverlayState,
    scoreDrafts,
  });
  const {
    overlaySwitchConfirm,
    requestToggleActiveMatchOverlay,
    cancelOverlaySwitch,
    confirmOverlaySwitch,
    toggleActiveMatchOverlay,
    syncOverlayScoresForSet,
  } = useObsOverlaySetActions({
    selectedEvent,
    eventAlias: selectedEventMeta?.eventAlias?.trim() ?? "",
    obsOverlayState,
    setDisplayCodeById,
    getSavedSide: getSetSlotSide,
    refreshObsOverlayState,
    toggleObsOverlaySet,
  });

  const { sendCallMessageFromMatch, cancelCallMessageDraft } = useCallMessageDraft({
    tournament: snapshot ? { tournamentId: snapshot.tournamentId, name: snapshot.name } : null,
    event: selectedEvent,
    activeMatch,
    eventAlias: selectedEventMeta?.eventAlias ?? "",
    senderProfile,
    communicationDisabled: disableLocalCommunication,
    setCallingEntrantId,
    setComposeMessageMeta,
    setMailboxMethodDraft,
    setMailboxSubjectDraft,
    setMessageDeliveryMode,
    setMessageDeliveryIpDraft,
    setComposeFixedBodyDraft,
    setGenericMessageBodyDraft,
    closeMatchDialog,
    setActiveTab,
    onError: setError,
    onMessage: setMessage,
  });

  const {
    pendingResultBySetId,
    roundRobinBoardData,
    roundRobinMatrixRows,
    eliminationBracketSections,
    getSetScoresForDisplay,
  } = useBracketContentView({
    selectedEvent,
    selectedPhasePoolGroup,
    renderedSections: renderedBracketSectionsForView,
    resolvedEventSetsById,
    pendingSetResults,
    pendingGrandFinalResetResults,
    interimScoreDraftsBySetId,
    obsOverlayState,
    setDisplayCodeById,
    getTbdSourceLabel: resolveTbdSourceLabel,
    getSideLabel: getSetSlotSideLabel,
    formatScoreValue,
    isDqScoreValue,
  });

  usePhasePoolSelection({
    phaseNames,
    phaseScopedPoolGroups,
    selectedPhaseName,
    selectedPhasePoolKey,
    setSelectedPhaseName,
    setSelectedPhasePoolKey,
  });

  const {
    swapMatchSides,
    randomizeMatchSides,
    randomNotice: matchSideRandomNotice,
    clearRandomNotice: clearMatchSideRandomNotice,
  } = useMatchSideDraftActions({
    activeMatchSideDrafts,
    setActiveMatchSideDrafts,
    getSetSlotSide,
  });

  const {
    openMatchDialog,
    handleRoundRobinMatchClick,
    handleEliminationSetActivate,
  } = useMatchDialogActions({
    selectedEvent,
    resolvedEventSetsById,
    pendingResultBySetId,
    setActiveMatchSetId,
    setActiveMatchSideDrafts,
    getSetSlotSide,
    getSetScoresForDisplay,
    initializeMatchDraft,
    busy,
    overlayBusy: obsOverlayBusy,
    stopOverlay: setObsOverlayFullyStopped,
    toggleOverlay: toggleActiveMatchOverlay,
  });

  const { processDqRequestFromMessage } = useDqRequestNavigation({
    event: selectedEvent,
    mailboxThreadSummaries,
    resolvedSetsById: resolvedEventSetsById,
    setSelectedPhaseName,
    setSelectedPhasePoolKey,
    setActiveTab,
    openMatchDialog,
    onError: setError,
    onMessage: setMessage,
  });

  function closeMatchDialog() {
    setActiveMatchSetId("");
    setActiveMatchSideDrafts({});
    clearMatchSideRandomNotice();
    setDirectWinnerId(null);
  }

  async function saveLocalResultForMatch(
    confirmed: boolean,
    confirmation?: ResultConfirmationState,
  ) {
    const set = confirmation?.match ?? activeMatch;
    if (!set) {
      return;
    }

    await persistMatchResult({
      slug: toApiSlug(slug),
      event: selectedEvent,
      set,
      confirmed,
      directWinnerId: confirmation ? confirmation.directWinnerId : directWinnerId,
      scoreDrafts: confirmation?.scoreDrafts ?? scoreDrafts,
      sideDrafts: activeMatchSideDrafts,
    });
  }

  async function saveMatchSidesIfNeeded(
    eventSnapshot: EventSnapshot,
    set: SetSnapshot,
    sideDrafts: Record<string, PlaySide | "">,
  ) {
    return saveMatchSideDraftsForResult(eventSnapshot, set, sideDrafts);
  }

  const statusProgresses: AppStatusProgress[] = [];
  if (createBusy) {
    statusProgresses.push({
      id: "snapshot-creation",
      label: createSnapshotProgressLabel || "処理中...",
      percent: createSnapshotProgressPercent,
      valueLabel: createSnapshotProgress && createSnapshotProgress.totalSets !== null
        ? `${Math.round(createSnapshotProgressPercent)}%`
        : undefined,
      ariaLabel: "スナップショット作成の進捗",
    });
  }
  if (bracketReport.progress) {
    statusProgresses.push({
      id: "bracket-report",
      label: bracketReport.progressLabel,
      percent: bracketReport.progressPercent,
      valueLabel: `${Math.round(bracketReport.progressPercent)}%`,
      ariaLabel: "結果報告の進捗",
    });
  }
  if (shouldShowBracketSnapshotRefreshProgress && createSnapshotProgress) {
    statusProgresses.push({
      id: "bracket-snapshot-refresh",
      label: `報告後スナップショット更新: ${createSnapshotProgressLabel}`,
      percent: createSnapshotProgressPercent,
      valueLabel: createSnapshotProgress.totalSets !== null
        ? `${Math.round(createSnapshotProgressPercent)}%`
        : undefined,
      ariaLabel: "報告後スナップショット更新の進捗",
    });
  }

  return (
    <AppShell
      appVersion={appVersion}
      activeTab={activeTab}
      onTabSelect={setActiveTab}
      unreadMessageCount={unreadMessageCount}
      unresolvedCallCount={unresolvedCallRootCounts.total}
      sidebarSummary={snapshot
        ? { name: selectedSummaryName, slug: snapshot.slug, eventCount: snapshot.events.length }
        : selectedSidebarItem
          ? { name: selectedSummaryName, slug: selectedSidebarItem.slug, tournamentName: selectedSidebarItem.tournamentName }
          : null}
      headerContent={activeTab === "call-list" ? (
        <StatusBoardHero
          currentPage={callListCurrentPage}
          totalPages={callListTotalPages}
          sortStrategy={callListEventSortStrategy}
          onToggleSort={toggleCallListSort}
          canBroadcastSync={canBroadcastCallListSync}
          onBroadcastSync={() => void requestUnresolvedCallSyncBroadcast()}
          onNextPage={advanceCallListPage}
          pageProgressPercent={normalizedCallListPageProgressPercent}
        />
      ) : null}
      message={message}
      error={error}
      statusProgresses={statusProgresses}
    >

        {activeTab === "create" && (
          <>
            <CreateSnapshot
              token={token}
              onTokenChange={setToken}
              slug={slug}
              onSlugChange={setSlug}
              createBusy={createBusy}
              canLoadPreview={toApiSlug(slug) !== "" && token.trim() !== ""}
              onSaveToken={saveToken}
              onLoadPreview={loadCreatePreview}
              createPreview={createPreview}
              createPreviewLoadFailed={createPreviewLoadFailed}
              createEventSearchInput={createEventSearchInput}
              onEventSearchInputChange={setCreateEventSearchInput}
              createFilteredEvents={createFilteredEvents}
              createSelectedEventId={createSelectedEventId}
              onEventDropdownChange={handleCreateEventDropdownChange}
              createEventAlias={createEventAlias}
              onEventAliasChange={setCreateEventAlias}
              canCreateSnapshot={token.trim() !== "" && toApiSlug(slug) !== "" && createSelectedEventId !== "" && toEventApiSlug(slug, createPreview?.events.find((event) => event.eventId === createSelectedEventId)?.eventSlug ?? "") !== ""}
              onCreateSnapshot={() => void createEventSnapshotBySlug()}
            />
            <EventSelector
              items={localSnapshotEvents}
              filteredItems={homeFilteredSnapshotEvents}
              loading={loadingLocalSnapshotEvents}
              searchInput={homeSnapshotSearchInput}
              onSearchInputChange={setHomeSnapshotSearchInput}
              selectedItem={homeSelectedSnapshotItem}
              onSelectedKeyChange={setHomeSelectedSnapshotKey}
              deletingKey={deletingSnapshotKey}
              busy={busy}
              onRefresh={() => void refreshLocalSnapshotEvents()}
              onSelectEvent={(item) => void selectLocalSnapshotEvent(item)}
              onDeleteEvent={(item) => void deleteLocalSnapshotEvent(item)}
            />
          </>
        )}

        {activeTab === "tournament" && (
          <EventSetting
            event={{
              hasSelectedEvent: Boolean(selectedEvent),
              tournamentName: snapshot?.name ?? "-",
              eventName: selectedEvent?.name ?? "",
              busy,
              canUpdateSnapshot: toApiSlug(slug) !== "",
              eventAliasDraft,
            }}
            rules={{
              sideDecisionMethod,
              itemLists,
              categorySlotListIds,
              categorySlotMinCounts,
              categorySlotMaxCounts,
              categorySlotAllowDuplicates,
              totalItemMinCount,
              totalItemMaxCount,
            }}
            playerMeta={{
              selectedEventEntrants,
              selectedEventMetaEntrantCount: selectedEventMeta?.entrants.length ?? 0,
              selectedEntrantId: selectedTournamentEntrant?.entrantId ?? "",
              selectedEntrantName: selectedTournamentEntrant?.entrantName ?? "",
              configuredCategorySlots,
              selectedCategoryUsageList,
              draftSelectionsBySlot: selectedEntrantDraftSelectionsBySlot,
              validationErrors: selectedEntrantValidationErrors,
              canSavePlayerMeta: !busy && toApiSlug(slug) !== "",
            }}
            actions={{
              onUpdateSnapshot: () => void updateSnapshot(),
              onEventAliasDraftChange: setEventAliasDraft,
              onSaveEventAlias: () => void saveSelectedEventAlias(),
              onSideDecisionMethodChange: setSideDecisionMethod,
              onApplySideDecisionMethod: () => void applySideDecisionMethodToAllUnconfirmedSets(),
              onCategoryListChange: setCategoryListSlot,
              onCategoryMinChange: handleCategorySlotMinChange,
              onCategoryMaxChange: handleCategorySlotMaxChange,
              onCategoryAllowDuplicatesChange: handleCategorySlotAllowDuplicatesChange,
              onTotalItemMinChange: handleTotalItemMinChange,
              onTotalItemMaxChange: handleTotalItemMaxChange,
              onSaveEventManagementSetting: saveEventManagementSetting,
              onSelectEntrant: setSelectedTournamentEntrantId,
              onAddDraftSelection: addSelectedEntrantDraftSelection,
              onRemoveDraftSelection: removeSelectedEntrantDraftSelection,
              onSavePlayerMeta: saveSelectedEntrantMeta,
            }}
          />
        )}
        {activeTab === "message" && (
          <MessageBox
            senderLabel={formatSenderProfileLabel(senderProfile)}
            senderProfileReady={isSenderProfileReadyForMessaging}
            disableLocalCommunication={disableLocalCommunication}
            mailboxServiceStarted={mailboxServiceStarted}
            mailboxMethodDraft={mailboxMethodDraft}
            getMailboxMethodLabel={getMailboxMethodLabel}
            mailboxSubjectDraft={mailboxSubjectDraft}
            onMailboxSubjectChange={setMailboxSubjectDraft}
            messageDeliveryMode={messageDeliveryMode}
            onMessageDeliveryModeChange={setMessageDeliveryMode}
            messageDeliveryIpDraft={messageDeliveryIpDraft}
            onMessageDeliveryIpChange={setMessageDeliveryIpDraft}
            composeFixedBodyDraft={composeFixedBodyDraft}
            genericMessageBodyDraft={genericMessageBodyDraft}
            onGenericMessageBodyChange={setGenericMessageBodyDraft}
            onCancelFixedMessage={cancelCallMessageDraft}
            canSendGenericMessage={canSendGenericMessage}
            onPostGenericMessage={() => void postGenericMessage()}
            mailboxFilterSetting={mailboxFilterSetting}
            onMailboxFilterChange={updateMailboxFilter}
            mailboxThreads={mailboxThreads}
            mailboxThreadSummaries={mailboxThreadSummaries}
            activeThread={activeThread}
            activeThreadMessages={activeThreadMessages}
            activeThreadResolved={activeThreadResolved}
            onSelectThread={setSelectedThreadId}
            onProcessDqRequest={processDqRequestFromMessage}
            isDqRequestMessage={isDqRequestMessage}
            canResolveActiveThread={canResolveActiveThread}
            onResolveActiveThread={resolveMailboxThread}
            canDeleteActiveThread={canDeleteActiveThread}
            onDeleteActiveThread={deleteActiveThread}
            replyBodyDraft={replyBodyDraft}
            onReplyBodyChange={setReplyBodyDraft}
            canReplyToThread={canReplyToThread}
            onReplyToThread={() => void replyToThread()}
            canOpenDqDialog={canOpenDqDialog}
            onOpenDqDialog={openDqRequestDialog}
          />
      )}

      {activeTab === "call-list" && (
        <StatusBoard
          eventGroups={unresolvedCallEventGroups}
          activePage={activeUnresolvedCallEventPage}
          hiddenUnresolvedCount={unresolvedCallRootCounts.hidden}
          focusOwnUnresolved={callListFocusOwnUnresolved}
          onShowAllUnresolved={() => {
            resetCallListDisplay({ clearOwnOnly: true });
            setMessage("呼び出しリストを全未解決表示に戻しました。");
          }}
          resolvePhaseName={(eventId, phaseName) => resolveCallPhaseName(
            snapshot?.events.find((event) => event.eventId === eventId) ?? null,
            phaseName,
            null,
          )}
          pageSwitchedAtMs={callListPageSwitchedAtMs}
          colorToRedSeconds={callListColorToRedSeconds}
        />
      )}

      {dqDialog && (
        <DqRequestDialog
          dialog={dqDialog}
          playerIdDraft={dqPlayerIdDraft}
          onPlayerIdChange={setDqPlayerIdDraft}
          reasonDraft={dqReasonDraft}
          onReasonChange={setDqReasonDraft}
          error={dqDialogError}
          submitting={dqSubmitting}
          cameraActive={dqCameraActive}
          videoRef={dqCameraVideoRef}
          canvasRef={dqCameraCanvasRef}
          onStartCameraScan={() => void startDqCameraScan({
            dialogOpen: Boolean(dqDialog),
            onPlayerIdFound: setDqPlayerIdDraft,
            onDialogError: setDqDialogError,
            onMessage: setMessage,
          })}
          onStopCameraScan={stopDqCameraScan}
          onClose={closeDqRequestDialog}
          onSubmit={() => void submitDqRequest()}
        />
      )}

        {activeTab === "item-list" && (
          <ItemListEditor
            itemListName={itemListName}
            onItemListNameChange={setItemListName}
            itemCategoryName={itemCategoryName}
            onItemCategoryNameChange={setItemCategoryName}
            itemListText={itemListText}
            onItemListTextChange={setItemListText}
            isEditing={editingItemListId !== null}
            onSave={saveItemList}
            onReset={resetItemListEditor}
            searchInput={itemListSearchInput}
            onSearchInputChange={setItemListSearchInput}
            filteredItemLists={filteredItemLists}
            onEditItemList={editItemList}
            onDeleteItemList={(itemList) => {
              if (window.confirm(`「${itemList.name}」を削除しますか？`)) {
                deleteItemList(itemList.id);
              }
            }}
          />
      )}

      {activeTab === "overlay" && (
        <OverlayControl
          overlayState={obsOverlayState}
          isTestOverlayActive={isTestOverlayActive}
          activeSetLabel={activeObsOverlaySet?.set.fullRoundText ?? null}
          busy={obsOverlayBusy}
          testRedName={testOverlayRedName}
          testBlueName={testOverlayBlueName}
          testRedWins={testOverlayRedWins}
          testBlueWins={testOverlayBlueWins}
          previewWrapRef={overlayPreviewWrapRef}
          previewIframeRef={overlayPreviewIframeRef}
          onOpenUrl={(url) => {
            void openUrl(url).catch((err) => {
              setError(`URLをブラウザで開けませんでした: ${String(err)}`);
            });
          }}
          onNameFitModeChange={(mode) => void updateObsOverlayNameFitMode(mode)}
          onShowSetInfoChange={(checked) => void updateObsOverlayShowSetInfo(checked)}
          onShowEventAliasChange={(checked) => void updateObsOverlayShowEventAlias(checked)}
          onTestRedNameChange={setTestOverlayRedName}
          onTestBlueNameChange={setTestOverlayBlueName}
          onTestRedWinsChange={setTestOverlayRedWins}
          onTestBlueWinsChange={setTestOverlayBlueWins}
          onToggleTestOverlay={toggleTestOverlay}
          onFullyStop={() => void setObsOverlayFullyStopped(true)}
          onPreviewLoad={handlePreviewLoad}
        />
      )}

        {activeTab === "settings" && (
          <SettingsScreen
            disableLocalCommunication={disableLocalCommunication}
            onDisableLocalCommunicationChange={(checked) => {
              setDisableLocalCommunication(checked);
              setMessage(checked
                ? "ローカル通信を無効化しました。メッセージ機能とプレイヤーリストは閲覧のみになります。"
                : "ローカル通信を有効化しました。メッセージ機能とプレイヤーリストを再開できます。");
            }}
            senderNameDraft={senderNameDraft}
            onSenderNameChange={setSenderNameDraft}
            senderUserIdDraft={senderUserIdDraft}
            onSenderUserIdChange={changeSenderUserIdDraft}
            networkCandidates={senderNetworkCandidateOptions}
            selectedNetworkCandidateKey={selectedSenderNetworkCandidateKey}
            onNetworkCandidateChange={setSelectedSenderNetworkCandidateKey}
            networkCandidatesLoading={senderNetworkCandidatesLoading}
            normalizedBindIp={normalizedSenderBindIpDraft}
            normalizedSubnetMask={normalizedBroadcastSubnetMaskDraft}
            senderSettingsStatus={resolveSenderSettingsStatus({
              senderIdCollision,
              shouldRecommendMailboxClear: shouldRecommendMailboxClearForIdentityChange,
              hasSelectedNetworkDevice: hasSelectedSenderNetworkDevice,
              bindIp: normalizedSenderBindIpDraft,
              broadcastSubnetMask: normalizedBroadcastSubnetMaskDraft,
            })}
            onRefreshNetworkCandidates={() => void refreshLocalNetworkSettingsCandidates(true)}
            onRandomizeSenderUserId={() => fillRandomSenderUserId(
              genericMessages.map((item) => item.senderUserId),
            )}
            onSaveSenderProfile={() => void saveSenderProfile(senderIdCollision)}
            canSaveSenderProfile={canSaveSenderProfile(senderIdCollision)}
            mobileInputPollingMs={normalizeMobileInputPollingMs(mobileInputPollingMs)}
            mobileInputPollingMsMin={MOBILE_INPUT_POLLING_MS_MIN}
            mobileInputPollingMsMax={MOBILE_INPUT_POLLING_MS_MAX}
            onMobileInputPollingMsChange={changeMobileInputPollingMs}
            onMobileInputPollingMsBlur={commitMobileInputPollingMs}
            callListPageRotateSeconds={callListPageRotateSeconds}
            callListRotateSecondsMin={CALL_LIST_ROTATE_SECONDS_MIN}
            callListRotateSecondsMax={CALL_LIST_ROTATE_SECONDS_MAX}
            onCallListPageRotateSecondsChange={changeCallListPageRotateSeconds}
            onCallListPageRotateSecondsBlur={commitCallListPageRotateSeconds}
            callListColorSeconds={callListColorSeconds}
            callListColorSecondsMin={CALL_LIST_COLOR_SECONDS_MIN}
            callListColorSecondsMax={CALL_LIST_COLOR_SECONDS_MAX}
            onCallListColorSecondsChange={changeCallListColorSeconds}
            onCallListColorSecondsBlur={commitCallListColorSeconds}
            callListRotateSecondsDisplay={normalizeCallListRotateSeconds(callListPageRotateSeconds)}
            callListColorToRedSeconds={callListColorToRedSeconds}
            hasCallListMessages={hasCallListMessages}
            onClearCallList={clearCallListThreads}
            hasMessages={genericMessages.length > 0}
            onForceClearMessages={forceClearMailboxMessages}
          />
        )}

        {activeTab === "users" && (
          <PlayerListInfo
            disableLocalCommunication={disableLocalCommunication}
            userCardBusy={userCardBusy}
            hasSelectedEvent={Boolean(snapshot && selectedEvent)}
            selectedEventLabel={selectedEventMeta?.eventAlias?.trim() || "未設定"}
            players={userCardPlayers}
            selectedPlayerIds={selectedUserCardPlayerIds}
            selectedPlayer={selectedUserCardPlayer}
            selectedPlayerPreviewUrl={selectedUserCardPreviewUrl}
            onSaveSelectedCard={() => void saveSelectedUserCardImage()}
            onExportA4Sheet={() => void exportSelectedPlayerCardsAsA4Sheet()}
            onSelectAllPlayers={selectAllUserCardPlayers}
            onClearPlayerSelection={clearAllUserCardPlayersSelection}
            onSelectPlayer={handleUserCardPlayerSelect}
          />
      )}

        {activeTab === "bracket" && (
        <>
          <BracketTab
            draftPendingCount={draftPendingCount}
            confirmedReportableCount={confirmedReportableCount}
            hasSnapshot={Boolean(snapshot)}
            tournamentName={snapshot?.name ?? "-"}
            eventAlias={selectedEventMeta?.eventAlias ?? ""}
            eventName={selectedEvent?.name ?? "-"}
            phaseNames={phaseNames}
            selectedPhaseName={selectedPhaseName}
            onPhaseNameChange={setSelectedPhaseName}
            phaseScopedPoolGroups={phaseScopedPoolGroups}
            selectedPhasePoolGroup={selectedPhasePoolGroup}
            onPhasePoolChange={setSelectedPhasePoolKey}
            bracketScaleStyle={bracketScaleStyle}
            bracketZoomLevel={bracketZoomLevel}
            bracketZoomLevels={BRACKET_ZOOM_LEVELS}
            onBracketZoomChange={(value) => setBracketZoomLevel(normalizeBracketZoomLevel(value))}
            canOpenMobileInput={
              !busy && !mobileInputPortalBusy && toApiSlug(slug) !== "" && Boolean(selectedEvent)
            }
            onOpenMobileInput={() => void openMobileInputPortalDialog()}
            canRestore={!busy && toApiSlug(slug) !== "" && Boolean(selectedEvent)}
            onOpenRestore={() => setRestoreDialogOpen(true)}
            canReport={!busy && toApiSlug(slug) !== "" && confirmedReportableCount > 0}
            onReport={() => void bracketReport.startReport()}
            roundRobin={{
              entrantNames: roundRobinBoardData.entrants.map((entrantId) =>
                roundRobinBoardData.entrantNames.get(entrantId) ?? "",
              ),
              rows: roundRobinMatrixRows,
              standings: roundRobinBoardData.standings,
              tieBreakRules: roundRobinBoardData.tieBreakRules,
              qualifyingCount: roundRobinBoardData.qualifyingCount,
              diagnostics: {
                candidateSetCount: roundRobinBoardData.candidateSetCount,
                twoSlotSetCount: roundRobinBoardData.twoSlotSetCount,
                resolvedSetCount: roundRobinBoardData.resolvedSetCount,
                registeredSetCount: roundRobinBoardData.registeredSetCount,
                unresolvedSetIds: roundRobinBoardData.unresolvedSetIds,
                unresolvedSetReasons: roundRobinBoardData.unresolvedSetReasons,
              },
            }}
            eliminationSections={eliminationBracketSections}
            onRoundRobinMatchClick={handleRoundRobinMatchClick}
            onEliminationSetActivate={handleEliminationSetActivate}
            onOpenSet={openMatchDialog}
          />

          {activeMatch && selectedEvent && (
            <MatchDetailDialog
              match={activeMatch}
              setCode={setDisplayCodeById.get(activeMatch.setId)}
              isLive={isOverlayActiveForSet(obsOverlayState, activeMatch.setId)}
              completed={isCompletedSet(activeMatch)}
              matchupReady={isMatchupReady(activeMatch)}
              busy={busy}
              overlayBusy={obsOverlayBusy}
              scoreInputDisabled={
                busy
                || isCompletedSet(activeMatch)
                || !isMatchupReady(activeMatch)
                || directWinnerId !== null
              }
              directWinnerId={directWinnerId}
              displayPlayersBySide={displayBracketPlayersBySide}
              onDisplayPlayersBySideChange={setDisplayBracketPlayersBySide}
              randomNotice={matchSideRandomNotice}
              players={buildMatchDialogPlayers({
                set: activeMatch,
                displayBySide: displayBracketPlayersBySide,
                sideDrafts: activeMatchSideDrafts,
                scoreDrafts,
                directWinnerId,
                getSavedSide: getSetSlotSide,
                getSideLabel: getSetSlotSideLabel,
                getTbdSourceLabel: resolveTbdSourceLabel,
              })}
              callingEntrantId={callingEntrantId}
              isDqDraft={isActiveMatchDqDraft}
              overlayActive={isOverlayActiveForSet(obsOverlayState, activeMatch.setId)}
              onClose={closeMatchDialog}
              onSwapSides={() => swapMatchSides(activeMatch)}
              onRandomizeSides={() => void randomizeMatchSides(activeMatch)}
              onScoreAdjust={(entrantId, delta) => adjustScoreDraft(activeMatch, entrantId, delta)}
              onScoreChange={(entrantId, value) => changeScoreDraft(activeMatch, entrantId, value)}
              onToggleWinner={toggleDirectWinnerDraft}
              onSetDq={setDisqualificationDraft}
              onCall={(slot, entrantId) => void sendCallMessageFromMatch(slot, entrantId)}
              onDiscardDraft={() => void discardDraftForMatch(toApiSlug(slug), selectedEvent, activeMatch)}
              onResetSet={() => void resetMatchResultCascade({
                slug: toApiSlug(slug),
                event: selectedEvent,
                set: activeMatch,
                perPage: STARTGG_FETCH_PER_PAGE,
              })}
              onSaveDraft={() => void saveLocalResultForMatch(false)}
              onToggleOverlay={() => requestToggleActiveMatchOverlay(activeMatch)}
              onConfirm={() => requestResultConfirmation(activeMatch)}
            />
          )}
          <BracketDialogs
            busy={busy}
            resultConfirmation={resultConfirmation}
            activeSetId={activeMatch?.setId ?? null}
            onCancelResultConfirmation={clearResultConfirmation}
            onConfirmResult={() => {
              const confirmation = resultConfirmation;
              clearResultConfirmation();
              if (confirmation) {
                void saveLocalResultForMatch(true, confirmation);
              }
            }}
            restoreOpen={restoreDialogOpen}
            selectedEventName={selectedEvent?.name ?? "選択中のイベント"}
            canRestoreFromSnapshot={!busy && Boolean(selectedEvent)}
            canUpdateSnapshot={!busy && toApiSlug(slug) !== ""}
            canDiscardAllDrafts={!busy && toApiSlug(slug) !== "" && Boolean(selectedEvent)}
            onCloseRestore={() => setRestoreDialogOpen(false)}
            onRestoreFromSnapshot={() => void restoreGraphFromSnapshot()}
            onUpdateSnapshot={() => {
              setRestoreDialogOpen(false);
              void updateSnapshot();
            }}
            onDiscardAllDrafts={() => {
              setRestoreDialogOpen(false);
              void discardDraftsForEvent(toApiSlug(slug), selectedEvent);
            }}
            overlaySwitch={overlaySwitchConfirm && activeMatch && activeObsOverlaySet ? {
              targetSetLabel: overlaySwitchConfirm.targetSetLabel,
              activeSetLabel: activeObsOverlaySet.set.fullRoundText,
              activeEntrantNames: activeObsOverlaySet.set.slots
                .filter((slot) => slot.entrantName.trim() !== "")
                .map((slot) => slot.entrantName),
            } : null}
            overlayBusy={obsOverlayBusy}
            onCancelOverlaySwitch={cancelOverlaySwitch}
            onConfirmOverlaySwitch={() => confirmOverlaySwitch(activeMatch)}
            mobileInputOpen={mobileInputPortalOpen}
            mobileInputCandidates={mobileInputPortalCandidates}
            mobileInputBusy={mobileInputPortalBusy}
            issuedUrl={mobileInputIssuedUrl}
            issuedUrlDisplayIp={mobileInputIssuedUrlDisplayIp}
            issuedQrUrl={mobileInputPortalQrUrl}
            showIssuedUrl={Boolean(mobileInputPortalDialog)}
            onCloseMobileInput={closeMobileInputPortalDialog}
            onIssueMobileUrl={(bindIp) => void issueMobileInputPortalUrl(bindIp)}
            onCopyMobileUrl={() => void copyMobileInputUrl()}
            onRefreshMobileUrl={() => void refreshMobileInputPortalDialog()}
            conflictDialog={bracketReport.conflictDialog}
            forceOverwriteRemaining={bracketReport.forceOverwriteRemaining}
            onCancelConflict={bracketReport.cancelConflict}
            onForceOverwriteRemainingChange={bracketReport.setForceOverwriteRemaining}
            onContinueConflict={() => void bracketReport.continueWithForceOverwrite()}
          />
        </>
      )}
    </AppShell>
  );
}

export default App;
