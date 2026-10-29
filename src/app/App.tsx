import { t, useLanguage } from "../i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { save as saveFile } from "@tauri-apps/plugin-dialog";
import { CreateSnapshot } from "../components/CreateSnapshot";
import { useLocalEventDraft } from "../hooks/useLocalEventDraft";
import { DqRequestDialog } from "../components/DqRequestDialog";
import { useDqCameraScan } from "../hooks/useDqCameraScan";
import { useSenderProfile } from "../hooks/useSenderProfile";
import { useMobileInputPortal } from "../hooks/useMobileInputPortal";
import { useCallSync } from "../hooks/useCallSync";
import { usePlayerCalls, type PlayerCall } from "../hooks/usePlayerCalls";
import { useBracketMessages } from "../hooks/useBracketMessages";
import { getExternalReportRejectionReason, getLatestPoolExternalRequest } from "../domain/externalReportProcessing";
import { resolveCallPhaseName, useCallMessage } from "../hooks/useCallMessage";
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
import { SenderUserList } from "../components/SenderUserList";
import { useSenderUserList } from "../hooks/useSenderUserList";
import type { FeatureMessage } from "../domain/messages";
import {
  CallListPlayingCommunication,
  CallReactionDialog,
  StatusBoard,
  StatusBoardHero,
  type CallListEventGroup,
  type CallListPlayer,
} from "../components/StatusBoard";
import { PlayerListInfo } from "../components/PlayerListInfo";
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
import { buildInitialPhaseSeedMapping, buildInitialPhaseSeedSwap, canShuffleInitialPhaseSeeds, getInitialPhasePlayerPositions } from "../domain/initialPhaseSeedShuffle";
import type { PlayerSeedSwapControls } from "../components/PlayerSeedSwap";
import { useEventSnapshotMaintenance } from "../hooks/useEventSnapshotMaintenance";
import { useSetSideAssignment } from "../hooks/useSetSideAssignment";
import { useMatchDialogActions } from "../hooks/useMatchDialogActions";
import { useTournamentCreation } from "../hooks/useTournamentCreation";
import { useUserCards } from "../hooks/useUserCards";
import { useItemLists } from "../hooks/useItemLists";
import { usePlayerDqRequest } from "../hooks/usePlayerDqRequest";
import { useLocalMessageService } from "../hooks/useLocalMessageService";
import {
  CALL_LIST_COLOR_SECONDS_MAX,
  CALL_LIST_COLOR_SECONDS_MIN,
  CALL_LIST_ROTATE_SECONDS_MAX,
  CALL_LIST_ROTATE_SECONDS_MIN,
  useCallList,
} from "../hooks/useCallList";
import {
  exportTournamentShareArchive,
  importTournamentShareArchive,
  writeSnapshotExportFile,
} from "../domain/tournamentWorkspaceRepository";
import { findSnapshotEventByIdentity, sameSnapshotEventKey } from "../domain/snapshotDisplay";
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
  resolveEntrantDisplayName,
  type EventSnapshot,
} from "../domain/bracketDisplay";
import {
  canBroadcastCallListSync as resolveCanBroadcastCallListSync,
  hasSenderIdCollision,
  isDqRequestMessage,
  isDqRequestConfirmed,
  extractMetaString,
  getExternalEditRequest,
  getExternalScoreReport,
  getExternalScoreReportBatch,
  getExternalScoreSyncRequest,
  isValidIpv4,
  resolveSenderSettingsStatus,
  type ExternalScoreReport,
} from "../domain/messageUtils";
import {
  type SetSnapshot,
} from "../domain/bracketProgression";
import { useSelectedEventData } from "../hooks/useSelectedEventData";
import "./App.css";

