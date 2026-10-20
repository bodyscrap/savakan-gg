import { useEffect, useRef, useState } from "react";
import {
  collectStreamChapterSets,
  generateYoutubeChapters,
  type StreamChapterSet,
} from "../domain/youtubeChapters";
import { clearSetStreamStarts, loadTournamentWorkspace, updateSetStreamStart, type TournamentWorkspace } from "../domain/tournamentWorkspaceRepository";
import {
  defaultVideoChapterSettings,
  loadVideoChapterSettings,
  saveVideoChapterSettings,
  type VideoChapterSettings,
} from "../domain/videoChapterSettings";

type YoutubeChaptersProps = {
  slug: string;
  eventId: string;
  useAliasName: boolean;
};

export function ReferenceStreamMatchInfo({ set, count }: { set: StreamChapterSet; count: number }) {
  return (
    <section className="stat-card" aria-label="基準の試合の情報">
      <h4>基準の試合（配信記録 {count}件中）</h4>
      <p><strong>{set.matchup}</strong>（1P vs 2P）</p>
      <p>Phase / Pool / Set / ラウンド: {set.setLabel}</p>
      <p className="meta">配信開始記録時刻: {new Date(set.startedAt).toLocaleString()}</p>
      <p className="meta">動画上でこの対戦を探し、試合の配信が始まった時刻を下に入力してください。</p>
    </section>
  );
}

export function StreamStartEditor({ set, disabled, onUpdate }: {
  set: StreamChapterSet;
  disabled: boolean;
  onUpdate: (startedAt: string | null) => Promise<void>;
}) {
  const [dateTime, setDateTime] = useState(() => {
    const date = new Date(set.startedAt);
    const pad = (value: number, length = 2) => String(value).padStart(length, "0");
    return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  });
  const [error, setError] = useState("");
  return (
    <form className="chapter-stream-start-editor" onSubmit={(event) => {
      event.preventDefault();
      const date = new Date(dateTime);
      if (!dateTime || !Number.isFinite(date.getTime())) {
        setError("有効な配信開始日時を入力してください。");
        return;
      }
      setError("");
      void onUpdate(date.toISOString());
    }}>
      <label>
        選択した試合の配信開始日時（端末の現地時刻）
        <input type="datetime-local" step="0.001" required value={dateTime} disabled={disabled}
          onChange={(event) => { setDateTime(event.currentTarget.value); setError(""); }} />
      </label>
      <button type="submit" disabled={disabled}>記録日時を修正</button>
      <button type="button" className="ghost" disabled={disabled} onClick={() => {
          if (window.confirm(`選択した試合「${set.matchup}」の配信開始記録を削除します。チャプター生成の対象から外れます。実行しますか？`)) {
            void onUpdate(null);
          }
        }}>配信記録のクリア</button>
      {error && <p className="error-text" role="alert">{error}</p>}
    </form>
  );
}

