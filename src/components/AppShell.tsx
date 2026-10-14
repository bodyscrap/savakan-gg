import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";

export function useAppVersion(): string {
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    let alive = true;

    void getVersion()
      .then((version) => {
        if (alive) {
          setAppVersion(version);
        }
      })
      .catch(() => {
        // Non-Tauri environments do not expose app metadata.
      });

    return () => {
      alive = false;
    };
  }, []);

  return appVersion;
}

export type AppTab = "create" | "tournament" | "call-list" | "bracket" | "item-list" | "users" | "settings" | "overlay";

type AppTabDefinition = {
  id: AppTab;
  label: string;
  icon: string;
  implemented: boolean;
};

const APP_TABS: AppTabDefinition[] = [
  { id: "create", label: "スナップショット", icon: "➕", implemented: true },
  { id: "tournament", label: "スナップショット&メタデータ設定", icon: "⚙", implemented: true },
  { id: "bracket", label: "ブラケット", icon: "🏆", implemented: true },
  { id: "overlay", label: "オーバーレイ", icon: "📺", implemented: true },
  { id: "item-list", label: "アイテムリスト", icon: "📚", implemented: true },
  { id: "call-list", label: "呼出リスト", icon: "📣", implemented: true },
  { id: "users", label: "プレイヤーリスト", icon: "👥", implemented: true },
  { id: "settings", label: "設定", icon: "🔧", implemented: true },
];

type SidebarSummary = {
  name: string;
  slug: string;
  eventCount?: number;
  tournamentName?: string;
} | null;

export type AppStatusProgress = {
  id: string;
  label: string;
  percent: number;
  valueLabel?: string;
  ariaLabel: string;
};

type AppShellProps = {
  appVersion: string;
  activeTab: AppTab;
  onTabSelect: (tab: AppTab) => void;
  otherDeviceCallCount: number;
  receivedPlayingCount: number;
  sidebarSummary: SidebarSummary;
  headerContent?: ReactNode;
  message: string;
  error: string;
  statusProgresses: AppStatusProgress[];
  children: ReactNode;
};

export function AppShell({
  appVersion,
  activeTab,
  onTabSelect,
  otherDeviceCallCount,
  receivedPlayingCount,
  sidebarSummary,
  headerContent,
  message,
  error,
  statusProgresses,
  children,
}: AppShellProps) {
  const activeTabLabel = APP_TABS.find((tab) => tab.id === activeTab)?.label ?? "大会管理";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="sidebar-head-title">
            <h1>savakan-gg</h1>
            {appVersion !== "" ? <span className="app-version">v{appVersion}</span> : null}
          </div>
        </div>

        {sidebarSummary ? (
          <button
            type="button"
            className="sidebar-summary sidebar-summary-button"
            title="選択中のスナップショットを管理"
            aria-label={`選択中のスナップショットを管理: ${sidebarSummary.name}`}
            onClick={() => onTabSelect("tournament")}
          >
            <span className="meta">選択中のスナップショット</span>
            <span className="summary-name">{sidebarSummary.name}</span>
          </button>
        ) : (
          <div className="sidebar-summary">
            <p className="meta">選択中のスナップショット</p>
            <p className="summary-meta">未選択</p>
          </div>
        )}

        <nav className="tab-nav" role="tablist" aria-label="メインタブ">
          {APP_TABS.filter((tab) => tab.id !== "tournament").map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={`tab-trigger ${activeTab === tab.id ? "active" : ""}`}
              aria-selected={activeTab === tab.id}
              disabled={!tab.implemented}
              title={tab.implemented ? tab.label : `${tab.label} は未実装です`}
              onClick={() => onTabSelect(tab.id)}
            >
              <span aria-hidden="true">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.id === "call-list" && (
                <span className="tab-count-badges">
                  {otherDeviceCallCount > 0 && (
                    <span
                      className="tab-count-badge tab-count-badge--calls"
                      aria-label={`他端末呼び出し ${otherDeviceCallCount}件`}
                      title={`他端末呼び出し ${otherDeviceCallCount}件`}
                    >
                      {otherDeviceCallCount >= 10 ? "9+" : otherDeviceCallCount}
                    </span>
                  )}
                  {receivedPlayingCount > 0 && (
                    <span
                      className="tab-count-badge tab-count-badge--playing"
                      aria-label={`受信したプレイ中通知 ${receivedPlayingCount}件`}
                      title={`受信したプレイ中通知 ${receivedPlayingCount}件`}
                    >
                      {receivedPlayingCount >= 10 ? "9+" : receivedPlayingCount}
                    </span>
                  )}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      <main className={`content ${activeTab === "call-list" ? "call-list-mode" : ""}`}>
        <section className="hero">
          {activeTab === "call-list" ? (
            headerContent
          ) : (
            <h2>{activeTabLabel}</h2>
          )}
        </section>

        {children}
      </main>

      <section className="status-bar" aria-label="処理状況" role="status" aria-live="polite">
        {message !== "" && <p className="message success">{message}</p>}
        {error !== "" && <p className="message error">{error}</p>}
        {statusProgresses.map((progress) => (
          <div className="status-progress" key={progress.id}>
            <div className="status-progress-label">
              <span>{progress.label}</span>
              {progress.valueLabel && <span>{progress.valueLabel}</span>}
            </div>
            <div
              className="create-snapshot-progress-track"
              role="progressbar"
              aria-label={progress.ariaLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress.percent)}
            >
              <div
                className="create-snapshot-progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        ))}
        {message === "" && error === "" && statusProgresses.length === 0 && (
          <span className="status-bar-idle">待機中</span>
        )}
      </section>
    </div>
  );
}
