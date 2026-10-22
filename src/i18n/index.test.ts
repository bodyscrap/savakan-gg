import { afterEach, describe, expect, it, vi } from "vitest";
import { API, documentURIToFileName } from "typescript/unstable/sync";
import { isCallExpression, isIdentifier, isStringLiteral, type Node } from "typescript/unstable/ast";
import { appTranslations } from "./app";
import { componentTranslations } from "./components";
import { getLanguage, LANGUAGE_STORAGE_KEY, setLanguage, t } from "./index";
import { normalizeCallPhaseGroupName, normalizeCallPhaseName } from "../domain/messageUtils";

afterEach(() => {
  vi.unstubAllGlobals();
  setLanguage("ja");
  vi.restoreAllMocks();
});

describe("UI language", () => {
  it("defaults to Japanese and switches in both directions", () => {
    expect(getLanguage()).toBe("ja");
    expect(t("先にイベントを選択してください。")).toBe("先にイベントを選択してください。");
    setLanguage("en");
    expect(t("先にイベントを選択してください。")).toBe("Select an event first.");
    setLanguage("ja");
    expect(t("先にイベントを選択してください。")).toBe("先にイベントを選択してください。");
  });

  it("saves the selection and updates the document language", () => {
    const setItem = vi.fn();
    const documentElement = { lang: "ja" };
    vi.stubGlobal("window", { localStorage: { setItem } });
    vi.stubGlobal("document", { documentElement });
    setLanguage("en");
    expect(setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, "en");
    expect(documentElement.lang).toBe("en");
  });

  it("restores the saved preference on startup and ignores invalid preferences", async () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => "en" } });
    vi.resetModules();
    const saved = await import("./index");
    expect(saved.getLanguage()).toBe("en");
    vi.stubGlobal("window", { localStorage: { getItem: () => "invalid" } });
    vi.resetModules();
    const invalid = await import("./index");
    expect(invalid.getLanguage()).toBe("ja");
  });

  it("preserves user content and only substitutes parameters once", () => {
    setLanguage("en");
    expect(t("エイリアス名を保存しました: {p0}", { p0: "日本語 {p1} <&>" }))
      .toBe("Saved alias: 日本語 {p1} <&>");
    expect(t("大会の名前")).toBe("大会の名前");
    expect(t("missing {value}", { value: 0 })).toBe("missing 0");
    expect(t("missing {value}")).toBe("missing {value}");
  });

  it("keeps phase and pool selection keys unchanged across languages", () => {
    const phase = normalizeCallPhaseName("");
    const pool = normalizeCallPhaseGroupName("");
    setLanguage("en");
    expect(normalizeCallPhaseName("")).toBe(phase);
    expect(normalizeCallPhaseGroupName("")).toBe(pool);
    expect(normalizeCallPhaseName("日本語のフェーズ")).toBe("日本語のフェーズ");
    expect(t(phase)).toBe("Phase not set");
    expect(t(pool)).toBe("Pool not set");
  });

  it("reports storage failures while keeping the selected language usable", () => {
    const error = new Error("Storage unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", { localStorage: { setItem: () => { throw error; } } });
    setLanguage("en");
    expect(getLanguage()).toBe("en");
    expect(report).toHaveBeenCalledWith("Unable to save the UI language preference.", error);
  });
});

describe("translation catalogs", () => {
  const catalogs = { ...appTranslations, ...componentTranslations };
  it("preserves every interpolation parameter in English", () => {
    const parameters = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [source, translated] of Object.entries(catalogs)) {
      expect(translated.trim(), source).not.toBe("");
      expect(parameters(translated), source).toEqual(parameters(source));
    }
  });

  it("includes every explicit source message in the application", () => {
    const files = import.meta.glob(
      ["../app/*.tsx", "../components/*.tsx", "../hooks/*.ts", "../domain/*.ts", "!../**/*.test.*"],
      { query: "?raw", import: "default" },
    );
    const api = new API();
    try {
      const config = documentURIToFileName(new URL("../../tsconfig.json", import.meta.url).href);
      const snapshot = api.updateSnapshot({ openProjects: [config] });
      try {
        const project = snapshot.getProject(config);
        if (!project) throw new Error("Translation check project was not loaded.");
        expect(Object.keys(files).length).toBeGreaterThan(0);
        let checkedMessages = 0;
        for (const path of Object.keys(files)) {
          const source = project.program.getSourceFile(documentURIToFileName(new URL(path, import.meta.url).href));
          if (!source) throw new Error(`Translation check source was not loaded: ${path}`);
          function visit(node: Node): void {
            if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === "t") {
              const key = node.arguments[0];
              if (key && isStringLiteral(key)) {
                checkedMessages += 1;
                expect(Object.prototype.hasOwnProperty.call(catalogs, key.text), `${path}: ${key.text}`).toBe(true);
              }
            }
            node.forEachChild(visit);
          }
          visit(source);
        }
        expect(checkedMessages).toBeGreaterThan(0);
      } finally {
        snapshot.dispose();
      }
    } finally {
      api.close();
    }
  });
});
