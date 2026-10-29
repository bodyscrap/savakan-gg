export type PlayerListCsvRow = {
  playerName: string;
  aliasName: string;
  skill: number | null;
  playerId: string;
};

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildPlayerListCsv(players: PlayerListCsvRow[]): string {
  const rows = [
    ["プレイヤー名", "エイリアスプレイヤー名", "Skill Tier", "Player ID"],
    ...players.map((player) => [
      player.playerName,
      player.aliasName,
      player.skill === null ? "" : String(player.skill),
      player.playerId,
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
