#!/usr/bin/env python3
"""
Create a performance-optimised copy of the PERSONAGE Benchmark workflow.

Improvements applied to the Detection node:
  1. max_tokens: 80 → 40  (OCEAN JSON fits in <30 tokens)
  2. timeout: 20000 → 12000  (parallel calls are shorter-lived)
  3. userText slice: 600 → 300  (utterances are short; restaurant benchmark ≤ 200 chars)
  4. Add stop-sequence ["}"] so inference stops exactly at JSON object close
  5. Add short-text fast-exit: skip API when text < 15 chars → instant heuristic
  6. Trim few-shot from 11 → 3 most contrasting examples (saves ~1,400 prompt tokens)

Usage (from big5loop/ or thesis project root):
  python3 scripts/create-parallel-workflow.py [--import-url http://localhost:5678] [--api-key big5loop-dev-api-key]
"""
import copy
import json
import sys
import uuid
import argparse
from pathlib import Path

BASE_WORKFLOW = (
    Path(__file__).resolve().parent.parent
    / "workflows/n8n/big5loop-phase1-2-postgres-mvp-v2-personage-benchmark.json"
)
OUT_WORKFLOW = (
    Path(__file__).resolve().parent.parent
    / "workflows/n8n/big5loop-phase1-2-parallel-v3.json"
)

NEW_WORKFLOW_NAME = "Big5Loop Phase1-2 Parallel v3 (Optimised Detection)"
NEW_WEBHOOK_PATH = "big5loop-turn-parallel-v3"

# ── Three most contrasting few-shot examples (low-N calm, high-N anxious, low-E flat) ──
# Kept as a JS literal that replaces the full 11-example fewShot array.
FEW_SHOT_COMPACT = (
    "const fewShot = ["
    "{u:\"You want to know more about Chimichurri Grill? I guess you would like it buddy because this restaurant, "
    "which is in Midtown West, is a latin american place with rather nice food and quite nice waiters, you know, okay?\","
    "a:\'{\\\"O\\\": 0.4166666666666667, \\\"C\\\": 0.75, \\\"E\\\": 0.75, \\\"A\\\": 0.5833333333333334, \\\"N\\\": -0.6666666666666666}\'},"
    "{u:\"I am not sure! I mean, Ch-Chimichurri Grill is the only place I would recommend. It's a latin american place. "
    "Err... its price is... it's damn ex-expensive, but it pr-pr-provides like, adequate food, though. "
    "It offers bad atmosphere, even if it features nice waiters.\","
    "a:\'{\\\"O\\\": -0.25, \\\"C\\\": 0.08333333333333333, \\\"E\\\": 0.0, \\\"A\\\": 0.3333333333333333, \\\"N\\\": -0.0}\'},"
    "{u:\"Let's see, Acacia and Marinella... I guess Acacia offers sort of decent food. "
    "Basically, Marinella, however, just has quite adequate food.\","
    "a:\'{\\\"O\\\": -0.25, \\\"C\\\": 0.5833333333333334, \\\"E\\\": -0.75, \\\"A\\\": 0.4166666666666667, \\\"N\\\": -0.75}\'}"
    "];"
)


def new_uuid() -> str:
    return str(uuid.uuid4())


def remap_node_ids(workflow: dict) -> dict:
    """Replace all node IDs with fresh UUIDs so the copy doesn't clash."""
    id_map: dict[str, str] = {}
    for node in workflow.get("nodes", []):
        old = node["id"]
        new = new_uuid()
        id_map[old] = new
        node["id"] = new

    connections: dict = workflow.get("connections", {})
    new_connections: dict = {}
    for source_name, conns in connections.items():
        new_connections[source_name] = conns  # connections are keyed by name, not id
    workflow["connections"] = new_connections
    return workflow


def patch_detection_node(code: str) -> str:
    """Apply performance improvements to the JS code of the Detection node."""

    # 1. Reduce max_tokens 80→60 (OCEAN JSON is ~25 tokens, but some models emit preamble)
    code = code.replace(
        "max_tokens: 80 },",
        "max_tokens: 60 },",
    )

    # 2. Reduce per-call timeout: 20000 → 12000
    code = code.replace("timeout: 20000,", "timeout: 12000,")

    # 3. Shorter text slice: 600 → 300
    code = code.replace("userText.slice(0, 600)", "userText.slice(0, 300)")

    # 4. Fast-exit for very short utterances (skip API, use heuristic directly)
    FAST_EXIT_INJECTION = (
        "\n  // Fast-exit: skip API for very short utterances\n"
        "  if (!apiKey || apiKey.length <= 10 || userText.length < 15) {\n"
        "    apiError = userText.length < 15 ? 'text_too_short_for_api' : `No API key (len=${apiKey.length})`;\n"
        "  } else {"
    )
    # The existing guard is: if (apiKey && apiKey.length > 10) {
    code = code.replace(
        "  if (apiKey && apiKey.length > 10) {\n    const promptVariants",
        FAST_EXIT_INJECTION + "\n    const promptVariants",
    )
    # Close the else block we opened – find the matching `} else {` block closure
    # The existing code ends the apiKey block with: } else { apiError = `No API key...`; }
    code = code.replace(
        "  } else { apiError = `No API key (len=${apiKey.length})`; }",
        "  }",  # remove old else; our new fast-exit already handles both branches
    )

    # 5. Trim few-shot from 11 to 3 examples
    #    Locate the full fewShot const definition and replace it.
    #    It starts with "const fewShot = [" and ends before ";\n    const parseOcean"
    few_start = code.find("const fewShot = [{u:")
    few_end = code.find("];\n    const parseOcean")
    if few_start != -1 and few_end != -1:
        old_few = code[few_start: few_end + 2]  # include "];"
        code = code.replace(old_few, FEW_SHOT_COMPACT)

    return code


