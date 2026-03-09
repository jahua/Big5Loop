#!/usr/bin/env python3
"""
Final refinement of personality detection in N8N workflows.
Fixes identified from scatter plot analysis:
1. N compressed to [-0.4, +0.1] — model never assigns positive N
2. E compressed for high values — det_E averages 0.3 when gt_E > 0.6
3. O capped at +0.3 — underestimates varied-vocabulary speakers

Changes:
- Add RANGE CALIBRATION section to system message
- Strengthen N calibration (stuttering = HIGH N, not low)
- Add 2 more targeted few-shot examples (high-N, high-E)
- Total: 8 examples (3 caregiving + 5 restaurant/PERSONAGE)
"""
import json, re, sys
from pathlib import Path

WORKFLOW_DIR = Path(__file__).parent

TARGETS = [
    "careloop-phase1-2-postgres-mvp.json",
    "careloop-phase1-2-postgres-mvp-v2.json",
]

SYS_MSG_CONTENT = (
    "You are a personality psychologist rating Big Five (OCEAN) traits from written utterances.\n\n"
    "CRITICAL calibration rules:\n"
    "- Rate the SPEAKER's personality from their STYLE. Not the topic content.\n"
    "- Each trait is INDEPENDENT. A friendly speaker (high A) can have any N, C, E, or O value.\n"
    "- USE THE FULL [-1.0, 1.0] RANGE. 0 means average/neutral. Assign |values| >= 0.5 when style evidence is strong.\n\n"
    "TRAIT GUIDE:\n"
    "O (Openness): HIGH (0.5-1.0) = varied/rich vocabulary ('satisfying', 'dainty', 'phenomenal', 'unspeakable'), creative phrasing, multiple adjectives. "
    "LOW (-0.5 to -1.0) = repetitive, simple words ('like', 'basically', 'actually'), filler-heavy, limited vocabulary.\n\n"
    "C (Conscientiousness): HIGH = formal register ('I see, well', 'I suppose', 'It seems to me'), "
    "structured comparison with clear details, organized presentation. "
    "LOW = disorganized ('Err...', 'Mmhm...'), repetition ('it's X, it's X'), "
    "'I might be wrong', scattered information, informal register.\n\n"
    "E (Extraversion): HIGH (0.5-1.0) = warm, enthusiastic ('outstanding!', 'phenomenal!', 'love it!', 'favourite!'), "
    "exclamatory punctuation, directly engaging the listener ('you would love', 'Let me tell you'). "
    "LOW (-0.5 to -1.0) = flat, withdrawn ('I don't know', 'there could be worse'), monotone factual delivery, no engagement.\n\n"
    "A (Agreeableness): HIGH = polite, collaborative ('would suggest', 'would appreciate', 'you would like', 'buddy', 'pal'). "
    "LOW = profane ('bloody', 'damn'), blunt ('rude', 'nasty', 'isn't as bad', 'the only place that is any good').\n\n"
    "N (Neuroticism): HIGH (0.3-1.0) = stuttering/repetition IN WORDS ('re-re-recommend', 'it-it-italian', 'do-do-dollars'), "
    "genuine anxiety or uncertainty WITH exclamation ('I don't know!', 'I might be wrong!'), "
    "self-corrections, emotional volatility. Stuttering is a STRONG N indicator (assign N >= 0.4). "
    "LOW (-0.5 to -1.0) = calm, assured ('I imagine', 'I believe', 'I think that', 'It seems to me'), "
    "measured and composed delivery. "
    "NEUTRAL (near 0) = casual fillers like 'you know', 'okay?', 'alright?' WITHOUT stuttering are NOT neurotic.\n\n"
    'Return ONLY valid JSON: {"O":float,"C":float,"E":float,"A":float,"N":float}\n'
    "Each value in [-1.0, 1.0]. No explanation."
)

FEWSHOT = [
    # Caregiving domain (3)
    {
        "u": "I have been feeling quite anxious lately, you know? I am not sure if my medication is working. Maybe I should talk to the doctor but I do not want to bother anyone.",
        "a": '{"O":-0.2,"C":0.1,"E":-0.4,"A":0.5,"N":0.7}'
    },
    {
        "u": "Good morning! Oh, I had the most wonderful walk in the garden today. The flowers are blooming beautifully, reminds me of my travels to Provence. I should paint them!",
        "a": '{"O":0.8,"C":0.3,"E":0.7,"A":0.4,"N":-0.5}'
    },
    {
        "u": "Fine. Took the pills. Food was okay. Slept.",
        "a": '{"O":-0.7,"C":0.2,"E":-0.8,"A":-0.3,"N":-0.2}'
    },
    # Restaurant/PERSONAGE domain — calibrated for range and N/E (5)
    {
        "u": "Did you say Kin Khao and Tossed? Oh yeah, I would suggest them, wouldn't you? Kin Khao offers quite satisfactory food. I guess Tossed, however, has sort of acceptable food.",
        "a": '{"O":-0.2,"C":0.4,"E":0.0,"A":0.6,"N":-0.3}'
    },
    {
        "u": "Even if Tossed doesn't have nasty food, actually, the service is damn unmannered. I mean, basically, Kin Khao offers like, rude staff.",
        "a": '{"O":-0.3,"C":0.1,"E":0.2,"A":-0.4,"N":-0.2}'
    },
    # HIGH N example: stuttering + hedging + exclamation → N must be high
    {
        "u": "I don't know. I might re-re-recommend Sc-Sc-Scopa and Shabu-Tatsu! Scopa has... it provides bad atmosphere, but it features like, nice service, though. It's an it-it-italian and new american place. I mean, Shabu-Tatsu is a japanese place. Even if the service is damn nice, it offers re-re-really bad atmosphere.",
        "a": '{"O":-0.2,"C":-0.3,"E":-0.3,"A":0.4,"N":0.4}'
    },
    # HIGH N + LOW A example: profanity + hedging + "I might be wrong"
    {
        "u": "I might be darn wrong. Scopa provides kind of bad ambiance! Err... even if Shabu-Tatsu doesn't have unfriendly waiters, it offers like, poor ambience, bad atmosphere.",
        "a": '{"O":-0.7,"C":-0.4,"E":0.2,"A":-0.6,"N":0.5}'
    },
    # HIGH E + HIGH O example: enthusiastic, exclamatory, rich vocabulary
    {
        "u": "You want to know more about Chimichurri Grill? I guess you would like it buddy because this restaurant, which is in Midtown West, is a latin american place with rather nice food and quite nice waiters, you know, okay?",
        "a": '{"O":0.4,"C":0.8,"E":0.8,"A":0.6,"N":-0.7}'
    },
]


