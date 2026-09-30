import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CreateSnapshot } from "./CreateSnapshot";
import { DqRequestDialog } from "./DqRequestDialog";
import { useDqCameraScan } from "./useDqCameraScan";
import { useSenderProfile } from "./useSenderProfile";
import { useMobileInputPortal } from "./useMobileInputPortal";
import { useCallSync } from "./useCallSync";
import { resolveCallPhaseName, useCallMessageDraft } from "./useCallMessageDraft";
import { useDqRequestNavigation } from "./useDqRequestNavigation";
import {
  BRACKET_ZOOM_LEVELS,
  MOBILE_INPUT_POLLING_MS_MAX,
  MOBILE_INPUT_POLLING_MS_MIN,
  normalizeBracketZoomLevel,
  normalizeMobileInputPollingMs,
  normalizeStartggFetchPerPage,
  useAppPreferences,
} from "./useAppPreferences";
import { localNetworkCandidateKey } from "./localNetworkSettings";
import { toApiSlug, toEventApiSlug, toSlugInput } from "./slugUtils";
import { SettingsScreen } from "./SettingMenu";
import { StatusBoard, StatusBoardHero } from "./StatusBoard";
import { PlayerListInfo } from "./PlayerListInfo";
import { MessageBox } from "./MessageBox";
import { ItemListEditor } from "./ItemListEditor";
import {
  buildCategoryUsageList,
  buildConfiguredCategorySlots,
} from "./eventManagement";
import {
  MAX_CATEGORY_SLOTS,
  normalizeItemListConfig,
  resolveEventItemList,
  type ItemListConfig,
} from "./itemList";
import { EventSelector, type LocalSnapshotEventListItem } from "./EventSelector";
import { EventSetting, type EventSettingCategorySlot } from "./EventSetting";
import { AppShell, type AppTab } from "./AppShell";
import { OverlayControl } from "./OverlayControl";
import {
  buildOverlaySetRoundText,
  resolveOverlaySidesForSet,
  useObsOverlay,
} from "./useObsOverlay";
import { usePhasePoolSelection } from "./usePhasePoolSelection";
import { useMatchSideDraftActions } from "./useMatchSideDraftActions";
import { buildMatchSideDrafts, resolveMatchSideDraftSavePlan } from "./matchSideDrafts";
import { buildInitialMatchDialogDraft, resolveExistingMatchDialogDraft } from "./matchDialogDraft";
import { BracketTab } from "./BracketTab";
import { BracketDialogs, type ResultConfirmationState } from "./BracketDialogs";
import { MatchDetailDialog, type MatchSideRandomNotice } from "./MatchDetailDialog";
import type { RoundRobinMatrixRowView } from "./RoundRobinMatrix";
import { buildEliminationBracketSections } from "./eliminationBracketDisplay";
import { buildRoundRobinMatrixRows } from "./roundRobinMatrixDisplay";
import { buildRoundRobinBoardData } from "./roundRobinBoardBuilder";

import { useBracketReport } from "./useBracketReport";
import { useSetResultDrafts, type SetResultDraftState } from "./useSetResultDrafts";
import {
  applyScoreDraftWithOpponentDefault,
  buildPendingSetResultsById,
  getSetScoresForDisplay as buildSetScoresForDisplay,
  buildDraftStateFromPending,
  buildScoreDraftsFromResult,
  buildScoreDraftsFromSet,
  buildSlotScoresForSave,
  hasDqScoreInDrafts,
  isConfirmedSetResult,
  isDqScoreValue,
  resolveSetSlotSideLabel,
  resolveWinnerIdFromDrafts,
  stepScoreDraftValue,
} from "./setResultDrafts";
import { useSetResultPersistence } from "./useSetResultPersistence";
import { usePlayerMetaDrafts } from "./usePlayerMetaDrafts";
import { useEventManagementSettings } from "./useEventManagementSettings";
import { useEventSnapshotMaintenance } from "./useEventSnapshotMaintenance";
import { useSetSideAssignment } from "./useSetSideAssignment";
import { useTournamentCreation } from "./useTournamentCreation";
import { useUserCards } from "./useUserCards";
import { useItemLists } from "./useItemLists";
import { useMailbox } from "./useMailbox";
import {
  CALL_LIST_COLOR_SECONDS_MAX,
  CALL_LIST_COLOR_SECONDS_MIN,
  CALL_LIST_ROTATE_SECONDS_MAX,
  CALL_LIST_ROTATE_SECONDS_MIN,
  normalizeCallListColorSeconds,
  normalizeCallListRotateSeconds,
  useCallList,
} from "./useCallList";
import {
  useTournamentWorkspace,
  type PlaySide,
  type TournamentWorkspace,
} from "./useTournamentWorkspace";
import {
  loadLastSlug,
  loadLastSnapshotSelection,
  saveLastSnapshotSelection,
} from "./tournamentWorkspaceRepository";
import { usePersistSnapshotSelection } from "./usePersistSnapshotSelection";
import {
  buildTbdSourceLabelBySlotKey as buildBracketTbdSourceLabelBySlotKey,
  buildSetDisplayCodeById,
  buildBracketSections,
  buildBracketSectionsForView,
  getBracketVerticalLayoutScale,
  getDisplaySlotsForSet,
  buildPhaseNames,
  buildPhasePoolGroups,
  isCompletedSet,
  isDisplayableSet,
  isInactiveGrandFinalReset,
  isMatchupReady,
  resolveSelectedPhasePoolGroup,
  resolveTbdSourceLabel as resolveBracketTbdSourceLabel,
  selectPhaseScopedPoolGroups,
  scaleBracketSectionsForZoom,
  type EventSnapshot,
} from "./bracketDisplay";
import {
  getMailboxMethodLabel,
  isDqRequestMessage,
  isValidIpv4,
  isValidSenderUserId,
  parsePhasePoolKey,
  type MessageScope,
} from "./messageUtils";
import {
  filterLocalSnapshotEvents,
  findSelectedLocalSnapshotEvent,
  findSnapshotEventByIdentity,
  resolveSelectedSnapshotName,
  sameSnapshotEventKey,
} from "./snapshotDisplay";
import {
  createSetEntrantResolver,
  collectEventEntrants,
  sortEventEntrants,
  type EventEntrantSnapshot,
  type SetSlot,
  type SetSnapshot,
} from "./bracketProgression";
import "./App.css";

function normalizeSlugForSettingKey(rawSlug: string): string {
  const trimmed = rawSlug.trim();
  const withoutPrefix = trimmed.startsWith("tournament/")
    ? trimmed.slice("tournament/".length)
    : trimmed;
  return withoutPrefix.replace(/^\/+|\/+$/g, "");
}

function generateRandomSenderUserId(): string {
  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  const value = 10_000_000 + (array[0] % 90_000_000);
  return String(value);
}