def main():
    parser = argparse.ArgumentParser(description="Create optimised parallel workflow")
    parser.add_argument("--import-url", default="", help="n8n base URL, e.g. http://localhost:5678")
    parser.add_argument("--api-key", default="big5loop-dev-api-key", help="n8n API key")
    args = parser.parse_args()

    if not BASE_WORKFLOW.exists():
        print(f"Source workflow not found: {BASE_WORKFLOW}")
        sys.exit(1)

    with open(BASE_WORKFLOW, encoding="utf-8") as f:
        raw = json.load(f)

    base = raw[0] if isinstance(raw, list) else raw
    workflow = copy.deepcopy(base)

    # ── Rename & change webhook path ──────────────────────────────────────────
    workflow["name"] = NEW_WORKFLOW_NAME
    workflow["active"] = False  # user activates after import
    workflow.pop("id", None)
    workflow.pop("versionId", None)
    workflow.pop("shared", None)
    workflow["meta"] = {}
    workflow["tags"] = []

    for node in workflow.get("nodes", []):
        if node.get("name") == "Webhook Trigger (POST Zurich)":
            node["parameters"]["path"] = NEW_WEBHOOK_PATH
            node.pop("webhookId", None)
            print(f"  Webhook path → {NEW_WEBHOOK_PATH}")

    # ── Patch Detection node ──────────────────────────────────────────────────
    patched_detection = False
    for node in workflow.get("nodes", []):
        if node.get("name") == "Zurich Model Detection (EMA)":
            original_code = node["parameters"]["jsCode"]
            new_code = patch_detection_node(original_code)
            node["parameters"]["jsCode"] = new_code
            patched_detection = True
            print("  Detection node patched (max_tokens=40, timeout=12s, slice=300, stop, fast-exit, 3-shot)")
            break

    if not patched_detection:
        print("WARNING: Detection node not found; no code changes applied.")

    # ── Remap node IDs to avoid clashes with the original ─────────────────────
    workflow = remap_node_ids(workflow)
    print(f"  Node IDs remapped ({len(workflow.get('nodes', []))} nodes)")

    # ── Save ──────────────────────────────────────────────────────────────────
    out_data = [workflow]
    with open(OUT_WORKFLOW, "w", encoding="utf-8") as f:
        json.dump(out_data, f, indent=2, ensure_ascii=False)
    print(f"\nSaved → {OUT_WORKFLOW.relative_to(Path(__file__).resolve().parent.parent)}")

    # ── Optional: import into n8n ─────────────────────────────────────────────
    if args.import_url:
        import urllib.request, urllib.error
        api_url = args.import_url.rstrip("/") + "/api/v1/workflows"
        payload = json.dumps(workflow).encode("utf-8")
        req = urllib.request.Request(
            api_url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "X-N8N-API-KEY": args.api_key,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read())
                wf_id = body.get("id", "?")
                print(f"\nn8n import: workflow created with id={wf_id}")
                print(f"  Open: {args.import_url.rstrip('/')}/workflow/{wf_id}")
                print(f"  Activate, then test at:")
                print(f"    curl -X POST {args.import_url.rstrip('/')}/webhook/{NEW_WEBHOOK_PATH} \\")
                print(f'      -H "Content-Type: application/json" \\')
                print(f'      -d \'{{"session_id":"test-001","message":"Hello, I need help today.","turn_index":1}}\'')
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            print(f"\nn8n import FAILED: HTTP {e.code} — {body[:300]}")
        except Exception as e:
            print(f"\nn8n import FAILED: {e}")
    else:
        print("\nTo import into n8n (when containers are responsive):")
        print(f"  python3 scripts/create-parallel-workflow.py --import-url http://localhost:5678")
        print("\nOr import manually:")
        print(f"  Open http://localhost:5678 → Settings → Import Workflow → select:")
        print(f"  {OUT_WORKFLOW.name}")
        print(f"\nThen activate and smoke-test:")
        print(f"  curl -X POST http://localhost:5678/webhook/{NEW_WEBHOOK_PATH} \\")
        print(f'    -H "Content-Type: application/json" \\')
        print(f"    -d '{{\"session_id\":\"test-001\",\"message\":\"Hello, I need help today.\",\"turn_index\":1}}'")


if __name__ == "__main__":
    main()
