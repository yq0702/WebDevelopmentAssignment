# -*- coding: utf-8 -*-
"""
MediSync 统一后端（app.py）
============================================================
本文件 = 原 app.py 全部功能 + main.py 全部 AI 功能（完整合并，只加不减）
运行： python app.py
============================================================
"""

from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask.json.provider import DefaultJSONProvider
from flask_pymongo import PyMongo
from flask_cors import CORS
from bson import ObjectId
from bson.json_util import dumps, loads
from datetime import datetime, timedelta
import bcrypt
import re
import os
import time
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from functools import wraps

# ================= 🌟 AI Triage 依赖导入（合并自 main.py） =================
from groq import Groq

# 可选：自动读取 .env（未安装 python-dotenv 也不影响运行）
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass


# ================= 1. Init Flask & MongoDB =================
app = Flask(__name__, template_folder='templates', static_folder='static')

app.secret_key = os.environ.get("FLASK_SECRET_KEY", "medisync_super_secret_key_2024")
if app.secret_key == "medisync_super_secret_key_2024":
    print("⚠️  正在使用内置默认 secret_key，请在生产环境设置 FLASK_SECRET_KEY 环境变量！")

app.config["MONGO_URI"] = os.environ.get("MONGO_URI", "mongodb://localhost:27017/medisync_db")

# 🌟 新增：Cookie 安全加固（历史不再放 cookie，彻底避免 4KB 溢出）
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024  # 2MB 请求体上限

mongo = PyMongo(app)
CORS(app, supports_credentials=True)


# ================= 🌟 初始化 Groq 客户端与 System Prompt（合并 main.py） =================
# 🔒 不再硬编码任何 API Key。请设置环境变量 GROQ_API_KEY
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "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")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")

groq_client = None
if GROQ_API_KEY:
    try:
        groq_client = Groq(api_key=GROQ_API_KEY, timeout=30.0, max_retries=2)
        print(f"✅ Groq client ready. Model = {GROQ_MODEL}")
    except Exception as e:
        print(f"❌ Groq 初始化失败：{e}")
else:
    print("⚠️  未设置 GROQ_API_KEY，AI 导诊将返回友好降级提示（其余功能不受影响）。")

client = groq_client  # 🌟 兼容 main.py 里的变量名 client

AI_MAX_INPUT_CHARS = 300
AI_MAX_TOKENS = 1024          # 推理模型的 reasoning 也计入，600 会导致正文为空
AI_KEEP_MESSAGES = 20         # 保留最近 10 轮（user + assistant 各 1 条）
AI_MIN_INTERVAL = 1.0         # 同一用户最小请求间隔（秒）
AI_REASONING_EFFORT = os.environ.get("GROQ_REASONING_EFFORT", "low")
AI_DIR_CACHE_TTL = 60         # 科室目录缓存秒数

AI_FALLBACK = ("I am so sorry, but I encountered a small technical hiccup while trying to "
               "evaluate your symptoms. Could you please try sending your message again?")
AI_EMPTY_REPLY = ("Thank you for sharing. Could you elaborate a little more on how you are "
                  "feeling so I can recommend the right specialist?")
AI_NO_KEY = ("Our AI triage assistant is temporarily offline. Please choose a department "
             "manually from the booking list, or ask our front desk staff for help.")
AI_DISCLAIMER = "Guidance only, not a medical diagnosis."

# System Prompt（保留原变量名 SYSTEM_PROMPT；新增 DIRECTORY LOCK / ER 协议 / 真实医生示例）
SYSTEM_PROMPT = """You are MediSync, a kind, empathetic, and advanced hospital triage assistant. Your target hospital directory includes {DEPT_COUNT} specialized departments.

CRITICAL SECURITY & CONVERSATIONAL RULES:
MEDICAL ONLY: You must ONLY discuss medical symptoms, triage, and appointment booking.
KIND REDIRECTION (Off-topic or Vague): If a user asks about non-medical topics, just says "hello", or provides input that doesn't describe a clear symptom, DO NOT be harsh. Gently redirect them by saying something like: "I am a medical triage assistant here to help you get the right care. Could you please tell me more details about any symptoms you are experiencing?"
POST-ROUTING HANDLING: If you have already provided the department routing and the user continues to chat without mentioning new symptoms, kindly ask: "Do you have any additional symptoms you would like me to evaluate, or are you ready to proceed with your booking?"
PLAIN TEXT ONLY: Do not use, call, or attempt to format your response as a tool call, function call, or JSON snippet.
NO DIAGNOSES: Never diagnose a condition or name specific illnesses. Only evaluate symptom severity and route to a specialist.
MAXIMUM CONCISENESS: Time is critical. Limit your text to a maximum of 2 short sentences before asking a follow-up question or outputting the final routing block.
DIRECTORY LOCK (HARD RULE): You may ONLY output a Department, Doctor and Location that appear VERBATIM in the HOSPITAL DIRECTORY below. NEVER invent a doctor name, room, floor or department. If nothing suitable exists in the directory, route to "General Practitioner (GP)".
LANGUAGE: Reply in the same language the patient uses (English / 中文 / Bahasa Melayu), but keep the Department / Doctor / Location lines EXACTLY as written in the directory (do not translate them).

TRIAGE THINKING PROTOCOL:
Before writing your response, perform a hidden mental evaluation inside <thinking> tags.
Step A: Identify key symptoms, red flags, and note the patient's gender profile if provided.
Step B: Determine urgency level (Emergency vs. Standard Triage).
Step C: Evaluate user intent. Are they describing a symptom, asking an off-topic question, or continuing a finished triage?
Step D: If Emergency -> Trigger ER Protocol immediately.
Step E: If Standard and needing info -> Formulate 1 or 2 gentle, discriminating questions.
Step F: If Patient Override triggered OR enough info exists -> Generate final routing based on your best medical estimation and output the booking details.

ER PROTOCOL (crushing chest pain, severe breathlessness, stroke signs such as face drooping or
one-sided weakness, uncontrolled bleeding, loss of consciousness, suicidal intent):
This sounds like a medical emergency. Please call emergency services or go to the Emergency Department immediately.
[EMERGENCY]
(Never output a booking button in an emergency.)

FINAL ROUTING BLOCK (exact format, only when you have enough information):
<one short recommendation sentence>
Department: <verbatim department from directory>
Doctor: <verbatim doctor from directory>
Location: <verbatim room from directory>
Navigation: <one short sentence>
[SHOW_BOOKING_BUTTON]

HOSPITAL DIRECTORY (authoritative live data from the hospital database):
{DIRECTORY}

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
Is the pain sharp, dull, or burning?
Do you have associated symptoms like a fever?

Example 3 (Routing Complete — uses ONLY real directory entries):
User: "Patient Profile: Male. I have had an itchy rash on my arm for three days."
Assistant:
<thinking>
Symptoms: Itchy rash, no red flags.
Urgency: Low.
Action: Route to Dermatology (Skin), Dr. Chen, Room 301 (all present in directory).
</thinking>
Based on your itchy rash, I recommend you see a skin specialist for a proper evaluation.
Department: Dermatology (Skin)
Doctor: Dr. Chen
Location: Room 301
Navigation: Take the main elevator to the 3rd floor and follow the signs to Room 301.
[SHOW_BOOKING_BUTTON]

Example 4 (Emergency):
User: "My father has crushing chest pain and cannot breathe properly."
Assistant:
<thinking>
Red flags: crushing chest pain + breathlessness. Emergency.
Action: ER Protocol, no booking button.
</thinking>
This sounds like a medical emergency. Please call emergency services or go to the Emergency Department immediately.
[EMERGENCY]

Execute your response strictly following this structure.
"""


