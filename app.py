from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask.json.provider import DefaultJSONProvider
from flask_pymongo import PyMongo
from flask_cors import CORS
from bson import ObjectId
from bson.json_util import dumps, loads
from datetime import datetime, timedelta
import bcrypt
import re
from functools import wraps
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# ================= 1. Init Flask & MongoDB =================
app = Flask(__name__, template_folder='templates', static_folder='static')
app.secret_key = "medisync_super_secret_key_2024"
app.config["MONGO_URI"] = "mongodb://localhost:27017/medisync_db"
mongo = PyMongo(app)
CORS(app)


class MongoJSONProvider(DefaultJSONProvider):
    def default(self, obj):
        if isinstance(obj, ObjectId): return str(obj)
        if isinstance(obj, datetime): return obj.isoformat()
        if isinstance(obj, bytes): return obj.decode('utf-8')
        return super().default(obj)


app.json = MongoJSONProvider(app)

@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response


def parse_json(data): return loads(dumps(data))

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session:
            if request.path.startswith('/api/'): return jsonify({"error": "Please login first"}), 401
            return redirect(url_for('patient_auth'))
        return f(*args, **kwargs)

    return decorated


def role_required(allowed_roles):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if session.get('user', {}).get('role') not in allowed_roles:
                if request.path.startswith('/api/'): return jsonify({"error": "Unauthorized"}), 403
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
def patient_auth(): return render_template('patient_auth.html')


@app.route('/staff/auth')
def staff_auth(): return render_template('staff_auth.html')


@app.route('/root')
@login_required
@role_required(['root'])
def root_page(): return render_template('root.html', user=session['user'])


@app.route('/patient/dashboard')
@login_required
@role_required(['patient'])
def patient_dashboard(): return render_template('patient.html', user=session['user'])


@app.route('/staff/dashboard')
@login_required
@role_required(['staff'])
def staff_dashboard(): return render_template('staff.html', user=session['user'])


@app.route('/doctor/dashboard')
@login_required
@role_required(['doctor'])
def doctor_dashboard(): return render_template('doctor.html', user=session['user'])


@app.route('/admin/dashboard')
@login_required
@role_required(['admin'])
def admin_dashboard(): return render_template('admin.html', user=session['user'])


# ================= 4. Auth API =================
@app.route('/api/auth/register', methods=['POST'])
def register_patient():
    data = request.json
    if mongo.db.users.find_one({"username": data['username']}):
        return jsonify({"success": False, "message": "Username already exists"}), 400
    if mongo.db.users.find_one({"ic_number": data['ic_number']}):
        return jsonify({"success": False, "message": "This IC Number is already registered."}), 400
    if not re.match(r"[^@]+@[^@]+\.[^@]+", data['email']):
        return jsonify({"success": False, "message": "Invalid email format"}), 400

    pw_hash = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())
    patient_id = f"MS-{str(mongo.db.users.count_documents({})).zfill(4)}"

    mongo.db.users.insert_one({
        "username": data['username'], "password": pw_hash, "role": "patient",
        "name": data['name'], "ic_number": data['ic_number'], "email": data['email'],
        "patient_id": patient_id, "doctor_id": None
    })
    return jsonify({"success": True, "message": "Registered successfully! Please login."})


@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json
    user = mongo.db.users.find_one({"username": data['username']})
    if user and bcrypt.checkpw(data['password'].encode('utf-8'), user['password']):
        session['user'] = {
            "id": str(user['_id']), "username": user['username'], "role": user['role'],
            "name": user['name'], "patient_id": user.get('patient_id'),
            "doctor_id": str(user['doctor_id']) if user.get('doctor_id') else None
        }
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
    data = request.json
    if mongo.db.users.find_one({"username": data['username']}):
        return jsonify({"success": False, "message": "Username already exists"}), 400
    pw_hash = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())
    mongo.db.users.insert_one({
        "username": data['username'], "password": pw_hash, "role": data['role'],
        "name": data['name'], "patient_id": None, "doctor_id": None
    })
    return jsonify({"success": True, "message": f"{data['role'].capitalize()} account created!"})


@app.route('/api/root/users', methods=['GET'])
@login_required
@role_required(['root'])
def get_all_users():
    users = mongo.db.users.find({"role": {"$in": ["staff", "doctor", "admin", "patient"]}}, {"password": 0})
    return jsonify(list(users))


