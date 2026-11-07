import { FREE_TEXT_LIST_ID } from "./itemList";

export type PlayerListCsvCategory = {
  id: string;
  name: string;
  categoryName: string;
  slotIndex: number;
};

export type PlayerListCsvRow = {
  playerName: string;
  aliasName: string;
  skill: number | null;
  playerId: string;
  categorySelections?: string[][] | null;
};

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function playerListCsvCategoryHeader(category: PlayerListCsvCategory): string {
  const listName = category.name.trim();
  const categoryName = category.categoryName.trim();
  if (category.id === FREE_TEXT_LIST_ID) return categoryName || listName;
  if (!listName) return categoryName;
  if (!categoryName) return listName;
  return `${listName}/${categoryName}`;
}

export function buildPlayerListCsv(players: PlayerListCsvRow[], categories: PlayerListCsvCategory[] = []): string {
  const rows = [
    ["プレイヤー名", "エイリアスプレイヤー名", "Skill Tier", "Player ID",
      ...categories.map(playerListCsvCategoryHeader)],
    ...players.map((player) => [
      player.playerName,
      player.aliasName,
      player.skill === null ? "" : String(player.skill),
      player.playerId,
      ...categories.map((category) => (player.categorySelections?.[category.slotIndex] ?? []).join(",")),
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n")}\r\n`;
}

function sanitizeFileSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/[.]+$/g, "")
    .replace(/^-+|-+$/g, "");
  return normalized === "" ? "players" : normalized;
}

export function buildPlayerListCsvFileName(eventAlias: string | null, eventName: string): string {
  const eventLabel = sanitizeFileSegment(eventAlias?.trim() || eventName || "players");
  return `${eventLabel}_players.csv`;
}
