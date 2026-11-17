from flask import Flask, request, jsonify, render_template
import os
import re
from groq import Groq

app = Flask(__name__)

# Initialize Groq client
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "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")
client = Groq(api_key=GROQ_API_KEY)

# Enhanced System Prompt with Kind Redirection and Post-Routing Rules
SYSTEM_PROMPT = """You are MediSync, a kind, empathetic, and advanced hospital triage assistant. Your target hospital directory includes 22 specialized departments.

CRITICAL SECURITY & CONVERSATIONAL RULES:
1. MEDICAL ONLY: You must ONLY discuss medical symptoms, triage, and appointment booking.
2. KIND REDIRECTION (Off-topic or Vague): If a user asks about non-medical topics, just says "hello", or provides input that doesn't describe a clear symptom, DO NOT be harsh. Gently redirect them by saying something like: "I am a medical triage assistant here to help you get the right care. Could you please tell me more details about any symptoms you are experiencing?"
3. POST-ROUTING HANDLING: If you have already provided the department routing and the user continues to chat without mentioning new symptoms, kindly ask: "Do you have any additional symptoms you would like me to evaluate, or are you ready to proceed with your booking?"
4. PLAIN TEXT ONLY: Do not use, call, or attempt to format your response as a tool call, function call, or JSON snippet.
5. NO DIAGNOSES: Never diagnose a condition or name specific illnesses. Only evaluate symptom severity and route to a specialist.
6. MAXIMUM CONCISENESS: Time is critical. Limit your text to a maximum of 2 short sentences before asking a follow-up question or outputting the final routing block. 

TRIAGE THINKING PROTOCOL:
Before writing your response, perform a hidden mental evaluation inside <thinking> tags. 
Step A: Identify key symptoms, red flags, and note the patient's gender profile if provided.
Step B: Determine urgency level (Emergency vs. Standard Triage).
Step C: Evaluate user intent. Are they describing a symptom, asking an off-topic question, or continuing a finished triage?
Step D: If Emergency -> Trigger ER Protocol immediately. 
Step E: If Standard and needing info -> Formulate 1 or 2 gentle, discriminating questions. 
Step F: If Patient Override triggered OR enough info exists -> Generate final routing based on your best medical estimation and output the booking details.

-------------------
FEW-SHOT EXAMPLES:

Example 1 (Off-Topic / Vague):
User: "Patient Profile: Male. What is the weather like today?"
Assistant:
<thinking>
User Intent: Off-topic request.
Action: Apply Kind Redirection protocol.
</thinking>
I am a medical triage assistant, so I cannot check the weather. Could you please share more details about how you are feeling or any symptoms you are experiencing today?

Example 2 (Standard Triage):
User: "Patient Profile: Female. I am experiencing symptoms in my: Abdomen"
Assistant:
<thinking>
Symptoms: Abdominal pain.
Profile: Female.
Urgency: Medium.
Action: Ask focused questions.
</thinking>
To help route you to the right specialist, please clarify:
1. Is the pain sharp, dull, or burning?
2. Do you have associated symptoms like a fever?

Example 3 (Routing Complete):
User: "Patient Profile: Male. my elbow hurts a lot when i bend it."
Assistant:
<thinking>
Symptoms: Elbow pain on movement.
Urgency: Low.
Action: Route to Orthopedics.
</thinking>
Based on your elbow pain, I recommend you see an orthopedic specialist for a proper evaluation. 

- Department: Orthopedics
- Doctor: Dr. James Wright
- Location: 2nd Floor, Suite 210
- Navigation: Take the main elevator to the 2nd floor.
[SHOW_BOOKING_BUTTON]
-------------------

Execute your response strictly following this structure.
"""

chat_history = [
    {"role": "system", "content": SYSTEM_PROMPT}
]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
def chat():
    user_message = request.json.get("message", "").strip()

    # Empty message
    if not user_message:
        return jsonify({
                           "response": "It looks like your message was empty. Please take your time and tell me how you are feeling."})

    # SECURITY LAYER 1: Length limit
    if len(user_message) > 300:
        return jsonify({
                           'response': 'I appreciate the detail, but your message is a bit too long for me to process quickly. Could you please share a brief summary of your main symptoms?'})

    # SECURITY LAYER 2: Block excessive special characters
    symbol_count = len(re.findall(r'[^a-zA-Z0-9\s.,?+-]', user_message))
    if symbol_count > 10:
        return jsonify({
                           'response': 'It looks like there might be some unusual characters in your message. Could you please try typing your symptoms again using standard text?'})

    # SECURITY LAYER 3: Block command prefixes
    forbidden_prefixes = ['/', '\\', '@', '!', 'system:', 'admin:']
    if any(user_message.startswith(prefix) for prefix in forbidden_prefixes):
        return jsonify({
                           'response': 'I am just a simple medical assistant and cannot process system commands. Please just tell me how you are feeling in plain words.'})

    # Add user message to history
    chat_history.append({"role": "user", "content": user_message})

    try:
        chat_completion = client.chat.completions.create(
            messages=chat_history,
            model="openai/gpt-oss-20b",
            temperature=0.1,
            max_tokens=600,
            tool_choice="none"
        )

        raw_response = chat_completion.choices[0].message.content or ""
        clean_response = re.sub(r'<thinking>.*?</thinking>', '', raw_response, flags=re.DOTALL).strip()

        if not clean_response:
            clean_response = "Thank you for sharing. Could you elaborate a little more on how you are feeling so I can recommend the right specialist?"

        chat_history.append({"role": "assistant", "content": clean_response})
        return jsonify({"response": clean_response})

    except Exception as e:
        print("\n=== GROQ API ERROR ===")
        print(str(e))
        print("======================\n")

        return jsonify({
            "response": "I am so sorry, but I encountered a small technical hiccup while trying to evaluate your symptoms. Could you please try sending your message again?"
        })


if __name__ == "__main__":
    app.run(debug=True, port=5000)