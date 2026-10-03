import type { FormEvent } from "react";

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
  token: string;
  onTokenChange: (value: string) => void;
  slug: string;
  onSlugChange: (value: string) => void;
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
  createSnapshotProgress: EventSnapshotProgress | null;
  createSnapshotProgressPercent: number;
  createSnapshotProgressLabel: string;
};

function createPreviewEventSearchLabel(event: TournamentEventPreviewItem): string {
  return `${event.eventName} (${event.eventId})`;
}

export function CreateSnapshot({
  token,
  onTokenChange,
  slug,
  onSlugChange,
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
  createSnapshotProgress,
  createSnapshotProgressPercent,
  createSnapshotProgressLabel,
}: CreateSnapshotProps) {
  const selectedEventName = createPreview?.events.find((event) => event.eventId === createSelectedEventId)?.eventName ?? "-";

  return (
    <div className="create-layout">
      <section className="panel create-layout-half">
        <h2>1.APIトークンの設定</h2>

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
          <button type="submit" disabled={createBusy || token.trim() === ""}>
            APIトークンを保存
          </button>
        </form>
      </section>

      <section className="panel create-layout-half">
        <h2>2. tournamentの選択</h2>
        <form
          className="form"
          onSubmit={onLoadPreview}
          style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}
        >
          <input
            value={slug}
            onChange={(e) => onSlugChange(e.currentTarget.value)}
            placeholder="大会ID (例: sabakan-weekly-1)"
            style={{ flex: "1 1 18rem" }}
          />
          <button type="submit" disabled={createBusy || !canLoadPreview}>
            event一覧取得
          </button>
        </form>
      </section>

      <section className="panel create-layout-full">
        <h2>3. tournament内のevent一覧</h2>
        {createPreviewLoadFailed ? (
          <p className="meta">event一覧の取得に失敗しました</p>
        ) : !createPreview ? (
          <p className="meta">先に tournament を選択してevent一覧を取得してください。</p>
        ) : createPreview.events.length === 0 ? (
          <p className="meta">この tournament にはイベントがありません。</p>
        ) : (
          <>
            <p className="meta">
              {createPreview.name} / tournament ID: {createPreview.tournamentId} / updatedAt: {new Date(createPreview.updatedAt).toLocaleString()}
            </p>
            <div className="form" style={{ marginTop: "0.7rem" }}>
              <label htmlFor="create-event-search-input" style={{ display: "grid", gap: "0.3rem" }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span className="meta">イベント検索</span>
                  <span className="meta">候補: {createFilteredEvents.length}件 / 全{createPreview.events.length}件</span>
                </span>
                <input
                  id="create-event-search-input"
                  type="search"
                  value={createEventSearchInput}
                  onChange={(e) => onEventSearchInputChange(e.currentTarget.value)}
                  placeholder="event名 または eventId で検索"
                  autoComplete="off"
                />
              </label>
              <label htmlFor="create-event-select" style={{ display: "grid", gap: "0.3rem" }}>
                <span className="meta">event選択(選択: {selectedEventName})</span>
                <select
                  id="create-event-select"
                  value={createFilteredEvents.some((event) => event.eventId === createSelectedEventId) ? createSelectedEventId : ""}
                  onChange={(e) => onEventDropdownChange(e.currentTarget.value)}
                >
                  <option value="" disabled>
                    {createFilteredEvents.length === 0 ? "一致するeventがありません" : "eventを選択"}
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
        <h2>4. 選択eventのスナップショット作成</h2>
        <div className="form" style={{ display: "flex", alignItems: "end", flexWrap: "wrap", marginTop: "0.8rem" }}>
          <label htmlFor="create-event-alias" style={{ display: "grid", gap: "0.3rem", flex: "1 1 18rem" }}>
            <span style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap" }}>
              <span className="meta">エイリアス名</span>
              <span className="meta">選択中 event: {selectedEventName}</span>
            </span>
            <input
              id="create-event-alias"
              value={createEventAlias}
              onChange={(e) => onEventAliasChange(e.currentTarget.value)}
              placeholder="アプリ内表示用のevent alias"
            />
          </label>
          <button type="button" disabled={createBusy || !canCreateSnapshot} onClick={onCreateSnapshot}>
            スナップショット作成
          </button>
        </div>
        {(createBusy || createSnapshotProgress) && (
          <div className="create-snapshot-progress" role="status" aria-live="polite">
            <div
              className="create-snapshot-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(createSnapshotProgressPercent)}
            >
              <div
                className="create-snapshot-progress-fill"
                style={{ width: `${createSnapshotProgressPercent}%` }}
              />
            </div>
            <p className="create-snapshot-progress-meta">
              {createSnapshotProgressLabel}
              {createSnapshotProgress && createSnapshotProgress.totalSets !== null
                ? ` (${Math.round(createSnapshotProgressPercent)}%)`
                : ""}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}