function eventSettingKey(slug: string, eventId: string): string {
  return `${normalizeSlugForSettingKey(slug)}::${eventId}`;
}

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [appVersion, setAppVersion] = useState("");
  const [slug, setSlug] = useState("");
  const [eventAliasDraft, setEventAliasDraft] = useState("");
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
    setResultDrafts,
    interimScoreDraftsBySetId,
    saveSetDraft,
    removeInterimDraft,
    removeDraftsForSet,
    clearAllDrafts,
  } = useSetResultDrafts();
  const [activeMatchSideDrafts, setActiveMatchSideDrafts] = useState<Record<string, PlaySide | "">>({});
  const [homeSnapshotSearchInput, setHomeSnapshotSearchInput] = useState("");
  const [homeSelectedSnapshotKey, setHomeSelectedSnapshotKey] = useState("");
  const [deletingSnapshotKey, setDeletingSnapshotKey] = useState("");
  const [overlaySwitchConfirm, setOverlaySwitchConfirm] = useState<{ targetSetId: string; targetSetLabel: string } | null>(null);
  const [resultConfirmation, setResultConfirmation] = useState<ResultConfirmationState | null>(null);
  const [callingEntrantId, setCallingEntrantId] = useState("");
  const [matchSideRandomNotice, setMatchSideRandomNotice] = useState<MatchSideRandomNotice | null>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [selectedTournamentEntrantId, setSelectedTournamentEntrantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const {
    startggFetchPerPage,
    setStartggFetchPerPage,
    displayBracketPlayersBySide,
    setDisplayBracketPlayersBySide,
    bracketZoomLevel,
    setBracketZoomLevel,
    mobileInputPollingMs,
    setMobileInputPollingMs,
    disableLocalCommunication,
    setDisableLocalCommunication,
  } = useAppPreferences();
  const {
    senderProfile,
    senderProfileReady,
    senderNameDraft,
    setSenderNameDraft,
    senderUserIdDraft,
    setSenderUserIdDraft,
    normalizedSenderNameDraft,
    normalizedSenderUserIdDraft,
    normalizedBindIpDraft: normalizedSenderBindIpDraft,
    normalizedSubnetMaskDraft: normalizedBroadcastSubnetMaskDraft,
    networkCandidates: senderNetworkCandidates,
    selectedNetworkCandidateKey: selectedSenderNetworkCandidateKey,
    setSelectedNetworkCandidateKey: setSelectedSenderNetworkCandidateKey,
    networkCandidatesLoading: senderNetworkCandidatesLoading,
    selectedNetworkCandidate: selectedSenderNetworkCandidate,
    refreshNetworkCandidates: refreshLocalNetworkSettingsCandidates,
    shouldRecommendMailboxClearForIdentityChange,
    setIdentityChangedSinceMailboxClear: setSenderIdentityChangedSinceMailboxClear,
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
    startTestOverlay,
    stopTestOverlay,
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

      const refreshedSet = result.snapshot.events
        .find((event) => event.eventId === selectedEventId)
        ?.sets.find((set) => set.setId === activeMatchSetId);
      if (!refreshedSet) {
        return;
      }

      const refreshedPending = result.localMeta.pendingSetResults.find(
        (item) => item.eventId === selectedEventId && item.setId === activeMatchSetId,
      );
      setScoreDrafts(
        refreshedPending
          ? buildScoreDraftsFromResult(refreshedSet, refreshedPending)
          : buildScoreDraftsFromSet(refreshedSet),
      );
      setDirectWinnerId(refreshedPending?.directWin ? refreshedPending.winnerId : null);
      const refreshedSideDrafts = buildMatchSideDrafts(refreshedSet, getSetSlotSide);
      setActiveMatchSideDrafts(refreshedSideDrafts);
    },
  });
  const {
    saveLocalResult: persistLocalSetResult,
    discardAllLocalDrafts,
    discardLocalDraftForSet,
    resetLocalSetResultCascade,
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
  const startupSavedSlugRef = useRef("");
  const startupSavedEventIdRef = useRef("");
  const startupRestoreReadyRef = useRef(false);
  const localSnapshotEventsLoadedOnceRef = useRef(false);
  const startupAutoRestoreDoneRef = useRef(false);
  const startupDirectRestoreTriedRef = useRef(false);
  const startupListRestoreRetryCountRef = useRef(0);
  const tabSelectionAutoLoadInFlightRef = useRef(false);
  const {
    cameraActive: dqCameraActive,
    videoRef: dqCameraVideoRef,
    canvasRef: dqCameraCanvasRef,
    startDqCameraScan,
    stopDqCameraScan,
  } = useDqCameraScan();
  const tournamentCreation = useTournamentCreation({
    slug,
    perPage: normalizeStartggFetchPerPage(startggFetchPerPage),
    setCreateBusy,
    setBusy,
    setError,
    setMessage,
    onSnapshotCreated: async () => {
      setWorkspace(null);
      startupAutoRestoreDoneRef.current = true;
      await refreshLocalSnapshotEvents();
      setActiveTab("home");
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
    createEventSlugInput,
    setCreateEventSlugInput,
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
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const version = await getVersion();
        if (alive) {
          setAppVersion(version);
        }
      } catch {
        // ignore (e.g. non-Tauri environment)
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const savedSelection = await loadLastSnapshotSelection();
        if (
          alive
          && savedSelection
          && savedSelection.slug.trim() !== ""
          && savedSelection.eventId.trim() !== ""
        ) {
          const savedSlug = savedSelection.slug.trim();
          const savedEventId = savedSelection.eventId.trim();
          const savedPhaseName = typeof savedSelection.phaseName === "string"
            ? savedSelection.phaseName.trim()
            : "";
          const savedPhaseGroupName = typeof savedSelection.phaseGroupName === "string"
            ? savedSelection.phaseGroupName.trim()
            : "";
          startupSavedSlugRef.current = savedSlug;
          startupSavedEventIdRef.current = savedEventId;
          setSelectedEventId(savedEventId);
          if (savedPhaseName !== "") {
            setSelectedPhaseName(savedPhaseName);
          }
          if (savedPhaseName !== "" && savedPhaseGroupName !== "") {
            setSelectedPhasePoolKey(`${savedPhaseName}::${savedPhaseGroupName}`);
          }
          setSlug(toSlugInput(savedSlug));
        }

        const savedSlug = await loadLastSlug();
        if (
          alive
          && startupSavedSlugRef.current === ""
          && savedSlug
          && savedSlug.trim() !== ""
        ) {
          const savedRawSlug = savedSlug.trim();
          startupSavedSlugRef.current = savedRawSlug;
          setSlug(toSlugInput(savedRawSlug));
        }

      } catch (err) {
        if (alive) {
          setError(String(err));
        }
      } finally {
        if (alive) {
          startupRestoreReadyRef.current = true;
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "home") {
      return;
    }

    void refreshLocalSnapshotEvents();
  }, [activeTab]);

  useEffect(() => {
    if (startupAutoRestoreDoneRef.current) {
      return;
    }

    if (!startupRestoreReadyRef.current) {
      return;
    }

    if (!localSnapshotEventsLoadedOnceRef.current) {
      return;
    }

    if (workspace) {
      startupAutoRestoreDoneRef.current = true;
      return;
    }

    const savedSlug = startupSavedSlugRef.current.trim();
    const savedEventId = startupSavedEventIdRef.current;

    if (savedSlug !== "" && savedEventId !== "" && !startupDirectRestoreTriedRef.current) {
      startupDirectRestoreTriedRef.current = true;

      void (async () => {
        try {
          await loadWorkspace(savedSlug, savedEventId);

          setSlug(toSlugInput(savedSlug));
          setSelectedEventId(savedEventId);
          startupAutoRestoreDoneRef.current = true;
        } catch {
          // Direct restore can fail when old slug formats remain in persisted data.
          // Trigger list reload so this effect re-runs and falls back to list-based restore.
          if (!loadingLocalSnapshotEvents) {
            void refreshLocalSnapshotEvents();
          }
        }
      })();
      return;
    }

    if (loadingLocalSnapshotEvents) {
      return;
    }

    if (savedSlug === "") {
      startupAutoRestoreDoneRef.current = true;
      return;
    }

    if (localSnapshotEvents.length === 0) {
      if (startupListRestoreRetryCountRef.current < 1) {
        startupListRestoreRetryCountRef.current += 1;
        void refreshLocalSnapshotEvents();
        return;
      }

      startupAutoRestoreDoneRef.current = true;
      return;
    }

    let matched = null as LocalSnapshotEventListItem | null;
    if (savedEventId !== "") {
      matched = findSnapshotEventByIdentity(localSnapshotEvents, savedSlug, savedEventId);
    }

    if (!matched) {
      const normalizedSavedSlug = toSlugInput(savedSlug);
      matched = localSnapshotEvents.find((item) => toSlugInput(item.slug) === normalizedSavedSlug) ?? null;
    }

    startupAutoRestoreDoneRef.current = true;

    if (matched) {
      void selectLocalSnapshotEvent(matched);
    }
  }, [loadingLocalSnapshotEvents, localSnapshotEvents, workspace]);

  const snapshot = workspace?.snapshot ?? null;
  const localMeta = workspace?.localMeta ?? null;
  const setPlaySides = localMeta?.setPlaySides ?? [];
  const pendingSetResults = localMeta?.pendingSetResults ?? [];
  const pendingGrandFinalResetResults = localMeta?.pendingGrandFinalResetResults ?? [];
  const confirmedSetResults = pendingSetResults.filter((result) => isConfirmedSetResult(result));
  const draftSetResults = pendingSetResults.filter((result) => !isConfirmedSetResult(result));
  const confirmedGrandFinalResetResults = pendingGrandFinalResetResults.filter((result) => isConfirmedSetResult(result));
  const draftGrandFinalResetResults = pendingGrandFinalResetResults.filter((result) => !isConfirmedSetResult(result));
  const confirmedReportableCount = confirmedSetResults.length + confirmedGrandFinalResetResults.length;
  const draftPendingCount = draftSetResults.length + draftGrandFinalResetResults.length;

  const setPlaySideMap = useMemo(() => {
    const map = new Map<string, PlaySide>();
    for (const item of setPlaySides) {
      map.set(`${item.setId}:${item.entrantId}`, item.playSide);
    }
    return map;
  }, [setPlaySides]);

  const allSets = useMemo(() => {
    if (!snapshot) {
      return [] as Array<{ eventName: string; set: SetSnapshot }>;
    }

    return snapshot.events.flatMap((event) =>
      event.sets
        .filter((set) => isDisplayableSet(set, event))
        .map((set) => ({ eventName: event.name, set })),
    );
  }, [snapshot]);

  const selectedEvent = useMemo(() => {
    if (!snapshot || snapshot.events.length === 0 || selectedEventId === "") {
      return null;
    }

    return snapshot.events.find((event) => event.eventId === selectedEventId) ?? null;
  }, [snapshot, selectedEventId]);

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
    perPage: normalizeStartggFetchPerPage(startggFetchPerPage),
    reportableCount: confirmedReportableCount,
    setWorkspace,
    closeMatchDialog,
    setBusy,
    setError,
    setMessage,
    clearSnapshotProgress: () => setCreateSnapshotProgress(null),
  });

  const resolvedEventSetsById = useMemo(() => {
    if (!selectedEvent) {
      return new Map<string, SetSnapshot>();
    }

    const resolveSetEntrants = createSetEntrantResolver(
      selectedEvent.sets,
      selectedEvent.phaseGroups ?? [],
    );
    return new Map(selectedEvent.sets.map((set) => [set.setId, resolveSetEntrants(set)]));
  }, [selectedEvent]);

  const selectedEventMeta = useMemo(() => {
    if (!localMeta || !selectedEvent) {
      return null;
    }

    return localMeta.events.find((event) => event.eventId === selectedEvent.eventId) ?? null;
  }, [localMeta, selectedEvent]);

  useEffect(() => {
    setEventAliasDraft(selectedEventMeta?.eventAlias?.trim() ?? "");
  }, [selectedEventMeta]);

  const selectedMessageScope = useMemo<MessageScope | null>(() => {
    if (!snapshot || !selectedEvent) {
      return null;
    }

    const parsedPhasePool = parsePhasePoolKey(selectedPhasePoolKey);
    const selectedPhase = parsedPhasePool?.phaseName ?? selectedPhaseName.trim();
    const selectedPhaseGroup = parsedPhasePool?.phaseGroupName ?? "";

    return {
      tournamentId: snapshot.tournamentId,
      slug: snapshot.slug,
      eventId: selectedEvent.eventId,
      phaseName: selectedPhase,
      phaseGroupName: selectedPhaseGroup,
    };
  }, [selectedEvent, selectedPhaseName, selectedPhasePoolKey, snapshot]);

  const selectedMailboxScope = useMemo<MessageScope | null>(() => {
    if (!selectedMessageScope) {
      return null;
    }

    // メッセージボックスは同一イベント内を横断表示する。
    return {
      ...selectedMessageScope,
      phaseName: "",
      phaseGroupName: "",
    };
  }, [selectedMessageScope]);

  const {
    genericMessages,
    setGenericMessages,
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
    setMailboxFilterSetting,
    setMailboxReadMessageIds,
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
    resetDqRequestDialog,
    submitDqRequest,
    deleteActiveThread,
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
  });

  const {
    displayGroups: callListDisplayGroups,
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
    setPageRotateSeconds: setCallListPageRotateSeconds,
    colorSeconds: callListColorSeconds,
    setColorSeconds: setCallListColorSeconds,
    colorToRedSeconds: callListColorToRedSeconds,
    resetDisplay: resetCallListDisplay,
    advancePage: advanceCallListPage,
  } = useCallList({
    activeTab,
    genericMessages,
    senderUserId: senderProfile.senderUserId,
  });

  const selectedEventItemListSnapshots = useMemo(() => {
    if (!selectedEventMeta?.eventManagement?.itemListSnapshots) {
      return [] as ItemListConfig[];
    }

    return selectedEventMeta.eventManagement.itemListSnapshots
      .slice(0, MAX_CATEGORY_SLOTS)
      .map((item) => normalizeItemListConfig(item));
  }, [selectedEventMeta]);

  function resolveItemListForSelectedEvent(listId: string): ItemListConfig | null {
    return resolveEventItemList(listId, selectedEventItemListSnapshots, itemLists);
  }

  const { resetLastPersistedSnapshotSelection } = usePersistSnapshotSelection({
    snapshot,
    selectedEvent,
    selectedMessageScope,
    selectedPhaseName,
    selectedPhasePoolKey,
    setLocalSnapshotEvents,
    setError,
  });

  const selectedEventSettingKey = useMemo(() => {
    if (!snapshot || !selectedEvent) {
      return "";
    }
    return eventSettingKey(snapshot.slug, selectedEvent.eventId);
  }, [snapshot, selectedEvent]);

  const {
    eventMgmtSettings,
    appliedEventMgmtSettings,
    sideDecisionMethod,
    setSideDecisionMethod,
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
    selectedEventItemListSnapshots,
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
    perPage: normalizeStartggFetchPerPage(startggFetchPerPage),
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
    eventSettingKey,
    snapshot,
    saveEventAlias,
    refreshRemoteSnapshot,
    restoreWorkspaceGraph,
    refreshLocalSnapshotEvents,
    loadWorkspace,
    clearAllDrafts,
    closeMatchDialog,
  });

  const configuredCategorySlots = useMemo(() => {
    return buildConfiguredCategorySlots(
      appliedEventMgmtSettings[selectedEventSettingKey],
      resolveItemListForSelectedEvent,
    );
  }, [
    appliedEventMgmtSettings,
    itemLists,
    selectedEventSettingKey,
    selectedEventItemListSnapshots,
  ]);

  const selectedSummaryName = useMemo(() => {
    const startupSelectedSlug = startupSavedSlugRef.current.trim();
    const startupSelectedEventId = startupSavedEventIdRef.current.trim();
    const currentSelectedSlug = snapshot?.slug?.trim() || startupSelectedSlug;
    const currentSelectedEventId = selectedEventId.trim() || startupSelectedEventId;
    return resolveSelectedSnapshotName(localSnapshotEvents, {
      eventAlias: selectedEventMeta?.eventAlias,
      eventName: selectedEvent?.name,
      slug: currentSelectedSlug,
      eventId: currentSelectedEventId,
      fallbackName: snapshot?.name ?? "未選択",
    });
  }, [localSnapshotEvents, selectedEventMeta, selectedEvent, selectedEventId, snapshot]);

  const selectedSidebarItem = useMemo(() => {
    const startupSelectedSlug = startupSavedSlugRef.current.trim();
    const startupSelectedEventId = startupSavedEventIdRef.current.trim();
    const currentSelectedSlug = snapshot?.slug?.trim() || startupSelectedSlug;
    const currentSelectedEventId = selectedEvent?.eventId?.trim() || selectedEventId.trim() || startupSelectedEventId;

    if (currentSelectedSlug === "" || currentSelectedEventId === "") {
      return null;
    }

    return findSnapshotEventByIdentity(localSnapshotEvents, currentSelectedSlug, currentSelectedEventId);
  }, [localSnapshotEvents, selectedEvent, selectedEventId, snapshot]);

  const homeFilteredSnapshotEvents = useMemo(() => {
    return filterLocalSnapshotEvents(localSnapshotEvents, homeSnapshotSearchInput);
  }, [homeSnapshotSearchInput, localSnapshotEvents]);

  const homeSelectedSnapshotItem = useMemo(() => {
    return findSelectedLocalSnapshotEvent(homeFilteredSnapshotEvents, homeSelectedSnapshotKey);
  }, [homeFilteredSnapshotEvents, homeSelectedSnapshotKey]);

  useEffect(() => {
    if (localSnapshotEvents.length === 0) {
      if (homeSelectedSnapshotKey !== "") {
        setHomeSelectedSnapshotKey("");
      }
      return;
    }

    if (homeSelectedSnapshotKey !== "" && !findSelectedLocalSnapshotEvent(localSnapshotEvents, homeSelectedSnapshotKey)) {
      setHomeSelectedSnapshotKey("");
    }

  }, [homeSelectedSnapshotKey, localSnapshotEvents]);

  useEffect(() => {
    if (workspace || busy || loadingLocalSnapshotEvents || tabSelectionAutoLoadInFlightRef.current) {
      return;
    }

    const requiresSelectedEvent = activeTab === "tournament"
      || activeTab === "bracket"
      || activeTab === "message"
      || activeTab === "users";
    if (!requiresSelectedEvent) {
      return;
    }

    if (!selectedSidebarItem) {
      return;
    }

    tabSelectionAutoLoadInFlightRef.current = true;
    void (async () => {
      try {
        await selectLocalSnapshotEvent(selectedSidebarItem);
      } finally {
        tabSelectionAutoLoadInFlightRef.current = false;
      }
    })();
  }, [activeTab, busy, loadingLocalSnapshotEvents, selectedSidebarItem, workspace]);

  const selectedCategoryUsageList = useMemo(
    () => buildCategoryUsageList(configuredCategorySlots, selectedEventMeta?.entrants ?? []),
    [configuredCategorySlots, selectedEventMeta],
  );
  const selectedEventEntrants = useMemo(() => {
    if (!selectedEvent) {
      return [] as EventEntrantSnapshot[];
    }

    const entrants = collectEventEntrants(selectedEvent.sets);

    console.groupCollapsed(`[seed-debug] event=${selectedEvent.eventId} entrants=${entrants.length}`);
    console.table(
      entrants.map((item, index) => ({
        order: index + 1,
        entrantId: item.entrantId,
        entrantName: item.entrantName,
        seedId: item.seedId,
        seedNum: item.seedNum,
        firstSeenSetId: item.firstSeenSetId,
      })),
    );
    console.groupEnd();

    return sortEventEntrants(entrants);
  }, [selectedEvent]);
  const selectedTournamentEntrant = useMemo(() => {
    if (selectedTournamentEntrantId === "") {
      return selectedEventEntrants[0] ?? null;
    }

    return selectedEventEntrants.find((entrant) => entrant.entrantId === selectedTournamentEntrantId) ?? selectedEventEntrants[0] ?? null;
  }, [selectedEventEntrants, selectedTournamentEntrantId]);

  const {
    getMetaDraft,
    getDraftCategorySelections,
    addDraftCategorySelection,
    removeDraftCategorySelection,
    buildValidatedSelections,
    savePlayerMeta,
  } = usePlayerMetaDrafts({
    selectedEvent,
    selectedEventMeta,
    selectedEventEntrants,
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
    const isManualBracketRefresh = activeTab === "bracket" && busy && createSnapshotProgress !== null;
    return (isReportSnapshotRefresh || isManualBracketRefresh) && createSnapshotProgress !== null;
  }, [activeTab, bracketReport.progress, busy, createSnapshotProgress]);

  const hasSelectedSenderNetworkDevice = selectedSenderNetworkCandidate !== null;
  const senderIdCollision = useMemo(() => {
    if (!isValidSenderUserId(normalizedSenderUserIdDraft)) {
      return false;
    }

    return genericMessages.some((item) => item.senderUserId === normalizedSenderUserIdDraft && item.senderName !== normalizedSenderNameDraft);
  }, [genericMessages, normalizedSenderNameDraft, normalizedSenderUserIdDraft]);

  const isSenderProfileReadyForMessaging = senderProfile.senderName.trim() !== ""
    && isValidSenderUserId(senderProfile.senderUserId)
    && isValidIpv4(senderProfile.bindIp);

  const canBroadcastCallListSync = senderProfile.senderName.trim() !== ""
    && !disableLocalCommunication
    && isValidSenderUserId(senderProfile.senderUserId)
    && isValidIpv4(senderProfile.bindIp)
    && isValidIpv4(senderProfile.broadcastSubnetMask);

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

  function fillRandomSenderUserId() {
    const usedIds = new Set(genericMessages.map((item) => item.senderUserId));
    let nextId = generateRandomSenderUserId();

    for (let retry = 0; retry < 40 && usedIds.has(nextId); retry += 1) {
      nextId = generateRandomSenderUserId();
    }

    setSenderUserIdDraft(nextId);
  }

  useEffect(() => {
    if (dqDialog) {
      return;
    }

    stopDqCameraScan();
  }, [dqDialog]);

  function resolveActiveThread() {
    void resolveMailboxThread();
  }

  function forceClearMailboxMessages() {
    if (genericMessages.length === 0) {
      setError("");
      setMessage("削除対象のメッセージはありません。");
      return;
    }

    const firstConfirmed = window.confirm(
      `危険: メッセージボックス内の全メッセージ ${genericMessages.length} 件を強制削除します。\nこの操作は元に戻せません。続行しますか？`,
    );
    if (!firstConfirmed) {
      return;
    }

    const guardWord = window.prompt("最終確認: 強制削除を実行するには DELETE と入力してください。", "");
    if ((guardWord ?? "").trim() !== "DELETE") {
      setError("確認文字列が一致しなかったため、メッセージボックスの強制クリアを中止しました。");
      return;
    }

    setError("");
    setMessage("");
    setGenericMessages([]);
    setMailboxReadMessageIds([]);
    setSelectedThreadId("");
    setReplyBodyDraft("");
    resetDqRequestDialog();
    resetCallListDisplay({ clearOwnOnly: true });
    setSenderIdentityChangedSinceMailboxClear(false);

    setMessage(`メッセージボックスを強制クリアしました（${genericMessages.length} 件削除）。`);
  }

  useEffect(() => {
    if (selectedEventEntrants.length === 0) {
      if (selectedTournamentEntrantId !== "") {
        setSelectedTournamentEntrantId("");
      }
      return;
    }

    if (selectedTournamentEntrantId !== "" && selectedEventEntrants.some((entrant) => entrant.entrantId === selectedTournamentEntrantId)) {
      return;
    }

    setSelectedTournamentEntrantId(selectedEventEntrants[0].entrantId);
  }, [selectedEventEntrants, selectedTournamentEntrantId]);

  useEffect(() => {
    if (!matchSideRandomNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setMatchSideRandomNotice((current) => {
        if (!current || current.triggeredAt !== matchSideRandomNotice.triggeredAt) {
          return current;
        }
        return null;
      });
    }, 6000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [matchSideRandomNotice]);

  const { applySideDecisionMethodToAllUnconfirmedSets } = useSetSideAssignment({
    selectedEvent,
    resolvedEventSetsById,
    setPlaySideMap,
    selectedEventSettingKey,
    sideDecisionMethod,
    eventMgmtSettings,
    saveSetPlaySide,
    setBusy,
    setError,
    setMessage,
  });

  function deleteItemList(itemListId: string) {
    removeItemList(itemListId);
    removeItemListSettings(itemListId);
    setMessage("アイテムリストを削除しました。");
  }

  function formatScoreValue(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  async function toggleActiveMatchOverlay(set: SetSnapshot) {
    if (!isDisplayableSet(set, selectedEvent)) {
      return;
    }
    const isSameActive = obsOverlayState?.active && obsOverlayState.currentSetId === set.setId;
    const displayCode = setDisplayCodeById.get(set.setId);
    const overlaySides = resolveOverlaySidesForSet(set, {
      getSavedSide: getSetSlotSide,
    });

    await toggleObsOverlaySet({
      enabled: !isSameActive,
      setId: set.setId,
      eventName: selectedEvent?.name ?? "",
      eventAlias: selectedEventMeta?.eventAlias?.trim() ?? "",
      roundText: buildOverlaySetRoundText(set, displayCode),
      redPlayerName: overlaySides.redPlayerName,
      bluePlayerName: overlaySides.bluePlayerName,
      redSetWins: overlaySides.redSetWins,
      blueSetWins: overlaySides.blueSetWins,
      fontScale: obsOverlayState?.fontScale ?? 1,
    });
  }

  async function forceSwitchActiveMatchOverlay(set: SetSnapshot) {
    const currentSetId = obsOverlayState?.active ? obsOverlayState.currentSetId : null;
    if (
      currentSetId
      && currentSetId !== "__test__"
      && currentSetId !== set.setId
    ) {
      await toggleObsOverlaySet({
        enabled: false,
        setId: currentSetId,
        eventName: "",
        eventAlias: "",
        roundText: "",
        redPlayerName: "",
        bluePlayerName: "",
        redSetWins: 0,
        blueSetWins: 0,
        fontScale: obsOverlayState?.fontScale ?? 1,
      });
    }

    await toggleActiveMatchOverlay(set);
  }

  async function syncObsOverlayScoresForSet(
    set: SetSnapshot,
    slotScores: Array<{ entrantId: string; score: number }>,
    sideOverrides?: Record<string, PlaySide | "">,
  ) {
    if (set.setId === "__test__") {
      return;
    }
    if (!isDisplayableSet(set, selectedEvent)) {
      return;
    }

    let currentOverlayState = obsOverlayState;
    if (!currentOverlayState?.active || currentOverlayState.currentSetId !== set.setId) {
      try {
        const latest = await refreshObsOverlayState();
        currentOverlayState = latest;
      } catch {
        return;
      }
    }

    if (!currentOverlayState?.active || currentOverlayState.currentSetId !== set.setId || currentOverlayState.currentSetId === "__test__") {
      return;
    }

    const scoreByEntrantId = new Map<string, number>();
    for (const item of slotScores) {
      scoreByEntrantId.set(item.entrantId, item.score);
    }

    const displayCode = setDisplayCodeById.get(set.setId);
    const overlaySides = resolveOverlaySidesForSet(set, {
      scoreByEntrantId,
      sideOverrides,
      getSavedSide: getSetSlotSide,
    });

    await toggleObsOverlaySet({
      enabled: true,
      setId: set.setId,
      eventName: selectedEvent?.name ?? "",
      eventAlias: selectedEventMeta?.eventAlias?.trim() ?? "",
      roundText: buildOverlaySetRoundText(set, displayCode),
      redPlayerName: overlaySides.redPlayerName,
      bluePlayerName: overlaySides.bluePlayerName,
      redSetWins: overlaySides.redSetWins,
      blueSetWins: overlaySides.blueSetWins,
      fontScale: currentOverlayState.fontScale,
    });
  }

  const phasePoolGroups = useMemo(() => buildPhasePoolGroups(selectedEvent), [selectedEvent]);

  const phaseNames = useMemo(
    () => buildPhaseNames(phasePoolGroups, selectedEvent?.phases),
    [phasePoolGroups, selectedEvent?.phases],
  );

  const phaseScopedPoolGroups = useMemo(
    () => selectPhaseScopedPoolGroups(phasePoolGroups, selectedPhaseName),
    [phasePoolGroups, selectedPhaseName],
  );

  const selectedPhasePoolGroup = useMemo(
    () => resolveSelectedPhasePoolGroup(phaseScopedPoolGroups, selectedPhasePoolKey),
    [phaseScopedPoolGroups, selectedPhasePoolKey],
  );

  const activeMatch = useMemo(() => {
    if (!selectedPhasePoolGroup || activeMatchSetId.trim() === "") {
      return null;
    }

    const set = selectedPhasePoolGroup.sets.find((candidate) => candidate.setId === activeMatchSetId);
    return set
      ? resolvedEventSetsById.get(set.setId) ?? set
      : null;
  }, [resolvedEventSetsById, selectedEvent, selectedPhasePoolGroup, activeMatchSetId]);

  const { sendCallMessageFromMatch } = useCallMessageDraft({
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
    setComposeFixedBodyDraft,
    setGenericMessageBodyDraft,
    closeMatchDialog,
    setActiveTab,
    onError: setError,
    onMessage: setMessage,
  });

  const activeObsOverlaySet = useMemo(() => {
    if (!obsOverlayState?.active || !obsOverlayState.currentSetId) {
      return null;
    }
    return allSets.find((entry) => entry.set.setId === obsOverlayState.currentSetId) ?? null;
  }, [allSets, obsOverlayState]);

  const isActiveMatchDqDraft = useMemo(() => {
    if (!activeMatch) {
      return false;
    }

    return hasDqScoreInDrafts(activeMatch, scoreDrafts);
  }, [activeMatch, scoreDrafts]);

  const selectedBracketSections = useMemo(
    () => buildBracketSections(selectedPhasePoolGroup),
    [selectedPhasePoolGroup],
  );

  const selectedBracketSectionsForView = useMemo(() => buildBracketSectionsForView({
    sections: selectedBracketSections,
    phaseGroupSets: selectedPhasePoolGroup?.sets ?? [],
    event: selectedEvent,
    pendingResetSetIds: new Set(
      pendingGrandFinalResetResults.map((result) => result.sourceGrandFinalSetId),
    ),
  }), [pendingGrandFinalResetResults, selectedEvent, selectedPhasePoolGroup, selectedBracketSections]);

  const bracketScaleStyle = useMemo(() => ({
    ["--bracket-scale" as string]: String(bracketZoomLevel),
  } satisfies CSSProperties), [bracketZoomLevel]);

  const bracketVerticalLayoutScale = useMemo(
    () => getBracketVerticalLayoutScale(bracketZoomLevel),
    [bracketZoomLevel],
  );

  const renderedBracketSectionsForView = useMemo(() => {
    return scaleBracketSectionsForZoom(selectedBracketSectionsForView, bracketVerticalLayoutScale);
  }, [bracketVerticalLayoutScale, selectedBracketSectionsForView]);

  const setDisplayCodeById = useMemo(
    () => buildSetDisplayCodeById(selectedBracketSectionsForView),
    [selectedBracketSectionsForView],
  );

  const tbdSourceLabelBySlotKey = useMemo(
    () => buildBracketTbdSourceLabelBySlotKey(selectedBracketSections, setDisplayCodeById),
    [selectedBracketSections, setDisplayCodeById],
  );

  function resolveTbdSourceLabel(set: SetSnapshot, slotIndex: number, slot: SetSlot): string | null {
    return resolveBracketTbdSourceLabel(
      set,
      slotIndex,
      slot,
      selectedEvent,
      setDisplayCodeById,
      tbdSourceLabelBySlotKey,
    );
  }

  const pendingResultBySetId = useMemo(
    () => buildPendingSetResultsById(pendingSetResults, pendingGrandFinalResetResults),
    [pendingGrandFinalResetResults, pendingSetResults],
  );

  const roundRobinBoardData = useMemo(
    () => buildRoundRobinBoardData({
      event: selectedEvent,
      phasePoolGroup: selectedPhasePoolGroup,
      pendingResultBySetId,
      interimScoreDraftsBySetId,
    }),
    [interimScoreDraftsBySetId, pendingResultBySetId, selectedEvent, selectedPhasePoolGroup],
  );

  const roundRobinMatrixRows = useMemo<RoundRobinMatrixRowView[]>(
    () => buildRoundRobinMatrixRows({
      boardData: roundRobinBoardData,
      pendingResultBySetId,
      interimScoreDraftsBySetId,
      obsOverlayState,
      setDisplayCodeById,
    }),
    [interimScoreDraftsBySetId, obsOverlayState, pendingResultBySetId, roundRobinBoardData, setDisplayCodeById],
  );

  const eliminationBracketSections = buildEliminationBracketSections({
    sections: renderedBracketSectionsForView,
    resolvedEventSetsById,
    pendingResultBySetId,
    interimScoreDraftsBySetId,
    activeOverlay: obsOverlayState,
    setDisplayCodeById,
    getTbdSourceLabel: resolveTbdSourceLabel,
    getSideLabel: getSetSlotSideLabel,
    getScoresForSet: getSetScoresForDisplay,
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

  useEffect(() => {
    if (!snapshot || snapshot.events.length === 0) {
      return;
    }

    if (selectedEventId === "") {
      return;
    }

    const exists = snapshot.events.some((event) => event.eventId === selectedEventId);
    if (!exists) {
      setSelectedEventId("");
    }
  }, [snapshot, selectedEventId]);

  async function refreshLocalSnapshotEvents() {
    try {
      const items = await fetchLocalSnapshotEvents();

      const savedSlug = startupSavedSlugRef.current.trim();
      const savedEventId = startupSavedEventIdRef.current.trim();
      const savedSelectionStillExists = savedSlug === "" || savedEventId === ""
        || items.some((item) => sameSnapshotEventKey(savedSlug, savedEventId, item.slug, item.eventId));
      if (!savedSelectionStillExists) {
        setWorkspace(null);
        setSelectedEventId("");
        setSelectedPhaseName("");
        setSelectedPhasePoolKey("");
        startupSavedSlugRef.current = "";
        startupSavedEventIdRef.current = "";
        resetLastPersistedSnapshotSelection();
        await saveLastSnapshotSelection({
          slug: "",
          eventId: "",
          phaseName: null,
          phaseGroupName: null,
        });
      }

      if (items.length === 0) {
        setWorkspace(null);
        setSelectedEventId("");
        setSelectedPhaseName("");
        setSelectedPhasePoolKey("");
        setHomeSelectedSnapshotKey("");
        startupSavedSlugRef.current = "";
        startupSavedEventIdRef.current = "";
        resetLastPersistedSnapshotSelection();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      localSnapshotEventsLoadedOnceRef.current = true;
    }
  }

  function getSetSlotSide(setId: string, entrantId: string | null): PlaySide | "" {
    if (!entrantId) {
      return "";
    }

    return setPlaySideMap.get(`${setId}:${entrantId}`) ?? "";
  }

  function getSetSlotSideLabel(
    setId: string,
    entrantId: string | null,
    options?: { fallbackBySlotIndex?: number; finishedSet?: boolean; matchupReady?: boolean },
  ): string {
    return resolveSetSlotSideLabel(entrantId, getSetSlotSide(setId, entrantId), options);
  }

  function getSetScoresForDisplay(set: SetSnapshot): { scores: Record<string, string>; isDq: boolean; winnerId: string | null } {
    return buildSetScoresForDisplay(
      set,
      pendingResultBySetId.get(set.setId),
      interimScoreDraftsBySetId[set.setId],
    );
  }

  function openMatchDialog(set: SetSnapshot, forcedDraftState?: SetResultDraftState) {
    if (!isDisplayableSet(set, selectedEvent)) {
      return;
    }
    if (isInactiveGrandFinalReset(set, selectedEvent)) {
      return;
    }
    const inputSet = resolvedEventSetsById.get(set.setId) ?? set;
    setActiveMatchSetId(set.setId);

    const sideDrafts = buildMatchSideDrafts(inputSet, getSetSlotSide);
    setActiveMatchSideDrafts(sideDrafts);

    const pending = pendingResultBySetId.get(set.setId);
    const existingDraft = resolveExistingMatchDialogDraft(
      forcedDraftState,
      pending ? buildDraftStateFromPending(inputSet, pending) : undefined,
      setResultDrafts[set.setId],
    );
    if (existingDraft) {
      const { draftState } = existingDraft;
      setDirectWinnerId(draftState.directWin ? draftState.winnerId : null);
      setScoreDrafts(draftState.scoreDrafts);
      if (existingDraft.shouldPersist) {
        saveSetDraft(set.setId, draftState);
      }
      return;
    }

    const snapshotDisplay = getSetScoresForDisplay(set);
    const initialDraft = buildInitialMatchDialogDraft(
      snapshotDisplay.scores,
      buildScoreDraftsFromSet(inputSet),
    );
    setDirectWinnerId(null);
    setScoreDrafts(initialDraft.scoreDrafts);
    saveSetDraft(set.setId, initialDraft);
  }

  function requestResultConfirmation(match: SetSnapshot) {
    if (!isMatchupReady(match)) {
      return;
    }

    setResultConfirmation({
      match,
      scoreDrafts: { ...scoreDrafts },
      directWinnerId,
    });
  }

  function closeMatchDialog() {
    setActiveMatchSetId("");
    setActiveMatchSideDrafts({});
    setMatchSideRandomNotice(null);
    setDirectWinnerId(null);
  }

  async function saveLocalResultForMatch(confirmed: boolean) {
    if (!selectedEvent) {
      setError("イベントが選択されていません。");
      return;
    }

    if (!activeMatch) {
      setError("試合が選択されていません。");
      return;
    }

    if (isCompletedSet(activeMatch)) {
      setError("確定済みsetの結果は変更できません。修正する場合は「影響setを取消」からやり直してください。");
      return;
    }
    if (isInactiveGrandFinalReset(activeMatch, selectedEvent)) {
      setError("Winners側のプレイヤーがGrand Finalに勝利したため、Grand Final Resetは行われません。");
      return;
    }

    await persistLocalSetResult({
      slug: toApiSlug(slug),
      event: selectedEvent,
      setId: activeMatch.setId,
      set: activeMatch,
      confirmed,
      directWinnerId,
      scoreDrafts,
      sideDrafts: activeMatchSideDrafts,
    });
  }

  async function discardLocalResultDraftsForBracket() {
    if (!selectedEvent) {
      return;
    }

    await discardAllLocalDrafts({
      slug: toApiSlug(slug),
      eventId: selectedEvent.eventId,
    });
  }

  async function discardLocalResultDraftForMatch() {
    if (!selectedEvent) {
      setError("先にイベントを選択してください。");
      return;
    }

    if (!activeMatch) {
      setError("試合が選択されていません。");
      return;
    }

    const targetSetId = activeMatch.setId;
    await discardLocalDraftForSet({
      slug: toApiSlug(slug),
      eventId: selectedEvent.eventId,
      setId: targetSetId,
    });
  }

  async function resetSetResultCascadeForMatch() {
    if (!selectedEvent) {
      setError("先にイベントを選択してください。");
      return;
    }

    if (!activeMatch) {
      setError("試合が選択されていません。");
      return;
    }

    const confirmed = window.confirm("このsetと影響するsetの結果をローカルで取り消します。実行しますか？");
    if (!confirmed) {
      return;
    }

    await resetLocalSetResultCascade({
      slug: toApiSlug(slug),
      eventId: selectedEvent.eventId,
      setId: activeMatch.setId,
      perPage: normalizeStartggFetchPerPage(startggFetchPerPage),
    });
  }

  async function saveSetPlaySide(
    eventSnapshot: EventSnapshot,
    setSnapshot: SetSnapshot,
    entrantId: string,
    playSide: PlaySide | "",
    options?: { silent?: boolean; manageBusy?: boolean },
  ) {
    const silent = options?.silent ?? true;
    const manageBusy = options?.manageBusy ?? true;

    if (manageBusy) {
      setBusy(true);
    }
    setError("");
    if (!silent) {
      setMessage("");
    }

    try {
      const normalizedSlug = toApiSlug(slug);
      await saveLocalSetPlaySide({
        slug: normalizedSlug,
        eventId: eventSnapshot.eventId,
        setId: setSnapshot.setId,
        entrantId,
        opponentEntrantId: setSnapshot.slots
          .map((slot) => slot.entrantId)
          .find((candidate) => candidate && candidate !== entrantId) ?? null,
        playSide: playSide === "" ? null : playSide,
      });

      if (!silent) {
        setMessage("setサイドを保存しました。");
      }
    } catch (err) {
      const errorMessage = String(err);
      const isTransientSideAssignmentError = errorMessage.includes("対戦カードが確定していないsetはサイド設定できません");
      if (!silent || !isTransientSideAssignmentError) {
        setError(errorMessage);
        throw err;
      }
    } finally {
      if (manageBusy) {
        setBusy(false);
      }
    }
  }

  const { swapMatchSides, randomizeMatchSides } = useMatchSideDraftActions({
    activeMatchSideDrafts,
    setActiveMatchSideDrafts,
    getSetSlotSide,
    setMatchSideRandomNotice,
  });

  async function saveMatchSidesIfNeeded(
    eventSnapshot: EventSnapshot,
    set: SetSnapshot,
    sideDrafts: Record<string, PlaySide | "">,
  ) {
    const savePlan = resolveMatchSideDraftSavePlan(
      set,
      sideDrafts,
      getSetSlotSide,
      (setId, entrantId, slotIndex) => getSetSlotSideLabel(setId, entrantId, {
        fallbackBySlotIndex: slotIndex,
        matchupReady: true,
      }),
    );
    if (!savePlan) {
      return;
    }

    if (savePlan.sidesChanged) {
      await saveSetPlaySide(eventSnapshot, set, savePlan.upperEntrantId, savePlan.sideOverrides[savePlan.upperEntrantId], {
        silent: true,
        manageBusy: false,
      });

      const currentScores = set.slots
        .filter((slot): slot is SetSlot & { entrantId: string } => slot.entrantId !== null)
        .map((slot) => ({ entrantId: slot.entrantId, score: slot.score ?? 0 }));
      await syncObsOverlayScoresForSet(set, currentScores, savePlan.sideOverrides);
    }

    return savePlan.sideOverrides;
  }

  function addSelectedEntrantDraftSelection(slot: EventSettingCategorySlot, itemName: string) {
    if (!selectedEvent || !selectedTournamentEntrant) {
      return;
    }
    addDraftCategorySelection(
      selectedEvent.eventId,
      selectedTournamentEntrant.entrantId,
      slot.slotIndex,
      slot.list,
      slot.allowDuplicates,
      slot.maxCount,
      itemName,
    );
  }

  function removeSelectedEntrantDraftSelection(slotIndex: number, selectionIndex: number) {
    if (!selectedEvent || !selectedTournamentEntrant) {
      return;
    }
    removeDraftCategorySelection(
      selectedEvent.eventId,
      selectedTournamentEntrant.entrantId,
      slotIndex,
      selectionIndex,
    );
  }

  function saveSelectedEntrantMeta() {
    if (selectedEvent && selectedTournamentEntrant) {
      void savePlayerMeta(selectedEvent, selectedTournamentEntrant.entrantId, selectedTournamentEntrant.entrantName);
    }
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
    >

        {activeTab === "home" && (
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
        )}

        {activeTab === "create" && (
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
            createEventSlugInput={createEventSlugInput}
            onEventSlugInputChange={setCreateEventSlugInput}
            canCreateSnapshot={token.trim() !== "" && toApiSlug(slug) !== "" && toEventApiSlug(slug, createEventSlugInput) !== ""}
            onCreateSnapshot={() => void createEventSnapshotBySlug()}
            createSnapshotProgress={createSnapshotProgress}
            createSnapshotProgressPercent={createSnapshotProgressPercent}
            createSnapshotProgressLabel={createSnapshotProgressLabel}
          />
        )}

        {activeTab === "tournament" && (
          <EventSetting
            event={{
              hasSelectedEvent: Boolean(selectedEvent),
              eventAlias: selectedEventMeta?.eventAlias ?? "",
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
              draftSelectionsBySlot: selectedEvent && selectedTournamentEntrant
                ? configuredCategorySlots.map((slot) => getDraftCategorySelections(
                  getMetaDraft(selectedEvent.eventId, selectedTournamentEntrant.entrantId),
                  slot.slotIndex,
                ))
                : [],
              validationErrors: selectedEvent && selectedTournamentEntrant
                ? buildValidatedSelections(
                  getMetaDraft(selectedEvent.eventId, selectedTournamentEntrant.entrantId),
                  configuredCategorySlots,
                ).errors
                : [],
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
            senderLabel={`${senderProfile.senderName.trim() === "" ? "未設定" : senderProfile.senderName} / ${isValidSenderUserId(senderProfile.senderUserId) ? senderProfile.senderUserId : "未設定"} / IP: ${isValidIpv4(senderProfile.bindIp) ? senderProfile.bindIp : "未設定"}`}
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
            onCancelFixedMessage={() => {
              setComposeFixedBodyDraft(null);
              setComposeMessageMeta(null);
              setMailboxMethodDraft("generic");
              setMailboxSubjectDraft("");
              setMessageDeliveryMode("broadcast");
              setMessageDeliveryIpDraft("");
              setGenericMessageBodyDraft("");
              setMessage("呼び出しメッセージをキャンセルしました。汎用メッセージ入力に戻りました。");
            }}
            canSendGenericMessage={canSendGenericMessage}
            onPostGenericMessage={() => void postGenericMessage()}
            mailboxFilterSetting={mailboxFilterSetting}
            onMailboxFilterChange={(key, checked) => {
              setSelectedThreadId("");
              setMailboxFilterSetting((current) => ({ ...current, [key]: checked }));
            }}
            mailboxThreads={mailboxThreads}
            mailboxThreadSummaries={mailboxThreadSummaries}
            activeThread={activeThread}
            activeThreadMessages={activeThreadMessages}
            activeThreadResolved={activeThreadResolved}
            onSelectThread={setSelectedThreadId}
            onProcessDqRequest={processDqRequestFromMessage}
            isDqRequestMessage={isDqRequestMessage}
            canResolveActiveThread={canResolveActiveThread}
            onResolveActiveThread={() => void resolveActiveThread()}
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
          onToggleTestOverlay={() => {
            if (isTestOverlayActive) {
              void stopTestOverlay();
            } else {
              void startTestOverlay();
            }
          }}
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
            onSenderUserIdChange={(value) => setSenderUserIdDraft(value.replace(/\D/g, "").slice(0, 8))}
            networkCandidates={senderNetworkCandidates.map((candidate) => ({
              key: localNetworkCandidateKey(candidate),
              label: `${candidate.interfaceName} / ${candidate.source} / ${candidate.bindIp} / ${candidate.broadcastSubnetMask}`,
            }))}
            selectedNetworkCandidateKey={selectedSenderNetworkCandidateKey}
            onNetworkCandidateChange={setSelectedSenderNetworkCandidateKey}
            networkCandidatesLoading={senderNetworkCandidatesLoading}
            normalizedBindIp={normalizedSenderBindIpDraft}
            normalizedSubnetMask={normalizedBroadcastSubnetMaskDraft}
            senderSettingsStatus={senderIdCollision
              ? "既存履歴で同一IDが別名義に使われています。"
              : shouldRecommendMailboxClearForIdentityChange
                ? "履歴メッセージあり: 送信者名/ID変更前にメッセージボックス強制クリアを推奨します。"
                : !hasSelectedSenderNetworkDevice
                  ? "ネットワークデバイスを選択してください。"
                  : !isValidIpv4(normalizedSenderBindIpDraft)
                    ? "選択デバイスのIPが不正です。"
                    : !isValidIpv4(normalizedBroadcastSubnetMaskDraft)
                      ? "選択デバイスのサブネットマスクが不正です。"
                      : "デバイス選択後、IP/サブネットは自動適用されます。"}
            onRefreshNetworkCandidates={() => void refreshLocalNetworkSettingsCandidates(true)}
            onRandomizeSenderUserId={fillRandomSenderUserId}
            onSaveSenderProfile={() => void saveSenderProfile(senderIdCollision)}
            canSaveSenderProfile={canSaveSenderProfile(senderIdCollision)}
            startggFetchPerPage={normalizeStartggFetchPerPage(startggFetchPerPage)}
            onStartggFetchPerPageChange={(value) => {
              const next = normalizeStartggFetchPerPage(value, startggFetchPerPage);
              setStartggFetchPerPage(next);
            }}
            onStartggFetchPerPageBlur={(value) => {
              const normalized = normalizeStartggFetchPerPage(value);
              if (normalized !== startggFetchPerPage) {
                setStartggFetchPerPage(normalized);
              }
            }}
            mobileInputPollingMs={normalizeMobileInputPollingMs(mobileInputPollingMs)}
            mobileInputPollingMsMin={MOBILE_INPUT_POLLING_MS_MIN}
            mobileInputPollingMsMax={MOBILE_INPUT_POLLING_MS_MAX}
            onMobileInputPollingMsChange={(value) => {
              const next = normalizeMobileInputPollingMs(value, mobileInputPollingMs);
              setMobileInputPollingMs(next);
            }}
            onMobileInputPollingMsBlur={(value) => {
              const normalized = normalizeMobileInputPollingMs(value);
              if (normalized !== mobileInputPollingMs) {
                setMobileInputPollingMs(normalized);
              }
            }}
            callListPageRotateSeconds={callListPageRotateSeconds}
            callListRotateSecondsMin={CALL_LIST_ROTATE_SECONDS_MIN}
            callListRotateSecondsMax={CALL_LIST_ROTATE_SECONDS_MAX}
            onCallListPageRotateSecondsChange={(value) => {
              const next = normalizeCallListRotateSeconds(value, callListPageRotateSeconds);
              setCallListPageRotateSeconds(next);
            }}
            onCallListPageRotateSecondsBlur={(value) => {
              const normalized = normalizeCallListRotateSeconds(value);
              if (normalized !== callListPageRotateSeconds) {
                setCallListPageRotateSeconds(normalized);
              }
            }}
            callListColorSeconds={callListColorSeconds}
            callListColorSecondsMin={CALL_LIST_COLOR_SECONDS_MIN}
            callListColorSecondsMax={CALL_LIST_COLOR_SECONDS_MAX}
            onCallListColorSecondsChange={(value) => {
              const next = normalizeCallListColorSeconds(value, callListColorSeconds);
              setCallListColorSeconds(next);
            }}
            onCallListColorSecondsBlur={(value) => {
              const normalized = normalizeCallListColorSeconds(value);
              if (normalized !== callListColorSeconds) {
                setCallListColorSeconds(normalized);
              }
            }}
            callListRotateSecondsDisplay={normalizeCallListRotateSeconds(callListPageRotateSeconds)}
            callListColorToRedSeconds={callListColorToRedSeconds}
            hasCallListMessages={callListDisplayGroups.length > 0 || genericMessages.some((item) => item.parentMessageId === null && item.method === "call_player")}
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
            reportProgressActive={Boolean(busy || bracketReport.progress)}
            reportProgressHasProgress={Boolean(bracketReport.progress)}
            reportProgressPercent={bracketReport.progressPercent}
            reportProgressLabel={bracketReport.progressLabel}
            showSnapshotRefreshProgress={shouldShowBracketSnapshotRefreshProgress}
            snapshotProgressPercent={createSnapshotProgressPercent}
            snapshotProgressLabel={createSnapshotProgressLabel}
            snapshotProgressHasTotal={createSnapshotProgress?.totalSets !== null}
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
            onRoundRobinMatchClick={(set, event) => {
              if (event.altKey) {
                event.preventDefault();
                if (!busy && !obsOverlayBusy) void setObsOverlayFullyStopped(true);
                return;
              }
              if (event.ctrlKey) {
                event.preventDefault();
                if (!busy && !obsOverlayBusy) void toggleActiveMatchOverlay(set);
                return;
              }
              openMatchDialog(set);
            }}
            onEliminationSetActivate={(set, event) => {
              if (event.altKey && event.button === 0) {
                event.preventDefault();
                if (busy || obsOverlayBusy) {
                  return;
                }
                void setObsOverlayFullyStopped(true);
                return;
              }
              if (event.ctrlKey) {
                event.preventDefault();
                if (busy || obsOverlayBusy) {
                  return;
                }
                void toggleActiveMatchOverlay(set);
                return;
              }
              openMatchDialog(set);
            }}
            onOpenSet={openMatchDialog}
          />

          {activeMatch && selectedEvent && (
            <MatchDetailDialog
              match={activeMatch}
              setCode={setDisplayCodeById.get(activeMatch.setId)}
              isLive={Boolean(
                obsOverlayState?.active
                && obsOverlayState.currentSetId === activeMatch.setId
                && obsOverlayState.currentSetId !== "__test__",
              )}
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
              players={getDisplaySlotsForSet(activeMatch, {
                displayBySide: displayBracketPlayersBySide,
                matchupReady: isMatchupReady(activeMatch),
                sideDrafts: activeMatchSideDrafts,
                getSideLabel: getSetSlotSideLabel,
              }).map(({ slot, slotIndex }) => {
                const entrantId = slot.entrantId;
                const tbdLabel = resolveTbdSourceLabel(activeMatch, slotIndex, slot);
                const fallbackSide = getSetSlotSideLabel(activeMatch.setId, entrantId, {
                  fallbackBySlotIndex: slotIndex,
                  matchupReady: isMatchupReady(activeMatch),
                });
                const otherEntrantId = activeMatch.slots.find(
                  (item) => item.entrantId !== null && item.entrantId !== entrantId,
                )?.entrantId ?? null;

                return {
                  key: `${activeMatch.setId}-dialog-${slotIndex}`,
                  slot,
                  entrantId,
                  entrantName: !entrantId && tbdLabel ? tbdLabel : slot.entrantName,
                  side: entrantId
                    ? activeMatchSideDrafts[entrantId] || getSetSlotSide(activeMatch.setId, entrantId) || fallbackSide
                    : "",
                  scoreValue: entrantId && directWinnerId
                    ? (entrantId === directWinnerId ? "W" : "L")
                    : entrantId ? scoreDrafts[entrantId] ?? "" : "",
                  otherEntrantId,
                };
              })}
              callingEntrantId={callingEntrantId}
              isDqDraft={isActiveMatchDqDraft}
              overlayActive={Boolean(
                obsOverlayState?.active
                && obsOverlayState.currentSetId === activeMatch.setId
                && obsOverlayState.currentSetId !== "__test__",
              )}
              onClose={closeMatchDialog}
              onSwapSides={() => swapMatchSides(activeMatch)}
              onRandomizeSides={() => void randomizeMatchSides(activeMatch)}
              onScoreAdjust={(entrantId, delta) => {
                setScoreDrafts((current) =>
                  applyScoreDraftWithOpponentDefault(
                    activeMatch,
                    current,
                    entrantId,
                    stepScoreDraftValue(current[entrantId] ?? "", delta),
                  ));
              }}
              onScoreChange={(entrantId, value) => {
                setScoreDrafts((current) =>
                  applyScoreDraftWithOpponentDefault(activeMatch, current, entrantId, value));
              }}
              onToggleWinner={(entrantId, otherEntrantId) => {
                setDirectWinnerId((current) => current === entrantId ? null : entrantId);
                setScoreDrafts((current) => ({
                  ...current,
                  [entrantId]: directWinnerId === entrantId ? "" : "W",
                  [otherEntrantId]: directWinnerId === entrantId ? "" : "L",
                }));
              }}
              onSetDq={(entrantId, otherEntrantId) => {
                setScoreDrafts((current) => ({
                  ...current,
                  [entrantId]: "-",
                  [otherEntrantId]: "0",
                }));
              }}
              onCall={(slot, entrantId) => void sendCallMessageFromMatch(slot, entrantId)}
              onDiscardDraft={() => void discardLocalResultDraftForMatch()}
              onResetSet={() => void resetSetResultCascadeForMatch()}
              onSaveDraft={() => void saveLocalResultForMatch(false)}
              onToggleOverlay={() => {
                const isSameActive = obsOverlayState?.active && obsOverlayState.currentSetId === activeMatch.setId;
                const otherSetIsActive = Boolean(
                  obsOverlayState?.active
                  && obsOverlayState.currentSetId
                  && obsOverlayState.currentSetId !== activeMatch.setId
                  && obsOverlayState.currentSetId !== "__test__",
                );

                if (otherSetIsActive && !isSameActive) {
                  setOverlaySwitchConfirm({
                    targetSetId: activeMatch.setId,
                    targetSetLabel: activeMatch.fullRoundText || `Set ${setDisplayCodeById.get(activeMatch.setId) ?? "-"}`,
                  });
                  return;
                }

                void toggleActiveMatchOverlay(activeMatch);
              }}
              onConfirm={() => requestResultConfirmation(activeMatch)}
            />
          )}
          <BracketDialogs
            busy={busy}
            resultConfirmation={resultConfirmation}
            activeSetId={activeMatch?.setId ?? null}
            onCancelResultConfirmation={() => setResultConfirmation(null)}
            onConfirmResult={() => {
              setResultConfirmation(null);
              void saveLocalResultForMatch(true);
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
              void discardLocalResultDraftsForBracket();
            }}
            overlaySwitch={overlaySwitchConfirm && activeMatch && activeObsOverlaySet ? {
              targetSetLabel: overlaySwitchConfirm.targetSetLabel,
              activeSetLabel: activeObsOverlaySet.set.fullRoundText,
              activeEntrantNames: activeObsOverlaySet.set.slots
                .filter((slot) => slot.entrantName.trim() !== "")
                .map((slot) => slot.entrantName),
            } : null}
            overlayBusy={obsOverlayBusy}
            onCancelOverlaySwitch={() => setOverlaySwitchConfirm(null)}
            onConfirmOverlaySwitch={() => {
              setOverlaySwitchConfirm(null);
              if (activeMatch) {
                void forceSwitchActiveMatchOverlay(activeMatch);
              }
            }}
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
