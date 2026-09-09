// 1. Role View Switcher with dynamic smooth transitions
function switchRole(role, event) {
  document.querySelectorAll('.role-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));

  if (event && event.currentTarget) {
    event.currentTarget.classList.add('active');
  }

  const targetPanel = document.getElementById(`${role}-view`);
  targetPanel.classList.add('active');
}

// 2. Interactive AI Symptom Recommendation with simulated dynamic typing delay
function runAiTriage() {
  const input = document.getElementById('aiInput').value.toLowerCase();
  const resultBox = document.getElementById('aiResult');

  if (!input.trim()) {
    alert('Please describe your symptoms first.');
    return;
  }

  // Clear & Show loading state
  resultBox.style.display = 'block';
  resultBox.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--primary);"></i> Analyzing symptoms with AI...`;

  setTimeout(() => {
    let recommendation = "General Practitioner (GP)";
    if (input.includes('chest') || input.includes('heart') || input.includes('breath')) {
      recommendation = "Cardiology Specialist";
    } else if (input.includes('skin') || input.includes('rash') || input.includes('itch')) {
      recommendation = "Dermatology Specialist";
    }

    resultBox.innerHTML = `
      <strong><i class="fa-solid fa-robot"></i> AI Recommendation:</strong> We suggest booking a <strong>${recommendation}</strong>.<br>
      <span style="font-size: 0.75rem; color: #64748b;">* Note: Guidance only, not a medical diagnosis.</span>
    `;
  }, 400);
}

// 3. Patient Book Slot Function with entry animation
function handleBookSlot(e) {
  e.preventDefault();
  const slotValue = document.getElementById('bookSlot').value;
  const table = document.getElementById('patientBookingTable');

  const parts = slotValue.split(' - ');
  const newRow = document.createElement('tr');
  newRow.className = 'row-anim';
  newRow.innerHTML = `
    <td>${parts[0]}</td>
    <td>${parts[1]}</td>
    <td>
      <button class="btn btn-outline btn-sm" onclick="cancelBooking(this)" style="color: #ef4444;"><i class="fa-solid fa-xmark"></i> Cancel</button>
    </td>
  `;
  table.appendChild(newRow);
  alert('Appointment booked successfully!');
}

// 4. Cancel Booking with slide-out deletion animation
function cancelBooking(btn) {
  if (confirm('Are you sure you want to cancel this booking?')) {
    const row = btn.closest('tr');
    row.classList.add('row-deleting');
    setTimeout(() => {
      row.remove();
    }, 350);
  }
}

// 5. Doctor Check-In Attendance Toggle with dynamic pulse badge update
function toggleAttendance(checkbox) {
  const statusBadge = checkbox.closest('tr').querySelector('.status-badge');
  if (checkbox.checked) {
    statusBadge.className = 'badge badge-green status-badge pulse-dot';
    statusBadge.textContent = 'Checked-In';
  } else {
    statusBadge.className = 'badge badge-amber status-badge';
    statusBadge.textContent = 'Waiting';
  }
}

// 6. Update Follow-up Horizon
function updateHorizon(select) {
  alert(`Follow-up horizon updated to: ${select.value}`);
}

// 7. Admin Add Slot
function handleAdminAddSlot(e) {
  e.preventDefault();
  const doctor = document.getElementById('adminDoctor').value;
  const time = document.getElementById('adminSlotTime').value;

  const patientSelect = document.getElementById('bookSlot');
  const newOption = document.createElement('option');
  newOption.value = `${time} - ${doctor}`;
  newOption.textContent = `${time} - ${doctor}`;
  patientSelect.appendChild(newOption);

  alert(`New slot added for ${doctor} at ${time}`);
  document.getElementById('adminSlotTime').value = '';
}