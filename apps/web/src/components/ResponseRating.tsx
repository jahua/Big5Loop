"use client";

import { useState } from "react";
import type { HumanRating } from "./types";

type Dimension = { key: keyof Omit<HumanRating, "comment">; label: string; hint: string };

const DIMENSIONS: Dimension[] = [
  { key: "relevance", label: "Relevance", hint: "Is the response on-topic and coherent?" },
  { key: "tone", label: "Tone", hint: "Is the emotional tone appropriate?" },
  { key: "personality_fit", label: "Personality Fit", hint: "Does the style match the user?" },
];

type ResponseRatingProps = {
  onSubmit: (rating: HumanRating) => void;
  submitted?: HumanRating | null;
};

function StarRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const [hover, setHover] = useState(0);

  return (
    <div className="careloop-rating__row">
      <div className="careloop-rating__label">
        <span className="careloop-rating__label-text">{label}</span>
        <span className="careloop-rating__hint">{hint}</span>
      </div>
      <div className="careloop-rating__stars" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`careloop-rating__star ${n <= (hover || value) ? "careloop-rating__star--filled" : ""}`}
            onClick={() => !disabled && onChange(n)}
            onMouseEnter={() => !disabled && setHover(n)}
            disabled={disabled}
            aria-label={`${label} ${n} of 5`}
          >
            {n <= (hover || value) ? "★" : "☆"}
          </button>
        ))}
        {value > 0 && <span className="careloop-rating__value">{value}/5</span>}
      </div>
    </div>
  );
}

export default function ResponseRating({ onSubmit, submitted }: ResponseRatingProps) {
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState({ relevance: 0, tone: 0, personality_fit: 0 });
  const [comment, setComment] = useState("");
  const isComplete = scores.relevance > 0 && scores.tone > 0 && scores.personality_fit > 0;

  if (submitted) {
    const avg = ((submitted.relevance + submitted.tone + submitted.personality_fit) / 3).toFixed(1);
    return (
      <div className="careloop-rating careloop-rating--submitted">
        <span className="careloop-rating__badge">
          Rated {avg}/5
          <span className="careloop-rating__badge-detail">
            R:{submitted.relevance} T:{submitted.tone} P:{submitted.personality_fit}
          </span>
        </span>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="careloop-rating__toggle"
        onClick={() => setOpen(true)}
      >
        ☆ Rate
      </button>
    );
  }

  const handleSubmit = () => {
    if (!isComplete) return;
    const rating: HumanRating = { ...scores, comment: comment.trim() || undefined };
    onSubmit(rating);
  };

  return (
    <div className="careloop-rating">
      <div className="careloop-rating__header">
        <span className="careloop-rating__title">Rate this response</span>
        <button
          type="button"
          className="careloop-rating__close"
          onClick={() => setOpen(false)}
          aria-label="Close rating"
        >
          ×
        </button>
      </div>

      {DIMENSIONS.map((d) => (
        <StarRow
          key={d.key}
          label={d.label}
          hint={d.hint}
          value={scores[d.key]}
          onChange={(v) => setScores((s) => ({ ...s, [d.key]: v }))}
          disabled={false}
        />
      ))}

      <textarea
        className="careloop-rating__comment"
        placeholder="Optional comment..."
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
      />

      <button
        type="button"
        className="careloop-rating__submit"
        onClick={handleSubmit}
        disabled={!isComplete}
      >
        Submit Rating
      </button>
    </div>
  );
}
