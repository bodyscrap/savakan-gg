import QRCode from "qrcode";

export type UserCardPlayer = {
  tournamentId: string;
  tournamentName: string;
  eventId: string;
  eventName: string;
  eventAlias: string | null;
  entrantId: string;
  entrantName: string;
  playerId: string;
};

function bytesToBase32(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0;
  let bitsLeft = 0;
  let output = "";

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;

    while (bitsLeft >= 5) {
      const index = (buffer >>> (bitsLeft - 5)) & 31;
      output += alphabet[index];
      bitsLeft -= 5;
    }
  }

  if (bitsLeft > 0) {
    const index = (buffer << (5 - bitsLeft)) & 31;
    output += alphabet[index];
  }

  return output;
}

export async function deriveEncryptedPlayerId(tournamentId: string, eventId: string, entrantId: string): Promise<string> {
  const source = `${tournamentId}:${eventId}:${entrantId}`;
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  const token = bytesToBase32(new Uint8Array(digest).slice(0, 12));
  return `PG-${token}`;
}

function sanitizeFileSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/[.]+$/g, "")
    .replace(/^-+|-+$/g, "");
  return normalized === "" ? "untitled" : normalized;
}

export function buildPlayerCardFileName(player: UserCardPlayer): string {
  const eventAlias = sanitizeFileSegment(player.eventAlias?.trim() || player.eventName || "event");
  const entrantName = sanitizeFileSegment(player.entrantName || "player");
  return `${eventAlias}_${entrantName}.png`;
}

export function buildPrintedPlayerCardPageFileName(eventAlias: string, pageNumber: number, totalPages: number): string {
  const safeEventAlias = sanitizeFileSegment(eventAlias || "event");
  return `${safeEventAlias}_${pageNumber}of${totalPages}.png`;
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("画像の生成に失敗しました。"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export async function renderPlayerCardCanvas(
  player: UserCardPlayer,
  options?: { width?: number; height?: number },
): Promise<HTMLCanvasElement> {
  const width = Math.max(700, Math.trunc(options?.width ?? 1200));
  const height = Math.max(420, Math.trunc(options?.height ?? 680));
  const pad = Math.round(width * 0.04);
  const qrSize = Math.round(Math.min(width * 0.44, height * 0.66));
  const infoX = pad + 30;
  const infoMaxWidth = Math.max(220, width - qrSize - pad * 2 - 96);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvasを初期化できませんでした。ブラウザ設定を確認してください。");
  }

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#f8fafc");
  bg.addColorStop(1, "#dbeafe");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#93c5fd";
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.ellipse(width * 0.83, height * 0.18, width * 0.21, height * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  drawRoundedRect(ctx, pad, pad, width - pad * 2, height - pad * 2, 24);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  const titleY = pad + 44;
  ctx.fillStyle = "#1e3a8a";
  ctx.font = "700 32px 'Noto Sans JP', sans-serif";
  ctx.fillText("PLAYER CARD", infoX, titleY);

  ctx.fillStyle = "#475569";
  ctx.font = "500 19px 'Noto Sans JP', sans-serif";
  ctx.fillText("savakan-gg tournament manager", infoX, titleY + 32);

  const aliasLabel = player.eventAlias && player.eventAlias.trim() !== ""
    ? player.eventAlias.trim()
    : "未設定";

  let cursorY = titleY + 110;

  ctx.fillStyle = "#0f172a";
  ctx.font = "700 46px 'Noto Sans JP', sans-serif";
  ctx.fillText(player.entrantName, infoX, cursorY, infoMaxWidth);

  cursorY += 48;
  drawRoundedRect(ctx, infoX - 2, cursorY - 24, infoMaxWidth, 50, 12);
  ctx.fillStyle = "#dbeafe";
  ctx.fill();
  ctx.strokeStyle = "#93c5fd";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#1d4ed8";
  ctx.font = "700 24px 'Noto Sans JP', sans-serif";
  ctx.fillText(`大会通称: ${aliasLabel}`, infoX + 12, cursorY + 10, infoMaxWidth - 18);

  cursorY += 56;
  ctx.fillStyle = "#334155";
  ctx.font = "600 21px 'Noto Sans JP', sans-serif";
  ctx.fillText(`正式名称: ${player.tournamentName} / ${player.eventName}`, infoX, cursorY, infoMaxWidth);

  cursorY += 52;
  drawRoundedRect(ctx, infoX - 2, cursorY - 34, infoMaxWidth, 84, 12);
  ctx.fillStyle = "#eff6ff";
  ctx.fill();
  ctx.strokeStyle = "#bfdbfe";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#1d4ed8";
  ctx.font = "600 21px 'Noto Sans JP', sans-serif";
  ctx.fillText("PLAYER ID", infoX + 16, cursorY - 4);

  ctx.fillStyle = "#0f172a";
  ctx.font = "700 29px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText(player.playerId, infoX + 16, cursorY + 32, infoMaxWidth - 26);

  const qrCanvas = document.createElement("canvas");
  const qrPayload = JSON.stringify({
    playerId: player.playerId,
    tournamentId: player.tournamentId,
    eventId: player.eventId,
    entrantId: player.entrantId,
  });
  await QRCode.toCanvas(qrCanvas, qrPayload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: qrSize,
    color: {
      dark: "#0f172a",
      light: "#ffffff",
    },
  });

  const qrX = width - pad - qrSize - 20;
  const qrY = Math.round((height - qrSize) / 2) - 8;
  drawRoundedRect(ctx, qrX - 16, qrY - 16, qrSize + 32, qrSize + 32, 14);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

  ctx.fillStyle = "#475569";
  ctx.font = "500 18px 'Noto Sans JP', sans-serif";
  ctx.fillText("2D code", qrX + qrSize / 2 - 34, qrY + qrSize + 36);

  ctx.fillStyle = "#64748b";
  ctx.font = "500 18px 'Noto Sans JP', sans-serif";
  ctx.fillText("Use this ID for remote DQ request identity verification.", infoX, height - pad - 24, infoMaxWidth);

  return canvas;
}
