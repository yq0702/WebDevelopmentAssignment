from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask.json.provider import DefaultJSONProvider
from flask_pymongo import PyMongo
from flask_cors import CORS
from bson import ObjectId
from bson.json_util import dumps, loads
from datetime import datetime
import bcrypt
from functools import wraps

# ================= 1. 初始化 Flask & MongoDB =================
app = Flask(__name__, template_folder='templates', static_folder='static')
app.secret_key = "medisync_super_secret_key_2024"
app.config["MONGO_URI"] = "mongodb://localhost:27017/medisync_db"
mongo = PyMongo(app)
CORS(app)


# 🌟 核心修复 1：自定义 JSON Provider，彻底解决 ObjectId, datetime 和 bytes 的序列化崩溃
class MongoJSONProvider(DefaultJSONProvider):
    def default(self, obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, bytes):
            return obj.decode('utf-8')  # 安全处理 bcrypt 产生的 bytes 类型
        return super().default(obj)


app.json = MongoJSONProvider(app)


# 🌟 核心修复 2：禁用浏览器缓存，确保每次加载最新的 JS 和 CSS
@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response


def parse_json(data):
    return loads(dumps(data))


# ================= 2. 权限校验装饰器 =================
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


# ================= 3. 页面路由 (渲染 HTML) =================
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


# ================= 4. 认证 API =================
@app.route('/api/auth/register', methods=['POST'])
def register_patient():
    data = request.json
    if mongo.db.users.find_one({"username": data['username']}):
        return jsonify({"success": False, "message": "Username already exists"}), 400

    pw_hash = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())
    patient_id = f"MS-{str(mongo.db.users.count_documents({})).zfill(4)}"

    mongo.db.users.insert_one({
        "username": data['username'], "password": pw_hash, "role": "patient",
        "name": data['name'], "patient_id": patient_id
    })
    return jsonify({"success": True, "message": "Registered successfully! Please login."})


@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json
    user = mongo.db.users.find_one({"username": data['username']})
    if user and bcrypt.checkpw(data['password'].encode('utf-8'), user['password']):
        session['user'] = {
            "id": str(user['_id']), "username": user['username'], "role": user['role'],
            "name": user['name'], "patient_id": user.get('patient_id')
        }
        return jsonify({"success": True, "role": user['role']})
    return jsonify({"success": False, "message": "Invalid username or password"}), 401


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"success": True})


# ================= 5. Root 专属 API =================
@app.route('/api/root/create_user', methods=['POST'])
@login_required
@role_required(['root'])
def root_create_user():
    try:
        data = request.json
        if not data: return jsonify({"success": False, "message": "Missing JSON data"}), 400

        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        name = data.get('name', '').strip()
        role = data.get('role', '').strip()

        if not all([username, password, name, role]):
            return jsonify({"success": False, "message": "All fields are required"}), 400

        if mongo.db.users.find_one({"username": username}):
            return jsonify({"success": False, "message": "Username already exists"}), 400

        pw_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
        mongo.db.users.insert_one({
            "username": username, "password": pw_hash, "role": role, "name": name, "patient_id": None
        })
        return jsonify({"success": True, "message": f"{role.capitalize()} account created successfully!"})
    except Exception as e:
        print(f"❌ Error creating user: {e}")
        return jsonify({"success": False, "message": f"Server error: {str(e)}"}), 500


@app.route('/api/root/users', methods=['GET'])
@login_required
@role_required(['root'])
def get_all_users():
    # 🌟 核心修复 3：排除 password 字段，既保护隐私又避免 bytes 序列化报错
    users = mongo.db.users.find({"role": {"$in": ["staff", "doctor", "admin", "patient"]}}, {"password": 0})
    return jsonify(list(users))


