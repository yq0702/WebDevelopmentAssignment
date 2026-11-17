// ======================================================
// GLOBAL VARIABLES
// ======================================================
let doctorAppointments = [];
let visibleDoctorAppointments = [];
let selectedDoctorAppointment = null;

// 新增：支持多视图管理的变量
let currentDoctorView = 'today';
let allAppointments = [];
let historyAppointments = [];

// ======================================================
// INITIALIZATION
// ======================================================
document.addEventListener("DOMContentLoaded", function () {
    showDoctorDate();
    document.getElementById("doctorSearch").addEventListener("input", renderDoctorQueue);
    document.getElementById("doctorFilter").addEventListener("change", renderDoctorQueue);
    document.getElementById("doctorSort").addEventListener("change", renderDoctorQueue);
    refreshDoctorDashboard();
});

// ======================================================
// DATA LOADING
// ======================================================
async function refreshDoctorDashboard() {
    await loadAllAppointments(); // 使用全量加载以支持 Tabs 视图
    await loadTimeOffStatus();
}

// 保留原函数名以保持向后兼容（例如 completeAppointmentRequest 中的调用）
async function loadDoctorQueue() {
    await loadAllAppointments();
}

async function loadAllAppointments() {
    const body = document.getElementById("doctorQueueBody");
    body.innerHTML = `<tr><td colspan="6" class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Loading appointments...</td></tr>`;

    try {
        // 调用后端全量接口
        const response = await fetch("/api/doctor/appointments");
        if (response.status === 401 || response.status === 403) {
            window.location.href = "/staff/auth";
            return;
        }
        if (!response.ok) throw new Error("Unable to load appointments.");

        allAppointments = await response.json();
        categorizeAppointments();
        populateDoctorFilter();
        updateDoctorStatistics();
        renderDoctorQueue();
    } catch (error) {
        console.error(error);
        allAppointments = [];
        doctorAppointments = [];
        historyAppointments = [];
        body.innerHTML = `<tr><td colspan="6" class="empty-state error-text"><i class="fa-solid fa-triangle-exclamation"></i><strong>Unable to load appointments.</strong><span>Please check that Flask and MongoDB are running.</span></td></tr>`;
    }
}

function categorizeAppointments() {
    const today = new Date().toISOString().split('T')[0];

    // Today's appointments (not completed)
    doctorAppointments = allAppointments.filter(appt => {
        const slot = appt.slot_info || {};
        const apptDate = slot.date || '';
        const status = appt.status || '';
        return apptDate === today && status !== 'completed';
    });

    // History appointments
    historyAppointments = allAppointments.filter(appt => {
        const status = appt.status || '';
        return status === 'completed';
    });

    // Update tab badge counts
    const todayCount = doctorAppointments.length;
    const upcomingCount = allAppointments.filter(appt => {
        const slot = appt.slot_info || {};
        const apptDate = slot.date || '';
        return apptDate > today && appt.status !== 'completed';
    }).length;
    const historyCount = historyAppointments.length;

    // 安全更新 DOM (如果元素存在)
    const todayEl = document.getElementById('todayCount');
    const upcomingEl = document.getElementById('upcomingCount');
    const historyEl = document.getElementById('historyCount');
    
    if (todayEl) todayEl.textContent = todayCount;
    if (upcomingEl) upcomingEl.textContent = upcomingCount;
    if (historyEl) historyEl.textContent = historyCount;
}

// ======================================================
// VIEW MANAGEMENT & RENDERING
// ======================================================
function switchDoctorView(view) {
    currentDoctorView = view;

    // Update tab buttons UI
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    const activeTab = document.getElementById(`tab-${view}`);
    if (activeTab) activeTab.classList.add('active');

    // Update table header based on view
    const headers = {
        'today': 'Patients Ready for Consultation',
        'upcoming': 'Upcoming Appointments',
        'history': 'Consultation History'
    };

    const title = document.querySelector('.card-title');
    if (title) {
        title.innerHTML = `<i class="fa-solid fa-notes-medical"></i> ${headers[view]}`;
    }

    renderDoctorQueue();
}

