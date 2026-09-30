import type { ReactNode } from "react";

export type AppTab = "home" | "create" | "tournament" | "message" | "call-list" | "bracket" | "item-list" | "users" | "settings" | "overlay";

type AppTabDefinition = {
  id: AppTab;
  label: string;
  icon: string;
  implemented: boolean;
};

const APP_TABS: AppTabDefinition[] = [
  { id: "create", label: "新規作成", icon: "➕", implemented: true },
  { id: "home", label: "大会一覧", icon: "🏠", implemented: true },
  { id: "tournament", label: "大会管理", icon: "⚙", implemented: true },
  { id: "bracket", label: "ブラケット", icon: "🏆", implemented: true },
  { id: "overlay", label: "オーバーレイ", icon: "📺", implemented: true },
  { id: "item-list", label: "アイテムリスト", icon: "📚", implemented: true },
  { id: "message", label: "メッセージ", icon: "💬", implemented: true },
  { id: "call-list", label: "呼び出しリスト", icon: "📣", implemented: true },
  { id: "users", label: "プレイヤーリスト", icon: "👥", implemented: true },
  { id: "settings", label: "設定", icon: "🔧", implemented: true },
];

type SidebarSummary = {
  name: string;
  slug: string;
  eventCount?: number;
  tournamentName?: string;
} | null;

type AppShellProps = {
  appVersion: string;
  activeTab: AppTab;
  onTabSelect: (tab: AppTab) => void;
  unreadMessageCount: number;
  unresolvedCallCount: number;
  sidebarSummary: SidebarSummary;
  headerContent?: ReactNode;
  message: string;
  error: string;
  children: ReactNode;
};

export function AppShell({
  appVersion,
  activeTab,
  onTabSelect,
  unreadMessageCount,
  unresolvedCallCount,
  sidebarSummary,
  headerContent,
  message,
  error,
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
          <p>大会運営コンソール</p>
        </div>

        <div className="sidebar-summary">
          <p className="meta">選択中の大会</p>
          {sidebarSummary ? (
            <>
              <p className="summary-name">{sidebarSummary.name}</p>
              <p className="summary-meta">slug: {sidebarSummary.slug}</p>
              {sidebarSummary.eventCount !== undefined ? (
                <p className="summary-meta">events: {sidebarSummary.eventCount}</p>
              ) : sidebarSummary.tournamentName !== undefined ? (
                <p className="summary-meta">tournament: {sidebarSummary.tournamentName}</p>
              ) : null}
            </>
          ) : (
            <p className="summary-meta">未選択</p>
          )}
        </div>

        <nav className="tab-nav" role="tablist" aria-label="メインタブ">
          {APP_TABS.map((tab) => (
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
              {tab.id === "message" && unreadMessageCount > 0 && (
                <span className="tab-count-badge" aria-label={`未読メッセージ ${unreadMessageCount}件`}>
                  {unreadMessageCount >= 10 ? "9+" : unreadMessageCount}
                </span>
              )}
              {tab.id === "call-list" && unresolvedCallCount > 0 && (
                <span className="tab-count-badge" aria-label={`未解決の呼び出し ${unresolvedCallCount}件`}>
                  {unresolvedCallCount >= 10 ? "9+" : unresolvedCallCount}
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
            <>
              <h2>{activeTab === "create" ? "新規作成" : activeTabLabel}</h2>
              {activeTab !== "create" && (
                <p className="description">start.ggのローカルスナップショットをベースにした大会データ単位で管理</p>
              )}
            </>
          )}
        </section>

        <section className="message-stack" aria-live="polite">
          <p className={`message success ${message === "" ? "empty" : ""}`}>{message === "" ? " " : message}</p>
          <p className={`message error ${error === "" ? "empty" : ""}`}>{error === "" ? " " : error}</p>
        </section>

        {children}
      </main>
    </div>
  );
}
