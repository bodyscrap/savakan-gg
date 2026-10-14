import type { CSSProperties, MouseEvent } from "react";
import type {
  RoundRobinStanding,
  RoundRobinTieBreakRule,
  SetSnapshot,
} from "../domain/bracketProgression";
import type { PhasePoolGroup } from "../domain/bracketDisplay";
import type { PhaseGroupExternalEditor } from "../domain/tournamentWorkspaceRepository";
import { EliminationBracket, type EliminationBracketSectionView } from "./EliminationBracket";
import { getBracketProgressionModel } from "../domain/bracketProgression";
import { RoundRobinBracket } from "./RoundRobinBracket";
import type { RoundRobinMatrixRowView } from "./RoundRobinMatrix";
import type { FeatureMessage } from "../domain/messages";

type RoundRobinDiagnostics = {
  candidateSetCount: number;
  twoSlotSetCount: number;
  resolvedSetCount: number;
  registeredSetCount: number;
  unresolvedSetIds: string[];
  unresolvedSetReasons: string[];
};

type RoundRobinView = {
  entrantNames: string[];
  rows: RoundRobinMatrixRowView[];
  standings: RoundRobinStanding[];
  tieBreakRules: RoundRobinTieBreakRule[];
  qualifyingCount: number;
  diagnostics: RoundRobinDiagnostics;
};

type BracketTabProps = {
  busy: boolean;
  draftPendingCount: number;
  confirmedReportableCount: number;
  hasSnapshot: boolean;
  tournamentName: string;
  eventAlias: string;
  eventName: string;
  phaseNames: string[];
  selectedPhaseName: string;
  onPhaseNameChange: (phaseName: string) => void;
  phaseScopedPoolGroups: PhasePoolGroup[];
  selectedPhasePoolGroup: PhasePoolGroup | null;
  selectedPoolScoreEditLocked: boolean;
  selectedPoolExternalScoreBroadcastEnabled: boolean;
  externalEditor: PhaseGroupExternalEditor | null;
  externalRequest: FeatureMessage | null;
  dqRequests: FeatureMessage[];
  pendingDqPoolIds: string[];
  onProcessDqRequest: (message: FeatureMessage) => void;
  pendingExternalRequestPoolIds: string[];
  canAcceptExternalRequest: boolean;
  canRespondExternalRequest: boolean;
  onAcceptExternalRequest: () => void;
  onRejectExternalRequest: () => void;
  canSyncExternalEditor: boolean;
  onSyncExternalEditor: () => void;
  canRequestExternalEditor: boolean;
  onRequestExternalEditor: () => void;
  onPhasePoolChange: (key: string) => void;
  onSelectedPoolScoreEditLockChange: (locked: boolean) => void;
  onSelectedPoolExternalScoreBroadcastChange: (enabled: boolean) => void;
  onClearSelectedPoolExternalEditor: () => void;
  bracketScaleStyle: CSSProperties;
  bracketZoomLevel: number;
  bracketZoomLevels: readonly number[];
  onBracketZoomChange: (value: string) => void;
  canOpenMobileInput: boolean;
  onOpenMobileInput: () => void;
  canRestore: boolean;
  onOpenRestore: () => void;
  canReport: boolean;
  onReport: () => void;
  roundRobin: RoundRobinView;
  eliminationSections: EliminationBracketSectionView[];
  onRoundRobinMatchClick: (set: SetSnapshot, event: MouseEvent<HTMLButtonElement>) => void;
  onEliminationSetActivate: (set: SetSnapshot, event: MouseEvent<HTMLElement>) => void;
  onOpenSet: (set: SetSnapshot) => void;
};

