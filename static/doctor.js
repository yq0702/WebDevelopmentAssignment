let doctorAppointments = [];
let visibleDoctorAppointments = [];
let selectedDoctorAppointment = null;


document.addEventListener(
    "DOMContentLoaded",
    function () {

        showDoctorDate();


        document
            .getElementById("doctorSearch")
            .addEventListener(
                "input",
                renderDoctorQueue
            );


        document
            .getElementById("doctorFilter")
            .addEventListener(
                "change",
                renderDoctorQueue
            );


        document
            .getElementById("doctorSort")
            .addEventListener(
                "change",
                renderDoctorQueue
            );


        refreshDoctorDashboard();

    }
);


// ======================================================
// REFRESH
// ======================================================

async function refreshDoctorDashboard() {

    await loadDoctorQueue();

}


// ======================================================
// LOAD DOCTOR QUEUE
// ======================================================

async function loadDoctorQueue() {

    const body =
        document.getElementById(
            "doctorQueueBody"
        );


    body.innerHTML = `

        <tr>

            <td colspan="6"
                class="loading-row">

                <i class="fa-solid fa-spinner fa-spin"></i>

                Loading consultation queue...

            </td>

        </tr>

    `;


    try {

        const response =
            await fetch(
                "/api/doctor/queue"
            );


        if (
            response.status === 401 ||
            response.status === 403
        ) {

            window.location.href =
                "/staff/auth";

            return;

        }


        if (!response.ok) {

            throw new Error(
                "Unable to load doctor queue."
            );

        }


        doctorAppointments =
            await response.json();


        populateDoctorFilter();

        updateDoctorStatistics();

        renderDoctorQueue();

    }

    catch (error) {

        console.error(error);


        doctorAppointments = [];


        body.innerHTML = `

            <tr>

                <td colspan="6"
                    class="empty-state error-text">

                    <i class="fa-solid fa-triangle-exclamation"></i>

                    <strong>
                        Unable to load consultation queue.
                    </strong>

                    <span>
                        Please check that Flask and MongoDB are running.
                    </span>

                </td>

            </tr>

        `;

    }

}


// ======================================================
// STATISTICS
// ======================================================

function updateDoctorStatistics() {

    const aiCount =
        doctorAppointments.filter(
            hasAISummary
        ).length;


    const doctors =
        new Set();


    doctorAppointments.forEach(
        function (appointment) {

            const doctor =
                appointment.doctor_info || {};


            if (doctor.name) {

                doctors.add(
                    doctor.name
                );

            }

        }
    );


    document.getElementById(
        "doctorWaitingCount"
    ).textContent =
        doctorAppointments.length;


    document.getElementById(
        "doctorAiCount"
    ).textContent =
        aiCount;


    document.getElementById(
        "doctorCount"
    ).textContent =
        doctors.size;

}


// ======================================================
// DOCTOR FILTER
// ======================================================

function populateDoctorFilter() {

    const select =
        document.getElementById(
            "doctorFilter"
        );


    const current =
        select.value;


    const doctors =
        new Set();


    doctorAppointments.forEach(
        function (appointment) {

            const doctor =
                appointment.doctor_info || {};


            if (doctor.name) {

                doctors.add(
                    doctor.name
                );

            }

        }
    );


    select.innerHTML =
        `<option value="all">All Doctors</option>`;


    Array.from(doctors)
        .sort()
        .forEach(
            function (doctorName) {

                const option =
                    document.createElement(
                        "option"
                    );


                option.value =
                    doctorName;


                option.textContent =
                    doctorName;


                select.appendChild(
                    option
                );

            }
        );


    if (
        Array.from(
            select.options
        ).some(
            function (option) {

                return option.value === current;

            }
        )
    ) {

        select.value =
            current;

    }

}


// ======================================================
// FILTER / SORT
// ======================================================