# ================= 6. 患者 API =================
# 🌟 修改：支持按科室 (specialty) 过滤医生
@app.route('/api/patient/doctors', methods=['GET'])
@login_required
@role_required(['patient', 'admin'])
def get_doctors():
    specialty = request.args.get('specialty')
    query = {}
    # 如果传入了 specialty 且不是 'all'，则加入查询条件
    if specialty and specialty.lower() != 'all':
        query['specialty'] = specialty
    doctors = list(mongo.db.doctors.find(query))
    return jsonify(doctors)


@app.route('/api/patient/slots', methods=['GET'])
@login_required
@role_required(['patient'])
def get_available_slots():
    slots = mongo.db.slots.aggregate([
        {"$match": {"status": "available"}},
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
    if any(w in symptoms for w in ['chest', 'heart', 'breath', 'palpitation']):
        recommendation = "Cardiology (Heart)"
    elif any(w in symptoms for w in ['skin', 'rash', 'itch', 'acne']):
        recommendation = "Dermatology (Skin)"
    return jsonify({"recommendation": recommendation, "disclaimer": "Guidance only, not a medical diagnosis."})


# 🌟 新增：获取患者个人设置信息
@app.route('/api/patient/profile', methods=['GET'])
@login_required
@role_required(['patient'])
def get_patient_profile():
    user = mongo.db.users.find_one({"_id": ObjectId(session['user']['id'])}, {"password": 0})
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    return jsonify(user)


# 🌟 新增：更新患者个人设置 (包含密码修改逻辑)
@app.route('/api/patient/profile', methods=['PUT'])
@login_required
@role_required(['patient'])
def update_patient_profile():
    data = request.json
    user_id = session['user']['id']

    # 安全校验：如果要修改密码，必须提供旧密码
    if data.get('password'):
        if not data.get('old_password'):
            return jsonify({"success": False, "message": "Old password is required to change password"}), 400
        user = mongo.db.users.find_one({"_id": ObjectId(user_id)})
        if not bcrypt.checkpw(data['old_password'].encode('utf-8'), user['password']):
            return jsonify({"success": False, "message": "Old password is incorrect"}), 400

    # 构建更新数据
    update_data = {
        "name": data.get('name', session['user']['name']),
        "email": data.get('email', ''),
        "phone": data.get('phone', ''),
        "profile_pic": data.get('profile_pic', ''),
        "login_method": data.get('login_method', 'username')  # 记录用户偏好的登录方式
    }

    # 如果有新密码，则加密更新
    if data.get('password'):
        update_data['password'] = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())

    mongo.db.users.update_one({"_id": ObjectId(user_id)}, {"$set": update_data})

    # 同步更新 Session 中的用户名，以便 Navbar 立即生效
    session['user']['name'] = update_data['name']

    return jsonify({"success": True, "message": "Profile updated successfully!"})


# ================= 7. 前台 Staff API (仅负责签到) =================
@app.route('/api/staff/queue', methods=['GET'])
@login_required
@role_required(['staff'])
def get_staff_queue():
    queue = mongo.db.appointments.aggregate([
        {"$match": {"status": "booked"}},
        {"$lookup": {"from": "slots", "localField": "slot_id", "foreignField": "_id", "as": "slot_info"}},
        {"$unwind": "$slot_info"}
    ])
    return jsonify(list(queue))


@app.route('/api/staff/checkin/<appt_id>', methods=['POST'])
@login_required
@role_required(['staff'])
def checkin_patient(appt_id):
    mongo.db.appointments.update_one({"_id": ObjectId(appt_id)}, {"$set": {"status": "checked-in"}})
    return jsonify({"success": True})


# ================= 8. 医生 Doctor API (负责看诊和完成) =================
@app.route('/api/doctor/queue', methods=['GET'])
@login_required
@role_required(['doctor'])
def get_doctor_queue():
    queue = mongo.db.appointments.aggregate([
        {"$match": {"status": "checked-in"}},
        {"$lookup": {"from": "slots", "localField": "slot_id", "foreignField": "_id", "as": "slot_info"}},
        {"$unwind": "$slot_info"},
        {"$lookup": {"from": "doctors", "localField": "slot_info.doctor_id", "foreignField": "_id",
                     "as": "doctor_info"}},
        {"$unwind": "$doctor_info"}
    ])
    return jsonify(list(queue))


@app.route('/api/doctor/complete/<appt_id>', methods=['POST'])
@login_required
@role_required(['doctor'])
def complete_appointment(appt_id):
    horizon = request.json.get('horizon', 'none')
    mongo.db.appointments.update_one({"_id": ObjectId(appt_id)},
                                     {"$set": {"status": "completed", "follow_up": horizon}})
    return jsonify({"success": True})


# ================= 9. 管理员 API =================
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


@app.route('/api/admin/slots', methods=['GET'])
@login_required
@role_required(['admin'])
def get_all_slots():
    slots = mongo.db.slots.aggregate([
        {"$lookup": {"from": "doctors", "localField": "doctor_id", "foreignField": "_id", "as": "doctor_info"}},
        {"$unwind": "$doctor_info"}
    ])
    return jsonify(list(slots))


@app.route('/api/admin/slots', methods=['POST'])
@login_required
@role_required(['admin'])
def add_slot():
    data = request.json
    mongo.db.slots.insert_one({
        "doctor_id": ObjectId(data['doctor_id']),
        "date": data['date'],
        "time": data['time'],
        "status": "available"
    })
    return jsonify({"success": True})


# ================= 9. 管理员 API (追加用户管理功能) =================

@app.route('/api/admin/users', methods=['GET'])
@login_required
@role_required(['admin'])
def admin_get_users():
    # 获取所有用户，排除 Root 账号，且不返回密码字段
    users = mongo.db.users.find({"role": {"$ne": "root"}}, {"password": 0})
    return jsonify(list(users))


@app.route('/api/admin/users', methods=['POST'])
@login_required
@role_required(['admin'])
def admin_create_user():
    data = request.json
    if mongo.db.users.find_one({"username": data['username']}):
        return jsonify({"success": False, "message": "Username already exists"}), 400

    pw_hash = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())
    patient_id = f"MS-{str(mongo.db.users.count_documents({})).zfill(4)}" if data['role'] == 'patient' else None

    mongo.db.users.insert_one({
        "username": data['username'], "password": pw_hash, "role": data['role'],
        "name": data['name'], "email": data.get('email', ''), "phone": data.get('phone', ''),
        "patient_id": patient_id
    })
    return jsonify({"success": True, "message": "User created successfully!"})