# ================= 6. Patient API =================
@app.route('/api/patient/doctors', methods=['GET'])
@login_required
@role_required(['patient', 'admin', 'staff'])
def get_doctors():
    specialty = request.args.get('specialty')
    query = {}
    if specialty and specialty.lower() != 'all': query['specialty'] = specialty
    return jsonify(list(mongo.db.doctors.find(query)))


@app.route('/api/patient/slots', methods=['GET'])
@login_required
@role_required(['patient', 'staff'])
def get_available_slots():
    doctor_id = request.args.get('doctor_id')
    date = request.args.get('date')

    match_query = {"status": "available"}
    if doctor_id: match_query["doctor_id"] = ObjectId(doctor_id)
    if date: match_query["date"] = date

    slots = mongo.db.slots.aggregate([
        {"$match": match_query},
        {"$lookup": {"from": "doctors", "localField": "doctor_id", "foreignField": "_id", "as": "doctor_info"}},
        {"$unwind": "$doctor_info"}
    ])
    return jsonify(list(slots))


@app.route('/api/patient/book', methods=['POST'])
@login_required
@role_required(['patient'])
def book_slot():
    data = request.json
    mongo.db.slots.update_one({"_id": ObjectId(data['slot_id'])}, {"$set": {"status": "booked"}})
    mongo.db.appointments.insert_one({
        "patient_id": session['user']['patient_id'],
        "patient_name": session['user']['name'],
        "slot_id": ObjectId(data['slot_id']),
        "status": "booked",
        "ai_summary": data.get('ai_summary', 'N/A'),
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
        {"$lookup": {"from": "slots", "localField": "slot_id", "foreignField": "_id", "as": "slot_info"}},
        {"$unwind": "$slot_info"},
        {"$lookup": {"from": "doctors", "localField": "slot_info.doctor_id", "foreignField": "_id",
                     "as": "doctor_info"}},
        {"$unwind": "$doctor_info"}
    ])
    return jsonify(list(appts))


@app.route('/api/patient/cancel/<appt_id>', methods=['DELETE'])
@login_required
@role_required(['patient'])
def cancel_appointment(appt_id):
    appt = mongo.db.appointments.find_one({"_id": ObjectId(appt_id)})
    if appt:
        mongo.db.slots.update_one({"_id": appt['slot_id']}, {"$set": {"status": "available"}})
        mongo.db.appointments.delete_one({"_id": ObjectId(appt_id)})
    return jsonify({"success": True})


@app.route('/api/patient/ai_triage', methods=['POST'])
@login_required
@role_required(['patient'])
def ai_triage():
    symptoms = request.json.get('symptoms', '').lower()
    recommendation = "General Practitioner (GP)"
    if any(w in symptoms for w in ['chest', 'heart', 'breath']):
        recommendation = "Cardiology (Heart)"
    elif any(w in symptoms for w in ['skin', 'rash', 'itch']):
        recommendation = "Dermatology (Skin)"
    return jsonify({"recommendation": recommendation, "disclaimer": "Guidance only, not a medical diagnosis."})


@app.route('/api/patient/profile', methods=['GET', 'PUT'])
@login_required
@role_required(['patient'])
def patient_profile():
    user_id = session['user']['id']
    if request.method == 'GET':
        user = mongo.db.users.find_one({"_id": ObjectId(user_id)}, {"password": 0})
        return jsonify(user)
    else:
        data = request.json
        update_data = {k: v for k, v in data.items() if k not in ['old_password', 'password'] and v}
        if data.get('password'):
            update_data['password'] = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())
        mongo.db.users.update_one({"_id": ObjectId(user_id)}, {"$set": update_data})
        session['user']['name'] = update_data.get('name', session['user']['name'])
        return jsonify({"success": True, "message": "Profile updated!"})