function renderDoctorQueue() {

    const body =
        document.getElementById(
            "doctorQueueBody"
        );


    const search =
        document.getElementById(
            "doctorSearch"
        ).value
            .trim()
            .toLowerCase();


    const doctorFilter =
        document.getElementById(
            "doctorFilter"
        ).value;


    const sort =
        document.getElementById(
            "doctorSort"
        ).value;


    visibleDoctorAppointments =
        doctorAppointments.filter(
            function (appointment) {

                const doctor =
                    appointment.doctor_info || {};


                const text = `

                    ${appointment.patient_name || ""}

                    ${appointment.patient_id || ""}

                    ${doctor.name || ""}

                    ${doctor.specialty || ""}

                `.toLowerCase();


                const searchMatch =
                    !search ||
                    text.includes(search);


                const doctorMatch =
                    doctorFilter === "all" ||
                    doctor.name === doctorFilter;


                return (
                    searchMatch &&
                    doctorMatch
                );

            }
        );


    if (sort === "name") {

        visibleDoctorAppointments.sort(
            function (a, b) {

                return String(
                    a.patient_name || ""
                ).localeCompare(
                    String(
                        b.patient_name || ""
                    )
                );

            }
        );

    }


    if (sort === "doctor") {

        visibleDoctorAppointments.sort(
            function (a, b) {

                return String(
                    a.doctor_info?.name || ""
                ).localeCompare(
                    String(
                        b.doctor_info?.name || ""
                    )
                );

            }
        );

    }


    if (sort === "date") {

        visibleDoctorAppointments.sort(
            function (a, b) {

                return getAppointmentSortValue(
                    a
                ).localeCompare(
                    getAppointmentSortValue(
                        b
                    )
                );

            }
        );

    }


    if (
        visibleDoctorAppointments.length === 0
    ) {

        body.innerHTML = `

            <tr>

                <td colspan="6"
                    class="empty-state">

                    <i class="fa-solid fa-circle-check"></i>

                    <strong>
                        No matching patients.
                    </strong>

                    <span>
                        Checked-in patients will appear here.
                    </span>

                </td>

            </tr>

        `;

        return;

    }


    body.innerHTML =
        visibleDoctorAppointments
            .map(
                function (appointment) {

                    const slot =
                        appointment.slot_info || {};


                    const doctor =
                        appointment.doctor_info || {};


                    const aiSummary =
                        hasAISummary(
                            appointment
                        )
                            ? appointment.ai_summary
                            : "No AI pre-consultation provided";


                    return `

                        <tr>

                            <td>

                                <button
                                    class="patient-name-button"
                                    onclick="openDoctorModal(
                                        '${appointment._id}'
                                    )">

                                    <span class="patient-avatar doctor-patient-avatar">

                                        ${getInitials(
                                            appointment.patient_name ||
                                            "Patient"
                                        )}

                                    </span>


                                    <span>

                                        <strong>

                                            ${escapeHTML(
                                                appointment.patient_name ||
                                                "Patient"
                                            )}

                                        </strong>

                                        <small>

                                            ${escapeHTML(
                                                appointment.patient_id ||
                                                "N/A"
                                            )}

                                        </small>

                                    </span>

                                </button>

                            </td>



                            <td>

                                <strong>

                                    ${escapeHTML(
                                        doctor.name ||
                                        "Doctor"
                                    )}

                                </strong>

                                <small class="table-secondary-text">

                                    ${escapeHTML(
                                        doctor.specialty ||
                                        "General Medicine"
                                    )}

                                </small>

                            </td>



                            <td>

                                <strong>

                                    ${escapeHTML(
                                        slot.date ||
                                        "N/A"
                                    )}

                                </strong>

                                <small class="table-secondary-text">

                                    ${escapeHTML(
                                        slot.time ||
                                        "N/A"
                                    )}

                                </small>

                            </td>



                            <td>

                                <div class="ai-summary-box doctor-ai-summary">

                                    <i class="fa-solid fa-wand-magic-sparkles"></i>

                                    <span>

                                        ${escapeHTML(
                                            aiSummary
                                        )}

                                    </span>

                                </div>

                            </td>



                            <td>

                                <select
                                    id="followup-${appointment._id}"
                                    class="form-input table-followup">

                                    ${followUpOptions(
                                        appointment.follow_up ||
                                        "none"
                                    )}

                                </select>

                            </td>



                            <td>

                                <div class="table-actions">

                                    <button
                                        class="btn btn-primary btn-sm"
                                        onclick="completeConsultation(
                                            '${appointment._id}',
                                            this
                                        )">

                                        <i class="fa-solid fa-circle-check"></i>

                                        Complete

                                    </button>


                                    <button
                                        class="table-icon-button doctor-view-button"
                                        onclick="openDoctorModal(
                                            '${appointment._id}'
                                        )"
                                        title="Open Consultation">

                                        <i class="fa-solid fa-notes-medical"></i>

                                    </button>

                                </div>

                            </td>

                        </tr>

                    `;

                }
            )
            .join("");

}


// ======================================================
// CONSULTATION MODAL
// ======================================================

