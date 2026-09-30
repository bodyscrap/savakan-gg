import type { CSSProperties, MouseEvent } from "react";
import type {
  RoundRobinStanding,
  RoundRobinTieBreakRule,
  SetSnapshot,
} from "./bracketProgression";
import type { PhasePoolGroup } from "./bracketDisplay";
import { EliminationBracket, type EliminationBracketSectionView } from "./EliminationBracket";
import { getBracketProgressionModel } from "./bracketProgression";
import { RoundRobinBracket } from "./RoundRobinBracket";
import type { RoundRobinMatrixRowView } from "./RoundRobinMatrix";

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
  draftPendingCount: number;
  confirmedReportableCount: number;
  reportProgressActive: boolean;
  reportProgressHasProgress: boolean;
  reportProgressPercent: number;
  reportProgressLabel: string;
  showSnapshotRefreshProgress: boolean;
  snapshotProgressPercent: number;
  snapshotProgressLabel: string;
  snapshotProgressHasTotal: boolean;
  hasSnapshot: boolean;
  tournamentName: string;
  eventAlias: string;
  eventName: string;
  phaseNames: string[];
  selectedPhaseName: string;
  onPhaseNameChange: (phaseName: string) => void;
  phaseScopedPoolGroups: PhasePoolGroup[];
  selectedPhasePoolGroup: PhasePoolGroup | null;
  onPhasePoolChange: (key: string) => void;
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
  draftPendingCount,
  confirmedReportableCount,
  reportProgressActive,
  reportProgressHasProgress,
  reportProgressPercent,
  reportProgressLabel,
  showSnapshotRefreshProgress,
  snapshotProgressPercent,
  snapshotProgressLabel,
  snapshotProgressHasTotal,
  hasSnapshot,
  tournamentName,
  eventAlias,
  eventName,
  phaseNames,
  selectedPhaseName,
  onPhaseNameChange,
  phaseScopedPoolGroups,
  selectedPhasePoolGroup,
  onPhasePoolChange,
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
  return (
    <>
      <section className="panel">
        <h2>使用方法</h2>
        <p className="meta">試合setのカードをクリックすると詳細ダイアログが開き、各種入力が可能です。</p>
        <p className="meta">カードを Ctrl+クリックで配信画面のON/OFF(最大1set)。Alt+左クリックで完全停止します。</p>
        <div className="panel-toolbar compact">
          <p className="meta">
            下書き: {draftPendingCount} / 確定済み: {confirmedReportableCount}
          </p>
        </div>
        {reportProgressActive && (
          <div className="create-snapshot-progress" role="status" aria-live="polite" style={{ marginTop: "0.7rem" }}>
            <div
              className="create-snapshot-progress-track"
              role="progressbar"
              aria-label="結果報告の進捗"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(reportProgressPercent)}
            >
              <div
                className="create-snapshot-progress-fill"
                style={{ width: `${reportProgressPercent}%` }}
              />
            </div>
            <p className="create-snapshot-progress-meta">
              {reportProgressLabel}
              {reportProgressHasProgress ? ` (${Math.round(reportProgressPercent)}%)` : ""}
            </p>
          </div>
        )}
        {showSnapshotRefreshProgress && (
          <div className="create-snapshot-progress" role="status" aria-live="polite" style={{ marginTop: "0.45rem" }}>
            <div
              className="create-snapshot-progress-track"
              role="progressbar"
              aria-label="報告後スナップショット更新の進捗"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(snapshotProgressPercent)}
            >
              <div
                className="create-snapshot-progress-fill"
                style={{ width: `${snapshotProgressPercent}%` }}
              />
            </div>
            <p className="create-snapshot-progress-meta">
              {`報告後スナップショット更新: ${snapshotProgressLabel}`}
              {snapshotProgressHasTotal ? ` (${Math.round(snapshotProgressPercent)}%)` : ""}
            </p>
          </div>
        )}
        <p className="meta">カード枠が黄色の試合は、現在のスナップショットからローカル変更があります。</p>
      </section>

      {hasSnapshot && (
        <section className="panel">
          <h2>{eventAlias.trim() !== "" ? eventAlias : "未設定"}</h2>
          <p className="meta">start.ggのtournament名: {tournamentName}</p>
          <p className="meta">start.ggのevent名: {eventName}</p>

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
                        {group.phaseName} / Pool {group.phaseGroupName} ({group.sets.length} sets)
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
                <p className="meta">sets: {selectedPhasePoolGroup.sets.length}</p>

                {getBracketProgressionModel(selectedPhasePoolGroup.bracketType) === "round_robin" ? (
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
                  <EliminationBracket
                    scaleStyle={bracketScaleStyle}
                    phaseGroupKey={selectedPhasePoolGroup.key}
                    seeds={selectedPhasePoolGroup.seeds}
                    seedMap={selectedPhasePoolGroup.seedMap}
                    sections={eliminationSections}
                    onActivateSet={onEliminationSetActivate}
                    onOpenSet={onOpenSet}
                  />
                )}
              </section>
            )}
          </div>
        </section>
      )}
    </>
  );
}