function renderDoctorQueue() {
    const body = document.getElementById("doctorQueueBody");
    const search = document.getElementById("doctorSearch").value.trim().toLowerCase();
    const doctorFilter = document.getElementById("doctorFilter").value;
    const sort = document.getElementById("doctorSort").value;

    // Select data based on current view
    let dataToRender = [];
    if (currentDoctorView === 'history') {
        dataToRender = [...historyAppointments];
    } else if (currentDoctorView === 'upcoming') {
        const today = new Date().toISOString().split('T')[0];
        dataToRender = allAppointments.filter(appt => {
            const slot = appt.slot_info || {};
            return slot.date > today && appt.status !== 'completed';
        });
    } else {
        dataToRender = [...doctorAppointments];
    }

    // Apply filters
    visibleDoctorAppointments = dataToRender.filter(function (appointment) {
        const doctor = appointment.doctor_info || {};
        const text = `${appointment.patient_name || ""} ${appointment.patient_id || ""} ${doctor.name || ""} ${doctor.specialty || ""}`.toLowerCase();
        return (!search || text.includes(search)) && (doctorFilter === "all" || doctor.name === doctorFilter);
    });

    // Apply sorting
    if (sort === "name") visibleDoctorAppointments.sort((a, b) => String(a.patient_name || "").localeCompare(String(b.patient_name || "")));
    if (sort === "doctor") visibleDoctorAppointments.sort((a, b) => String(a.doctor_info?.name || "").localeCompare(String(b.doctor_info?.name || "")));
    if (sort === "date") visibleDoctorAppointments.sort((a, b) => getAppointmentSortValue(a).localeCompare(getAppointmentSortValue(b)));

    // Render empty state or table
    if (visibleDoctorAppointments.length === 0) {
        const messages = {
            'today': 'No patients checked in for today.',
            'upcoming': 'No upcoming appointments.',
            'history': 'No completed consultations found.'
        };
        body.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="fa-solid fa-circle-check"></i><strong>${messages[currentDoctorView] || 'No matching patients.'}</strong><span>Check back later for updates.</span></td></tr>`;
        return;
    }

    body.innerHTML = visibleDoctorAppointments.map(function (appointment) {
        const slot = appointment.slot_info || {};
        const doctor = appointment.doctor_info || {};
        const aiSummary = hasAISummary(appointment) ? appointment.ai_summary : "No AI pre-consultation provided";
        const isHistoryView = currentDoctorView === 'history' || appointment.status === 'completed';

        // Different actions based on view (防止历史记录被重复点击 Complete)
        let actionsHtml = '';
        if (isHistoryView) {
            actionsHtml = `<span class="status-badge" style="background:#dcfce7; color:#166534; padding:4px 8px; border-radius:6px; font-size:0.8rem;"><i class="fa-solid fa-circle-check"></i> Completed</span>`;
        } else {
            actionsHtml = `
                <div class="table-actions">
                    <button class="btn btn-primary btn-sm" onclick="completeConsultation('${appointment._id}', this)"><i class="fa-solid fa-circle-check"></i> Complete</button>
                    <button class="table-icon-button doctor-view-button" onclick="openDoctorModal('${appointment._id}')" title="Open Consultation"><i class="fa-solid fa-notes-medical"></i></button>
                </div>
            `;
        }

        return `
            <tr>
                <td>
                    <button class="patient-name-button" onclick="openDoctorModal('${appointment._id}')">
                        <span class="patient-avatar doctor-patient-avatar">${getInitials(appointment.patient_name || "Patient")}</span>
                        <span><strong>${escapeHTML(appointment.patient_name || "Patient")}</strong><small>${escapeHTML(appointment.patient_id || "N/A")}</small></span>
                    </button>
                </td>
                <td><strong>${escapeHTML(doctor.name || "Doctor")}</strong><small class="table-secondary-text">${escapeHTML(doctor.specialty || "General Medicine")}</small></td>
                <td><strong>${escapeHTML(slot.date || "N/A")}</strong><small class="table-secondary-text">${escapeHTML(slot.time || "N/A")}</small></td>
                <td><div class="ai-summary-box doctor-ai-summary"><i class="fa-solid fa-wand-magic-sparkles"></i><span>${escapeHTML(aiSummary)}</span></div></td>
                <td><select id="followup-${appointment._id}" class="form-input table-followup" ${isHistoryView ? 'disabled' : ''}>${followUpOptions(appointment.follow_up || "none")}</select></td>
                <td>${actionsHtml}</td>
            </tr>
        `;
    }).join("");
}

// ======================================================
// STATISTICS & FILTERS
// ======================================================
function updateDoctorStatistics() {
    const aiCount = allAppointments.filter(hasAISummary).length;
    const doctors = new Set();
    allAppointments.forEach(function (appointment) {
        const doctor = appointment.doctor_info || {};
        if (doctor.name) doctors.add(doctor.name);
    });
    
    // 统计今日等待人数
    const today = new Date().toISOString().split('T')[0];
    const waitingToday = allAppointments.filter(appt => {
        const slot = appt.slot_info || {};
        return slot.date === today && appt.status !== 'completed';
    }).length;

    document.getElementById("doctorWaitingCount").textContent = waitingToday;
    document.getElementById("doctorAiCount").textContent = aiCount;
    document.getElementById("doctorCount").textContent = doctors.size;
}

function populateDoctorFilter() {
    const select = document.getElementById("doctorFilter");
    if (!select) return;
    const current = select.value;
    const doctors = new Set();
    allAppointments.forEach(function (appointment) {
        const doctor = appointment.doctor_info || {};
        if (doctor.name) doctors.add(doctor.name);
    });
    select.innerHTML = `<option value="all">All Doctors</option>`;
    Array.from(doctors).sort().forEach(function (doctorName) {
        const option = document.createElement("option");
        option.value = doctorName;
        option.textContent = doctorName;
        select.appendChild(option);
    });
    if (Array.from(select.options).some(function (option) { return option.value === current; })) {
        select.value = current;
    }
}

// ======================================================
// CONSULTATION MODAL
// ======================================================
function openDoctorModal(appointmentId) {
    // 修复：从 allAppointments 中查找，确保在 History 视图中也能打开弹窗查看详情
    selectedDoctorAppointment = allAppointments.find(function (appointment) {
        return String(appointment._id) === String(appointmentId);
    });

    if (!selectedDoctorAppointment) return;

    const slot = selectedDoctorAppointment.slot_info || {};
    const doctor = selectedDoctorAppointment.doctor_info || {};

    document.getElementById("doctorModalPatientName").textContent = selectedDoctorAppointment.patient_name || "Patient";
    document.getElementById("doctorModalPatientId").textContent = selectedDoctorAppointment.patient_id || "N/A";
    document.getElementById("doctorModalDoctor").textContent = doctor.name || "Doctor";
    document.getElementById("doctorModalSpecialty").textContent = doctor.specialty || "General Medicine";
    document.getElementById("doctorModalDate").textContent = slot.date || "N/A";
    document.getElementById("doctorModalTime").textContent = slot.time || "N/A";
    document.getElementById("doctorModalAi").textContent = hasAISummary(selectedDoctorAppointment) ? selectedDoctorAppointment.ai_summary : "No AI pre-consultation provided.";

    const rowFollowUp = document.getElementById(`followup-${appointmentId}`);
    document.getElementById("doctorModalFollowup").value = rowFollowUp ? rowFollowUp.value : (selectedDoctorAppointment.follow_up || "none");

    const notesInput = document.getElementById("doctorModalNotes");
    const prescriptionInput = document.getElementById("doctorModalPrescription");
    if (notesInput) notesInput.value = selectedDoctorAppointment.consultation_notes || "";
    if (prescriptionInput) prescriptionInput.value = selectedDoctorAppointment.prescription || "";

    const completeBtn = document.getElementById("doctorModalCompleteButton");
    completeBtn.dataset.apptId = appointmentId;

    // 【关键修复】防止已完成的预约在弹窗中被重复点击 Complete
    if (selectedDoctorAppointment.status === 'completed') {
        completeBtn.disabled = true;
        completeBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Already Completed';
        completeBtn.style.opacity = '0.6';
        completeBtn.style.cursor = 'not-allowed';
        completeBtn.onclick = null;
    } else {
        completeBtn.disabled = false;
        completeBtn.style.opacity = '1';
        completeBtn.style.cursor = 'pointer';
        completeBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Complete Consultation';
        completeBtn.onclick = function () {
            completeConsultationFromModal();
        };
    }

    document.getElementById("doctorConsultationModal").classList.add("active");
}

function closeDoctorModal() {
    document.getElementById("doctorConsultationModal").classList.remove("active");
    selectedDoctorAppointment = null;
}

async function completeConsultation(appointmentId, button) {
    const followupSelect = document.getElementById(`followup-${appointmentId}`);
    const horizon = followupSelect ? followupSelect.value : "none";
    await completeAppointmentRequest(appointmentId, horizon, button);
}

async function completeConsultationFromModal() {
    if (!selectedDoctorAppointment) return;

    const button = document.getElementById("doctorModalCompleteButton");
    const horizon = document.getElementById("doctorModalFollowup").value;

    const notesInput = document.getElementById("doctorModalNotes");
    const prescriptionInput = document.getElementById("doctorModalPrescription");
    const notes = notesInput ? notesInput.value.trim() : "";
    const prescription = prescriptionInput ? prescriptionInput.value.trim() : "";

    await completeAppointmentRequest(selectedDoctorAppointment._id, horizon, button, notes, prescription);
}

async function completeAppointmentRequest(appointmentId, horizon, button, notes = "", prescription = "") {
    const confirmed = confirm("Mark this consultation as completed?");
    if (!confirmed) return;

    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

    try {
        const response = await fetch(`/api/doctor/complete/${appointmentId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                horizon: horizon,
                consultation_notes: notes,
                prescription: prescription,
                assigned_staff_id: null
            })
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.message || "Unable to complete consultation.");
        }

        closeDoctorModal();
        showDoctorMessage("Consultation completed successfully.", "success");
        await loadAllAppointments(); // 刷新全量数据以更新视图和计数

    } catch (error) {
        console.error(error);
        showDoctorMessage("Unable to complete consultation: " + error.message, "error");
        button.disabled = false;
        button.innerHTML = original;
    }
}

