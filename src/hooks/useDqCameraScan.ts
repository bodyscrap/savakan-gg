import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import {
  extractPlayerIdFromBarcodeResults,
  extractPlayerIdFromQrRawValue,
  isLikelyPlayerId,
} from "../domain/messageUtils";

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
};

type StartDqCameraScanOptions = {
  dialogOpen: boolean;
  onPlayerIdFound: (playerId: string) => void;
  onDialogError: (error: string) => void;
  onMessage: (message: string) => void;
};

function createQrBarcodeDetector(): BarcodeDetectorLike | null {
  const barcodeDetectorCtor = (window as unknown as {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }).BarcodeDetector;

  if (!barcodeDetectorCtor) {
    return null;
  }

  return new barcodeDetectorCtor({ formats: ["qr_code"] });
}

export function useDqCameraScan() {
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectingRef = useRef(false);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);

  function stopDqCameraScan() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    detectingRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    detectorRef.current = null;
    setCameraActive(false);
  }

  async function startDqCameraScan({
    dialogOpen,
    onPlayerIdFound,
    onDialogError,
    onMessage,
  }: StartDqCameraScanOptions) {
    if (!dialogOpen) {
      onDialogError("DQ申請対象が見つかりません。再度開き直してください。");
      return;
    }

    stopDqCameraScan();
    onDialogError("");

    if (!navigator.mediaDevices?.getUserMedia) {
      onDialogError("この環境ではカメラアクセスに対応していません。PLAYER IDを手入力してください。");
      return;
    }

    const detector = createQrBarcodeDetector();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
        },
        audio: false,
      });

      streamRef.current = stream;
      detectorRef.current = detector;

      const video = videoRef.current;
      if (!video) {
        stopDqCameraScan();
        onDialogError("カメラプレビューの初期化に失敗しました。");
        return;
      }

      const scanCanvas = canvasRef.current;
      if (!scanCanvas) {
        stopDqCameraScan();
        onDialogError("カメラスキャンの初期化に失敗しました。");
        return;
      }

      video.srcObject = stream;
      await video.play();
      setCameraActive(true);

      const tick = () => {
        void (async () => {
          if (!videoRef.current) {
            return;
          }
          if (videoRef.current.readyState < 2) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          if (detectingRef.current) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          detectingRef.current = true;
          try {
            let playerId = "";
            if (detectorRef.current) {
              const results = await detectorRef.current.detect(videoRef.current);
              playerId = extractPlayerIdFromBarcodeResults(results);
            }

            if (playerId === "" && videoRef.current) {
              const videoWidth = videoRef.current.videoWidth;
              const videoHeight = videoRef.current.videoHeight;
              if (videoWidth > 0 && videoHeight > 0) {
                if (scanCanvas.width !== videoWidth || scanCanvas.height !== videoHeight) {
                  scanCanvas.width = videoWidth;
                  scanCanvas.height = videoHeight;
                }

                const context = scanCanvas.getContext("2d", { willReadFrequently: true });
                if (context) {
                  context.drawImage(videoRef.current, 0, 0, scanCanvas.width, scanCanvas.height);
                  const imageData = context.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
                  const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: "attemptBoth",
                  });
                  const raw = decoded?.data?.trim() ?? "";
                  const normalized = extractPlayerIdFromQrRawValue(raw);
                  playerId = isLikelyPlayerId(normalized) ? normalized : "";
                }
              }
            }

            if (playerId !== "") {
              onPlayerIdFound(playerId);
              onMessage("カメラでPLAYER IDを読み取りました。");
              stopDqCameraScan();
              return;
            }
          } catch {
          } finally {
            detectingRef.current = false;
          }

          rafRef.current = requestAnimationFrame(tick);
        })();
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch (error) {
      stopDqCameraScan();
      onDialogError(`カメラを起動できませんでした: ${String(error)}`);
    }
  }

  useEffect(() => () => stopDqCameraScan(), []);

  return {
    cameraActive,
    videoRef,
    canvasRef,
    startDqCameraScan,
    stopDqCameraScan,
  };
}