# ================= 2. JSON Provider / Helpers / Decorators =================
class MongoJSONProvider(DefaultJSONProvider):
    def default(self, obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, bytes):
            return obj.decode('utf-8')
        return super().default(obj)


app.json = MongoJSONProvider(app)


@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    # 🌟 新增：基础安全响应头
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    return response


def parse_json(data):
    return loads(dumps(data))


def to_oid(value):
    """🌟 新增：安全转 ObjectId，避免非法 id 直接 500"""
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def get_json():
    """🌟 新增：容错取 JSON"""
    return request.get_json(silent=True) or {}


def generate_patient_id():
    """🌟 新增：避免并发/删除后编号重复（格式仍为 MS-0001）"""
    base = mongo.db.users.count_documents({"role": "patient"})
    for i in range(0, 5000):
        pid = f"MS-{str(base + i + 1).zfill(4)}"
        if not mongo.db.users.find_one({"patient_id": pid}):
            return pid
    return f"MS-{int(time.time())}"


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session:
            if request.path.startswith('/api/'):
                return jsonify({"error": "Please login first"}), 401
            return redirect(url_for('patient_auth'))
        return f(*args, **kwargs)
    return decorated


def role_required(allowed_roles):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if session.get('user', {}).get('role') not in allowed_roles:
                if request.path.startswith('/api/'):
                    return jsonify({"error": "Unauthorized"}), 403
                return redirect(url_for('patient_auth'))
            return f(*args, **kwargs)
        return decorated
    return decorator


# ================= 3. Page Route =================
@app.route('/')
def index():
    if 'user' in session:
        role = session['user']['role']
        if role == 'patient':
            return redirect(url_for('patient_dashboard'))
        elif role == 'staff':
            return redirect(url_for('staff_dashboard'))
        elif role == 'doctor':
            return redirect(url_for('doctor_dashboard'))
        elif role == 'admin':
            return redirect(url_for('admin_dashboard'))
        elif role == 'root':
            return redirect(url_for('root_page'))
    return redirect(url_for('patient_auth'))


@app.route('/patient/auth')
def patient_auth():
    return render_template('patient_auth.html')


@app.route('/staff/auth')
def staff_auth():
    return render_template('staff_auth.html')


@app.route('/root')
@login_required
@role_required(['root'])
def root_page():
    return render_template('root.html', user=session['user'])


@app.route('/patient/dashboard')
@login_required
@role_required(['patient'])
def patient_dashboard():
    return render_template('patient.html', user=session['user'])


@app.route('/staff/dashboard')
@login_required
@role_required(['staff'])
def staff_dashboard():
    return render_template('staff.html', user=session['user'])


@app.route('/doctor/dashboard')
@login_required
@role_required(['doctor'])
def doctor_dashboard():
    return render_template('doctor.html', user=session['user'])


@app.route('/admin/dashboard')
@login_required
@role_required(['admin'])
def admin_dashboard():
    return render_template('admin.html', user=session['user'])


@app.route('/ai')
@login_required
@role_required(['patient'])
def ai_standalone_page():
    """🌟 合并自 main.py 的 '/'：保留独立 AI 聊天页 index.html（不影响 app 原有 '/'）"""
    try:
        return render_template('index.html', user=session['user'])
    except Exception:
        return redirect(url_for('patient_dashboard'))


@app.route('/api/health', methods=['GET'])
def health_check():
    """🌟 新增：健康检查"""
    try:
        mongo.db.command('ping')
        db_ok = True
    except Exception:
        db_ok = False
    return jsonify({
        "status": "ok" if db_ok else "degraded",
        "mongodb": db_ok,
        "ai_enabled": groq_client is not None,
        "model": GROQ_MODEL,
        "time": datetime.utcnow().isoformat()
    })


# ================= 4. Auth API =================
@app.route('/api/auth/register', methods=['POST'])
def register_patient():
    data = get_json()
    for field in ['username', 'password', 'name', 'ic_number', 'email']:
        if not (data.get(field) or '').strip():
            return jsonify({"success": False, "message": f"Missing field: {field}"}), 400

    if mongo.db.users.find_one({"username": data['username']}):
        return jsonify({"success": False, "message": "Username already exists"}), 400
    if mongo.db.users.find_one({"ic_number": data['ic_number']}):
        return jsonify({"success": False, "message": "This IC Number is already registered."}), 400
    if not re.match(r"[^@]+@[^@]+\.[^@]+", data['email']):
        return jsonify({"success": False, "message": "Invalid email format"}), 400

    pw_hash = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())
    patient_id = generate_patient_id()

    mongo.db.users.insert_one({
        "username": data['username'], "password": pw_hash, "role": "patient",
        "name": data['name'], "ic_number": data['ic_number'], "email": data['email'],
        "phone": data.get('phone', ''),
        "gender": data.get('gender', ''),      # 🌟 新增：AI 分诊会用到
        "dob": data.get('dob', ''),            # 🌟 新增
        "patient_id": patient_id, "doctor_id": None,
        "created_at": datetime.utcnow()
    })
    return jsonify({"success": True, "message": "Registered successfully! Please login."})


@app.route('/api/auth/login', methods=['POST'])
def login():
    data = get_json()
    user = mongo.db.users.find_one({"username": data.get('username')})
    if user and bcrypt.checkpw((data.get('password') or '').encode('utf-8'), user['password']):
        session['user'] = {
            "id": str(user['_id']), "username": user['username'], "role": user['role'],
            "name": user['name'], "patient_id": user.get('patient_id'),
            "doctor_id": str(user['doctor_id']) if user.get('doctor_id') else None
        }
        session.pop('triage_history', None)  # 🌟 清理旧版遗留 cookie 历史
        return jsonify({"success": True, "role": user['role']})
    return jsonify({"success": False, "message": "Invalid username or password"}), 401


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"success": True})


# ================= 5. Root Special API =================
@app.route('/api/root/create_user', methods=['POST'])
@login_required
@role_required(['root'])
def root_create_user():
    data = get_json()
    if mongo.db.users.find_one({"username": data.get('username')}):
        return jsonify({"success": False, "message": "Username already exists"}), 400
    pw_hash = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())
    mongo.db.users.insert_one({
        "username": data['username'], "password": pw_hash, "role": data['role'],
        "name": data['name'], "email": data.get('email', ''), "phone": data.get('phone', ''),
        "patient_id": None, "doctor_id": None, "created_at": datetime.utcnow()
    })
    return jsonify({"success": True, "message": f"{data['role'].capitalize()} account created!"})


@app.route('/api/root/users', methods=['GET'])
@login_required
@role_required(['root'])
def get_all_users():
    users = mongo.db.users.find(
        {"role": {"$in": ["staff", "doctor", "admin", "patient"]}}, {"password": 0})
    return jsonify(list(users))


# ================= 6. Patient API =================
@app.route('/api/patient/doctors', methods=['GET'])
@login_required
@role_required(['patient', 'admin', 'staff'])
def get_doctors():
    specialty = request.args.get('specialty')
    query = {}
    if specialty and specialty.lower() != 'all':
        query['specialty'] = specialty
    return jsonify(list(mongo.db.doctors.find(query)))


@app.route('/api/patient/slots', methods=['GET'])
@login_required
@role_required(['patient', 'staff'])
def get_available_slots():
    doctor_id = request.args.get('doctor_id')
    date = request.args.get('date')
    match_query = {"status": "available"}
    if doctor_id:
        oid = to_oid(doctor_id)
        if not oid:
            return jsonify([])
        match_query["doctor_id"] = oid
    if date:
        match_query["date"] = date

    slots = mongo.db.slots.aggregate([
        {"$match": match_query},
        {"$lookup": {"from": "doctors", "localField": "doctor_id",
                     "foreignField": "_id", "as": "doctor_info"}},
        {"$unwind": "$doctor_info"},
        {"$sort": {"date": 1, "time": 1}}
    ])
    return jsonify(list(slots))


