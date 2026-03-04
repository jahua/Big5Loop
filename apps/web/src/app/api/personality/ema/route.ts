import { NextRequest, NextResponse } from "next/server";

const OCEAN_KEYS = ["O", "C", "E", "A", "N"] as const;
const DEFAULT_ALPHA = 0.3;
const CONFIDENCE_THRESHOLD = 0.4;

type OceanScores = Record<(typeof OCEAN_KEYS)[number], number>;
type ConfidenceScores = Record<(typeof OCEAN_KEYS)[number], number>;

interface DetectionOutput {
  ocean: OceanScores;
  confidence: ConfidenceScores;
  reasoning: string;
}

interface RequestBody {
  previous_state?: { ocean: OceanScores; confidence: ConfidenceScores } | null;
  detection_output: DetectionOutput;
  alpha?: number;
}

function applyEMA(
  previous: OceanScores | null,
  detection: DetectionOutput,
  alpha: number
): { ocean: OceanScores; confidence: ConfidenceScores; ema_applied: boolean } {
  const ocean: OceanScores = { O: 0, C: 0, E: 0, A: 0, N: 0 };
  const confidence = { ...detection.confidence };
  let ema_applied = false;
  for (const k of OCEAN_KEYS) {
    const conf = detection.confidence[k];
    const detected = detection.ocean[k];
    if (previous === null || conf < CONFIDENCE_THRESHOLD) {
      ocean[k] = previous === null ? detected : previous[k];
      if (previous === null) ema_applied = true;
    } else {
      ocean[k] = alpha * detected + (1 - alpha) * previous[k];
      ema_applied = true;
    }
  }
  return { ocean, confidence, ema_applied };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const { previous_state, detection_output, alpha = DEFAULT_ALPHA } = body;
    if (!detection_output?.ocean || !detection_output?.confidence) {
      return NextResponse.json(
        { error: "detection_output with ocean and confidence required" },
        { status: 400 }
      );
    }
    const previous =
      previous_state?.ocean && previous_state?.confidence
        ? previous_state.ocean
        : null;
    const result = applyEMA(previous, detection_output, alpha);
    const stable = false;
    return NextResponse.json({
      ...result,
      stable,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
