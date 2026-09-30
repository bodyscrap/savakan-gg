import { useEffect, useMemo, useState } from "react";
import type { EventSnapshot } from "./bracketDisplay";
import { collectEventEntrants, sortEventEntrants } from "./bracketProgression";

export function useSelectedEventEntrants(selectedEvent: EventSnapshot | null) {
  const [selectedEntrantId, setSelectedEntrantId] = useState("");

  const entrants = useMemo(() => {
    if (!selectedEvent) {
      return [];
    }

    const resolvedEntrants = collectEventEntrants(selectedEvent.sets);

    console.groupCollapsed(`[seed-debug] event=${selectedEvent.eventId} entrants=${resolvedEntrants.length}`);
    console.table(
      resolvedEntrants.map((item, index) => ({
        order: index + 1,
        entrantId: item.entrantId,
        entrantName: item.entrantName,
        seedId: item.seedId,
        seedNum: item.seedNum,
        firstSeenSetId: item.firstSeenSetId,
      })),
    );
    console.groupEnd();

    return sortEventEntrants(resolvedEntrants);
  }, [selectedEvent]);

  const selectedEntrant = useMemo(() => {
    if (selectedEntrantId === "") {
      return entrants[0] ?? null;
    }

    return entrants.find((entrant) => entrant.entrantId === selectedEntrantId) ?? entrants[0] ?? null;
  }, [entrants, selectedEntrantId]);

  useEffect(() => {
    if (entrants.length === 0) {
      if (selectedEntrantId !== "") {
        setSelectedEntrantId("");
      }
      return;
    }

    if (selectedEntrantId !== "" && entrants.some((entrant) => entrant.entrantId === selectedEntrantId)) {
      return;
    }

    setSelectedEntrantId(entrants[0].entrantId);
  }, [entrants, selectedEntrantId]);

  return {
    entrants,
    selectedEntrant,
    selectedEntrantId,
    setSelectedEntrantId,
  };
}