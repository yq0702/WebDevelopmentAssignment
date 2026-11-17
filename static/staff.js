let staffAppointments = [];
let visibleStaffAppointments = [];
let selectedStaffAppointment = null;
let currentView = 'active';

document.addEventListener("DOMContentLoaded", function () {
    showCurrentDate();

    document.getElementById("staffSearch").addEventListener("input", renderStaffQueue);
    document.getElementById("staffAiFilter").addEventListener("change", renderStaffQueue);
    document.getElementById("staffSort").addEventListener("change", renderStaffQueue);

    const viewFilterEl = document.getElementById("staffViewFilter");
    if (viewFilterEl) {
        viewFilterEl.addEventListener("change", function() {
            currentView = this.value;
            renderStaffQueue();
        });
    }

    refreshStaffDashboard();
});

async function refreshStaffDashboard() {
    await loadStaffQueue();
}

async function loadStaffQueue() {
    const body = document.getElementById("staffQueueBody");
    body.innerHTML = `<tr><td colspan="5" class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>`;

    try {
        const response = await fetch("/api/staff/queue");
        if (response.status === 401 || response.status === 403) {
            window.location.href = "/staff/auth";
            return;
        }
        if (!response.ok) throw new Error("Unable to load appointments.");

        staffAppointments = await response.json();
        updateStaffStatistics();
        renderStaffQueue();
    } catch (error) {
        console.error(error);
        staffAppointments = [];
        body.innerHTML = `<tr><td colspan="5" class="empty-state error-text"><i class="fa-solid fa-triangle-exclamation"></i><strong>Unable to load queue.</strong><span>Please check server connection.</span></td></tr>`;
    }
}

function updateStaffStatistics() {
    const activeAppointments = staffAppointments.filter(a =>
        a.status === 'booked' ||
        a.status === 'checked-in' ||
        (a.status === 'completed' && a.staff_status !== 'dispensed')
    );

    const aiCount = activeAppointments.filter(hasAISummary).length;
    const waitingCount = activeAppointments.filter(a => a.status === 'booked' || a.status === 'checked-in').length;
    const dispensingCount = activeAppointments.filter(a => a.status === 'completed' && a.prescription && a.staff_status !== 'dispensed').length;

    document.getElementById("waitingCount").textContent = waitingCount;

    const dispensingEl = document.getElementById("dispensingCount");
    if (dispensingEl) dispensingEl.textContent = dispensingCount;

    document.getElementById("staffAiCount").textContent = aiCount;
    document.getElementById("visibleCount").textContent = visibleStaffAppointments.length;
}