// ======================================================
// HELPERS
// ======================================================
function followUpOptions(selected) {
    const options = [["none", "No Follow-Up"], ["same-week", "Within 7 Days"], ["1-3-months", "1-3 Months"], ["advanced", "Advanced (1 Year)"]];
    return options.map(function (option) {
        return `<option value="${option[0]}" ${selected === option[0] ? "selected" : ""}>${option[1]}</option>`;
    }).join("");
}

function hasAISummary(appointment) {
    const summary = String(appointment.ai_summary || "").trim();
    return summary !== "" && summary.toUpperCase() !== "N/A";
}

function getAppointmentSortValue(appointment) {
    const slot = appointment.slot_info || {};
    return `${slot.date || ""} ${slot.time || ""}`;
}

function showDoctorDate() {
    const dateEl = document.getElementById("doctorCurrentDate");
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    }
}

function showDoctorMessage(message, type) {
    const box = document.getElementById("doctorMessage");
    if (!box) return;
    box.textContent = message;
    box.className = `status-message ${type}`;
    setTimeout(function () { 
        if (box) {
            box.textContent = ""; 
            box.className = "status-message"; 
        }
    }, 3500);
}

async function logoutUser() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/staff/auth";
}

function getInitials(name) {
    return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(function (part) { return part[0].toUpperCase(); }).join("");
}

