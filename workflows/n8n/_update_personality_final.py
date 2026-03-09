#!/usr/bin/env python3
"""
Final personality detection update. Conservative approach:
- Revert to proven v2 system message (no aggressive range/N calibration)
- Keep v2's 6 examples + add 1 high-E example (Chimichurri) = 7 total
- Preserve original case for LLM
"""
import json, re, sys
from pathlib import Path

WORKFLOW_DIR = Path(__file__).parent

TARGETS = [
    "careloop-phase1-2-postgres-mvp.json",
    "careloop-phase1-2-postgres-mvp-v2.json",
]

# Proven v2 system message (produced C=0.613, A=0.849) with minimal enhancement
SYS_MSG_CONTENT = (
    "You are a personality psychologist rating Big Five (OCEAN) traits from written utterances.\n\n"
    "CRITICAL calibration rules:\n"
    "- Rate the SPEAKER's personality from their STYLE. Not the topic content.\n"
    "- Each trait is INDEPENDENT. A friendly speaker (high A) can have any N, C, E, or O value.\n\n"
    "TRAIT GUIDE:\n"
    "O (Openness): HIGH = varied vocabulary ('satisfying', 'dainty', 'phenomenal', 'unspeakable'), creative phrasing. "
    "LOW = repetitive, simple words ('like', 'basically', 'actually'), filler-heavy.\n\n"
    "C (Conscientiousness): HIGH = formal register ('I see, well', 'I suppose', 'It seems to me'), "
    "structured comparison with clear details. "
    "LOW = disorganized ('Err...', 'Mmhm...'), repetition, "
    "'I might be wrong', scattered information, informal register.\n\n"
    "E (Extraversion): HIGH = warm, enthusiastic ('outstanding!', 'phenomenal!', 'love it', 'favourite'), "
    "exclamatory, engaging the listener ('you would love', 'Let me tell you'). "
    "LOW = flat, withdrawn ('I don't know'), monotone factual delivery.\n\n"
    "A (Agreeableness): HIGH = polite, collaborative ('would suggest', 'would appreciate', 'you would like', 'buddy', 'pal'). "
    "LOW = profane ('bloody', 'damn'), blunt ('rude', 'nasty', 'isn't as bad').\n\n"
    "N (Neuroticism): HIGH = stuttering ('re-re-recommend', 'it-it-italian'), genuine anxiety "
    "('I don't know!', 'I am not sure!', 'I might be wrong!' with exclamation), "
    "repetitive corrections, emotional volatility. "
    "LOW = calm, assured ('I imagine', 'I believe', 'I think that', 'It seems to me'), "
    "measured delivery. MODERATE = 'you know', 'okay?', 'alright?' are NEUTRAL filler, not neurotic.\n\n"
    'Return ONLY valid JSON: {"O":float,"C":float,"E":float,"A":float,"N":float}\n'
    "Each value in [-1.0, 1.0]. No explanation."
)

# v2 examples (6) + 1 high-E calibration example = 7 total
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
    # Restaurant/PERSONAGE domain (4)
    {
        "u": "Did you say Kin Khao and Tossed? Oh yeah, I would suggest them, wouldn't you? Kin Khao offers quite satisfactory food. I guess Tossed, however, has sort of acceptable food.",
        "a": '{"O":-0.2,"C":0.4,"E":0.0,"A":0.6,"N":-0.3}'
    },
    {
        "u": "Even if Tossed doesn't have nasty food, actually, the service is damn unmannered. I mean, basically, Kin Khao offers like, rude staff.",
        "a": '{"O":-0.3,"C":0.1,"E":0.2,"A":-0.4,"N":-0.2}'
    },
    {
        "u": "I don't know. I might re-re-recommend Sc-Sc-Scopa and Shabu-Tatsu! Scopa has... it provides bad atmosphere, but it features like, nice service, though. It's an it-it-italian and new american place.",
        "a": '{"O":-0.2,"C":-0.3,"E":-0.3,"A":0.4,"N":0.4}'
    },
    # NEW: High-E calibration (enthusiastic, engaging, high C)
    {
        "u": "You want to know more about Chimichurri Grill? I guess you would like it buddy because this restaurant, which is in Midtown West, is a latin american place with rather nice food and quite nice waiters, you know, okay?",
        "a": '{"O":0.4,"C":0.8,"E":0.8,"A":0.6,"N":-0.7}'
    },
]


def to_js_str(text: str) -> str:
    s = text.replace("\\", "\\\\")
    s = s.replace('"', '\\"')
    s = s.replace("'", "\\'")
    s = s.replace("\n", "\\n")
    s = s.replace("\t", "\\t")
    return s


def build_new_api_block() -> str:
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

        # Case preservation (idempotent)
        old_lower = "const userText = String(d.clean_msg || '').toLowerCase();"
        new_lower = "const userText = String(d.clean_msg || '');\nconst userTextLower = userText.toLowerCase();"
        if old_lower in code:
            code = code.replace(old_lower, new_lower)
            print("  [x] Case preservation")
        code = code.replace("heuristicOcean(userText)", "heuristicOcean(userTextLower)")
        code = code.replace(".test(userText)", ".test(userTextLower)")

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
            print("  [x] Replaced sysMsg + fewShot (7 examples)")
        elif "const prompt = " in code:
            code = re.sub(r"  const prompt = `.*?`;", lambda _: new_block, code, count=1, flags=re.DOTALL)
            code = code.replace("messages: [{role:'user',content:prompt}], temperature:0.3, max_tokens:100", "messages: msgs, temperature:0.1, max_tokens:100")
            code = code.replace("if (!model) model = 'google/gemma-3n-e4b-it';", "if (!model) model = 'meta/llama-3.3-70b-instruct';")
            code = code.replace("timeout: 12000", "timeout: 30000")
            code = code.replace("confidence = { O:0.7, C:0.7, E:0.7, A:0.7, N:0.7 };", "confidence = { O:0.8, C:0.8, E:0.8, A:0.8, N:0.8 };")
            print("  [x] Converted old format + applied all fixes")

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
            print(f"  WARNING: no STEP 3 node")
            ok = False
    if ok:
        print("\nDone.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
