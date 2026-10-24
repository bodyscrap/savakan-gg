export function formatOverlayClock(format, now = new Date()) {
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  const hours = now.getHours();
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const japaneseWeekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const tokens = {
    YYYY: pad(now.getFullYear(), 4), YY: pad(now.getFullYear() % 100),
    MM: pad(now.getMonth() + 1), M: String(now.getMonth() + 1),
    DD: pad(now.getDate()), D: String(now.getDate()),
    HH: pad(hours), H: String(hours), hh: pad(hours % 12 || 12), h: String(hours % 12 || 12),
    mm: pad(now.getMinutes()), m: String(now.getMinutes()),
    ss: pad(now.getSeconds()), s: String(now.getSeconds()),
    A: hours < 12 ? "AM" : "PM", a: hours < 12 ? "am" : "pm",
    dddd: weekdays[now.getDay()], ddd: weekdays[now.getDay()].slice(0, 3), d: japaneseWeekdays[now.getDay()],
  };
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|A|a|dddd|ddd|d/g,
    (token, literal) => literal !== undefined ? literal : tokens[token]);
}

export function resolveOverlayText(component, state, now = new Date()) {
  if (component.kind === "clock") return formatOverlayClock(component.clockFormat, now);
  if (component.kind === "item") {
    return state.active ? (state[component.source]?.[component.itemCategory - 1] ?? []).join(component.delimiter) : "";
  }
  if (component.source === "text") return component.text;
  if (component.source === "number") return String(component.numberValue);
  if (component.source === "eventAlias") return String(state.eventAlias ?? "");
  if (!state.active) return "";
  const lines = String(state.roundText || "").split(/\r?\n/).filter((line) => line.trim());
  if (component.source === "setName") return lines[0] || "";
  if (component.source === "roundName") return lines.slice(1).join("\n");
  return String(state[component.source] ?? "");
}

export function resolveOverlayBackground(component) {
  if (component.frame === "glass" && component.background === "transparent") return "transparent";
  const rgb = component.background.slice(0, 7).toLowerCase();
  const alpha = component.background.length === 9 ? parseInt(component.background.slice(7), 16) / 255 : 1;
  if (component.frame === "glass") {
    const channels = [1, 3, 5].map((start) => parseInt(rgb.slice(start, start + 2), 16)).join(",");
    return `linear-gradient(135deg, rgba(${channels},${0.62 * alpha}), rgba(${channels},${0.36 * alpha}))`;
  }
  const gradients = {
    "#991b1b": [[185, 28, 28, 0.86], [127, 29, 29, 0.84]],
    "#1e40af": [[30, 64, 175, 0.86], [30, 58, 138, 0.84]],
    "#374151": [[75, 85, 99, 0.88], [55, 65, 81, 0.88]],
  };
  if (component.frame === "plate" && gradients[rgb]) {
    const stops = gradients[rgb].map(([r, g, b, a]) => `rgba(${r},${g},${b},${a * alpha})`);
    return `linear-gradient(180deg, ${stops.join(", ")})`;
  }
  if (component.frame === "eventAlias" && rgb === "#000000") return `rgba(0,0,0,${0.88 * alpha})`;
  return component.background;
}

export function resolveOverlayVerticalAlign(component) {
  return component.verticalAlign ?? (component.frame === "plate" || component.frame === "eventAlias" ? "center" : "top");
}

export function resolveOverlayTextOverflow(component) {
  return {
    wrap: component.wrapText ?? (!component.frame || component.frame === "glass" || component.source === "roundText"),
    shrink: component.shrinkText ?? false,
  };
}

export function fitOverlayText(element, component, text) {
  const content = element.firstElementChild;
  const { wrap, shrink } = resolveOverlayTextOverflow(component);
  const baseSize = component.fontSize;
  element.style.fontSize = `${baseSize}px`;
  Object.assign(content.style, {
    display: "block", width: "100%", minWidth: "0", flex: "0 0 auto",
    whiteSpace: wrap ? "pre-wrap" : "pre", overflowWrap: wrap ? "anywhere" : "normal",
  });
  content.textContent = text;
  const style = getComputedStyle(element);
  const availableHeight = Math.max(0, element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
  const fits = () => content.scrollWidth <= content.clientWidth && content.offsetHeight <= availableHeight + 0.5;
  if (fits()) return;
  if (shrink) {
    const minimum = Math.max(1, baseSize / 2);
    element.style.fontSize = `${minimum}px`;
    if (fits()) {
      let low = minimum;
      let high = baseSize;
      for (let step = 0; step < 12; step++) {
        const middle = (low + high) / 2;
        element.style.fontSize = `${middle}px`;
        if (fits()) low = middle;
        else high = middle;
      }
      element.style.fontSize = `${low}px`;
      return;
    }
  }
  const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (item) => item.segment);
  content.textContent = "…";
  if (!fits()) {
    content.textContent = "";
    return;
  }
  let low = 0;
  let high = graphemes.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    content.textContent = `${graphemes.slice(0, middle).join("").trimEnd()}…`;
    if (fits()) low = middle;
    else high = middle - 1;
  }
  content.textContent = `${graphemes.slice(0, low).join("").trimEnd()}…`;
}