function escapeHTML(value) {
    const div = document.createElement("div");
    div.textContent = String(value);
    return div.innerHTML;
}

// ======================================================
// EXPORT HISTORY LOGIC
// ======================================================
function openExportModal() {
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setDate(today.getDate() - 30);

    document.getElementById('exportEndDate').value = today.toISOString().split('T')[0];
    document.getElementById('exportStartDate').value = lastMonth.toISOString().split('T')[0];

    document.getElementById('exportHistoryModal').classList.add('active');
}

function closeExportModal() {
    document.getElementById('exportHistoryModal').classList.remove('active');
}

async function downloadHistoryCSV() {
    const startDate = document.getElementById('exportStartDate').value;
    const endDate = document.getElementById('exportEndDate').value;

    if (!startDate || !endDate) {
        alert("Please select both start and end dates.");
        return;
    }

    if (startDate > endDate) {
        alert("Start date cannot be later than end date.");
        return;
    }

    try {
        const response = await fetch(`/api/doctor/history?start_date=${startDate}&end_date=${endDate}`);
        if (!response.ok) throw new Error("Failed to fetch history data");

        const history = await response.json();

        if (history.length === 0) {
            alert("No completed records found for the selected period.");
            return;
        }

        const rows = [
            ["Date", "Time", "Patient Name", "Patient ID", "Consultation Notes", "Prescription", "Follow-Up", "Status"]
        ];

        history.forEach(item => {
            const slot = item.slot_info || {};
            rows.push([
                slot.date || "",
                slot.time || "",
                item.patient_name || "Unknown",
                item.patient_id || "N/A",
                item.consultation_notes || "",
                item.prescription || "",
                item.follow_up || "none",
                item.status || "completed"
            ]);
        });

        downloadCSV(rows, `MediSync_History_${startDate}_to_${endDate}.csv`);
        closeExportModal();
        showDoctorMessage("History exported successfully!", "success");

    } catch (error) {
        console.error("Export Error:", error);
        alert("Error downloading history. Please try again.");
    }
}