@app.route('/api/patient/send_reminder/<appt_id>', methods=['POST'])
@login_required
@role_required(['patient'])
def send_reminder_email(appt_id):
    appt = mongo.db.appointments.find_one({"_id": ObjectId(appt_id)})
    if not appt:
        return jsonify({"success": False, "message": "Appointment not found"}), 404

    patient = mongo.db.users.find_one({"patient_id": appt['patient_id']})
    patient_email = patient.get('email') if patient else None

    if not patient_email:
        return jsonify(
            {"success": False, "message": "Patient email not found in profile. Please update in Settings."}), 400

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

    try:
        # sender_email = "your_email@gmail.com"
        # sender_password = "your_app_password" # Gmail 请使用应用专用密码
        #
        # msg = MIMEMultipart()
        # msg['From'] = sender_email
        # msg['To'] = patient_email
        # msg['Subject'] = subject
        # msg.attach(MIMEText(body, 'plain'))
        #
        # server = smtplib.SMTP('smtp.gmail.com', 587)
        # server.starttls()
        # server.login(sender_email, sender_password)
        # server.send_message(msg)
        # server.quit()
        # ==========================================

        print(f"📧 [SIMULATED] Reminder email sent to {patient_email} for appointment on {date_str}")
        return jsonify({"success": True, "message": "Reminder email sent successfully!"})

    except Exception as e:
        print(f"Email sending failed: {e}")
        return jsonify(
            {"success": True, "message": "Reminder email simulated (Configure SMTP in app.py for real sending)."})


@app.route('/api/patient/doctors/<doctor_id>/profile', methods=['GET'])
@login_required
@role_required(['patient'])
def get_doctor_profile(doctor_id):
    doctor = mongo.db.doctors.find_one({"_id": ObjectId(doctor_id)})
    if not doctor: return jsonify({"error": "Doctor not found"}), 404
    return jsonify({
        "name": doctor.get("name", ""), "specialty": doctor.get("specialty", ""),
        "room": doctor.get("room", ""), "bio": doctor.get("bio", ""),
        "working_hours": doctor.get("working_hours", {"weekdays": "9:00 AM - 5:00 PM", "saturday": "9:00 AM - 1:00 PM",
                                                      "sunday": "Closed"})
    })


# ================= 7.Staff API  =================
@app.route('/api/staff/queue', methods=['GET'])
@login_required
@role_required(['staff'])
def get_staff_queue():
    queue = mongo.db.appointments.aggregate([
        {"$match": {"status": {"$in": ["booked", "checked-in", "completed"]}}},
        {"$lookup": {"from": "slots", "localField": "slot_id", "foreignField": "_id", "as": "slot_info"}},
        {"$unwind": "$slot_info"},
        {"$lookup": {"from": "doctors", "localField": "slot_info.doctor_id", "foreignField": "_id", "as": "doctor_info"}},
        {"$unwind": {"path": "$doctor_info", "preserveNullAndEmptyArrays": True}}
    ])
    return jsonify(list(queue))

@app.route('/api/staff/walkin', methods=['POST'])
@login_required
@role_required(['staff'])
def create_walkin_appointment():
    data = request.json
    patient_name = data.get('patient_name')
    patient_id = data.get('patient_id', f"WALKIN-{str(mongo.db.appointments.count_documents({})).zfill(4)}")
    doctor_id = data.get('doctor_id')
    date = data.get('date')
    time = data.get('time')

    if not patient_name or not doctor_id or not date or not time:
        return jsonify({"success": False, "message": "Missing required fields"}), 400

    new_slot_id = mongo.db.slots.insert_one({
        "doctor_id": ObjectId(doctor_id),
        "date": date,
        "time": time,
        "status": "booked",
        "is_walkin": True
    }).inserted_id

    mongo.db.appointments.insert_one({
        "patient_id": patient_id,
        "patient_name": patient_name,
        "slot_id": new_slot_id,
        "status": "checked-in",
        "ai_summary": "Walk-in patient - No AI triage",
        "follow_up": "none",
        "created_at": datetime.utcnow()
    })

    return jsonify({"success": True, "message": "Walk-in patient registered and checked in!"})

@app.route('/api/staff/checkin/<appt_id>', methods=['POST'])
@login_required
@role_required(['staff'])
def checkin_patient(appt_id):
    mongo.db.appointments.update_one({"_id": ObjectId(appt_id)}, {"$set": {"status": "checked-in"}})
    return jsonify({"success": True})

