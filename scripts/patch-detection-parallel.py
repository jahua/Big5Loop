#!/usr/bin/env python3
"""
Patch the PERSONAGE Benchmark workflow to run 3 ensemble detection API calls in parallel.
Run from big5loop/ or thesis project root:
  python scripts/patch-detection-parallel.py
"""
import json
import sys
from pathlib import Path

WORKFLOW_PATH = Path(__file__).resolve().parent.parent / "workflows" / "n8n" / "big5loop-phase1-2-postgres-mvp-v2-personage-benchmark.json"

# Match actual content in JSON (template literal uses " not \")
OLD_LOOP = """    const variantOutputs = [];
    for (const variant of promptVariants) {
      const msgs = [{ role: 'system', content: variant.system }];
      for (const ex of fewShot) {
        msgs.push({ role: 'user', content: `Utterance: "${ex.u}"` });
        msgs.push({ role: 'assistant', content: ex.a });
      }
      msgs.push({ role: 'user', content: `Utterance: "${userText.slice(0, 600)}"` });

      try {
        const body = await this.helpers.httpRequest({
          url: apiUrl,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: { model, messages: msgs, temperature: 0.1, max_tokens: 140 },
          timeout: 45000,
          json: true
        });
        const raw = body?.choices?.[0]?.message?.content || '';
        const parsed = parseOcean(raw);
        variantOutputs.push({ name: variant.name, raw, ocean: parsed });
      } catch (variantErr) {
        variantOutputs.push({ name: variant.name, raw: null, ocean: null, error: variantErr.message || String(variantErr) });
      }
    }"""

NEW_LOOP = """    const callVariant = async (variant) => {
      const msgs = [{ role: 'system', content: variant.system }];
      for (const ex of fewShot) {
        msgs.push({ role: 'user', content: 'Utterance: "' + ex.u + '"' });
        msgs.push({ role: 'assistant', content: ex.a });
      }
      msgs.push({ role: 'user', content: 'Utterance: "' + userText.slice(0, 600) + '"' });
      try {
        const body = await this.helpers.httpRequest({
          url: apiUrl, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
          body: { model, messages: msgs, temperature: 0.1, max_tokens: 80 },
          timeout: 20000, json: true
        });
        const raw = body?.choices?.[0]?.message?.content || '';
        return { name: variant.name, raw, ocean: parseOcean(raw) };
      } catch (err) {
        return { name: variant.name, raw: null, ocean: null, error: err.message || String(err) };
      }
    };
    const variantOutputs = await Promise.all(promptVariants.map(v => callVariant(v)));"""


def main():
    path = WORKFLOW_PATH
    if not path.exists():
        print(f"Workflow not found: {path}")
        sys.exit(1)

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    workflow = data[0] if isinstance(data, list) else data
    nodes = workflow.get("nodes", [])
    modified = False

    for node in nodes:
        if node.get("name") == "Zurich Model Detection (EMA)":
            code = node.get("parameters", {}).get("jsCode", "")
            if OLD_LOOP in code:
                node["parameters"]["jsCode"] = code.replace(OLD_LOOP, NEW_LOOP)
                modified = True
                print("Patched: Zurich Model Detection (EMA) - parallel API calls")
            else:
                print("Pattern not found. Workflow may already be patched or structure changed.")
                sys.exit(2)
            break

    if not modified:
        print("Detection node not found or already patched.")
        sys.exit(2)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"Saved: {path}")
    print("Next: Re-import workflow in N8N and publish.")


if __name__ == "__main__":
    main()