function downloadCSV(rows, filename) {
    const csv = rows.map(function (row) {
        return row.map(function (value) {
            let stringValue = String(value || "").replace(/"/g, '""');
            if (stringValue.search(/("|,|\n)/g) >= 0) {
                stringValue = `"${stringValue}"`;
            }
            return stringValue;
        }).join(",");
    }).join("\n");

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

function printDoctorQueue() { 
    window.print(); 
}

// ======================================================
// OFF TIME REQUEST FUNCTIONS
// ======================================================
function openOffTimeRequestModal() {
    document.getElementById('offTimeDate').value = '';
    document.getElementById('offTimeReason').value = '';
    document.getElementById('offTimeRequestModal').classList.add('active');
}

function closeOffTimeRequestModal() {
    document.getElementById('offTimeRequestModal').classList.remove('active');
}

async function submitOffTimeRequest() {
    const date = document.getElementById('offTimeDate').value;
    const reason = document.getElementById('offTimeReason').value.trim();

    if (!date) {
        alert('Please select a date.');
        return;
    }

    try {
        const response = await fetch('/api/doctor/unavailable_times', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: date,
                reason: reason || 'Not specified'
            })
        });

        const result = await response.json();

        if (result.success) {
            alert('Off time request submitted successfully!');
            closeOffTimeRequestModal();
            loadTimeOffStatus(); // 刷新状态
        } else {
            alert('Failed to submit request: ' + result.message);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Unable to submit request. Please try again.');
    }
}

// ======================================================
// TIME OFF STATUS BANNER LOGIC
// ======================================================
async function loadTimeOffStatus() {
    try {
        const response = await fetch('/api/doctor/unavailable_times/my_requests');
        if (!response.ok) return;

        const requests = await response.json();
        const banner = document.getElementById('timeOffStatusBanner');
        const bannerIcon = document.getElementById('bannerIcon');
        const bannerMessage = document.getElementById('bannerMessage');

        if (requests && requests.length > 0) {
            const pendingReq = requests.find(r => r.status === 'pending');
            const latestReq = requests[0];
            const reqToShow = pendingReq || latestReq;

            banner.style.display = 'flex';
            banner.className = `time-off-banner ${reqToShow.status}`;

            const dateStr = new Date(reqToShow.date).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
            });

            if (reqToShow.status === 'pending') {
                bannerIcon.className = 'fa-solid fa-hourglass-half';
                bannerMessage.textContent = `Your time off request for ${dateStr} is currently Pending admin approval.`;
            } else if (reqToShow.status === 'approved') {
                bannerIcon.className = 'fa-solid fa-circle-check';
                bannerMessage.textContent = `Great! Your time off request for ${dateStr} has been Approved.`;
            } else if (reqToShow.status === 'rejected') {
                bannerIcon.className = 'fa-solid fa-circle-xmark';
                bannerMessage.textContent = `Your time off request for ${dateStr} was Rejected. Please contact admin for details.`;
            }
        } else {
            banner.style.display = 'none';
        }
    } catch (error) {
        console.error("Failed to load time off status:", error);
    }
}

function dismissBanner() {
    document.getElementById('timeOffStatusBanner').style.display = 'none';
}