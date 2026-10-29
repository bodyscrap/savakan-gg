import { t } from "../i18n";
import { useEffect, useState, type FormEvent } from "react";
import type {
  CreateLocalEventSnapshotInput,
  LocalEventPhaseConfig,
  LocalEventTieBreakRule,
} from "../domain/tournamentWorkspaceRepository";
import { formatDefaultSnapshotName } from "../domain/snapshotDisplay";
import type { ItemListConfig } from "../domain/itemList";
import { canRegisterParticipant, type LocalEventRegistration as Registration } from "../domain/localEventRegistration";
import { LocalEventRegistration } from "./LocalEventRegistration";

export type TournamentEventPreviewItem = {
  eventId: string;
  eventName: string;
  eventSlug: string | null;
  bracketTypes: string[];
  setCount: number;
};

export type TournamentPreview = {
  tournamentId: string;
  slug: string;
  name: string;
  updatedAt: string;
  events: TournamentEventPreviewItem[];
};

export type EventSnapshotProgress = {
  phase: string;
  completedSets: number;
  totalSets: number | null;
  currentPage: number | null;
  currentSetId: string | null;
};

type CreateSnapshotProps = {
  registration: Registration;
  onRegistrationChange: (registration: Registration) => void;
  itemLists: ItemListConfig[];
  token: string;
  onTokenChange: (value: string) => void;
  createTournamentSlug: string;
  onCreateTournamentSlugChange: (value: string) => void;
  createBusy: boolean;
  canLoadPreview: boolean;
  onSaveToken: (event: FormEvent<HTMLFormElement>) => void;
  onLoadPreview: (event: FormEvent<HTMLFormElement>) => void;
  createPreview: TournamentPreview | null;
  createPreviewLoadFailed: boolean;
  createEventSearchInput: string;
  onEventSearchInputChange: (value: string) => void;
  createFilteredEvents: TournamentEventPreviewItem[];
  createSelectedEventId: string;
  onEventDropdownChange: (eventId: string) => void;
  createEventAlias: string;
  onEventAliasChange: (value: string) => void;
  canCreateSnapshot: boolean;
  onCreateSnapshot: () => void;
  senderUserId: string;
  canCreateLocalSnapshot: boolean;
  onCreateLocalSnapshot: (input: CreateLocalEventSnapshotInput) => void;
};

function createPreviewEventSearchLabel(event: TournamentEventPreviewItem): string {
  return `${event.eventName} (${event.eventId})`;
}

type SnapshotSource = "startgg" | "local";
const SNAPSHOT_SOURCE_STORAGE_KEY = "savakan-gg.snapshot-source.v1";
const LOCAL_TOURNAMENT_NAME_STORAGE_KEY = "savakan-gg.local-tournament-name.v1";
const DEFAULT_LOCAL_TOURNAMENT_NAME = "Local Tournament";

function readStoredSnapshotSource(): SnapshotSource {
  if (typeof window === "undefined") {
    return "startgg";
  }
  try {
    const value = window.localStorage.getItem(SNAPSHOT_SOURCE_STORAGE_KEY);
    if (value === null || value === "startgg" || value === "local") {
      return value ?? "startgg";
    }
    console.error("Invalid stored snapshot source preference.", value);
  } catch (error) {
    console.error("Unable to read the snapshot source preference.", error);
  }
  return "startgg";
}

function defaultLocalEventName(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `${date} Local Event`;
}

function readStoredLocalTournamentName(): string {
  if (typeof window === "undefined") {
    return DEFAULT_LOCAL_TOURNAMENT_NAME;
  }
  try {
    return window.localStorage.getItem(LOCAL_TOURNAMENT_NAME_STORAGE_KEY) ?? DEFAULT_LOCAL_TOURNAMENT_NAME;
  } catch (error) {
    console.error("Unable to read the local tournament name preference.", error);
    return DEFAULT_LOCAL_TOURNAMENT_NAME;
  }
}

const localRoundRobinTieBreakOptions: Array<{
  value: LocalEventTieBreakRule;
  label: string;
  description: string;
}> = [
  { value: "TOTAL_SETS_WON", label: "総セット勝利数", description: "" },
  { value: "GAME_RATIO", label: "総ゲーム勝率", description: "" },
  { value: "HEAD_TO_HEAD", label: "head-to-head", description: "同じ条件で並んだ参加者同士の直接対戦結果で順位を決めます。" },
];