@app.route('/api/staff/prescriptions', methods=['GET'])
@login_required
@role_required(['staff'])
def get_staff_prescriptions():
    pipeline = [
        {"$match": {"status": "completed", "prescription": {"$ne": ""}}},
        {"$lookup": {"from": "users", "localField": "patient_id", "foreignField": "patient_id", "as": "patient_info"}},
        {"$unwind": {"path": "$patient_info", "preserveNullAndEmptyArrays": True}},
        {"$lookup": {"from": "slots", "localField": "slot_id", "foreignField": "_id", "as": "slot_info"}},
        {"$unwind": {"path": "$slot_info", "preserveNullAndEmptyArrays": True}},
        {"$lookup": {"from": "doctors", "localField": "slot_info.doctor_id", "foreignField": "_id", "as": "doctor_info"}},
        {"$unwind": {"path": "$doctor_info", "preserveNullAndEmptyArrays": True}},
        {"$sort": {"created_at": -1}}
    ]
    return jsonify(list(mongo.db.appointments.aggregate(pipeline)))

@app.route('/api/staff/mark_dispensed/<appt_id>', methods=['POST'])
@login_required
@role_required(['staff'])
def mark_dispensed(appt_id):
    mongo.db.appointments.update_one(
        {"_id": ObjectId(appt_id)},
        {"$set": {"staff_status": "dispensed", "dispensed_at": datetime.utcnow()}}
    )
    return jsonify({"success": True, "message": "Marked as dispensed successfully!"})


# ================= 8.Doctor API =================
@app.route('/api/doctor/queue', methods=['GET'])
@login_required
@role_required(['doctor'])
def get_doctor_queue():
    current_doctor_id = session['user'].get('doctor_id')
    if not current_doctor_id: return jsonify([])
    queue = mongo.db.appointments.aggregate([
        {"$match": {"status": {"$in": ["booked", "checked-in"]}}},
        {"$lookup": {"from": "slots", "localField": "slot_id", "foreignField": "_id", "as": "slot_info"}},
        {"$unwind": "$slot_info"},
        {"$match": {"slot_info.doctor_id": ObjectId(current_doctor_id)}},
        {"$lookup": {"from": "doctors", "localField": "slot_info.doctor_id", "foreignField": "_id",
                     "as": "doctor_info"}},
        {"$unwind": "$doctor_info"},
        {"$sort": {"slot_info.date": 1, "slot_info.time": 1}}
    ])
    return jsonify(list(queue))


