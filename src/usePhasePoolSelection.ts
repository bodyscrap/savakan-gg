import { useEffect } from "react";
import type { PhasePoolGroup } from "./bracketDisplay";

export function resolveSelectedPhaseName(phaseNames: string[], selectedPhaseName: string): string {
  if (phaseNames.length === 0) {
    return "";
  }

  return phaseNames.includes(selectedPhaseName) ? selectedPhaseName : phaseNames[0];
}

export function resolveSelectedPhasePoolKey(
  phaseScopedPoolGroups: PhasePoolGroup[],
  selectedPhasePoolKey: string,
): string {
  if (phaseScopedPoolGroups.length === 0) {
    return "";
  }

  return phaseScopedPoolGroups.some((group) => group.key === selectedPhasePoolKey)
    ? selectedPhasePoolKey
    : phaseScopedPoolGroups[0].key;
}

type UsePhasePoolSelectionOptions = {
  phaseNames: string[];
  phaseScopedPoolGroups: PhasePoolGroup[];
  selectedPhaseName: string;
  selectedPhasePoolKey: string;
  setSelectedPhaseName: (phaseName: string) => void;
  setSelectedPhasePoolKey: (key: string) => void;
};

export function usePhasePoolSelection({
  phaseNames,
  phaseScopedPoolGroups,
  selectedPhaseName,
  selectedPhasePoolKey,
  setSelectedPhaseName,
  setSelectedPhasePoolKey,
}: UsePhasePoolSelectionOptions) {
  useEffect(() => {
    const nextPhaseName = resolveSelectedPhaseName(phaseNames, selectedPhaseName);
    if (nextPhaseName !== selectedPhaseName) {
      setSelectedPhaseName(nextPhaseName);
    }
  }, [phaseNames, selectedPhaseName, setSelectedPhaseName]);

  useEffect(() => {
    const nextPhasePoolKey = resolveSelectedPhasePoolKey(phaseScopedPoolGroups, selectedPhasePoolKey);
    if (nextPhasePoolKey !== selectedPhasePoolKey) {
      setSelectedPhasePoolKey(nextPhasePoolKey);
    }
  }, [phaseScopedPoolGroups, selectedPhasePoolKey, setSelectedPhasePoolKey]);
}