"use client";
import { useEffect } from "react";
import { Button } from "../ui/button";

export function ReloadSavedResults() {
  useEffect(() => {
    function reload(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.key.toLowerCase() !== "r" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input,textarea,select,[contenteditable],[role=dialog]")
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      window.location.reload();
    }
    window.addEventListener("keydown", reload);
    return () => window.removeEventListener("keydown", reload);
  }, []);
  return (
    <div className="mb-5 flex items-center justify-end gap-3">
      <span className="text-xs text-muted-foreground">Shortcut: R</span>
      <Button
        size="sm"
        variant="ghost"
        className="min-h-9 text-xs text-muted-foreground"
        onClick={() => window.location.reload()}
      >
        Reload saved results
      </Button>
    </div>
  );
}