const STARTGG_FETCH_PER_PAGE = 50;
const EMPTY_PLAYER_ALIAS_MAP: Record<string, string> = {};
type ConfirmedExternalScoreReport = Omit<ExternalScoreReport, "tournamentId" | "slug">;
type SetCallAction = {
  set: SetSnapshot;
  operationLabel: string;
  run: () => void | Promise<void>;
};
type SetCallResolutionDialogState = {
  set: SetSnapshot;
  setLabel: string;
  operationLabel: string;
  ownCalls: FeatureMessage[];
  otherCalls: FeatureMessage[];
  continueAfterResolution: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getActiveCallsForSet(
  calls: PlayerCall[],
  eventId: string,
  setId: string,
): FeatureMessage[] {
  return calls
    .map(({ message }) => message)
    .filter((message) =>
      message.method === "call_player"
      && message.messageType === "normal"
      && message.parentMessageId === null
      && extractMetaString(message.messageMeta, "eventId") === eventId
      && extractMetaString(message.messageMeta, "setId") === setId
    );
}

function readSnapshotArchiveIdentity(archiveJson: string) {
  const archive: unknown = JSON.parse(archiveJson);
  if (!isRecord(archive)) {
    throw new Error(t("スナップショットの形式が不正です。"));
  }

  const snapshot = archive.snapshot;
  if (!isRecord(snapshot)) {
    throw new Error(t("スナップショットの大会情報がありません。"));
  }
  const events = snapshot.events;
  const event = Array.isArray(events) ? events[0] : null;
  if (
    typeof snapshot.slug !== "string"
    || !Array.isArray(events)
    || events.length !== 1
    || !isRecord(event)
    || typeof event.eventId !== "string"
  ) {
    throw new Error(t("スナップショットのイベント情報が不正です。"));
  }

  return {
    slug: snapshot.slug,
    eventId: event.eventId,
  };
}

function getCallListResolveDialogTitle(dialog: {
  playerName: string;
  dqRequest?: FeatureMessage;
}) {
  if (dialog.dqRequest) {
    return t("DQ申請受信({p0})", { p0: dialog.playerName });
  }
  return t("呼び出し解決({p0})", { p0: dialog.playerName });
}

function App() {
  useLanguage();
  const [activeTab, setActiveTab] = useState<AppTab>("create");
  const localEventDraft = useLocalEventDraft();
  const selectTab = async (tab: AppTab) => {
    if (tab === "tournament" && activeTab !== "tournament") {
      if (!await localEventDraft.confirmDiscardParticipants("metadata")) return;
      localEventDraft.clearParticipants();
    }
    setActiveTab(tab);
  };
  const createSnapshotWithDraftConfirmation = async (create: () => Promise<void>) => {
    if (!await localEventDraft.confirmDiscardParticipants("creation")) return;
    await create();
  };
  const appVersion = useAppVersion();
  const [slug, setSlug] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedPhaseName, setSelectedPhaseName] = useState("");
  const [selectedPhasePoolKey, setSelectedPhasePoolKey] = useState("");
  const [activeMatchSetId, setActiveMatchSetId] = useState("");
  const [seedSwapEventId, setSeedSwapEventId] = useState("");
  const seedSwapSavingRef = useRef(false);
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
  const [hasUnreportedInitialSeedShuffle, setHasUnreportedInitialSeedShuffle] = useState(false);
  const [hasLocalInitialSeedShuffle, setHasLocalInitialSeedShuffle] = useState(false);
  const [seedSnapshotRefreshRequired, setSeedSnapshotRefreshRequired] = useState(false);
  const [isInitialSeedStatusLoading, setIsInitialSeedStatusLoading] = useState(false);
  const [seedStatusRefreshRevision, setSeedStatusRefreshRevision] = useState(0);
  const externalScoreReportSenderRef = useRef<
    ((report: ConfirmedExternalScoreReport) => Promise<boolean>) | null
  >(null);
  const handledExternalScoreReportsRef = useRef(new Set<string>());
  const confirmedDqRequestsRef = useRef<((report: ConfirmedExternalScoreReport) => Promise<void>) | null>(null);
  const handledExternalScoreSyncRequestsRef = useRef(new Set<string>());
  const [playerDisplayAliasSnapshot, setPlayerDisplayAliasSnapshot] = useState<{
    eventId: string;
    enabled: boolean;
    aliasesByEntrantId: Record<string, string>;
  } | null>(null);
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
    disableOwnCallActions,
    setDisableOwnCallActions,
    disableOtherCallActions,
    setDisableOtherCallActions,
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
    senderIdentityChanged,
    fillRandomSenderUserId,
    canSaveSenderProfile,
    saveSenderProfile,
    cancelSenderProfileChanges,
  } = useSenderProfile(setError, setMessage, activeTab);
  const { senderUsers, refreshSenderUsers } = useSenderUserList({
    senderProfile,
    communicationDisabled: disableLocalCommunication,
    onError: setError,
    onMessage: setMessage,
  });
  const {
    obsOverlayState,
    obsOverlayBusy,
    testOverlayEventAlias,
    setTestOverlayEventAlias,
    testOverlayRedName,
    setTestOverlayRedName,
    testOverlayBlueName,
    setTestOverlayBlueName,
    testOverlayRedItems,
    setTestOverlayRedItems,
    testOverlayBlueItems,
    setTestOverlayBlueItems,
    testOverlayRedWins,
    setTestOverlayRedWins,
    testOverlayBlueWins,
    setTestOverlayBlueWins,
    isTestOverlayActive,
    overlayPreviewWrapRef,
    overlayPreviewIframeRef,
    refreshObsOverlayState,
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
    savePhaseGroupScoreEditLock,
    savePhaseGroupExternalScoreBroadcast,
    savePhaseGroupExternalEditor,
    clearPhaseGroupExternalEditor,
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
    applyIncomingExternalScoreReport: persistIncomingExternalScoreReport,
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
    onConfirmedResult: async (report, savedWorkspace) => {
      try {
        await confirmedDqRequestsRef.current?.(report);
      } catch (dqError) {
        setError(t("試合結果は確定済みですが、DQ申請の処理済み保存に失敗しました: {p0}", { p0: String(dqError) }));
      }
      const confirmation = [...(savedWorkspace.localMeta.setConfirmationHistory ?? [])]
        .reverse()
        .find((item) => (
          item.eventId === report.eventId
          && item.phaseGroupId === report.phaseGroupId
          && item.setId === report.setId
        ));
      if (!confirmation) {
        throw new Error(t("確定情報のPool連番を取得できませんでした。"));
      }
      return externalScoreReportSenderRef.current
        ? externalScoreReportSenderRef.current({ ...report, sequence: confirmation.sequence })
        : false;
    },
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
    importItemList,
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
    perPage: STARTGG_FETCH_PER_PAGE,
    setCreateBusy,
    setBusy,
    setError,
    setMessage,
    onSnapshotCreated: async (identity) => {
      localEventDraft.clearParticipants();
      setWorkspace(null);
      markStartupAutoRestoreDone();
      setActiveTab("create");
      const items = await refreshSnapshotEventList();
      const createdItem = items
        ? findSnapshotEventByIdentity(items, identity.slug, identity.eventId)
        : null;
      if (!createdItem) {
        throw new Error(t("作成したスナップショットを一覧から特定できませんでした。"));
      }

      const eventLabel = createdItem.eventAlias?.trim()
        || `${createdItem.tournamentName} / ${createdItem.eventName}`;
      if (!await window.confirm(t(
        "スナップショットを作成しました。作成したスナップショットを操作対象として選択しますか？\n{p0}",
        { p0: eventLabel },
      ))) {
        return false;
      }

      await selectLocalSnapshotEventRef.current(createdItem);
      return true;
    },
  });
  const {
    token,
    setToken,
    createTournamentSlug,
    handleCreateTournamentSlugChange,
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
    createLocalEventSnapshot,
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
  const normalizedSeedSlug = toApiSlug(slug);
  const firstSeedPhase = [...(selectedEvent?.phases ?? [])]
    .filter((phase) => typeof phase.phaseOrder === "number")
    .sort((left, right) => (left.phaseOrder ?? 0) - (right.phaseOrder ?? 0))[0];
  const initialSeedStatusKey = firstSeedPhase && selectedEvent
    ? `${firstSeedPhase.phaseId}:${(selectedEvent.phaseGroups ?? [])
      .filter((group) => group.phaseId === firstSeedPhase.phaseId)
      .flatMap((group) => group.seeds ?? [])
      .map((seed) => `${seed.seedId}:${seed.seedNum ?? ""}`)
      .sort()
      .join("|")}`
    : "";
  useEffect(() => {
    let active = true;
    const eventId = selectedEvent?.eventId;
    if (!eventId || normalizedSeedSlug === "") {
      setHasUnreportedInitialSeedShuffle(false);
      setHasLocalInitialSeedShuffle(false);
      setSeedSnapshotRefreshRequired(false);
      setIsInitialSeedStatusLoading(false);
      return () => {
        active = false;
      };
    }

    setHasUnreportedInitialSeedShuffle(false);
    setHasLocalInitialSeedShuffle(false);
    setSeedSnapshotRefreshRequired(false);
    setIsInitialSeedStatusLoading(true);
    if (selectedEventMeta?.origin === "local") {
      void invoke<boolean>("has_local_initial_phase_seed_shuffle", {
        slug: normalizedSeedSlug,
        eventId,
      }).then((hasLocal) => {
        if (active) {
          setHasLocalInitialSeedShuffle(hasLocal);
          setIsInitialSeedStatusLoading(false);
        }
      }).catch((checkError) => {
        if (active) {
          setIsInitialSeedStatusLoading(false);
          setError(t("初期Seedの状態確認に失敗しました: {p0}", { p0: String(checkError) }));
        }
      });
      return () => {
        active = false;
      };
    }
    const remoteSeedStatus = token.trim() === ""
      ? Promise.resolve({ hasUnreported: false, hasLocal: false })
      : Promise.all([
        invoke<boolean>("has_unreported_initial_phase_seed_shuffle", {
          slug: normalizedSeedSlug,
          eventId,
        }),
        invoke<boolean>("has_local_initial_phase_seed_shuffle", {
          slug: normalizedSeedSlug,
          eventId,
        }),
      ]).then(([hasUnreported, hasLocal]) => ({ hasUnreported, hasLocal }));
    void Promise.all([
      remoteSeedStatus,
      invoke<boolean>("has_seed_update_awaiting_started_snapshot", {
        slug: normalizedSeedSlug,
        eventId,
      }),
    ])
      .then(([remoteStatus, refreshRequired]) => {
        if (active) {
          setHasUnreportedInitialSeedShuffle(remoteStatus.hasUnreported);
          setHasLocalInitialSeedShuffle(remoteStatus.hasLocal);
          setSeedSnapshotRefreshRequired(refreshRequired);
          setIsInitialSeedStatusLoading(false);
        }
      })
      .catch((checkError) => {
        if (active) {
          setIsInitialSeedStatusLoading(false);
          setError(t("初期Seedの状態確認に失敗しました: {p0}", { p0: String(checkError) }));
        }
      });

    return () => {
      active = false;
    };
  }, [
    initialSeedStatusKey,
    normalizedSeedSlug,
    selectedEvent?.eventId,
    selectedEventMeta?.origin,
    seedStatusRefreshRevision,
    snapshot?.updatedAt,
    token,
  ]);
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
    hasUnreportedSeedShuffle: hasUnreportedInitialSeedShuffle,
    seedStatusLoading: isInitialSeedStatusLoading,
    seedSnapshotRefreshRequired,
    setWorkspace,
    closeMatchDialog,
    setBusy,
    setError,
    setMessage,
    clearSnapshotProgress: () => setCreateSnapshotProgress(null),
    onSeedShuffleReported: () => {
      setHasUnreportedInitialSeedShuffle(false);
      setSeedSnapshotRefreshRequired(true);
      setSeedStatusRefreshRevision((revision) => revision + 1);
    },
  });

  const { selectedMessageScope, selectedEventMessageScope } = useMessageScopes({
    snapshot,
    selectedEvent,
    selectedPhaseName,
    selectedPhasePoolKey,
  });

  useLocalMessageService({
    senderProfile,
    senderProfileReady,
    communicationDisabled: disableLocalCommunication,
    onError: setError,
  });

  const {
    messages: bracketMessages,
    senderContacts,
    ready: bracketMessagesReady,
    markProcessed: markBracketMessageProcessed,
    discardDqRequest,
    sendExternalEditRequest,
    sendExternalScoreReport,
    sendExternalScoreReports,
    sendExternalScoreSyncRequest,
    replyToExternalEditRequest,
    replyToExternalScoreReport,
    canReplyToExternalEditRequest,
  } = useBracketMessages({
    scope: selectedEventMessageScope,
    senderProfile,
    communicationDisabled: disableLocalCommunication,
    onError: setError,
    onMessage: setMessage,
  });

  const {
    calls: playerCalls,
    displayMessages: playerCallMessages,
    refresh: refreshPlayerCalls,
    resolveCall,
    notifyPlaying,
    releasePlaying,
  } = usePlayerCalls({
    senderProfile,
    communicationDisabled: disableLocalCommunication,
    onError: setError,
  });

  const {
    dqDialog, dqPlayerIdDraft, setDqPlayerIdDraft, dqReasonDraft, setDqReasonDraft,
    dqDialogError, setDqDialogError, dqSubmitting, openDqRequestDialog,
    closeDqRequestDialog, submitDqRequest,
  } = usePlayerDqRequest({
    calls: playerCallMessages,
    senderProfile,
    communicationDisabled: disableLocalCommunication,
    onError: setError,
    onMessage: setMessage,
    stopCamera: stopDqCameraScan,
  });

  const pendingDqRequests = bracketMessages.filter(isDqRequestMessage);
  confirmedDqRequestsRef.current = async (report) => {
    const confirmedRequests = pendingDqRequests.filter((request) => isDqRequestConfirmed(request, report));
    for (const request of confirmedRequests) {
      await markBracketMessageProcessed(request.messageId);
    }
  };

  const [callListResolveDialog, setCallListResolveDialog] = useState<{
    messageId: string;
    playerName: string;
    playingCommunication?: string;
    dqRequest?: FeatureMessage;
  } | null>(null);
  const [callListResolveSubmitting, setCallListResolveSubmitting] = useState(false);
  const [dqRequestDiscarding, setDqRequestDiscarding] = useState(false);
  const pendingSetCallActionRef = useRef<SetCallAction | null>(null);
  const [setCallResolutionDialog, setSetCallResolutionDialog] =
    useState<SetCallResolutionDialogState | null>(null);
  const [setCallResolutionBusy, setSetCallResolutionBusy] = useState(false);
  const [callReactionDialog, setCallReactionDialog] = useState<{
    group: CallListEventGroup;
    player: CallListPlayer;
    playerName: string;
  } | null>(null);
  const [playingNoticeDialog, setPlayingNoticeDialog] = useState<{
    messageId: string;
    playerName: string;
  } | null>(null);
  const [playingMinutesDraft, setPlayingMinutesDraft] = useState("0");
  const [playingCommunicationDraft, setPlayingCommunicationDraft] = useState("");
  const [playingNoticeSubmitting, setPlayingNoticeSubmitting] = useState(false);
  const {
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
    pausePageRotation: pauseCallListPageRotation,
  } = useCallList({
    activeTab,
    calls: playerCallMessages,
    dqRequests: pendingDqRequests,
    senderUserId: senderProfile.senderUserId,
  });

  useEffect(() => {
    if (
      callReactionDialog
      && !playerCallMessages.some((message) => message.messageId === callReactionDialog.player.messageId)
    ) {
      setCallReactionDialog(null);
      pauseCallListPageRotation(false);
      setMessage(t("呼び出しは解決または更新されています。"));
    }
  }, [callReactionDialog, playerCallMessages, pauseCallListPageRotation]);

  function executeSetAction(action: () => void | Promise<void>) {
    void Promise.resolve().then(action).catch((error: unknown) => setError(String(error)));
  }

  function showSetCallResolutionDialog(
    set: SetSnapshot,
    operationLabel: string,
    ownCalls: FeatureMessage[],
    otherCalls: FeatureMessage[],
    continueAfterResolution: boolean,
  ) {
    setSetCallResolutionDialog({
      set,
      setLabel: set.fullRoundText.trim() || `Set ${set.setId}`,
      operationLabel,
      ownCalls,
      otherCalls,
      continueAfterResolution,
    });
  }

  function getSetCalls(set: SetSnapshot) {
    return getActiveCallsForSet(playerCalls, selectedEvent?.eventId ?? "", set.setId);
  }

  function splitSetCalls(calls: FeatureMessage[]) {
    const senderUserId = senderProfile.senderUserId.trim();
    const ownCalls = calls.filter((call) =>
      senderUserId !== "" && call.senderUserId.trim() === senderUserId
    );
    return {
      ownCalls,
      otherCalls: calls.filter((call) => !ownCalls.includes(call)),
    };
  }

  function runSetActionAfterCallResolution(
    set: SetSnapshot,
    operationLabel: string,
    run: () => void | Promise<void>,
  ) {
    const calls = getSetCalls(set);
    if (calls.length === 0) {
      executeSetAction(run);
      return;
    }

    const { ownCalls, otherCalls } = splitSetCalls(calls);
    pendingSetCallActionRef.current = ownCalls.length > 0 && otherCalls.length === 0
      ? {
        set,
        operationLabel,
        run,
      }
      : null;
    showSetCallResolutionDialog(
      set,
      operationLabel,
      ownCalls,
      otherCalls,
      pendingSetCallActionRef.current !== null,
    );
  }

  function requestSetCallResolution(set: SetSnapshot) {
    if (isCompletedSet(set)) {
      setMessage(t("確定済みSetの呼び出しは呼び出しリストから解決してください。"));
      return;
    }
    const calls = getSetCalls(set);
    if (calls.length === 0) {
      return;
    }
    const { ownCalls, otherCalls } = splitSetCalls(calls);
    pendingSetCallActionRef.current = null;
    showSetCallResolutionDialog(set, "呼び出しの解決", ownCalls, otherCalls, false);
  }

  function startOverlayOnlyWithoutActiveCalls(set: SetSnapshot, run: () => void | Promise<void>) {
    const calls = getSetCalls(set);
    if (calls.length > 0) {
      if (isCompletedSet(set)) {
        setMessage(t("確定済みSetの呼び出しは呼び出しリストから解決してください。"));
        return;
      }
      const { ownCalls, otherCalls } = splitSetCalls(calls);
      pendingSetCallActionRef.current = null;
      showSetCallResolutionDialog(set, "配信開始", ownCalls, otherCalls, false);
      return;
    }
    executeSetAction(run);
  }

  function closeSetCallResolutionDialog() {
    if (setCallResolutionBusy) {
      return;
    }
    pendingSetCallActionRef.current = null;
    setSetCallResolutionDialog(null);
  }

  async function resolveSetCalls() {
    const pending = pendingSetCallActionRef.current;
    const dialog = setCallResolutionDialog;
    if (!dialog || setCallResolutionBusy) {
      return;
    }
    setSetCallResolutionBusy(true);
    try {
      const currentCalls = await invoke<PlayerCall[]>("load_player_calls");
      const activeCalls = getActiveCallsForSet(
        currentCalls,
        selectedEvent?.eventId ?? "",
        dialog.set.setId,
      );
      const otherCalls = activeCalls.filter(
        (call) => call.senderUserId.trim() !== senderProfile.senderUserId.trim(),
      );
      const ownCalls = activeCalls.filter((call) => !otherCalls.includes(call));
      if (otherCalls.length > 0) {
        pendingSetCallActionRef.current = null;
        showSetCallResolutionDialog(
          dialog.set,
          dialog.operationLabel,
          ownCalls,
          otherCalls,
          false,
        );
        return;
      }

      if (ownCalls.length === 0) {
        pendingSetCallActionRef.current = null;
        setSetCallResolutionDialog(null);
        if (pending) {
          executeSetAction(pending.run);
        }
        return;
      }

      const visibleCallIds = new Set(playerCalls.map(({ message }) => message.messageId));
      if (ownCalls.some((call) => !visibleCallIds.has(call.messageId))) {
        showSetCallResolutionDialog(
          dialog.set,
          dialog.operationLabel,
          ownCalls,
          [],
          dialog.continueAfterResolution,
        );
        await refreshPlayerCalls();
        return;
      }

      for (const call of ownCalls) {
        if (!(await resolveCall(call.messageId))) {
          return;
        }
      }

      await refreshPlayerCalls();
      const remainingCalls = getActiveCallsForSet(
        await invoke<PlayerCall[]>("load_player_calls"),
        selectedEvent?.eventId ?? "",
        dialog.set.setId,
      );
      const remainingOtherCalls = remainingCalls.filter(
        (call) => call.senderUserId.trim() !== senderProfile.senderUserId.trim(),
      );
      const remainingOwnCalls = remainingCalls.filter((call) => !remainingOtherCalls.includes(call));
      if (remainingOtherCalls.length > 0 || remainingOwnCalls.length > 0) {
        if (remainingOtherCalls.length > 0) {
          pendingSetCallActionRef.current = null;
        }
        showSetCallResolutionDialog(
          dialog.set,
          dialog.operationLabel,
          remainingOwnCalls,
          remainingOtherCalls,
          pendingSetCallActionRef.current !== null,
        );
        await refreshPlayerCalls();
        return;
      }

      pendingSetCallActionRef.current = null;
      setSetCallResolutionDialog(null);
      if (pending) {
        executeSetAction(pending.run);
      }
    } catch (error) {
      setError(String(error));
    } finally {
      setSetCallResolutionBusy(false);
    }
  }

  function openCallListResolveDialog(group: CallListEventGroup, player: CallListPlayer) {
    setCallListResolveDialog({
      messageId: player.messageId,
      playerName: resolveCallListPlayerName(group, player),
      playingCommunication: player.playingCommunication,
      dqRequest: player.dqRequest ?? undefined,
    });
    pauseCallListPageRotation(true);
  }

  function openCallReactionDialog(group: CallListEventGroup, player: CallListPlayer) {
    setCallReactionDialog({
      group,
      player,
      playerName: resolveCallListPlayerName(group, player),
    });
    pauseCallListPageRotation(true);
  }

  function closeCallReactionDialog() {
    setCallReactionDialog(null);
    pauseCallListPageRotation(false);
  }

  function requestDqFromCallReaction() {
    if (!callReactionDialog) {
      return;
    }
    const messageId = callReactionDialog.player.messageId;
    closeCallReactionDialog();
    openDqRequestDialog(messageId);
  }

  function notifyPlayingFromCallReaction() {
    if (!callReactionDialog) {
      return;
    }
    const { group, player } = callReactionDialog;
    setCallReactionDialog(null);
    openPlayingNoticeDialog(group, player);
  }

  async function releasePlayingFromCallReaction() {
    if (!callReactionDialog) {
      return;
    }
    const messageId = callReactionDialog.player.messageId;
    closeCallReactionDialog();
    await handleReleasePlaying(messageId);
  }

  function openPlayingNoticeDialog(group: CallListEventGroup, player: CallListPlayer) {
    setPlayingNoticeDialog({
      messageId: player.messageId,
      playerName: resolveCallListPlayerName(group, player),
    });
    setPlayingMinutesDraft("0");
    setPlayingCommunicationDraft("");
    pauseCallListPageRotation(true);
  }

  function closePlayingNoticeDialog() {
    if (playingNoticeSubmitting) {
      return;
    }
    setPlayingNoticeDialog(null);
    pauseCallListPageRotation(false);
  }

  async function submitPlayingNotice() {
    if (!playingNoticeDialog || playingNoticeSubmitting) {
      return;
    }
    const minutes = Number(playingMinutesDraft.trim());
    if (
      playingMinutesDraft.trim() === ""
      || !Number.isSafeInteger(minutes)
      || minutes < 0
    ) {
      setError(t("終了見込み時間は0以上の整数で入力してください。"));
      return;
    }
    setPlayingNoticeSubmitting(true);
    try {
      const sent = await notifyPlaying(
        playingNoticeDialog.messageId,
        minutes,
        playingCommunicationDraft,
      );
      if (sent) {
        setMessage(minutes === 0
          ? t("終了時刻未定のプレイ中通知を送信しました。")
          : t("約{p0}分後に解除するプレイ中通知を送信しました。", { p0: minutes }));
        setPlayingNoticeDialog(null);
        pauseCallListPageRotation(false);
      }
    } finally {
      setPlayingNoticeSubmitting(false);
    }
  }

  async function handleReleasePlaying(messageId: string) {
    if (await releasePlaying(messageId)) {
      setMessage(t("プレイ中通知の解除を送信しました。"));
    }
  }

  function closeCallListResolveDialog() {
    if (callListResolveSubmitting || dqRequestDiscarding) {
      return;
    }
    setCallListResolveDialog(null);
    pauseCallListPageRotation(false);
  }

  async function confirmCallListResolution() {
    if (!callListResolveDialog || callListResolveSubmitting || dqRequestDiscarding) {
      return;
    }
    setCallListResolveSubmitting(true);
    try {
      const resolved = await resolveCall(callListResolveDialog.messageId);
      if (resolved) {
        setMessage(t("呼び出しの解決をブロードキャストで送信しました。"));
        setCallListResolveDialog(null);
        pauseCallListPageRotation(false);
      }
    } finally {
      setCallListResolveSubmitting(false);
    }
  }

  function acceptCallListDqRequest() {
    const request = callListResolveDialog?.dqRequest;
    if (!request || !processDqRequestFromMessage(request)) {
      return;
    }
    setCallListResolveDialog(null);
    pauseCallListPageRotation(false);
  }

  async function handleDiscardDqRequest(request: FeatureMessage) {
    if (dqRequestDiscarding || callListResolveSubmitting) {
      return;
    }
    setDqRequestDiscarding(true);
    try {
      if (await discardDqRequest(request)) {
        if (callListResolveDialog?.dqRequest?.messageId === request.messageId) {
          setCallListResolveDialog(null);
          pauseCallListPageRotation(false);
        }
      }
    } finally {
      setDqRequestDiscarding(false);
    }
  }

  const callListAliasSettingsByEvent = useMemo(() => {
    const settings = new Map<string, {
      useAliasName: boolean;
      aliasesByEntrantId: Record<string, string | undefined>;
    }>();
    const eventKey = (tournamentId: string, eventId: string) => `${tournamentId}::${eventId}`;

    for (const event of localSnapshotEvents) {
      settings.set(eventKey(event.tournamentId, event.eventId), {
        useAliasName: event.useAliasName === true,
        aliasesByEntrantId: event.entrantAliasesById ?? EMPTY_PLAYER_ALIAS_MAP,
      });
    }

    for (const event of workspace?.localMeta.events ?? []) {
      settings.set(eventKey(workspace?.localMeta.tournamentId ?? "", event.eventId), {
        useAliasName: event.eventManagement?.useAliasName === true,
        aliasesByEntrantId: Object.fromEntries(
          event.entrants.map((entrant) => [entrant.entrantId, entrant.aliasName]),
        ),
      });
    }

    return settings;
  }, [localSnapshotEvents, workspace]);

  function resolveCallListPlayerName(
    group: CallListEventGroup,
    player: CallListPlayer,
  ) {
    const aliasSettings = callListAliasSettingsByEvent.get(`${group.tournamentId}::${group.eventId}`);
    return resolveEntrantDisplayName(
      player.entrantName,
      aliasSettings?.aliasesByEntrantId[player.entrantId],
      aliasSettings?.useAliasName ?? false,
    );
  }

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
  refreshLocalSnapshotEventsRef.current = async () => {
    await refreshSnapshotEventList();
  };

  const selectedEventSettingKey = snapshot && selectedEvent
    ? buildEventManagementSettingKey(snapshot.slug, selectedEvent.eventId)
    : "";

  const {
    eventMgmtSettings,
    eventMgmtSettingsReady,
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
    useAliasName,
    setUseAliasName,
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
    seedSnapshotRefreshRequired,
    onSeedSnapshotRefreshCompleted: () => {
      setSeedSnapshotRefreshRequired(false);
      setSeedStatusRefreshRevision((revision) => revision + 1);
      bracketReport.dismissSeedSnapshotPrompt();
    },
    onSeedStateRefreshRequested: () => {
      setSeedStatusRefreshRevision((revision) => revision + 1);
    },
  });
  selectLocalSnapshotEventRef.current = selectLocalSnapshotEvent;

  async function exportShareFile(item: LocalSnapshotEventListItem) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const safeSlug = item.slug.replace(/^tournament\//, "").replace(/[^\w.-]+/g, "-");
      const safeEventId = item.eventId.replace(/[^\w.-]+/g, "-");
      const path = await saveFile({
        title: t("スナップショットをエクスポート"),
        defaultPath: `savakan-gg-${safeSlug}-${safeEventId}-snapshot.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) {
        return;
      }

      const archive = await exportTournamentShareArchive(item.slug, item.eventId);
      await writeSnapshotExportFile(path, JSON.stringify(archive, null, 2));
      setMessage(t("スナップショットをエクスポートしました: {p0} / {p1}", { p0: item.tournamentName, p1: item.eventName }));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function importShareFile(file: File) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const archiveJson = await file.text();
      const identity = readSnapshotArchiveIdentity(archiveJson);
      const currentItems = await fetchLocalSnapshotEvents();
      const existingEvent = findSnapshotEventByIdentity(
        currentItems,
        identity.slug,
        identity.eventId,
      );
      if (existingEvent && !await window.confirm(
        t("同一イベントのスナップショットが既にあります。\n{p0} / {p1}\n\nスナップショットとイベント別メタデータを上書きしますか？", { p0: existingEvent.tournamentName, p1: existingEvent.eventName }),
      )) {
        return;
      }

      const importedWorkspace = await importTournamentShareArchive(archiveJson);
      const importedEvent = importedWorkspace.snapshot.events[0];
      if (!importedEvent) {
        throw new Error(t("スナップショットにイベントがありません。"));
      }

      if (
        sameSnapshotEventKey(
          slug,
          selectedEventId,
          importedWorkspace.snapshot.slug,
          importedEvent.eventId,
        )
      ) {
        clearAllDrafts();
        closeMatchDialog();
        setWorkspace(null);
        setSelectedPhaseName("");
        setSelectedPhasePoolKey("");
      }
      await fetchLocalSnapshotEvents();
      setMessage(t("スナップショットをインポートしました: {p0} / {p1}", { p0: importedWorkspace.snapshot.name, p1: importedEvent.name }));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function exportItemList(itemList: (typeof itemLists)[number]) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const safeName = itemList.name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-") || "item-list";
      const path = await saveFile({
        title: t("アイテムリストをエクスポート"),
        defaultPath: `savakan-gg-${safeName}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) {
        return;
      }

      await writeSnapshotExportFile(path, JSON.stringify(itemList, null, 2));
      setMessage(t("アイテムリストをエクスポートしました: {p0}", { p0: itemList.name }));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function importItemListFile(file: File) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      importItemList(JSON.parse(await file.text()));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

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
  } = useSelectedEventEntrants(selectedEvent, selectedEventMeta?.entrants);

  const {
    selectedEntrantDraftSelectionsBySlot,
    selectedEntrantAliasName,
    setSelectedEntrantAliasName,
    selectedEntrantSkillTier,
    setSelectedEntrantSkillTier,
    selectedEntrantSkillTierErrors,
    canRestoreSelectedEntrantSkillTier,
    restoreSelectedEntrantSkillTier,
    selectedEntrantValidationErrors,
    addSelectedEntrantDraftSelection,
    removeSelectedEntrantDraftSelection,
    saveSelectedEntrantAliasName,
    saveSelectedEntrantSkillTier,
    saveSelectedEntrantSelections,
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

  const currentPlayerDisplayAliasSnapshot = selectedEvent
    && playerDisplayAliasSnapshot?.eventId === selectedEvent.eventId
    ? playerDisplayAliasSnapshot
    : null;
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
    exportPlayersAsCsv: exportUserCardPlayersAsCsv,
  } = useUserCards({
    tournamentId: snapshot?.tournamentId ?? null,
    tournamentName: snapshot?.name ?? "",
    eventId: selectedEvent?.eventId ?? null,
    eventName: selectedEvent?.name ?? "",
    eventAlias: selectedEventMeta?.eventAlias ?? null,
    entrants: selectedEventEntrants,
    aliasNamesByEntrantId: currentPlayerDisplayAliasSnapshot?.aliasesByEntrantId ?? EMPTY_PLAYER_ALIAS_MAP,
    useAliasName: currentPlayerDisplayAliasSnapshot?.enabled ?? false,
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
    [...playerCallMessages, ...senderContacts, ...senderUsers],
    normalizedSenderUserIdDraft,
    normalizedSenderNameDraft,
  ), [playerCallMessages, senderContacts, senderUsers, normalizedSenderNameDraft, normalizedSenderUserIdDraft]);

  const canBroadcastCallListSync = resolveCanBroadcastCallListSync(senderProfile, disableLocalCommunication);

  const {
    requestUnresolvedCallSyncBroadcast,
    initializeCallListDisplay,
  } = useCallSync({
    senderProfile,
    communicationDisabled: disableLocalCommunication,
    canBroadcastSync: canBroadcastCallListSync,
    shouldWarnIdentityChange: senderIdentityChanged,
    resetDisplay: resetCallListDisplay,
    refreshCalls: refreshPlayerCalls,
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
    setMessage(t("アイテムリストを削除しました。"));
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
  const selectedPoolScoreEditLocked = !selectedPhasePoolGroup?.phaseGroupId
    || !(selectedEventMeta?.scoreEditEnabledPhaseGroupIds ?? []).includes(selectedPhasePoolGroup.phaseGroupId);
  const lockedPoolGroupIdsForCurrentPhase = phaseScopedPoolGroups.flatMap((group) => {
    const phaseGroupId = group.phaseGroupId;
    if (!phaseGroupId || group.phaseName !== selectedPhaseName) {
      return [];
    }
    return (selectedEventMeta?.scoreEditEnabledPhaseGroupIds ?? []).includes(phaseGroupId)
      ? []
      : [phaseGroupId];
  });
  const selectedEventSetsById = useMemo(
    () => new Map((selectedEvent?.sets ?? []).map((set) => [set.setId, set])),
    [selectedEvent],
  );
  const selectedPoolExternalScoreBroadcastEnabled = Boolean(
    selectedPhasePoolGroup?.phaseGroupId
    && (selectedEventMeta?.externalScoreBroadcastPhaseGroupIds ?? [])
      .includes(selectedPhasePoolGroup.phaseGroupId),
  );
  const selectedPoolExternalEditor = selectedPhasePoolGroup?.phaseGroupId
    ? (selectedEventMeta?.externalEditors ?? []).find(
      (editor) => editor.phaseGroupId === selectedPhasePoolGroup.phaseGroupId,
    ) ?? null
    : null;

  externalScoreReportSenderRef.current = async (result) => {
    const phaseGroupId = result.phaseGroupId.trim();
    if (
      phaseGroupId === ""
      || selectedEventMeta?.eventId !== result.eventId
      || !(selectedEventMeta.scoreEditEnabledPhaseGroupIds ?? []).includes(phaseGroupId)
      || !(selectedEventMeta.externalScoreBroadcastPhaseGroupIds ?? []).includes(phaseGroupId)
    ) {
      return false;
    }
    if (!snapshot || snapshot.events.every((event) => event.eventId !== result.eventId)) {
      throw new Error(t("外部報告のイベントsnapshotを特定できません。"));
    }
    const report: ExternalScoreReport = {
      ...result,
      tournamentId: snapshot.tournamentId,
      slug: snapshot.slug,
    };
    await sendExternalScoreReport(report);
    return true;
  };

  async function changeSelectedPoolExternalScoreBroadcast(enabled: boolean) {
    const phaseGroupId = selectedPhasePoolGroup?.phaseGroupId;
    if (
      !snapshot
      || !selectedEvent
      || !phaseGroupId
      || selectedEventMeta?.eventId !== selectedEvent.eventId
      || !(selectedEventMeta.scoreEditEnabledPhaseGroupIds ?? []).includes(phaseGroupId)
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await savePhaseGroupExternalScoreBroadcast({
        slug: snapshot.slug,
        eventId: selectedEvent.eventId,
        eventName: selectedEvent.name,
        phaseGroupId,
        enabled,
      });
      setMessage(enabled
        ? t("スコア確定時の外部報告を有効にしました。")
        : t("スコア確定時の外部報告を無効にしました。"));
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  function canAcceptExternalEditRequest(message: Parameters<typeof getExternalEditRequest>[0]) {
    const request = getExternalEditRequest(message);
    if (
      !request
      || !canReplyToExternalEditRequest(message)
      || busy
      || !snapshot
      || !selectedEvent
      || request.tournamentId !== snapshot.tournamentId
      || request.slug !== snapshot.slug
      || request.eventId !== selectedEvent.eventId
      || message.senderUserId === senderProfile.senderUserId
    ) {
      return false;
    }
    const phaseGroupExists = (selectedEvent.phaseGroups ?? []).some(
      (group) => group.phaseGroupId === request.phaseGroupId
        && group.phaseName === request.phaseName,
    );
    const matchingSet = selectedEvent.sets.some(
      (set) => set.phaseGroupId === request.phaseGroupId
        && set.phaseName === request.phaseName
        && set.phaseGroupName === request.phaseGroupName,
    );
    return phaseGroupExists && matchingSet;
  }

  function getExternalScoreReportRejectionReason(message: Parameters<typeof getExternalScoreReport>[0]) {
    return getExternalReportRejectionReason(
      message, snapshot?.tournamentId ?? null, selectedEvent, selectedEventMeta, selectedEventSetsById,
    );
  }

  const selectedPoolExternalRequest = useMemo(() => getLatestPoolExternalRequest(
    bracketMessages, snapshot?.tournamentId ?? "", selectedEvent?.eventId ?? "",
    selectedPhasePoolGroup?.phaseGroupId ?? "",
  ), [bracketMessages, snapshot?.tournamentId, selectedEvent?.eventId, selectedPhasePoolGroup?.phaseGroupId]);

  const pendingExternalRequestPoolIds = useMemo(() => bracketMessages.flatMap((message) => {
    const request = getExternalEditRequest(message);
    return request && request.tournamentId === snapshot?.tournamentId && request.eventId === selectedEvent?.eventId
      ? [request.phaseGroupId] : [];
  }), [bracketMessages, snapshot?.tournamentId, selectedEvent?.eventId]);

  useEffect(() => {
    if (
      !bracketMessagesReady
      || busy
      || disableLocalCommunication
      || !senderProfileReady
    ) {
      return;
    }

    const pendingReports = bracketMessages.filter((item) =>
      getExternalScoreReportBatch(item) !== null
      && item.senderUserId !== senderProfile.senderUserId
      && !handledExternalScoreReportsRef.current.has(item.messageId),
    );
    if (pendingReports.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      for (const item of pendingReports) {
        if (cancelled) {
          return;
        }
        handledExternalScoreReportsRef.current.add(item.messageId);
        const batch = getExternalScoreReportBatch(item);
        if (!batch) {
          continue;
        }

        let rejectionReason = getExternalScoreReportRejectionReason(item);
        let deferredForSync = false;
        const firstReport = batch.reports[0];
        if (!rejectionReason && snapshot && selectedEvent && firstReport.sequence === undefined) {
          const set = selectedEventSetsById.get(firstReport.setId);
          if (!set) {
            rejectionReason = t("対象setをsnapshot内で特定できません。");
          } else {
            const applyError = await persistIncomingExternalScoreReport({
              set,
              senderName: item.senderName,
              senderUserId: item.senderUserId,
              result: {
                slug: snapshot.slug,
                eventId: selectedEvent.eventId,
                setId: set.setId,
                winnerId: firstReport.winnerId,
                confirmed: true,
                directWin: firstReport.directWin,
                slotScores: firstReport.slotScores,
              },
            });
            if (applyError) {
              rejectionReason = t("受信側で結果を適用できませんでした: {p0}", { p0: applyError });
            }
          }
        } else if (!rejectionReason && snapshot && selectedEvent && firstReport.sequence !== undefined) {
          let currentSequence = Math.max(
            0,
            ...(workspace?.localMeta.setConfirmationHistory ?? [])
              .filter((record) => (
                record.eventId === firstReport.eventId
                && record.phaseGroupId === firstReport.phaseGroupId
              ))
              .map((record) => record.sequence),
          );
          if (batch.resetPool) {
            if (firstReport.sequence !== 1) {
              rejectionReason = t("全同期の確定情報が先頭番号から始まっていません。");
            } else {
              try {
                await restoreWorkspaceGraph({
                  slug: snapshot.slug,
                  eventId: selectedEvent.eventId,
                  scope: "currentPool",
                  phaseGroupId: firstReport.phaseGroupId,
                  phaseName: firstReport.phaseName || null,
                });
                currentSequence = 0;
              } catch (restoreError) {
                rejectionReason = t("同期前のPool初期化に失敗しました: {p0}", { p0: String(restoreError) });
              }
            }
          }
          if (!rejectionReason && firstReport.sequence > currentSequence + 1) {
            try {
              await sendExternalScoreSyncRequest({
                tournamentId: firstReport.tournamentId,
                slug: firstReport.slug,
                eventId: firstReport.eventId,
                phaseGroupId: firstReport.phaseGroupId,
                fromSequence: currentSequence + 1,
                resetPool: false,
              }, item.senderIp);
              setMessage(t("外部報告 #{p0} からの再送を自動要求しました。", { p0: currentSequence + 1 }));
              deferredForSync = true;
            } catch (requestError) {
              rejectionReason = t("欠番の再送要求に失敗しました: {p0}", { p0: String(requestError) });
            }
          } else if (!rejectionReason) {
            for (const report of batch.reports) {
              if (report.sequence === undefined || report.sequence <= currentSequence) {
                continue;
              }
              if (report.sequence !== currentSequence + 1) {
                rejectionReason = t("確定情報 #{p0} が不足しています。", { p0: currentSequence + 1 });
                break;
              }
              const set = selectedEventSetsById.get(report.setId);
              if (!set) {
                rejectionReason = t("対象set {p0} をsnapshot内で特定できません。", { p0: report.setId });
                break;
              }
              const applyError = await persistIncomingExternalScoreReport({
                set,
                senderName: item.senderName,
                senderUserId: item.senderUserId,
                result: {
                  slug: snapshot.slug,
                  eventId: selectedEvent.eventId,
                  setId: set.setId,
                  winnerId: report.winnerId,
                  confirmed: true,
                  directWin: report.directWin,
                  slotScores: report.slotScores,
                },
              });
              if (applyError) {
                rejectionReason = t("確定情報 #{p0} を適用できませんでした: {p1}", { p0: report.sequence, p1: applyError });
                break;
              }
              currentSequence = report.sequence;
            }
          }
        }

        if (deferredForSync) {
          await markBracketMessageProcessed(item.messageId);
          continue;
        }
        await replyToExternalScoreReport(
          item,
          rejectionReason === null,
          rejectionReason ? t("理由: {p0}", { p0: rejectionReason }) : "",
        );
      }
    })().catch((processingError) => {
      setError(t("外部報告の処理に失敗しました: {p0}", { p0: String(processingError) }));
    });

    return () => {
      cancelled = true;
    };
  }, [
    busy,
    disableLocalCommunication,
    bracketMessages,
    bracketMessagesReady,
    markBracketMessageProcessed,
    persistIncomingExternalScoreReport,
    replyToExternalScoreReport,
    selectedEvent,
    selectedEventMeta,
    selectedEventSetsById,
    sendExternalScoreSyncRequest,
    senderProfile.senderUserId,
    senderProfileReady,
    snapshot,
    workspace,
    restoreWorkspaceGraph,
  ]);

  useEffect(() => {
    if (!bracketMessagesReady || disableLocalCommunication || !senderProfileReady || !snapshot) {
      return;
    }
    const requests = bracketMessages.filter((item) => (
      getExternalScoreSyncRequest(item) !== null
      && item.senderUserId !== senderProfile.senderUserId
      && !handledExternalScoreSyncRequestsRef.current.has(item.messageId)
    ));
    for (const item of requests) {
      handledExternalScoreSyncRequestsRef.current.add(item.messageId);
      const request = getExternalScoreSyncRequest(item);
      if (
        !request
        || request.tournamentId !== snapshot.tournamentId
        || request.eventId !== selectedEvent?.eventId
        || !isValidIpv4(item.senderIp)
      ) {
        continue;
      }
      const records = (workspace?.localMeta.setConfirmationHistory ?? [])
        .filter((record) => (
          record.eventId === request.eventId
          && record.phaseGroupId === request.phaseGroupId
          && record.sequence >= request.fromSequence
          && record.slotScores?.length === 2
        ))
        .sort((left, right) => left.sequence - right.sequence);
      if (records.length === 0) {
        setError(t("同期要求に返信できる確定情報がありません。"));
        continue;
      }
      const reports = records.flatMap((record): ExternalScoreReport[] => {
        const set = selectedEventSetsById.get(record.setId);
        if (!set) {
          return [];
        }
        return [{
          tournamentId: snapshot.tournamentId,
          slug: snapshot.slug,
          eventId: request.eventId,
          eventName: selectedEvent?.name ?? "",
          phaseName: set.phaseName ?? "",
          phaseGroupId: request.phaseGroupId,
          phaseGroupName: set.phaseGroupName ?? "",
          sequence: record.sequence,
          setId: record.setId,
          winnerId: record.winnerId,
          directWin: record.directWin ?? false,
          slotScores: record.slotScores ?? [],
        }];
      });
      void sendExternalScoreReports(reports, item.senderIp, request.resetPool)
        .then(() => markBracketMessageProcessed(item.messageId)).catch((sendError) => {
        setError(t("外部報告の同期返信に失敗しました: {p0}", { p0: String(sendError) }));
      });
    }
  }, [
    disableLocalCommunication,
    bracketMessages,
    bracketMessagesReady,
    markBracketMessageProcessed,
    selectedEvent,
    selectedEventSetsById,
    sendExternalScoreReports,
    senderProfile.senderUserId,
    senderProfileReady,
    snapshot,
    workspace,
  ]);

  async function acceptExternalEditRequest(message: Parameters<typeof getExternalEditRequest>[0]) {
    const request = getExternalEditRequest(message);
    if (!request || !canAcceptExternalEditRequest(message) || !snapshot || !selectedEvent) {
      setError(t("申請対象イベントが選択されていないか、申請情報が不正です。"));
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const scoreEditEnabledPhaseGroupIds = selectedEventMeta?.eventId === selectedEvent.eventId
        ? (selectedEventMeta.scoreEditEnabledPhaseGroupIds ?? [])
        : [];
      if (scoreEditEnabledPhaseGroupIds.includes(request.phaseGroupId)) {
        await savePhaseGroupScoreEditLock({
          slug: snapshot.slug,
          eventId: selectedEvent.eventId,
          eventName: selectedEvent.name,
          phaseGroupId: request.phaseGroupId,
          locked: true,
        });
      }
      await savePhaseGroupExternalEditor({
        slug: snapshot.slug,
        eventId: selectedEvent.eventId,
        eventName: selectedEvent.name,
        phaseGroupId: request.phaseGroupId,
        senderName: message.senderName,
        senderUserId: message.senderUserId,
      });
      if (!await replyToExternalEditRequest(message, true)) {
        return;
      }
      setSelectedPhaseName(request.phaseName);
      setSelectedPhasePoolKey(`id:${request.phaseGroupId}`);
      setActiveTab("bracket");
      try {
        await sendExternalScoreSyncRequest({
          tournamentId: request.tournamentId,
          slug: request.slug,
          eventId: request.eventId,
          phaseGroupId: request.phaseGroupId,
          fromSequence: 1,
          resetPool: true,
        }, message.senderIp);
        setMessage(t("外部報告申請を受理し、返信しました: {p0} / {p1}。Pool全同期を要求しました。", { p0: request.phaseName, p1: request.phaseGroupName }));
      } catch (syncError) {
        setMessage("");
        setError(t("外部報告申請は受理しましたが、Pool全同期の要求に失敗しました: {p0}", { p0: String(syncError) }));
      }
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function rejectExternalEditRequest(message: Parameters<typeof getExternalEditRequest>[0]) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await replyToExternalEditRequest(message, false);
    } finally {
      setBusy(false);
    }
  }

  async function requestExternalEditor() {
    if (
      !snapshot
      || !selectedEvent
      || !selectedPhasePoolGroup?.phaseGroupId
    ) {
      setError(t("外部報告申請を送信するイベント/プールを選択してください。"));
      return;
    }
    if (selectedPoolScoreEditLocked) {
      setError(t("外部報告申請を送信するには、このプールのスコア編集ロックを解除してください。"));
      return;
    }
    if (busy) {
      return;
    }
    if (!selectedEventMeta || selectedEvent.eventId !== selectedEventMeta.eventId) {
      setError(t("外部報告申請を送信するイベント/プールを選択してください。"));
      return;
    }
    setBusy(true);
    try {
      const requestSent = await sendExternalEditRequest({
      tournamentId: snapshot.tournamentId,
      slug: snapshot.slug,
      eventId: selectedEvent.eventId,
      eventName: selectedEvent.name,
      phaseName: selectedPhasePoolGroup.phaseName,
      phaseGroupId: selectedPhasePoolGroup.phaseGroupId,
      phaseGroupName: selectedPhasePoolGroup.phaseGroupName,
      phaseGroupDisplayIdentifier: selectedPhasePoolGroup.phaseGroupDisplayIdentifier,
    });
    if (!requestSent) {
      return;
    }
    await savePhaseGroupExternalScoreBroadcast({
      slug: snapshot.slug,
      eventId: selectedEvent.eventId,
      eventName: selectedEvent.name,
      phaseGroupId: selectedPhasePoolGroup.phaseGroupId,
      enabled: true,
    });
    setMessage(t("外部報告申請を送信し、確定スコアの外部報告を有効にしました。"));
    } catch (error) {
    setError(t("外部報告申請は送信済みですが、外部報告設定を保存できませんでした: {p0}", { p0: String(error) }));
    } finally {
    setBusy(false);
    }
  }

  async function changeSelectedPoolScoreEditLock(locked: boolean) {
    if (!selectedEvent || !selectedPhasePoolGroup?.phaseGroupId) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await savePhaseGroupScoreEditLock({
        slug: toApiSlug(slug),
        eventId: selectedEvent.eventId,
        eventName: selectedEvent.name,
        phaseGroupId: selectedPhasePoolGroup.phaseGroupId,
        locked,
      });
      setMessage(locked ? t("このプールのスコア編集をロックしました。") : t("このプールのスコア編集を許可しました。"));
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function clearSelectedPoolExternalEditor() {
    const phaseGroupId = selectedPhasePoolGroup?.phaseGroupId;
    if (
      !snapshot
      || !selectedEvent
      || !phaseGroupId
      || !selectedPoolScoreEditLocked
      || !selectedPoolExternalEditor
    ) {
      return;
    }

    if (!await window.confirm(t("外部報告者 {p0} ({p1}) をこのプールから解除しますか？", { p0: selectedPoolExternalEditor.senderName, p1: selectedPoolExternalEditor.senderUserId }))) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await clearPhaseGroupExternalEditor({
        slug: snapshot.slug,
        eventId: selectedEvent.eventId,
        eventName: selectedEvent.name,
        phaseGroupId,
      });
      setMessage(t("このプールの外部報告者を解除しました。"));
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function syncSelectedPoolExternalEditor() {
    const phaseGroupId = selectedPhasePoolGroup?.phaseGroupId;
    if (!snapshot || !selectedEvent || !phaseGroupId || !selectedPoolExternalEditor) {
      setError(t("同期対象の外部報告者またはPoolが選択されていません。"));
      return;
    }
    const reporterMessage = senderContacts.find((item) => (
      item.senderUserId === selectedPoolExternalEditor.senderUserId
      && isValidIpv4(item.senderIp)
    ));
    if (!reporterMessage) {
      setError(t("外部報告者の送信元IPがありません。外部報告者からの通信を受信後に同期してください。"));
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await sendExternalScoreSyncRequest({
        tournamentId: snapshot.tournamentId,
        slug: snapshot.slug,
        eventId: selectedEvent.eventId,
        phaseGroupId,
        fromSequence: 1,
        resetPool: true,
      }, reporterMessage.senderIp);
      setMessage(t("外部報告者にPoolの全同期を要求しました。返信受信後に自動適用します。"));
    } catch (syncError) {
      setError(String(syncError));
    } finally {
      setBusy(false);
    }
  }

  const {
    overlaySwitchConfirm,
    requestToggleActiveMatchOverlay,
    cancelOverlaySwitch,
    confirmOverlaySwitch,
    toggleActiveMatchOverlay,
    syncOverlayScoresForSet,
    refreshActivePlayerDisplay,
  } = useObsOverlaySetActions({
    selectedEvent,
    resolvedEventSetsById,
    aliasNamesByEntrantId: currentPlayerDisplayAliasSnapshot?.aliasesByEntrantId ?? EMPTY_PLAYER_ALIAS_MAP,
    useAliasName: currentPlayerDisplayAliasSnapshot?.enabled ?? false,
    eventAlias: selectedEventMeta?.eventAlias?.trim() ?? "",
    obsOverlayState,
    setDisplayCodeById,
    getSavedSide: getSetSlotSide,
    refreshObsOverlayState,
    toggleObsOverlaySet,
  });

  async function applyPlayerDisplaySnapshot(
    eventId: string,
    entrants: Array<{ entrantId: string; aliasName?: string }>,
    shouldUseAliasNames: boolean,
    showStatus: boolean,
  ) {
    const aliasesByEntrantId = Object.fromEntries(
      entrants.map((entrant) => [
        entrant.entrantId,
        entrant.aliasName ?? "",
      ]),
    );
    setPlayerDisplayAliasSnapshot({
      eventId,
      enabled: shouldUseAliasNames,
      aliasesByEntrantId,
    });
    const overlayUpdated = await refreshActivePlayerDisplay(aliasesByEntrantId, shouldUseAliasNames);
    if (showStatus && overlayUpdated) {
      setError("");
      setMessage(t("プレイヤー表示を更新しました。"));
    }
  }

  async function refreshPlayerDisplay() {
    if (!selectedEvent) {
      return;
    }
    setError("");
    setMessage("");
    try {
      await applyPlayerDisplaySnapshot(
        selectedEvent.eventId,
        selectedEventMeta?.entrants ?? [],
        useAliasName,
        true,
      );
    } catch (refreshError) {
      setError(String(refreshError));
    }
  }

  useEffect(() => {
    if (!eventMgmtSettingsReady || !selectedEvent) {
      return;
    }
    const aliasesByEntrant = selectedEventMeta?.eventId === selectedEvent.eventId
      ? selectedEventMeta.entrants
      : [];
    void applyPlayerDisplaySnapshot(
      selectedEvent.eventId,
      aliasesByEntrant,
      useAliasName,
      false,
    ).catch((refreshError: unknown) => setError(String(refreshError)));
  }, [eventMgmtSettingsReady, selectedEvent?.eventId, useAliasName]);

  async function restoreGraphAndRefreshDisplay(
    scope: "currentPool" | "lockedPoolsInCurrentPhase" | "all",
    phaseGroupId: string | null,
    phaseName: string | null,
    discardSeedShuffle = false,
  ) {
    const restoredResult = await restoreGraphFromSnapshot(scope, phaseGroupId, phaseName, discardSeedShuffle);
    if (!restoredResult) {
      return;
    }
    if (scope !== "all") {
      restoredResult.affectedSetIds.forEach(removeDraftsForSet);
    }
    const restoredWorkspace = restoredResult.workspace;
    const restoredEventMeta = restoredWorkspace.localMeta.events.find(
      (event) => event.eventId === selectedEventId,
    );
    if (!restoredEventMeta) {
      return;
    }
    const restoredUseAliasName = restoredEventMeta.eventManagement?.useAliasName ?? useAliasName;
    if (restoredUseAliasName !== useAliasName) {
      setUseAliasName(restoredUseAliasName);
    }
    try {
      await applyPlayerDisplaySnapshot(
        selectedEventId,
        restoredEventMeta.entrants,
        restoredUseAliasName,
        false,
      );
    } catch (refreshError) {
      setError(String(refreshError));
    }
  }

  const { sendCallMessageFromMatch } = useCallMessage({
    tournament: snapshot ? { tournamentId: snapshot.tournamentId, name: snapshot.name } : null,
    event: selectedEvent,
    activeMatch,
    eventAlias: selectedEventMeta?.eventAlias ?? "",
    senderProfile,
    communicationDisabled: disableLocalCommunication,
    setCallingEntrantId,
    refreshCalls: refreshPlayerCalls,
    onError: setError,
    onMessage: setMessage,
  });

  const {
    pendingResultBySetId,
    roundRobinBoardData,
    roundRobinEntrantNames,
    roundRobinStandings,
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
    aliasNamesByEntrantId: currentPlayerDisplayAliasSnapshot?.aliasesByEntrantId ?? EMPTY_PLAYER_ALIAS_MAP,
    useAliasName: currentPlayerDisplayAliasSnapshot?.enabled ?? false,
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

  const canShuffleSelectedInitialSeeds = selectedEvent !== null
    && canShuffleInitialPhaseSeeds(selectedEvent, selectedEventMeta?.origin === "local")
    && !(selectedEventMeta?.origin === "local"
      && workspace?.localMeta.setStreamStarts?.some((start) => start.eventId === selectedEvent.eventId))
    && !pendingSetResults.some((result) => result.eventId === selectedEvent.eventId)
    && !pendingGrandFinalResetResults.some((result) => result.eventId === selectedEvent.eventId);
  const seedSwapScope = `${snapshot?.slug ?? ""}:${selectedEvent?.eventId ?? ""}`;
  const canSwapSeeds = canShuffleSelectedInitialSeeds
    && directWinnerId === null
    && !Object.values(scoreDrafts).some((score) => score.trim() !== "")
    && !Object.values(interimScoreDraftsBySetId).some((scores) =>
      Object.values(scores).some((score) => score.trim() !== ""));
  const seedSwapActive = canSwapSeeds && seedSwapEventId === seedSwapScope;
  useEffect(() => {
    if (!canSwapSeeds || seedSwapEventId !== seedSwapScope) setSeedSwapEventId("");
  }, [canSwapSeeds, seedSwapScope, seedSwapEventId]);
  const seedSwapPositions = useMemo(
    () => canSwapSeeds && selectedEvent ? getInitialPhasePlayerPositions(selectedEvent) : [],
    [canSwapSeeds, selectedEvent],
  );
  const seedSwap: PlayerSeedSwapControls | undefined = selectedEvent ? {
    active: seedSwapActive,
    available: canSwapSeeds,
    busy,
    eventId: seedSwapScope,
    requiresSeedReport: selectedEventMeta?.origin !== "local",
    positions: seedSwapPositions,
    onToggle: () => {
      if (busy || !canSwapSeeds) return;
      closeMatchDialog();
      clearResultConfirmation();
      setSeedSwapEventId(seedSwapActive ? "" : seedSwapScope);
    },
    onSwap: (source, target) => void swapSelectedEventPlayers(source, target),
  } : undefined;

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
    interactionDisabled: seedSwapActive,
    busy,
    overlayBusy: obsOverlayBusy,
    stopOverlay: setObsOverlayFullyStopped,
    toggleOverlay: async (set) => {
      if (isOverlayActiveForSet(obsOverlayState, set.setId)) {
        await toggleActiveMatchOverlay(set);
        return;
      }
      startOverlayOnlyWithoutActiveCalls(set, () => toggleActiveMatchOverlay(set));
    },
  });

  const { processDqRequestFromMessage } = useDqRequestNavigation({
    event: selectedEvent,
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
    setScoreDrafts({});
    setDirectWinnerId(null);
  }

  async function saveLocalResultForMatch(
    confirmed: boolean,
    confirmation?: ResultConfirmationState,
  ) {
    if (seedSwapActive) {
      setError(t("入替モード中はスコアを編集できません。"));
      return;
    }
    const set = confirmation?.match ?? activeMatch;
    if (!set) {
      return;
    }

    runSetActionAfterCallResolution(set, confirmed ? t("結果確定") : t("結果更新"), () =>
      persistMatchResult({
        slug: toApiSlug(slug),
        event: selectedEvent,
        set,
        confirmed,
        directWinnerId: confirmation ? confirmation.directWinnerId : directWinnerId,
        scoreDrafts: confirmation?.scoreDrafts ?? scoreDrafts,
        sideDrafts: activeMatchSideDrafts,
      }),
    );
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
      label: createSnapshotProgressLabel || t("処理中..."),
      percent: createSnapshotProgressPercent,
      valueLabel: createSnapshotProgress && createSnapshotProgress.totalSets !== null
        ? `${Math.round(createSnapshotProgressPercent)}%`
        : undefined,
      ariaLabel: t("スナップショット作成の進捗"),
    });
  }
  if (bracketReport.progress) {
    statusProgresses.push({
      id: "bracket-report",
      label: bracketReport.progressLabel,
      percent: bracketReport.progressPercent,
      valueLabel: `${Math.round(bracketReport.progressPercent)}%`,
      ariaLabel: t("結果報告の進捗"),
    });
  }
  if (shouldShowBracketSnapshotRefreshProgress && createSnapshotProgress) {
    statusProgresses.push({
      id: "bracket-snapshot-refresh",
      label: t("報告後スナップショット更新: {p0}", { p0: createSnapshotProgressLabel }),
      percent: createSnapshotProgressPercent,
      valueLabel: createSnapshotProgress.totalSets !== null
        ? `${Math.round(createSnapshotProgressPercent)}%`
        : undefined,
      ariaLabel: t("報告後スナップショット更新の進捗"),
    });
  }

  const activeMatchCalls = activeMatch && selectedEvent
    ? getActiveCallsForSet(playerCalls, selectedEvent.eventId, activeMatch.setId)
    : [];
  const activeMatchCalledEntrantIds = activeMatchCalls.map((call) =>
    extractMetaString(call.messageMeta, "callEntrantId")
  );
  const { ownCalls: activeMatchOwnCalls, otherCalls: activeMatchOtherCalls } =
    splitSetCalls(activeMatchCalls);
  const canRestoreSelectedInitialSeeds = canShuffleSelectedInitialSeeds
    && hasLocalInitialSeedShuffle;

  async function swapSelectedEventPlayers(source: string, target: string) {
    if (busy || seedSwapSavingRef.current) return;
    if (!selectedEvent || !seedSwapActive || !canSwapSeeds) {
      setError(t("試合が開始済み、または入替モードが無効です。"));
      return;
    }
    seedSwapSavingRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const seedMapping = buildInitialPhaseSeedSwap(selectedEvent, source, target);
      const result = await invoke<TournamentWorkspace>("shuffle_initial_phase_seeds", {
        input: { slug: snapshot?.slug ?? slug, eventId: selectedEvent.eventId, seedMapping },
      });
      clearAllDrafts();
      setWorkspace(result);
      setSeedStatusRefreshRevision((revision) => revision + 1);
      setMessage(selectedEventMeta?.origin === "local"
        ? t("プレイヤーの配置を入れ替えました。")
        : t("プレイヤーの配置を入れ替えました。入替モードをOFFにし、結果報告でSeed変更をstart.ggへ反映してください。"));
    } catch (swapError) {
      setError(String(swapError));
    } finally {
      seedSwapSavingRef.current = false;
      setBusy(false);
    }
  }

  async function shuffleSelectedEventInitialSeeds() {
    if (!selectedEvent || !canShuffleSelectedInitialSeeds) {
      setError(t("試合が開始済み、またはシャッフル可能なSeedがありません。"));
      return;
    }
    if (!await window.confirm(
      selectedEventMeta?.origin === "local"
        ? t("最初のPhaseのSeed順をローカルでシャッフルします。Seed設定対象の全PhaseGroupが開始前であることを確認してください。続行しますか？")
        : t("最初のPhaseのSeed順をローカルでシャッフルします。Seed設定対象の全PhaseGroupがReset済みであることを確認し、後の報告操作でこのSeed順をstart.ggへ反映します。続行しますか？"),
    )) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const seedMapping = buildInitialPhaseSeedMapping(
        selectedEvent,
        Math.random,
        selectedEventMeta?.origin === "local",
        new Map((selectedEventMeta?.entrants ?? []).map((entrant) => [entrant.entrantId, entrant.skill])),
      );
      const result = await invoke<TournamentWorkspace>("shuffle_initial_phase_seeds", {
        input: {
          slug: snapshot?.slug ?? slug,
          eventId: selectedEvent.eventId,
          seedMapping,
        },
      });
      setWorkspace(result);
      setSeedStatusRefreshRevision((revision) => revision + 1);
      setMessage(t("初期PhaseのSeedをシャッフルしました。ブラケットを更新しました。"));
    } catch (shuffleError) {
      setError(String(shuffleError));
    } finally {
      setBusy(false);
    }
  }

  async function restoreSelectedEventInitialSeeds() {
    if (!selectedEvent || !canRestoreSelectedInitialSeeds) {
      setError(t("スナップショット時のSeed順へ戻せない状態です。"));
      return;
    }
    if (!await window.confirm(
      selectedEventMeta?.origin === "local"
        ? t("スナップショット取得時の初期Phase Seed順に戻します。対象Poolが開始前であることを確認してください。続行しますか？")
        : t("スナップショット取得時の初期Phase Seed順に戻します。Reset済みの対象Poolを確認後、報告操作でこのSeed順をstart.ggへ反映します。続行しますか？"),
    )) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await invoke<TournamentWorkspace>("restore_initial_phase_seeds", {
        slug: snapshot?.slug ?? slug,
        eventId: selectedEvent.eventId,
      });
      setWorkspace(result);
      setSeedStatusRefreshRevision((revision) => revision + 1);
      setMessage(t("初期PhaseのSeedをスナップショット取得時の順序に戻しました。ブラケットを更新しました。"));
    } catch (restoreError) {
      setError(String(restoreError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      appVersion={appVersion}
      activeTab={activeTab}
      onTabSelect={(tab) => void selectTab(tab)}
      otherDeviceCallCount={unresolvedCallRootCounts.otherDeviceCalls}
      receivedPlayingCount={unresolvedCallRootCounts.receivedPlaying}
      pendingDqRequestCount={pendingDqRequests.length}
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
              registration={localEventDraft.registration}
              onRegistrationChange={localEventDraft.setRegistration}
              itemLists={itemLists}
              token={token}
              onTokenChange={setToken}
              createTournamentSlug={createTournamentSlug}
              onCreateTournamentSlugChange={handleCreateTournamentSlugChange}
              createBusy={createBusy}
              canLoadPreview={toApiSlug(createTournamentSlug) !== "" && token.trim() !== ""}
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
              canCreateSnapshot={token.trim() !== "" && toApiSlug(createTournamentSlug) !== "" && createSelectedEventId !== "" && toEventApiSlug(createTournamentSlug, createPreview?.events.find((event) => event.eventId === createSelectedEventId)?.eventSlug ?? "") !== ""}
              onCreateSnapshot={() => void createSnapshotWithDraftConfirmation(createEventSnapshotBySlug)}
              senderUserId={senderProfile.senderUserId}
              canCreateLocalSnapshot={/^\d{8}$/.test(senderProfile.senderUserId.trim())}
              onCreateLocalSnapshot={(input) => void createSnapshotWithDraftConfirmation(() => createLocalEventSnapshot(input))}
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
              onImportShareFile={(file) => void importShareFile(file)}
              onExportShareFile={(item) => void exportShareFile(item)}
            />
          </>
        )}

        {activeTab === "tournament" && (
          <EventSetting
            seedSwap={seedSwap}
            event={{
              slug: toApiSlug(slug),
              eventId: selectedEvent?.eventId ?? "",
              hasSelectedEvent: Boolean(selectedEvent),
              tournamentName: snapshot?.name ?? "-",
              eventName: selectedEvent?.name ?? "",
              busy,
              canUpdateSnapshot: toApiSlug(slug) !== "" && selectedEventMeta?.origin !== "local",
              eventAliasDraft,
              initialSeedPhaseName: selectedEvent?.phases
                ?.slice()
                .sort((left, right) => (left.phaseOrder ?? Number.MAX_SAFE_INTEGER) - (right.phaseOrder ?? Number.MAX_SAFE_INTEGER))[0]
                ?.name ?? "",
              initialSeedEntrantCount: selectedEvent
                ? new Set((selectedEvent.phaseGroups ?? [])
                  .filter((group) => group.phaseId === selectedEvent.phases
                    ?.slice()
                    .sort((left, right) => (left.phaseOrder ?? Number.MAX_SAFE_INTEGER) - (right.phaseOrder ?? Number.MAX_SAFE_INTEGER))[0]
                    ?.phaseId)
                  .flatMap((group) => group.seeds ?? [])
                  .map((seed) => seed.entrantId)
                  .filter((entrantId): entrantId is string => Boolean(entrantId))).size
                : 0,
              canShuffleInitialSeeds: !seedSwapActive && canShuffleSelectedInitialSeeds,
              canRestoreInitialSeeds: !seedSwapActive && canRestoreSelectedInitialSeeds,
              isLocalEvent: selectedEventMeta?.origin === "local",
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
              useAliasName,
            }}
            playerMeta={{
              selectedEventEntrants,
              selectedEventMetaEntrantCount: selectedEventMeta?.entrants.length ?? 0,
              selectedEntrantId: selectedTournamentEntrant?.entrantId ?? "",
              selectedEntrantName: selectedTournamentEntrant?.entrantName ?? "",
              selectedEntrantAliasName,
              selectedEntrantSkillTier,
              skillTierErrors: selectedEntrantSkillTierErrors,
              canRestoreSkillTier: canRestoreSelectedEntrantSkillTier,
              configuredCategorySlots,
              selectedCategoryUsageList,
              draftSelectionsBySlot: selectedEntrantDraftSelectionsBySlot,
              validationErrors: selectedEntrantValidationErrors,
              canSavePlayerMeta: !busy && toApiSlug(slug) !== "",
            }}
            actions={{
              onUpdateSnapshot: () => void updateSnapshot(),
              onShuffleInitialSeeds: () => void shuffleSelectedEventInitialSeeds(),
              onRestoreInitialSeeds: () => void restoreSelectedEventInitialSeeds(),
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
              onUseAliasNameChange: setUseAliasName,
              onRefreshPlayerDisplay: () => void refreshPlayerDisplay(),
              onSaveEventManagementSetting: saveEventManagementSetting,
              onSelectEntrant: setSelectedTournamentEntrantId,
              onAddDraftSelection: addSelectedEntrantDraftSelection,
              onRemoveDraftSelection: removeSelectedEntrantDraftSelection,
              onSavePlayerAliasName: saveSelectedEntrantAliasName,
              onSavePlayerSkillTier: saveSelectedEntrantSkillTier,
              onRestorePlayerSkillTier: restoreSelectedEntrantSkillTier,
              onSkillTierChange: setSelectedEntrantSkillTier,
              onSavePlayerSelections: saveSelectedEntrantSelections,
              onEntrantAliasNameChange: setSelectedEntrantAliasName,
            }}
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
            setMessage(t("呼び出しリストを全未解決表示に戻しました。"));
          }}
          resolvePhaseName={(eventId, phaseName) => resolveCallPhaseName(
            snapshot?.events.find((event) => event.eventId === eventId) ?? null,
            phaseName,
            null,
          )}
          pageSwitchedAtMs={callListPageSwitchedAtMs}
          colorToRedSeconds={callListColorToRedSeconds}
          resolvePlayerName={resolveCallListPlayerName}
          onResolveOwnCall={openCallListResolveDialog}
          onOpenCallReaction={openCallReactionDialog}
          communicationDisabled={disableLocalCommunication}
          disableOwnCallActions={disableOwnCallActions}
          disableOtherCallActions={disableOtherCallActions}
        />
      )}

      {callReactionDialog && (() => {
        const call = playerCallMessages.find(
          (message) => message.messageId === callReactionDialog.player.messageId,
        );
        return call ? (
          <CallReactionDialog
            playerName={callReactionDialog.playerName}
            senderName={call.senderName}
            senderUserId={call.senderUserId}
            senderIp={call.senderIp}
            isPlaying={call.messageMeta?.callPlayerPlaying === true}
            playingUntil={typeof call.messageMeta?.callPlayerPlayingUntil === "string"
              ? call.messageMeta.callPlayerPlayingUntil
              : ""}
            playingCommunication={typeof call.messageMeta?.callPlayerPlayingCommunication === "string"
              ? call.messageMeta.callPlayerPlayingCommunication
              : ""}
            playingByMe={
              call.messageMeta?.callPlayerPlayingSenderUserId === senderProfile.senderUserId
            }
            referenceMs={callListPageSwitchedAtMs}
            disabled={disableLocalCommunication || disableOtherCallActions}
            onRequestDq={requestDqFromCallReaction}
            onNotifyPlaying={notifyPlayingFromCallReaction}
            onReleasePlaying={() => void releasePlayingFromCallReaction()}
            onClose={closeCallReactionDialog}
          />
        ) : null;
      })()}

      {callListResolveDialog && (
        <div className="dialog-backdrop" onClick={closeCallListResolveDialog}>
          <section
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label={getCallListResolveDialogTitle(callListResolveDialog)}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>{getCallListResolveDialogTitle(callListResolveDialog)}</h3>
              </div>
            </div>
            <div className="dialog-body">
              <CallListPlayingCommunication
                communication={callListResolveDialog.playingCommunication ?? ""}
              />
              {callListResolveDialog.dqRequest && (
                <div className="dialog-summary-box" style={{ marginTop: "0.75rem" }}>
                  <p className="meta">
                    {t("申請元: ")}{callListResolveDialog.dqRequest.senderName}
                    {" / ID: "}{callListResolveDialog.dqRequest.senderUserId}
                    {" / IP: "}{callListResolveDialog.dqRequest.senderIp}
                  </p>
                  <p className="meta">
                    {t("申請理由: ")}{extractMetaString(callListResolveDialog.dqRequest.messageMeta, "dqReason") || t("（理由なし）")}
                  </p>
                </div>
              )}
            </div>
            <div className="dialog-actions dialog-actions-split" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="ghost"
                disabled={callListResolveSubmitting || dqRequestDiscarding}
                onClick={closeCallListResolveDialog}
              >
                {t("キャンセル")}</button>
              {callListResolveDialog.dqRequest && (
                <button
                  type="button"
                  className="ghost"
                  disabled={callListResolveSubmitting || dqRequestDiscarding}
                  onClick={() => {
                    if (callListResolveDialog.dqRequest) {
                      void handleDiscardDqRequest(callListResolveDialog.dqRequest);
                    }
                  }}
                >
                  {dqRequestDiscarding ? t("破棄中...") : t("DQ申請を破棄")}
                </button>
              )}
              {callListResolveDialog.dqRequest && (
                <button
                  type="button"
                  disabled={callListResolveSubmitting || dqRequestDiscarding}
                  onClick={acceptCallListDqRequest}
                >
                  {t("DQ申請受理")}</button>
              )}
              <button
                type="button"
                disabled={callListResolveSubmitting || dqRequestDiscarding}
                onClick={() => void confirmCallListResolution()}
              >
                {callListResolveSubmitting ? t("解決中...") : t("呼び出しを解決")}
              </button>
            </div>
          </section>
        </div>
      )}

      {playingNoticeDialog && (
        <div className="dialog-backdrop" onClick={closePlayingNoticeDialog}>
          <section
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("プレイ中通知({p0})", { p0: playingNoticeDialog.playerName })}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <h3>{t("プレイ中通知({p0})", { p0: playingNoticeDialog.playerName })}</h3>
            </div>
            <div className="dialog-body">
              <label className="field" style={{ marginTop: "0.75rem" }}>
                <span>{t("終了見込み時間（分）")}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={playingMinutesDraft}
                  onChange={(event) => setPlayingMinutesDraft(event.currentTarget.value)}
                  disabled={playingNoticeSubmitting}
                  aria-label={t("終了見込み時間（分）")}
                />
              </label>
              <label className="field">
                <span>{t("通信欄")}</span>
                <textarea
                  value={playingCommunicationDraft}
                  onChange={(event) => setPlayingCommunicationDraft(event.currentTarget.value)}
                  disabled={playingNoticeSubmitting}
                  rows={3}
                  aria-label={t("通信欄")}
                  placeholder={t("相手に伝える内容を入力")}
                />
              </label>
              <p className="meta">{t("0を指定すると解除予定なしになります。1以上の場合は指定時間後に自動で解除を通知します。")}</p>
            </div>
            <div className="dialog-actions dialog-actions-split" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="ghost"
                disabled={playingNoticeSubmitting}
                onClick={closePlayingNoticeDialog}
              >
                {t("キャンセル")}</button>
              <button
                type="button"
                disabled={playingNoticeSubmitting}
                onClick={() => void submitPlayingNotice()}
              >
                {playingNoticeSubmitting ? t("送信中...") : t("プレイ中を通知")}
              </button>
            </div>
          </section>
        </div>
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
            freeTextSources={(workspace?.localMeta.events ?? []).flatMap((event) =>
              (event.eventManagement?.itemListSnapshots ?? []).flatMap((list, slotIndex) =>
                list.id === "__free_text__" ? [{
                  id: `${event.eventId}:${slotIndex}`,
                  label: `${event.eventName} / ${t("カテゴリ{value1}", { value1: slotIndex + 1 })}`,
                  values: event.entrants.flatMap((entrant) => entrant.categorySelections?.[slotIndex] ?? []),
                }] : []))}
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
            onDeleteItemList={async (itemList) => {
              if (await window.confirm(t("「{p0}」を削除しますか？", { p0: itemList.name }))) {
                await deleteItemList(itemList.id);
              }
            }}
            onImportItemList={(file) => void importItemListFile(file)}
            onExportItemList={(itemList) => void exportItemList(itemList)}
            busy={busy}
          />
      )}

      {activeTab === "overlay" && (
        <OverlayControl
          overlayState={obsOverlayState}
          isTestOverlayActive={isTestOverlayActive}
          activeSetLabel={activeObsOverlaySet?.set.fullRoundText ?? null}
          busy={obsOverlayBusy}
          testEventAlias={testOverlayEventAlias}
          testRedName={testOverlayRedName}
          testBlueName={testOverlayBlueName}
          testRedItems={testOverlayRedItems}
          testBlueItems={testOverlayBlueItems}
          testRedWins={testOverlayRedWins}
          testBlueWins={testOverlayBlueWins}
          previewWrapRef={overlayPreviewWrapRef}
          previewIframeRef={overlayPreviewIframeRef}
          onOpenUrl={(url) => {
            void openUrl(url).catch((err) => {
              setError(t("URLをブラウザで開けませんでした: {p0}", { p0: String(err) }));
            });
          }}
          onTestRedNameChange={setTestOverlayRedName}
          onTestEventAliasChange={setTestOverlayEventAlias}
          onTestBlueNameChange={setTestOverlayBlueName}
          onTestRedItemsChange={setTestOverlayRedItems}
          onTestBlueItemsChange={setTestOverlayBlueItems}
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
                ? t("ローカル通信を無効化しました。メッセージ機能とプレイヤーリストは閲覧のみになります。")
                : t("ローカル通信を有効化しました。メッセージ機能とプレイヤーリストを再開できます。"));
            }}
            senderNameDraft={senderNameDraft}
            onSenderNameChange={setSenderNameDraft}
            senderUserIdDraft={senderUserIdDraft}
            onSenderUserIdChange={changeSenderUserIdDraft}
            networkCandidates={senderNetworkCandidateOptions}
            selectedNetworkCandidateKey={selectedSenderNetworkCandidateKey}
            onNetworkCandidateChange={setSelectedSenderNetworkCandidateKey}
            networkCandidatesLoading={senderNetworkCandidatesLoading}
            senderSettingsStatus={resolveSenderSettingsStatus({
              senderIdCollision,
              senderIdentityChanged,
              hasSelectedNetworkDevice: hasSelectedSenderNetworkDevice,
              bindIp: normalizedSenderBindIpDraft,
              broadcastSubnetMask: normalizedBroadcastSubnetMaskDraft,
            })}
            onRefreshNetworkCandidates={() => void refreshLocalNetworkSettingsCandidates(true)}
            onRandomizeSenderUserId={() => fillRandomSenderUserId(
              [...playerCallMessages, ...senderContacts, ...senderUsers].map((item) => item.senderUserId),
            )}
            onOpenSenderUserList={() => setActiveTab("sender-users")}
            onSaveSenderProfile={() => void saveSenderProfile(senderIdCollision)}
            onCancelSenderProfile={cancelSenderProfileChanges}
            canSaveSenderProfile={canSaveSenderProfile(senderIdCollision)}
            canCancelSenderProfile={senderProfileReady}
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
            hasCallListMessages={hasCallListMessages}
            onClearCallList={initializeCallListDisplay}
            disableOwnCallActions={disableOwnCallActions}
            onDisableOwnCallActionsChange={setDisableOwnCallActions}
            disableOtherCallActions={disableOtherCallActions}
            onDisableOtherCallActionsChange={setDisableOtherCallActions}
          />
        )}

        {activeTab === "sender-users" && (
          <SenderUserList
            localUser={{
              senderName: normalizedSenderNameDraft,
              senderUserId: normalizedSenderUserIdDraft,
              senderIp: normalizedSenderBindIpDraft,
            }}
            senderUsers={senderUsers}
            senderUserIdDraft={senderUserIdDraft}
            onSenderUserIdChange={changeSenderUserIdDraft}
            onRandomizeSenderUserId={() => fillRandomSenderUserId(
              [...playerCallMessages, ...senderContacts, ...senderUsers].map((item) => item.senderUserId),
            )}
            onSaveSenderProfile={() => void saveSenderProfile(senderIdCollision)}
            canSaveSenderProfile={canSaveSenderProfile(senderIdCollision)}
            onRefresh={() => void refreshSenderUsers()}
            onBackToSettings={() => setActiveTab("settings")}
          />
        )}

        {activeTab === "users" && (
          <PlayerListInfo
            disableLocalCommunication={disableLocalCommunication}
            userCardBusy={userCardBusy}
            hasSelectedEvent={Boolean(snapshot && selectedEvent)}
            selectedEventLabel={selectedEventMeta?.eventAlias?.trim() || t("未設定")}
            players={userCardPlayers}
            selectedPlayerIds={selectedUserCardPlayerIds}
            selectedPlayer={selectedUserCardPlayer}
            selectedPlayerPreviewUrl={selectedUserCardPreviewUrl}
            onSaveSelectedCard={() => void saveSelectedUserCardImage()}
            onExportA4Sheet={() => void exportSelectedPlayerCardsAsA4Sheet()}
            onExportCsv={exportUserCardPlayersAsCsv}
            onSelectAllPlayers={selectAllUserCardPlayers}
            onClearPlayerSelection={clearAllUserCardPlayersSelection}
            onSelectPlayer={handleUserCardPlayerSelect}
          />
      )}

        {activeTab === "bracket" && (
        <>
          <BracketTab
            seedSwap={seedSwap}
            busy={busy}
            draftPendingCount={draftPendingCount}
            confirmedReportableCount={confirmedReportableCount}
            hasUnreportedSeedShuffle={hasUnreportedInitialSeedShuffle}
            seedStatusLoading={isInitialSeedStatusLoading}
            seedSnapshotRefreshRequired={seedSnapshotRefreshRequired}
            hasSnapshot={Boolean(snapshot)}
            tournamentName={snapshot?.name ?? "-"}
            eventAlias={selectedEventMeta?.eventAlias ?? ""}
            eventName={selectedEvent?.name ?? "-"}
            phaseNames={phaseNames}
            selectedPhaseName={selectedPhaseName}
            onPhaseNameChange={setSelectedPhaseName}
            phaseScopedPoolGroups={phaseScopedPoolGroups}
            selectedPhasePoolGroup={selectedPhasePoolGroup}
            selectedPoolScoreEditLocked={seedSwapActive || selectedPoolScoreEditLocked}
            selectedPoolExternalScoreBroadcastEnabled={selectedPoolExternalScoreBroadcastEnabled}
            externalEditor={selectedPoolExternalEditor}
            externalRequest={selectedPoolExternalRequest}
            dqRequests={pendingDqRequests.filter((request) =>
              extractMetaString(request.messageMeta, "scopeEventId") === selectedEvent?.eventId
              && extractMetaString(request.messageMeta, "phaseGroupId") === selectedPhasePoolGroup?.phaseGroupId)}
            pendingDqPoolIds={pendingDqRequests
              .filter((request) => extractMetaString(request.messageMeta, "scopeEventId") === selectedEvent?.eventId)
              .map((request) => extractMetaString(request.messageMeta, "phaseGroupId"))}
            onProcessDqRequest={processDqRequestFromMessage}
            onDiscardDqRequest={(request) => void handleDiscardDqRequest(request)}
            dqRequestBusy={dqRequestDiscarding || callListResolveSubmitting}
            pendingExternalRequestPoolIds={pendingExternalRequestPoolIds}
            canAcceptExternalRequest={!seedSwapActive && Boolean(selectedPoolExternalRequest && canAcceptExternalEditRequest(selectedPoolExternalRequest))}
            canRespondExternalRequest={Boolean(!busy && selectedPoolExternalRequest && canReplyToExternalEditRequest(selectedPoolExternalRequest))}
            onAcceptExternalRequest={() => {
              if (selectedPoolExternalRequest) void acceptExternalEditRequest(selectedPoolExternalRequest);
            }}
            onRejectExternalRequest={() => {
              if (selectedPoolExternalRequest) void rejectExternalEditRequest(selectedPoolExternalRequest);
            }}
            canSyncExternalEditor={!busy && senderProfileReady && !disableLocalCommunication}
            onSyncExternalEditor={() => void syncSelectedPoolExternalEditor()}
            canRequestExternalEditor={canBroadcastCallListSync}
            onRequestExternalEditor={requestExternalEditor}
            onPhasePoolChange={setSelectedPhasePoolKey}
            onSelectedPoolScoreEditLockChange={(locked) => void changeSelectedPoolScoreEditLock(locked)}
            onSelectedPoolExternalScoreBroadcastChange={(enabled) => void changeSelectedPoolExternalScoreBroadcast(enabled)}
            onClearSelectedPoolExternalEditor={() => void clearSelectedPoolExternalEditor()}
            bracketScaleStyle={bracketScaleStyle}
            bracketZoomLevel={bracketZoomLevel}
            bracketZoomLevels={BRACKET_ZOOM_LEVELS}
            onBracketZoomChange={(value) => setBracketZoomLevel(normalizeBracketZoomLevel(value))}
            canOpenMobileInput={
              !seedSwapActive && !busy && !mobileInputPortalBusy && toApiSlug(slug) !== "" && Boolean(selectedEvent)
            }
            onOpenMobileInput={() => void openMobileInputPortalDialog()}
            canRestore={!seedSwapActive && !busy && toApiSlug(slug) !== "" && Boolean(selectedEvent)}
            onOpenRestore={() => setRestoreDialogOpen(true)}
            canReport={!seedSwapActive && selectedEventMeta?.origin !== "local" && !busy && !isInitialSeedStatusLoading && toApiSlug(slug) !== "" && (confirmedReportableCount > 0 || hasUnreportedInitialSeedShuffle)}
            onReport={() => void bracketReport.startReport()}
            roundRobin={{
              entrantNames: roundRobinEntrantNames,
              rows: roundRobinMatrixRows,
              standings: roundRobinStandings,
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

          {!seedSwapActive && activeMatch && selectedEvent && (
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
                || activeMatchCalls.length > 0
              }
              scoreEditLocked={selectedPoolScoreEditLocked}
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
                aliasNamesByEntrantId: currentPlayerDisplayAliasSnapshot?.aliasesByEntrantId,
                useAliasName: currentPlayerDisplayAliasSnapshot?.enabled,
              })}
              callingEntrantId={callingEntrantId}
              callNotices={activeMatchCalls.flatMap((callMessage) => {
                const metadata = callMessage.messageMeta;
                const entrantName = metadata?.callEntrantName;
                return callMessage.method === "call_player"
                  && callMessage.messageType === "normal"
                  && callMessage.parentMessageId === null
                  && metadata?.eventId === selectedEvent.eventId
                  && metadata?.setId === activeMatch.setId
                  && typeof entrantName === "string"
                  ? [{
                    messageId: callMessage.messageId,
                    entrantName,
                    calledAt: callMessage.createdAt,
                  }]
                  : [];
              })}
              calledEntrantIds={activeMatchCalledEntrantIds}
              hasUnresolvedCalls={activeMatchCalls.length > 0}
              canResolveCalls={activeMatchOwnCalls.length > 0 && activeMatchOtherCalls.length === 0}
              isDqDraft={isActiveMatchDqDraft}
              overlayActive={isOverlayActiveForSet(obsOverlayState, activeMatch.setId)}
              overlayVisibilityOverrides={obsOverlayState?.visibilityOverrides ?? {}}
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
              onResolveCalls={() => requestSetCallResolution(activeMatch)}
              onToggleOverlay={() => {
                if (isOverlayActiveForSet(obsOverlayState, activeMatch.setId)) {
                  requestToggleActiveMatchOverlay(activeMatch);
                } else {
                  startOverlayOnlyWithoutActiveCalls(activeMatch, () =>
                    requestToggleActiveMatchOverlay(activeMatch),
                  );
                }
              }}
              onConfirm={() => runSetActionAfterCallResolution(activeMatch, t("結果確定"), () =>
                requestResultConfirmation(activeMatch),
              )}
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
            seedSnapshotPromptOpen={bracketReport.seedSnapshotPromptOpen}
            canReportWithoutSnapshot={selectedEventMeta?.origin !== "local" && confirmedReportableCount > 0}
            onCloseSeedSnapshotPrompt={bracketReport.dismissSeedSnapshotPrompt}
            onUpdateSeedSnapshot={() => void updateSnapshot()}
            onReportWithoutSnapshot={() => {
              bracketReport.dismissSeedSnapshotPrompt();
              void bracketReport.startReport();
            }}
            restoreOpen={restoreDialogOpen}
            selectedEventName={selectedEvent?.name ?? t("選択中のイベント")}
            canRestoreCurrentPool={
              !busy
              && Boolean(selectedEvent)
              && Boolean(selectedPhasePoolGroup?.phaseGroupId)
            }
            canRestoreLockedPoolsInCurrentPhase={
              !busy
              && Boolean(selectedEvent)
              && selectedEventMeta?.eventId === selectedEvent?.eventId
              && lockedPoolGroupIdsForCurrentPhase.length > 0
            }
            canRestoreAll={!busy && Boolean(selectedEvent)}
            canUpdateSnapshot={!busy && toApiSlug(slug) !== "" && selectedEventMeta?.origin !== "local"}
            canDiscardAllDrafts={!busy && toApiSlug(slug) !== "" && Boolean(selectedEvent)}
            onCloseRestore={() => setRestoreDialogOpen(false)}
            onRestoreCurrentPool={() => void restoreGraphAndRefreshDisplay(
              "currentPool",
              selectedPhasePoolGroup?.phaseGroupId ?? null,
              selectedPhaseName,
            )}
            onRestoreLockedPoolsInCurrentPhase={() => void restoreGraphAndRefreshDisplay(
              "lockedPoolsInCurrentPhase",
              null,
              selectedPhaseName,
            )}
            onRestoreAll={(discardSeedShuffle) => void restoreGraphAndRefreshDisplay("all", null, null, discardSeedShuffle)}
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
            onConfirmOverlaySwitch={() => {
              if (activeMatch) {
                startOverlayOnlyWithoutActiveCalls(activeMatch, () =>
                  confirmOverlaySwitch(activeMatch),
                );
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
          {setCallResolutionDialog && (
            <div className="dialog-backdrop" onClick={closeSetCallResolutionDialog}>
              <section
                className="dialog-panel"
                role="dialog"
                aria-modal="true"
                aria-label={t("Setの呼び出し解決")}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="dialog-head">
                  <h3>{setCallResolutionDialog.otherCalls.length > 0
                    ? t("他端末の呼び出しが未解決です")
                    : setCallResolutionDialog.continueAfterResolution
                      ? t("呼び出しを解決して続行しますか？")
                      : t("このSetの呼び出しを解決しますか？")}</h3>
                </div>
                <div className="dialog-body">
                  <div className="dialog-summary-box">
                    <p className="dialog-summary-title">{setCallResolutionDialog.setLabel}</p>
                    <p className="meta">
                      {setCallResolutionDialog.continueAfterResolution
                        ? t("呼び出しを解決するまで「{p0}」は行えません。", { p0: t(setCallResolutionDialog.operationLabel) })
                        : setCallResolutionDialog.operationLabel === "配信開始"
                          ? t("呼び出しを解決すると、配信は開始せずにこのダイアログを閉じます。")
                          : t("呼び出しの解決後、スコア更新や配信開始は自動で行われません。")}
                    </p>
                  </div>
                  {setCallResolutionDialog.ownCalls.length > 0 && (
                    <div className="dialog-summary-box" style={{ marginTop: "0.75rem" }}>
                      <p className="dialog-summary-title">{t("自端末発行: ")}{setCallResolutionDialog.ownCalls.length}{t("件")}</p>
                      {setCallResolutionDialog.ownCalls.map((call) => (
                        <p className="meta" key={call.messageId}>
                          {extractMetaString(call.messageMeta, "callEntrantName") || call.subject}
                        </p>
                      ))}
                    </div>
                  )}
                  {setCallResolutionDialog.otherCalls.length > 0 && (
                    <div className="dialog-summary-box" style={{ marginTop: "0.75rem" }}>
                      <p className="dialog-summary-title">
                        {t("他端末発行: ")}{setCallResolutionDialog.otherCalls.length}{t("件")}</p>
                      {setCallResolutionDialog.otherCalls.map((call) => (
                        <p className="meta" key={call.messageId}>
                          {extractMetaString(call.messageMeta, "callEntrantName") || call.subject}
                          {t(" / 発行元: ")}{call.senderName}{" ("}{call.senderUserId}{")"}
                        </p>
                      ))}
                      <p className="meta">
                        {t("呼び出しを発行した端末で解決してから、この操作をやり直してください。")}</p>
                    </div>
                  )}
                  {setCallResolutionDialog.otherCalls.length === 0
                    && setCallResolutionDialog.continueAfterResolution && (
                    <p className="meta">
                      {t("解決を選ぶと、このSetの自端末発行呼び出しをすべて解決して操作を続けます。")}</p>
                  )}
                </div>
                <div className="dialog-actions dialog-actions-split" style={{ justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="ghost"
                    disabled={setCallResolutionBusy}
                    onClick={closeSetCallResolutionDialog}
                  >
                    {t("キャンセル")}</button>
                  {setCallResolutionDialog.otherCalls.length === 0
                    && setCallResolutionDialog.ownCalls.length > 0 && (
                      <button
                        type="button"
                        disabled={setCallResolutionBusy}
                        onClick={() => void resolveSetCalls()}
                      >
                        {setCallResolutionBusy
                          ? t("呼び出しを解決中...")
                          : setCallResolutionDialog.continueAfterResolution
                            ? t("呼び出しを解決して続行")
                            : t("呼び出しを解決")}
                      </button>
                    )}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

export default App;
