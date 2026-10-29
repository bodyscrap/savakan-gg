import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UserCardPlayer } from "../hooks/userCardCanvas";
import { PlayerListInfo } from "./PlayerListInfo";

const player: UserCardPlayer = {
  tournamentId: "tournament",
  tournamentName: "Tournament",
  eventId: "event",
  eventName: "Event",
  eventAlias: null,
  entrantId: "entrant",
  entrantName: "Player",
  playerName: "Player",
  aliasName: "Alias",
  skill: 7,
  playerId: "PG-PLAYER",
};

describe("PlayerListInfo", () => {
  it("shows skill tier in the player selection list and offers CSV export", () => {
    const html = renderToStaticMarkup(<PlayerListInfo
      disableLocalCommunication={false}
      userCardBusy={false}
      hasSelectedEvent
      selectedEventLabel="Event"
      players={[player]}
      selectedPlayerIds={[player.playerId]}
      selectedPlayer={player}
      selectedPlayerPreviewUrl=""
      onSaveSelectedCard={vi.fn()}
      onExportA4Sheet={vi.fn()}
      onExportCsv={vi.fn()}
      onSelectAllPlayers={vi.fn()}
      onClearPlayerSelection={vi.fn()}
      onSelectPlayer={vi.fn()}
    />);

    expect(html).toContain("Skill Tier: 7 / Player ID: PG-PLAYER");
    expect(html).toContain(">CSVで出力</button>");
  });
});