function openDoctorModal(
    appointmentId
) {

    selectedDoctorAppointment =
        doctorAppointments.find(
            function (appointment) {

                return String(
                    appointment._id
                ) ===
                String(
                    appointmentId
                );

            }
        );


    if (!selectedDoctorAppointment) {

        return;

    }


    const slot =
        selectedDoctorAppointment.slot_info ||
        {};


    const doctor =
        selectedDoctorAppointment.doctor_info ||
        {};


    document.getElementById(
        "doctorModalPatientName"
    ).textContent =
        selectedDoctorAppointment.patient_name ||
        "Patient";


    document.getElementById(
        "doctorModalPatientId"
    ).textContent =
        selectedDoctorAppointment.patient_id ||
        "N/A";


    document.getElementById(
        "doctorModalDoctor"
    ).textContent =
        doctor.name ||
        "Doctor";


    document.getElementById(
        "doctorModalSpecialty"
    ).textContent =
        doctor.specialty ||
        "General Medicine";


    document.getElementById(
        "doctorModalDate"
    ).textContent =
        slot.date ||
        "N/A";


    document.getElementById(
        "doctorModalTime"
    ).textContent =
        slot.time ||
        "N/A";


    document.getElementById(
        "doctorModalAi"
    ).textContent =
        hasAISummary(
            selectedDoctorAppointment
        )
            ? selectedDoctorAppointment.ai_summary
            : "No AI pre-consultation provided.";


    const rowFollowUp =
        document.getElementById(
            `followup-${appointmentId}`
        );


    document.getElementById(
        "doctorModalFollowup"
    ).value =
        rowFollowUp
            ? rowFollowUp.value
            : (
                selectedDoctorAppointment.follow_up ||
                "none"
            );


    document.getElementById(
        "doctorModalCompleteButton"
    ).onclick =
        function () {

            completeConsultationFromModal();

        };


    document.getElementById(
        "doctorConsultationModal"
    ).classList.add(
        "active"
    );

}


function closeDoctorModal() {

    document.getElementById(
        "doctorConsultationModal"
    ).classList.remove(
        "active"
    );


    selectedDoctorAppointment =
        null;

}


// ======================================================
// COMPLETE CONSULTATION
// ======================================================

async function completeConsultation(
    appointmentId,
    button
) {

    const followupSelect =
        document.getElementById(
            `followup-${appointmentId}`
        );


    const horizon =
        followupSelect
            ? followupSelect.value
            : "none";


    await completeAppointmentRequest(
        appointmentId,
        horizon,
        button
    );

}


async function completeConsultationFromModal() {

    if (!selectedDoctorAppointment) {

        return;

    }


    const button =
        document.getElementById(
            "doctorModalCompleteButton"
        );


    const horizon =
        document.getElementById(
            "doctorModalFollowup"
        ).value;


    await completeAppointmentRequest(
        selectedDoctorAppointment._id,
        horizon,
        button
    );

}


async function completeAppointmentRequest(
    appointmentId,
    horizon,
    button
) {

    const confirmed =
        confirm(
            "Mark this consultation as completed?"
        );


    if (!confirmed) {

        return;

    }


    const original =
        button.innerHTML;


    button.disabled =
        true;


    button.innerHTML = `

        <i class="fa-solid fa-spinner fa-spin"></i>

        Saving...

    `;


    try {

        const response =
            await fetch(
                `/api/doctor/complete/${appointmentId}`,
                {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            {
                                horizon:
                                    horizon
                            }
                        )

                }
            );


        const result =
            await response.json();


        if (
            !response.ok ||
            !result.success
        ) {

            throw new Error(
                "Unable to complete consultation."
            );

        }


        closeDoctorModal();


        showDoctorMessage(
            "Consultation completed successfully.",
            "success"
        );


        await loadDoctorQueue();

    }

    catch (error) {

        console.error(error);


        showDoctorMessage(
            "Unable to complete consultation.",
            "error"
        );


        button.disabled =
            false;


        button.innerHTML =
            original;

    }

}


// ======================================================
// CSV EXPORT
// ======================================================

function exportDoctorCSV() {

    if (
        visibleDoctorAppointments.length === 0
    ) {

        alert(
            "There are no patients to export."
        );

        return;

    }


    const rows = [

        [
            "Patient",
            "Patient ID",
            "Doctor",
            "Specialty",
            "Date",
            "Time",
            "AI Summary",
            "Follow-Up"
        ]

    ];


    visibleDoctorAppointments.forEach(
        function (appointment) {

            const slot =
                appointment.slot_info || {};


            const doctor =
                appointment.doctor_info || {};


            const followup =
                document.getElementById(
                    `followup-${appointment._id}`
                );


            rows.push(
                [
                    appointment.patient_name || "",
                    appointment.patient_id || "",
                    doctor.name || "",
                    doctor.specialty || "",
                    slot.date || "",
                    slot.time || "",
                    appointment.ai_summary || "N/A",
                    followup
                        ? followup.value
                        : "none"
                ]
            );

        }
    );


    downloadCSV(
        rows,
        "MediSync_Doctor_Queue.csv"
    );

}


// ======================================================
// PRINT
// ======================================================

