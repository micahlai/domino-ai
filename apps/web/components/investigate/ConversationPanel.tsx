"use client";

import { ArrowUp } from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import type { CanvasConnection, CanvasMessage } from "./types";

export const DRAFT_KEY = "domino.investigate.draft";
export const SUGGESTION = "Investigate 2U's cash in late 2023";
export const NOT_CONNECTED =
  "Running investigations isn't connected yet. Your draft stays on this device.";

const CONNECTION_HELP: Record<CanvasConnection, string> = {
  preview: NOT_CONNECTED,
  live: "Domino answers here. Its work appears on the canvas.",
  loading: "Loading the conversation…",
  offline: "You're offline. Reconnect to send. Your draft stays on this device.",
  unavailable: "Domino can't run investigations right now. Your draft stays on this device.",
};

export type ConversationPanelProps = {
  sessionId?: string;
  messages?: CanvasMessage[];
  connection?: CanvasConnection;
  pending?: boolean;
  error?: string;
  onSend?: (text: string) => void;
  onReveal?: () => void;
  onAlternative?: () => void;
  canReveal?: boolean;
  canAlternative?: boolean;
};

function draftKey(sessionId: string | undefined) {
  return sessionId ? `${DRAFT_KEY}:${sessionId}` : DRAFT_KEY;
}

function saveDraft(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the draft just lives in memory.
  }
}

export function ConversationPanel({
  sessionId,
  messages = [],
  connection = "preview",
  pending = false,
  error,
  onSend,
  onReveal,
  onAlternative,
  canReveal = false,
  canAlternative = false,
}: ConversationPanelProps) {
  const [draft, setDraft] = useState("");
  const helpId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const key = draftKey(sessionId);
  const canSend = connection === "live" && !!onSend && !pending && draft.trim() !== "";
  const showReveal = canReveal && !!onReveal;
  const showAlternative = canAlternative && !!onAlternative;

  // Read after mount so the server and first client render match.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(key);
      if (saved) setDraft(saved);
    } catch {
      // Storage unavailable: start with an empty draft.
    }
  }, [key]);

  // Keep the newest message in view as the parent delivers records.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when the count changes
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages.length]);

  function update(value: string) {
    setDraft(value);
    saveDraft(key, value);
  }

  function onChange(event: ChangeEvent<HTMLTextAreaElement>) {
    update(event.target.value);
  }

  function fillSuggestion() {
    update(SUGGESTION);
    inputRef.current?.focus();
  }

  function submit() {
    if (!canSend) return;
    // The parent records the question; nothing is added here until it comes back as a message.
    onSend?.(draft.trim());
    update("");
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  const help = pending ? "Domino is working on your question." : CONNECTION_HELP[connection];

  return (
    <aside aria-label="Conversation" className="flex min-h-0 flex-1 flex-col bg-card/40">
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">Conversation</h2>
      </header>
      <div
        ref={logRef}
        role="log"
        aria-label="Messages"
        aria-busy={connection === "loading"}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
      >
        {messages.length > 0 ? (
          <ol className="space-y-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className={cn(
                  "whitespace-pre-wrap break-words text-sm leading-6",
                  message.role === "user" &&
                    "ml-auto w-fit max-w-[85%] rounded-xl bg-muted px-3 py-2",
                  message.role === "system" && "text-xs text-muted-foreground",
                )}
              >
                <span className="sr-only">
                  {message.role === "user"
                    ? "You: "
                    : message.role === "assistant"
                      ? "Domino: "
                      : ""}
                </span>
                {message.text}
              </li>
            ))}
          </ol>
        ) : connection === "loading" ? null : (
          <>
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
          </>
        )}
      </div>
      {showReveal || showAlternative ? (
        <div className="flex flex-wrap gap-2 border-t px-4 pt-3">
          {showReveal ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onReveal}
              className="min-h-11"
            >
              Show what happened
            </Button>
          ) : null}
          {showAlternative ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onAlternative}
              className="min-h-11"
            >
              Try an alternative
            </Button>
          ) : null}
        </div>
      ) : null}
      <form
        onSubmit={onSubmit}
        className={cn("space-y-3 p-4", !(showReveal || showAlternative) && "border-t")}
      >
        <label htmlFor={inputId} className="sr-only">
          Message Domino
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          rows={4}
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          aria-describedby={helpId}
          placeholder="Ask about a company"
          className="min-h-[7rem] w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-base leading-6 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
        />
        <div className="flex items-start justify-between gap-3">
          <div id={helpId} className="space-y-1 text-xs leading-5">
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : null}
            <p aria-live="polite" className="text-muted-foreground">
              {help}
            </p>
          </div>
          <Button type="submit" disabled={!canSend} className="min-h-11 shrink-0">
            Send
            <ArrowUp aria-hidden="true" />
          </Button>
        </div>
      </form>
    </aside>
  );
}
