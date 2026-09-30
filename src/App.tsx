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
  clampNonNegativeInteger,
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
  abbreviateOverlayRoundText,
  resolveOverlaySidesForSet,
  useObsOverlay,
} from "./useObsOverlay";
import { BracketTab } from "./BracketTab";
import { BracketDialogs, type ResultConfirmationState } from "./BracketDialogs";
import { MatchDetailDialog, type MatchSideRandomNotice } from "./MatchDetailDialog";
import type { EliminationBracketSectionView } from "./EliminationBracket";
import type { RoundRobinMatrixRowView } from "./RoundRobinMatrix";
import { buildRoundRobinMatrixRows, roundRobinPairKey, type RoundRobinBoardData } from "./roundRobinMatrixDisplay";

import { useBracketReport } from "./useBracketReport";
import { useSetResultDrafts, type SetResultDraftState } from "./useSetResultDrafts";
import {
  applyScoreDraftWithOpponentDefault,
  getSetScoresForDisplay as buildSetScoresForDisplay,
  buildDraftStateFromPending,
  buildScoreDraftsFromResult,
  buildScoreDraftsFromSet,
  buildSlotScoresForSave,
  getPendingSetChangeClass,
  getSetResultVisualStatus,
  hasDqScoreInDrafts,
  isConfirmedSetResult,
  isDqScoreValue,
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
  type LocalSetResultMeta,
  type PlaySide,
  type TournamentWorkspace,
} from "./useTournamentWorkspace";
import {
  loadLastSlug,
  loadLastSnapshotSelection,
  saveEventPhasePoolSelection,
  saveLastSnapshotSelection,
} from "./tournamentWorkspaceRepository";
import {
  buildTbdSourceLabelBySlotKey as buildBracketTbdSourceLabelBySlotKey,
  buildSetDisplayCodeById,
  buildBracketSections,
  buildBracketSectionsForView,
  getDisplaySlotsForSet,
  buildPhaseNames,
  buildPhasePoolGroups,
  isCompletedSet,
  isDisplayableSet,
  isInactiveGrandFinalReset,
  isMatchupReady,
  resolveTbdSourceLabel as resolveBracketTbdSourceLabel,
  type EventSnapshot,
  type PhasePoolGroup,
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
  calculateRoundRobinQualifyingCount,
  compareRoundRobinTieBreakRule,
  createSetEntrantResolver,
  DEFAULT_ROUND_ROBIN_TIE_BREAK_RULES,
  getBracketProgressionModel,
  parseRoundRobinGameScore,
  rankRoundRobinStandings,
  roundRobinTieBreakRuleFromApi,
  type RoundRobinStanding,
  type RoundRobinTieBreakRule,
  type SetEntrantSource,
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

function roundRobinPlaceholderId(slot: SetSlot, source?: SetEntrantSource | null): string {
  const sourceIdentity = source?.typeId
    ? `${source.typeId}:${source.condition?.trim().toLowerCase() || "source"}`
    : null;
  const identity = slot.seedId
    || sourceIdentity
    || slot.seedPlaceholderName?.trim()
    || source?.placeholderName?.trim()
    || slot.entrantName
    || "unknown";
  return `placeholder:${identity}`;
}

function oppositePlaySide(side: PlaySide): PlaySide {
  return side === "1P" ? "2P" : "1P";
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
      const refreshedSideDrafts: Record<string, PlaySide | ""> = {};
      for (const slot of refreshedSet.slots) {
        if (slot.entrantId) {
          refreshedSideDrafts[slot.entrantId] = getSetSlotSide(refreshedSet.setId, slot.entrantId);
        }
      }
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
      const sideDrafts: Record<string, PlaySide | ""> = {};
      for (const slot of restoredSet.slots) {
        if (!slot.entrantId) {
          continue;
        }
        sideDrafts[slot.entrantId] = sideMap.get(`${restoredSet.setId}:${slot.entrantId}`) ?? "";
      }
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
  const lastPersistedSnapshotSelectionRef = useRef("");
  const lastPersistedEventMetaPhasePoolRef = useRef("");
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

  useEffect(() => {
    if (!snapshot || !selectedEvent) {
      return;
    }

    const slugKey = toSlugInput(snapshot.slug);
    const eventIdKey = selectedEvent.eventId.trim();
    if (slugKey === "" || eventIdKey === "") {
      return;
    }

    const selectionKey = [
      slugKey,
      eventIdKey,
      selectedMessageScope?.phaseName.trim() ?? "",
      selectedMessageScope?.phaseGroupName.trim() ?? "",
    ].join("::");
    if (selectionKey === lastPersistedSnapshotSelectionRef.current) {
      return;
    }

    lastPersistedSnapshotSelectionRef.current = selectionKey;
    void saveLastSnapshotSelection({
      slug: snapshot.slug,
      eventId: selectedEvent.eventId,
      phaseName: selectedMessageScope?.phaseName ?? null,
      phaseGroupName: selectedMessageScope?.phaseGroupName ?? null,
    }).catch((err) => {
      lastPersistedSnapshotSelectionRef.current = "";
      setError(String(err));
    });
  }, [selectedEvent, selectedMessageScope, snapshot]);

  useEffect(() => {
    if (!snapshot || !selectedEvent) {
      return;
    }

    const parsed = parsePhasePoolKey(selectedPhasePoolKey);
    const phaseName = (parsed?.phaseName ?? selectedPhaseName).trim();
    const phaseGroupName = (parsed?.phaseGroupName ?? "").trim();
    if (phaseName === "" || phaseGroupName === "") {
      return;
    }

    const slugKey = toSlugInput(snapshot.slug);
    const eventIdKey = selectedEvent.eventId.trim();
    if (slugKey === "" || eventIdKey === "") {
      return;
    }

    const persistKey = `${slugKey}::${eventIdKey}::${phaseName}::${phaseGroupName}`;
    if (persistKey === lastPersistedEventMetaPhasePoolRef.current) {
      return;
    }

    lastPersistedEventMetaPhasePoolRef.current = persistKey;
    setLocalSnapshotEvents((current) => current.map((item) => {
      if (!sameSnapshotEventKey(item.slug, item.eventId, snapshot.slug, selectedEvent.eventId)) {
        return item;
      }

      return {
        ...item,
        lastSelectedPhaseName: phaseName,
        lastSelectedPhaseGroupName: phaseGroupName,
      };
    }));

    void saveEventPhasePoolSelection({
      slug: snapshot.slug,
      eventId: selectedEvent.eventId,
      eventName: selectedEvent.name,
      phaseName,
      phaseGroupName,
    }).catch((err) => {
      lastPersistedEventMetaPhasePoolRef.current = "";
      setError(String(err));
    });
  }, [selectedEvent, selectedPhaseName, selectedPhasePoolKey, snapshot]);

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
    const slots: Array<{
      slotIndex: number;
      list: ItemListConfig;
      minCount: number;
      maxCount: number;
      allowDuplicates: boolean;
    }> = [];
    const appliedSetting = appliedEventMgmtSettings[selectedEventSettingKey];

    for (let slotIndex = 0; slotIndex < MAX_CATEGORY_SLOTS; slotIndex += 1) {
      const listId = appliedSetting?.itemListIds[slotIndex] ?? "";
      if (listId.trim() === "") {
        continue;
      }

      const list = resolveItemListForSelectedEvent(listId);
      if (!list) {
        continue;
      }

      const minCount = clampNonNegativeInteger(appliedSetting?.categoryMinCounts?.[slotIndex] ?? 0, 0);
      const maxCount = Math.max(
        clampNonNegativeInteger(appliedSetting?.categoryMaxCounts?.[slotIndex] ?? 1, 1),
        minCount,
      );

      slots.push({
        slotIndex,
        list,
        minCount,
        maxCount,
        allowDuplicates: Boolean(appliedSetting?.categoryAllowDuplicates?.[slotIndex]),
      });
    }

    return slots;
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

  const selectedCategoryUsageList = useMemo(() => {
    if (!selectedEventMeta) {
      return [] as Array<{
        slotIndex: number;
        categoryName: string;
        listName: string;
        entries: Array<{ itemName: string; count: number; rate: number }>;
      }>;
    }

    const denominator = Math.max(selectedEventMeta.entrants.length, 1);

    return configuredCategorySlots.map((slot) => {
      const itemCounts = new Map<string, number>();
      const items = slot.list.items
        .map((itemName) => itemName.trim())
        .filter((itemName) => itemName !== "");

      for (const itemName of items) {
        itemCounts.set(itemName, 0);
      }

      for (const entrant of selectedEventMeta.entrants) {
        const chosen = entrant.characterNames
          .map((itemName) => itemName.trim())
          .filter((itemName) => itemCounts.has(itemName));

        const uniqueChosen = new Set(chosen);
        for (const itemName of uniqueChosen) {
          itemCounts.set(itemName, (itemCounts.get(itemName) ?? 0) + 1);
        }
      }

      const entries = [...itemCounts.entries()]
        .map(([itemName, count]) => ({
          itemName,
          count,
          rate: (count / denominator) * 100,
        }))
        .filter((entry) => entry.count > 0)
        .sort((left, right) => right.rate - left.rate || left.itemName.localeCompare(right.itemName, "ja"));

      return {
        slotIndex: slot.slotIndex,
        categoryName: slot.list.categoryName,
        listName: slot.list.name,
        entries,
      };
    });
  }, [configuredCategorySlots, selectedEventMeta]);
  const selectedEventEntrants = useMemo(() => {
    if (!selectedEvent) {
      return [] as Array<{ entrantId: string; entrantName: string; seedId: string | null; seedNum: number | null }>;
    }

    const seenOrder: string[] = [];
    const byEntrant = new Map<string, { entrantId: string; entrantName: string; seedId: string | null; seedNum: number | null; firstSeenSetId: string }>();

    for (const set of selectedEvent.sets) {
      for (const slot of set.slots) {
        if (!slot.entrantId) {
          continue;
        }

        const current = byEntrant.get(slot.entrantId);
        const normalizedSeedNum = typeof slot.seedNum === "number" ? slot.seedNum : null;
        const normalizedSeedId = typeof slot.seedId === "string" && slot.seedId.trim() !== "" ? slot.seedId : null;

        if (!current) {
          seenOrder.push(slot.entrantId);
          byEntrant.set(slot.entrantId, {
            entrantId: slot.entrantId,
            entrantName: slot.entrantName,
            seedId: normalizedSeedId,
            seedNum: normalizedSeedNum,
            firstSeenSetId: set.setId,
          });
          continue;
        }

        // Keep the first observed name/order, but fill missing seed data if later slots have it.
        if (current.seedNum === null && normalizedSeedNum !== null) {
          current.seedNum = normalizedSeedNum;
        }
        if (current.seedId === null && normalizedSeedId !== null) {
          current.seedId = normalizedSeedId;
        }
      }
    }

    const entrants = seenOrder
      .map((entrantId) => byEntrant.get(entrantId))
      .filter((item): item is { entrantId: string; entrantName: string; seedId: string | null; seedNum: number | null; firstSeenSetId: string } => item !== undefined);

    if (selectedEvent) {
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
    }

    return entrants.sort((left, right) => {
      const leftSeed = typeof left.seedNum === "number" ? left.seedNum : null;
      const rightSeed = typeof right.seedNum === "number" ? right.seedNum : null;

      if (leftSeed !== null && rightSeed !== null) {
        return leftSeed - rightSeed
          || (left.seedId ?? "").localeCompare(right.seedId ?? "", "ja")
          || left.entrantName.localeCompare(right.entrantName, "ja");
      }
      if (leftSeed !== null) {
        return -1;
      }
      if (rightSeed !== null) {
        return 1;
      }

      // seed 未設定同士は推測で並び替えず、取得順を維持する。
      return 0;
    });
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
    const nextRoundLabel = abbreviateOverlayRoundText(set.fullRoundText);
    const phasePoolLabel = `${set.phaseName?.trim() || "-"} / Pool ${set.phaseGroupDisplayIdentifier?.trim() || "-"}`;
    const setName = set.identifier?.trim() || displayCode || "-";
    const nextRoundText = `${phasePoolLabel} / Set ${setName}\n${nextRoundLabel}`;
    const overlaySides = resolveOverlaySidesForSet(set, {
      getSavedSide: getSetSlotSide,
    });

    await toggleObsOverlaySet({
      enabled: !isSameActive,
      setId: set.setId,
      eventName: selectedEvent?.name ?? "",
      eventAlias: selectedEventMeta?.eventAlias?.trim() ?? "",
      roundText: nextRoundText,
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
    const nextRoundLabel = abbreviateOverlayRoundText(set.fullRoundText);
    const phasePoolLabel = `${set.phaseName?.trim() || "-"} / Pool ${set.phaseGroupDisplayIdentifier?.trim() || "-"}`;
    const setName = set.identifier?.trim() || displayCode || "-";
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
      roundText: `${phasePoolLabel} / Set ${setName}\n${nextRoundLabel}`,
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

  const phaseScopedPoolGroups = useMemo(() => {
    if (phasePoolGroups.length === 0) {
      return [] as PhasePoolGroup[];
    }

    const phaseName = selectedPhaseName === "" ? phasePoolGroups[0].phaseName : selectedPhaseName;
    return phasePoolGroups.filter((group) => group.phaseName === phaseName);
  }, [phasePoolGroups, selectedPhaseName]);

  const selectedPhasePoolGroup = useMemo(() => {
    if (phaseScopedPoolGroups.length === 0) {
      return null;
    }

    if (selectedPhasePoolKey === "") {
      return phaseScopedPoolGroups[0];
    }

    return phaseScopedPoolGroups.find((group) => group.key === selectedPhasePoolKey) ?? phaseScopedPoolGroups[0];
  }, [phaseScopedPoolGroups, selectedPhasePoolKey]);

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

  const bracketVerticalLayoutScale = useMemo(() => {
    if (bracketZoomLevel >= 0.9) {
      return 1;
    }
    if (bracketZoomLevel >= 0.6) {
      return 0.72;
    }
    return 0.58;
  }, [bracketZoomLevel]);

  const renderedBracketSectionsForView = useMemo(() => {
    return selectedBracketSectionsForView.map((section) => ({
      ...section,
      columns: section.columns.map((column) => ({
        ...column,
        height: column.height * bracketVerticalLayoutScale,
        positionedSets: column.positionedSets.map((item) => ({
          ...item,
          y: item.y * bracketVerticalLayoutScale,
        })),
      })),
    }));
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

  const pendingResultBySetId = useMemo(() => {
    const map = new Map<string, LocalSetResultMeta>();
    for (const pending of pendingSetResults) {
      map.set(pending.setId, pending);
    }
    for (const pending of pendingGrandFinalResetResults) {
      const setId = `virtual_gf_reset_${pending.sourceGrandFinalSetId}`;
      map.set(setId, {
        eventId: pending.eventId,
        eventName: pending.eventName,
        setId,
        winnerId: pending.winnerId,
        scoreCsv: pending.scoreCsv,
        directWin: pending.directWin,
        confirmed: pending.confirmed,
        slotScores: pending.slotScores,
        recordedAt: pending.recordedAt,
      });
    }
    return map;
  }, [pendingGrandFinalResetResults, pendingSetResults]);

  const roundRobinBoardData = useMemo<RoundRobinBoardData>(() => {
    if (getBracketProgressionModel(selectedPhasePoolGroup?.bracketType ?? null) !== "round_robin") {
      return {
        entrants: [],
        entrantNames: new Map(),
        entrantIdsByColumnKey: new Map(),
        entrantSeedIds: new Map(),
        entrantSeedNumbers: new Map(),
        sourceDiagnostics: [],
        setsByPair: new Map(),
        candidateSetCount: 0,
        twoSlotSetCount: 0,
        resolvedSetCount: 0,
        registeredSetCount: 0,
        unresolvedSetIds: [],
        unresolvedSetReasons: [],
        standings: [],
        qualifyingCount: 0,
        tieBreakRules: DEFAULT_ROUND_ROBIN_TIE_BREAK_RULES,
      };
    }

    const entrantNames = new Map<string, string>();
    const entrantSeedIds = new Map<string, string>();
    const sourceDiagnostics: string[] = [];
    const candidateSetCount = selectedPhasePoolGroup?.sets.length ?? 0;
    let twoSlotSetCount = 0;
    let resolvedSetCount = 0;
    const registeredSetIds = new Set<string>();
    const unresolvedSetIds: string[] = [];
    const unresolvedSetReasons: string[] = [];
    const isLaterPhase = (selectedPhasePoolGroup?.phaseOrder ?? 1) > 1;
    const entrantSeedNumbers = new Map<string, number>();
    const entrantOriginPlacements = new Map<string, number>();
    const entrantOriginOrders = new Map<string, number>();
    const entrantOriginDisplayIdentifiers = new Map<string, string>();
    const originDisplayIdentifiers = new Set<string>();
    const setsByPair = new Map<string, SetSnapshot>();
    const standingByEntrantId = new Map<string, RoundRobinStanding>();
    const headToHeadWins = new Map<string, Map<string, number>>();
    const setById = new Map((selectedEvent?.sets ?? []).map((set) => [set.setId, set]));
    const phaseGroupSeedById = new Map(
      (selectedPhasePoolGroup?.seeds ?? [])
        .filter((seed) => Boolean(seed.seedId))
        .map((seed) => [seed.seedId, seed]),
    );
    const phaseGroupSeedByNum = new Map(
      (selectedPhasePoolGroup?.seeds ?? [])
        .filter((seed) => seed.seedNum !== null && seed.seedNum !== undefined)
        .map((seed) => [seed.seedNum as number, seed]),
    );
    const phaseGroupSeedByOriginPlacement = new Map(
      (selectedPhasePoolGroup?.seeds ?? [])
        .filter((seed) => seed.originPlacement !== null && seed.originPlacement !== undefined)
        .map((seed) => [seed.originPlacement as number, seed]),
    );
    const phaseGroupSeedIdByEntrantId = new Map(
      (selectedPhasePoolGroup?.seeds ?? [])
        .filter((seed) => Boolean(seed.seedId && seed.entrantId))
        .map((seed) => [seed.entrantId as string, seed.seedId]),
    );
    const phaseGroupSeeds = [...(selectedPhasePoolGroup?.seeds ?? [])]
      .filter((seed) => Boolean(seed.seedId))
      .sort((left, right) => {
        if (left.seedNum !== null && left.seedNum !== undefined
          && right.seedNum !== null && right.seedNum !== undefined
          && left.seedNum !== right.seedNum) {
          return left.seedNum - right.seedNum;
        }
        if (left.seedNum !== null && left.seedNum !== undefined) {
          return -1;
        }
        if (right.seedNum !== null && right.seedNum !== undefined) {
          return 1;
        }
        return left.seedId.localeCompare(right.seedId);
      });
    const seedSlotById = new Map<string, SetSlot>();
    for (const set of selectedPhasePoolGroup?.sets ?? []) {
      for (const slot of set.slots) {
        if (!slot.seedId) {
          continue;
        }
        const current = seedSlotById.get(slot.seedId);
        const slotHasOrigin = slot.seedOriginPlacement !== null
          && slot.seedOriginPlacement !== undefined
          && Boolean(slot.seedOriginPhaseGroupDisplayIdentifier?.trim());
        const currentHasOrigin = current?.seedOriginPlacement !== null
          && current?.seedOriginPlacement !== undefined
          && Boolean(current?.seedOriginPhaseGroupDisplayIdentifier?.trim());
        if (!current || (slotHasOrigin && !currentHasOrigin)) {
          seedSlotById.set(slot.seedId, slot);
        }
      }
    }

    const fixedEntrants: string[] = [];
    const entrantIdsByColumnKey = new Map<string, string | null>();
    for (const seed of phaseGroupSeeds) {
      const seedId = seed.seedId;
      const columnKey = `seed:${seedId}`;
      fixedEntrants.push(columnKey);
      entrantIdsByColumnKey.set(columnKey, seed?.entrantId ?? null);
      if (seed.entrantId) {
        entrantSeedIds.set(seed.entrantId, seed.seedId);
        if (seed.seedNum !== null && seed.seedNum !== undefined) {
          entrantSeedNumbers.set(seed.entrantId, seed.seedNum);
        }
      }
      if (seed?.entrantId && seed.entrantName?.trim()) {
        entrantNames.set(columnKey, seed.entrantName.trim());
      } else {
        entrantNames.set(
          columnKey,
          seed?.placeholderName?.trim()
            || seedSlotById.get(seedId)?.seedPlaceholderName?.trim()
            || seed?.entrantName?.trim()
            || "TBD",
        );
      }
    }

    for (const seed of phaseGroupSeeds) {
      if (!seed.entrantId || standingByEntrantId.has(seed.entrantId)) {
        continue;
      }
      standingByEntrantId.set(seed.entrantId, {
        entrantId: seed.entrantId,
        entrantName: seed.entrantName?.trim() || seed.entrantId,
        isPlaceholder: false,
        wins: 0,
        losses: 0,
        gameWins: 0,
        gameLosses: 0,
        h2hPoints: 0,
        qualified: false,
      });
    }

    type ResolvedRoundRobinSlot = {
      entrantId: string;
      entrantName: string;
      isPlaceholder: boolean;
      seedId?: string | null;
      seedNum?: number | null;
      originPlacement?: number | null;
      originDisplayIdentifier?: string | null;
      originOrder?: number | null;
    };

    const findOriginOrder = (
      originPhaseOrder: number | null | undefined,
      originDisplayIdentifier: string | null | undefined,
      originPlacement: number | null | undefined,
    ): number | null => {
      if (originPlacement === null || originPlacement === undefined) {
        return null;
      }
      const sourceGroup = (selectedEvent?.phaseGroups ?? []).find((group) =>
        group.phaseOrder === originPhaseOrder
        && (group.displayIdentifier?.trim() || null) === (originDisplayIdentifier?.trim() || null),
      );
      return sourceGroup?.progressionsOut
        ?.filter((progression) => progression.originPlacement === originPlacement)
        .map((progression) => progression.originOrder)
        .filter((order): order is number => order !== null)
        .sort((left, right) => left - right)[0] ?? null;
    };

    const progressionSeedById = new Map<string, ResolvedRoundRobinSlot>();
    for (const set of selectedEvent?.sets ?? []) {
      const progressionSeeds = [
        {
          seedId: set.winnerProgressionSeedId,
          placeholderName: set.winnerProgressionSeedPlaceholderName,
          originDisplayIdentifier: set.winnerProgressionOriginPhaseGroupDisplayIdentifier,
          originPhaseOrder: set.winnerProgressionOriginPhaseOrder,
          originPlacement: set.winnerProgressionOriginPlacement,
        },
        {
          seedId: set.loserProgressionSeedId,
          placeholderName: set.loserProgressionSeedPlaceholderName,
          originDisplayIdentifier: set.loserProgressionOriginPhaseGroupDisplayIdentifier,
          originPhaseOrder: set.loserProgressionOriginPhaseOrder,
          originPlacement: set.loserProgressionOriginPlacement,
        },
      ];
      for (const progressionSeed of progressionSeeds) {
        if (!progressionSeed.seedId || progressionSeedById.has(progressionSeed.seedId)) {
          continue;
        }
        progressionSeedById.set(progressionSeed.seedId, {
          entrantId: `placeholder:${progressionSeed.seedId}`,
          entrantName: progressionSeed.placeholderName?.trim() || progressionSeed.seedId,
          isPlaceholder: true,
          seedId: progressionSeed.seedId,
          originPlacement: progressionSeed.originPlacement,
          originDisplayIdentifier: progressionSeed.originDisplayIdentifier,
        });
      }
    }

    const resolveSourceSlot = (
      source: SetEntrantSource | null | undefined,
      visited: Set<string>,
    ): ResolvedRoundRobinSlot | null => {
      if (!source) {
        return null;
      }

      if (source.sourceType?.trim().toLowerCase() === "seed" && source.typeId) {
        const phaseGroupSeed = phaseGroupSeedById.get(source.typeId)
          ?? (source.seedNum !== null && source.seedNum !== undefined
            ? phaseGroupSeedByNum.get(source.seedNum)
            : undefined)
          ?? (source.groupSeedNum !== null && source.groupSeedNum !== undefined
            ? phaseGroupSeedByNum.get(source.groupSeedNum)
            : undefined)
          ?? (source.placement !== null && source.placement !== undefined
            ? phaseGroupSeedByOriginPlacement.get(source.placement)
            : undefined);
        if (phaseGroupSeed?.entrantId) {
          return {
            entrantId: phaseGroupSeed.entrantId,
            entrantName: phaseGroupSeed.entrantName?.trim() || phaseGroupSeed.entrantId,
            isPlaceholder: false,
            seedId: phaseGroupSeed.seedId,
            seedNum: source.seedNum ?? phaseGroupSeed.seedNum,
            originPlacement: source.placement ?? phaseGroupSeed.originPlacement,
            originDisplayIdentifier: source.originPhaseGroupDisplayIdentifier
              ?? phaseGroupSeed.originPhaseGroupDisplayIdentifier,
            originOrder: findOriginOrder(
              source.originPhaseOrder ?? phaseGroupSeed.originPhaseOrder,
              source.originPhaseGroupDisplayIdentifier
                ?? phaseGroupSeed.originPhaseGroupDisplayIdentifier,
              source.placement ?? phaseGroupSeed.originPlacement,
            ),
          };
        }
        const seedSlot = seedSlotById.get(source.typeId);
        if (seedSlot) {
          const placeholderName = source.placeholderName?.trim()
            || seedSlot.seedPlaceholderName?.trim()
            || source.conditionString?.trim();
          if (seedSlot.entrantId) {
            return {
              entrantId: seedSlot.entrantId,
              entrantName: seedSlot.entrantName,
              isPlaceholder: false,
              seedId: seedSlot.seedId,
              seedNum: source.seedNum ?? seedSlot.seedNum,
              originPlacement: source.placement ?? seedSlot.seedOriginPlacement,
              originDisplayIdentifier: source.originPhaseGroupDisplayIdentifier
                ?? seedSlot.seedOriginPhaseGroupDisplayIdentifier,
              originOrder: findOriginOrder(
                source.originPhaseOrder ?? seedSlot.seedOriginPhaseOrder,
                source.originPhaseGroupDisplayIdentifier ?? seedSlot.seedOriginPhaseGroupDisplayIdentifier,
                source.placement ?? seedSlot.seedOriginPlacement,
              ),
            };
          }
          if (placeholderName) {
            return {
              entrantId: roundRobinPlaceholderId(seedSlot, source),
              entrantName: placeholderName,
              isPlaceholder: true,
              seedId: seedSlot.seedId,
              seedNum: source.seedNum ?? seedSlot.seedNum,
              originPlacement: source.placement ?? seedSlot.seedOriginPlacement,
              originDisplayIdentifier: source.originPhaseGroupDisplayIdentifier
                ?? seedSlot.seedOriginPhaseGroupDisplayIdentifier,
              originOrder: findOriginOrder(
                source.originPhaseOrder ?? seedSlot.seedOriginPhaseOrder,
                source.originPhaseGroupDisplayIdentifier ?? seedSlot.seedOriginPhaseGroupDisplayIdentifier,
                source.placement ?? seedSlot.seedOriginPlacement,
              ),
            };
          }
        }
        const progressionSeed = progressionSeedById.get(source.typeId);
        if (progressionSeed?.entrantName && progressionSeed.entrantName !== progressionSeed.seedId) {
          return {
            ...progressionSeed,
            entrantName: source.placeholderName?.trim() || progressionSeed.entrantName,
            seedNum: source.seedNum ?? progressionSeed.seedNum,
            originPlacement: source.originPlacement ?? progressionSeed.originPlacement,
            originDisplayIdentifier: source.originPhaseGroupDisplayIdentifier
              ?? progressionSeed.originDisplayIdentifier,
            originOrder: findOriginOrder(
              source.originPhaseOrder,
              source.originPhaseGroupDisplayIdentifier ?? progressionSeed.originDisplayIdentifier,
              source.originPlacement ?? progressionSeed.originPlacement,
            ),
          };
        }
      }

      const sourceSetId = source.resolvedSetId ?? source.typeId;
      const sourceSet = sourceSetId ? setById.get(sourceSetId) : undefined;
      if (!sourceSet || visited.has(sourceSet.setId)) {
        const placeholderName = source.placeholderName?.trim() || source.conditionString?.trim();
        return placeholderName
          ? {
            entrantId: roundRobinPlaceholderId({
              entrantId: null,
              entrantName: placeholderName,
              seedId: null,
              seedNum: null,
              seedPlaceholderName: null,
              score: null,
            }, source),
            entrantName: placeholderName,
            isPlaceholder: true,
          }
          : null;
      }

      const nextVisited = new Set(visited);
      nextVisited.add(sourceSet.setId);
      const condition = source.condition?.trim().toLowerCase();
      if ((condition === "winner" || condition === "loser") && sourceSet.winnerId) {
        const candidate = sourceSet.slots.find((slot) => {
          if (!slot.entrantId) {
            return false;
          }
          return condition === "winner"
            ? slot.entrantId === sourceSet.winnerId
            : slot.entrantId !== sourceSet.winnerId;
        });
        if (candidate?.entrantId) {
          return {
            entrantId: candidate.entrantId,
            entrantName: candidate.entrantName,
            isPlaceholder: false,
            seedId: candidate.seedId,
            seedNum: candidate.seedNum,
            originPlacement: candidate.seedOriginPlacement,
            originDisplayIdentifier: candidate.seedOriginPhaseGroupDisplayIdentifier,
            originOrder: findOriginOrder(
              source.originPhaseOrder,
              source.originPhaseGroupDisplayIdentifier ?? candidate.seedOriginPhaseGroupDisplayIdentifier,
              source.originPlacement ?? candidate.seedOriginPlacement,
            ),
          };
        }
      }

      const nestedSources = [sourceSet.entrant1Source, sourceSet.entrant2Source];
      return nestedSources
        .map((nestedSource) => resolveSourceSlot(nestedSource, nextVisited))
        .find((resolved): resolved is ResolvedRoundRobinSlot => resolved !== null)
        ?? (source.placeholderName?.trim()
          ? {
            entrantId: roundRobinPlaceholderId({
              entrantId: null,
              entrantName: source.placeholderName.trim(),
              seedId: null,
              seedNum: null,
              seedPlaceholderName: source.placeholderName.trim(),
              score: null,
            }, source),
            entrantName: source.placeholderName.trim(),
            isPlaceholder: true,
          }
          : null);
    };

    for (const set of selectedPhasePoolGroup?.sets ?? []) {
      if (set.slots.length === 2) {
        twoSlotSetCount += 1;
      }
      const entrants = set.slots.map((slot, slotIndex) => {
        const source = slotIndex === 0 ? set.entrant1Source : set.entrant2Source;
        if (isLaterPhase) {
          const sourceSeedSlot = source?.sourceType?.trim().toLowerCase() === "seed" && source.typeId
            ? seedSlotById.get(source.typeId)
            : undefined;
          const sourceProgressionSeed = source?.sourceType?.trim().toLowerCase() === "seed" && source.typeId
            ? progressionSeedById.get(source.typeId)
            : undefined;
          sourceDiagnostics.push([
            `${set.setId}[${slotIndex + 1}]`,
            `rawName=${slot.entrantName || ""}`,
            `entrantId=${slot.entrantId || ""}`,
            `seedId=${slot.seedId || ""}`,
            `placeholder=${slot.seedPlaceholderName || ""}`,
            `sourceType=${source?.sourceType || ""}`,
            `sourceTypeId=${source?.typeId || ""}`,
            `sourceGroupSeedNum=${source?.groupSeedNum ?? ""}`,
            `sourceSeedNum=${source?.seedNum ?? ""}`,
            `sourcePlacement=${source?.placement ?? ""}`,
            `seedLookupPlaceholder=${sourceSeedSlot?.seedPlaceholderName || ""}`,
            `progressionSeedPlaceholder=${sourceProgressionSeed?.entrantName || ""}`,
            `sourcePlaceholder=${source?.placeholderName || ""}`,
            `condition=${source?.conditionString || ""}`,
          ].join(" | "));
        }
        const slotSeed = (slot.seedId ? phaseGroupSeedById.get(slot.seedId) : undefined)
          ?? (slot.seedNum !== null && slot.seedNum !== undefined
            ? phaseGroupSeedByNum.get(slot.seedNum)
            : undefined)
          ?? (source?.seedNum !== null && source?.seedNum !== undefined
            ? phaseGroupSeedByNum.get(source.seedNum)
            : undefined)
          ?? (source?.groupSeedNum !== null && source?.groupSeedNum !== undefined
            ? phaseGroupSeedByNum.get(source.groupSeedNum)
            : undefined)
          ?? (source?.placement !== null && source?.placement !== undefined
            ? phaseGroupSeedByOriginPlacement.get(source.placement)
            : undefined);
        const slotSeedSlot = slot.seedId ? seedSlotById.get(slot.seedId) : undefined;
        const resolved = slot.entrantId
          ? {
            entrantId: slot.entrantId,
            entrantName: slot.entrantName,
            isPlaceholder: false,
            seedId: slot.seedId,
            seedNum: slot.seedNum,
            originPlacement: slot.seedOriginPlacement,
            originDisplayIdentifier: slot.seedOriginPhaseGroupDisplayIdentifier,
            originOrder: findOriginOrder(
              source?.originPhaseOrder ?? null,
              source?.originPhaseGroupDisplayIdentifier ?? slot.seedOriginPhaseGroupDisplayIdentifier,
              source?.originPlacement ?? slot.seedOriginPlacement,
            ),
          }
          : (slotSeed?.entrantId
            ? {
              entrantId: slotSeed.entrantId,
              entrantName: slotSeed.entrantName?.trim() || slotSeed.entrantId,
              isPlaceholder: false,
              seedId: slotSeed.seedId,
              seedNum: slot.seedNum ?? slotSeed.seedNum,
              originPlacement: slot.seedOriginPlacement ?? slotSeed.originPlacement,
              originDisplayIdentifier: slot.seedOriginPhaseGroupDisplayIdentifier
                ?? slotSeed.originPhaseGroupDisplayIdentifier,
              originOrder: slotSeed.originOrder,
            }
            : slotSeedSlot?.entrantId
              ? {
                entrantId: slotSeedSlot.entrantId,
                entrantName: slotSeedSlot.entrantName,
                isPlaceholder: false,
                seedId: slotSeedSlot.seedId,
                seedNum: slot.seedNum ?? slotSeedSlot.seedNum,
                originPlacement: slot.seedOriginPlacement ?? slotSeedSlot.seedOriginPlacement,
                originDisplayIdentifier: slot.seedOriginPhaseGroupDisplayIdentifier
                  ?? slotSeedSlot.seedOriginPhaseGroupDisplayIdentifier,
                originOrder: null,
              }
              : resolveSourceSlot(source, new Set([set.setId])))
            ?? (slot.seedPlaceholderName?.trim()
              ? {
                entrantId: roundRobinPlaceholderId(slot, source),
                entrantName: slot.seedPlaceholderName.trim(),
                isPlaceholder: true,
                seedId: slot.seedId,
                seedNum: slot.seedNum,
                originPlacement: slot.seedOriginPlacement,
                originDisplayIdentifier: slot.seedOriginPhaseGroupDisplayIdentifier,
              }
              : null);
        const entrantId = resolved?.entrantId ?? roundRobinPlaceholderId(slot, source);
        const sourcePlaceholderName = source?.placeholderName?.trim()
          || source?.conditionString?.trim();
        const entrantName = resolved && !resolved.isPlaceholder
          ? resolved.entrantName
          : sourcePlaceholderName
            ?? resolved?.entrantName
          ?? slot.seedPlaceholderName?.trim()
          ?? sourcePlaceholderName
          ?? slot.entrantName
          ?? "TBD";
        const effectiveSeedId = phaseGroupSeedIdByEntrantId.get(entrantId)
          ?? resolved?.seedId
          ?? slot.seedId;
        return {
          slot,
          entrantId,
          entrantName,
          isPlaceholder: resolved?.isPlaceholder ?? slot.entrantId === null,
          seedId: effectiveSeedId,
          seedNum: source?.seedNum ?? resolved?.seedNum,
          originPlacement: source?.placement ?? resolved?.originPlacement,
          originDisplayIdentifier: source?.originPhaseGroupDisplayIdentifier
            ?? resolved?.originDisplayIdentifier,
          originOrder: resolved?.originOrder ?? findOriginOrder(
            source?.originPhaseOrder ?? null,
            source?.originPhaseGroupDisplayIdentifier ?? slot.seedOriginPhaseGroupDisplayIdentifier,
            source?.originPlacement ?? slot.seedOriginPlacement,
          ),
        };
      });
      entrants.forEach(({ slot, entrantId, entrantName, isPlaceholder, seedId, seedNum, originPlacement, originDisplayIdentifier, originOrder }) => {
        entrantNames.set(entrantId, entrantName);
        const effectiveSeedId = phaseGroupSeedIdByEntrantId.get(entrantId)
          ?? seedId
          ?? slot.seedId;
        if (effectiveSeedId) {
          entrantSeedIds.set(entrantId, effectiveSeedId);
        }
        const effectiveSeedNum = seedNum ?? slot.seedNum;
        const effectiveOriginPlacement = originPlacement ?? slot.seedOriginPlacement;
        const effectiveOriginDisplayIdentifier = originDisplayIdentifier?.trim()
          || slot.seedOriginPhaseGroupDisplayIdentifier?.trim();
        if (effectiveSeedNum !== null && effectiveSeedNum !== undefined) {
          const currentSeedNumber = entrantSeedNumbers.get(entrantId);
          if (currentSeedNumber === undefined || effectiveSeedNum < currentSeedNumber) {
            entrantSeedNumbers.set(entrantId, effectiveSeedNum);
          }
        }
        if (effectiveOriginPlacement !== null && effectiveOriginPlacement !== undefined) {
          const currentPlacement = entrantOriginPlacements.get(entrantId);
          if (currentPlacement === undefined || effectiveOriginPlacement < currentPlacement) {
            entrantOriginPlacements.set(entrantId, effectiveOriginPlacement);
          }
        }
        if (originOrder !== null && originOrder !== undefined) {
          const currentOrder = entrantOriginOrders.get(entrantId);
          if (currentOrder === undefined || originOrder < currentOrder) {
            entrantOriginOrders.set(entrantId, originOrder);
          }
        }
        if (effectiveOriginDisplayIdentifier) {
          originDisplayIdentifiers.add(effectiveOriginDisplayIdentifier);
          const currentPlacement = entrantOriginPlacements.get(entrantId);
          const currentDisplayIdentifier = entrantOriginDisplayIdentifiers.get(entrantId);
          if (currentDisplayIdentifier === undefined
            || (effectiveOriginPlacement !== null
              && effectiveOriginPlacement !== undefined
              && currentPlacement === effectiveOriginPlacement)) {
            entrantOriginDisplayIdentifiers.set(entrantId, effectiveOriginDisplayIdentifier);
          }
        }
        if (!standingByEntrantId.has(entrantId)) {
          standingByEntrantId.set(entrantId, {
            entrantId,
            entrantName,
            isPlaceholder,
            wins: 0,
            losses: 0,
            gameWins: 0,
            gameLosses: 0,
            h2hPoints: 0,
            qualified: false,
          });
        }
      });

      const hasUnassignedSlot = set.slots.some((slot) => slot.entrantId === null);
      if (entrants.length !== 2 || entrants[0].entrantId === entrants[1].entrantId) {
        unresolvedSetIds.push(set.setId);
        unresolvedSetReasons.push([
          set.setId,
          `slots=${set.slots.length}`,
          `unassigned=${hasUnassignedSlot}`,
          `entrantIds=${entrants.map((entrant) => entrant.entrantId).join(",")}`,
          `seedIds=${entrants.map((entrant) => entrant.seedId ?? "").join(",")}`,
        ].join(" | "));
        continue;
      }

      resolvedSetCount += 1;
      registeredSetIds.add(set.setId);

      setsByPair.set(
        roundRobinPairKey(entrants[0].entrantId, entrants[1].entrantId),
        set,
      );
      if (entrants[0].seedId && entrants[1].seedId) {
        setsByPair.set(
          roundRobinPairKey(entrants[0].seedId, entrants[1].seedId),
          set,
        );
      }
      const setDisplay = getSetScoresForDisplay(set);
      const winnerId = setDisplay.winnerId ?? set.winnerId;
      if (!winnerId || !standingByEntrantId.has(winnerId)) {
        continue;
      }

      const loser = entrants.find((entrant) => entrant.entrantId !== winnerId);
      const winner = entrants.find((entrant) => entrant.entrantId === winnerId);
      if (!loser || !winner) {
        continue;
      }

      const winnerStanding = standingByEntrantId.get(winner.entrantId);
      const loserStanding = standingByEntrantId.get(loser.entrantId);
      if (!winnerStanding || !loserStanding) {
        continue;
      }

      winnerStanding.wins += 1;
      loserStanding.losses += 1;
      const winnerHeadToHead = headToHeadWins.get(winner.entrantId) ?? new Map<string, number>();
      winnerHeadToHead.set(loser.entrantId, (winnerHeadToHead.get(loser.entrantId) ?? 0) + 1);
      headToHeadWins.set(winner.entrantId, winnerHeadToHead);
      const winnerSlot = winner.slot;
      const loserSlot = loser.slot;
      const winnerScore = parseRoundRobinGameScore(
        setDisplay.scores[winner.entrantId] ?? winnerSlot?.score ?? undefined,
      );
      const loserScore = parseRoundRobinGameScore(
        setDisplay.scores[loser.entrantId] ?? loserSlot?.score ?? undefined,
      );
      if (winnerScore !== null && loserScore !== null) {
        winnerStanding.gameWins += winnerScore;
        winnerStanding.gameLosses += loserScore;
        loserStanding.gameWins += loserScore;
        loserStanding.gameLosses += winnerScore;
      }
    }

    const configuredTieBreakOrder: string[] = selectedPhasePoolGroup?.tiebreakOrder ?? [];
    const tieBreakRules = configuredTieBreakOrder.length === 0
      ? [...DEFAULT_ROUND_ROBIN_TIE_BREAK_RULES]
      : [...new Set<RoundRobinTieBreakRule>(configuredTieBreakOrder
        .map((rule) => roundRobinTieBreakRuleFromApi(rule))
        .filter((rule): rule is RoundRobinTieBreakRule => rule !== null))];
    const headToHeadRuleIndex = tieBreakRules.indexOf("head_to_head");
    if (headToHeadRuleIndex >= 0) {
      const standingsBeforeHeadToHead = [...standingByEntrantId.values()];
      const precedingRules = tieBreakRules.slice(0, headToHeadRuleIndex);
      for (const standing of standingsBeforeHeadToHead) {
        const tiedEntrantIds = new Set(
          standingsBeforeHeadToHead
            .filter((candidate) => precedingRules.every((rule) =>
              compareRoundRobinTieBreakRule(candidate, standing, rule) === 0))
            .map((candidate) => candidate.entrantId),
        );
        standing.h2hPoints = [...(headToHeadWins.get(standing.entrantId)?.entries() ?? [])]
          .filter(([opponentId]) => tiedEntrantIds.has(opponentId))
          .reduce((points, [, wins]) => points + wins, 0);
      }
    }

    const currentPhaseOrder = selectedPhasePoolGroup?.phaseOrder ?? null;
    const nextPhaseOrder = currentPhaseOrder === null
      ? null
      : (selectedEvent?.phaseGroups ?? [])
        .map((group) => group.phaseOrder)
        .filter((order): order is number => order !== null && order > currentPhaseOrder)
        .sort((left, right) => left - right)[0] ?? null;
    const qualifyingCount = calculateRoundRobinQualifyingCount({
      progressionsOut: selectedPhasePoolGroup?.progressionsOut ?? [],
      currentPhaseOrder,
      currentPhaseGroupDisplayIdentifier: selectedPhasePoolGroup?.phaseGroupDisplayIdentifier ?? null,
      nextPhaseOrder,
      downstreamSets: selectedEvent?.sets ?? [],
    });
    const seedOrderById = new Map<string, number>(
      (selectedPhasePoolGroup?.seedOrder ?? []).map((seedId: string, index: number) => [seedId, index]),
    );
    const entrantSeedOrder = (entrantId: string): number | undefined => {
      const seedId = entrantSeedIds.get(entrantId);
      return seedId === undefined ? undefined : seedOrderById.get(seedId);
    };
    const orderedOriginDisplayIdentifiers = [...originDisplayIdentifiers].sort((left, right) =>
      left.localeCompare(right, "ja"),
    );
    const originDisplayIdentifierOrder = new Map(
      orderedOriginDisplayIdentifiers.map((displayIdentifier, index) => [displayIdentifier, index]),
    );
    const originGroupCount = orderedOriginDisplayIdentifiers.length;
    const entrantAxisOrder = (entrantId: string): number => {
      const placement = entrantOriginPlacements.get(entrantId);
      const groupIdentifier = entrantOriginDisplayIdentifiers.get(entrantId);
      const groupOrder = groupIdentifier === undefined
        ? originGroupCount
        : originDisplayIdentifierOrder.get(groupIdentifier) ?? originGroupCount;
      if (placement === undefined) {
        return Number.MAX_SAFE_INTEGER;
      }
      if (originGroupCount === 0 || groupOrder === originGroupCount) {
        return placement * (originGroupCount + 1);
      }

      const groupOrderInPlacement = placement % 2 === 0
        ? originGroupCount - 1 - groupOrder
        : groupOrder;
      return (placement - 1) * originGroupCount + groupOrderInPlacement;
    };
    const sortedEntrants = [...standingByEntrantId.keys()].sort((leftEntrantId, rightEntrantId) => {
      const leftSeedOrder = entrantSeedOrder(leftEntrantId);
      const rightSeedOrder = entrantSeedOrder(rightEntrantId);
      if (leftSeedOrder !== undefined || rightSeedOrder !== undefined) {
        if (leftSeedOrder === undefined || rightSeedOrder === undefined) {
          return leftSeedOrder === undefined ? 1 : -1;
        }
        if (leftSeedOrder !== rightSeedOrder) {
          return leftSeedOrder - rightSeedOrder;
        }
      }

      if (isLaterPhase) {
        const leftPlacement = entrantOriginPlacements.get(leftEntrantId);
        const rightPlacement = entrantOriginPlacements.get(rightEntrantId);
        if (leftPlacement !== undefined || rightPlacement !== undefined) {
          if (leftPlacement === undefined || rightPlacement === undefined) {
            return leftPlacement === undefined ? 1 : -1;
          }
        }

        if (leftPlacement !== undefined
          && rightPlacement !== undefined
          && leftPlacement === rightPlacement) {
          const leftOriginOrder = entrantOriginOrders.get(leftEntrantId);
          const rightOriginOrder = entrantOriginOrders.get(rightEntrantId);
          if (leftOriginOrder !== undefined || rightOriginOrder !== undefined) {
            if (leftOriginOrder === undefined || rightOriginOrder === undefined) {
              return leftOriginOrder === undefined ? 1 : -1;
            }
            if (leftOriginOrder !== rightOriginOrder) {
              return leftOriginOrder - rightOriginOrder;
            }
          }
        }

        const byDisplayIdentifier = entrantAxisOrder(leftEntrantId) - entrantAxisOrder(rightEntrantId);
        if (byDisplayIdentifier !== 0) {
          return byDisplayIdentifier;
        }
      }

      const leftSeedNumber = entrantSeedNumbers.get(leftEntrantId);
      const rightSeedNumber = entrantSeedNumbers.get(rightEntrantId);
      if (leftSeedNumber !== undefined && rightSeedNumber !== undefined && leftSeedNumber !== rightSeedNumber) {
        return leftSeedNumber - rightSeedNumber;
      }
      if (leftSeedNumber !== undefined || rightSeedNumber !== undefined) {
        return leftSeedNumber === undefined ? 1 : -1;
      }
      const byName = (entrantNames.get(leftEntrantId) ?? "").localeCompare(entrantNames.get(rightEntrantId) ?? "", "ja");
      return byName || leftEntrantId.localeCompare(rightEntrantId, "ja");
    });
    if (phaseGroupSeeds.length === 0) {
      const fixedEntrantIds = new Set(
        [...entrantIdsByColumnKey.values()].filter((entrantId): entrantId is string => entrantId !== null),
      );
      for (const entrantId of sortedEntrants) {
        if (fixedEntrantIds.has(entrantId)) {
          continue;
        }
        fixedEntrants.push(entrantId);
        entrantIdsByColumnKey.set(entrantId, entrantId);
        fixedEntrantIds.add(entrantId);
      }
    }
    const entrantOrder = new Map(fixedEntrants.map((entrantId, index) => [entrantId, index]));

    const standings = rankRoundRobinStandings({
      standings: [...standingByEntrantId.values()],
      tieBreakRules,
      entrantSeedNumbers,
      entrantOrder,
      qualifyingCount,
    });

    return {
      entrants: fixedEntrants,
      entrantNames,
      entrantIdsByColumnKey,
      entrantSeedIds,
      entrantSeedNumbers,
      sourceDiagnostics,
      setsByPair,
      candidateSetCount,
      twoSlotSetCount,
      resolvedSetCount,
      registeredSetCount: registeredSetIds.size,
      unresolvedSetIds,
      unresolvedSetReasons,
      standings,
      qualifyingCount,
      tieBreakRules,
    };
  }, [interimScoreDraftsBySetId, pendingResultBySetId, selectedEvent, selectedPhasePoolGroup]);

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

  const eliminationBracketSections: EliminationBracketSectionView[] = renderedBracketSectionsForView.map((section) => ({
    key: section.key,
    title: section.title,
    setCount: section.setCount,
    columns: section.columns.map((column) => ({
      key: column.key,
      title: column.title,
      round: column.round,
      height: column.height,
      hidden: column.hidden,
      cards: column.positionedSets.map(({ set, y }) => {
        const displaySet = resolvedEventSetsById.get(set.setId) ?? set;
        const pendingResult = pendingResultBySetId.get(set.setId);
        const resultStatus = getSetResultVisualStatus(
          set,
          pendingResult,
          interimScoreDraftsBySetId[set.setId],
        );
        const resultStatusLabel = resultStatus === "confirmed"
          ? "確定"
          : resultStatus === "reset"
            ? "取消待ち"
            : resultStatus === "draft"
              ? "下書き"
              : resultStatus === "inprogress"
                ? "途中"
                : "";
        const finishedSet = isCompletedSet(set);
        const matchupReady = isMatchupReady(displaySet);
        const setDisplay = getSetScoresForDisplay(displaySet);
        const winnerId = setDisplay.winnerId ?? set.winnerId;

        return {
          set,
          positionY: y,
          displayCode: setDisplayCodeById.get(set.setId),
          changeClass: pendingResult ? getPendingSetChangeClass(pendingResult) : "",
          resultStatus,
          resultStatusLabel,
          isLiveOverlaySet: Boolean(
            obsOverlayState?.active
            && obsOverlayState.currentSetId === set.setId
            && obsOverlayState.currentSetId !== "__test__",
          ),
          slots: displaySet.slots.map((slot, index) => {
            const entrantId = slot.entrantId;
            const tbdSourceLabel = resolveTbdSourceLabel(set, index, slot);
            const entrantName = !entrantId && tbdSourceLabel ? tbdSourceLabel : slot.entrantName;
            const isWinner = entrantId && winnerId ? entrantId === winnerId : false;
            const sideLabel = getSetSlotSideLabel(set.setId, entrantId, {
              fallbackBySlotIndex: index,
              finishedSet,
              matchupReady,
            });
            const sideBadgeClass = sideLabel === "1P"
              ? (finishedSet ? "side-1p-finished" : "side-1p")
              : sideLabel === "2P"
                ? (finishedSet ? "side-2p-finished" : "side-2p")
                : "side-none";
            const gameWins = entrantId
              ? (setDisplay.scores[entrantId]
                ?? (slot.score !== null
                  ? (isDqScoreValue(slot.score) ? "DQ" : formatScoreValue(slot.score))
                  : (winnerId ? (isWinner ? "✓" : "-") : "-")))
              : "-";
            const scoreClass = (isDqScoreValue(slot.score) || setDisplay.isDq)
              ? (isWinner ? "win" : "dq")
              : (isWinner ? "win" : "lose");

            return {
              key: `${set.setId}-${index}`,
              sideLabel,
              sideBadgeClass,
              entrantName,
              gameWins,
              scoreClass,
            };
          }),
        };
      }),
    })),
  }));

  useEffect(() => {
    if (phaseNames.length === 0) {
      if (selectedPhaseName !== "") {
        setSelectedPhaseName("");
      }
      return;
    }

    if (phaseNames.includes(selectedPhaseName)) {
      return;
    }

    setSelectedPhaseName(phaseNames[0]);
  }, [phaseNames, selectedPhaseName]);

  useEffect(() => {
    if (phaseScopedPoolGroups.length === 0) {
      if (selectedPhasePoolKey !== "") {
        setSelectedPhasePoolKey("");
      }
      return;
    }

    if (phaseScopedPoolGroups.some((group) => group.key === selectedPhasePoolKey)) {
      return;
    }

    setSelectedPhasePoolKey(phaseScopedPoolGroups[0].key);
  }, [phaseScopedPoolGroups, selectedPhasePoolKey]);

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
        lastPersistedSnapshotSelectionRef.current = "";
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
        lastPersistedSnapshotSelectionRef.current = "";
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
    if (!entrantId) {
      return "-";
    }

    // 対戦カードが未確定の間は、保存済みサイドが残っていても表示しない。
    if (!options?.finishedSet && !options?.matchupReady) {
      return "-";
    }

    const side = getSetSlotSide(setId, entrantId);
    if (side !== "") {
      return side;
    }

    if ((options?.finishedSet || options?.matchupReady) && options.fallbackBySlotIndex !== undefined) {
      if (options.fallbackBySlotIndex === 0) {
        return "1P";
      }
      if (options.fallbackBySlotIndex === 1) {
        return "2P";
      }
    }

    return "-";
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

    const sideDrafts: Record<string, PlaySide | ""> = {};
    for (const slot of inputSet.slots) {
      if (!slot.entrantId) {
        continue;
      }
      sideDrafts[slot.entrantId] = getSetSlotSide(set.setId, slot.entrantId);
    }
    setActiveMatchSideDrafts(sideDrafts);

    if (forcedDraftState) {
      setDirectWinnerId(forcedDraftState.directWin ? forcedDraftState.winnerId : null);
      setScoreDrafts(forcedDraftState.scoreDrafts);
      saveSetDraft(set.setId, forcedDraftState);
      return;
    }

    const pending = pendingResultBySetId.get(set.setId);
    if (pending) {
      const draftState = buildDraftStateFromPending(inputSet, pending);
      setDirectWinnerId(draftState.directWin ? draftState.winnerId : null);
      setScoreDrafts(draftState.scoreDrafts);
      saveSetDraft(set.setId, draftState);
      return;
    }

    const cached = setResultDrafts[set.setId];
    if (cached) {
      setDirectWinnerId(cached.directWin ? cached.winnerId : null);
      setScoreDrafts(cached.scoreDrafts);
      return;
    }

    setDirectWinnerId(null);
    const snapshotDisplay = getSetScoresForDisplay(set);
    const snapshotScoreDrafts = Object.keys(snapshotDisplay.scores).length > 0
      ? snapshotDisplay.scores
      : buildScoreDraftsFromSet(inputSet);
    setScoreDrafts(snapshotScoreDrafts);
    saveSetDraft(set.setId, {
      winnerId: "",
      scoreDrafts: snapshotScoreDrafts,
      directWin: false,
    });
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

  function swapMatchSides(setSnapshot: SetSnapshot) {
    if (!isMatchupReady(setSnapshot)) {
      return;
    }

    const slots = setSnapshot.slots.filter((slot) => slot.entrantId !== null);
    if (slots.length < 2) {
      return;
    }

    const upper = slots[0];
    const lower = slots[1];
    const upperId = upper.entrantId;
    const lowerId = lower.entrantId;
    if (!upperId || !lowerId) {
      return;
    }

    const resolveSide = (entrantId: string, fallbackSlotIndex: number): PlaySide => {
      const draftSide = activeMatchSideDrafts[entrantId] ?? "";
      if (draftSide !== "") {
        return draftSide;
      }

      const savedSide = getSetSlotSide(setSnapshot.setId, entrantId);
      if (savedSide !== "") {
        return savedSide;
      }

      return fallbackSlotIndex === 0 ? "1P" : "2P";
    };

    const upperCurrent = resolveSide(upperId, 0);
    const lowerCurrent = resolveSide(lowerId, 1);

    setActiveMatchSideDrafts((current) => ({
      ...current,
      [upperId]: lowerCurrent,
      [lowerId]: upperCurrent,
    }));
  }

  async function randomizeMatchSides(setSnapshot: SetSnapshot) {
    if (!isMatchupReady(setSnapshot)) {
      return;
    }

    const slots = setSnapshot.slots.filter((slot) => slot.entrantId !== null);
    if (slots.length < 2) {
      return;
    }

    const upper = slots[0];
    const lower = slots[1];
    const upperId = upper.entrantId;
    const lowerId = lower.entrantId;
    if (!upperId || !lowerId) {
      return;
    }

    const upperIsOneP = Math.random() < 0.5;
    const upperSide: PlaySide = upperIsOneP ? "1P" : "2P";
    const lowerSide: PlaySide = upperIsOneP ? "2P" : "1P";

    const upperCurrent = activeMatchSideDrafts[upperId] ?? "";
    const lowerCurrent = activeMatchSideDrafts[lowerId] ?? "";
    const changed = upperCurrent !== upperSide || lowerCurrent !== lowerSide;

    setActiveMatchSideDrafts((current) => ({
      ...current,
      [upperId]: upperSide,
      [lowerId]: lowerSide,
    }));

    setMatchSideRandomNotice({
      setId: setSnapshot.setId,
      upperEntrantName: upper.entrantName,
      lowerEntrantName: lower.entrantName,
      upperSide,
      lowerSide,
      changed,
      triggeredAt: Date.now(),
    });
  }

  async function saveMatchSidesIfNeeded(
    eventSnapshot: EventSnapshot,
    set: SetSnapshot,
    sideDrafts: Record<string, PlaySide | "">,
  ) {
    if (!isMatchupReady(set)) {
      return;
    }

    const slots = set.slots.filter((slot) => slot.entrantId !== null);
    if (slots.length < 2) {
      return;
    }

    const upperId = slots[0].entrantId;
    const lowerId = slots[1].entrantId;
    if (!upperId || !lowerId) {
      return;
    }

    const currentUpper = getSetSlotSide(set.setId, upperId);
    const currentLower = getSetSlotSide(set.setId, lowerId);
    const fallbackUpper = getSetSlotSideLabel(set.setId, upperId, {
      fallbackBySlotIndex: 0,
      matchupReady: true,
    });
    const fallbackLower = getSetSlotSideLabel(set.setId, lowerId, {
      fallbackBySlotIndex: 1,
      matchupReady: true,
    });
    const toPlaySide = (value: string): PlaySide | "" => value === "1P" || value === "2P" ? value : "";
    const draftUpper = sideDrafts[upperId] || currentUpper || toPlaySide(fallbackUpper);
    const draftLower = sideDrafts[lowerId] || currentLower || toPlaySide(fallbackLower);

    let resolvedUpper: PlaySide | "" = "";
    if (draftUpper !== "" && draftLower !== "") {
      resolvedUpper = draftUpper;
    } else if (draftUpper !== "") {
      resolvedUpper = draftUpper;
    } else if (draftLower !== "") {
      resolvedUpper = oppositePlaySide(draftLower);
    }

    if (resolvedUpper === "") {
      return;
    }

    const resolvedLower = oppositePlaySide(resolvedUpper);
    const sideOverrides = {
      [upperId]: resolvedUpper,
      [lowerId]: resolvedLower,
    };
    const sidesChanged = currentUpper !== resolvedUpper || currentLower !== resolvedLower;

    if (sidesChanged) {
      await saveSetPlaySide(eventSnapshot, set, upperId, resolvedUpper, {
        silent: true,
        manageBusy: false,
      });

      const currentScores = set.slots
        .filter((slot): slot is SetSlot & { entrantId: string } => slot.entrantId !== null)
        .map((slot) => ({ entrantId: slot.entrantId, score: slot.score ?? 0 }));
      await syncObsOverlayScoresForSet(set, currentScores, sideOverrides);
    }

    return sideOverrides;
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