@app.route('/api/admin/users/<user_id>', methods=['PUT'])
@login_required
@role_required(['admin'])
def admin_update_user(user_id):
    data = request.json
    user = mongo.db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    if user['role'] == 'root':
        return jsonify({"success": False, "message": "Cannot modify Root account"}), 403

    # 检查用户名是否被其他人占用
    if mongo.db.users.find_one({"username": data['username'], "_id": {"$ne": ObjectId(user_id)}}):
        return jsonify({"success": False, "message": "Username already taken"}), 400

    update_data = {
        "name": data['name'],
        "username": data['username'],
        "email": data.get('email', ''),
        "phone": data.get('phone', ''),
        "role": data['role']
    }

    # 如果前端传了新密码，则更新密码
    if data.get('password'):
        update_data['password'] = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())

    mongo.db.users.update_one({"_id": ObjectId(user_id)}, {"$set": update_data})
    return jsonify({"success": True, "message": "User updated successfully!"})


@app.route('/api/admin/users/<user_id>', methods=['DELETE'])
@login_required
@role_required(['admin'])
def admin_delete_user(user_id):
    user = mongo.db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    if user['role'] == 'root':
        return jsonify({"success": False, "message": "Cannot delete Root account"}), 403

    mongo.db.users.delete_one({"_id": ObjectId(user_id)})
    # 可选：同时删除该用户相关的预约记录
    mongo.db.appointments.delete_many({"patient_id": user.get('patient_id')})
    return jsonify({"success": True, "message": "User deleted successfully!"})


# ================= 10. 启动服务器 =================
if __name__ == '__main__':
    app.run(debug=True, port=5000)