@app.route('/api/doctor/auto_checkin/<appt_id>', methods=['POST'])
@login_required
@role_required(['doctor'])
def doctor_auto_checkin(appt_id):
    mongo.db.appointments.update_one({"_id": ObjectId(appt_id)}, {"$set": {"status": "checked-in"}})
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
    data = request.json
    horizon = data.get('horizon', 'none')
    notes = data.get('consultation_notes', '')
    prescription = data.get('prescription', '')
    assigned_staff_id = data.get('assigned_staff_id')

    update_fields = {
        "status": "completed",
        "follow_up": horizon,
        "consultation_notes": notes,
        "prescription": prescription,
        "staff_status": "pending"
    }
    if assigned_staff_id:
        update_fields["assigned_staff_id"] = ObjectId(assigned_staff_id)

    mongo.db.appointments.update_one({"_id": ObjectId(appt_id)}, {"$set": update_fields})

    if horizon not in ['none', 'No Follow-up Needed']:
        appt = mongo.db.appointments.find_one({"_id": ObjectId(appt_id)})
        patient_id = appt['patient_id']
        patient_name = appt.get('patient_name', 'Patient')
        slot = mongo.db.slots.find_one({"_id": appt['slot_id']})
        if slot:
            doctor_id = slot['doctor_id']
            days_map = {'same-week': 5, '1-3-months': 45, 'advanced': 180}
            days_offset = days_map.get(horizon, 30)
            target_date = (datetime.utcnow() + timedelta(days=days_offset)).strftime('%Y-%m-%d')

            new_slot_id = mongo.db.slots.insert_one({
                "doctor_id": doctor_id, "date": target_date, "time": "10:00 AM", "status": "booked"
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

    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    pipeline = [
        {"$lookup": {"from": "slots", "localField": "slot_id", "foreignField": "_id", "as": "slot_info"}},
        {"$unwind": "$slot_info"},
        {"$match": {
            "status": "completed",
            "slot_info.doctor_id": ObjectId(current_doctor_id)
        }}
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
    data = request.json
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

    requests = list(mongo.db.unavailable_times.find(
        {"doctor_id": ObjectId(doctor_id)}
    ).sort("date", -1).limit(3))

    for req in requests:
        req['_id'] = str(req['_id'])
        req['doctor_id'] = str(req['doctor_id'])

    return jsonify(requests)


# ================= 9. Admin API =================
@app.route('/api/admin/stats', methods=['GET'])
@login_required
@role_required(['admin'])
def get_admin_stats():
    return jsonify({
        "total_users": mongo.db.users.count_documents({"role": "patient"}),
        "active_bookings": mongo.db.appointments.count_documents({"status": {"$in": ["booked", "checked-in"]}}),
        "completed": mongo.db.appointments.count_documents({"status": "completed"}),
        "available_slots": mongo.db.slots.count_documents({"status": "available"})
    })

@app.route('/api/admin/users', methods=['GET', 'POST'])
@login_required
@role_required(['admin'])
def admin_manage_users():
    if request.method == 'GET':
        return jsonify(list(mongo.db.users.find({"role": {"$ne": "root"}}, {"password": 0})))

    data = request.json
    if mongo.db.users.find_one({"username": data['username']}):
        return jsonify({"success": False, "message": "Username already exists"}), 400

    pw_hash = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())
    patient_id = f"MS-{str(mongo.db.users.count_documents({})).zfill(4)}" if data['role'] == 'patient' else None
    doctor_id = None

    if data['role'] == 'doctor':
        doc_result = mongo.db.doctors.insert_one({
            "name": data['name'], "specialty": data.get('specialty', 'General Practitioner'),
            "room": data.get('room', 'TBD'), "assigned_staff_id": None
        })
        doctor_id = doc_result.inserted_id

    mongo.db.users.insert_one({
        "username": data['username'], "password": pw_hash, "role": data['role'],
        "name": data['name'], "email": data.get('email', ''), "phone": data.get('phone', ''),
        "patient_id": patient_id, "doctor_id": doctor_id
    })
    return jsonify({"success": True, "message": "User created successfully!"})

@app.route('/api/admin/users/<user_id>', methods=['PUT', 'DELETE'])
@login_required
@role_required(['admin'])
def admin_modify_user(user_id):
    user = mongo.db.users.find_one({"_id": ObjectId(user_id)})
    if not user or user['role'] == 'root':
        return jsonify({"success": False, "message": "User not found or cannot modify Root"}), 403

    if request.method == 'DELETE':
        mongo.db.users.delete_one({"_id": ObjectId(user_id)})
        return jsonify({"success": True, "message": "User deleted!"})

    data = request.json
    update_data = {k: v for k, v in data.items() if k not in ['_id', 'password'] and v}
    if data.get('password'):
        update_data['password'] = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())

    mongo.db.users.update_one({"_id": ObjectId(user_id)}, {"$set": update_data})
    return jsonify({"success": True, "message": "User updated!"})

@app.route('/api/specialties', methods=['GET'])
@login_required
def get_specialties(): return jsonify(list(mongo.db.specialties.find()))

@app.route('/api/admin/specialties', methods=['POST', 'DELETE'])
@login_required
@role_required(['admin'])
def manage_specialties():
    if request.method == 'POST':
        mongo.db.specialties.insert_one({"name": request.json['name']})
    else:
        mongo.db.specialties.delete_one({"_id": ObjectId(request.view_args['spec_id'])})
    return jsonify({"success": True})

@app.route('/api/admin/doctors', methods=['GET'])
@login_required
@role_required(['admin'])
def admin_get_doctors():
    doctors = mongo.db.doctors.aggregate([
        {"$lookup": {"from": "users", "localField": "assigned_staff_id", "foreignField": "_id", "as": "staff_info"}},
        {"$unwind": {"path": "$staff_info", "preserveNullAndEmptyArrays": True}}
    ])
    return jsonify(list(doctors))

@app.route('/api/admin/doctors/<doctor_id>', methods=['PUT'])
@login_required
@role_required(['admin'])
def admin_update_doctor(doctor_id):
    data = request.json
    mongo.db.doctors.update_one({"_id": ObjectId(doctor_id)}, {"$set": {
        "name": data.get('name'), "specialty": data.get('specialty'), "room": data.get('room')
    }})
    return jsonify({"success": True, "message": "Doctor details updated!"})

@app.route('/api/admin/doctors/<doctor_id>/assign_staff', methods=['PUT'])
@login_required
@role_required(['admin'])
def admin_assign_staff(doctor_id):
    data = request.json
    update_val = ObjectId(data.get('staff_id')) if data.get('staff_id') else None
    mongo.db.doctors.update_one({"_id": ObjectId(doctor_id)}, {"$set": {"assigned_staff_id": update_val}})
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
        {"$lookup": {"from": "doctors", "localField": "doctor_id", "foreignField": "_id", "as": "doctor_info"}},
        {"$unwind": "$doctor_info"}, {"$sort": {"date": 1}}
    ])
    return jsonify(list(times))

