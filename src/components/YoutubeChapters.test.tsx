import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultVideoChapterSettings, saveVideoChapterSettings } from "../domain/videoChapterSettings";
import { ReferenceStreamMatchInfo, StreamStartEditor, YoutubeChapters } from "./YoutubeChapters";

describe("video chapter generation", () => {
  it("offers local datetime editing and clearing for the selected match", () => {
    const date = new Date(2026, 9, 19, 12, 34, 56, 123);
    const html = renderToStaticMarkup(<StreamStartEditor
      set={{ setId: "set-a", setLabel: "Round 1", matchup: "Alice vs Bob", startedAt: date.getTime() }}
      disabled={false}
      onUpdate={async () => {}}
    />);
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('value="2026-10-19T12:34:56.123"');
    expect(html).toContain('step="0.001"');
    expect(html).toContain("端末の現地時刻");
    expect(html).toContain("記録日時を修正</button>");
    expect(html).toContain("配信記録のクリア</button>");
    expect(html).toMatch(/class="chapter-stream-start-editor"[\s\S]*type="datetime-local"[\s\S]*>記録日時を修正<\/button>[\s\S]*>配信記録のクリア<\/button>/);
  });

  it("disables record changes while another operation is running", () => {
    const html = renderToStaticMarkup(<StreamStartEditor
      set={{ setId: "set-a", setLabel: "Round 1", matchup: "Alice vs Bob", startedAt: Date.now() }}
      disabled
      onUpdate={async () => {}}
    />);
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });

  it("restores saved options and inputs when reopening the screen", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    } });
    try {
      saveVideoChapterSettings("test", "event", {
        ...defaultVideoChapterSettings(),
        openingText: "大会開始",
        referenceVideoTime: "1:2:3",
        referenceSetId: "set-b",
        showResults: true,
        selectedCategorySlots: [0, 2],
      });
      const html = renderToStaticMarkup(
        <YoutubeChapters slug="tournament/test" eventId="event" useAliasName={false} />,
      );
      expect(html).toContain('value="大会開始"');
      expect(html).toContain('value="1:2:3"');
      expect(html.match(/checked=""/g)).toHaveLength(3);
      expect(html).toContain('value="set-b" selected=""');
      expect(html).toMatch(/<textarea[^>]*><\/textarea>/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the video chapter feature name", () => {
    const html = renderToStaticMarkup(
      <YoutubeChapters slug="tournament/test" eventId="event" useAliasName={false} />,
    );
    expect(html).toContain("動画チャプター生成");
    expect(html).not.toContain("YouTube チャプター生成");
    expect(html).toContain("基準の試合の動画上の開始時刻");
    expect(html).toContain("時刻合わせの基準にする試合（配信開始順）");
    expect(html).toContain("(未記録)");
    expect(html).toContain("テキスト生成</button>");
    expect(html).toContain("全配信開始時刻をクリア</button>");
    expect(html).toMatch(/class="chapter-record-actions"><button[^>]*>配信開始記録を再読み込み<\/button><button[^>]*>全配信開始時刻をクリア<\/button><\/div>/);
    expect(html).toContain('class="chapter-generation-controls"');
    expect(html).toMatch(/テキスト生成<\/button><button[^>]*disabled=""[^>]*>テキストをコピー<\/button><\/div>/);
    expect(html).not.toContain("チャプターをコピー</button>");
    expect(html).toMatch(/<textarea[^>]*><\/textarea>/);
    expect(html).not.toContain("形式で入力してください");
  });

  it.each([true, false])("uses the existing player display setting without another checkbox when enabled=%s", (enabled) => {
    const html = renderToStaticMarkup(
      <YoutubeChapters slug="tournament/test" eventId="event" useAliasName={enabled} />,
    );
    expect(html.match(/type="checkbox"/g)).toHaveLength(4);
    expect(html).toContain("勝敗を表示する");
    expect(html).not.toContain('checked=""');
    expect(html).toContain("カテゴリ1");
    expect(html).toContain("カテゴリ2");
    expect(html).toContain("カテゴリ3");
    expect(html).not.toMatch(/<label[^>]*><input[^>]*type="checkbox"[^>]*>エイリアス名を使う/);
    expect(html).toContain("「プレイヤー表示」の「エイリアス名を使う」設定");
    expect(html).toContain("エイリアス未設定の場合は元の名前を使います");
  });

  it("shows the first match details without requiring a video timestamp", () => {
    const startedAt = Date.parse("2026-10-18T12:00:00Z");
    const html = renderToStaticMarkup(
      <ReferenceStreamMatchInfo
        count={3}
        set={{
          setId: "set-a",
          setLabel: "Main / Pool A / Set A / Winners Round 1",
          startedAt,
          matchup: "Alice vs Bob",
        }}
      />,
    );
    expect(html).toContain('aria-label="基準の試合の情報"');
    expect(html).toContain("基準の試合（配信記録 3件中）");
    expect(html).toContain("Alice vs Bob");
    expect(html).toContain("1P vs 2P");
    expect(html).toContain("Main / Pool A / Set A / Winners Round 1");
    expect(html).toContain(new Date(startedAt).toLocaleString());
    expect(html).toContain("動画上でこの対戦を探し");
  });
});