function printDoctorQueue() {

    const newWindow =
        window.open(
            "",
            "_blank"
        );


    const rows =
        visibleDoctorAppointments
            .map(
                function (appointment) {

                    const slot =
                        appointment.slot_info ||
                        {};


                    const doctor =
                        appointment.doctor_info ||
                        {};


                    return `

                        <tr>

                            <td>
                                ${escapeHTML(
                                    appointment.patient_name ||
                                    "Patient"
                                )}
                            </td>

                            <td>
                                ${escapeHTML(
                                    appointment.patient_id ||
                                    "N/A"
                                )}
                            </td>

                            <td>
                                ${escapeHTML(
                                    doctor.name ||
                                    "Doctor"
                                )}
                            </td>

                            <td>
                                ${escapeHTML(
                                    slot.date ||
                                    "N/A"
                                )}
                            </td>

                            <td>
                                ${escapeHTML(
                                    slot.time ||
                                    "N/A"
                                )}
                            </td>

                            <td>
                                ${escapeHTML(
                                    appointment.ai_summary ||
                                    "N/A"
                                )}
                            </td>

                        </tr>

                    `;

                }
            )
            .join("");


    newWindow.document.write(`

        <html>

        <head>

            <title>
                MediSync Doctor Queue
            </title>

            <style>

                body {
                    font-family: Arial;
                    padding: 30px;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                }

                th,
                td {
                    border: 1px solid #ddd;
                    padding: 10px;
                    text-align: left;
                }

                th {
                    background: #f5f3ff;
                }

            </style>

        </head>

        <body>

            <h1>
                MediSync Consultation Queue
            </h1>

            <table>

                <thead>

                    <tr>

                        <th>Patient</th>

                        <th>Patient ID</th>

                        <th>Doctor</th>

                        <th>Date</th>

                        <th>Time</th>

                        <th>AI Summary</th>

                    </tr>

                </thead>

                <tbody>

                    ${rows}

                </tbody>

            </table>

        </body>

        </html>

    `);


    newWindow.document.close();

    newWindow.print();

}


// ======================================================
// HELPERS
// ======================================================

function followUpOptions(
    selected
) {

    const options = [

        ["none", "No Follow-Up"],

        ["same-week", "Within 7 Days"],

        ["1-month", "1 Month"],

        ["3-months", "3 Months"],

        ["6-months", "6 Months"],

        ["1-year", "1 Year"]

    ];


    return options
        .map(
            function (option) {

                const value =
                    option[0];


                const label =
                    option[1];


                return `

                    <option
                        value="${value}"
                        ${selected === value
                            ? "selected"
                            : ""}>

                        ${label}

                    </option>

                `;

            }
        )
        .join("");

}


function hasAISummary(
    appointment
) {

    const summary =
        String(
            appointment.ai_summary ||
            ""
        ).trim();


    return (
        summary !== "" &&
        summary.toUpperCase() !== "N/A"
    );

}


function getAppointmentSortValue(
    appointment
) {

    const slot =
        appointment.slot_info ||
        {};


    return `${slot.date || ""} ${slot.time || ""}`;

}


function showDoctorDate() {

    const date =
        new Date();


    document.getElementById(
        "doctorCurrentDate"
    ).textContent =
        date.toLocaleDateString(
            undefined,
            {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric"
            }
        );

}


function showDoctorMessage(
    message,
    type
) {

    const box =
        document.getElementById(
            "doctorMessage"
        );


    box.textContent =
        message;


    box.className =
        `status-message ${type}`;


    setTimeout(
        function () {

            box.textContent = "";

            box.className =
                "status-message";

        },
        3500
    );

}


async function logoutUser() {

    await fetch(
        "/api/auth/logout",
        {
            method: "POST"
        }
    );


    window.location.href =
        "/staff/auth";

}


function getInitials(
    name
) {

    return String(name)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(
            function (part) {

                return part[0].toUpperCase();

            }
        )
        .join("");

}


function downloadCSV(
    rows,
    filename
) {

    const csv =
        rows
            .map(
                function (row) {

                    return row
                        .map(
                            function (value) {

                                return `"${String(
                                    value
                                ).replace(
                                    /"/g,
                                    '""'
                                )}"`;

                            }
                        )
                        .join(",");

                }
            )
            .join("\n");


    const blob =
        new Blob(
            [csv],
            {
                type:
                    "text/csv;charset=utf-8;"
            }
        );


    const link =
        document.createElement(
            "a"
        );


    link.href =
        URL.createObjectURL(
            blob
        );


    link.download =
        filename;


    link.click();


    URL.revokeObjectURL(
        link.href
    );

}


function escapeHTML(
    value
) {

    const div =
        document.createElement(
            "div"
        );


    div.textContent =
        String(value);


    return div.innerHTML;

}
