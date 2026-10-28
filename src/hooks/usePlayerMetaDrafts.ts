import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { emptyCategorySelections, validateCategorySelections } from "../domain/eventManagement";
import type { EventSettingCategorySlot } from "../components/EventSetting";
import type { EventSnapshot } from "../domain/bracketDisplay";
import { FREE_TEXT_LIST_ID, MAX_CATEGORY_SLOTS, resolveEventItemList, type ItemListConfig } from "../domain/itemList";
import { toApiSlug } from "../domain/slugUtils";
import type { EventLocalMeta, PlaySide } from "./useTournamentWorkspace";

type PlayerMetaDraft = {
  aliasName: string;
  skillTier: string;
  playSide: PlaySide | "";
  categorySelections: string[][];
};

type Entrant = {
  entrantId: string;
  entrantName: string;
};

type SavePlayerMetaOptions = {
  silent?: boolean;
  manageBusy?: boolean;
  scope?: "all" | "alias" | "selections" | "skill";
};

type UsePlayerMetaDraftsOptions = {
  selectedEvent: EventSnapshot | null;
  selectedEventMeta: EventLocalMeta | null;
  selectedEventEntrants: Entrant[];
  selectedEntrant: Entrant | null;
  categorySlotListIds: string[];
  categorySlotAllowDuplicates: boolean[];
  totalItemMinCount: number;
  totalItemMaxCount: number;
  itemLists: ItemListConfig[];
  selectedEventItemListSnapshots: ItemListConfig[];
  slug: string;
  configuredCategorySlots: EventSettingCategorySlot[];
  saveLocalPlayerMeta: (input: {
    slug: string;
    eventId: string;
    eventName: string;
    entrantId: string;
    entrantName: string;
    aliasName: string;
    skill: number | null;
    playSide: PlaySide | null;
    characterNames: string[];
    categorySelections?: string[][] | null;
    notes: string | null;
  }) => Promise<unknown>;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  setMessage: (message: string) => void;
};