@app.route('/api/admin/unavailable_times/<time_id>/status', methods=['PUT'])
@login_required
@role_required(['admin'])
def admin_update_unavailable_status(time_id):
    data = request.json
    mongo.db.unavailable_times.update_one({"_id": ObjectId(time_id)}, {"$set": {"status": data.get('status')}})
    return jsonify({"success": True, "message": f"Request {data.get('status')}!"})

@app.route('/api/admin/unavailable_times/<time_id>', methods=['DELETE'])
@login_required
@role_required(['admin'])
def admin_delete_unavailable_time(time_id):
    mongo.db.unavailable_times.delete_one({"_id": ObjectId(time_id)})
    return jsonify({"success": True, "message": "Request deleted!"})

def init_default_data():
    with app.app_context():
        if mongo.db.specialties.count_documents({}) == 0:
            mongo.db.specialties.insert_many([
                {"name": "General Practitioner (GP)"},
                {"name": "Cardiology (Heart)"},
                {"name": "Dermatology (Skin)"}
            ])
            print("✅ Initialized default specialties.")

        if mongo.db.users.count_documents({"role": "root"}) == 0:
            pw_hash = bcrypt.hashpw("root123".encode('utf-8'), bcrypt.gensalt())
            mongo.db.users.insert_one({
                "username": "root", "password": pw_hash, "role": "root",
                "name": "System Administrator", "patient_id": None, "doctor_id": None
            })
            print(
                "\n" + "=" * 55 + "\n🌟 Root account created!\n👤 Username: root\n🔑 Password: root123\n" + "=" * 55 + "\n")

        default_doctors = [
            {"name": "Dr. Smith", "specialty": "General Practitioner (GP)", "room": "Room 101", "username": "doc_smith",
             "password": "doc123"},
            {"name": "Dr. Carter", "specialty": "Cardiology (Heart)", "room": "Room 201", "username": "doc_carter",
             "password": "doc123"},
            {"name": "Dr. Chen", "specialty": "Dermatology (Skin)", "room": "Room 301", "username": "doc_chen",
             "password": "doc123"},
            {"name": "Dr. Patel", "specialty": "General Practitioner (GP)", "room": "Room 102", "username": "doc_patel",
             "password": "doc123"},
            {"name": "Dr. Rossi", "specialty": "Cardiology (Heart)", "room": "Room 202", "username": "doc_rossi",
             "password": "doc123"},
        ]
        print("\n" + "=" * 55 + "\n🌟 Initializing Doctor Accounts...")
        for doc in default_doctors:
            if not mongo.db.users.find_one({"username": doc['username']}):
                doc_result = mongo.db.doctors.insert_one(
                    {"name": doc['name'], "specialty": doc['specialty'], "room": doc['room'],
                     "assigned_staff_id": None})
                pw_hash = bcrypt.hashpw(doc['password'].encode('utf-8'), bcrypt.gensalt())
                mongo.db.users.insert_one({
                    "username": doc['username'], "password": pw_hash, "role": "doctor", "name": doc['name'],
                    "email": f"{doc['username']}@medisync.com", "phone": "1234567890",
                    "patient_id": None, "doctor_id": doc_result.inserted_id
                })
                print(f"✅ Created: {doc['name']} | User: {doc['username']} | Pass: {doc['password']}")
        print("=" * 55 + "\n")

        for u in mongo.db.users.find({"role": "doctor", "doctor_id": {"$exists": False}}):
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
                    for i in range(60):
                        date_str = (current + timedelta(days=i)).strftime('%Y-%m-%d')
                        for t in times:
                            mongo.db.slots.insert_one(
                                {"doctor_id": doc['_id'], "date": date_str, "time": t, "status": "available"})
                    print(f"✅ Generated 60 days of slots for {doc['name']}")
            print("✅ All doctors' calendars are fully populated.")

if __name__ == '__main__':
    init_default_data()  
    app.run(debug=True, port=5000)