export function YoutubeChapters({ slug, eventId, useAliasName }: YoutubeChaptersProps) {
  const [workspace, setWorkspace] = useState<TournamentWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [initialSettings] = useState(() => {
    try {
      return { settings: loadVideoChapterSettings(slug, eventId), error: "" };
    } catch (error) {
      return { settings: defaultVideoChapterSettings(), error: `動画チャプター設定の読み込みに失敗しました: ${String(error)}` };
    }
  });
  const [settings, setSettings] = useState(initialSettings.settings);
  const settingsRef = useRef(settings);
  const [settingsError, setSettingsError] = useState(initialSettings.error);
  const { openingText, referenceVideoTime, referenceSetId, selectedCategorySlots, showResults } = settings;
  const [copyStatus, setCopyStatus] = useState("");
  const [copyError, setCopyError] = useState("");
  const [text, setText] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearStatus, setClearStatus] = useState("");
  const [clearError, setClearError] = useState("");
  const generationRequestRef = useRef(0);

  function updateSettings(changes: Partial<VideoChapterSettings>) {
    const next = { ...settingsRef.current, ...changes };
    settingsRef.current = next;
    setSettings(next);
    clearGeneratedText();
    try {
      saveVideoChapterSettings(slug, eventId, next);
      setSettingsError("");
    } catch (error) {
      setSettingsError(`動画チャプター設定の保存に失敗しました: ${String(error)}`);
    }
  }

  function clearGeneratedText() {
    generationRequestRef.current += 1;
    setGenerating(false);
    setText("");
    setGenerationError("");
    setCopyStatus("");
    setCopyError("");
  }

  useEffect(() => {
    clearGeneratedText();
    return () => { generationRequestRef.current += 1; };
  }, [useAliasName]);

  useEffect(() => {
    let disposed = false;
    clearGeneratedText();
    setLoading(true);
    setLoadError("");
    setCopyStatus("");
    setCopyError("");
    setText("");
    setGenerationError("");
    void loadTournamentWorkspace(slug, eventId).then((result) => {
      if (!disposed) {
        setWorkspace(result);
        setLoading(false);
      }
    }).catch((error: unknown) => {
      if (!disposed) {
        setWorkspace(null);
        setLoadError(`配信開始記録の読み込みに失敗しました: ${String(error)}`);
        setLoading(false);
      }
    });
    return () => {
      disposed = true;
      generationRequestRef.current += 1;
    };
  }, [slug, eventId, revision]);

  let sets: StreamChapterSet[] = [];
  let collectionError = "";
  if (workspace && !loading && !loadError) {
    try {
      sets = collectStreamChapterSets(workspace, eventId, useAliasName, selectedCategorySlots, showResults);
    } catch (error) {
      collectionError = String(error instanceof Error ? error.message : error);
    }
  }
  const referenceSet = referenceSetId === "" ? sets[0] : sets.find((set) => set.setId === referenceSetId);

  async function generateText() {
    clearGeneratedText();
    const requestId = generationRequestRef.current;
    const selectedReferenceSetId = referenceSet?.setId ?? referenceSetId;
    setGenerating(true);
    try {
      const latestWorkspace = await loadTournamentWorkspace(slug, eventId);
      if (requestId !== generationRequestRef.current) {
        return;
      }
      setWorkspace(latestWorkspace);
      setLoadError("");
      const latestSets = collectStreamChapterSets(latestWorkspace, eventId, useAliasName, selectedCategorySlots, showResults);
      setText(generateYoutubeChapters(latestSets, openingText, referenceVideoTime, selectedReferenceSetId || undefined));
    } catch (error) {
      if (requestId === generationRequestRef.current) {
        setGenerationError(`テキスト生成に失敗しました: ${String(error instanceof Error ? error.message : error)}`);
      }
    } finally {
      if (requestId === generationRequestRef.current) {
        setGenerating(false);
      }
    }
  }

  async function copyChapters() {
    setCopyStatus("");
    setCopyError("");
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("この環境ではクリップボードAPIが使用できません。");
      }
      await navigator.clipboard.writeText(text);
      setCopyStatus("チャプターをクリップボードにコピーしました。");
    } catch (error) {
      setCopyError(`コピーに失敗しました。生成テキストを手動でコピーしてください: ${String(error)}`);
    }
  }

  async function clearStreamStarts() {
    if (!window.confirm("選択中イベントの全 Set の配信開始時刻を削除します。この操作は元に戻せません。試合結果やプレイヤー情報は変更しません。実行しますか？")) {
      return;
    }
    clearGeneratedText();
    setClearing(true);
    setClearStatus("");
    setClearError("");
    try {
      const latestWorkspace = await clearSetStreamStarts(slug, eventId);
      setWorkspace(latestWorkspace);
      setLoadError("");
      updateSettings({ referenceVideoTime: "", referenceSetId: "" });
      setClearStatus("選択中イベントの全配信開始時刻をクリアしました。");
    } catch (error) {
      setClearError(`配信開始時刻のクリアに失敗しました: ${String(error)}`);
    } finally {
      setClearing(false);
    }
  }

  async function updateReferenceStreamStart(startedAt: string | null) {
    if (!referenceSet) {
      setClearError("基準の試合を選択してください。");
      return;
    }
    const setId = referenceSet.setId;
    clearGeneratedText();
    setClearing(true);
    setClearStatus("");
    setClearError("");
    try {
      const latestWorkspace = await updateSetStreamStart(slug, eventId, setId, startedAt);
      setWorkspace(latestWorkspace);
      setLoadError("");
      if (startedAt === null) {
        updateSettings({ referenceSetId: "", referenceVideoTime: "" });
      } else {
        updateSettings({ referenceSetId: setId });
      }
      setClearStatus(startedAt === null ? "選択した試合の配信開始記録をクリアしました。" : "選択した試合の配信開始日時を保存しました。");
    } catch (error) {
      setClearError(`配信開始記録の更新に失敗しました: ${String(error)}`);
    } finally {
      setClearing(false);
    }
  }

  return (
    <section className="panel youtube-chapters" aria-labelledby="youtube-chapters-title">
      <div className="panel-toolbar compact">
        <h3 id="youtube-chapters-title">動画チャプター生成</h3>
        <div className="chapter-record-actions">
          <button type="button" className="ghost" disabled={loading || generating || clearing} onClick={() => {
            setClearStatus("");
            setClearError("");
            setRevision((value) => value + 1);
          }}>
            配信開始記録を再読み込み
          </button>
          <button type="button" className="ghost" disabled={loading || generating || clearing} onClick={() => void clearStreamStarts()}>
            全配信開始時刻をクリア
          </button>
        </div>
      </div>
      <p className="meta">選択中イベントの各 Set に最後に記録された配信開始時刻を使用します。</p>
      <p className="meta">上部の「プレイヤー表示」の「エイリアス名を使う」設定を基準の試合情報と生成テキストに適用します。エイリアス未設定の場合は元の名前を使います。</p>
      {loading && <p className="meta" role="status">配信開始記録を読み込み中...</p>}
      {loadError && <p className="error-text" role="alert">{loadError}</p>}
      {clearing && <p className="meta" role="status">配信開始記録を更新中...</p>}
      {clearStatus && <p className="meta" role="status">{clearStatus}</p>}
      {clearError && <p className="error-text" role="alert">{clearError}</p>}
      {settingsError && <p className="error-text" role="alert">{settingsError}</p>}
      <label>
        00:00 のテキスト
        <input type="text" value={openingText} onChange={(event) => {
          updateSettings({ openingText: event.currentTarget.value });
        }} />
      </label>
      <fieldset className="chapter-item-categories">
        <legend>プレイヤー表記のオプション</legend>
        <label className="checkbox-row">
          <input type="checkbox" checked={showResults} onChange={(event) => {
            updateSettings({ showResults: event.currentTarget.checked });
          }} />
          勝敗を表示する
        </label>
      </fieldset>
      <p className="meta">確定した勝者は〇、敗者は●を名前の前に表示し、記号のすぐ右に取得ゲーム数を付けます。直接勝敗指定・DQではゲーム数を表示しません。</p>
      <fieldset className="chapter-item-categories">
        <legend>プレイヤー名の後ろに表示するアイテム</legend>
        {[0, 1, 2].map((slotIndex) => {
          const category = workspace?.localMeta.events.find((event) => event.eventId === eventId)
            ?.eventManagement?.itemListSnapshots[slotIndex];
          return (
            <label className="checkbox-row" key={slotIndex}>
              <input
                type="checkbox"
                checked={selectedCategorySlots.includes(slotIndex)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  updateSettings({ selectedCategorySlots: checked
                    ? [...selectedCategorySlots, slotIndex]
                    : selectedCategorySlots.filter((slot) => slot !== slotIndex) });
                }}
              />
              カテゴリ{slotIndex + 1}{category?.categoryName ? ` (${category.categoryName})` : ""}
            </label>
          );
        })}
      </fieldset>
      <label>
        時刻合わせの基準にする試合（配信開始順）
        <select
          value={referenceSet?.setId ?? referenceSetId}
          disabled={loading || clearing || sets.length === 0}
          onChange={(event) => {
            updateSettings({ referenceSetId: event.currentTarget.value, referenceVideoTime: "" });
          }}
        >
          {sets.length === 0 && <option value="">配信開始記録がありません</option>}
          {referenceSetId && !referenceSet && <option value={referenceSetId}>基準の試合を選び直してください</option>}
          {sets.map((set, index) => (
            <option key={set.setId} value={set.setId}>
              {index + 1}. {set.setLabel} — {set.matchup}
            </option>
          ))}
        </select>
      </label>
      {referenceSet && <ReferenceStreamMatchInfo set={referenceSet} count={sets.length} />}
      {referenceSet && <StreamStartEditor
        key={`${referenceSet.setId}:${referenceSet.startedAt}`}
        set={referenceSet}
        disabled={loading || generating || clearing}
        onUpdate={updateReferenceStreamStart}
      />}
      <div className="chapter-generation-controls">
        <label>
          基準の試合の動画上の開始時刻
          <input type="text" placeholder="例: 00:05:30" value={referenceVideoTime} onChange={(event) => {
            updateSettings({
              referenceVideoTime: event.currentTarget.value,
              referenceSetId: referenceSet?.setId ?? referenceSetId,
            });
          }} aria-describedby="youtube-chapters-time-help" />
        </label>
        <button type="button" disabled={loading || generating || clearing} onClick={() => {
          setClearStatus("");
          void generateText();
        }}>
          テキスト生成
        </button>
        <button type="button" className="ghost" disabled={!text || loading} onClick={() => void copyChapters()}>
          テキストをコピー
        </button>
      </div>
      {generating && <p className="meta" role="status">最新データからテキストを生成中...</p>}
      <p className="meta" id="youtube-chapters-time-help">hh:mm:ss または mm:ss で入力し、「テキスト生成」を押すと各 Set の動画上の開始時刻を計算して生成します。時・分・秒はそれぞれ1桁でも入力できます（例: 1:2:3）。</p>
      <p className="meta">再生時刻が 00:00:10 より前になる試合は、時刻の代わりに (未記録) と表示します。</p>
      {collectionError && <p className="error-text" role="alert">{collectionError}</p>}
      {!loading && workspace && !loadError && !collectionError && sets.length === 0 && (
        <p className="meta">配信開始時刻が記録された Set がありません。</p>
      )}
      {generationError && <p className="error-text" role="alert">{generationError}</p>}
      <label>
        生成テキスト
        <textarea rows={Math.min(16, Math.max(5, sets.length + 1))} readOnly value={text} />
      </label>
      {copyStatus && <p className="meta" role="status">{copyStatus}</p>}
      {copyError && <p className="error-text" role="alert">{copyError}</p>}
      <p className="meta">YouTube でチャプターとして認識されるには、00:00 から始まる3件以上の項目と、各10秒以上の長さが必要です。</p>
    </section>
  );
}
