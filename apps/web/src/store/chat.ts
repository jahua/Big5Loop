import { create } from "zustand";
import type {
  Message,
  ChatMode,
  PersonalityState,
  HealthStatus,
  AgentInfo,
  PersonalitySnapshot,
  SessionRouting,
  HumanRating,
} from "@/components/types";

const DEFAULT_AGENTS: AgentInfo[] = [
  { name: "Detector", role: "Personality detection via OCEAN analysis", status: "idle" },
  { name: "Regulator", role: "Behavior regulation and adaptation", status: "idle" },
  { name: "Generator", role: "Response generation with personality context", status: "idle" },
  { name: "Verifier", role: "Quality verification and refinement", status: "idle" },
  { name: "Coordinator", role: "Pipeline orchestration and routing", status: "idle" },
];

type ChatStore = {
  sessionId: string;
  messages: Message[];
  input: string;
  loading: boolean;
  error: string | null;
  personality: PersonalityState;
  coachingMode: string | null;
  sessionRouting: SessionRouting | null;
  chatMode: ChatMode;
  healthStatus: HealthStatus;
  feedbackByIndex: Record<number, "up" | "down">;
  ratingsByIndex: Record<number, HumanRating>;
  agents: AgentInfo[];
  activeTab: "chat" | "personality" | "agents";
  splashDone: boolean;

  setSessionId: (id: string) => void;
  setMessages: (msgs: Message[] | ((prev: Message[]) => Message[])) => void;
  addMessage: (msg: Message) => void;
  setInput: (val: string) => void;
  setLoading: (val: boolean) => void;
  setError: (val: string | null) => void;
  setPersonality: (ps: PersonalityState) => void;
  addPersonalitySnapshot: (ocean: Record<string, number>) => void;
  setCoachingMode: (mode: string | null) => void;
  setSessionRouting: (routing: SessionRouting | null) => void;
  setChatMode: (mode: ChatMode) => void;
  setHealthStatus: (status: HealthStatus) => void;
  setFeedback: (index: number, thumbs: "up" | "down") => void;
  clearFeedback: (index: number) => void;
  setRating: (index: number, rating: HumanRating) => void;
  setAgents: (agents: AgentInfo[]) => void;
  updateAgentStatus: (name: string, status: AgentInfo["status"]) => void;
  setActiveTab: (tab: "chat" | "personality" | "agents") => void;
  setSplashDone: () => void;
  resetSession: (newId: string) => void;
};

export const useChatStore = create<ChatStore>((set, get) => ({
  sessionId: "",
  messages: [],
  input: "",
  loading: false,
  error: null,
  personality: null,
  coachingMode: null,
  sessionRouting: null,
  chatMode: "standard",
  healthStatus: "unknown",
  feedbackByIndex: {},
  ratingsByIndex: {},
  agents: DEFAULT_AGENTS,
  activeTab: "chat",
  splashDone: false,

  setSessionId: (id) => set({ sessionId: id }),
  setMessages: (msgs) =>
    set((s) => ({
      messages: typeof msgs === "function" ? msgs(s.messages) : msgs,
    })),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setInput: (val) => set({ input: val }),
  setLoading: (val) => set({ loading: val }),
  setError: (val) => set({ error: val }),
  setPersonality: (ps) => set({ personality: ps }),
  addPersonalitySnapshot: (ocean) =>
    set((s) => {
      const snap: PersonalitySnapshot = {
        ocean,
        timestamp: new Date().toISOString(),
      };
      const prev = s.personality;
      if (!prev) return s;
      return {
        personality: {
          ...prev,
          history: [...(prev.history ?? []), snap].slice(-20),
        },
      };
    }),
  setCoachingMode: (mode) => set({ coachingMode: mode }),
  setSessionRouting: (routing) => set({ sessionRouting: routing }),
  setChatMode: (mode) => set({ chatMode: mode }),
  setHealthStatus: (status) => set({ healthStatus: status }),
  setFeedback: (index, thumbs) =>
    set((s) => ({ feedbackByIndex: { ...s.feedbackByIndex, [index]: thumbs } })),
  clearFeedback: (index) =>
    set((s) => {
      const next = { ...s.feedbackByIndex };
      delete next[index];
      return { feedbackByIndex: next };
    }),
  setRating: (index, rating) =>
    set((s) => ({ ratingsByIndex: { ...s.ratingsByIndex, [index]: rating } })),
  setAgents: (agents) => set({ agents }),
  updateAgentStatus: (name, status) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.name === name ? { ...a, status } : a)),
    })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSplashDone: () => set({ splashDone: true }),
  resetSession: (newId) =>
    set({
      sessionId: newId,
      messages: [],
      personality: null,
      coachingMode: null,
      sessionRouting: null,
      feedbackByIndex: {},
      ratingsByIndex: {},
      error: null,
      agents: DEFAULT_AGENTS,
    }),
}));
