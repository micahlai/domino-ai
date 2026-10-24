"use client";

import { ArrowUp } from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "../ui/button";

export const DRAFT_KEY = "domino.investigate.draft";
export const SUGGESTION = "Investigate 2U's cash in late 2023";
export const NOT_CONNECTED =
  "Running investigations isn't connected yet. Your draft stays on this device.";

function saveDraft(value: string) {
  try {
    window.localStorage.setItem(DRAFT_KEY, value);
  } catch {
    // Private mode or blocked storage: the draft just lives in memory.
  }
}

export function ConversationPanel() {
  const [draft, setDraft] = useState("");
  const helpId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Read after mount so the server and first client render match.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DRAFT_KEY);
      if (saved) setDraft(saved);
    } catch {
      // Storage unavailable: start with an empty draft.
    }
  }, []);

  function update(value: string) {
    setDraft(value);
    saveDraft(value);
  }

  function onChange(event: ChangeEvent<HTMLTextAreaElement>) {
    update(event.target.value);
  }

  function fillSuggestion() {
    update(SUGGESTION);
    inputRef.current?.focus();
  }

  function onSubmit(event: FormEvent) {
    // Nothing runs yet. Sending is intentionally a no-op in this preview.
    event.preventDefault();
  }

  return (
    <aside aria-label="Conversation" className="flex min-h-0 flex-1 flex-col bg-card/40">
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">Conversation</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <p className="max-w-[32ch] text-sm leading-6 text-muted-foreground">
          Ask Domino to look into a company. Its work will appear on the canvas.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={fillSuggestion}
          className="mt-4 min-h-11 h-auto whitespace-normal text-left font-normal"
        >
          {SUGGESTION}
        </Button>
      </div>
      <form onSubmit={onSubmit} className="space-y-3 border-t p-4">
        <label htmlFor={inputId} className="sr-only">
          Message Domino
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          rows={4}
          value={draft}
          onChange={onChange}
          aria-describedby={helpId}
          placeholder="Ask about a company"
          className="min-h-[7rem] w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-base leading-6 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
        />
        <div className="flex items-start justify-between gap-3">
          <p id={helpId} className="text-xs leading-5 text-muted-foreground">
            {NOT_CONNECTED}
          </p>
          <Button type="submit" disabled className="min-h-11 shrink-0">
            Send
            <ArrowUp aria-hidden="true" />
          </Button>
        </div>
      </form>
    </aside>
  );
}