export function usePlayerMetaDrafts({
  selectedEvent,
  selectedEventMeta,
  selectedEventEntrants,
  selectedEntrant,
  categorySlotListIds,
  categorySlotAllowDuplicates,
  totalItemMinCount,
  totalItemMaxCount,
  itemLists,
  selectedEventItemListSnapshots,
  slug,
  configuredCategorySlots,
  saveLocalPlayerMeta,
  setBusy,
  setError,
  setMessage,
}: UsePlayerMetaDraftsOptions) {
  const [metaDrafts, setMetaDrafts] = useState<Record<string, PlayerMetaDraft>>({});
  const dirtyMetaDraftFieldsRef = useRef(new Map<string, Set<keyof PlayerMetaDraft>>());

  function getMetaDraftKey(eventId: string, entrantId: string): string {
    return `${eventId}:${entrantId}`;
  }

  function findEntrantMeta(eventId: string, entrantId: string) {
    return selectedEventMeta?.eventId === eventId
      ? selectedEventMeta.entrants.find((entrant) => entrant.entrantId === entrantId)
      : undefined;
  }

  function resolveItemList(listId: string): ItemListConfig | null {
    return resolveEventItemList(listId, selectedEventItemListSnapshots, itemLists);
  }

  function buildInitialCategorySelections(characterNames: string[], savedSelections?: string[][] | null): string[][] {
    if (savedSelections) return Array.from({ length: MAX_CATEGORY_SLOTS }, (_, index) => [...savedSelections[index] ?? []]);
    const categorySelections = emptyCategorySelections();
    const remaining = [...characterNames]
      .map((value) => value.trim())
      .filter((value) => value !== "");

    for (let slotIndex = 0; slotIndex < MAX_CATEGORY_SLOTS; slotIndex += 1) {
      const listId = categorySlotListIds[slotIndex] ?? "";
      if (listId.trim() === "") {
        continue;
      }

      const itemList = resolveItemList(listId);
      if (!itemList) {
        continue;
      }

      const allowDuplicates = Boolean(categorySlotAllowDuplicates[slotIndex]);
      const selections: string[] = [];
      for (let index = 0; index < remaining.length; index += 1) {
        const itemName = remaining[index];
        if (!itemList.items.includes(itemName)) {
          continue;
        }
        if (!allowDuplicates && selections.includes(itemName)) {
          continue;
        }

        selections.push(itemName);
        remaining.splice(index, 1);
        index -= 1;
      }
      categorySelections[slotIndex] = selections;
    }

    return categorySelections;
  }

  useEffect(() => {
    if (!selectedEvent) {
      setMetaDrafts({});
      return;
    }

    setMetaDrafts((current) => {
      const next = { ...current };
      for (const entrant of selectedEventEntrants) {
        const key = getMetaDraftKey(selectedEvent.eventId, entrant.entrantId);
        const existingMeta = findEntrantMeta(selectedEvent.eventId, entrant.entrantId);
        const draft = current[key];
        const dirty = dirtyMetaDraftFieldsRef.current.get(key);
        next[key] = {
          aliasName: draft && dirty?.has("aliasName") ? draft.aliasName : existingMeta?.aliasName ?? "",
          skillTier: draft && dirty?.has("skillTier")
            ? draft.skillTier
            : existingMeta?.skill == null ? "" : String(existingMeta.skill),
          playSide: draft && dirty?.has("playSide") ? draft.playSide : existingMeta?.playSide ?? "",
          categorySelections: draft && dirty?.has("categorySelections")
            ? draft.categorySelections
            : buildInitialCategorySelections(existingMeta?.characterNames ?? [], existingMeta?.categorySelections),
        };
      }
      return next;
    });
  }, [
    categorySlotAllowDuplicates,
    categorySlotListIds,
    itemLists,
    selectedEvent,
    selectedEventEntrants,
    selectedEventItemListSnapshots,
    selectedEventMeta,
  ]);

  function getMetaDraft(eventId: string, entrantId: string): PlayerMetaDraft {
    const key = getMetaDraftKey(eventId, entrantId);
    const existingMeta = findEntrantMeta(eventId, entrantId);
    return metaDrafts[key] ?? {
      aliasName: existingMeta?.aliasName ?? "",
      skillTier: existingMeta?.skill == null ? "" : String(existingMeta.skill),
      playSide: existingMeta?.playSide ?? "",
      categorySelections: buildInitialCategorySelections(existingMeta?.characterNames ?? [], existingMeta?.categorySelections),
    };
  }

  function setMetaDraft(eventId: string, entrantId: string, patch: Partial<PlayerMetaDraft>) {
    const key = getMetaDraftKey(eventId, entrantId);
    const existingMeta = findEntrantMeta(eventId, entrantId);
    const dirty = dirtyMetaDraftFieldsRef.current.get(key) ?? new Set<keyof PlayerMetaDraft>();
    if (patch.aliasName !== undefined) dirty.add("aliasName");
    if (patch.skillTier !== undefined) dirty.add("skillTier");
    if (patch.playSide !== undefined) dirty.add("playSide");
    if (patch.categorySelections !== undefined) dirty.add("categorySelections");
    dirtyMetaDraftFieldsRef.current.set(key, dirty);
    setMetaDrafts((current) => {
      const baseDraft = current[key] ?? {
        aliasName: existingMeta?.aliasName ?? "",
        skillTier: existingMeta?.skill == null ? "" : String(existingMeta.skill),
        playSide: existingMeta?.playSide ?? "",
        categorySelections: buildInitialCategorySelections(existingMeta?.characterNames ?? [], existingMeta?.categorySelections),
      };
      const nextSelections = patch.categorySelections
        ? patch.categorySelections.slice(0, MAX_CATEGORY_SLOTS).map((items) =>
          Array.isArray(items)
            ? items.map((value) => value.trim()).filter((value) => value !== "")
            : [],
        )
        : baseDraft.categorySelections;
      while (nextSelections.length < MAX_CATEGORY_SLOTS) {
        nextSelections.push([]);
      }

      return {
        ...current,
        [key]: {
          ...baseDraft,
          ...patch,
          categorySelections: nextSelections,
        },
      };
    });
  }

  function getDraftCategorySelections(draft: PlayerMetaDraft, slotIndex: number): string[] {
    return (draft.categorySelections[slotIndex] ?? [])
      .map((value) => value.trim())
      .filter((value) => value !== "");
  }

  function setDraftCategorySelections(
    eventId: string,
    entrantId: string,
    slotIndex: number,
    nextSelections: string[],
  ) {
    const draft = getMetaDraft(eventId, entrantId);
    const categorySelections = draft.categorySelections
      .slice(0, MAX_CATEGORY_SLOTS)
      .map((items) => [...items]);
    while (categorySelections.length < MAX_CATEGORY_SLOTS) {
      categorySelections.push([]);
    }
    categorySelections[slotIndex] = nextSelections
      .map((value) => value.trim())
      .filter((value) => value !== "");
    setMetaDraft(eventId, entrantId, { categorySelections });
  }

  function addDraftCategorySelection(
    eventId: string,
    entrantId: string,
    slotIndex: number,
    list: ItemListConfig,
    allowDuplicates: boolean,
    maxCount: number,
    itemName: string,
  ) {
    const normalizedItem = itemName.trim();
    if (normalizedItem === "" || (list.id !== FREE_TEXT_LIST_ID && !list.items.includes(normalizedItem))) {
      return;
    }

    const currentSelections = getDraftCategorySelections(getMetaDraft(eventId, entrantId), slotIndex);
    if ((!allowDuplicates && currentSelections.includes(normalizedItem)) || currentSelections.length >= maxCount) {
      return;
    }
    setDraftCategorySelections(eventId, entrantId, slotIndex, [...currentSelections, normalizedItem]);
  }

  function removeDraftCategorySelection(
    eventId: string,
    entrantId: string,
    slotIndex: number,
    removeIndex: number,
  ) {
    const currentSelections = getDraftCategorySelections(getMetaDraft(eventId, entrantId), slotIndex);
    if (removeIndex < 0 || removeIndex >= currentSelections.length) {
      return;
    }
    setDraftCategorySelections(
      eventId,
      entrantId,
      slotIndex,
      currentSelections.filter((_, index) => index !== removeIndex),
    );
  }

  function setSelectedEntrantAliasName(aliasName: string) {
    if (!selectedEvent || !selectedEntrant) {
      return;
    }
    setMetaDraft(selectedEvent.eventId, selectedEntrant.entrantId, { aliasName });
  }

  function setSelectedEntrantSkillTier(skillTier: string) {
    if (!selectedEvent || !selectedEntrant) {
      return;
    }
    setMetaDraft(selectedEvent.eventId, selectedEntrant.entrantId, { skillTier });
  }

  function buildValidatedSelections(
    draft: PlayerMetaDraft,
    slots: EventSettingCategorySlot[],
  ): { normalizedBySlot: string[][]; flattened: string[]; errors: string[] } {
    return validateCategorySelections(draft.categorySelections, slots, totalItemMinCount, totalItemMaxCount);
  }

  function clearDirtyDraft(eventId: string, entrantId: string) {
    dirtyMetaDraftFieldsRef.current.delete(getMetaDraftKey(eventId, entrantId));
  }

  async function savePlayerMeta(
    eventSnapshot: EventSnapshot,
    entrantId: string,
    entrantName: string,
    options?: SavePlayerMetaOptions,
  ) {
    const silent = options?.silent ?? false;
    const manageBusy = options?.manageBusy ?? true;
    const scope = options?.scope ?? "all";
    const savesAlias = scope !== "selections" && scope !== "skill";
    const savesSkill = scope !== "selections" && scope !== "alias";
    const savesSelections = scope !== "alias" && scope !== "skill";
    const normalizedSlug = toApiSlug(slug);
    const draft = getMetaDraft(eventSnapshot.eventId, entrantId);
    const existingMeta = findEntrantMeta(eventSnapshot.eventId, entrantId);
    const validated = savesSelections ? buildValidatedSelections(draft, configuredCategorySlots) : null;
    const parsedSkillTier = draft.skillTier.trim() === "" ? null : Number(draft.skillTier);

    if (validated && validated.errors.length > 0) {
      setError(validated.errors.join(" "));
      return;
    }
    if (savesSkill && parsedSkillTier !== null
      && (!Number.isSafeInteger(parsedSkillTier) || parsedSkillTier < 0)) {
      setError(t("Skill Tierは0以上の整数で入力してください。"));
      return;
    }

    if (manageBusy) {
      setBusy(true);
    }
    setError("");
    if (!silent) {
      setMessage("");
    }

    try {
      await saveLocalPlayerMeta({
        slug: normalizedSlug,
        eventId: eventSnapshot.eventId,
        eventName: eventSnapshot.name,
        entrantId,
        entrantName,
        aliasName: savesAlias ? draft.aliasName : existingMeta?.aliasName ?? "",
        skill: savesSkill ? parsedSkillTier : existingMeta?.skill ?? null,
        playSide: existingMeta?.playSide ?? null,
        characterNames: validated?.flattened ?? existingMeta?.characterNames ?? [],
        categorySelections: validated?.normalizedBySlot ?? existingMeta?.categorySelections ?? null,
        notes: existingMeta?.notes ?? null,
      });

      const key = getMetaDraftKey(eventSnapshot.eventId, entrantId);
      setMetaDrafts((current) => {
        const latest = current[key] ?? draft;
        const dirty = dirtyMetaDraftFieldsRef.current.get(key);
        const next = { ...latest };
        if (savesAlias && latest.aliasName === draft.aliasName) {
          dirty?.delete("aliasName");
        }
        if (savesSkill && latest.skillTier === draft.skillTier) {
          dirty?.delete("skillTier");
        }
        if (validated && latest.categorySelections.length === draft.categorySelections.length
          && latest.categorySelections.every((items, slotIndex) =>
            items.length === draft.categorySelections[slotIndex].length
            && items.every((item, index) => item === draft.categorySelections[slotIndex][index]))) {
          next.categorySelections = validated.normalizedBySlot;
          dirty?.delete("categorySelections");
        }
        if (dirty?.size === 0) dirtyMetaDraftFieldsRef.current.delete(key);
        return { ...current, [key]: next };
      });
      if (!silent) {
        setMessage(scope === "alias"
          ? t("プレイヤーエイリアス名を保存しました。")
          : scope === "selections"
            ? t("アイテムの選択状態を保存しました。")
            : scope === "skill"
              ? t("Skill Tierを保存しました。")
              : t("ローカルメタを保存しました。"));
      }
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      if (manageBusy) {
        setBusy(false);
      }
    }
  }

  function addSelectedEntrantDraftSelection(slot: EventSettingCategorySlot, itemName: string) {
    if (!selectedEvent || !selectedEntrant) {
      return;
    }
    addDraftCategorySelection(
      selectedEvent.eventId,
      selectedEntrant.entrantId,
      slot.slotIndex,
      slot.list,
      slot.allowDuplicates,
      slot.maxCount,
      itemName,
    );
  }

  function removeSelectedEntrantDraftSelection(slotIndex: number, selectionIndex: number) {
    if (!selectedEvent || !selectedEntrant) {
      return;
    }
    removeDraftCategorySelection(
      selectedEvent.eventId,
      selectedEntrant.entrantId,
      slotIndex,
      selectionIndex,
    );
  }

  function saveSelectedEntrantMeta(scope: "alias" | "selections" | "skill") {
    if (selectedEvent && selectedEntrant) {
      return savePlayerMeta(selectedEvent, selectedEntrant.entrantId, selectedEntrant.entrantName, { scope })
        .catch((error: unknown) => setError(String(error)));
    }
  }

  const selectedEntrantMetaDraft = selectedEvent && selectedEntrant
    ? getMetaDraft(selectedEvent.eventId, selectedEntrant.entrantId)
    : null;
  const selectedEntrantDraftSelectionsBySlot = selectedEntrantMetaDraft
    ? Array.from({ length: MAX_CATEGORY_SLOTS }, (_, slotIndex) =>
      getDraftCategorySelections(selectedEntrantMetaDraft, slotIndex),
    )
    : [];
  const selectedEntrantAliasName = selectedEntrantMetaDraft?.aliasName ?? "";
  const selectedEntrantSkillTier = selectedEntrantMetaDraft?.skillTier ?? "";
  const selectedEntrantSkillTierErrors = selectedEntrantSkillTier.trim() !== ""
    && (!Number.isSafeInteger(Number(selectedEntrantSkillTier)) || Number(selectedEntrantSkillTier) < 0)
    ? [t("Skill Tierは0以上の整数で入力してください。")]
    : [];
  const selectedEntrantValidationErrors = selectedEntrantMetaDraft
    ? buildValidatedSelections(selectedEntrantMetaDraft, configuredCategorySlots).errors
    : [];

  return {
    setMetaDraft,
    selectedEntrantDraftSelectionsBySlot,
    selectedEntrantAliasName,
    setSelectedEntrantAliasName,
    selectedEntrantSkillTier,
    setSelectedEntrantSkillTier,
    selectedEntrantSkillTierErrors,
    selectedEntrantValidationErrors,
    addDraftCategorySelection,
    removeDraftCategorySelection,
    clearDirtyDraft,
    savePlayerMeta,
    addSelectedEntrantDraftSelection,
    removeSelectedEntrantDraftSelection,
    saveSelectedEntrantAliasName: () => saveSelectedEntrantMeta("alias"),
    saveSelectedEntrantSkillTier: () => saveSelectedEntrantMeta("skill"),
    saveSelectedEntrantSelections: () => saveSelectedEntrantMeta("selections"),
  };
}