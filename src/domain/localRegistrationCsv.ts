import { t } from "../i18n";
import { emptyCategorySelections } from "./eventManagement";
import { registrationCategorySlots, validateRegisteredSelections, type LocalEventRegistration, type RegisteredLocalParticipant } from "./localEventRegistration";

export type RegistrationCsv = { headers: string[]; rows: string[][] };
export type RegistrationCsvMapping = { name: number; categories: Array<number | null> };

export function parseRegistrationCsv(text: string): RegistrationCsv {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  const source = text.replace(/^\uFEFF/, "");
  const finishRow = () => {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) records.push(row);
    row = []; cell = ""; closed = false;
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { cell += '"'; index += 1; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === ",") {
      row.push(cell); cell = ""; closed = false;
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      finishRow();
    } else if (char === '"' && cell === "" && !closed) {
      quoted = true;
    } else {
      if (closed || char === '"') throw new Error(t("CSVの引用符の形式が不正です。"));
      cell += char;
    }
  }
  if (quoted) throw new Error(t("CSVの引用符が閉じられていません。"));
  if (cell !== "" || row.length > 0 || closed) finishRow();
  const headers = records.shift();
  if (!headers || headers.some((header) => !header.trim())) throw new Error(t("CSVの先頭行にカラム名を指定してください。"));
  if (records.length < 1 || records.length > 512) throw new Error(t("CSVの参加者は1〜512人にしてください。"));
  if (records.some((record) => record.length !== headers.length)) throw new Error(t("CSVのカラム数が一致しない行があります。"));
  return { headers: headers.map((header) => header.trim()), rows: records };
}

export function importRegistrationCsv(
  csv: RegistrationCsv, mapping: RegistrationCsvMapping, registration: LocalEventRegistration,
  createId: () => string = () => crypto.randomUUID(),
): RegisteredLocalParticipant[] {
  const validColumn = (column: number) => Number.isInteger(column) && column >= 0 && column < csv.headers.length;
  if (!validColumn(mapping.name) || mapping.categories.some((column) => column !== null && !validColumn(column))) {
    throw new Error(t("取り込みに使用するカラムを選択してください。"));
  }
  const slots = registrationCategorySlots(registration.setting);
  return csv.rows.map((row, index) => {
    const name = row[mapping.name].trim();
    if (!name) throw new Error(t("CSVの{row}行目にプレイヤー名がありません。", { row: index + 2 }));
    const categorySelections = emptyCategorySelections();
    for (const slot of slots) {
      const column = mapping.categories[slot.slotIndex];
      if (column === null || column === undefined) continue;
      const items = row[column].split(/[,\r\n]+/).map((item) => item.trim())
        .filter((item) => item !== "" && slot.list.items.includes(item));
      categorySelections[slot.slotIndex] = slot.allowDuplicates ? items : [...new Set(items)];
    }
    const participant = { entrantId: createId(), name, categorySelections, selectionsConfirmed: false };
    participant.selectionsConfirmed = validateRegisteredSelections(participant, registration.setting).errors.length === 0;
    return participant;
  });
}