export function renderOverlayPreset(stage, preset, state) {
  Object.assign(stage.style, {
    position: "relative", width: `${preset.width}px`, height: `${preset.height}px`,
    overflow: "hidden", transformOrigin: "top left",
  });
  if (state.fullyStopped) {
    stage.replaceChildren();
    return;
  }
  const previous = new Map(Array.from(stage.children, (element) => [element.dataset.componentId, element]));
  const clocks = [];
  const textElements = [];
  const now = new Date();
  for (const component of preset.components) {
    if (!component.visible) continue;
    const existing = previous.get(component.id);
    const tag = component.kind === "image" ? "IMG" : "DIV";
    const element = existing?.tagName === tag ? existing : document.createElement(tag);
    if (existing && existing !== element) existing.remove();
    previous.delete(component.id);
    element.dataset.componentId = component.id;
    const frame = component.frame;
    const glass = frame === "glass";
    const builtIn = !!frame && !glass;
    const singleLine = builtIn && component.source !== "roundText";
    const plate = frame === "plate";
    const alias = frame === "eventAlias";
    const verticalAlign = resolveOverlayVerticalAlign(component);
    const background = resolveOverlayBackground(component);
    const textAlpha = component.color.length === 9 ? parseInt(component.color.slice(7), 16) / 255 : 1;
    Object.assign(element.style, {
      position: "absolute", boxSizing: "border-box",
      left: `${component.x}px`, top: `${component.y}px`,
      width: `${component.width}px`, height: `${component.height}px`,
      fontFamily: component.fontFamily, fontSize: `${component.fontSize}px`,
      fontWeight: component.bold ? frame === "setSub" || alias ? "800" : builtIn ? "900" : "700" : "400",
      color: component.color, background, textAlign: component.align,
      whiteSpace: singleLine ? "nowrap" : "pre-wrap", overflow: "hidden",
      overflowWrap: singleLine ? "normal" : "anywhere", textOverflow: singleLine ? "ellipsis" : "clip",
      lineHeight: plate ? "1" : frame === "setSub" ? "1.05" : builtIn ? "1.1" : "1.15",
      display: plate || alias ? "flex" : "block",
      alignItems: { top: "flex-start", center: "center", bottom: "flex-end" }[verticalAlign],
      alignContent: { top: "start", center: "center", bottom: "end" }[verticalAlign],
      justifyContent: { left: "flex-start", center: "center", right: "flex-end" }[component.align],
      padding: plate || glass ? "10px 14px" : alias ? "7px 14px" : "0",
      border: glass ? "1px solid rgba(255,255,255,0.28)" : plate ? "2px solid rgba(255,255,255,0.32)" : alias ? "2px solid rgba(255,255,255,0.92)" : "none",
      borderRadius: glass ? "14px" : plate ? "12px" : "0",
      backdropFilter: glass ? "blur(12px) saturate(140%)" : plate ? "blur(2px)" : "none",
      boxShadow: glass ? "0 8px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.12)" : "none",
      letterSpacing: plate ? "0.02em" : "normal", fontVariantNumeric: builtIn ? "tabular-nums" : "normal",
      textShadow: glass && textAlpha > 0 ? `0 1px 3px rgba(0,0,0,${0.35 * textAlpha})`
        : builtIn && textAlpha > 0 ? `-2px -2px 0 rgba(0,0,0,${0.76 * textAlpha}), 2px -2px 0 rgba(0,0,0,${0.76 * textAlpha}), -2px 2px 0 rgba(0,0,0,${0.76 * textAlpha}), 2px 2px 0 rgba(0,0,0,${0.76 * textAlpha}), 0 0 14px rgba(0,0,0,${0.5 * textAlpha})` : "none",
      objectFit: "contain",
    });
    if (component.kind === "image") {
      if (component.image && element.getAttribute("src") !== component.image) element.src = component.image;
      if (!component.image) element.removeAttribute("src");
      element.alt = "";
      element.draggable = false;
    } else {
      const text = resolveOverlayText(component, state, now);
      if (component.kind === "clock") {
        element.textContent = text;
        clocks.push({ element, format: component.clockFormat });
      } else {
        if (element.firstElementChild?.tagName !== "SPAN") element.replaceChildren(document.createElement("span"));
        textElements.push({ element, component, text });
      }
    }
    stage.append(element);
  }
  for (const element of previous.values()) element.remove();
  const fitTexts = () => {
    for (const { element, component, text } of textElements) fitOverlayText(element, component, text);
  };
  fitTexts();
  let disposed = false;
  const onFontsLoaded = () => { if (!disposed) fitTexts(); };
  document.fonts.ready.then(onFontsLoaded);
  document.fonts.addEventListener("loadingdone", onFontsLoaded);
  let timer;
  if (clocks.length > 0) {
    timer = setInterval(() => {
      const current = new Date();
      for (const { element, format } of clocks) element.textContent = formatOverlayClock(format, current);
    }, 1000);
  }
  return () => {
    disposed = true;
    document.fonts.removeEventListener("loadingdone", onFontsLoaded);
    if (timer !== undefined) clearInterval(timer);
  };
}
