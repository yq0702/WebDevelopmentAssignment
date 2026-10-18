let doctorAppointments = [];
let visibleDoctorAppointments = [];
let selectedDoctorAppointment = null;

document.addEventListener("DOMContentLoaded", function () {
    showDoctorDate();
    document.getElementById("doctorSearch").addEventListener("input", renderDoctorQueue);
    document.getElementById("doctorFilter").addEventListener("change", renderDoctorQueue);
    document.getElementById("doctorSort").addEventListener("change", renderDoctorQueue);
    refreshDoctorDashboard();
});

async function refreshDoctorDashboard() {
    await loadDoctorQueue();
    await loadTimeOffStatus();
}

async function loadDoctorQueue() {
    const body = document.getElementById("doctorQueueBody");
    body.innerHTML = `<tr><td colspan="6" class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Loading consultation queue...</td></tr>`;

    try {
        const response = await fetch("/api/doctor/queue");
        if (response.status === 401 || response.status === 403) {
            window.location.href = "/staff/auth";
            return;
        }
        if (!response.ok) throw new Error("Unable to load doctor queue.");

        doctorAppointments = await response.json();
        populateDoctorFilter();
        updateDoctorStatistics();
        renderDoctorQueue();
    } catch (error) {
        console.error(error);
        doctorAppointments = [];
        body.innerHTML = `<tr><td colspan="6" class="empty-state error-text"><i class="fa-solid fa-triangle-exclamation"></i><strong>Unable to load consultation queue.</strong><span>Please check that Flask and MongoDB are running.</span></td></tr>`;
    }
}

function updateDoctorStatistics() {
    const aiCount = doctorAppointments.filter(hasAISummary).length;
    const doctors = new Set();
    doctorAppointments.forEach(function (appointment) {
        const doctor = appointment.doctor_info || {};
        if (doctor.name) doctors.add(doctor.name);
    });
    document.getElementById("doctorWaitingCount").textContent = doctorAppointments.length;
    document.getElementById("doctorAiCount").textContent = aiCount;
    document.getElementById("doctorCount").textContent = doctors.size;
}

function populateDoctorFilter() {
    const select = document.getElementById("doctorFilter");
    const current = select.value;
    const doctors = new Set();
    doctorAppointments.forEach(function (appointment) {
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

function renderDoctorQueue() {
    const body = document.getElementById("doctorQueueBody");
    const search = document.getElementById("doctorSearch").value.trim().toLowerCase();
    const doctorFilter = document.getElementById("doctorFilter").value;
    const sort = document.getElementById("doctorSort").value;

    visibleDoctorAppointments = doctorAppointments.filter(function (appointment) {
        const doctor = appointment.doctor_info || {};
        const text = `${appointment.patient_name || ""} ${appointment.patient_id || ""} ${doctor.name || ""} ${doctor.specialty || ""}`.toLowerCase();
        return (!search || text.includes(search)) && (doctorFilter === "all" || doctor.name === doctorFilter);
    });

    if (sort === "name") visibleDoctorAppointments.sort((a, b) => String(a.patient_name || "").localeCompare(String(b.patient_name || "")));
    if (sort === "doctor") visibleDoctorAppointments.sort((a, b) => String(a.doctor_info?.name || "").localeCompare(String(b.doctor_info?.name || "")));
    if (sort === "date") visibleDoctorAppointments.sort((a, b) => getAppointmentSortValue(a).localeCompare(getAppointmentSortValue(b)));

    if (visibleDoctorAppointments.length === 0) {
        body.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="fa-solid fa-circle-check"></i><strong>No matching patients.</strong><span>Checked-in patients will appear here.</span></td></tr>`;
        return;
    }

    body.innerHTML = visibleDoctorAppointments.map(function (appointment) {
        const slot = appointment.slot_info || {};
        const doctor = appointment.doctor_info || {};
        const aiSummary = hasAISummary(appointment) ? appointment.ai_summary : "No AI pre-consultation provided";

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
                <td><select id="followup-${appointment._id}" class="form-input table-followup">${followUpOptions(appointment.follow_up || "none")}</select></td>
                <td>
                    <div class="table-actions">
                        <button class="btn btn-primary btn-sm" onclick="completeConsultation('${appointment._id}', this)"><i class="fa-solid fa-circle-check"></i> Complete</button>
                        <button class="table-icon-button doctor-view-button" onclick="openDoctorModal('${appointment._id}')" title="Open Consultation"><i class="fa-solid fa-notes-medical"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

// ======================================================
// CONSULTATION MODAL
// ======================================================
function openDoctorModal(appointmentId) {
    selectedDoctorAppointment = doctorAppointments.find(function (appointment) {
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
    if (notesInput) notesInput.value = "";
    if (prescriptionInput) prescriptionInput.value = "";

    const completeBtn = document.getElementById("doctorModalCompleteButton");
    completeBtn.dataset.apptId = appointmentId;
    completeBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Complete Consultation';
    completeBtn.disabled = false;
    completeBtn.onclick = function () {
        completeConsultationFromModal();
    };

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
        await loadDoctorQueue();

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
    document.getElementById("doctorCurrentDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function showDoctorMessage(message, type) {
    const box = document.getElementById("doctorMessage");
    box.textContent = message;
    box.className = `status-message ${type}`;
    setTimeout(function () { box.textContent = ""; box.className = "status-message"; }, 3500);
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

// ================= 🌟 Export History Logic =================

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

function printDoctorQueue() { window.print(); }

// ================= Off Time Request Functions =================
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
        } else {
            alert('Failed to submit request: ' + result.message);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Unable to submit request. Please try again.');
    }
}

// ================= 🌟 Time Off Status Banner Logic =================

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

document.addEventListener('DOMContentLoaded', function () {
    showDoctorDate();
    document.getElementById("doctorSearch").addEventListener("input", renderDoctorQueue);
    document.getElementById("doctorFilter").addEventListener("change", renderDoctorQueue);
    document.getElementById("doctorSort").addEventListener("change", renderDoctorQueue);

    refreshDoctorDashboard(); 
});