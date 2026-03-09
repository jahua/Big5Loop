"use client";

import { useState } from "react";

type Mode = "emotional" | "practical" | "policy";

const MODE_META: Record<Mode, { label: string; icon: string; color: string }> = {
  emotional: { label: "Emotional Support", icon: "💙", color: "#e53935" },
  practical: { label: "Practical Education", icon: "📚", color: "#1e88e5" },
  policy:    { label: "Policy Navigation", icon: "📋", color: "#43a047" },
};

const STARTERS: Record<Mode, { label: string; prompt: string }[]> = {
  emotional: [
    { label: "Feeling overwhelmed", prompt: "I'm feeling overwhelmed with caregiving responsibilities and don't know where to turn. Can you help me?" },
    { label: "Anxiety about IV decision", prompt: "I'm very anxious about my upcoming IV assessment. What if they reject my application?" },
    { label: "Loneliness as caregiver", prompt: "I feel so isolated caring for my mother. Nobody understands what I'm going through." },
    { label: "Guilt about needing help", prompt: "I feel guilty about wanting to put my parent in a care home. Am I a bad person?" },
    { label: "Burnout signs", prompt: "I think I'm burning out from caregiving. I can't sleep and I'm always exhausted. What should I do?" },
    { label: "Fear of the future", prompt: "I'm scared about what will happen when my disability gets worse. How do I plan for the future?" },
    { label: "Dealing with grief", prompt: "My spouse was just diagnosed with a chronic illness. I'm struggling to process this emotionally." },
    { label: "Financial stress", prompt: "The financial pressure of managing care costs is making me incredibly stressed. I don't know how to cope." },
    { label: "Feeling unheard", prompt: "I feel like nobody at the IV office listens to me. How do I make them understand my situation?" },
    { label: "Self-care struggles", prompt: "I know I need to take care of myself, but I feel selfish whenever I take time away from caregiving." },
  ],
  practical: [
    { label: "Daily routine tips", prompt: "Give me a step-by-step plan to manage my daily caregiving routine more effectively." },
    { label: "Self-care strategies", prompt: "What are practical self-care strategies for someone caring for an elderly parent?" },
    { label: "Managing medications", prompt: "How do I organize and manage multiple medications for someone I'm caring for?" },
    { label: "Communication with doctors", prompt: "How should I prepare for medical appointments to get the most out of the doctor's time?" },
    { label: "Home safety modifications", prompt: "What home modifications should I make to ensure safety for someone with limited mobility?" },
    { label: "Respite care options", prompt: "What respite care options exist so I can take a break from caregiving without feeling guilty?" },
    { label: "Nutrition for elderly", prompt: "What nutrition tips should I follow when preparing meals for an elderly person with health issues?" },
    { label: "Legal documents needed", prompt: "What legal documents do I need to have in order as a caregiver? Power of attorney, living will, etc." },
    { label: "Finding support groups", prompt: "How do I find local caregiver support groups in my area in Switzerland?" },
    { label: "Technology for caregiving", prompt: "What technology tools or apps can help me manage caregiving tasks more efficiently?" },
  ],
  policy: [
    { label: "IV eligibility", prompt: "What are the eligibility requirements for Invalidenversicherung (IV) benefits in Switzerland?" },
    { label: "Zurich caregiver benefits", prompt: "What benefits and financial support are available for caregivers in Canton Zurich?" },
    { label: "Supplementary benefits (EL)", prompt: "How do Ergänzungsleistungen (supplementary benefits) work and am I eligible?" },
    { label: "IV registration process", prompt: "Walk me through the step-by-step process of registering for IV benefits." },
    { label: "Appealing IV decision", prompt: "My IV application was rejected. What are my options to appeal the decision?" },
    { label: "Hilflosenentschädigung", prompt: "What is Hilflosenentschädigung (helplessness allowance) and how do I apply for it?" },
    { label: "Part-time work with IV", prompt: "Can I work part-time while receiving IV benefits? What are the rules and income limits?" },
    { label: "AHV retirement questions", prompt: "How does the AHV retirement pension work and when should I start planning for it?" },
    { label: "Cantonal differences", prompt: "How do social insurance benefits differ between Swiss cantons? I live in Zurich." },
    { label: "Care cost deductions", prompt: "What tax deductions or financial relief is available for family caregiving expenses in Switzerland?" },
  ],
};

type ConversationStartersProps = {
  onSelect: (prompt: string) => void;
};

export default function ConversationStarters({ onSelect }: ConversationStartersProps) {
  const [activeMode, setActiveMode] = useState<Mode>("emotional");
  const modes: Mode[] = ["emotional", "practical", "policy"];

  return (
    <div className="careloop-starters">
      <div className="careloop-starters__tabs">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            className={`careloop-starters__tab ${activeMode === m ? "careloop-starters__tab--active" : ""}`}
            onClick={() => setActiveMode(m)}
            style={activeMode === m ? { borderColor: MODE_META[m].color, color: MODE_META[m].color } : undefined}
          >
            <span className="careloop-starters__tab-icon">{MODE_META[m].icon}</span>
            {MODE_META[m].label}
          </button>
        ))}
      </div>

      <div className="careloop-starters__grid">
        {STARTERS[activeMode].map((s) => (
          <button
            key={s.label}
            type="button"
            className="careloop-starters__card"
            onClick={() => onSelect(s.prompt)}
          >
            <span className="careloop-starters__label" style={{ color: MODE_META[activeMode].color }}>
              {s.label}
            </span>
            <span className="careloop-starters__preview">{s.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
