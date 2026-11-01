import { renderOverlayPreset } from "/overlay-renderer.js";

const isPreview = new URLSearchParams(window.location.search).has("preview");
const stage = document.createElement("div");
stage.id = "custom-overlay-stage";
document.body.append(stage);
const error = document.createElement("div");
Object.assign(error.style, { color: "red", background: "white", position: "absolute", top: "0", left: "0" });
document.body.append(error);
let preset = null;
let state = null;
let container = { width: window.innerWidth, height: window.innerHeight };
let signature = "";
let cleanup;

function render() {
  cleanup?.();
  cleanup = undefined;
  if (!preset || !state) return;
  document.documentElement.style.width = document.body.style.width = `${preset.width}px`;
  document.documentElement.style.height = document.body.style.height = `${preset.height}px`;
  cleanup = renderOverlayPreset(stage, preset, state);
  stage.style.position = "absolute";
  stage.style.left = "0";
  stage.style.top = "0";
  stage.style.transform = isPreview
    ? `scale(${Math.min(container.width / preset.width, container.height / preset.height)})`
    : "";
}
window.addEventListener("message", (event) => {
  if (event.data?.type === "preview-container-width") {
    const { width, height } = event.data;
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      container = { width, height };
      render();
    }
  }
});
window.addEventListener("resize", () => {
  container = { width: window.innerWidth, height: window.innerHeight };
  render();
});
async function pollState() {
  try {
    const response = await fetch(`/api/overlay-state?ts=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (response.ok) {
      state = await response.json();
      render();
    }
  } catch {
    // Retry on the next tick.
  } finally {
    window.setTimeout(pollState, 450);
  }
}
async function pollLayout() {
  try {
    const revision = await fetch("/api/overlay-layout-revision", { cache: "no-store" });
    if (!revision.ok) throw new Error(`Overlay layout: HTTP ${revision.status}`);
    const version = await revision.text();
    if (signature !== version) {
      const response = await fetch("/api/overlay-layout", { cache: "no-store" });
      if (!response.ok) throw new Error(`Overlay layout: HTTP ${response.status}`);
      preset = JSON.parse(await response.text());
      signature = version;
      render();
    }
    error.textContent = "";
  } catch (cause) {
    console.error("Unable to load overlay layout.", cause);
    error.textContent = String(cause);
  } finally {
    window.setTimeout(pollLayout, 450);
  }
}
void pollState();
void pollLayout();