@app.route('/api/patient/book', methods=['POST'])
@login_required
@role_required(['patient'])
def book_slot():
    data = get_json()
    slot_id = to_oid(data.get('slot_id'))
    if not slot_id:
        return jsonify({"success": False, "message": "Invalid slot id"}), 400

    slot = mongo.db.slots.find_one({"_id": slot_id})
    if not slot or slot.get('status') != 'available':
        return jsonify({"success": False, "message": "This time slot is no longer available."}), 400

    updated_slot = mongo.db.slots.find_one_and_update(
        {"_id": slot_id, "status": "available"},
        {"$set": {"status": "booked"}}
    )
    if not updated_slot:
        return jsonify({"success": False, "message": "Slot was just booked by someone else."}), 400

    # 🌟 新增：前端没传 ai_summary 时，自动带上最近一次 AI 导诊结论（医生端可见）
    ai_summary = (data.get('ai_summary') or '').strip()
    if not ai_summary or ai_summary.upper() == 'N/A':
        history = load_ai_history(session['user']['id'])
        last_ai = next((m['content'] for m in reversed(history)
                        if m.get('role') == 'assistant'), '')
        ai_summary = clean_ai_text(last_ai)[:1000] or 'N/A'

    mongo.db.appointments.insert_one({
        "patient_id": session['user']['patient_id'],
        "patient_name": session['user']['name'],
        "slot_id": slot_id,
        "status": "booked",
        "ai_summary": ai_summary,
        "follow_up": "none",
        "created_at": datetime.utcnow()
    })
    return jsonify({"success": True, "message": "Appointment booked successfully!"})


@app.route('/api/patient/appointments', methods=['GET'])
@login_required
@role_required(['patient'])
def get_patient_appointments():
    patient_id = session['user']['patient_id']
    appts = mongo.db.appointments.aggregate([
        {"$match": {"patient_id": patient_id}},
        {"$lookup": {"from": "slots", "localField": "slot_id",
                     "foreignField": "_id", "as": "slot_info"}},
        {"$unwind": "$slot_info"},
        {"$lookup": {"from": "doctors", "localField": "slot_info.doctor_id",
                     "foreignField": "_id", "as": "doctor_info"}},
        {"$unwind": "$doctor_info"},
        {"$sort": {"slot_info.date": -1, "slot_info.time": -1}}
    ])
    return jsonify(list(appts))


@app.route('/api/patient/cancel/<appt_id>', methods=['DELETE'])
@login_required
@role_required(['patient'])
def cancel_appointment(appt_id):
    oid = to_oid(appt_id)
    if not oid:
        return jsonify({"success": False, "message": "Invalid appointment id"}), 400

    # 🌟 新增归属校验：只能取消自己的预约
    appt = mongo.db.appointments.find_one({
        "_id": oid, "patient_id": session['user']['patient_id']})
    if not appt:
        return jsonify({"success": False, "message": "Appointment not found"}), 404

    mongo.db.slots.update_one({"_id": appt['slot_id']}, {"$set": {"status": "available"}})
    mongo.db.appointments.delete_one({"_id": oid})
    return jsonify({"success": True})


@app.route('/api/patient/ai_triage', methods=['POST'])
@login_required
@role_required(['patient'])
def ai_triage():
    """旧版关键词分诊（完整保留，并补充中文/马来文关键词 + 真实医生匹配）"""
    symptoms = (get_json().get('symptoms') or '').lower()
    recommendation = "General Practitioner (GP)"
    if any(w in symptoms for w in ['chest', 'heart', 'breath', '胸', '心', '喘', 'dada', 'sesak']):
        recommendation = "Cardiology (Heart)"
    elif any(w in symptoms for w in ['skin', 'rash', 'itch', '皮肤', '疹', '痒', 'kulit', 'gatal']):
        recommendation = "Dermatology (Skin)"

    doctor = mongo.db.doctors.find_one({"specialty": recommendation})
    return jsonify({
        "recommendation": recommendation,
        "doctor_id": str(doctor['_id']) if doctor else None,
        "doctor_name": doctor['name'] if doctor else None,
        "disclaimer": AI_DISCLAIMER
    })


@app.route('/api/patient/profile', methods=['GET', 'PUT'])
@login_required
@role_required(['patient'])
def patient_profile():
    user_id = session['user']['id']
    oid = to_oid(user_id)

    if request.method == 'GET':
        user = mongo.db.users.find_one({"_id": oid}, {"password": 0})
        return jsonify(user)
    else:
        data = get_json()
        # 🌟 只允许白名单字段，防止患者自行改 role / patient_id
        allowed = ['name', 'email', 'phone', 'ic_number', 'gender', 'dob']
        update_data = {k: v for k, v in data.items() if k in allowed and v}
        if data.get('password'):
            update_data['password'] = bcrypt.hashpw(
                data['password'].encode('utf-8'), bcrypt.gensalt())
        if update_data:
            mongo.db.users.update_one({"_id": oid}, {"$set": update_data})
        session['user']['name'] = update_data.get('name', session['user']['name'])
        return jsonify({"success": True, "message": "Profile updated!"})


@app.route('/api/patient/send_reminder/<appt_id>', methods=['POST'])
@login_required
@role_required(['patient'])
def send_reminder_email(appt_id):
    oid = to_oid(appt_id)
    if not oid:
        return jsonify({"success": False, "message": "Invalid appointment id"}), 400

    appt = mongo.db.appointments.find_one({
        "_id": oid, "patient_id": session['user']['patient_id']})
    if not appt:
        return jsonify({"success": False, "message": "Appointment not found"}), 404

    patient = mongo.db.users.find_one({"patient_id": appt['patient_id']})
    patient_email = patient.get('email') if patient else None
    if not patient_email:
        return jsonify({"success": False,
                        "message": "Patient email not found in profile. Please update in Settings."}), 400

    slot = mongo.db.slots.find_one({"_id": appt['slot_id']})
    doctor = mongo.db.doctors.find_one({"_id": slot['doctor_id']}) if slot else None
    date_str = slot['date'] if slot else 'TBD'
    time_str = slot['time'] if slot else 'TBD'
    doc_name = doctor['name'] if doctor else 'Our Doctor'

    subject = f"MediSync: Upcoming Appointment Reminder for {date_str}"
    body = f"""
Dear {patient.get('name', 'Patient')},

This is a friendly reminder that you have an upcoming appointment with {doc_name}.

📅 Date: {date_str}
⏰ Time: {time_str}

Please arrive 15 minutes early. If you need to cancel or reschedule, please log in to your MediSync portal.

Best regards,
MediSync Health Team
"""

    # 🌟 新增：配置了 SMTP_HOST / SMTP_USER / SMTP_PASS 就真发送，否则维持原模拟行为
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASS")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))

    if smtp_host and smtp_user and smtp_pass:
        try:
            msg = MIMEMultipart()
            msg['From'] = smtp_user
            msg['To'] = patient_email
            msg['Subject'] = subject
            msg.attach(MIMEText(body, 'plain', 'utf-8'))
            with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
                server.starttls()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
            print(f"📧 Reminder email sent to {patient_email}")
            return jsonify({"success": True, "message": "Reminder email sent successfully!"})
        except Exception as e:
            print(f"Email sending failed: {e}")
            return jsonify({"success": True,
                            "message": "Reminder email simulated (SMTP error, check server config)."})

    try:
        print(f"📧 [SIMULATED] Reminder email sent to {patient_email} for appointment on {date_str}")
        return jsonify({"success": True, "message": "Reminder email sent successfully!"})
    except Exception as e:
        print(f"Email sending failed: {e}")
        return jsonify({"success": True,
                        "message": "Reminder email simulated (Configure SMTP in app.py for real sending)."})


