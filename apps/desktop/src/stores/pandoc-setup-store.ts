import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("pandoc");

// ─── Types ───

interface PandocStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
}

type PandocSetupStatus =
  | "checking"
  | "not-installed"
  | "installing"
  | "ready"
  | "error";

interface PandocSetupState {
  status: PandocSetupStatus;
  error: string | null;
  version: string | null;
  installOutput: string[];
  listenersReady: boolean;

  // Actions
  checkStatus: () => Promise<void>;
  install: () => Promise<void>;
  setListenersReady: (ready: boolean) => void;

  // Internal
  _addOutput: (line: string) => void;
  _finishInstall: (success: boolean) => void;
}

// ─── Store ───

export const usePandocSetupStore = create<PandocSetupState>((set, get) => ({
  status: "checking",
  error: null,
  version: null,
  installOutput: [],
  listenersReady: false,

  setListenersReady: (ready: boolean) => {
    set({ listenersReady: ready });
    // If already checked and found not installed, start install now
    const state = get();
    if (ready && state.status === "not-installed") {
      get().install();
    }
  },

  checkStatus: async () => {
    set({ status: "checking", error: null });
    try {
      const result = await invoke<PandocStatus>("detect_pandoc");

      if (!result.installed) {
        log.info("pandoc not installed");
        set({ status: "not-installed", version: null });
        // Only auto-install if listeners are ready
        if (get().listenersReady) {
          get().install();
        }
        return;
      }

      log.info(`pandoc ready: v${result.version}`);
      set({
        status: "ready",
        version: result.version,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({
        status: "error",
        error: message,
      });
    }
  },

  install: async () => {
    if (get().status === "installing") return; // Prevent double install
    set({ status: "installing", error: null, installOutput: [] });
    try {
      await invoke("install_pandoc");
      // Completion is driven by the "pandoc-install-complete" event
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({
        status: "error",
        error: message,
      });
    }
  },

  _addOutput: (line: string) => {
    set((state) => ({
      installOutput: [...state.installOutput, line],
    }));
  },

  _finishInstall: (success: boolean) => {
    if (success) {
      set({ status: "ready", installOutput: [] });
      get().checkStatus();
    } else {
      set({
        status: "error",
        error:
          "Pandoc installation failed. Please try again or install manually.",
        installOutput: [],
      });
    }
  },
}));

// ─── Event Listener Setup ───

let unlistenComplete: UnlistenFn | null = null;
let unlistenOutput: UnlistenFn | null = null;

export async function setupPandocEventListeners(): Promise<void> {
  if (unlistenComplete && unlistenOutput) return;

  unlistenOutput = await listen<string>("pandoc-install-output", (event) => {
    usePandocSetupStore.getState()._addOutput(event.payload);
  });

  unlistenComplete = await listen<boolean>(
    "pandoc-install-complete",
    (event) => {
      usePandocSetupStore.getState()._finishInstall(event.payload);
    },
  );

  // Signal that listeners are ready
  usePandocSetupStore.getState().setListenersReady(true);
}

export function cleanupPandocEventListeners() {
  if (unlistenComplete) {
    unlistenComplete();
    unlistenComplete = null;
  }
  if (unlistenOutput) {
    unlistenOutput();
    unlistenOutput = null;
  }
  usePandocSetupStore.getState().setListenersReady(false);
}