function renderStaffQueue() {
    const body = document.getElementById("staffQueueBody");
    const search = document.getElementById("staffSearch").value.trim().toLowerCase();
    const aiFilter = document.getElementById("staffAiFilter").value;
    const sort = document.getElementById("staffSort").value;

    visibleStaffAppointments = staffAppointments.filter(function (appointment) {
        const searchText = `${appointment.patient_name || ""} ${appointment.patient_id || ""}`.toLowerCase();
        const searchMatch = !search || searchText.includes(search);

        let aiMatch = true;
        if (aiFilter === "ai") aiMatch = hasAISummary(appointment);
        if (aiFilter === "no-ai") aiMatch = !hasAISummary(appointment);

        let viewMatch = false;
        if (currentView === 'active') {
            if (appointment.status === 'booked' || appointment.status === 'checked-in') {
                viewMatch = true;
            } else if (appointment.status === 'completed' && appointment.staff_status !== 'dispensed') {
                viewMatch = true;
            }
        } else if (currentView === 'history') {
            if (appointment.status === 'completed' && appointment.staff_status === 'dispensed') {
                viewMatch = true;
            }
        }

        return searchMatch && aiMatch && viewMatch;
    });

    if (sort === "name") {
        visibleStaffAppointments.sort((a, b) => String(a.patient_name || "").localeCompare(String(b.patient_name || "")));
    }
    if (sort === "date") {
        visibleStaffAppointments.sort((a, b) => getAppointmentSortValue(a).localeCompare(getAppointmentSortValue(b)));
    }

    document.getElementById("visibleCount").textContent = visibleStaffAppointments.length;

    if (visibleStaffAppointments.length === 0) {
        const msg = currentView === 'active' ? "No active patients." : "No history records found.";
        body.innerHTML = `<tr><td colspan="5" class="empty-state"><i class="fa-solid fa-circle-check"></i><strong>${msg}</strong></td></tr>`;
        return;
    }

    body.innerHTML = visibleStaffAppointments.map(function (appointment) {
        const slot = appointment.slot_info || {};
        const doctor = appointment.doctor_info || {};
        const aiSummary = hasAISummary(appointment) ? appointment.ai_summary : "No AI consultation provided";

        let statusBadge = '';
        let actionBtn = '';

        if (appointment.status === 'completed') {
            if (appointment.staff_status === 'dispensed') {
                statusBadge = '<span class="queue-status" style="background: #d1fae5; color: #065f46;"><i class="fa-solid fa-check-circle"></i> Dispensed</span>';
                actionBtn = `<button class="btn btn-outline btn-sm" onclick='openStaffModal("${appointment._id}")'><i class="fa-solid fa-print"></i> View & Print</button>`;
            } else if (appointment.prescription) {
                statusBadge = '<span class="queue-status" style="background: #fef3c7; color: #92400e;"><i class="fa-solid fa-pills"></i> Pending Dispensing</span>';
                actionBtn = `<button class="btn btn-primary btn-sm" onclick='openStaffModal("${appointment._id}")'><i class="fa-solid fa-eye"></i> View & Dispense</button>`;
            } else {
                statusBadge = '<span class="queue-status" style="background: #d1fae5; color: #065f46;"><i class="fa-solid fa-check-circle"></i> Completed</span>';
                actionBtn = `<button class="btn btn-outline btn-sm" onclick='openStaffModal("${appointment._id}")'><i class="fa-solid fa-print"></i> View & Print</button>`;
            }
        } else {
            // Booked or Checked-in
            statusBadge = appointment.status === 'checked-in'
                ? '<span class="queue-status" style="background: #dbeafe; color: #1e40af;"><i class="fa-solid fa-user-check"></i> Checked-in</span>'
                : '<span class="queue-status queue-booked"><i class="fa-solid fa-calendar-check"></i> Booked</span>';

            actionBtn = `<button class="btn btn-outline btn-sm" onclick='openStaffModal("${appointment._id}")' title="View Details"><i class="fa-solid fa-eye"></i></button>`;
        }

        return `
            <tr>
                <td>
                    <button class="patient-name-button" onclick="openStaffModal('${appointment._id}')">
                        <span class="patient-avatar">${getInitials(appointment.patient_name || "Patient")}</span>
                        <span>
                            <strong>${escapeHTML(appointment.patient_name || "Patient")}</strong>
                            <small>${escapeHTML(appointment.patient_id || "N/A")}</small>
                        </span>
                    </button>
                </td>
                <td>
                    <strong>${escapeHTML(slot.date || "N/A")}</strong>
                    <small class="table-secondary-text">${escapeHTML(slot.time || "N/A")}</small>
                </td>
                <td>
                    <div class="ai-summary-box">
                        <i class="fa-solid fa-wand-magic-sparkles"></i>
                        <span>${escapeHTML(aiSummary)}</span>
                    </div>
                </td>
                <td>${statusBadge}</td>
                <td>
                    <div class="table-actions">
                        ${actionBtn}
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

function openStaffModal(appointmentId) {
    selectedStaffAppointment = staffAppointments.find(function (appointment) {
        return String(appointment._id) === String(appointmentId);
    });

    if (!selectedStaffAppointment) return;

    const slot = selectedStaffAppointment.slot_info || {};
    const doctor = selectedStaffAppointment.doctor_info || {};

    document.getElementById("staffModalName").textContent = selectedStaffAppointment.patient_name || "Patient";
    document.getElementById("staffModalPatientId").textContent = selectedStaffAppointment.patient_id || "N/A";
    document.getElementById("staffModalDate").textContent = slot.date || "N/A";
    document.getElementById("staffModalTime").textContent = slot.time || "N/A";
    document.getElementById("staffModalStatus").textContent = (selectedStaffAppointment.status || "Booked").toUpperCase();

    document.getElementById("staffModalDoctor").textContent = doctor.name || "N/A";
    document.getElementById("staffModalSpecialty").textContent = doctor.specialty || "N/A";
    document.getElementById("staffModalAi").textContent = hasAISummary(selectedStaffAppointment) ? selectedStaffAppointment.ai_summary : "No AI consultation provided.";
    document.getElementById("staffModalNotes").textContent = selectedStaffAppointment.consultation_notes || "No consultation notes provided.";
    document.getElementById("staffModalPrescription").textContent = selectedStaffAppointment.prescription || "No prescription provided.";

    const checkInBtn = document.getElementById("staffModalCheckInButton");
    const dispenseBtn = document.getElementById("staffModalDispenseButton");

    if (checkInBtn) {
        if (selectedStaffAppointment.status === 'booked') {
            checkInBtn.style.display = 'inline-block';
            checkInBtn.onclick = function () { checkInPatient(selectedStaffAppointment._id, checkInBtn); };
        } else {
            checkInBtn.style.display = 'none';
        }
    }

    if (dispenseBtn) {
        if (selectedStaffAppointment.status === 'completed' && selectedStaffAppointment.prescription) {
            if (selectedStaffAppointment.staff_status === 'dispensed') {
                dispenseBtn.innerHTML = '<i class="fa-solid fa-check"></i> Already Dispensed';
                dispenseBtn.disabled = true;
                dispenseBtn.className = 'btn btn-outline';
                dispenseBtn.style.display = 'inline-block';
            } else {
                dispenseBtn.innerHTML = '<i class="fa-solid fa-hand-holding-medical"></i> Mark as Dispensed';
                dispenseBtn.disabled = false;
                dispenseBtn.className = 'btn btn-primary';
                dispenseBtn.onclick = function () { markAsDispensed(selectedStaffAppointment._id, dispenseBtn); };
                dispenseBtn.style.display = 'inline-block';
            }
        } else {
            dispenseBtn.style.display = 'none';
        }
    }

    document.getElementById("staffPatientModal").classList.add("active");
}

function closeStaffModal() {
    document.getElementById("staffPatientModal").classList.remove("active");
    selectedStaffAppointment = null;
}

async function checkInPatient(appointmentId, button) {
    const confirmed = confirm("Confirm that this patient has arrived and should be checked in?");
    if (!confirmed) return;

    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking In...`;

    try {
        const response = await fetch(`/api/staff/checkin/${appointmentId}`, { method: "POST" });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error("Check-in failed.");

        closeStaffModal();
        showStaffMessage("Patient checked in successfully.", "success");
        await loadStaffQueue();
    } catch (error) {
        console.error(error);
        showStaffMessage("Unable to check in patient.", "error");
        button.disabled = false;
        button.innerHTML = original;
    }
}

async function markAsDispensed(appointmentId, button) {
    const confirmed = confirm("Confirm that the prescription has been dispensed to the patient?");
    if (!confirmed) return;

    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing...`;

    try {
        const response = await fetch(`/api/staff/mark_dispensed/${appointmentId}`, { method: "POST" });
        const result = await response.json();

        if (!response.ok || !result.success) throw new Error(result.message || "Failed to update status.");

        showStaffMessage("Prescription marked as dispensed!", "success");
        closeStaffModal();
        await loadStaffQueue();
    } catch (error) {
        console.error(error);
        showStaffMessage("Unable to update status.", "error");
        button.disabled = false;
        button.innerHTML = original;
    }
}

function exportStaffCSV() {
    if (visibleStaffAppointments.length === 0) {
        alert("There are no appointments to export.");
        return;
    }
    const rows = [["Patient", "Patient ID", "Doctor", "Date", "Time", "Status", "Prescription", "AI Summary"]];
    visibleStaffAppointments.forEach(function (appointment) {
        const slot = appointment.slot_info || {};
        const doctor = appointment.doctor_info || {};
        rows.push([
            appointment.patient_name || "", appointment.patient_id || "", doctor.name || "N/A",
            slot.date || "", slot.time || "", appointment.status || "Booked",
            appointment.prescription || "N/A", appointment.ai_summary || "N/A"
        ]);
    });
    downloadCSV(rows, "MediSync_Staff_Queue.csv");
}

function printStaffQueue() {
    const newWindow = window.open("", "_blank");
    const rows = visibleStaffAppointments.map(function (appointment) {
        const slot = appointment.slot_info || {};
        const doctor = appointment.doctor_info || {};
        return `<tr>
            <td>${escapeHTML(appointment.patient_name || "Patient")}</td>
            <td>${escapeHTML(appointment.patient_id || "N/A")}</td>
            <td>${escapeHTML(doctor.name || "N/A")}</td>
            <td>${escapeHTML(slot.date || "N/A")}</td>
            <td>${escapeHTML(slot.time || "N/A")}</td>
            <td>${escapeHTML(appointment.status || "Booked")}</td>
        </tr>`;
    }).join("");

    newWindow.document.write(`
        <html><head><title>MediSync Staff Queue</title>
        <style>body { font-family: Arial; padding: 30px; } table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #ddd; padding: 10px; text-align: left; } th { background: #f1f5f9; }</style>
        </head><body><h1>MediSync Patient Service Queue</h1>
        <table><thead><tr><th>Patient</th><th>Patient ID</th><th>Doctor</th><th>Date</th><th>Time</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody></table></body></html>
    `);
    newWindow.document.close();
    newWindow.print();
}

function printStaffPrescription() {
    if (!selectedStaffAppointment) return;
    const appt = selectedStaffAppointment;
    const slot = appt.slot_info || {};
    const doctor = appt.doctor_info || {};

    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
        <html><head><title>Visit Summary</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
            .header { text-align: center; border-bottom: 2px solid #0284c7; padding-bottom: 20px; margin-bottom: 30px; }
            .section { margin-bottom: 25px; }
            .label { font-weight: bold; color: #0284c7; margin-bottom: 5px; display: block; }
            .value { background: #f8fafc; padding: 15px; border-radius: 8px; border-left: 4px solid #0284c7; white-space: pre-wrap; }
            .footer { margin-top: 50px; text-align: center; font-size: 0.8rem; color: #666; border-top: 1px solid #ddd; padding-top: 20px; }
        </style></head><body>
        <div class="header">
            <h1>MediSync - Visit Summary</h1>
            <p>Date: ${slot.date || 'N/A'} | Time: ${slot.time || 'N/A'}</p>
        </div>
        <div class="section">
            <span class="label">Patient Name:</span>
            <div class="value">${appt.patient_name || 'N/A'} (ID: ${appt.patient_id || 'N/A'})</div>
        </div>
        <div class="section">
            <span class="label">Attending Doctor:</span>
            <div class="value">${doctor.name || 'N/A'} - ${doctor.specialty || 'N/A'}</div>
        </div>
        <div class="section">
            <span class="label">Consultation Notes:</span>
            <div class="value">${appt.consultation_notes || 'No notes provided.'}</div>
        </div>
        <div class="section">
            <span class="label">Prescription / Medicine:</span>
            <div class="value" style="border-left-color: #10b981;">${appt.prescription || 'No prescription provided.'}</div>
        </div>
        <div class="footer">
            <p>This is an official medical summary generated by MediSync.</p>
            <p>Please follow the doctor's instructions carefully.</p>
        </div>
        </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
}

function hasAISummary(appointment) {
    const summary = String(appointment.ai_summary || "").trim();
    return summary !== "" && summary.toUpperCase() !== "N/A";
}

function getAppointmentSortValue(appointment) {
    const slot = appointment.slot_info || {};
    return `${slot.date || ""} ${slot.time || ""}`;
}

function showCurrentDate() {
    document.getElementById("staffCurrentDate").textContent = new Date().toLocaleDateString(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
}

function showStaffMessage(message, type) {
    const box = document.getElementById("staffMessage");
    box.textContent = message;
    box.className = `status-message ${type}`;
    setTimeout(function () { box.textContent = ""; box.className = "status-message"; }, 3500);
}

async function logoutUser() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/staff/auth";
}

function getInitials(name) {
    return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("");
}

function downloadCSV(rows, filename) {
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

function escapeHTML(value) {
    const div = document.createElement("div");
    div.textContent = String(value);
    return div.innerHTML;
}

// ======================================================
// 🌟 WALK-IN REGISTRATION LOGIC
// ======================================================

async function openWalkinModal() {
    // 1. 设置默认日期为今天
    const today = new Date().toISOString().split('T')[0];
    document.getElementById("walkinDate").value = today;
    document.getElementById("walkinName").value = "";
    document.getElementById("walkinIc").value = "";

    const doctorSelect = document.getElementById("walkinDoctor");
    const timeSelect = document.getElementById("walkinTime");

    // 2. 动态加载可用医生列表
    doctorSelect.innerHTML = '<option value="">Loading...</option>';
    timeSelect.innerHTML = '<option value="">-- Select Doctor First --</option>';

    try {
        const response = await fetch("/api/patient/doctors");
        const data = await response.json();

        if (Array.isArray(data)) {
            doctorSelect.innerHTML = '<option value="">-- Select Doctor --</option>';
            data.forEach(doc => {
                doctorSelect.innerHTML += `<option value="${doc._id}">${doc.name} (${doc.specialty})</option>`;
            });
        } else {
            throw new Error("Invalid data format");
        }
    } catch (error) {
        console.error("Failed to load doctors", error);
        doctorSelect.innerHTML = '<option value="">Error loading doctors</option>';
    }

    //  3. 新增：监听医生和日期的变化，动态更新时间下拉框
    const updateTimes = async () => {
        const docId = doctorSelect.value;
        const date = document.getElementById("walkinDate").value;

        if (!docId || !date) {
            timeSelect.innerHTML = '<option value="">-- Select Doctor & Date First --</option>';
            return;
        }

        timeSelect.innerHTML = '<option value="">Loading available slots...</option>';

        try {
            // 调用刚才修改过的 API，传入 doctor_id 和 date
            const res = await fetch(`/api/patient/slots?doctor_id=${docId}&date=${date}`);
            const slots = await res.json();

            timeSelect.innerHTML = '';
            if (slots && slots.length > 0) {
                slots.forEach(slot => {
                    timeSelect.innerHTML += `<option value="${slot.time}">${slot.time}</option>`;
                });
            } else {
                timeSelect.innerHTML = '<option value="">No available slots for this day</option>';
            }
        } catch (err) {
            console.error("Failed to load slots", err);
            timeSelect.innerHTML = '<option value="">Error loading times</option>';
        }
    };

    // 绑定事件（先移除旧的防止重复绑定）
    doctorSelect.removeEventListener('change', updateTimes);
    document.getElementById("walkinDate").removeEventListener('change', updateTimes);

    doctorSelect.addEventListener('change', updateTimes);
    document.getElementById("walkinDate").addEventListener('change', updateTimes);

    // 4. 打开弹窗
    document.getElementById("walkinModal").classList.add("active");

    // 5. 初始化加载一次时间（因为默认选了今天，如果医生有默认值的话）
    // 注意：通常刚打开时医生是空的，所以这里不强制调用 updateTimes，等用户选医生再触发。
}

function closeWalkinModal() {
    document.getElementById("walkinModal").classList.remove("active");
}

async function registerWalkin() {
    const patientName = document.getElementById("walkinName").value.trim();
    const patientId = document.getElementById("walkinIc").value.trim() || undefined;
    const doctorId = document.getElementById("walkinDoctor").value;
    const date = document.getElementById("walkinDate").value;
    const time = document.getElementById("walkinTime").value;

    if (!patientName || !doctorId || !date) {
        alert("Please fill in Patient Name, Doctor, and Date.");
        return;
    }

    const btn = event.target;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registering...';

    try {
        const response = await fetch("/api/staff/walkin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patient_name: patientName, patient_id: patientId, doctor_id: doctorId, date, time })
        });

        const result = await response.json();

        if (result.success) {
            showStaffMessage("Walk-in patient registered and checked in successfully!", "success");
            closeWalkinModal();
            await loadStaffQueue();
        } else {
            throw new Error(result.message || "Registration failed.");
        }
    } catch (error) {
        console.error(error);
        showStaffMessage("Unable to register walk-in patient.", "error");
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}