@app.route('/api/patient/doctors/<doctor_id>/profile', methods=['GET'])
@login_required
@role_required(['patient'])
def get_doctor_profile(doctor_id):
    oid = to_oid(doctor_id)
    doctor = mongo.db.doctors.find_one({"_id": oid}) if oid else None
    if not doctor:
        return jsonify({"error": "Doctor not found"}), 404
    return jsonify({
        "name": doctor.get("name", ""),
        "specialty": doctor.get("specialty", ""),
        "room": doctor.get("room", ""),
        "bio": doctor.get("bio", ""),
        "working_hours": doctor.get("working_hours", {
            "weekdays": "9:00 AM - 5:00 PM",
            "saturday": "9:00 AM - 1:00 PM",
            "sunday": "Closed"
        })
    })


# ================= 🌟 6.5 Advanced AI Triage（完整合并 main.py，全站唯一 AI 引擎） =================

_dir_cache = {"ts": 0.0, "text": "", "count": 0}
_ai_last_call = {}                 # 单进程限流；多 worker 部署请换 Redis
_reasoning_ok = True               # 模型不支持 reasoning_effort 时自动降级


def invalidate_directory_cache():
    """医生/科室变动后调用，保证 AI 目录实时准确"""
    _dir_cache.update({"ts": 0.0, "text": "", "count": 0})


def get_hospital_directory(ttl=AI_DIR_CACHE_TTL):
    """🌟 从数据库生成真实科室目录，彻底杜绝 AI 编造医生/诊室"""
    now = time.monotonic()
    if _dir_cache["text"] and now - _dir_cache["ts"] < ttl:
        return _dir_cache["text"], _dir_cache["count"]

    grouped = {}
    for d in mongo.db.doctors.find({}, {"name": 1, "specialty": 1, "room": 1}):
        dept = (d.get("specialty") or "General Practitioner (GP)").strip()
        grouped.setdefault(dept, []).append(d)

    lines = []
    for dept in sorted(grouped):
        lines.append(f"- {dept}")
        for d in sorted(grouped[dept], key=lambda x: x.get('name', '')):
            lines.append(f"    * Doctor: {d.get('name')} | Location: {d.get('room') or 'TBD'}")

    _dir_cache.update({
        "ts": now,
        "text": "\n".join(lines) or "- General Practitioner (GP)\n    * Doctor: Duty Doctor | Location: Room 101",
        "count": len(grouped) or 1
    })
    return _dir_cache["text"], _dir_cache["count"]


def build_system_prompt(user_id):
    directory, dept_count = get_hospital_directory()
    profile = {}
    oid = to_oid(user_id)
    if oid:
        profile = mongo.db.users.find_one(
            {"_id": oid}, {"name": 1, "gender": 1, "dob": 1}) or {}

    parts = [f"Name: {profile.get('name', 'Patient')}"]
    if profile.get('gender'):
        parts.append(f"Gender: {profile['gender']}")
    if profile.get('dob'):
        parts.append(f"DOB: {profile['dob']}")

    prompt = (SYSTEM_PROMPT
              .replace("{DIRECTORY}", directory)
              .replace("{DEPT_COUNT}", str(dept_count)))
    return prompt + "\nCurrent Patient Profile: " + ", ".join(parts) + "."


# ---- 历史存 MongoDB（关键：绝不放 session cookie，避免 4KB 溢出导致掉登录/失忆） ----
def load_ai_history(user_id):
    oid = to_oid(user_id)
    if not oid:
        return []
    doc = mongo.db.ai_chats.find_one({"user_id": oid})
    return (doc or {}).get("messages", [])


def save_ai_history(user_id, messages, routing=None):
    oid = to_oid(user_id)
    if not oid:
        return
    payload = {"messages": messages[-AI_KEEP_MESSAGES:], "updated_at": datetime.utcnow()}
    if routing:
        payload["last_routing"] = routing
    mongo.db.ai_chats.update_one(
        {"user_id": oid},
        {"$set": payload, "$setOnInsert": {"created_at": datetime.utcnow()}},
        upsert=True
    )


def clear_ai_history(user_id):
    oid = to_oid(user_id)
    if oid:
        mongo.db.ai_chats.delete_one({"user_id": oid})


