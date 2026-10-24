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

function resolveOverlayAnimationValue(source, state) {
  if (source === "redSetWins" || source === "blueSetWins") {
    return state.active ? String(state[source] ?? "") : "";
  }
  return resolveOverlayText({ kind: "text", source, text: "" }, state);
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

export function resolveOverlayFramePadding(component) {
  if (component.frame === "plate") {
    const scale = component.fontSize / 54;
    return `${10 * scale}px ${14 * scale}px`;
  }
  if (component.frame === "eventAlias") {
    const scale = component.fontSize / 28;
    return `${7 * scale}px ${14 * scale}px`;
  }
  return component.frame === "glass" ? "10px 14px" : "0";
}

export function resolveOverlayVerticalAlign(component) {
  return component.verticalAlign ?? (component.frame === "plate" || component.frame === "eventAlias" ? "center" : "top");
}

export function resolveOverlayTextOverflow(component) {
  return {
    wrap: component.wrapText ?? (!component.frame || component.frame === "glass" || component.frame === "image" || component.source === "roundText"),
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

const observedOverlayValues = new WeakMap();
let imageFreezeSequence = 0;

function releaseImagePlaybackUrl(image) {
  const playbackUrl = image.dataset.overlayPlaybackUrl;
  if (!playbackUrl) return;
  URL.revokeObjectURL(playbackUrl);
  delete image.dataset.overlayPlaybackUrl;
}

function canContainAnimation(source) {
  const match = /^data:(image\/(?:gif|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(source ?? "");
  if (!match) return false;
  const bytes = atob(match[2]);
  const mime = match[1].toLowerCase();
  if (mime === "image/gif") return bytes.startsWith("GIF87a") || bytes.startsWith("GIF89a");
  if (mime === "image/png") return bytes.includes("acTL");
  return bytes.includes("ANMF");
}

function setImageSource(image, source) {
  if (source && image.dataset.overlaySource === source) return;
  cancelImageFreeze(image);
  releaseImagePlaybackUrl(image);
  if (source) {
    image.dataset.overlaySource = source;
    image.src = source;
    if (canContainAnimation(source)) void freezeImageAtFirstFrame(image, source);
  } else {
    delete image.dataset.overlaySource;
    image.removeAttribute("src");
  }
}

function createImagePlaybackUrl(source) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(source);
  if (!match) return null;
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: match[1] }));
}

function restartImageAnimation(image) {
  const source = image.dataset.overlaySource;
  if (!source) return;
  cancelImageFreeze(image);
  const playbackUrl = createImagePlaybackUrl(source);
  if (!playbackUrl) {
    image.removeAttribute("src");
    image.src = source;
    return;
  }
  releaseImagePlaybackUrl(image);
  image.dataset.overlayPlaybackUrl = playbackUrl;
  image.src = playbackUrl;
}

function cancelImageFreeze(image) {
  delete image.dataset.overlayFreezeToken;
  if (image.dataset.overlayFreezeVisibility !== undefined) {
    image.style.visibility = image.dataset.overlayFreezeVisibility;
    delete image.dataset.overlayFreezeVisibility;
  }
}

function canvasImageData(image) {
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("Animated overlay image has no decoded frame.");
  }
  const maxDimension = 2048;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot capture an overlay animation frame.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function gifSubBlocksEnd(bytes, start) {
  let offset = start;
  while (offset < bytes.length) {
    const size = bytes[offset++];
    if (size === 0) return offset;
    offset += size;
    if (offset > bytes.length) return null;
  }
  return null;
}

function encodeBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function extractFirstGifFrame(source) {
  const match = /^data:(image\/gif);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(source);
  if (!match) return null;
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  if (bytes.length < 13
    || !["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.subarray(0, 6)))) return null;
  let offset = 13;
  if (bytes[10] & 0x80) offset += 3 * (1 << ((bytes[10] & 0x07) + 1));
  if (offset > bytes.length) return null;

  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) return null;
    if (marker === 0x21) {
      if (offset >= bytes.length) return null;
      offset += 1;
      const extensionEnd = gifSubBlocksEnd(bytes, offset);
      if (extensionEnd === null) return null;
      offset = extensionEnd;
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.length) return null;
    const imagePacked = bytes[offset + 8];
    offset += 9;
    if (imagePacked & 0x80) offset += 3 * (1 << ((imagePacked & 0x07) + 1));
    if (offset >= bytes.length) return null;
    offset += 1;
    const frameEnd = gifSubBlocksEnd(bytes, offset);
    if (frameEnd === null) return null;
    const stillFrame = new Uint8Array(frameEnd + 1);
    stillFrame.set(bytes.subarray(0, frameEnd));
    stillFrame[frameEnd] = 0x3b;
    return `data:${match[1]};base64,${encodeBase64(stillFrame)}`;
  }
  return null;
}

async function decodeFirstAnimationFrame(source) {
  const gifFrame = extractFirstGifFrame(source);
  if (gifFrame) return gifFrame;
  const decoderConstructor = globalThis.ImageDecoder;
  const match = /^data:(image\/(?:gif|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(source);
  if (typeof decoderConstructor !== "function" || !match) return null;
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  let decoder;
  try {
    decoder = new decoderConstructor({ data: bytes, type: match[1].toLowerCase() });
    await decoder.tracks.ready;
    const { image: frame } = await decoder.decode({ frameIndex: 0 });
    try {
      const maxDimension = 2048;
      const scale = Math.min(1, maxDimension / Math.max(frame.displayWidth, frame.displayHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(frame.displayWidth * scale));
      canvas.height = Math.max(1, Math.round(frame.displayHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Cannot capture the first overlay animation frame.");
      context.drawImage(frame, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } finally {
      frame.close();
    }
  } catch (error) {
    console.warn("Unable to decode the first overlay animation frame directly.", error);
    return null;
  } finally {
    decoder?.close();
  }
}

async function freezeImageAtFirstFrame(image, source) {
  const token = String(++imageFreezeSequence);
  image.dataset.overlayFreezeToken = token;
  image.dataset.overlayFreezeVisibility = image.style.visibility ?? "";
  image.style.visibility = "hidden";
  try {
    let firstFrame = await decodeFirstAnimationFrame(source);
    if (!firstFrame) {
      if (!image.complete && typeof image.decode === "function") await image.decode();
      firstFrame = canvasImageData(image);
    }
    if (image.dataset.overlayFreezeToken !== token || image.dataset.overlaySource !== source) return;
    releaseImagePlaybackUrl(image);
    image.src = firstFrame;
  } catch (error) {
    if (image.dataset.overlayFreezeToken === token) {
      console.error("Unable to freeze an animated overlay image at its first frame.", error);
    }
  } finally {
    if (image.dataset.overlayFreezeToken === token) cancelImageFreeze(image);
  }
}

function freezeImageAnimation(image) {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) {
    image.dataset.overlayFreezeOnLoad = "true";
    image.addEventListener("load", () => {
      if (image.dataset.overlayFreezeOnLoad !== "true") return;
      delete image.dataset.overlayFreezeOnLoad;
      freezeImageAnimation(image);
    }, { once: true });
    return;
  }
  const stillFrame = canvasImageData(image);
  releaseImagePlaybackUrl(image);
  image.src = stillFrame;
}

function releaseElementPlaybackUrls(element) {
  if (element.tagName === "IMG") releaseImagePlaybackUrl(element);
  for (const image of element.querySelectorAll?.("img") ?? []) releaseImagePlaybackUrl(image);
}

export function renderOverlayPreset(stage, preset, state) {
  Object.assign(stage.style, {
    position: "relative", width: `${preset.width}px`, height: `${preset.height}px`,
    overflow: "hidden", transformOrigin: "top left",
  });
  if (state.fullyStopped) {
    const visibilityOverrides = state.visibilityOverrides ?? {};
    observedOverlayValues.set(stage, {
      presetId: preset.id,
      active: state.active,
      currentSetId: state.currentSetId,
      animationSessionRevision: state.animationSessionRevision,
      animationTestRequest: { ...(state.animationTestRequest ?? {}) },
      visibilityShowRevisions: { ...(state.visibilityShowRevisions ?? {}) },
      animationValues: new Map(),
      visibility: new Map(preset.components.map((component) => [
        component.id, visibilityOverrides[component.id] ?? component.visible,
      ])),
    });
    stage.replaceChildren();
    return;
  }
  const previous = new Map(Array.from(stage.children, (element) => [element.dataset.componentId, element]));
  const clocks = [];
  const textElements = [];
  const now = new Date();
  const previousObservation = observedOverlayValues.get(stage);
  const hasPreviousObservation = previousObservation && previousObservation.presetId === preset.id;
  const sameAnimationSession = previousObservation?.animationSessionRevision === state.animationSessionRevision
    || (previousObservation?.animationSessionRevision === undefined && state.animationSessionRevision === undefined);
  const previousVisibility = hasPreviousObservation ? previousObservation.visibility : null;
  const sameActiveSession = hasPreviousObservation
    && sameAnimationSession
    && previousObservation.active
    && state.active
    && previousObservation.currentSetId === state.currentSetId;
  const startsNewActiveSession = state.active
    && (!hasPreviousObservation || !previousObservation.active || !sameAnimationSession
      || previousObservation.currentSetId !== state.currentSetId);
  const currentVisibility = new Map();
  const textById = new Map();
  const animationValues = new Map();
  const imagesToRestart = [];
  const visibilityOverrides = state.visibilityOverrides ?? {};
  const visibilityShowRevisions = state.visibilityShowRevisions ?? {};
  const animationTestRequest = state.animationTestRequest ?? {
    presetId: "", componentId: "", revision: 0, playing: false,
  };
  const previousAnimationTestRequest = previousObservation?.animationTestRequest;
  const animationTestRequestChanged = previousAnimationTestRequest
    && animationTestRequest.revision > previousAnimationTestRequest.revision;
  if (previousAnimationTestRequest?.playing
    && (!animationTestRequest.playing
      || animationTestRequest.presetId !== previousAnimationTestRequest.presetId
      || animationTestRequest.componentId !== previousAnimationTestRequest.componentId)) {
    const previousTestElement = previous.get(previousAnimationTestRequest.componentId);
    if (previousTestElement) {
      const images = [
        ...(previousTestElement.tagName === "IMG" ? [previousTestElement] : []),
        ...(previousTestElement.querySelectorAll?.("img") ?? []),
      ];
      for (const image of images) freezeImageAnimation(image);
    }
  }
  const previousVisibilityShowRevisions = previousObservation?.visibilityShowRevisions ?? {};
  const componentsBecameVisible = new Set();
  for (const component of preset.components) {
    const visible = visibilityOverrides[component.id] ?? component.visible;
    currentVisibility.set(component.id, visible);
    if (startsNewActiveSession && component.visible && visible && component.imageAnimationOnDisplay) {
      componentsBecameVisible.add(component.id);
    }
    if (sameActiveSession && previousVisibility?.get(component.id) === false && visible) {
      componentsBecameVisible.add(component.id);
    }
    if (previousObservation
      && sameActiveSession
      && visible
      && (visibilityShowRevisions[component.id] ?? 0)
        > (previousVisibilityShowRevisions[component.id] ?? 0)) {
      componentsBecameVisible.add(component.id);
    }
  }
  const changedAnimationComponents = new Set();
  const previousAnimationValues = previousObservation?.animationValues ?? new Map();
  if (sameActiveSession) {
    for (const component of preset.components) {
      const source = component.imageAnimationValueSource;
      if (!source) continue;
      const value = resolveOverlayAnimationValue(source, state);
      const previousValue = previousAnimationValues.get(component.id);
      if (previousValue?.source === source && previousValue.value !== value) {
        changedAnimationComponents.add(component.id);
      }
    }
  }
  for (const component of preset.components) {
    const source = component.imageAnimationValueSource;
    if (source) {
      animationValues.set(component.id, {
        source,
        value: resolveOverlayAnimationValue(source, state),
      });
    }
  }
  for (const component of preset.components) {
    if (component.kind !== "text" && component.kind !== "number") continue;
    const value = resolveOverlayText(component, state, now);
    textById.set(component.id, value);
  }
  observedOverlayValues.set(stage, {
    presetId: preset.id, active: state.active, currentSetId: state.currentSetId,
    animationSessionRevision: state.animationSessionRevision,
    animationTestRequest: { ...animationTestRequest },
    animationValues,
    visibility: currentVisibility, visibilityShowRevisions: { ...visibilityShowRevisions },
  });
  const hasOtherComponentVisibilityEvent = (componentId) =>
    Array.from(componentsBecameVisible).some((visibleComponentId) => visibleComponentId !== componentId);
  for (const component of preset.components) {
    if (currentVisibility.get(component.id) !== true) continue;
    const existing = previous.get(component.id);
    const tag = component.kind === "image" ? "IMG" : "DIV";
    const element = existing?.tagName === tag ? existing : document.createElement(tag);
    if (existing && existing !== element) {
      releaseElementPlaybackUrls(existing);
      existing.remove();
    }
    previous.delete(component.id);
    element.dataset.componentId = component.id;
    const frame = component.kind === "image" ? undefined : component.frame;
    const testAnimation = animationTestRequestChanged
      && animationTestRequest.playing
      && animationTestRequest.presetId === preset.id
      && animationTestRequest.componentId === component.id;
    const restartAnimation = testAnimation || (!state.suppressAnimationTriggers
      && ((component.imageAnimationOnDisplay && componentsBecameVisible.has(component.id))
        || (changedAnimationComponents.has(component.id) && !hasOtherComponentVisibilityEvent(component.id))));
    const glass = frame === "glass";
    const builtIn = !!frame && !glass && frame !== "image";
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
      webkitTextStroke: component.textOutlineWidth > 0
        ? `${component.textOutlineWidth}px ${component.textOutlineColor ?? "#000000"}` : "none",
      color: component.color, background: component.kind === "image" ? "transparent" : background, textAlign: component.align,
      whiteSpace: singleLine ? "nowrap" : "pre-wrap", overflow: "hidden",
      overflowWrap: singleLine ? "normal" : "anywhere", textOverflow: singleLine ? "ellipsis" : "clip",
      lineHeight: plate ? "1" : frame === "setSub" ? "1.05" : builtIn ? "1.1" : "1.15",
      display: plate || alias ? "flex" : "block",
      alignItems: { top: "flex-start", center: "center", bottom: "flex-end" }[verticalAlign],
      alignContent: { top: "start", center: "center", bottom: "end" }[verticalAlign],
      justifyContent: { left: "flex-start", center: "center", right: "flex-end" }[component.align],
      padding: resolveOverlayFramePadding({ frame, fontSize: component.fontSize }),
      border: glass ? "1px solid rgba(255,255,255,0.28)" : plate ? "2px solid rgba(255,255,255,0.32)" : alias ? "2px solid rgba(255,255,255,0.92)" : "none",
      borderRadius: glass ? "14px" : plate ? "12px" : "0",
      backdropFilter: glass ? "blur(12px) saturate(140%)" : plate ? "blur(2px)" : "none",
      boxShadow: glass ? "0 8px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.12)" : "none",
      letterSpacing: plate ? "0.02em" : "normal", fontVariantNumeric: builtIn ? "tabular-nums" : "normal",
      textShadow: glass && textAlpha > 0 ? `0 1px 3px rgba(0,0,0,${0.35 * textAlpha})`
        : builtIn && textAlpha > 0 ? `-2px -2px 0 rgba(0,0,0,${0.76 * textAlpha}), 2px -2px 0 rgba(0,0,0,${0.76 * textAlpha}), -2px 2px 0 rgba(0,0,0,${0.76 * textAlpha}), 2px 2px 0 rgba(0,0,0,${0.76 * textAlpha}), 0 0 14px rgba(0,0,0,${0.5 * textAlpha})` : "none",
      objectFit: component.kind === "image" && component.preserveAspectRatio === false ? "fill" : "contain",
      opacity: component.kind === "image" ? (component.imageAlpha ?? 255) / 255 : 1,
      transform: component.kind === "image" && component.flipHorizontal ? "scaleX(-1)" : "none",
      pointerEvents: frame === "image" ? "none" : "auto",
    });
    if (component.kind === "image") {
      setImageSource(element, component.image);
      if (component.image && restartAnimation) imagesToRestart.push(element);
      element.alt = "";
      element.draggable = false;
    } else {
      const text = textById.get(component.id) ?? resolveOverlayText(component, state, now);
      const hasFrameImage = frame === "image" && !!component.image;
      if (component.kind === "clock" && !hasFrameImage) {
        element.textContent = text;
        clocks.push({ element, format: component.clockFormat, content: null });
      } else {
        if (element.firstElementChild?.tagName !== "SPAN") element.replaceChildren(document.createElement("span"));
        const imageLayer = element.querySelector(":scope > img[data-overlay-frame-image]");
        if (hasFrameImage) {
          const layer = imageLayer ?? document.createElement("img");
          layer.dataset.overlayFrameImage = "true";
          setImageSource(layer, component.image);
          Object.assign(layer.style, {
            position: "absolute", inset: "0", width: "100%", height: "100%",
            objectFit: component.preserveAspectRatio === false ? "fill" : "contain",
            opacity: (component.imageAlpha ?? 255) / 255, zIndex: "0", pointerEvents: "none",
            transform: component.flipHorizontal ? "scaleX(-1)" : "none",
          });
          layer.alt = "";
          layer.draggable = false;
          if (!imageLayer) element.append(layer);
          if (restartAnimation) imagesToRestart.push(layer);
          Object.assign(element.firstElementChild.style, {
            position: "relative", zIndex: "1", pointerEvents: "none",
          });
        } else {
          if (imageLayer) releaseImagePlaybackUrl(imageLayer);
          imageLayer?.remove();
          element.firstElementChild.style.removeProperty("position");
          element.firstElementChild.style.removeProperty("z-index");
          element.firstElementChild.style.removeProperty("pointer-events");
        }
        if (component.kind === "clock") {
          element.firstElementChild.textContent = text;
          clocks.push({ element, format: component.clockFormat, content: element.firstElementChild });
        } else {
          textElements.push({ element, component, text });
        }
      }
    }
    stage.append(element);
  }
  for (const element of previous.values()) {
    releaseElementPlaybackUrls(element);
    element.remove();
  }
  for (const image of imagesToRestart) restartImageAnimation(image);
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
      for (const { element, format, content } of clocks) {
        const text = formatOverlayClock(format, current);
        if (content) content.textContent = text;
        else element.textContent = text;
      }
    }, 1000);
  }
  return () => {
    disposed = true;
    document.fonts.removeEventListener("loadingdone", onFontsLoaded);
    if (timer !== undefined) clearInterval(timer);
  };
}
