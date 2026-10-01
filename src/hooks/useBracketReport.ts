import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type BracketBatchConflict = {
  setId: string;
  fullRoundText: string;
  localWinnerId: string;
  remoteWinnerId: string | null;
  remoteState: number;
  entrantNames: string[];
};

export type BatchReportProgress = {
  totalCount: number;
  reportedCount: number;
  skippedCount: number;
};

export type BatchConflictDialogState = {
  conflict: BracketBatchConflict;
  progress: BatchReportProgress;
};

type BracketReportProgressEvent = {
  phase: string;
  totalCount: number;
  processedCount: number;
  reportedCount: number;
  skippedCount: number;
  currentSetId: string | null;
};

type BracketBatchReportResult<TWorkspace> = {
  workspace: TWorkspace;
  processedCount: number;
  reportedCount: number;
  skippedCount: number;
  completed: boolean;
  conflict: BracketBatchConflict | null;
};

type UseBracketReportOptions<TWorkspace> = {
  slug: string;
  eventId: string | null;
  perPage: number;
  reportableCount: number;
  setWorkspace: (workspace: TWorkspace) => void;
  closeMatchDialog: () => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  setMessage: (message: string) => void;
  clearSnapshotProgress: () => void;
};

const BRACKET_REPORT_PROGRESS_EVENT = "bracket_report_progress";

export function useBracketReport<TWorkspace>({
  slug,
  eventId,
  perPage,
  reportableCount,
  setWorkspace,
  closeMatchDialog,
  setBusy,
  setError,
  setMessage,
  clearSnapshotProgress,
}: UseBracketReportOptions<TWorkspace>) {
  const [progress, setProgress] = useState<BracketReportProgressEvent | null>(null);
  const [conflictDialog, setConflictDialog] = useState<BatchConflictDialogState | null>(null);
  const [forceOverwriteRemaining, setForceOverwriteRemaining] = useState(false);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const off = await listen<BracketReportProgressEvent>(BRACKET_REPORT_PROGRESS_EVENT, (event) => {
          if (alive) {
            setProgress(event.payload);
          }
        });
        if (alive) {
          unlisten = off;
        } else {
          off();
        }
      } catch {
        // Non-Tauri environments do not provide the progress event.
      }
    })();

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const progressPercent = useMemo(() => {
    if (!progress) {
      return 0;
    }
    if (progress.totalCount <= 0) {
      return 100;
    }
    return Math.max(0, Math.min(100, (progress.processedCount / progress.totalCount) * 100));
  }, [progress]);

  const progressLabel = useMemo(() => {
    if (!progress) {
      return "";
    }

    const doneText = `${progress.processedCount}/${progress.totalCount} 件`;
    const detailText = `送信 ${progress.reportedCount} / スキップ ${progress.skippedCount}`;

    if (progress.phase === "starting") {
      return `結果報告の準備中...（${doneText}）`;
    }
    if (progress.phase === "processing") {
      return progress.currentSetId
        ? `結果報告中 ${doneText} / ${detailText} / set ${progress.currentSetId}`
        : `結果報告中 ${doneText} / ${detailText}`;
    }
    if (progress.phase === "refreshingSnapshot") {
      return `結果報告後のスナップショット更新中... ${doneText} / ${detailText}`;
    }
    if (progress.phase === "paused") {
      return progress.currentSetId
        ? `競合のため一時停止 ${doneText} / ${detailText} / set ${progress.currentSetId}`
        : `競合のため一時停止 ${doneText} / ${detailText}`;
    }
    if (progress.phase === "completed") {
      return `結果報告が完了しました。${detailText}`;
    }
    return `結果報告中 ${doneText} / ${detailText}`;
  }, [progress]);

  function cancelConflict() {
    setConflictDialog(null);
    setForceOverwriteRemaining(false);
    setProgress(null);
    setMessage("一括報告を中断しました。未送信のsetはそのまま残しています。");
  }

  async function runBatchReport(
    currentProgress: BatchReportProgress,
    forceOverwriteCurrentConflict: boolean,
    forceOverwriteRemainingConflicts: boolean,
  ) {
    if (!eventId) {
      throw new Error("先にイベントを選択してください。");
    }

    const result = await invoke<BracketBatchReportResult<TWorkspace>>("report_confirmed_sets_from_bracket", {
      input: {
        slug,
        eventId,
        perPage,
        forceOverwriteCurrentConflict,
        forceOverwriteRemainingConflicts,
      },
    });

    setWorkspace(result.workspace);
    closeMatchDialog();

    const nextProgress: BatchReportProgress = {
      totalCount: currentProgress.totalCount,
      reportedCount: currentProgress.reportedCount + result.reportedCount,
      skippedCount: currentProgress.skippedCount + result.skippedCount,
    };

    if (result.completed) {
      setConflictDialog(null);
      setForceOverwriteRemaining(false);
      setProgress(null);
      const unsentCount = Math.max(0, nextProgress.totalCount - nextProgress.reportedCount - nextProgress.skippedCount);
      setMessage(
        `一括報告を実行しました。対象 ${nextProgress.totalCount} 件 / 送信 ${nextProgress.reportedCount} 件 / スキップ ${nextProgress.skippedCount} 件 / 未送信 ${unsentCount} 件`,
      );
      return;
    }

    if (result.conflict) {
      setConflictDialog({ conflict: result.conflict, progress: nextProgress });
      setMessage(
        `一括報告を一時停止しました。${result.conflict.fullRoundText} で start.gg 側との競合を確認してください。`,
      );
      return;
    }

    throw new Error("一括報告の状態が不正です。競合情報を取得できませんでした。");
  }

  async function startReport() {
    if (!eventId) {
      setError("先にイベントを選択してください。");
      return;
    }
    if (slug === "") {
      setError("大会IDを入力してください。");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    clearSnapshotProgress();
    setProgress({
      phase: "starting",
      totalCount: reportableCount,
      processedCount: 0,
      reportedCount: 0,
      skippedCount: 0,
      currentSetId: null,
    });
    setConflictDialog(null);
    setForceOverwriteRemaining(false);

    try {
      await runBatchReport({ totalCount: reportableCount, reportedCount: 0, skippedCount: 0 }, false, false);
    } catch (error) {
      setError(String(error));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  async function continueWithForceOverwrite() {
    if (!conflictDialog) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await runBatchReport(conflictDialog.progress, true, forceOverwriteRemaining);
    } catch (error) {
      setError(String(error));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  return {
    progress,
    progressPercent,
    progressLabel,
    conflictDialog,
    forceOverwriteRemaining,
    setForceOverwriteRemaining,
    cancelConflict,
    continueWithForceOverwrite,
    startReport,
  };
}