type LocalEventSnapshotFormProps = {
  registration: Registration;
  onRegistrationChange: (registration: Registration) => void;
  itemLists: ItemListConfig[];
  visible: boolean;
  createBusy: boolean;
  senderUserId: string;
  canCreateLocalSnapshot: boolean;
  onCreateLocalSnapshot: (input: CreateLocalEventSnapshotInput) => void;
};

function LocalEventSnapshotForm({
  registration,
  onRegistrationChange,
  itemLists,
  visible,
  createBusy,
  senderUserId,
  canCreateLocalSnapshot,
  onCreateLocalSnapshot,
}: LocalEventSnapshotFormProps) {
  const [localTournamentName, setLocalTournamentName] = useState(readStoredLocalTournamentName);
  const [localEventName, setLocalEventName] = useState(defaultLocalEventName);
  const [localEventAlias, setLocalEventAlias] = useState(() => formatDefaultSnapshotName(localTournamentName, localEventName));
  const [localEventAliasEdited, setLocalEventAliasEdited] = useState(false);
  const participantCount = registration.participants.length;
  const [phaseCount, setPhaseCount] = useState(1);
  const [draggedTieBreakRule, setDraggedTieBreakRule] = useState<{ phaseIndex: number; ruleIndex: number } | null>(null);
  const [phases, setPhases] = useState<LocalEventPhaseConfig[]>([
    { name: "Phase 1", poolCount: 1, bracketType: "DOUBLE_ELIMINATION", qualifiersPerPool: 0, tiebreakOrder: ["TOTAL_SETS_WON", "GAME_RATIO", "HEAD_TO_HEAD"], enabledTiebreakRules: ["TOTAL_SETS_WON", "GAME_RATIO", "HEAD_TO_HEAD"], thirdPlaceMatch: false, fifthPlaceMatch: false, grandFinalReset: true },
    { name: "Phase 2", poolCount: 1, bracketType: "DOUBLE_ELIMINATION", qualifiersPerPool: 0, tiebreakOrder: ["TOTAL_SETS_WON", "GAME_RATIO", "HEAD_TO_HEAD"], enabledTiebreakRules: ["TOTAL_SETS_WON", "GAME_RATIO", "HEAD_TO_HEAD"], thirdPlaceMatch: false, fifthPlaceMatch: false, grandFinalReset: true },
    { name: "Phase 3", poolCount: 1, bracketType: "DOUBLE_ELIMINATION", qualifiersPerPool: 0, tiebreakOrder: ["TOTAL_SETS_WON", "GAME_RATIO", "HEAD_TO_HEAD"], enabledTiebreakRules: ["TOTAL_SETS_WON", "GAME_RATIO", "HEAD_TO_HEAD"], thirdPlaceMatch: false, fifthPlaceMatch: false, grandFinalReset: true },
  ]);
  const [registrationPending, setRegistrationPending] = useState(false);
  const registrationComplete = participantCount >= 2 && participantCount <= 512
    && registration.participants.every((player) => canRegisterParticipant(player, registration));
  const changeLocalTournamentName = (value: string) => {
    setLocalTournamentName(value);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LOCAL_TOURNAMENT_NAME_STORAGE_KEY, value);
      }
    } catch (error) {
      console.error("Unable to save the local tournament name preference.", error);
    }
  };
  let availablePlayers = participantCount;
  const effectivePhases = phases.map((phase, index) => {
    const poolCount = Math.max(1, Math.min(phase.poolCount, Math.floor(availablePlayers / 2)));
    const qualifiersPerPool = Math.min(Math.max(1, phase.qualifiersPerPool), Math.floor(availablePlayers / poolCount));
    if (index + 1 < phaseCount) availablePlayers = poolCount * qualifiersPerPool;
    return { ...phase, poolCount, qualifiersPerPool };
  });

  useEffect(() => {
    if (!localEventAliasEdited) {
      setLocalEventAlias(formatDefaultSnapshotName(localTournamentName, localEventName));
    }
  }, [localEventAliasEdited, localEventName, localTournamentName]);

  const participantCountForPhase = (index: number) => {
    let count = participantCount;
    for (let previous = 0; previous < index; previous += 1) {
      count = effectivePhases[previous].poolCount * effectivePhases[previous].qualifiersPerPool;
    }
    return count;
  };
  const phasePlayerErrors = effectivePhases.slice(0, phaseCount).flatMap((_, index) =>
    participantCountForPhase(index) < 2
      ? [t("Phase {phase}: 参加人数は2人以上必要です。", { phase: index + 1 })]
      : []);
  const updatePhase = (index: number, update: Partial<LocalEventPhaseConfig>) => {
    setPhases((current) => current.map((phase, phaseIndex) => (
      phaseIndex === index ? { ...phase, ...update } : phase
    )));
  };
  const moveTieBreakRule = (phaseIndex: number, fromIndex: number, toIndex: number) => {
    const order = [...phases[phaseIndex].tiebreakOrder];
    if (toIndex < 0 || toIndex >= order.length || fromIndex === toIndex) {
      return;
    }
    const [movedRule] = order.splice(fromIndex, 1);
    order.splice(toIndex, 0, movedRule);
    updatePhase(phaseIndex, { tiebreakOrder: order });
  };
  const toggleTieBreakRule = (phaseIndex: number, rule: LocalEventTieBreakRule, enabled: boolean) => {
    const current = phases[phaseIndex].enabledTiebreakRules;
    if (!enabled && current.length === 1) {
      return;
    }
    updatePhase(phaseIndex, {
      enabledTiebreakRules: enabled
        ? [...current, rule]
        : current.filter((currentRule) => currentRule !== rule),
    });
  };
  const submitLocalSnapshot = () => onCreateLocalSnapshot({
    tournamentName: localTournamentName,
    eventName: localEventName,
    eventAlias: localEventAlias.trim() === "" ? null : localEventAlias.trim(),
    participants: registration.participants.map(({ entrantId, name, categorySelections, skill }) => ({ entrantId, name, categorySelections, skill })),
    eventManagement: registration.setting,
    requireItemSelections: registration.requireItemSelections,
    phases: effectivePhases.slice(0, phaseCount).map((phase, index) => ({
      ...phase,
      qualifiersPerPool: index + 1 < phaseCount ? phase.qualifiersPerPool : 0,
      thirdPlaceMatch: phase.bracketType === "SINGLE_ELIMINATION"
        && Math.floor(participantCountForPhase(index) / phase.poolCount) >= 4
        && phase.thirdPlaceMatch,
      fifthPlaceMatch: phase.bracketType === "DOUBLE_ELIMINATION"
        && Math.floor(participantCountForPhase(index) / phase.poolCount) >= 8
        && phase.fifthPlaceMatch,
    })),
  });

  if (!visible) {
    return null;
  }

  return <>
    <section className="panel create-layout-full">
      <h2>{t("ローカルeventの基本設定")}</h2>
      <div className="local-event-basic-fields">
        <div className="local-event-name-fields">
          <label>{t("tournament名")}<input value={localTournamentName} onChange={(event) => changeLocalTournamentName(event.currentTarget.value)} /></label>
          <label>{t("event名")}<input value={localEventName} onChange={(event) => setLocalEventName(event.currentTarget.value)} /></label>
          <label>{t("エイリアス名")}<input value={localEventAlias} onChange={(event) => {
            setLocalEventAliasEdited(true);
            setLocalEventAlias(event.currentTarget.value);
          }} placeholder={t("アプリ内表示用のevent alias")} /></label>
          <label className="local-event-phase-count-field">{t("フェーズ数")}
            <select value={phaseCount} onChange={(event) => {
              const nextCount = Number(event.currentTarget.value);
              setPhases((current) => current.map((phase, index) => (
                index < nextCount - 1 && phase.qualifiersPerPool === 0
                  ? { ...phase, qualifiersPerPool: 1 }
                  : phase
              )));
              setPhaseCount(nextCount);
            }}>
              {[1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
        </div>
      </div>
      <p className="meta">{t("送信者ID")}: {senderUserId || t("未設定")}</p>
      {!senderUserId && <p className="meta">{t("ローカルeventの作成には送信者IDの設定が必要です。")}</p>}
    </section>
    <LocalEventRegistration itemLists={itemLists} registration={registration} onChange={onRegistrationChange}
      busy={createBusy} onPendingChange={setRegistrationPending} onImportEventName={setLocalEventName} />
    <section className="panel create-layout-full">
      <h2>{t("フェーズ設定")}</h2>
      <div className="local-event-phase-scroll">
      <div className="local-event-phase-list">
        <div className="local-event-phase-fields local-event-phase-header" aria-hidden="true">
          <span />
          <span>{t("フェーズ名")}</span>
          <span>{t("プール数")}</span>
          <span>{phaseCount > 1 ? t("進出人数") : ""}</span>
          <span>{t("形式")}</span>
          <span />
        </div>
        {effectivePhases.slice(0, phaseCount).map((phase, index) => {
          const phasePlayers = participantCountForPhase(index);
          const lastPhase = index + 1 === phaseCount;
          const playersPerPool = Math.floor(phasePlayers / phase.poolCount);
          const phaseLabel = t("Phase {p0}", { p0: index + 1 });
          return <div key={index} className="local-event-phase" role="group" aria-label={phaseLabel}>
            <div className="local-event-phase-fields">
              <strong className="local-event-phase-number">{phaseLabel} ({phasePlayers})</strong>
              <input aria-label={t("フェーズ名")} value={phase.name} onChange={(event) => updatePhase(index, { name: event.currentTarget.value })} />
              <input aria-label={t("プール数")} type="number" min={1} max={Math.max(1, Math.floor(phasePlayers / 2))} value={phase.poolCount} disabled={phasePlayers < 2} onChange={(event) => updatePhase(index, { poolCount: Math.max(1, Math.min(Math.floor(phasePlayers / 2), Number(event.currentTarget.value) || 1)) })} />
              {!lastPhase ? <input aria-label={t("進出人数")} title={t("各プールからの進出人数")} type="number" min={1} max={Math.max(1, Math.floor(phasePlayers / phase.poolCount))} value={phase.qualifiersPerPool} disabled={phasePlayers < 2} onChange={(event) => updatePhase(index, { qualifiersPerPool: Math.max(1, Math.min(Math.floor(phasePlayers / phase.poolCount), Number(event.currentTarget.value) || 1)) })} /> : <span />}
              <select aria-label={t("形式")} value={phase.bracketType} onChange={(event) => updatePhase(index, { bracketType: event.currentTarget.value as LocalEventPhaseConfig["bracketType"] })}>
                <option value="SINGLE_ELIMINATION">{t("シングルエリミネーション")}</option>
                <option value="DOUBLE_ELIMINATION">{t("ダブルエリミネーション")}</option>
                <option value="ROUND_ROBIN">{t("総当たり")}</option>
              </select>
              <div className="local-event-phase-options">
              {phase.bracketType === "SINGLE_ELIMINATION" && (
                  <div className="local-event-phase-option-field" title={playersPerPool < 4 ? t("各プールに{count}人以上必要です。", { count: 4 }) : undefined}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={playersPerPool < 4}
                        checked={playersPerPool >= 4 && phase.thirdPlaceMatch}
                        onChange={(event) => updatePhase(index, { thirdPlaceMatch: event.currentTarget.checked })}
                      />
                      {t("3位決定戦")}
                    </label>
                  </div>
                )}
              {phase.bracketType === "DOUBLE_ELIMINATION" && (
                  <div className="local-event-phase-option-field" title={playersPerPool < 8 ? t("各プールに{count}人以上必要です。", { count: 8 }) : undefined}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={playersPerPool < 8}
                        checked={playersPerPool >= 8 && phase.fifthPlaceMatch}
                        onChange={(event) => updatePhase(index, { fifthPlaceMatch: event.currentTarget.checked })}
                      />
                      {t("5位決定戦")}
                    </label>
                  </div>
                )}
            {phase.bracketType === "DOUBLE_ELIMINATION" && (
              <div className="local-event-phase-option-field">
                <label>
                  <input type="checkbox" checked={phase.grandFinalReset}
                    onChange={(event) => updatePhase(index, { grandFinalReset: event.currentTarget.checked })} />
                  {t("GF Reset")}
                </label>
              </div>
            )}
            {phase.bracketType === "ROUND_ROBIN" && (
              <div className="local-event-tiebreak">
                <strong>{t("勝利条件の優先度")}</strong>
                <ol>
                  {phase.tiebreakOrder.map((rule, ruleIndex) => {
                    const option = localRoundRobinTieBreakOptions.find((candidate) => candidate.value === rule);
                    const checked = phase.enabledTiebreakRules.includes(rule);
                    return (
                      <li
                        key={rule}
                        className={draggedTieBreakRule?.phaseIndex === index && draggedTieBreakRule.ruleIndex === ruleIndex ? "local-event-tiebreak-dragging" : ""}
                        onDragOver={(event) => {
                          event.preventDefault();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggedTieBreakRule?.phaseIndex === index) {
                            moveTieBreakRule(index, draggedTieBreakRule.ruleIndex, ruleIndex);
                          }
                          setDraggedTieBreakRule(null);
                        }}
                      >
                        <label title={t(option?.description ?? "")}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={checked && phase.enabledTiebreakRules.length === 1}
                            onChange={(event) => toggleTieBreakRule(index, rule, event.currentTarget.checked)}
                          />
                          <span>{ruleIndex + 1}. {t(option?.label ?? rule)}</span>
                        </label>
                        <span
                          className="local-event-tiebreak-drag-handle"
                          draggable
                          aria-label={t("ドラッグして順序を変更")}
                          title={t("ドラッグして順序を変更")}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", String(ruleIndex));
                            setDraggedTieBreakRule({ phaseIndex: index, ruleIndex });
                          }}
                          onDragEnd={() => setDraggedTieBreakRule(null)}
                        >
                          ⠿
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
              </div>
            </div>
          </div>;
        })}
      </div>
      </div>
      <div style={{ display: "flex", justifyContent: "end", marginTop: "0.8rem" }}>
        <button type="button" disabled={createBusy || !canCreateLocalSnapshot || !registrationComplete || registrationPending || phasePlayerErrors.length > 0 || localTournamentName.trim() === "" || localEventName.trim() === ""} onClick={submitLocalSnapshot}>{t("ローカルeventを作成")}</button>
      </div>
      {!registrationComplete && <p className="meta error-text">{registration.requireItemSelections
        ? t("2〜512人の参加者を登録し、全員のアイテム選択を完了してください。")
        : t("2〜512人の参加者を登録してください。")}</p>}
      {phasePlayerErrors.length > 0 && <p className="meta error-text">{phasePlayerErrors.join(" ")}</p>}
    </section>
  </>;
}

export function CreateSnapshot({
  registration,
  onRegistrationChange,
  itemLists,
  token,
  onTokenChange,
  createTournamentSlug,
  onCreateTournamentSlugChange,
  createBusy,
  canLoadPreview,
  onSaveToken,
  onLoadPreview,
  createPreview,
  createPreviewLoadFailed,
  createEventSearchInput,
  onEventSearchInputChange,
  createFilteredEvents,
  createSelectedEventId,
  onEventDropdownChange,
  createEventAlias,
  onEventAliasChange,
  canCreateSnapshot,
  onCreateSnapshot,
  senderUserId,
  canCreateLocalSnapshot,
  onCreateLocalSnapshot,
}: CreateSnapshotProps) {
  const selectedEventName = createPreview?.events.find((event) => event.eventId === createSelectedEventId)?.eventName ?? "-";
  const [source, setSource] = useState<SnapshotSource>(readStoredSnapshotSource);
  const changeSource = (value: SnapshotSource) => {
    setSource(value);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SNAPSHOT_SOURCE_STORAGE_KEY, value);
      }
    } catch (error) {
      console.error("Unable to save the snapshot source preference.", error);
    }
  };

  return (
    <div className={`create-layout${source === "local" ? " create-layout--local" : ""}`}>
      <section className="panel create-layout-full">
        <h2>{t("イベントの作成方法")}</h2>
        <div className="snapshot-source-options" role="group" aria-label={t("イベントの作成方法")}>
          <label><input type="radio" checked={source === "startgg"} onChange={() => changeSource("startgg")} /> {t("start.ggからeventを取り込む")}</label>
          <label><input type="radio" checked={source === "local"} onChange={() => changeSource("local")} /> {t("ローカルeventを作成する")}</label>
        </div>
      </section>
      {source === "startgg" ? <>
      <section className="panel create-layout-half">
        <h2>{t("APIトークンの設定")}</h2>

        <form
          className="form"
          onSubmit={onSaveToken}
          style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}
        >
          <input
            type="password"
            value={token}
            onChange={(e) => onTokenChange(e.currentTarget.value)}
            placeholder="start.gg API token"
            autoComplete="off"
            style={{ flex: "1 1 18rem" }}
          />
          <button type="submit" disabled={createBusy || token.trim() === ""}>{t("APIトークンを保存")}</button>
        </form>
      </section>

      <section className="panel create-layout-half">
        <h2>{t("tournamentの選択")}</h2>
        <form
          className="form"
          onSubmit={onLoadPreview}
          style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}
        >
          <input
            value={createTournamentSlug}
            onChange={(e) => onCreateTournamentSlugChange(e.currentTarget.value)}
            placeholder={t("大会ID (例: savakan-weekly-1)")}
            style={{ flex: "1 1 18rem" }}
          />
          <button type="submit" disabled={createBusy || !canLoadPreview}>{t("event一覧取得")}</button>
        </form>
      </section>

      <section className="panel create-layout-full">
        <h2>{t("tournament内のevent一覧")}</h2>
        {createPreviewLoadFailed ? (
          <p className="meta">{t("event一覧の取得に失敗しました")}</p>
        ) : !createPreview ? (
          <p className="meta">{t("先に tournament を選択してevent一覧を取得してください。")}</p>
        ) : createPreview.events.length === 0 ? (
          <p className="meta">{t("この tournament にはイベントがありません。")}</p>
        ) : (
          <>
            <p className="meta">
              {createPreview.name} / tournament ID: {createPreview.tournamentId} / updatedAt: {new Date(createPreview.updatedAt).toLocaleString()}
            </p>
            <div className="form" style={{ marginTop: "0.7rem" }}>
              <label htmlFor="create-event-search-input" style={{ display: "grid", gap: "0.3rem" }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span className="meta">{t("イベント検索")}</span>
                  <span className="meta">{t("候補: {value1}件 / 全{value2}件", { value1: createFilteredEvents.length, value2: createPreview.events.length })}</span>
                </span>
                <input
                  id="create-event-search-input"
                  type="search"
                  value={createEventSearchInput}
                  onChange={(e) => onEventSearchInputChange(e.currentTarget.value)}
                  placeholder={t("event名 または eventId で検索")}
                  autoComplete="off"
                />
              </label>
              <label htmlFor="create-event-select" style={{ display: "grid", gap: "0.3rem" }}>
                <span className="meta">{t("event選択(選択: {value1})", { value1: selectedEventName })}</span>
                <select
                  id="create-event-select"
                  value={createFilteredEvents.some((event) => event.eventId === createSelectedEventId) ? createSelectedEventId : ""}
                  onChange={(e) => onEventDropdownChange(e.currentTarget.value)}
                >
                  <option value="" disabled>
                    {createFilteredEvents.length === 0 ? t("一致するeventがありません") : t("eventを選択")}
                  </option>
                  {createFilteredEvents.map((event) => (
                    <option key={event.eventId} value={event.eventId}>
                      {createPreviewEventSearchLabel(event)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}
      </section>

      <section className="panel create-layout-full">
        <h2>{t("選択eventのスナップショット作成")}</h2>
        <div className="form" style={{ display: "flex", alignItems: "end", flexWrap: "wrap", marginTop: "0.8rem" }}>
          <label htmlFor="create-event-alias" style={{ display: "grid", gap: "0.3rem", flex: "1 1 18rem" }}>
            <span style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap" }}>
              <span className="meta">{t("エイリアス名")}</span>
              <span className="meta">{t("選択中 event: {value1}", { value1: selectedEventName })}</span>
            </span>
            <input
              id="create-event-alias"
              value={createEventAlias}
              onChange={(e) => onEventAliasChange(e.currentTarget.value)}
              placeholder={t("アプリ内表示用のevent alias")}
            />
          </label>
          <button type="button" disabled={createBusy || !canCreateSnapshot} onClick={onCreateSnapshot}>{t("スナップショット作成")}</button>
        </div>
      </section>
      </> : null}
      <LocalEventSnapshotForm
        registration={registration}
        onRegistrationChange={onRegistrationChange}
        itemLists={itemLists}
        visible={source === "local"}
        createBusy={createBusy}
        senderUserId={senderUserId}
        canCreateLocalSnapshot={canCreateLocalSnapshot}
        onCreateLocalSnapshot={onCreateLocalSnapshot}
      />
    </div>
  );
}