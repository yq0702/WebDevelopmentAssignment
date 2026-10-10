import os
import json
import re
import ssl
import urllib.request
import urllib.error
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

load_dotenv(override=True)

# Clear any broken system/VPN proxy variables
for env_key in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]:
    os.environ.pop(env_key, None)

app = Flask(__name__)

groq_key = os.getenv("GROQ_API_KEY", "").strip()

# Build direct network opener that completely ignores broken system/Windows proxy settings
ssl_context = ssl._create_unverified_context()
direct_opener = urllib.request.build_opener(
    urllib.request.ProxyHandler({}),
    urllib.request.HTTPSHandler(context=ssl_context)
)


def make_groq_request(url, payload=None):
    headers = {
        "Authorization": f"Bearer {groq_key}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0"
    }
    data = json.dumps(payload).encode('utf-8') if payload else None
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if payload else "GET")

    with direct_opener.open(req, timeout=15) as response:
        return json.loads(response.read().decode('utf-8'))


# --- AUTO-DISCOVER ACTIVE MODEL FOR YOUR KEY ---
def fetch_active_groq_model():
    if not groq_key:
        return "llama-3.3-70b-versatile"

    try:
        data = make_groq_request("https://api.groq.com/openai/v1/models")
        model_ids = [m["id"] for m in data.get("data", [])]
        print(f"📋 Active models on your account: {model_ids}")

        preferred_order = [
            "llama-3.3-70b-versatile",
            "openai/gpt-oss-120b",
            "openai/gpt-oss-20b",
            "llama-3.1-8b-instant",
            "qwen/qwen3.8-27b"
        ]
        for target in preferred_order:
            if target in model_ids:
                return target
        if model_ids:
            return model_ids[0]
    except Exception as e:
        print(f"⚠️ Could not fetch model list directly: {e}")

    return "llama-3.3-70b-versatile"


print("\n" + "=" * 50)
if groq_key:
    print(f"🔑 Key Detected: {groq_key[:8]}...{groq_key[-4:]}")
    SELECTED_MODEL = fetch_active_groq_model()
    print(f"🎯 Selected Model for Triage: '{SELECTED_MODEL}'")
else:
    print("❌ ERROR: GROQ_API_KEY is missing in .env!")
    SELECTED_MODEL = "llama-3.3-70b-versatile"
print("=" * 50 + "\n")

REGION_MAP = {
    "Head & Neck": "Neurology",
    "Chest & Heart": "Cardiology",
    "Abdomen & Digestive": "Gastroenterology",
    "Pelvis & Groin": "Urology",
    "Back & Spine": "Orthopedics",
    "Arms & Hands": "Orthopedics",
    "Legs & Feet": "Orthopedics"
}


@app.route('/')
def home():
    return render_template('index.html')


@app.route('/api/triage', methods=['POST'])
def handle_triage():
    try:
        data = request.get_json() or {}
        region = data.get('region', '')
        tags = data.get('tags', [])
        notes = data.get('notes', '').strip()

        if not region:
            return jsonify({"error": "Body region selection is required."}), 400

        symptom_summary = f"Region: {region} | Tags: {', '.join(tags) if tags else 'None'} | Notes: {notes if notes else 'None'}"

        SYSTEM_PROMPT = """You are MediSync's Smart Triage AI. Map structured patient inputs to exact specialties (Orthopedics, Cardiology, Gastroenterology, Neurology, Dermatology, Urology, Endocrinology, General Practice).
Return ONLY a valid JSON object with keys: "recommended_department", "explanation", "disclaimer".
Do NOT output any markdown code blocks or backticks.
Example output format: {"recommended_department": "Neurology", "explanation": "Dizziness and neck stiffness require neurological evaluation.", "disclaimer": "Automated triage guidance only."}"""

        payload = {
            "model": SELECTED_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": symptom_summary}
            ],
            "temperature": 0.1
        }

        try:
            res_body = make_groq_request("https://api.groq.com/openai/v1/chat/completions", payload=payload)
            raw_text = res_body["choices"][0]["message"]["content"].strip()

            if raw_text.startswith("```"):
                raw_text = re.sub(r"^```[a-zA-Z]*\n?", "", raw_text)
                raw_text = re.sub(r"\n?```$", "", raw_text).strip()

            print(f"✅ Live AI Triage Successful using '{SELECTED_MODEL}'!")
            return jsonify(json.loads(raw_text)), 200

        except urllib.error.HTTPError as http_err:
            error_body = http_err.read().decode('utf-8')
            print(
                f"\n--- GROQ API ERROR ({http_err.code}) ---\nResponse: {error_body}\n-----------------------------------\n")

        except Exception as api_err:
            print(f"\n--- CONNECTION ERROR ---\n{api_err}\n------------------------\n")

        # Offline Fallback Logic
        dept = REGION_MAP.get(region, "General Practice")
        lower_notes = notes.lower()

        if "diabetes" in lower_notes or "sugar" in lower_notes:
            dept = "Endocrinology"
        elif "skin" in lower_notes or "rash" in lower_notes:
            dept = "Dermatology"

        tag_str = ", ".join(tags) if tags else "selected concerns"

        if notes:
            explanation = f"While analyzing your selection of {region} ({tag_str}), we noted your specific concerns regarding '{notes}'. You have been routed to {dept} for specialized evaluation."
        else:
            explanation = f"Based on your primary symptoms in the {region} area ({tag_str}), you have been routed to the {dept} department."

        return jsonify({
            "recommended_department": dept,
            "explanation": explanation,
            "disclaimer": "This is non-diagnostic automated triage for guidance only (Offline Fallback)."
        }), 200

    except Exception as e:
        return jsonify({"error": f"Server processing error: {str(e)}"}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)