export function BracketTab({
  busy,
  draftPendingCount,
  confirmedReportableCount,
  hasSnapshot,
  tournamentName,
  eventAlias,
  eventName,
  phaseNames,
  selectedPhaseName,
  onPhaseNameChange,
  phaseScopedPoolGroups,
  selectedPhasePoolGroup,
  selectedPoolScoreEditLocked,
  selectedPoolExternalScoreBroadcastEnabled,
  externalEditor,
  externalRequest,
  dqRequests,
  pendingDqPoolIds,
  onProcessDqRequest,
  pendingExternalRequestPoolIds,
  canAcceptExternalRequest,
  canRespondExternalRequest,
  onAcceptExternalRequest,
  onRejectExternalRequest,
  canSyncExternalEditor,
  onSyncExternalEditor,
  canRequestExternalEditor,
  onRequestExternalEditor,
  onPhasePoolChange,
  onSelectedPoolScoreEditLockChange,
  onSelectedPoolExternalScoreBroadcastChange,
  onClearSelectedPoolExternalEditor,
  bracketScaleStyle,
  bracketZoomLevel,
  bracketZoomLevels,
  onBracketZoomChange,
  canOpenMobileInput,
  onOpenMobileInput,
  canRestore,
  onOpenRestore,
  canReport,
  onReport,
  roundRobin,
  eliminationSections,
  onRoundRobinMatchClick,
  onEliminationSetActivate,
  onOpenSet,
}: BracketTabProps) {
  const selectedBracketModel = selectedPhasePoolGroup
    ? getBracketProgressionModel(selectedPhasePoolGroup.bracketType)
    : null;

  return (
    <>
      <section className="panel">
        <h2>使用方法</h2>
        <p className="meta">set(試合)をクリックすると詳細画面がオープン。setを Ctrl+クリックで配信画面のON/OFF、Alt+左クリックで配信を完全停止します。</p>
        <div className="panel-toolbar compact">
          <p className="meta">
            下書き: {draftPendingCount} / 確定済み: {confirmedReportableCount}   黄枠のsetは、現在のスナップショットから変更があります。
          </p>
        </div>
      </section>

      {hasSnapshot && (
        <section className="panel">
          <h2>{eventAlias.trim() !== "" ? eventAlias : "未設定"}</h2>
          <p className="meta">tournament名: {tournamentName}, event名: {eventName}</p>
          <div className="event-toolbar">
            <div className="bracket-scope-controls" aria-label="ブラケット表示範囲">
              <label className="bracket-scope-field" htmlFor="phase-select">
                対象フェーズ
                <select
                  id="phase-select"
                  value={selectedPhaseName}
                  onChange={(event) => onPhaseNameChange(event.currentTarget.value)}
                  disabled={phaseNames.length === 0}
                >
                  {phaseNames.length === 0 ? (
                    <option value="">フェーズがありません</option>
                  ) : (
                    phaseNames.map((phaseName) => (
                      <option key={phaseName} value={phaseName}>
                        {phaseName}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label className="bracket-scope-field" htmlFor="phase-pool-select">
                対象プール
                <select
                  id="phase-pool-select"
                  value={selectedPhasePoolGroup?.key ?? ""}
                  onChange={(event) => onPhasePoolChange(event.currentTarget.value)}
                  disabled={phaseScopedPoolGroups.length === 0}
                >
                  {phaseScopedPoolGroups.length === 0 ? (
                    <option value="">フェーズ/プールがありません</option>
                  ) : (
                    phaseScopedPoolGroups.map((group) => (
                      <option key={group.key} value={group.key}>
                        Pool {group.phaseGroupName}
                        {group.phaseGroupId && pendingExternalRequestPoolIds.includes(group.phaseGroupId)
                          ? " (外部報告申請あり)" : ""}
                        {group.phaseGroupId && pendingDqPoolIds.includes(group.phaseGroupId) ? " (DQ申請あり)" : ""}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <div className="bracket-view-tools" style={bracketScaleStyle}>
                <label htmlFor="bracket-zoom-select">
                  表示倍率
                  <select
                    id="bracket-zoom-select"
                    value={String(bracketZoomLevel)}
                    onChange={(event) => onBracketZoomChange(event.currentTarget.value)}
                  >
                    {bracketZoomLevels.map((level) => (
                      <option key={level} value={String(level)}>
                        {level.toFixed(2)}x
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="bracket-actions">
              <button type="button" className="ghost" disabled={!canOpenMobileInput} onClick={onOpenMobileInput}>
                スマートフォンでアクセス
              </button>
              <button type="button" className="ghost" disabled={!canRestore} onClick={onOpenRestore}>
                復元
              </button>
              <button type="button" disabled={!canReport} onClick={onReport}>
                確定済みを一括報告
              </button>
            </div>
          </div>

          <div className="phase-groups">
            {!selectedPhasePoolGroup ? (
              <p className="meta">選択中イベントにフェーズ/プール情報がありません。</p>
            ) : (
              <section className="phase-group" key={selectedPhasePoolGroup.key}>
                <ExternalReportRequestPanel
                  request={externalRequest}
                  canAccept={canAcceptExternalRequest}
                  canRespond={canRespondExternalRequest}
                  onAccept={onAcceptExternalRequest}
                  onReject={onRejectExternalRequest}
                />
                <p className="meta">sets: {selectedPhasePoolGroup.sets.length}</p>
                <PlayerDqRequestPanel requests={dqRequests} busy={busy} onProcess={onProcessDqRequest} />
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={selectedPoolScoreEditLocked}
                      disabled={busy || !selectedPhasePoolGroup.phaseGroupId}
                      onChange={(event) => onSelectedPoolScoreEditLockChange(event.currentTarget.checked)}
                    />
                    スコア編集のロック
                  </label>
                  {selectedPoolScoreEditLocked && externalEditor && (
                    <>
                      <span className="meta">
                        外部報告者: {externalEditor.senderName} ({externalEditor.senderUserId})
                      </span>
                      <button
                        type="button"
                        className="ghost"
                        disabled={!canSyncExternalEditor}
                        onClick={onSyncExternalEditor}
                      >
                        同期
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={onClearSelectedPoolExternalEditor}
                      >
                        外部報告者を解除
                      </button>
                    </>
                  )}
                  {!selectedPoolScoreEditLocked && (
                    <>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={selectedPoolExternalScoreBroadcastEnabled}
                          disabled={busy || !selectedPhasePoolGroup.phaseGroupId}
                          onChange={(event) => onSelectedPoolExternalScoreBroadcastChange(event.currentTarget.checked)}
                        />
                        スコア確定時に外部報告
                      </label>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy || !canRequestExternalEditor}
                        onClick={onRequestExternalEditor}
                      >
                        外部報告申請
                      </button>
                    </>
                  )}
                </div>
                {selectedBracketModel === "round_robin" ? (
                  <RoundRobinBracket
                    scaleStyle={bracketScaleStyle}
                    setCount={selectedPhasePoolGroup.sets.length}
                    phaseGroupId={selectedPhasePoolGroup.phaseGroupId}
                    seeds={selectedPhasePoolGroup.seeds}
                    progressionsOut={selectedPhasePoolGroup.progressionsOut}
                    entrantNames={roundRobin.entrantNames}
                    rows={roundRobin.rows}
                    standings={roundRobin.standings}
                    tieBreakRules={roundRobin.tieBreakRules}
                    qualifyingCount={roundRobin.qualifyingCount}
                    diagnostics={roundRobin.diagnostics}
                    onMatchClick={onRoundRobinMatchClick}
                  />
                ) : (
                  <>
                    {(selectedBracketModel === "single_elimination"
                      || selectedBracketModel === "double_elimination") && (
                      <h3>
                        {selectedBracketModel === "single_elimination"
                          ? "Single Elimination"
                          : "Double Elimination"}
                      </h3>
                    )}
                    <EliminationBracket
                      scaleStyle={bracketScaleStyle}
                      phaseGroupKey={selectedPhasePoolGroup.key}
                      seeds={selectedPhasePoolGroup.seeds}
                      seedMap={selectedPhasePoolGroup.seedMap}
                      sections={eliminationSections}
                      onActivateSet={onEliminationSetActivate}
                      onOpenSet={onOpenSet}
                    />
                  </>
                )}
              </section>
            )}
          </div>
        </section>
      )}
    </>
  );
}

export function PlayerDqRequestPanel({
  requests, busy, onProcess,
}: {
  requests: FeatureMessage[];
  busy: boolean;
  onProcess: (request: FeatureMessage) => void;
}) {
  if (requests.length === 0) return null;
  return (
    <section className="panel" aria-label="受信したDQ申請">
      <h3>DQ申請が届いています</h3>
      <p className="meta">対象の試合を開き、DQ内容を確認して「確定」を押してください。開くだけでは申請は処理済みになりません。</p>
      <div className="dq-request-list">
        {requests.map((request) => (
          <div className="dq-request-row" key={request.messageId}>
            <p className="dq-request-row-body" title={request.body}>{request.body}</p>
            <p
              className="meta dq-request-row-meta"
              title={`${request.senderName} (${request.senderUserId}) / ${request.createdAt}`}
            >
              {request.senderName} ({request.senderUserId}) / {request.createdAt}
            </p>
            <button type="button" disabled={busy} onClick={() => onProcess(request)}>DQ内容を確認</button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ExternalReportRequestPanel({
  request, canAccept, canRespond, onAccept, onReject,
}: {
  request: FeatureMessage | null;
  canAccept: boolean;
  canRespond: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  if (!request) return null;
  return (
    <section className="panel" aria-label="受信した外部報告申請">
      <h3>外部報告申請が届いています</h3>
      <p>{request.senderName} ({request.senderUserId})</p>
      <p className="meta">このプールの最新の申請を表示しています。</p>
      <div className="panel-toolbar compact">
        <button type="button" disabled={!canAccept} onClick={onAccept}>受理</button>
        <button type="button" className="ghost" disabled={!canRespond} onClick={onReject}>拒否</button>
      </div>
    </section>
  );
}
