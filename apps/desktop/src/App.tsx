import { ThemeProvider } from "next-themes";
import { ErrorBoundary } from "react-error-boundary";
import { Toaster } from "@/components/ui/sonner";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

import { useDocumentStore } from "@/stores/document-store";
import { useClaudeChatStore } from "@/stores/claude-chat-store";
import { ProjectPicker } from "@/components/project-picker";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { lazy, Suspense, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ScientificSkillsOnboarding,
  shouldShowOnboarding,
} from "@/components/scientific-skills/scientific-skills-onboarding";
import { useUvSetupStore } from "@/stores/uv-setup-store";
import { ErrorFallback } from "@/components/error-fallback";
import { createLogger } from "@/lib/debug/logger";
import { LicenseDialog } from "@/components/license-dialog";
import { invoke } from "@tauri-apps/api/core";

const log = createLogger("app");

const LazyDebugPage = lazy(() =>
  import("@/components/debug/debug-page").then((m) => ({
    default: m.DebugPage,
  })),
);

function WorkspaceWithClaude() {
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const initialized = useDocumentStore((s) => s.initialized);
  const [showSkillsOnboarding, setShowSkillsOnboarding] = useState(false);

  // Update window title
  useEffect(() => {
    if (projectRoot) {
      const name = projectRoot.split(/[/\\]/).pop() || "ClaudePrism";
      getCurrentWindow().setTitle(`${name} - ClaudePrism`);
    }
  }, [projectRoot]);

  // Show scientific skills onboarding on first launch
  useEffect(() => {
    if (!initialized) return;
    if (shouldShowOnboarding()) {
      // Small delay so the workspace renders first
      const timer = setTimeout(() => setShowSkillsOnboarding(true), 800);
      return () => clearTimeout(timer);
    }
  }, [initialized]);

  // Auto-setup Python venv when project opens
  useEffect(() => {
    if (!initialized || !projectRoot) return;
    const uvStore = useUvSetupStore.getState();
    uvStore
      .checkStatus()
      .then(() => {
        const { status } = useUvSetupStore.getState();
        if (status === "ready") {
          return uvStore.setupVenv(projectRoot);
        }
      })
      .catch((err) => {
        log.error("Failed to setup Python venv", { error: String(err) });
      });
  }, [initialized, projectRoot]);

  // Consume pending initial prompt from project wizard
  useEffect(() => {
    if (!initialized) return;
    // Delay to let ClaudeChatDrawer mount and register event listeners
    const timer = setTimeout(() => {
      const prompt = useClaudeChatStore
        .getState()
        .consumePendingInitialPrompt();
      if (prompt) {
        useClaudeChatStore.getState().sendPrompt(prompt);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [initialized]);

  return (
    <>
      <WorkspaceLayout />
      {showSkillsOnboarding && (
        <ScientificSkillsOnboarding
          onClose={() => setShowSkillsOnboarding(false)}
        />
      )}
    </>
  );
}

export function App({ onReady }: { onReady?: () => void }) {
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const [showDebug, setShowDebug] = useState(false);
  const [licenseActivated, setLicenseActivated] = useState(false);
  const [licenseChecked, setLicenseChecked] = useState(false);

  // Register global keyboard shortcuts (Cmd+S, Cmd+N) at the app level
  useKeyboardShortcuts();

  // Check license on mount — call onReady only after content is ready to render,
  // so the window appears with UI instead of a blank white/black screen.
  useEffect(() => {
    invoke<{ activated: boolean }>("check_license")
      .then((result) => {
        setLicenseActivated(result.activated);
        setLicenseChecked(true);
        onReady?.();
      })
      .catch(() => {
        setLicenseActivated(false);
        setLicenseChecked(true);
        onReady?.();
      });
  }, [onReady]);

  // Listen for debug panel toggle (Ctrl+Shift+D)
  useEffect(() => {
    const handler = () => setShowDebug((prev) => !prev);
    window.addEventListener("toggle-debug-panel", handler);
    return () => window.removeEventListener("toggle-debug-panel", handler);
  }, []);

  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <TooltipProvider>
          {/* Global macOS titlebar drag region — sits above all content */}
          <div
            data-tauri-drag-region
            className="fixed inset-x-0 top-0 z-[9999] h-[var(--titlebar-height)]"
          />
          {!licenseChecked ? null : licenseActivated ? (
            projectRoot ? (
              <WorkspaceWithClaude />
            ) : (
              <ProjectPicker />
            )
          ) : null}
          <LicenseDialog
            open={licenseChecked && !licenseActivated}
            onActivated={() => setLicenseActivated(true)}
          />
          {showDebug && (
            <div className="fixed inset-0 z-[9998] flex items-end justify-center">
              <div
                className="absolute inset-0 bg-black/20"
                onClick={() => setShowDebug(false)}
              />
              <div className="relative h-[60vh] w-full border-border border-t bg-background shadow-lg">
                <div className="flex h-8 items-center justify-between border-border border-b bg-muted/50 px-3">
                  <span className="font-medium text-xs">Debug Panel</span>
                  <button
                    className="text-muted-foreground text-xs hover:text-foreground"
                    onClick={() => setShowDebug(false)}
                  >
                    Close (Ctrl+Shift+D)
                  </button>
                </div>
                <div className="h-[calc(60vh-2rem)] overflow-auto">
                  <Suspense
                    fallback={
                      <div className="p-4 text-muted-foreground text-sm">
                        Loading...
                      </div>
                    }
                  >
                    <LazyDebugPage />
                  </Suspense>
                </div>
              </div>
            </div>
          )}
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
