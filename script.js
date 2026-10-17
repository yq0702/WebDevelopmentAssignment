
async function apiRequest(url, method = 'GET', body = null) {
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);
    try {
        const res = await fetch(url, options);
        const isAuthEndpoint = url.includes('/api/auth/login') || url.includes('/api/auth/register');
        if (!isAuthEndpoint && (res.status === 401 || res.status === 403)) {
            alert("Session expired or unauthorized. Redirecting to login...");
            window.location.href = '/patient/auth';
            return null;
        }
        return await res.json();
    } catch (error) {
        console.error("API Request Failed:", error);
        return null;
    }
}

function isTimePassed(dateStr, timeStr) {
    if (!dateStr || !timeStr) return false;
    const now = new Date();
    const [time, modifier] = timeStr.split(' ');
    let [hours, minutes] = time.split(':');
    if (hours === '12') hours = '00';
    if (modifier === 'PM') hours = parseInt(hours, 10) + 12;

    const [year, month, day] = dateStr.split('-').map(Number);
    const slotDate = new Date(year, month - 1, day, hours, minutes);
    return slotDate < now;
}

let calendarCurrentDate = new Date();
let calendarSelectedDate = null;
let calendarSelectedSlotId = null;
let calendarSelectedDoctorId = null;
let allAvailableSlots = [];
let allDoctorsCache = [];

function toggleAuthForm(type) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    if (loginForm && registerForm) {
        loginForm.style.display = type === 'login' ? 'block' : 'none';
        registerForm.style.display = type === 'register' ? 'block' : 'none';
    }
}

async function handlePatientLogin() {
    const data = await apiRequest('/api/auth/login', 'POST', {
        username: document.getElementById('login-user').value,
        password: document.getElementById('login-pass').value
    });
    if (data && data.success) window.location.href = '/patient/dashboard';
    else if (data) alert(data.message);
}

async function handlePatientRegister() {
    const name = document.getElementById('reg-name').value.trim();
    const icNumber = document.getElementById('reg-ic').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const username = document.getElementById('reg-user').value.trim();
    const password = document.getElementById('reg-pass').value;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return alert("Please enter a valid email address.");
    const icRegex = /^\d{6}-?\d{2}-?\d{4}$/;
    if (!icRegex.test(icNumber)) return alert("Please enter a valid 12-digit IC Number.");

    const data = await apiRequest('/api/auth/register', 'POST', { name, ic_number: icNumber, email, username, password });
    if (data && data.success) { alert(data.message); if (typeof switchAuthTab === 'function') switchAuthTab('login'); }
    else if (data) alert(data.message);
}

async function handleStaffLogin() {
    const data = await apiRequest('/api/auth/login', 'POST', {
        username: document.getElementById('staff-user').value,
        password: document.getElementById('staff-pass').value
    });
    if (data && data.success) {
        if (data.role === 'staff') window.location.href = '/staff/dashboard';
        else if (data.role === 'doctor') window.location.href = '/doctor/dashboard';
        else if (data.role === 'admin') window.location.href = '/admin/dashboard';
        else if (data.role === 'root') window.location.href = '/root';
    } else if (data) alert(data.message);
}