def strip_thinking(text):
    text = re.sub(r"<thinking>.*?</thinking>", "", text or "", flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<thinking>.*$", "", text, flags=re.DOTALL | re.IGNORECASE)  # 未闭合兜底
    return text.strip()


def clean_ai_text(text):
    """去掉内部标记，得到可直接展示 / 存入病历摘要的纯文本"""
    text = strip_thinking(text)
    return text.replace("[SHOW_BOOKING_BUTTON]", "").replace("[EMERGENCY]", "").strip()


def parse_ai_routing(text):
    """🌟 解析路由并回查数据库；查不到真实医生一律不返回按钮（防幻觉预订）"""
    if "[SHOW_BOOKING_BUTTON]" not in (text or ""):
        return None
    dept_m = re.search(r"^\s*Department:\s*(.+)$", text, re.M)
    doc_m = re.search(r"^\s*Doctor:\s*(.+)$", text, re.M)
    dept = dept_m.group(1).strip() if dept_m else None
    doc_name = doc_m.group(1).strip() if doc_m else None

    doctor = None
    if doc_name:
        doctor = mongo.db.doctors.find_one({"name": doc_name})
        if not doctor:
            doctor = mongo.db.doctors.find_one(
                {"name": {"$regex": re.escape(doc_name), "$options": "i"}})
    if not doctor and dept:
        doctor = mongo.db.doctors.find_one({"specialty": dept})
    if not doctor:
        app.logger.warning("AI routing hallucination blocked: dept=%s doctor=%s", dept, doc_name)
        return None

    return {
        "doctor_id": str(doctor["_id"]),
        "doctor_name": doctor.get("name"),
        "specialty": doctor.get("specialty", ""),
        "room": doctor.get("room", "")
    }


RED_FLAGS = [
    "chest pain", "crushing chest", "can't breathe", "cannot breathe", "cant breathe",
    "not breathing", "severe bleeding", "unconscious", "stroke", "face droop",
    "suicidal", "kill myself", "overdose",
    "胸痛", "胸口痛", "喘不上气", "呼吸困难", "大出血", "昏迷", "中风", "自杀",
    "sakit dada", "sesak nafas", "tidak sedar", "pendarahan teruk"
]


def detect_red_flag(text):
    """🌟 确定性急诊兜底：即使模型漏判也会给出急诊指引"""
    low = (text or "").lower()
    return any(k in low for k in RED_FLAGS)


def groq_create(messages):
    """统一调用入口：保留 main.py 的 tool_choice='none'，并兼容不支持 reasoning_effort 的情况"""
    global _reasoning_ok
    kwargs = dict(
        messages=messages,
        model=GROQ_MODEL,
        temperature=0.1,
        max_tokens=AI_MAX_TOKENS,
        tool_choice="none"          # ✅ 从 main.py 完整补回
    )
    if _reasoning_ok and AI_REASONING_EFFORT:
        try:
            return groq_client.chat.completions.create(
                reasoning_effort=AI_REASONING_EFFORT, **kwargs)
        except Exception as e:
            msg = str(e).lower()
            if any(k in msg for k in ("reasoning_effort", "unsupported", "unexpected keyword",
                                      "unknown parameter", "unrecognized")):
                _reasoning_ok = False
                app.logger.warning("Model does not support reasoning_effort; falling back.")
                return groq_client.chat.completions.create(**kwargs)
            raise
    return groq_client.chat.completions.create(**kwargs)


@app.route('/api/patient/ai_chat', methods=['POST'])
@login_required
@role_required(['patient'])
def patient_ai_chat():
    data = get_json()
    user_message = re.sub(r"\s+", " ", (data.get("message") or "")).strip()

    # 安全检查 1: 空消息
    if not user_message:
        return jsonify({"response": "It looks like your message was empty. "
                                    "Please take your time and tell me how you are feeling."})

    # 安全检查 2: 长度限制
    if len(user_message) > AI_MAX_INPUT_CHARS:
        return jsonify({"response": "I appreciate the detail, but your message is a bit too long "
                                    "for me to process quickly. Could you please share a brief "
                                    "summary of your main symptoms?"})

    # 安全检查 3: 阻止过多特殊字符（\w 支持中文 / 马来文，不再误拦多语言用户）
    symbol_count = len(re.findall(r"[^\w\s.,?+\-/'():]", user_message))
    if symbol_count > 10:
        return jsonify({"response": "It looks like there might be some unusual characters in your "
                                    "message. Could you please try typing your symptoms again "
                                    "using standard text?"})

    # 安全检查 4: 阻止命令前缀
    forbidden_prefixes = ['/', '\\', '@', '!', 'system:', 'admin:']
    if any(user_message.lower().startswith(prefix) for prefix in forbidden_prefixes):
        return jsonify({"response": "I am just a simple medical assistant and cannot process system "
                                    "commands. Please just tell me how you are feeling in plain words."})

    user_id = session['user']['id']

    # 🌟 限流：防连点刷爆 Groq 配额
    now = time.monotonic()
    if now - _ai_last_call.get(user_id, 0) < AI_MIN_INTERVAL:
        return jsonify({"response": "Please give me a moment to finish thinking about your last message."}), 429
    _ai_last_call[user_id] = now

    # 🌟 未配置 Key 时优雅降级，不影响其它任何功能
    if groq_client is None:
        return jsonify({"response": AI_NO_KEY, "error": "ai_disabled",
                        "disclaimer": AI_DISCLAIMER}), 503

    history = load_ai_history(user_id)
    messages = ([{"role": "system", "content": build_system_prompt(user_id)}]
                + history
                + [{"role": "user", "content": user_message}])

    try:
        chat_completion = groq_create(messages)
        raw_response = chat_completion.choices[0].message.content or ""
        clean_response = strip_thinking(raw_response) or AI_EMPTY_REPLY
    except Exception as e:
        print("\n=== GROQ API ERROR ===\n", str(e), "\n======================\n")
        app.logger.exception("Groq API error")
        return jsonify({"response": AI_FALLBACK, "error": "ai_unavailable",
                        "disclaimer": AI_DISCLAIMER}), 503

    # 🌟 急诊兜底
    emergency = "[EMERGENCY]" in clean_response
    if not emergency and detect_red_flag(user_message):
        emergency = True
        clean_response = ("This sounds like a medical emergency. Please call emergency services "
                          "or go to the Emergency Department immediately.\n[EMERGENCY]")

    routing = None if emergency else parse_ai_routing(clean_response)

    save_ai_history(user_id, history + [
        {"role": "user", "content": user_message},
        {"role": "assistant", "content": clean_response}
    ], routing=routing)

    return jsonify({
        "response": clean_response,          # ← 原有字段，前端无需改动即可继续工作
        "routing": routing,                  # 🌟 新增：真实 doctor_id，可直接拉号源
        "emergency": emergency,              # 🌟 新增
        "disclaimer": AI_DISCLAIMER          # 🌟 新增
    })


@app.route('/api/patient/ai_chat/history', methods=['GET'])
@login_required
@role_required(['patient'])
def get_ai_chat_history():
    """🌟 新增：刷新页面 / 换设备后恢复对话"""
    messages = load_ai_history(session['user']['id'])
    return jsonify({
        "messages": [{"role": m["role"], "content": clean_ai_text(m["content"])} for m in messages]
    })


@app.route('/api/patient/ai_chat/reset', methods=['POST'])
@login_required
@role_required(['patient'])
def reset_ai_chat():
    # 清空当前用户的聊天历史（MongoDB + 旧版 session 遗留一并清）
    clear_ai_history(session['user']['id'])
    session.pop('triage_history', None)
    return jsonify({"success": True})


@app.route('/chat', methods=['POST'])
@login_required
@role_required(['patient'])
def legacy_chat():
    """🌟 合并自 main.py 的 /chat：保留旧接口路径，内部复用同一引擎（已加登录校验）"""
    return patient_ai_chat()


# ================= 7. Staff API =================
@app.route('/api/staff/queue', methods=['GET'])
@login_required
@role_required(['staff'])
def get_staff_queue():
    queue = mongo.db.appointments.aggregate([
        {"$match": {"status": {"$in": ["booked", "checked-in", "completed"]}}},
        {"$lookup": {"from": "slots", "localField": "slot_id",
                     "foreignField": "_id", "as": "slot_info"}},
        {"$unwind": "$slot_info"},
        {"$lookup": {"from": "doctors", "localField": "slot_info.doctor_id",
                     "foreignField": "_id", "as": "doctor_info"}},
        {"$unwind": {"path": "$doctor_info", "preserveNullAndEmptyArrays": True}},
        {"$sort": {"slot_info.date": 1, "slot_info.time": 1}}
    ])
    return jsonify(list(queue))


@app.route('/api/staff/walkin', methods=['POST'])
@login_required
@role_required(['staff'])
def create_walkin_appointment():
    data = get_json()
    patient_name = data.get('patient_name')
    patient_id = data.get('patient_id') or \
        f"WALKIN-{str(mongo.db.appointments.count_documents({}) + 1).zfill(4)}"
    doctor_id = data.get('doctor_id')
    date = data.get('date')
    time_str = data.get('time')

    if not patient_name or not doctor_id or not date or not time_str:
        return jsonify({"success": False, "message": "Missing required fields"}), 400

    doc_oid = to_oid(doctor_id)
    if not doc_oid:
        return jsonify({"success": False, "message": "Invalid doctor id"}), 400

    # 🌟 新增：撞号保护
    if mongo.db.slots.find_one({"doctor_id": doc_oid, "date": date, "time": time_str}):
        return jsonify({"success": False,
                        "message": "This doctor already has a slot at that time."}), 400

    new_slot_id = mongo.db.slots.insert_one({
        "doctor_id": doc_oid, "date": date, "time": time_str,
        "status": "booked", "is_walkin": True
    }).inserted_id

    mongo.db.appointments.insert_one({
        "patient_id": patient_id,
        "patient_name": patient_name,
        "slot_id": new_slot_id,
        "status": "checked-in",
        "ai_summary": data.get('ai_summary') or "Walk-in patient - No AI triage",
        "follow_up": "none",
        "created_at": datetime.utcnow()
    })
    return jsonify({"success": True, "message": "Walk-in patient registered and checked in!"})


@app.route('/api/staff/checkin/<appt_id>', methods=['POST'])
@login_required
@role_required(['staff'])
def checkin_patient(appt_id):
    oid = to_oid(appt_id)
    if not oid:
        return jsonify({"success": False, "message": "Invalid appointment id"}), 400
    mongo.db.appointments.update_one({"_id": oid}, {"$set": {"status": "checked-in"}})
    return jsonify({"success": True})


@app.route('/api/staff/prescriptions', methods=['GET'])
@login_required
@role_required(['staff'])
def get_staff_prescriptions():
    pipeline = [
        {"$match": {"status": "completed", "prescription": {"$nin": ["", None, " "]}}},
        {"$lookup": {"from": "users", "localField": "patient_id",
                     "foreignField": "patient_id", "as": "patient_info"}},
        {"$unwind": {"path": "$patient_info", "preserveNullAndEmptyArrays": True}},
        {"$lookup": {"from": "slots", "localField": "slot_id",
                     "foreignField": "_id", "as": "slot_info"}},
        {"$unwind": {"path": "$slot_info", "preserveNullAndEmptyArrays": True}},
        {"$lookup": {"from": "doctors", "localField": "slot_info.doctor_id",
                     "foreignField": "_id", "as": "doctor_info"}},
        {"$unwind": {"path": "$doctor_info", "preserveNullAndEmptyArrays": True}},
        {"$sort": {"created_at": -1}}
    ]
    result = list(mongo.db.appointments.aggregate(pipeline))
    for r in result:
        if r.get('patient_info'):
            r['patient_info'].pop('password', None)   # 🌟 不外泄密码哈希
    return jsonify(result)


@app.route('/api/staff/mark_dispensed/<appt_id>', methods=['POST'])
@login_required
@role_required(['staff'])
def mark_dispensed(appt_id):
    oid = to_oid(appt_id)
    if not oid:
        return jsonify({"success": False, "message": "Invalid appointment id"}), 400
    mongo.db.appointments.update_one(
        {"_id": oid},
        {"$set": {"staff_status": "dispensed", "dispensed_at": datetime.utcnow()}}
    )
    return jsonify({"success": True, "message": "Marked as dispensed successfully!"})


# ================= 8. Doctor API =================
@app.route('/api/doctor/queue', methods=['GET'])
@login_required
@role_required(['doctor'])
def get_doctor_queue():
    current_doctor_id = session['user'].get('doctor_id')
    if not current_doctor_id:
        return jsonify([])
    doc_oid = to_oid(current_doctor_id)
    if not doc_oid:
        return jsonify([])

    queue = mongo.db.appointments.aggregate([
        {"$match": {"status": {"$in": ["booked", "checked-in"]}}},
        {"$lookup": {"from": "slots", "localField": "slot_id",
                     "foreignField": "_id", "as": "slot_info"}},
        {"$unwind": "$slot_info"},
        {"$match": {"slot_info.doctor_id": doc_oid}},
        {"$lookup": {"from": "doctors", "localField": "slot_info.doctor_id",
                     "foreignField": "_id", "as": "doctor_info"}},
        {"$unwind": "$doctor_info"},
        {"$sort": {"slot_info.date": 1, "slot_info.time": 1}}
    ])
    return jsonify(list(queue))


@app.route('/api/doctor/auto_checkin/<appt_id>', methods=['POST'])
@login_required
@role_required(['doctor'])
def doctor_auto_checkin(appt_id):
    oid = to_oid(appt_id)
    if not oid:
        return jsonify({"success": False, "message": "Invalid appointment id"}), 400
    mongo.db.appointments.update_one({"_id": oid}, {"$set": {"status": "checked-in"}})
    return jsonify({"success": True, "message": "Patient checked in by doctor."})


@app.route('/api/doctor/staff_list', methods=['GET'])
@login_required
@role_required(['doctor'])
def get_doctor_staff_list():
    return jsonify(list(mongo.db.users.find({"role": "staff"}, {"password": 0})))


@app.route('/api/doctor/complete/<appt_id>', methods=['POST'])
@login_required
@role_required(['doctor'])
def complete_appointment(appt_id):
    oid = to_oid(appt_id)
    if not oid:
        return jsonify({"success": False, "message": "Invalid appointment id"}), 400

    data = get_json()
    horizon = data.get('horizon', 'none')
    notes = data.get('consultation_notes', '')
    prescription = data.get('prescription', '')
    assigned_staff_id = data.get('assigned_staff_id')

    update_fields = {
        "status": "completed",
        "follow_up": horizon,
        "consultation_notes": notes,
        "prescription": prescription,
        "staff_status": "pending",
        "completed_at": datetime.utcnow()
    }
    staff_oid = to_oid(assigned_staff_id) if assigned_staff_id else None
    if staff_oid:
        update_fields["assigned_staff_id"] = staff_oid

    mongo.db.appointments.update_one({"_id": oid}, {"$set": update_fields})

    if horizon not in ['none', 'No Follow-up Needed']:
        appt = mongo.db.appointments.find_one({"_id": oid})
        if appt:
            patient_id = appt['patient_id']
            patient_name = appt.get('patient_name', 'Patient')
            slot = mongo.db.slots.find_one({"_id": appt['slot_id']})
            if slot:
                doctor_id = slot['doctor_id']
                days_map = {'same-week': 5, '1-3-months': 45, 'advanced': 180}
                days_offset = days_map.get(horizon, 30)
                target_date = (datetime.utcnow() + timedelta(days=days_offset)).strftime('%Y-%m-%d')
                target_time = "10:00 AM"

                # 🌟 新增：避免同一医生复诊撞号
                existed = mongo.db.slots.find_one(
                    {"doctor_id": doctor_id, "date": target_date, "time": target_time})
                if existed:
                    target_time = "10:30 AM"

                new_slot_id = mongo.db.slots.insert_one({
                    "doctor_id": doctor_id, "date": target_date,
                    "time": target_time, "status": "booked"
                }).inserted_id

                mongo.db.appointments.insert_one({
                    "patient_id": patient_id, "patient_name": patient_name,
                    "slot_id": new_slot_id, "status": "booked",
                    "ai_summary": f"Auto-scheduled follow-up: {horizon}",
                    "follow_up": "none", "created_at": datetime.utcnow()
                })

    return jsonify({"success": True, "message": "Consultation completed and prescription recorded!"})


@app.route('/api/doctor/history', methods=['GET'])
@login_required
@role_required(['doctor'])
def get_doctor_history():
    current_doctor_id = session['user'].get('doctor_id')
    if not current_doctor_id:
        return jsonify([])
    doc_oid = to_oid(current_doctor_id)
    if not doc_oid:
        return jsonify([])

    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    pipeline = [
        {"$lookup": {"from": "slots", "localField": "slot_id",
                     "foreignField": "_id", "as": "slot_info"}},
        {"$unwind": "$slot_info"},
        {"$match": {"status": "completed", "slot_info.doctor_id": doc_oid}}
    ]
    if start_date and end_date:
        pipeline.append({"$match": {"slot_info.date": {"$gte": start_date, "$lte": end_date}}})
    pipeline.append({"$sort": {"slot_info.date": -1, "slot_info.time": -1}})

    history = list(mongo.db.appointments.aggregate(pipeline))
    return jsonify(history)


@app.route('/api/doctor/unavailable_times', methods=['POST'])
@login_required
@role_required(['doctor'])
def doctor_request_unavailable_time():
    data = get_json()
    doc_oid = to_oid(session['user'].get('doctor_id'))
    doctor = mongo.db.doctors.find_one({"_id": doc_oid}) if doc_oid else None
    if not doctor:
        doctor = mongo.db.doctors.find_one({"name": session['user']['name']})
    if not doctor:
        return jsonify({"success": False, "message": "Doctor profile not found"}), 404

    mongo.db.unavailable_times.insert_one({
        "doctor_id": doctor['_id'],
        "date": data.get('date'),
        "reason": data.get('reason', 'Not specified'),
        "status": "pending",
        "created_at": datetime.utcnow()
    })
    return jsonify({"success": True, "message": "Request submitted successfully!"})


@app.route('/api/doctor/unavailable_times/my_requests', methods=['GET'])
@login_required
@role_required(['doctor'])
def get_my_unavailable_times():
    doctor_id = session['user'].get('doctor_id')
    if not doctor_id:
        return jsonify([])
    doc_oid = to_oid(doctor_id)
    if not doc_oid:
        return jsonify([])

    requests_list = list(mongo.db.unavailable_times.find(
        {"doctor_id": doc_oid}).sort("date", -1).limit(3))
    for req in requests_list:
        req['_id'] = str(req['_id'])
        req['doctor_id'] = str(req['doctor_id'])
    return jsonify(requests_list)


@app.route('/api/doctor/appointments', methods=['GET'])
@login_required
@role_required(['doctor'])
def get_doctor_all_appointments():
    current_doctor_id = session['user'].get('doctor_id')
    if not current_doctor_id:
        return jsonify([])
    doc_oid = to_oid(current_doctor_id)
    if not doc_oid:
        return jsonify([])

    appointments = mongo.db.appointments.aggregate([
        {"$lookup": {"from": "slots", "localField": "slot_id",
                     "foreignField": "_id", "as": "slot_info"}},
        {"$unwind": {"path": "$slot_info", "preserveNullAndEmptyArrays": True}},
        {"$match": {"slot_info.doctor_id": doc_oid}},
        {"$lookup": {"from": "doctors", "localField": "slot_info.doctor_id",
                     "foreignField": "_id", "as": "doctor_info"}},
        {"$unwind": {"path": "$doctor_info", "preserveNullAndEmptyArrays": True}},
        {"$sort": {"slot_info.date": 1, "slot_info.time": 1}}
    ])
    return jsonify(list(appointments))


# ================= 9. Admin API =================
@app.route('/api/admin/stats', methods=['GET'])
@login_required
@role_required(['admin'])
def get_admin_stats():
    return jsonify({
        "total_users": mongo.db.users.count_documents({"role": "patient"}),
        "active_bookings": mongo.db.appointments.count_documents(
            {"status": {"$in": ["booked", "checked-in"]}}),
        "completed": mongo.db.appointments.count_documents({"status": "completed"}),
        "available_slots": mongo.db.slots.count_documents({"status": "available"}),
        # 🌟 新增指标（原有 4 个字段全部保留）
        "ai_sessions": mongo.db.ai_chats.count_documents({}),
        "total_doctors": mongo.db.doctors.count_documents({}),
        "pending_requests": mongo.db.unavailable_times.count_documents({"status": "pending"})
    })


@app.route('/api/admin/users', methods=['GET', 'POST'])
@login_required
@role_required(['admin'])
def admin_manage_users():
    if request.method == 'GET':
        return jsonify(list(mongo.db.users.find({"role": {"$ne": "root"}}, {"password": 0})))

    data = get_json()
    if mongo.db.users.find_one({"username": data.get('username')}):
        return jsonify({"success": False, "message": "Username already exists"}), 400

    pw_hash = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())
    patient_id = generate_patient_id() if data['role'] == 'patient' else None
    doctor_id = None

    if data['role'] == 'doctor':
        doc_result = mongo.db.doctors.insert_one({
            "name": data['name'],
            "specialty": data.get('specialty', 'General Practitioner (GP)'),
            "room": data.get('room', 'TBD'),
            "assigned_staff_id": None
        })
        doctor_id = doc_result.inserted_id
        invalidate_directory_cache()   # 🌟 AI 目录立即生效

    mongo.db.users.insert_one({
        "username": data['username'], "password": pw_hash, "role": data['role'],
        "name": data['name'], "email": data.get('email', ''), "phone": data.get('phone', ''),
        "patient_id": patient_id, "doctor_id": doctor_id, "created_at": datetime.utcnow()
    })
    return jsonify({"success": True, "message": "User created successfully!"})


