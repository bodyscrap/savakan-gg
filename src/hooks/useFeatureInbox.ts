import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export function useFeatureInbox<T>(
  command: string,
  changedEvent: string,
  initial: T,
  onError: (error: string) => void,
) {
  const [data, setData] = useState(initial);
  const [ready, setReady] = useState(false);
  const mounted = useRef(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    const rows = await invoke<T>(command);
    if (mounted.current && request === revision.current) {
      setData(rows);
      setReady(true);
    }
  }, [command]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const unlisten = listen(changedEvent, () => {
      if (active) void refresh().catch((error) => onError(String(error)));
    });
    const unlistenErrors = listen<string>("message_delivery_error", (event) => onError(event.payload));
    void unlisten.then(() => active ? refresh() : undefined).catch((error) => onError(String(error)));
    void unlistenErrors.catch((error) => onError(String(error)));
    return () => {
      mounted.current = false;
      active = false;
      revision.current += 1;
      void unlisten.then((stop) => stop()).catch((error) => onError(String(error)));
      void unlistenErrors.then((stop) => stop()).catch((error) => onError(String(error)));
    };
  }, [changedEvent, onError, refresh]);

  return { data, ready, refresh };
}