async function logout() {
    await apiRequest('/api/auth/logout', 'POST');
    window.location.href = '/patient/auth';
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

async function loadPatientData() {
    const appts = await apiRequest('/api/patient/appointments');
    const tbody = document.querySelector('#patientBookingTable tbody');
    if (tbody && appts) {
        tbody.innerHTML = '';
        if (appts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No active bookings</td></tr>';
        } else {
            appts.forEach(appt => {
                const row = document.createElement('tr');
                row.className = 'row-anim';
                const bookingId = appt._id.slice(-6).toUpperCase();

                let displayStatus = appt.status.toUpperCase();
                let statusClass = appt.status === 'booked' ? 'badge-blue' : (appt.status === 'checked-in' ? 'badge-amber' : 'badge-green');
                let actionHtml = appt.status !== 'completed' ? `<button class="btn btn-outline btn-sm" onclick="cancelBooking('${appt._id}', this)" style="color: #ef4444; margin-left: 8px;"><i class="fa-solid fa-xmark"></i></button>` : '';

                if (appt.status !== 'completed' && isTimePassed(appt.slot_info.date, appt.slot_info.time)) {
                    displayStatus = 'MISSED';
                    statusClass = '';
                    actionHtml = `<span style="font-size: 0.8rem; color: var(--text-muted);">Time expired</span>`;
                }

                if (appt.status === 'completed' && (appt.prescription || appt.consultation_notes)) {
                    const safeAppt = JSON.stringify(appt).replace(/'/g, "&#39;");
                    actionHtml = `<button class="btn btn-outline btn-sm" onclick='viewPrescriptionRecord(${safeAppt})' style="color: var(--primary); border-color: var(--primary); margin-left: 8px;"><i class="fa-solid fa-eye"></i> View Record</button>`;
                }

                row.innerHTML = `
                    <td><code style="background: #f1f5f9; padding: 4px 8px; border-radius: 6px; color: var(--primary); font-weight: 700; font-size: 0.85rem; letter-spacing: 1px;">#${bookingId}</code></td>
                    <td><strong>${appt.slot_info.date}</strong> <br><span style="color:var(--text-muted); font-size:0.85rem;">${appt.slot_info.time}</span></td>
                    <td><div class="cell-user"><img src="https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=100" class="avatar avatar-sm">${appt.doctor_info.name} <br><span style="font-size:0.8rem; color:var(--primary);">${appt.doctor_info.specialty}</span></div></td>
                    <td>
                        ${statusClass ? `<span class="badge ${statusClass}">${displayStatus}</span>` : `<span class="badge" style="background: #fee2e2; color: #ef4444; font-weight: 700;">${displayStatus}</span>`}
                        ${actionHtml}
                    </td>
                `;
                tbody.appendChild(row);
            });
        }
    }

    const upcomingEl = document.getElementById('statUpcoming');
    const completedEl = document.getElementById('statCompleted');
    if (upcomingEl && completedEl && appts) {
        const validUpcoming = appts.filter(a => (a.status === 'booked' || a.status === 'checked-in') && !isTimePassed(a.slot_info.date, a.slot_info.time));
        upcomingEl.textContent = validUpcoming.length;
        completedEl.textContent = appts.filter(a => a.status === 'completed').length;
    }

    const remindersContainer = document.getElementById('upcomingRemindersCard');
    const remindersList = document.getElementById('upcomingRemindersList');

    if (remindersContainer && remindersList && appts) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const threeDaysLater = new Date(today);
        threeDaysLater.setDate(today.getDate() + 3);

        const upcomingReminders = appts.filter(a => {
            if (a.status !== 'booked' && a.status !== 'checked-in') return false;
            const apptDate = new Date(a.slot_info.date);
            return apptDate >= today && apptDate <= threeDaysLater;
        });

        if (upcomingReminders.length > 0) {
            remindersContainer.style.display = 'block';
            remindersList.innerHTML = upcomingReminders.map(appt => {
                const apptDateObj = new Date(appt.slot_info.date);
                const daysLeft = Math.ceil((apptDateObj - today) / (1000 * 60 * 60 * 24));
                const timeText = daysLeft === 0 ? 'Today' : (daysLeft === 1 ? 'Tomorrow' : `In ${daysLeft} days`);
                const monthStr = apptDateObj.toLocaleString('en-US', {month: 'short'}).toUpperCase();
                const dayStr = apptDateObj.getDate();

                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 1rem; border-radius: 8px; border: 1px solid #fcd34d; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; gap: 1rem;">
                            <div style="background: var(--accent-amber); color: white; width: 50px; height: 50px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 700; line-height: 1.1;">
                                <span style="font-size: 0.7rem;">${monthStr}</span>
                                <span style="font-size: 1.2rem;">${dayStr}</span>
                            </div>
                            <div>
                                <div style="font-weight: 700; color: var(--secondary); font-size: 1rem;">${appt.doctor_info.name}</div>
                                <div style="color: var(--text-muted); font-size: 0.85rem;">
                                    <i class="fa-regular fa-clock"></i> ${appt.slot_info.time} &nbsp;|&nbsp; 
                                    <span style="color: var(--accent-amber); font-weight: 600;">${timeText}</span>
                                </div>
                            </div>
                        </div>
                        <button class="btn btn-outline btn-sm" onclick="sendReminderEmail('${appt._id}', this)" style="color: var(--primary); border-color: var(--primary); white-space: nowrap;">
                            <i class="fa-solid fa-envelope"></i> Email Reminder
                        </button>
                    </div>
                `;
            }).join('');
        } else {
            remindersContainer.style.display = 'none';
        }
    }
}

async function runAiTriage() {
    const input = document.getElementById('aiInput').value;
    const resultBox = document.getElementById('aiResult');
    if (!input.trim()) return alert('Please describe your symptoms first.');
    resultBox.style.display = 'block';
    resultBox.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--primary);"></i> Analyzing...`;
    const data = await apiRequest('/api/patient/ai_triage', 'POST', { symptoms: input });
    if (data) {
        resultBox.innerHTML = `<strong><i class="fa-solid fa-robot"></i> AI Recommendation:</strong> We suggest booking a <strong>${data.recommendation}</strong>.<br><span style="font-size: 0.75rem; color: #64748b;">* ${data.disclaimer}</span>`;
    }
}

async function cancelBooking(apptId, btn) {
    if (!confirm('Are you sure you want to cancel this booking?')) return;
    btn.closest('tr').classList.add('row-deleting');
    const data = await apiRequest(`/api/patient/cancel/${apptId}`, 'DELETE');
    if (data && data.success) setTimeout(() => loadPatientData(), 350);
}

function openSettingsModal() {
    document.getElementById('settingsModal').classList.add('active');
    apiRequest('/api/patient/profile').then(data => {
        if (data && data._id) {
            document.getElementById('setName').value = data.name || '';
            document.getElementById('setIcNumber').value = data.ic_number || 'N/A';
            document.getElementById('setEmail').value = data.email || '';
            document.getElementById('setPhone').value = data.phone || '';
            document.getElementById('setPicUrl').value = data.profile_pic || '';
            document.getElementById('previewPic').src = data.profile_pic || 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=100';
        }
    });
}

async function saveProfile(e) {
    e.preventDefault();
    const payload = {
        name: document.getElementById('setName').value,
        email: document.getElementById('setEmail').value,
        phone: document.getElementById('setPhone').value,
        profile_pic: document.getElementById('setPicUrl').value,
        old_password: document.getElementById('setOldPass').value,
        password: document.getElementById('setNewPass').value
    };
    const data = await apiRequest('/api/patient/profile', 'PUT', payload);
    if (data && data.success) { alert(data.message); closeModal('settingsModal'); location.reload(); }
    else if (data) alert("Error: " + data.message);
}

function ensurePrescriptionModalExists() {
    if (!document.getElementById('prescriptionModal')) {
        const modalHtml = `
        <div id="prescriptionModal" class="modal-overlay">
            <div class="modal-content" style="max-width: 700px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h3 style="font-size: 1.25rem; font-weight: 700; color: var(--secondary);">
                        <i class="fa-solid fa-file-medical" style="color: var(--primary);"></i> Consultation & Prescription Record
                    </h3>
                    <span class="modal-close" onclick="closeModal('prescriptionModal')">&times;</span>
                </div>
                <div style="display: grid; gap: 1.5rem;">
                    <div style="background: #f8fafc; padding: 1.25rem; border-radius: 12px; border-left: 4px solid var(--primary);">
                        <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.5rem; text-transform: uppercase;">Consultation Notes</h4>
                        <p id="modalConsultationNotes" style="color: var(--text-main); line-height: 1.6; font-size: 0.95rem; white-space: pre-wrap;"></p>
                    </div>
                    <div style="background: #f0fdf4; padding: 1.25rem; border-radius: 12px; border-left: 4px solid var(--accent-green);">
                        <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.5rem; text-transform: uppercase;">Prescription / Medicine</h4>
                        <p id="modalPrescription" style="color: var(--text-main); line-height: 1.6; font-size: 0.95rem; white-space: pre-wrap;"></p>
                    </div>
                    <div style="text-align: right; margin-top: 1rem;">
                        <span id="modalStaffStatus" class="badge" style="font-size: 0.85rem; padding: 0.4rem 0.8rem; margin-right: 1rem;"></span>
                        <button class="btn btn-outline" onclick="closeModal('prescriptionModal')">Close</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
}

function viewPrescriptionRecord(appt) {
    ensurePrescriptionModalExists();
    document.getElementById('modalConsultationNotes').textContent = appt.consultation_notes || 'No consultation notes provided.';
    document.getElementById('modalPrescription').textContent = appt.prescription || 'No prescription provided.';

    const statusEl = document.getElementById('modalStaffStatus');
    if (appt.staff_status === 'pending') {
        statusEl.className = 'badge badge-amber';
        statusEl.textContent = 'Staff is preparing your medicine...';
    } else if (appt.staff_status === 'prepared') {
        statusEl.className = 'badge badge-blue';
        statusEl.textContent = 'Medicine is ready for pickup!';
    } else if (appt.staff_status === 'released') {
        statusEl.className = 'badge badge-green';
        statusEl.textContent = 'Released to Patient';
    } else {
        statusEl.className = 'badge badge-blue';
        statusEl.textContent = 'Completed';
    }
    document.getElementById('prescriptionModal').classList.add('active');
}

async function initCalendar() {
    let slots = await apiRequest('/api/patient/slots');
    if (slots) allAvailableSlots = slots;
    renderCalendar();
}

function changeCalendarMonth(direction) {
    calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + direction);
    renderCalendar();
}

function jumpToFuture(months) {
    calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + months);
    renderCalendar();
}

function onMonthYearChange() {
    const newMonth = parseInt(document.getElementById('monthPicker').value);
    const newYear = parseInt(document.getElementById('yearPicker').value);
    calendarCurrentDate.setFullYear(newYear);
    calendarCurrentDate.setMonth(newMonth);
    renderCalendar();
}

function renderCalendar() {
    const year = calendarCurrentDate.getFullYear();
    const month = calendarCurrentDate.getMonth();

    const monthPicker = document.getElementById('monthPicker');
    if (monthPicker && monthPicker.options.length === 0) {
        ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].forEach((name, index) => {
            const opt = document.createElement('option');
            opt.value = index; opt.textContent = name;
            monthPicker.appendChild(opt);
        });
    }
    if (monthPicker) monthPicker.value = month;

    const yearPicker = document.getElementById('yearPicker');
    const currentRealYear = new Date().getFullYear();
    if (yearPicker && yearPicker.options.length === 0) {
        for (let y = currentRealYear; y <= currentRealYear + 2; y++) {
            const opt = document.createElement('option');
            opt.value = y; opt.textContent = y;
            yearPicker.appendChild(opt);
        }
    }
    if (yearPicker) yearPicker.value = year;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    const todayStr = new Date().toISOString().split('T')[0];

    const calendarDays = document.getElementById('calendarDays');
    if (!calendarDays) return;
    calendarDays.innerHTML = '';

    for (let i = 0; i < firstDay; i++) calendarDays.innerHTML += `<div></div>`;

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        let slotsOnDate = allAvailableSlots.filter(s => s.date === dateStr);

        if (dateStr === todayStr) {
            slotsOnDate = slotsOnDate.filter(slot => !isTimePassed(slot.date, slot.time));
        }

        const hasSlots = calendarSelectedDoctorId
            ? slotsOnDate.some(s => s.doctor_info._id === calendarSelectedDoctorId)
            : slotsOnDate.length > 0;

        const isSelected = calendarSelectedDate === dateStr;
        const isToday = new Date().toDateString() === new Date(year, month, day).toDateString();
        const isPast = new Date(year, month, day) < todayMidnight;

        let classes = 'calendar-day';
        if (isSelected) classes += ' selected';
        else if (isPast) classes += ' disabled';
        else if (hasSlots) classes += ' available';
        else classes += ' no-slot';

        if (isToday && !isSelected) classes += ' today';

        const onclick = !isPast ? `selectCalendarDate('${dateStr}')` : '';
        calendarDays.innerHTML += `<div class="${classes}" onclick="${onclick}">${day}</div>`;
    }
}

function selectCalendarDate(dateStr) {
    calendarSelectedDate = dateStr;
    calendarSelectedSlotId = null;
    renderCalendar();

    const dateObj = new Date(dateStr);
    const selectedDateText = document.getElementById('selectedDateText');
    if (selectedDateText) selectedDateText.textContent = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    const container = document.getElementById('timeSlotsContainer');
    const grid = document.getElementById('timeSlotsGrid');
    if (container && grid) {
        container.style.display = 'block';
        grid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Checking...</p>`;

        setTimeout(() => {
            let slotsOnDate = allAvailableSlots.filter(s => s.date === dateStr);
            if (calendarSelectedDoctorId) slotsOnDate = slotsOnDate.filter(s => s.doctor_info._id === calendarSelectedDoctorId);

            const todayStrCheck = new Date().toISOString().split('T')[0];
            if (dateStr === todayStrCheck) slotsOnDate = slotsOnDate.filter(slot => !isTimePassed(slot.date, slot.time));

            grid.innerHTML = '';
            if (slotsOnDate.length === 0) {
                grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 1.5rem; background: #fef3c7; border-radius: 12px; border: 1px dashed #f59e0b;"><p style="color: #92400e; font-weight: 600; margin: 0;">No available slots.</p></div>`;
            } else {
                slotsOnDate.forEach(slot => {
                    const docName = slot.doctor_info ? slot.doctor_info.name : 'Doctor';
                    const docSpec = slot.doctor_info ? slot.doctor_info.specialty : '';
                    grid.innerHTML += `
                        <div class="slot-card" style="padding: 0.8rem; text-align: left; display: flex; flex-direction: column; gap: 0.2rem; cursor: pointer;" onclick="selectCalendarSlot('${slot._id}', this)">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-weight: 700; color: var(--secondary); font-size: 1rem;">${slot.time}</span>
                                <i class="fa-regular fa-clock" style="color: var(--primary);"></i>
                            </div>
                            <div style="font-size: 0.8rem; color: var(--text-muted); border-top: 1px solid #e2e8f0; padding-top: 0.4rem; margin-top: 0.2rem;">
                                <i class="fa-solid fa-user-doctor"></i> ${docName}
                            </div>
                            <div style="font-size: 0.75rem; color: var(--primary); font-weight: 600;">${docSpec}</div>
                        </div>`;
                });
            }
            updateConfirmBtn();
        }, 300);
    }
}

function selectCalendarSlot(slotId, element) {
    calendarSelectedSlotId = slotId;
    document.querySelectorAll('#timeSlotsGrid .slot-card').forEach(el => {
        el.style.borderColor = '#bae6fd';
        el.style.background = '#fff';
    });
    element.style.borderColor = 'var(--primary)';
    element.style.background = 'var(--primary-light)';
    updateConfirmBtn();
}

function updateConfirmBtn() {
    const btn = document.getElementById('confirmBookingBtn');
    if (btn) {
        if (calendarSelectedSlotId) {
            btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer';
        } else {
            btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed';
        }
    }
}

async function confirmCalendarBooking() {
    if (!calendarSelectedSlotId) return;
    const btn = document.getElementById('confirmBookingBtn');
    if (btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Booking...'; btn.disabled = true; }

    const aiSummary = document.getElementById('aiInput') ? document.getElementById('aiInput').value : 'N/A';
    const data = await apiRequest('/api/patient/book', 'POST', { slot_id: calendarSelectedSlotId, ai_summary: aiSummary });

    if (data && data.success) {
        alert('Appointment booked successfully!');
        loadPatientData(); initCalendar();
        calendarSelectedDoctorId = null; calendarSelectedSlotId = null;
        const container = document.getElementById('timeSlotsContainer');
        if (container) container.style.display = 'none';
        updateConfirmBtn();
        if (btn) btn.innerHTML = 'Confirm Booking';
    } else {
        alert('Booking failed: ' + (data?.message || 'Unknown error'));
        if (btn) { btn.innerHTML = 'Confirm Booking'; updateConfirmBtn(); }
    }
}

async function loadDoctorData() {
    const queue = await apiRequest('/api/doctor/queue');
    const tbody = document.querySelector('#doctorQueueTable tbody');
    if (!tbody || !queue) return;
    tbody.innerHTML = '';
    if (queue.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No patients in your queue.</td></tr>';
        return;
    }
    queue.forEach(item => {
        const row = document.createElement('tr');
        let statusBadge = '';
        let actionBtn = '';

        if (isTimePassed(item.slot_info.date, item.slot_info.time)) {
            statusBadge = '<span class="badge" style="background: #fee2e2; color: #ef4444; border: 1px solid #fecaca;"><i class="fa-solid fa-circle-xmark"></i> MISSED</span>';
            actionBtn = '<button class="btn btn-outline btn-sm" disabled style="opacity: 0.5; cursor: not-allowed;">Closed</button>';
        } else {
            statusBadge = item.status === 'checked-in'
                ? '<span class="badge badge-green"><i class="fa-solid fa-check"></i> Ready</span>'
                : '<span class="badge badge-amber"><i class="fa-solid fa-clock"></i> Booked</span>';

            actionBtn = item.status === 'checked-in'
                ? `<button class="btn btn-primary btn-sm" onclick="openDoctorCompletionModal('${item._id}')"><i class="fa-solid fa-stethoscope"></i> Complete & Prescribe</button>`
                : `<button class="btn btn-outline btn-sm" onclick="doctorAutoCheckin('${item._id}')" style="color: var(--primary); border-color: var(--primary);"><i class="fa-solid fa-user-check"></i> Auto Check-In</button>`;
        }

        row.innerHTML = `
            <td><div class="cell-user"><img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100" class="avatar avatar-sm">${item.patient_name || 'Unknown'}</div></td>
            <td>${item.slot_info.date}, ${item.slot_info.time}</td>
            <td>${item.ai_summary || 'No AI summary'}</td>
            <td>${statusBadge}</td>
            <td>${actionBtn}</td>
        `;
        tbody.appendChild(row);
    });
}

async function doctorAutoCheckin(apptId) {
    const data = await apiRequest(`/api/doctor/auto_checkin/${apptId}`, 'POST');
    if (data && data.success) { alert('Patient checked in successfully!'); loadDoctorData(); }
}

async function openDoctorCompletionModal(apptId) {
    if (!document.getElementById('doctorCompleteModal')) {
        const modalHtml = `
        <div id="doctorCompleteModal" class="modal-overlay">
            <div class="modal-content" style="max-width: 600px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h3 style="font-size: 1.25rem; font-weight: 700;">Complete Consultation</h3>
                    <span class="modal-close" onclick="closeModal('doctorCompleteModal')">&times;</span>
                </div>
                <div style="display: grid; gap: 1rem;">
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">Consultation Notes</label>
                        <textarea id="docNotes" class="form-input" rows="3" placeholder="Enter diagnosis and notes..."></textarea>
                    </div>
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">Prescription / Medicine</label>
                        <textarea id="docPrescription" class="form-input" rows="3" placeholder="Enter medicine name and dosage..."></textarea>
                    </div>
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">Assign to Staff (Optional)</label>
                        <select id="docAssignedStaff" class="form-input">
                            <option value="">-- No Staff Assigned --</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">Follow-Up Recommendation</label>
                        <select id="docHorizon" class="form-input">
                            <option value="none">No Follow-up Needed</option>
                            <option value="same-week">Same-week (&lt; 7 days)</option>
                            <option value="1-3-months">1-3 Months</option>
                            <option value="advanced">Advanced (1 Year)</option>
                        </select>
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1rem;">
                        <button class="btn btn-outline" onclick="closeModal('doctorCompleteModal')">Cancel</button>
                        <button class="btn btn-primary" id="btnSubmitDocComplete">Complete & Save</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        document.getElementById('btnSubmitDocComplete').onclick = () => submitDoctorCompletion(apptId);
        const staffList = await apiRequest('/api/doctor/staff_list');
        const select = document.getElementById('docAssignedStaff');
        if (staffList) {
            staffList.forEach(staff => {
                select.innerHTML += `<option value="${staff._id}">${staff.name}</option>`;
            });
        }
    }
    document.getElementById('doctorCompleteModal').classList.add('active');
}

async function submitDoctorCompletion(apptId) {
    const notes = document.getElementById('docNotes').value;
    const prescription = document.getElementById('docPrescription').value;
    const assignedStaffId = document.getElementById('docAssignedStaff').value;
    const horizon = document.getElementById('docHorizon').value;

    const data = await apiRequest(`/api/doctor/complete/${apptId}`, 'POST', {
        consultation_notes: notes,
        prescription: prescription,
        assigned_staff_id: assignedStaffId,
        horizon: horizon
    });

    if (data && data.success) {
        alert('Consultation completed and prescription recorded!');
        closeModal('doctorCompleteModal');
        loadDoctorData();
    } else {
        alert('Failed to complete: ' + (data?.message || 'Unknown error'));
    }
}

async function loadStaffData() {
    const queue = await apiRequest('/api/staff/queue');
    const tbody = document.querySelector('#staffQueueTable tbody');
    if (!tbody || !queue) return;
    tbody.innerHTML = '';
    if (queue.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No patients waiting for check-in</td></tr>';
        return;
    }
    queue.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `<td><div class="cell-user"><img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100" class="avatar avatar-sm">${item.patient_name || 'Unknown'}</div></td><td>${item.slot_info.date}, ${item.slot_info.time}</td><td><button class="btn btn-primary btn-sm" onclick="toggleAttendance('${item._id}', this)"><i class="fa-solid fa-user-check"></i> Check-In</button></td><td><span class="badge badge-amber">Waiting</span></td>`;
        tbody.appendChild(row);
    });
}

async function toggleAttendance(apptId, btn) {
    const data = await apiRequest(`/api/staff/checkin/${apptId}`, 'POST');
    if (data && data.success) { btn.closest('tr').classList.add('row-deleting'); setTimeout(() => loadStaffData(), 350); }
}

function injectStaffPrescriptionPanel() {
    const container = document.querySelector('.container');
    if (container && !document.getElementById('staffPrescriptionPanel')) {
        const panel = document.createElement('div');
        panel.id = 'staffPrescriptionPanel';
        panel.className = 'card';
        panel.style.marginTop = '1.5rem';
        panel.innerHTML = `
            <h3 class="card-title"><i class="fa-solid fa-pills" style="color: var(--accent-green);"></i> Assigned Prescriptions</h3>
            <div style="overflow-x: auto;">
                <table id="staffPrescriptionTable">
                    <thead>
                        <tr>
                            <th>Patient</th>
                            <th>Doctor</th>
                            <th>Prescription</th>
                            <th>Status</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
        `;
        container.appendChild(panel);
        loadStaffPrescriptions();
    }
}

async function loadStaffPrescriptions() {
    const prescriptions = await apiRequest('/api/staff/prescriptions');
    const tbody = document.querySelector('#staffPrescriptionTable tbody');
    if (!tbody || !prescriptions) return;

    tbody.innerHTML = '';
    if (prescriptions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No prescriptions assigned to you.</td></tr>';
        return;
    }

    prescriptions.forEach(item => {
        const row = document.createElement('tr');
        let statusBadge = '';
        let actionBtn = '';

        if (item.staff_status === 'pending') {
            statusBadge = '<span class="badge badge-amber">Pending Preparation</span>';
            actionBtn = `<button class="btn btn-outline btn-sm" onclick="updatePrescriptionStatus('${item._id}', 'prepared')" style="color: var(--primary); border-color: var(--primary);"><i class="fa-solid fa-box-open"></i> Mark Prepared</button>`;
        } else if (item.staff_status === 'prepared') {
            statusBadge = '<span class="badge badge-blue">Prepared (Ready)</span>';
            actionBtn = `<button class="btn btn-primary btn-sm" onclick="updatePrescriptionStatus('${item._id}', 'released')"><i class="fa-solid fa-paper-plane"></i> Release to Patient</button>`;
        } else {
            statusBadge = '<span class="badge badge-green">Released to Patient</span>';
            actionBtn = '<span style="color: var(--text-muted); font-size: 0.85rem;">Completed</span>';
        }

        row.innerHTML = `
            <td><strong>${item.patient_info?.name || 'Unknown'}</strong></td>
            <td>${item.doctor_info?.name || 'Unknown'}</td>
            <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item.prescription}">${item.prescription || 'N/A'}</td>
            <td>${statusBadge}</td>
            <td>${actionBtn}</td>
        `;
        tbody.appendChild(row);
    });
}

async function updatePrescriptionStatus(apptId, newStatus) {
    const data = await apiRequest(`/api/staff/prescriptions/${apptId}/status`, 'PUT', { status: newStatus });
    if (data && data.success) {
        alert(`Prescription marked as ${newStatus}!`);
        loadStaffPrescriptions();
    }
}

async function openDoctorsModal() {
    document.getElementById('doctorsModal').classList.add('active');
    const specs = await apiRequest('/api/specialties');
    const container = document.getElementById('sectorButtons');
    if (container && specs) {
        container.innerHTML = `<button class="btn btn-sm btn-primary" onclick="filterDoctors('all', this)">All Specialties</button>`;
        specs.forEach(s => { container.innerHTML += `<button class="btn btn-sm btn-outline" onclick="filterDoctors('${s.name}', this)">${s.name}</button>`; });
        filterDoctors('all', container.querySelector('.btn-primary'));
    }
}

async function filterDoctors(specialty, clickedBtn) {
    document.querySelectorAll('#sectorButtons .btn').forEach(btn => btn.className = 'btn btn-sm btn-outline');
    if (clickedBtn) clickedBtn.className = 'btn btn-sm btn-primary';

    const url = specialty === 'all' ? '/api/patient/doctors' : `/api/patient/doctors?specialty=${encodeURIComponent(specialty)}`;
    const doctors = await apiRequest(url);
    const grid = document.getElementById('doctorsGrid');
    allDoctorsCache = doctors || [];

    if (!doctors || doctors.length === 0) {
        grid.innerHTML = '<p style="text-align: center; color: var(--text-muted); grid-column: 1/-1; padding: 2rem;">No doctors found.</p>';
        return;
    }

    grid.innerHTML = doctors.map(doc => `
        <div class="doctor-card" style="flex-direction: column; align-items: flex-start; gap: 1rem; padding: 1.25rem;">
            <div style="display: flex; align-items: center; gap: 1rem; width: 100%;">
                <img src="${doc.image || 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=150'}" class="avatar avatar-md" style="width: 70px; height: 70px;">
                <div style="flex: 1;">
                    <h4 style="margin: 0; font-size: 1.1rem; font-weight: 700;">${doc.name}</h4>
                    <p style="color: var(--primary); font-size: 0.85rem; font-weight: 600; margin: 0.2rem 0;">${doc.specialty}</p>
                    <p style="color: var(--text-muted); font-size: 0.8rem; margin: 0;"><i class="fa-solid fa-location-dot"></i> ${doc.room || 'Room TBD'}</p>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; width: 100%; margin-top: 0.5rem;">
                <button class="btn btn-outline" style="padding: 0.6rem;" onclick="viewDoctorProfile('${doc._id}')">
                    <i class="fa-solid fa-user"></i> View Profile
                </button>
                <button class="btn btn-primary" style="padding: 0.6rem;" onclick="bookFromProfile('${doc._id}')">
                    <i class="fa-regular fa-calendar-check"></i> Book Now
                </button>
            </div>
        </div>
    `).join('');
}

async function viewDoctorProfile(docId) {
    const doc = allDoctorsCache.find(d => d._id === docId);
    if (!doc) return;
    const profileData = await apiRequest(`/api/patient/doctors/${docId}/profile`);

    if (!document.getElementById('doctorProfileModal')) {
        document.body.insertAdjacentHTML('beforeend', `
        <div id="doctorProfileModal" class="modal-overlay">
            <div class="modal-content" style="max-width: 800px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h3 style="font-size: 1.4rem; font-weight: 800; color: var(--secondary);"><i class="fa-solid fa-user-doctor" style="color: var(--primary);"></i> Doctor Profile</h3>
                    <span class="modal-close" onclick="closeModal('doctorProfileModal')">&times;</span>
                </div>
                <div id="doctorProfileContent"></div>
            </div>
        </div>`);
    }

    const content = document.getElementById('doctorProfileContent');
    content.innerHTML = `
        <div style="display: grid; grid-template-columns: 250px 1fr; gap: 2rem;">
            <div style="background: linear-gradient(135deg, #f0f9ff, #ffffff); border: 1px solid #bae6fd; border-radius: 12px; padding: 1.5rem; text-align: center;">
                <img src="${doc.image || 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=300'}" style="width: 180px; height: 180px; border-radius: 50%; object-fit: cover; border: 4px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-bottom: 1rem;">
                <h3 style="font-size: 1.3rem; font-weight: 700; color: var(--secondary); margin: 0.5rem 0;">${doc.name}</h3>
                <p style="color: var(--primary); font-weight: 600; margin: 0.25rem 0;">${doc.specialty}</p>
                <p style="color: var(--text-muted); font-size: 0.9rem; margin: 0.5rem 0;"><i class="fa-solid fa-location-dot"></i> ${doc.room || 'Room TBD'}</p>
                <button class="btn btn-primary" style="width: 100%; margin-top: 1rem;" onclick="bookFromProfile('${docId}'); closeModal('doctorProfileModal');">
                    <i class="fa-regular fa-calendar-check"></i> Book Appointment
                </button>
            </div>
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                <div style="background: #f8fafc; border-radius: 12px; padding: 1.5rem;">
                    <h4 style="font-size: 1.1rem; font-weight: 700; color: var(--secondary); margin-bottom: 0.75rem;"><i class="fa-solid fa-user" style="color: var(--primary); margin-right: 0.5rem;"></i> About</h4>
                    <p style="color: var(--text-muted); line-height: 1.6; font-size: 0.95rem;">${profileData?.bio || 'Dr. ' + doc.name.split(' ').pop() + ' is a dedicated ' + doc.specialty + ' professional.'}</p>
                </div>
                <div style="background: #f8fafc; border-radius: 12px; padding: 1.5rem;">
                    <h4 style="font-size: 1.1rem; font-weight: 700; color: var(--secondary); margin-bottom: 0.75rem;"><i class="fa-solid fa-graduation-cap" style="color: var(--primary); margin-right: 0.5rem;"></i> Education</h4>
                    <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem;">
                        <li style="display: flex; align-items: center; gap: 0.5rem; color: var(--text-muted); font-size: 0.9rem;"><i class="fa-solid fa-check-circle" style="color: var(--accent-green);"></i> MBBS - Bachelor of Medicine</li>
                        <li style="display: flex; align-items: center; gap: 0.5rem; color: var(--text-muted); font-size: 0.9rem;"><i class="fa-solid fa-check-circle" style="color: var(--accent-green);"></i> MD in ${doc.specialty}</li>
                    </ul>
                </div>
            </div>
        </div>
    `;
    document.getElementById('doctorProfileModal').classList.add('active');
}

function bookFromProfile(docId) {
    calendarSelectedDoctorId = docId;
    closeModal('doctorsModal');
    const calendarSection = document.getElementById('calendarContainer');
    if (calendarSection) calendarSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    renderCalendar();
    const container = document.getElementById('timeSlotsContainer');
    const grid = document.getElementById('timeSlotsGrid');
    if (container && grid) {
        container.style.display = 'block';
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 1.5rem; background: var(--primary-light); border-radius: 12px; border: 1px solid var(--primary);"><i class="fa-solid fa-arrow-up" style="font-size: 1.5rem; color: var(--primary); margin-bottom: 0.5rem; display: block;"></i><p style="color: var(--primary); font-weight: 700; margin: 0;">Please select a highlighted date</p></div>`;
    }
    updateConfirmBtn();
}

async function loadAdminData() {
    const stats = await apiRequest('/api/admin/stats');
    if (stats) {
        document.getElementById('stat-users').textContent = stats.total_users;
        document.getElementById('stat-bookings').textContent = stats.active_bookings;
        document.getElementById('stat-visits').textContent = stats.completed;
        document.getElementById('stat-slots').textContent = stats.available_slots;
    }
}
async function loadDoctorsForAdmin() {
    const doctors = await apiRequest('/api/patient/doctors');
    const select = document.getElementById('adminDoctor');
    if (select && doctors) {
        select.innerHTML = '<option value="">Assign Doctor</option>';
        doctors.forEach(doc => { select.innerHTML += `<option value="${doc._id}">${doc.name} (${doc.specialty})</option>`; });
    }
}
async function handleAdminAddSlot(e) {
    e.preventDefault();
    const doctorId = document.getElementById('adminDoctor').value;
    const date = document.getElementById('adminSlotDate').value;
    const time = document.getElementById('adminSlotTime').value;
    if (!doctorId || !date || !time) return alert('Please fill all fields.');
    const data = await apiRequest('/api/admin/slots', 'POST', { doctor_id: doctorId, date, time });
    if (data && data.success) { alert('Slot added!'); loadAdminData(); } else if (data) alert(data.message);
}

let allAdminUsersCache = [];
async function loadAdminUsers() {
    const users = await apiRequest('/api/admin/users');
    if (!users) return;
    allAdminUsersCache = users;
    filterAdminUsers();
}
function filterAdminUsers() {
    const searchTerm = document.getElementById('userSearchInput').value.toLowerCase();
    const roleFilter = document.getElementById('userRoleFilter').value;
    const tbody = document.querySelector('#adminUsersTable tbody');
    if (!tbody) return;
    const filteredUsers = allAdminUsersCache.filter(u => {
        const matchesName = u.name.toLowerCase().includes(searchTerm);
        const matchesRole = roleFilter === 'all' || u.role === roleFilter;
        return matchesName && matchesRole;
    });
    tbody.innerHTML = '';
    if (filteredUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No users found.</td></tr>';
        return;
    }
    filteredUsers.forEach(u => {
        const roleColor = u.role === 'admin' ? 'badge-purple' : (u.role === 'doctor' ? 'badge-green' : (u.role === 'staff' ? 'badge-blue' : 'badge-amber'));
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${u.name}</strong></td>
            <td>${u.username}</td>
            <td><div style="font-size: 0.85rem;">${u.email || 'No email'}</div><div style="font-size: 0.8rem; color: var(--text-muted);">${u.phone || 'No phone'}</div></td>
            <td><span class="badge ${roleColor}">${u.role}</span></td>
            <td>
                <button class="btn btn-outline btn-sm" onclick='openUserModal(${JSON.stringify(u)})' style="margin-right: 5px;"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="btn btn-outline btn-sm" onclick="deleteAdminUser('${u._id}', '${u.name}')" style="color: #ef4444; border-color: #fecaca;"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function toggleDoctorFields(role) {
    const doctorFields = document.getElementById('doctorFields');
    const specialtyInput = document.getElementById('editDocSpecialty');
    const roomInput = document.getElementById('editDocRoom');
    if (role === 'doctor') {
        doctorFields.style.display = 'block';
        specialtyInput.required = true; roomInput.required = true;
    } else {
        doctorFields.style.display = 'none';
        specialtyInput.required = false; roomInput.required = false;
        specialtyInput.value = ''; roomInput.value = '';
    }
}

async function openUserModal(user = null) {
    const modal = document.getElementById('userModal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('userForm');
    form.reset();
    document.getElementById('editUserId').value = '';
    document.getElementById('editPassword').placeholder = 'Password *';
    document.getElementById('editPassword').required = true;
    toggleDoctorFields('patient');

    if (user) {
        title.textContent = 'Edit User';
        document.getElementById('editUserId').value = user._id;
        document.getElementById('editName').value = user.name;
        document.getElementById('editUsername').value = user.username;
        document.getElementById('editEmail').value = user.email || '';
        document.getElementById('editPhone').value = user.phone || '';
        document.getElementById('editRole').value = user.role;
        toggleDoctorFields(user.role);
        document.getElementById('editPassword').placeholder = 'Leave blank to keep current password';
        document.getElementById('editPassword').required = false;
    } else {
        title.textContent = 'Add New User';
    }
    modal.classList.add('active');
    await loadSpecialties();
}
function closeUserModal() { document.getElementById('userModal').classList.remove('active'); }

async function saveUser(e) {
    e.preventDefault();
    const userId = document.getElementById('editUserId').value;
    const role = document.getElementById('editRole').value;
    let specialty = '';
    if (role === 'doctor') {
        const specEl = document.getElementById('editDocSpecialty');
        specialty = specEl ? specEl.value : '';
    }
    const payload = {
        name: document.getElementById('editName').value,
        username: document.getElementById('editUsername').value,
        email: document.getElementById('editEmail').value,
        phone: document.getElementById('editPhone').value,
        role: role,
        password: document.getElementById('editPassword').value,
        specialty: specialty,
        room: document.getElementById('editDocRoom') ? document.getElementById('editDocRoom').value : ''
    };
    let url = '/api/admin/users';
    let method = 'POST';
    if (userId) { url = `/api/admin/users/${userId}`; method = 'PUT'; }

    const data = await apiRequest(url, method, payload);
    if (data && data.success) {
        alert(data.message);
        closeUserModal();
        loadAdminUsers();
        if (role === 'doctor' && !userId) loadDoctorManagement();
    } else if (data) {
        alert("Error: " + data.message);
    }
}

async function deleteAdminUser(userId, userName) {
    if (!confirm(`Are you sure you want to delete user "${userName}"?`)) return;
    const data = await apiRequest(`/api/admin/users/${userId}`, 'DELETE');
    if (data && data.success) { alert(data.message); loadAdminUsers(); }
    else if (data) alert("Error: " + data.message);
}

async function createStaffUser() {
    const nameEl = document.getElementById('root-name'); const userEl = document.getElementById('root-user');
    const passEl = document.getElementById('root-pass'); const roleEl = document.getElementById('root-role');
    if (!nameEl || !userEl || !passEl || !roleEl) return alert("Error: Cannot find form elements.");
    const name = nameEl.value.trim(); const username = userEl.value.trim();
    const password = passEl.value.trim(); const role = roleEl.value;
    if (!name || !username || !password) return alert("Please fill in all fields.");
    const data = await apiRequest('/api/root/create_user', 'POST', { name, username, password, role });
    if (data && data.success) { alert(data.message); nameEl.value = ''; userEl.value = ''; passEl.value = ''; loadRootUsers(); }
    else if (data) alert("Failed: " + data.message);
}
async function loadRootUsers() {
    const users = await apiRequest('/api/root/users');
    const tbody = document.querySelector('#usersTable tbody');
    if (!tbody || !users) return;
    tbody.innerHTML = '';
    users.forEach(u => {
        const roleColor = u.role === 'admin' ? 'badge-purple' : (u.role === 'doctor' ? 'badge-green' : (u.role === 'staff' ? 'badge-blue' : 'badge-amber'));
        tbody.innerHTML += `<tr><td>${u.name}</td><td>${u.username}</td><td><span class="badge ${roleColor}">${u.role}</span></td></tr>`;
    });
}

async function loadSpecialties() {
    const specs = await apiRequest('/api/specialties');
    if (!specs) return [];
    const listDiv = document.getElementById('specialtiesList');
    if (listDiv) {
        listDiv.innerHTML = specs.map(s => `
            <span class="badge badge-blue" style="padding: 0.5rem 1rem; font-size: 0.85rem; gap: 8px; cursor: default;">
                ${s.name}
                <i class="fa-solid fa-xmark" style="cursor: pointer; opacity: 0.7; margin-left: 4px;" onclick="deleteSpecialty('${s._id}')"></i>
            </span>
        `).join('');
    }
    const selects = document.querySelectorAll('.specialty-select');
    selects.forEach(select => {
        const currentVal = select.value;
        select.innerHTML = '<option value="">-- Select Specialty --</option>';
        specs.forEach(s => { select.innerHTML += `<option value="${s.name}">${s.name}</option>`; });
        if (currentVal) select.value = currentVal;
    });
    return specs;
}
async function addSpecialty() {
    const input = document.getElementById('newSpecialtyName');
    const name = input.value.trim();
    if (!name) return alert('Please enter a specialty name.');
    const data = await apiRequest('/api/admin/specialties', 'POST', { name });
    if (data && data.success) { input.value = ''; loadSpecialties(); }
    else if (data) alert(data.message);
}
async function deleteSpecialty(id) {
    if (!confirm('Delete this specialty?')) return;
    const data = await apiRequest(`/api/admin/specialties/${id}`, 'DELETE');
    if (data && data.success) loadSpecialties();
}

function switchAdminTab(tabName, navElement) {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    if (navElement) navElement.classList.add('active');
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
    const targetPanel = document.getElementById(`tab-${tabName}`);
    if (targetPanel) targetPanel.classList.add('active');

    if (tabName === 'dashboard') loadAdminData();
    if (tabName === 'users') loadAdminUsers();
    if (tabName === 'doctors') { loadDoctorManagement(); loadSpecialties(); }
    if (tabName === 'schedule') { loadDoctorsForAdmin(); loadUnavailableTimes(); }
}

async function loadDoctorManagement() {
    const doctors = await apiRequest('/api/admin/doctors');
    const tbody = document.querySelector('#adminDoctorsTable tbody');
    if (!tbody || !doctors) return;
    tbody.innerHTML = '';
    if (doctors.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No doctors found.</td></tr>';
        return;
    }
    doctors.forEach(doc => {
        const staffName = doc.staff_info ? doc.staff_info.name : '<span style="color: var(--text-muted);">Unassigned</span>';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${doc.name}</strong></td>
            <td>${doc.specialty}</td>
            <td>${doc.room || 'TBD'}</td>
            <td>${staffName}</td>
            <td>
                <button class="btn btn-outline btn-sm" onclick='openEditDoctorModal(${JSON.stringify(doc)})' style="margin-right: 5px;" title="Edit Details"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-outline btn-sm" onclick='openAssignStaffModal("${doc._id}", "${doc.name}")' style="margin-right: 5px;" title="Assign Staff"><i class="fa-solid fa-user-nurse"></i></button>
                <button class="btn btn-outline btn-sm" onclick="viewDoctorUnavailable('${doc._id}')" title="View Off-Time Requests"><i class="fa-solid fa-calendar-xmark"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function openEditDoctorModal(doc) {
    document.getElementById('editDocId').value = doc._id;
    document.getElementById('editDocName').value = doc.name;
    document.getElementById('editDocRoom').value = doc.room || '';
    document.getElementById('editDoctorModal').classList.add('active');
    await loadSpecialties();
    document.getElementById('editDocSpecialtyModal').value = doc.specialty || '';
}

async function saveDoctorDetails(e) {
    e.preventDefault();
    const docId = document.getElementById('editDocId').value;
    const payload = {
        name: document.getElementById('editDocName').value,
        specialty: document.getElementById('editDocSpecialtyModal').value,
        room: document.getElementById('editDocRoom').value
    };
    const data = await apiRequest(`/api/admin/doctors/${docId}`, 'PUT', payload);
    if (data && data.success) {
        alert(data.message);
        closeModal('editDoctorModal');
        loadDoctorManagement();
    }
}

async function openAssignStaffModal(docId, docName) {
    document.getElementById('assignDocId').value = docId;
    document.getElementById('assignDocNameDisplay').textContent = docName;
    const staffList = await apiRequest('/api/admin/staff_list');
    const select = document.getElementById('assignStaffSelect');
    select.innerHTML = '<option value="">-- Select Staff Member --</option>';
    if (staffList) {
        staffList.forEach(staff => { select.innerHTML += `<option value="${staff._id}">${staff.name} (${staff.username})</option>`; });
    }
    document.getElementById('assignStaffModal').classList.add('active');
}

async function saveStaffAssignment(e) {
    e.preventDefault();
    const docId = document.getElementById('assignDocId').value;
    const staffId = document.getElementById('assignStaffSelect').value;
    const data = await apiRequest(`/api/admin/doctors/${docId}/assign_staff`, 'PUT', { staff_id: staffId });
    if (data && data.success) {
        alert(data.message);
        closeModal('assignStaffModal');
        loadDoctorManagement();
    }
}

async function loadUnavailableTimes() {
    const times = await apiRequest('/api/admin/unavailable_times');
    const tbody = document.querySelector('#adminUnavailableTable tbody');
    if (!tbody || !times) return;
    tbody.innerHTML = '';
    if (times.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No pending requests.</td></tr>';
        return;
    }
    times.forEach(item => {
        const statusColor = item.status === 'approved' ? 'badge-green' : (item.status === 'rejected' ? 'badge-amber' : 'badge-blue');
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${item.doctor_info.name}</strong></td>
            <td>${item.date}</td>
            <td>${item.reason}</td>
            <td><span class="badge ${statusColor}">${item.status.toUpperCase()}</span></td>
            <td>
                ${item.status === 'pending' ? `
                    <button class="btn btn-outline btn-sm" onclick="updateUnavailableStatus('${item._id}', 'approved')" style="color: var(--accent-green); border-color: var(--accent-green);"><i class="fa-solid fa-check"></i></button>
                    <button class="btn btn-outline btn-sm" onclick="updateUnavailableStatus('${item._id}', 'rejected')" style="color: #ef4444; border-color: #fecaca;"><i class="fa-solid fa-xmark"></i></button>
                ` : ''}
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function updateUnavailableStatus(timeId, status) {
    const data = await apiRequest(`/api/admin/unavailable_times/${timeId}/status`, 'PUT', { status });
    if (data && data.success) loadUnavailableTimes();
}

function viewDoctorUnavailable(docId) {
    document.getElementById('unavailableModal').classList.add('active');
    loadUnavailableTimesInModal(docId);
}

async function loadUnavailableTimesInModal(docId) {
    const times = await apiRequest('/api/admin/unavailable_times');
    const listDiv = document.getElementById('unavailableList');
    if (!times) return;
    const filtered = times.filter(t => t.doctor_info._id === docId);
    if (filtered.length === 0) {
        listDiv.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No off-time requests for this doctor.</p>';
        return;
    }
    listDiv.innerHTML = filtered.map(item => `
        <div style="background: var(--bg-body); padding: 1rem; border-radius: 8px; margin-bottom: 0.8rem; border-left: 4px solid ${item.status === 'approved' ? 'var(--accent-green)' : (item.status === 'rejected' ? '#ef4444' : 'var(--primary)')}">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <strong>${item.date}</strong>
                <span class="badge ${item.status === 'approved' ? 'badge-green' : (item.status === 'rejected' ? 'badge-amber' : 'badge-blue')}">${item.status.toUpperCase()}</span>
            </div>
            <p style="font-size: 0.9rem; color: var(--text-muted); margin: 0;"><strong>Reason:</strong> ${item.reason}</p>
        </div>
    `).join('');
}

async function sendReminderEmail(apptId, btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
    btn.disabled = true;

    const data = await apiRequest(`/api/patient/send_reminder/${apptId}`, 'POST');

    if (data && data.success) {
        const tempMsg = document.createElement('div');
        tempMsg.textContent = data.message;
        tempMsg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: var(--accent-green); color: white; padding: 1rem 1.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 9999; animation: fadeIn 0.3s ease;';
        document.body.appendChild(tempMsg);
        setTimeout(() => tempMsg.remove(), 3000);

        btn.innerHTML = '<i class="fa-solid fa-check"></i> Sent';
        btn.style.color = 'var(--accent-green)';
        btn.style.borderColor = 'var(--accent-green)';
        btn.style.cursor = 'default';
    } else {
        alert('Failed to send reminder: ' + (data?.message || 'Unknown error'));
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    if (path.includes('/patient/dashboard')) {
        loadPatientData();
        initCalendar();
    } else if (path.includes('/staff/dashboard')) {
        loadStaffData();
        injectStaffPrescriptionPanel(); 
    } else if (path.includes('/doctor/dashboard')) {
        loadDoctorData();
    } else if (path.includes('/admin/dashboard')) {
        loadAdminData();
    } else if (path.includes('/root')) {
        loadRootUsers();
    }
});