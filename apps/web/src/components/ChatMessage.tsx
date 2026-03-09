"use client";

import { useState } from "react";
import type { Message, HumanRating } from "./types";
import MarkdownContent from "./MarkdownContent";
import PipelineInfo from "./PipelineInfo";
import ResponseRating from "./ResponseRating";

function formatTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

type ChatMessageProps = {
  message: Message;
  index: number;
  feedback?: "up" | "down";
  onFeedback?: (index: number, thumbs: "up" | "down") => void;
  showThanks?: boolean;
  rating?: HumanRating | null;
  onRate?: (index: number, rating: HumanRating) => void;
};

export default function ChatMessage({
  message,
  index,
  feedback,
  onFeedback,
  showThanks = false,
  rating,
  onRate,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const canFeedback =
    !isUser && message.turn_index != null && onFeedback != null;

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const timeStr = formatTime(message.timestamp);
  const latencyStr =
    !isUser && message.latency_ms != null && message.latency_ms >= 0
      ? `${(message.latency_ms / 1000).toFixed(1)}s`
      : null;

  return (
    <div
      className={`careloop-msg ${isUser ? "careloop-msg--user" : "careloop-msg--assistant"}`}
    >
      <div className="careloop-msg__bubble">
        {isUser ? (
          <span className="careloop-msg__text">{message.content}</span>
        ) : (
          <MarkdownContent content={message.content} />
        )}
        <button
          type="button"
          className="careloop-msg__copy"
          onClick={handleCopy}
          aria-label="Copy message"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Compact meta line */}
      <div className="careloop-msg__meta">
        {timeStr && <span>{timeStr}</span>}
        {latencyStr && <span>{latencyStr}</span>}
        {!isUser && message.turn_index != null && (
          <span>Turn {message.turn_index}</span>
        )}
      </div>

      {/* Feedback buttons for assistant messages */}
      {canFeedback && (
        <div className="careloop-msg__actions">
          <button
            type="button"
            aria-label="Helpful"
            className={`careloop-msg__btn careloop-msg__btn--up ${feedback === "up" ? "careloop-msg__btn--active" : ""}`}
            onClick={() => onFeedback?.(index, "up")}
            disabled={!!feedback}
          >
            👍
          </button>
          <button
            type="button"
            aria-label="Not helpful"
            className={`careloop-msg__btn careloop-msg__btn--down ${feedback === "down" ? "careloop-msg__btn--active" : ""}`}
            onClick={() => onFeedback?.(index, "down")}
            disabled={!!feedback}
          >
            👎
          </button>
          {showThanks && (
            <span className="careloop-msg__thanks" role="status">
              Thanks!
            </span>
          )}
        </div>
      )}

      {/* Human rating */}
      {canFeedback && onRate && (
        <ResponseRating
          onSubmit={(r) => onRate(index, r)}
          submitted={rating}
        />
      )}

      {/* Pipeline metadata */}
      {!isUser && message.pipeline && <PipelineInfo pipeline={message.pipeline} />}

      {/* Citations */}
      {!isUser && message.citations && message.citations.length > 0 && (
        <details className="careloop-msg__citations">
          <summary>Sources ({message.citations.length})</summary>
          <ul className="careloop-msg__citations-list">
            {message.citations.map((c, i) => (
              <li key={c.source_id + String(i)}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="careloop-msg__citation-link"
                >
                  {c.title || c.source_id}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
