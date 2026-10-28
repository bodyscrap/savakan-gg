import { useEffect, useMemo, useState } from "react";
import type { EventSnapshot } from "../domain/bracketDisplay";
import { collectEventEntrants, sortEventEntrants } from "../domain/bracketProgression";
import type { EventEntrantMeta } from "../domain/tournamentWorkspaceRepository";

const EMPTY_ENTRANT_META: EventEntrantMeta[] = [];

export function useSelectedEventEntrants(
  selectedEvent: EventSnapshot | null,
  entrantMeta?: EventEntrantMeta[],
) {
  const [selectedEntrantId, setSelectedEntrantId] = useState("");
  const selectedEntrantMeta = entrantMeta ?? EMPTY_ENTRANT_META;

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

    const aliasNameByEntrantId = new Map(
      selectedEntrantMeta.map((meta) => [meta.entrantId, meta.aliasName ?? ""]),
    );
    const skillByEntrantId = new Map(
      selectedEntrantMeta.map((meta) => [meta.entrantId, meta.skill ?? null]),
    );
    const resolvedIds = new Set(resolvedEntrants.map((entrant) => entrant.entrantId));
    const entrantsWithoutSets = (selectedEvent.entrants ?? [])
      .filter((entrant) => !resolvedIds.has(entrant.entrantId))
      .map((entrant) => ({ entrantId: entrant.entrantId, entrantName: entrant.name }));
    return [...sortEventEntrants(resolvedEntrants), ...entrantsWithoutSets].map((entrant) => ({
      ...entrant,
      aliasName: aliasNameByEntrantId.get(entrant.entrantId) ?? "",
      skill: skillByEntrantId.get(entrant.entrantId) ?? null,
    }));
  }, [selectedEntrantMeta, selectedEvent]);

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