@app.route('/api/admin/users/<user_id>', methods=['PUT', 'DELETE'])
@login_required
@role_required(['admin'])
def admin_modify_user(user_id):
    oid = to_oid(user_id)
    user = mongo.db.users.find_one({"_id": oid}) if oid else None
    if not user or user['role'] == 'root':
        return jsonify({"success": False, "message": "User not found or cannot modify Root"}), 403

    if request.method == 'DELETE':
        mongo.db.users.delete_one({"_id": oid})
        return jsonify({"success": True, "message": "User deleted!"})

    data = get_json()
    # 🌟 白名单，防止越权改 role / patient_id
    allowed = ['name', 'email', 'phone', 'ic_number', 'gender', 'dob']
    update_data = {k: v for k, v in data.items() if k in allowed and v}
    if data.get('password'):
        update_data['password'] = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())
    if update_data:
        mongo.db.users.update_one({"_id": oid}, {"$set": update_data})
    return jsonify({"success": True, "message": "User updated!"})


@app.route('/api/specialties', methods=['GET'])
@login_required
def get_specialties():
    return jsonify(list(mongo.db.specialties.find()))


@app.route('/api/admin/specialties', methods=['POST', 'DELETE'])
@login_required
@role_required(['admin'])
def manage_specialties():
    """原接口保留：DELETE 时可通过 ?spec_id= 或 body 传 id（修复原 view_args KeyError）"""
    if request.method == 'POST':
        name = (get_json().get('name') or '').strip()
        if not name:
            return jsonify({"success": False, "message": "Specialty name required"}), 400
        if mongo.db.specialties.find_one({"name": name}):
            return jsonify({"success": False, "message": "Specialty already exists"}), 400
        mongo.db.specialties.insert_one({"name": name})
    else:
        spec_id = (request.args.get('spec_id')
                   or get_json().get('spec_id')
                   or (request.view_args or {}).get('spec_id'))
        oid = to_oid(spec_id)
        if not oid:
            return jsonify({"success": False,
                            "message": "spec_id required (use ?spec_id= or /api/admin/specialties/<id>)"}), 400
        mongo.db.specialties.delete_one({"_id": oid})
    invalidate_directory_cache()
    return jsonify({"success": True})


