import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  buildPlayerCardFileName,
  buildPrintedPlayerCardPageFileName,
  canvasToBlob,
  renderPlayerCardCanvas,
  triggerBlobDownload,
  type UserCardPlayer,
} from "./userCardCanvas";

const USER_CARD_PAGE_SIZE = 10;

export type UseUserCardsOptions = {
  tournamentId: string | null;
  tournamentName: string;
  eventId: string | null;
  eventName: string;
  eventAlias: string | null;
  entrants: Array<{ entrantId: string; entrantName: string }>;
  disableLocalCommunication: boolean;
  onError: (error: string) => void;
  onMessage: (message: string) => void;
};

export function useUserCards({
  tournamentId,
  tournamentName,
  eventId,
  eventName,
  eventAlias,
  entrants,
  disableLocalCommunication,
  onError,
  onMessage,
}: UseUserCardsOptions) {
  const [players, setPlayers] = useState<UserCardPlayer[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [selectedPlayerPreviewUrl, setSelectedPlayerPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;

    if (tournamentId === null || eventId === null) {
      setPlayers([]);
      setSelectedPlayerId("");
      return () => {
        alive = false;
      };
    }

    void (async () => {
      try {
        const playerIds = await invoke<string[]>("derive_player_ids", {
          tournamentId,
          eventId,
          entrantIds: entrants.map((entrant) => entrant.entrantId),
        });
        if (playerIds.length !== entrants.length) {
          throw new Error("選手IDの生成結果が参加者数と一致しません。");
        }
        const rows = entrants.map((entrant, index) => ({
          tournamentId,
          tournamentName,
          eventId,
          eventName,
          eventAlias: eventAlias?.trim() ? eventAlias.trim() : null,
          entrantId: entrant.entrantId,
          entrantName: entrant.entrantName,
          playerId: playerIds[index],
        }));

        if (!alive) {
          return;
        }

        setPlayers(rows);
        setSelectedPlayerIds((current) => {
          const validIds = current.filter((id) => rows.some((row) => row.playerId === id));
          return validIds.length > 0 ? validIds : rows.length > 0 ? [rows[0].playerId] : [];
        });
        setSelectedPlayerId((current) => {
          if (current !== "" && rows.some((row) => row.playerId === current)) {
            return current;
          }
          return rows[0]?.playerId ?? "";
        });
      } catch (error) {
        if (alive) {
          onError(String(error));
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [eventAlias, eventId, eventName, entrants, onError, tournamentId, tournamentName]);

  const selectedPlayer = selectedPlayerId === ""
    ? players[0] ?? null
    : players.find((player) => player.playerId === selectedPlayerId) ?? players[0] ?? null;

  useEffect(() => {
    let alive = true;

    if (!selectedPlayer) {
      setSelectedPlayerPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return "";
      });
      return () => {
        alive = false;
      };
    }

    void (async () => {
      try {
        const canvas = await renderPlayerCardCanvas(selectedPlayer);
        const blob = await canvasToBlob(canvas);
        if (!alive) {
          return;
        }

        const previewUrl = URL.createObjectURL(blob);
        setSelectedPlayerPreviewUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current);
          }
          return previewUrl;
        });
      } catch (error) {
        if (alive) {
          onError(String(error));
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [onError, selectedPlayer]);

  function handlePlayerSelect(player: UserCardPlayer, multiSelect: boolean) {
    const selectedId = player.playerId;
    setSelectedPlayerId(selectedId);

    if (!multiSelect) {
      setSelectedPlayerIds([selectedId]);
      return;
    }

    setSelectedPlayerIds((current) => {
      if (current.includes(selectedId)) {
        const next = current.filter((id) => id !== selectedId);
        return next.length > 0 ? next : [selectedId];
      }
      return [...current, selectedId];
    });
  }

  function selectAllPlayers() {
    if (players.length === 0) {
      return;
    }

    const selectedIds = players.map((player) => player.playerId);
    setSelectedPlayerIds(selectedIds);
    setSelectedPlayerId(selectedIds[selectedIds.length - 1]);
  }

  function clearPlayerSelection() {
    setSelectedPlayerIds([]);
  }

  function getSelectedPlayers(): UserCardPlayer[] {
    const selectedIds = selectedPlayerIds.length > 0
      ? selectedPlayerIds
      : selectedPlayer
        ? [selectedPlayer.playerId]
        : [];
    return players.filter((player) => selectedIds.includes(player.playerId));
  }

  async function saveSelectedCards() {
    if (disableLocalCommunication) {
      onError("ローカル通信を行わない設定のため、プレイヤーリスト機能は無効です。設定タブで解除してください。");
      return;
    }

    const selectedPlayers = getSelectedPlayers();
    if (selectedPlayers.length === 0) {
      onError(selectedPlayerIds.length === 0 && !selectedPlayer
        ? "保存するプレイヤーカードがありません。"
        : "保存対象のプレイヤーカードが見つかりませんでした。");
      return;
    }

    setBusy(true);
    onError("");
    onMessage("");

    try {
      for (const player of selectedPlayers) {
        const canvas = await renderPlayerCardCanvas(player);
        const blob = await canvasToBlob(canvas);
        triggerBlobDownload(blob, buildPlayerCardFileName(player));
      }
      onMessage(`${selectedPlayers.length} 枚のプレイヤーカードを保存しました。`);
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function exportSelectedCardsAsA4Sheet() {
    if (disableLocalCommunication) {
      onError("ローカル通信を行わない設定のため、プレイヤーリスト機能は無効です。設定タブで解除してください。");
      return;
    }

    const selectedPlayers = getSelectedPlayers();
    if (selectedPlayers.length === 0) {
      onError("出力対象の選択カードがありません。");
      return;
    }

    setBusy(true);
    onError("");
    onMessage("");

    try {
      const pageWidth = 2480;
      const pageHeight = 3508;
      const marginX = 110;
      const marginY = 120;
      const colGap = 44;
      const rowGap = 34;
      const cols = 2;
      const rows = 5;
      const cardWidth = Math.floor((pageWidth - marginX * 2 - colGap) / cols);
      const cardHeight = Math.floor((pageHeight - marginY * 2 - rowGap * (rows - 1)) / rows);
      const totalPages = Math.ceil(selectedPlayers.length / USER_CARD_PAGE_SIZE);

      for (let page = 0; page < totalPages; page += 1) {
        const pagePlayers = selectedPlayers.slice(page * USER_CARD_PAGE_SIZE, (page + 1) * USER_CARD_PAGE_SIZE);
        const canvas = document.createElement("canvas");
        canvas.width = pageWidth;
        canvas.height = pageHeight;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          throw new Error("A4画像の生成に失敗しました。");
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, pageWidth, pageHeight);
        ctx.fillStyle = "#0f172a";
        ctx.font = "700 40px 'Noto Sans JP', sans-serif";
        ctx.fillText("savakan-gg PLAYER CARDS", marginX, 70);
        ctx.font = "500 24px 'Noto Sans JP', sans-serif";
        ctx.fillText(`Page ${page + 1}/${totalPages}`, pageWidth - 260, 70);

        for (let index = 0; index < pagePlayers.length; index += 1) {
          const player = pagePlayers[index];
          const row = Math.floor(index / cols);
          const col = index % cols;
          const x = marginX + col * (cardWidth + colGap);
          const y = marginY + row * (cardHeight + rowGap);
          const cardCanvas = await renderPlayerCardCanvas(player, {
            width: cardWidth,
            height: cardHeight,
          });

          ctx.drawImage(cardCanvas, x, y, cardWidth, cardHeight);
        }

        const blob = await canvasToBlob(canvas);
        const safeEventAlias = eventAlias?.trim() || eventName || "event";
        triggerBlobDownload(blob, buildPrintedPlayerCardPageFileName(safeEventAlias, page + 1, totalPages));
      }

      onMessage(`選択中のカードを A4 シートにまとめて出力しました。${selectedPlayers.length} 枚 / ${totalPages} ページ`);
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    players,
    selectedPlayerIds,
    selectedPlayer,
    selectedPlayerPreviewUrl,
    busy,
    handlePlayerSelect,
    selectAllPlayers,
    clearPlayerSelection,
    saveSelectedCards,
    exportSelectedCardsAsA4Sheet,
  };
}