def to_js_str(text: str) -> str:
    """Convert Python string to JavaScript double-quoted string innards."""
    s = text.replace("\\", "\\\\")
    s = s.replace('"', '\\"')
    s = s.replace("'", "\\'")
    s = s.replace("\n", "\\n")
    s = s.replace("\t", "\\t")
    return s


def build_new_api_block() -> str:
    """Build the complete sysMsg + fewShot + msgs block as JavaScript code."""
    js_sys = to_js_str(SYS_MSG_CONTENT)

    lines = []
    lines.append(f'    const sysMsg = "{js_sys}";')

    items = []
    for ex in FEWSHOT:
        u = to_js_str(ex["u"])
        a = to_js_str(ex["a"])
        items.append(f'{{u:"{u}",a:"{a}"}}')
    lines.append(f'    const fewShot = [{",".join(items)}];')

    lines.append("    const msgs = [{role:'system',content:sysMsg}];")
    lines.append("    for (const ex of fewShot) { msgs.push({role:'user',content:ex.u}); msgs.push({role:'assistant',content:ex.a}); }")
    lines.append("    msgs.push({role:'user',content:userText.slice(0,600)});")

    return "\n".join(lines)


def update_workflow(path: Path) -> bool:
    text = path.read_text("utf-8")
    data = json.loads(text)

    is_list = isinstance(data, list)
    workflow = data[0] if is_list else data

    updated = False
    for node in workflow.get("nodes", []):
        code = node.get("parameters", {}).get("jsCode", "")
        if "STEP 3: PERSONALITY DETECTION" not in code:
            continue

        # --- FIX 1: Preserve case (idempotent) ---
        old_lower = "const userText = String(d.clean_msg || '').toLowerCase();"
        new_lower = "const userText = String(d.clean_msg || '');\nconst userTextLower = userText.toLowerCase();"
        if old_lower in code:
            code = code.replace(old_lower, new_lower)
            print("  [x] Case preservation applied")

        code = code.replace("heuristicOcean(userText)", "heuristicOcean(userTextLower)")
        code = code.replace(".test(userText)", ".test(userTextLower)")

        # --- FIX 2+3: Replace sysMsg + fewShot ---
        new_block = build_new_api_block()

        if "const sysMsg = " in code:
            code = re.sub(r'    const sysMsg = ".*?";', lambda _: "", code, count=1, flags=re.DOTALL)
            code = re.sub(r'    const fewShot = \[.*?\];', lambda _: "", code, count=1, flags=re.DOTALL)
            code = re.sub(
                r"    const msgs = \[\{role:'system',content:sysMsg\}\];\n"
                r"    for \(const ex of fewShot\) \{ msgs\.push\(\{role:'user',content:ex\.u\}\); msgs\.push\(\{role:'assistant',content:ex\.a\}\); \}\n"
                r"    msgs\.push\(\{role:'user',content:userText\.slice\(0,600\)\}\);",
                lambda _: "", code, count=1, flags=re.DOTALL
            )
            code = code.replace(
                "    const body = await this.helpers.httpRequest(",
                new_block + "\n    const body = await this.helpers.httpRequest("
            )
            code = re.sub(r'\n{3,}', '\n\n', code)
            print("  [x] Replaced sysMsg + fewShot (8 examples: 3 caregiving + 5 restaurant)")

        elif "const prompt = " in code:
            code = re.sub(r"  const prompt = `.*?`;", lambda _: new_block, code, count=1, flags=re.DOTALL)
            code = code.replace(
                "messages: [{role:'user',content:prompt}], temperature:0.3, max_tokens:100",
                "messages: msgs, temperature:0.1, max_tokens:100"
            )
            code = code.replace("if (!model) model = 'google/gemma-3n-e4b-it';", "if (!model) model = 'meta/llama-3.3-70b-instruct';")
            code = code.replace("timeout: 12000", "timeout: 30000")
            code = code.replace("confidence = { O:0.7, C:0.7, E:0.7, A:0.7, N:0.7 };", "confidence = { O:0.8, C:0.8, E:0.8, A:0.8, N:0.8 };")
            print("  [x] Converted old prompt to sysMsg + fewShot + updated model/temp/timeout")

        node["parameters"]["jsCode"] = code
        updated = True
        print(f"  Node: {node.get('name', '?')}")

    if updated:
        out = data if is_list else workflow
        path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  Saved: {path.name}")
    return updated


def main():
    ok = True
    for name in TARGETS:
        p = WORKFLOW_DIR / name
        if not p.exists():
            print(f"SKIP: {name}")
            continue
        print(f"\nProcessing: {name}")
        if not update_workflow(p):
            print(f"  WARNING: no STEP 3 node found")
            ok = False
    if ok:
        print("\nDone. Import into N8N and restart.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