@app.route('/api/admin/specialties/<spec_id>', methods=['DELETE'])
@login_required
@role_required(['admin'])
def delete_specialty(spec_id):
    """🌟 新增 RESTful 路径版本（旧接口同时保留）"""
    oid = to_oid(spec_id)
    if not oid:
        return jsonify({"success": False, "message": "Invalid specialty id"}), 400
    mongo.db.specialties.delete_one({"_id": oid})
    invalidate_directory_cache()
    return jsonify({"success": True})


@app.route('/api/admin/doctors', methods=['GET'])
@login_required
@role_required(['admin'])
def admin_get_doctors():
    doctors = mongo.db.doctors.aggregate([
        {"$lookup": {"from": "users", "localField": "assigned_staff_id",
                     "foreignField": "_id", "as": "staff_info"}},
        {"$unwind": {"path": "$staff_info", "preserveNullAndEmptyArrays": True}}
    ])
    result = list(doctors)
    for d in result:
        if d.get('staff_info'):
            d['staff_info'].pop('password', None)
    return jsonify(result)


@app.route('/api/admin/doctors/<doctor_id>', methods=['PUT'])
@login_required
@role_required(['admin'])
def admin_update_doctor(doctor_id):
    oid = to_oid(doctor_id)
    if not oid:
        return jsonify({"success": False, "message": "Invalid doctor id"}), 400

    data = get_json()
    update_data = {k: data[k] for k in ['name', 'specialty', 'room', 'bio', 'working_hours']
                   if data.get(k) is not None}
    if update_data:
        mongo.db.doctors.update_one({"_id": oid}, {"$set": update_data})
        if update_data.get('name'):   # 🌟 同步登录账号显示名
            mongo.db.users.update_one({"doctor_id": oid}, {"$set": {"name": update_data['name']}})
    invalidate_directory_cache()
    return jsonify({"success": True, "message": "Doctor details updated!"})


