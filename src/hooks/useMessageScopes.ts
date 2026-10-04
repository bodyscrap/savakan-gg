import { useMemo } from "react";
import type { EventSnapshot } from "../domain/bracketDisplay";
import type { MessageScope } from "../domain/messageUtils";
import { resolveSelectedPhasePoolNames } from "../domain/snapshotSelectionPersistence";
import type { TournamentSnapshot } from "./useTournamentWorkspace";

type UseMessageScopesOptions = {
  snapshot: TournamentSnapshot | null;
  selectedEvent: EventSnapshot | null;
  selectedPhaseName: string;
  selectedPhasePoolKey: string;
};

export function useMessageScopes({
  snapshot,
  selectedEvent,
  selectedPhaseName,
  selectedPhasePoolKey,
}: UseMessageScopesOptions) {
  const selectedMessageScope = useMemo<MessageScope | null>(() => {
    if (!snapshot || !selectedEvent) {
      return null;
    }

    const { phaseName, phaseGroupName } = resolveSelectedPhasePoolNames(
      selectedEvent,
      selectedPhaseName,
      selectedPhasePoolKey,
    );

    return {
      tournamentId: snapshot.tournamentId,
      slug: snapshot.slug,
      eventId: selectedEvent.eventId,
      phaseName,
      phaseGroupName,
    };
  }, [selectedEvent, selectedPhaseName, selectedPhasePoolKey, snapshot]);

  const selectedMailboxScope = useMemo<MessageScope | null>(() => {
    if (!selectedMessageScope) {
      return null;
    }

    return {
      ...selectedMessageScope,
      phaseName: "",
      phaseGroupName: "",
    };
  }, [selectedMessageScope]);

  return { selectedMessageScope, selectedMailboxScope };
}