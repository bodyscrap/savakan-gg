import { renderOverlayPreset } from "/overlay-renderer.js";

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
  const legacy = [document.querySelector(".stage"), document.getElementById("eventAlias")];
  for (const element of legacy) element.style.visibility = preset ? "hidden" : "";
  stage.style.display = preset ? "block" : "none";
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
window.addEventListener("overlay-state", (event) => {
  state = event.detail;
  render();
});
async function poll() {
  try {
    const revision = await fetch("/api/overlay-layout-revision", { cache: "no-store" });
    if (!revision.ok) throw new Error(`Overlay layout: HTTP ${revision.status}`);
    const version = await revision.text();
    if (signature !== version) {
      const response = await fetch("/api/overlay-layout", { cache: "no-store" });
      if (!response.ok) throw new Error(`Overlay layout: HTTP ${response.status}`);
      const text = await response.text();
      preset = JSON.parse(text);
      signature = version;
      if (!preset) {
        document.documentElement.style.width = document.body.style.width = "1920px";
        document.documentElement.style.height = document.body.style.height = "1080px";
      }
      render();
    }
    error.textContent = "";
  } catch (cause) {
    console.error("Unable to load overlay layout.", cause);
    error.textContent = String(cause);
  } finally {
    window.setTimeout(poll, 450);
  }
}
void poll();