@app.route('/api/admin/doctors/<doctor_id>/assign_staff', methods=['PUT'])
@login_required
@role_required(['admin'])
def admin_assign_staff(doctor_id):
    oid = to_oid(doctor_id)
    if not oid:
        return jsonify({"success": False, "message": "Invalid doctor id"}), 400
    data = get_json()
    staff_oid = to_oid(data.get('staff_id')) if data.get('staff_id') else None
    mongo.db.doctors.update_one({"_id": oid}, {"$set": {"assigned_staff_id": staff_oid}})
    return jsonify({"success": True, "message": "Staff assignment updated!"})


@app.route('/api/admin/staff_list', methods=['GET'])
@login_required
@role_required(['admin'])
def admin_get_staff_list():
    return jsonify(list(mongo.db.users.find({"role": "staff"}, {"password": 0})))


@app.route('/api/admin/unavailable_times', methods=['GET'])
@login_required
@role_required(['admin'])
def admin_get_unavailable_times():
    times = mongo.db.unavailable_times.aggregate([
        {"$lookup": {"from": "doctors", "localField": "doctor_id",
                     "foreignField": "_id", "as": "doctor_info"}},
        {"$unwind": "$doctor_info"},
        {"$sort": {"date": 1}}
    ])
    return jsonify(list(times))


@app.route('/api/admin/unavailable_times/<time_id>/status', methods=['PUT'])
@login_required
@role_required(['admin'])
def admin_update_unavailable_status(time_id):
    oid = to_oid(time_id)
    if not oid:
        return jsonify({"success": False, "message": "Invalid request id"}), 400
    data = get_json()
    status = data.get('status')
    if status not in ['pending', 'approved', 'rejected']:
        return jsonify({"success": False, "message": "Invalid status"}), 400
    mongo.db.unavailable_times.update_one({"_id": oid}, {"$set": {"status": status}})
    return jsonify({"success": True, "message": f"Request {status}!"})


@app.route('/api/admin/unavailable_times/<time_id>', methods=['DELETE'])
@login_required
@role_required(['admin'])
def admin_delete_unavailable_time(time_id):
    oid = to_oid(time_id)
    if not oid:
        return jsonify({"success": False, "message": "Invalid request id"}), 400
    mongo.db.unavailable_times.delete_one({"_id": oid})
    return jsonify({"success": True, "message": "Request deleted!"})


# ================= 10. Init Default Data & Main =================
def init_default_data():
    with app.app_context():
        # 🌟 新增：索引（重复数据会导致创建失败，仅告警不中断）
        try:
            mongo.db.users.create_index("username", unique=True)
            mongo.db.users.create_index("patient_id", unique=True, sparse=True)
            mongo.db.users.create_index("ic_number", unique=True, sparse=True)
            mongo.db.ai_chats.create_index("user_id", unique=True)
            mongo.db.appointments.create_index("patient_id")
            mongo.db.appointments.create_index("slot_id")
            mongo.db.slots.create_index([("doctor_id", 1), ("date", 1), ("time", 1)])
            mongo.db.unavailable_times.create_index([("doctor_id", 1), ("date", 1)])
            print("✅ Indexes ensured.")
        except Exception as e:
            print(f"⚠️  Index creation skipped (existing duplicates?): {e}")

        if mongo.db.specialties.count_documents({}) == 0:
            mongo.db.specialties.insert_many([
                {"name": "General Practitioner (GP)"},
                {"name": "Cardiology (Heart)"},
                {"name": "Dermatology (Skin)"}
            ])
            print("✅ Initialized default specialties.")

        if mongo.db.users.count_documents({"role": "root"}) == 0:
            root_pw = os.environ.get("ROOT_DEFAULT_PASSWORD", "root123")
            pw_hash = bcrypt.hashpw(root_pw.encode('utf-8'), bcrypt.gensalt())
            mongo.db.users.insert_one({
                "username": "root", "password": pw_hash, "role": "root",
                "name": "System Administrator", "patient_id": None, "doctor_id": None
            })
            print("\n" + "=" * 55 +
                  f"\n🌟 Root account created!\n👤 Username: root\n🔑 Password: {root_pw}\n" +
                  "=" * 55 + "\n")

        default_doctors = [
            {"name": "Dr. Smith", "specialty": "General Practitioner (GP)", "room": "Room 101",
             "username": "doc_smith", "password": "doc123"},
            {"name": "Dr. Carter", "specialty": "Cardiology (Heart)", "room": "Room 201",
             "username": "doc_carter", "password": "doc123"},
            {"name": "Dr. Chen", "specialty": "Dermatology (Skin)", "room": "Room 301",
             "username": "doc_chen", "password": "doc123"},
            {"name": "Dr. Patel", "specialty": "General Practitioner (GP)", "room": "Room 102",
             "username": "doc_patel", "password": "doc123"},
            {"name": "Dr. Rossi", "specialty": "Cardiology (Heart)", "room": "Room 202",
             "username": "doc_rossi", "password": "doc123"},
        ]

        print("\n" + "=" * 55 + "\n🌟 Initializing Doctor Accounts...")
        for doc in default_doctors:
            if not mongo.db.users.find_one({"username": doc['username']}):
                doc_result = mongo.db.doctors.insert_one({
                    "name": doc['name'], "specialty": doc['specialty'],
                    "room": doc['room'], "assigned_staff_id": None
                })
                pw_hash = bcrypt.hashpw(doc['password'].encode('utf-8'), bcrypt.gensalt())
                mongo.db.users.insert_one({
                    "username": doc['username'], "password": pw_hash, "role": "doctor",
                    "name": doc['name'], "email": f"{doc['username']}@medisync.com",
                    "phone": "1234567890", "patient_id": None,
                    "doctor_id": doc_result.inserted_id
                })
                print(f"✅ Created: {doc['name']} | User: {doc['username']} | Pass: {doc['password']}")
        print("=" * 55 + "\n")

        # 绑定历史遗留的医生账号（原逻辑保留 + 补 null 情况）
        for u in mongo.db.users.find({"role": "doctor",
                                      "$or": [{"doctor_id": {"$exists": False}},
                                              {"doctor_id": None}]}):
            doc = mongo.db.doctors.find_one({"name": u['name']})
            if doc:
                mongo.db.users.update_one({"_id": u['_id']}, {"$set": {"doctor_id": doc['_id']}})
                print(f"🔗 Bound doctor account: {u['name']}")

        doctors = list(mongo.db.doctors.find())
        if doctors:
            current = datetime.utcnow()
            times = ["09:00 AM", "10:30 AM", "02:00 PM", "03:30 PM"]
            print("🌟 Checking and generating slots for all doctors (Next 60 days)...")
            for doc in doctors:
                if mongo.db.slots.count_documents({"doctor_id": doc['_id']}) == 0:
                    bulk = []
                    for i in range(60):
                        date_str = (current + timedelta(days=i)).strftime('%Y-%m-%d')
                        for t in times:
                            bulk.append({"doctor_id": doc['_id'], "date": date_str,
                                         "time": t, "status": "available"})
                    if bulk:
                        mongo.db.slots.insert_many(bulk)   # 🌟 批量插入，启动更快
                    print(f"✅ Generated 60 days of slots for {doc['name']}")
            print("✅ All doctors' calendars are fully populated.")

        invalidate_directory_cache()
        directory, count = get_hospital_directory()
        print(f"🌟 AI directory loaded: {count} departments (live from DB)\n{directory}\n")


if __name__ == '__main__':
    init_default_data()
    app.run(debug=True, port=5000)