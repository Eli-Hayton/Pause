import json
import os
import re
import sys
import traceback
from pathlib import Path
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from dotenv import load_dotenv
from flask import Flask, render_template, request, send_file, send_from_directory

# Resolve configuration relative to this file so Windows/VS Code can launch
# the project from any working directory (including temporary ZIP folders).
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / "pause.env", override=True)
load_dotenv(BASE_DIR / ".env", override=False)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
if OPENAI_API_KEY.upper().startswith("PASTE_"):
    OPENAI_API_KEY = ""
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-6-luna").strip() or "gpt-6-luna"
app = Flask(__name__)
EXTENSION_DIR = BASE_DIR / "extension"
STATIC_DIR = BASE_DIR / "static"
EXTENSION_ZIP = STATIC_DIR / "pause-extension.zip"


def build_local_plan(*, short_limit_num, long_limit_num, trigger, goal, interests, situation, energy, feedback, previous_ideas):
    """Create a useful personalized plan without any external AI service."""
    raw_interests = [x.strip() for x in re.split(r"[,;\n/]+", interests or "") if x.strip()]
    # Keep hobby phrases short so a sentence such as "I like coding" does not become an action verbatim.
    cleaned_interests = []
    for item in raw_interests[:8]:
        item = re.sub(r"^(i\s+(?:really\s+)?(?:like|love|enjoy)\s+)", "", item, flags=re.I).strip(" .")
        if item and item.lower() not in {x.lower() for x in cleaned_interests}:
            cleaned_interests.append(item[:48])

    context = " ".join([situation or "", feedback or "", goal or ""]).lower()
    desk_only = any(k in context for k in ["desk", "class", "library", "work", "homework", "assignment"])
    very_short = any(k in context for k in ["under 5", "less than 5", "shorter", "quick"])
    social = any(k in context for k in ["social", "friend", "roommate", "people", "talk"])
    low_energy = (energy or "").lower() in {"low", "very low", "minimal"} or "low energy" in context

    ideas = []
    seen = set()
    def add(title, minutes):
        title = re.sub(r"\s+", " ", str(title)).strip().rstrip(".")
        if not title:
            return
        key = title.lower()
        if key in seen:
            return
        seen.add(key)
        ideas.append({
            "title": title[:180],
            "reason": f"A small break that should fit in about {minutes} minute{'s' if minutes != 1 else ''}.",
            "minutes": max(1, min(15, int(minutes))),
        })

    # Context-aware ideas first.
    if desk_only:
        add("Close every tab you do not need and reopen only the next task", 2)
        add("Write the next single step of your assignment on paper", 2)
        add("Look away from the screen and reset your desk for one minute", 1)
    else:
        add("Change rooms or seats before deciding what to do next", 3)
        add("Step away from the feed and look somewhere far away for a minute", 1)

    if social:
        add("Send one message to someone you actually want to talk to", 3)
        add("Ask someone nearby one real question instead of opening a feed", 4)
    if low_energy:
        add("Listen to one song from start to finish with the feed closed", 4)
        add("Sit with no feed open for two minutes", 2)
    else:
        add("Do one tiny physical reset, then come back to the next task", 3)

    # Use specific interests sparingly (max ~10 of 30).
    for hobby in cleaned_interests[:6]:
        add(f"Spend 5 minutes on one tiny piece of {hobby}", 5)
        if len(ideas) < 12:
            add(f"Write down one small idea you want to try later for {hobby}", 2)

    broad = [
        ("Listen to one saved song without opening another app", 4),
        ("Write down the next single thing you want to finish", 2),
        ("Draw one tiny doodle or icon", 4),
        ("Send one message you have been meaning to send", 3),
        ("Play one short offline puzzle round", 5),
        ("Read two pages of something you intentionally chose", 6),
        ("Put away five things near you", 3),
        ("Make a quick list of three things you want to do later", 3),
        ("Reply to one text or message", 3),
        ("Solve one paper or offline brain teaser", 5),
        ("Write one sentence about what you were working on before scrolling", 2),
        ("Pick the first task you want to do tomorrow", 2),
        ("Look through five photos you already have saved", 3),
        ("Write down one idea you do not want to forget", 2),
        ("Do one short round of a non-feed game", 6),
        ("Prepare exactly what you need for your next task", 4),
        ("Set a 5-minute timer and work on only one tiny task", 5),
        ("Choose one intentional video or article instead of browsing a feed", 8),
        ("Make a two-item mini to-do list", 2),
        ("Rename or organize one file you have been ignoring", 3),
        ("Put your phone or browser out of reach for three minutes", 3),
        ("Write one question you want answered later instead of searching now", 2),
        ("Choose one saved piece of music and listen without multitasking", 5),
        ("Do one tiny creative task with a clear stopping point", 5),
        ("Take one minute to decide whether you want rest or progress next", 1),
        ("Open the thing you meant to work on and do only the first step", 4),
        ("Make a quick note of why you opened the feed in the first place", 2),
        ("Choose one small task you can completely finish before scrolling again", 5),
        ("Spend two minutes doing absolutely nothing on a feed", 2),
        ("Set up your next task so starting it takes less effort", 4),
        ("Read one saved note, bookmark, or document you chose earlier", 5),
        ("Write three words describing what you need right now", 1),
    ]

    # If user asked for shorter activities, skip longer items first.
    for title, minutes in broad:
        if very_short and minutes > 5:
            continue
        add(title, minutes)
        if len(ideas) >= 30:
            break

    # Guarantee 30 items even after aggressive filtering.
    refill = [
        ("Count backwards from 30 without opening another tab", 2),
        ("Write one line about what would make the next 10 minutes useful", 2),
        ("Choose one thing to finish before your next feed check", 2),
        ("Look at your calendar and identify the next real obligation", 2),
        ("Put one distracting item out of reach", 1),
        ("Clear one small notification you actually need to answer", 2),
        ("Choose one intentional break and give it a clear ending", 3),
    ]
    i = 0
    while len(ideas) < 30:
        title, minutes = refill[i % len(refill)]
        suffix = "" if i < len(refill) else f" #{1 + i // len(refill)}"
        add(title + suffix, minutes)
        i += 1

    # If this was a refinement, rotate the list so it visibly changes instead of seeming frozen.
    if feedback and previous_ideas:
        shift = min(7, max(1, len(feedback) % 8))
        ideas = ideas[shift:] + ideas[:shift]

    return {
        "headline": "Make the break feel intentional.",
        "summary": f"Pause will check in after {short_limit_num} minutes of Shorts/Reels and {long_limit_num} minutes of long YouTube, then offer alternatives matched to your setup.",
        "nudge": "Still choosing the feed, or ready for a different kind of break?",
        "assistant_reply": "I updated the list using what you told me and kept a mix of personal and general ideas.",
        "activities": ideas[:30],
    }


def build_extension_zip():
    STATIC_DIR.mkdir(exist_ok=True)
    if not EXTENSION_DIR.exists():
        return
    with ZipFile(EXTENSION_ZIP, "w", ZIP_DEFLATED) as archive:
        for path in EXTENSION_DIR.rglob("*"):
            if path.is_file():
                archive.write(path, path.relative_to(EXTENSION_DIR))


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/setup")
def setup():
    return render_template("setup.html")


@app.get("/demo")
def demo():
    return render_template("demo.html")


@app.post("/plan")
def plan():
    apps = request.form.getlist("apps")
    if not apps:
        return render_template("setup.html", error="Choose YouTube, Instagram, or both."), 400
    trigger = request.form.get("trigger", "").strip()
    short_limit = request.form.get("short_limit", "").strip()
    long_limit = request.form.get("long_limit", "").strip()
    goal = request.form.get("goal", "").strip()
    interests = request.form.get("interests", "").strip()
    situation = request.form.get("situation", "").strip()
    energy = request.form.get("energy", "").strip()
    friction = request.form.get("friction", "medium").strip() or "medium"
    raw_previous_ideas = request.form.get("previous_ideas", "[]")
    try:
        previous_ideas = json.loads(raw_previous_ideas)
        if not isinstance(previous_ideas, list):
            previous_ideas = []
    except json.JSONDecodeError:
        previous_ideas = []
    previous_ideas = [str(x).strip()[:180] for x in previous_ideas if str(x).strip()][:30]
    feedback = request.form.get("feedback", "").strip()
    raw_chat_history = request.form.get("chat_history", "[]")
    try:
        chat_history = json.loads(raw_chat_history)
        if not isinstance(chat_history, list):
            chat_history = []
    except json.JSONDecodeError:
        chat_history = []

    # Keep only simple, recent chat turns so the hidden form field cannot grow forever.
    chat_history = [
        {"role": turn.get("role"), "content": str(turn.get("content", ""))[:700]}
        for turn in chat_history[-10:]
        if isinstance(turn, dict) and turn.get("role") in {"user", "assistant"}
    ]
    if feedback:
        chat_history.append({"role": "user", "content": feedback[:700]})

    try:
        short_limit_num = max(1, min(60, int(short_limit)))
        long_limit_num = max(5, min(240, int(long_limit)))
    except ValueError:
        return render_template("setup.html", error="Choose valid time limits."), 400

    # Build a local personalized plan first. The external AI is optional enhancement only.
    fallback = build_local_plan(
        short_limit_num=short_limit_num,
        long_limit_num=long_limit_num,
        trigger=trigger,
        goal=goal,
        interests=interests,
        situation=situation,
        energy=energy,
        feedback=feedback,
        previous_ideas=previous_ideas,
    )

    plan_data = fallback
    ai_error = None
    try:
        if not OPENAI_API_KEY:
            raise RuntimeError(
                "OPENAI_API_KEY is missing. Put it in pause.env next to main.py."
            )

        # Call the OpenAI REST API directly with Python's standard library.
        # This avoids importing the OpenAI SDK, which can be slow or broken on
        # some Windows/Python installations.
        messages = [
            {
                "role": "system",
                "content": (
                    "You are the setup coach for Pause, a browser extension that interrupts accidental doom-scrolling. "
                    "Return JSON only with keys headline, summary, nudge, assistant_reply, activities. Keep copy concise. "
                    "activities must be exactly 30 UNIQUE strings in the format '<minutes>m | <action>'. Use whole minutes from 1 to 15. "
                    "The action MUST actually be finishable in the stated time; scale the action down when needed (for example, 'sketch one tiny doodle' instead of 'work on art'). "
                    "Do not quote a user's sentence as an instruction. If they write 'I like coding', infer the interest 'coding' and create a concrete action. "
                    "Do not hyper-focus on hobbies: no more than 12 of 30 ideas should directly reference a listed hobby. At least 10 should be broadly useful, context-aware alternatives. "
                    "Use a varied mix of creative, social, mental reset, tiny practical, intentional entertainment, and environment-change ideas when appropriate. "
                    "Respect the user's setting and break-energy preference. Do not suggest something impossible from that setting. "
                    "Avoid repetitive generic filler. Walking, snacks, water, breathing, journaling, cleaning, and stretching should appear only when they genuinely fit the user's answers, and never dominate the list. "
                    "If there is newest feedback, it is high priority and the new list must materially change. If previous ideas are provided, replace at least 18 of them unless the feedback asks for only a tiny change. "
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Apps: {', '.join(apps)}. Trigger: {trigger}. Short limit: {short_limit_num}m. Long YouTube limit: {long_limit_num}m. "
                    f"Goal: {goal}. Interests: {interests or 'none supplied'}. Situation: {situation}. Break energy: {energy}. "
                    f"Intent-check difficulty: {friction}. Recent conversation: {json.dumps(chat_history[-6:-1] if feedback else chat_history[-6:])}. "
                    f"Previous ideas: {json.dumps(previous_ideas)}. Newest refinement: {feedback or 'none'}. "
                    "Build a practical, varied break list for the exact moment the scrolling timer expires."
                ),
            },
        ]
        payload = json.dumps({"model": OPENAI_MODEL, "messages": messages}).encode("utf-8")
        api_request = Request(
            "https://api.openai.com/v1/chat/completions",
            data=payload,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(api_request, timeout=60) as response:
                api_result = json.loads(response.read().decode("utf-8"))
        except HTTPError as http_exc:
            body = http_exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"OpenAI HTTP {http_exc.code}: {body[:1200]}") from http_exc
        except URLError as url_exc:
            raise RuntimeError(f"OpenAI network error: {url_exc.reason}") from url_exc

        try:
            raw_content = (api_result["choices"][0]["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError) as shape_exc:
            raise ValueError(f"Unexpected OpenAI response shape: {api_result}") from shape_exc
        if not raw_content:
            raise ValueError("The AI returned an empty response.")

        # Models sometimes wrap JSON in markdown fences even when told not to.
        # Strip fences and, if needed, recover the first JSON object.
        cleaned = raw_content
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.I)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start == -1 or end == -1 or end <= start:
                raise
            parsed = json.loads(cleaned[start:end + 1])

        raw_activities = parsed.get("activities", [])
        if isinstance(raw_activities, list):
            activities = []
            seen = set()
            for item in raw_activities:
                raw = str(item).strip() if not isinstance(item, dict) else f"{item.get('minutes', 5)}m | {item.get('title', '')}"
                match = __import__('re').match(r"^\s*(\d{1,2})\s*m(?:in)?\s*\|\s*(.+)$", raw, flags=__import__('re').I)
                if not match:
                    continue
                minutes = max(1, min(15, int(match.group(1))))
                title = match.group(2).strip()[:180]
                key = title.lower()
                if title and key not in seen:
                    seen.add(key)
                    activities.append({"title": title, "reason": f"Designed to be realistically finishable in about {minutes} minute{'s' if minutes != 1 else ''}.", "minutes": minutes})
            if len(activities) >= 20:
                fallback_iter = iter(fallback["activities"])
                while len(activities) < 30:
                    candidate = next(fallback_iter)
                    if candidate["title"].lower() not in seen:
                        activities.append(candidate); seen.add(candidate["title"].lower())
                parsed["activities"] = activities[:30]
                if not parsed.get("assistant_reply"):
                    parsed["assistant_reply"] = fallback["assistant_reply"]
                for key in ("headline", "summary", "nudge"):
                    if not parsed.get(key):
                        parsed[key] = fallback[key]
                plan_data = parsed
    except Exception as exc:
        # Offline-first behavior: keep the whole project working even if the
        # teacher disables the key, the network is unavailable, or quota is exhausted.
        # The user still receives a personalized local plan; diagnostics stay in terminal.
        error_type = type(exc).__name__
        print(f"[Pause AI offline -> local personalization] {error_type}: {exc}", file=sys.stderr, flush=True)
        ai_error = None
        plan_data = fallback

    if feedback:
        chat_history.append({"role": "assistant", "content": str(plan_data.get("assistant_reply", fallback["assistant_reply"]))[:700]})

    return render_template(
        "plan.html",
        apps=apps,
        trigger=trigger,
        short_limit=short_limit_num,
        long_limit=long_limit_num,
        goal=goal,
        interests=interests,
        situation=situation,
        energy=energy,
        friction=friction,
        feedback=feedback,
        chat_history=chat_history,
        chat_history_json=json.dumps(chat_history),
        plan=plan_data,
        ideas_json=json.dumps([str(x.get("title", "")).strip() for x in plan_data.get("activities", []) if isinstance(x, dict) and str(x.get("title", "")).strip()][:30]),
        ai_error=ai_error,
    )


@app.get("/download-extension")
def download_extension():
    build_extension_zip()
    return send_from_directory(STATIC_DIR, EXTENSION_ZIP.name, as_attachment=True)


@app.post("/download-personalized-extension")
def download_personalized_extension():
    try:
        ideas = json.loads(request.form.get("ideas_json", "[]"))
    except json.JSONDecodeError:
        ideas = []
    ideas = [str(x).strip()[:180] for x in ideas if str(x).strip()][:50]
    if not ideas:
        ideas = ["Take five minutes away from the feed."]

    def as_bool(name, default=True):
        value = request.form.get(name)
        if value is None:
            return default
        return value.lower() in {"1", "true", "yes", "on"}

    try:
        short_minutes = max(1, min(60, int(request.form.get("short_limit", "5"))))
        long_minutes = max(5, min(240, int(request.form.get("long_limit", "60"))))
    except ValueError:
        short_minutes, long_minutes = 5, 60

    seed = {
        "shortMinutes": short_minutes,
        "longMinutes": long_minutes,
        "youtube": as_bool("youtube", True),
        "instagram": as_bool("instagram", True),
        "snoozeMinutes": 5,
        "friction": request.form.get("friction", "medium") if request.form.get("friction", "medium") in {"light", "medium", "strong"} else "medium",
        "ideas": ideas,
    }
    seed_js = "globalThis.PAUSE_SEED = " + json.dumps(seed, ensure_ascii=False) + ";\n"

    memory_file = BytesIO()
    with ZipFile(memory_file, "w", ZIP_DEFLATED) as archive:
        for path in EXTENSION_DIR.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(EXTENSION_DIR)
            if str(rel).replace("\\", "/") == "seed.js":
                archive.writestr("seed.js", seed_js)
            else:
                archive.write(path, rel)
    memory_file.seek(0)
    return send_file(memory_file, mimetype="application/zip", as_attachment=True, download_name="pause-personalized-extension.zip")


if __name__ == "__main__":
    build_extension_zip()
    app.run(debug=True)
