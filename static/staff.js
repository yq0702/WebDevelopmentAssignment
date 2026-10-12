let staffAppointments = [];
let visibleStaffAppointments = [];
let selectedStaffAppointment = null;


document.addEventListener(
    "DOMContentLoaded",
    function () {

        showCurrentDate();

        document
            .getElementById("staffSearch")
            .addEventListener("input", renderStaffQueue);


        document
            .getElementById("staffAiFilter")
            .addEventListener("change", renderStaffQueue);


        document
            .getElementById("staffSort")
            .addEventListener("change", renderStaffQueue);


        refreshStaffDashboard();

    }
);


// ======================================================
// REFRESH
// ======================================================

async function refreshStaffDashboard() {

    await loadStaffQueue();

}


// ======================================================
// LOAD STAFF QUEUE
// ======================================================

async function loadStaffQueue() {

    const body =
        document.getElementById("staffQueueBody");


    body.innerHTML = `

        <tr>

            <td colspan="5"
                class="loading-row">

                <i class="fa-solid fa-spinner fa-spin"></i>

                Loading appointments...

            </td>

        </tr>

    `;


    try {

        const response =
            await fetch("/api/staff/queue");


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
                "Unable to load appointments."
            );

        }


        staffAppointments =
            await response.json();


        updateStaffStatistics();

        renderStaffQueue();

    }

    catch (error) {

        console.error(error);


        staffAppointments = [];


        body.innerHTML = `

            <tr>

                <td colspan="5"
                    class="empty-state error-text">

                    <i class="fa-solid fa-triangle-exclamation"></i>

                    <strong>
                        Unable to load appointment queue.
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

function updateStaffStatistics() {

    const aiCount =
        staffAppointments.filter(
            hasAISummary
        ).length;


    document.getElementById(
        "waitingCount"
    ).textContent =
        staffAppointments.length;


    document.getElementById(
        "staffAiCount"
    ).textContent =
        aiCount;

}


// ======================================================
// FILTER / SEARCH / SORT
// ======================================================

function renderStaffQueue() {

    const body =
        document.getElementById(
            "staffQueueBody"
        );


    const search =
        document.getElementById(
            "staffSearch"
        ).value
            .trim()
            .toLowerCase();


    const aiFilter =
        document.getElementById(
            "staffAiFilter"
        ).value;


    const sort =
        document.getElementById(
            "staffSort"
        ).value;


    visibleStaffAppointments =
        staffAppointments.filter(
            function (appointment) {

                const searchText = `

                    ${appointment.patient_name || ""}

                    ${appointment.patient_id || ""}

                `.toLowerCase();


                const searchMatch =
                    !search ||
                    searchText.includes(search);


                let aiMatch = true;


                if (aiFilter === "ai") {

                    aiMatch =
                        hasAISummary(
                            appointment
                        );

                }


                if (aiFilter === "no-ai") {

                    aiMatch =
                        !hasAISummary(
                            appointment
                        );

                }


                return (
                    searchMatch &&
                    aiMatch
                );

            }
        );


    if (sort === "name") {

        visibleStaffAppointments.sort(
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


    if (sort === "date") {

        visibleStaffAppointments.sort(
            function (a, b) {

                const first =
                    getAppointmentSortValue(a);

                const second =
                    getAppointmentSortValue(b);


                return first.localeCompare(
                    second
                );

            }
        );

    }


    document.getElementById(
        "visibleCount"
    ).textContent =
        visibleStaffAppointments.length;


    if (
        visibleStaffAppointments.length === 0
    ) {

        body.innerHTML = `

            <tr>

                <td colspan="5"
                    class="empty-state">

                    <i class="fa-solid fa-circle-check"></i>

                    <strong>
                        No matching appointments.
                    </strong>

                    <span>
                        Try changing your search or filter.
                    </span>

                </td>

            </tr>

        `;

        return;

    }


    body.innerHTML =
        visibleStaffAppointments
            .map(
                function (appointment) {

                    const slot =
                        appointment.slot_info || {};


                    const aiSummary =
                        hasAISummary(
                            appointment
                        )
                            ? appointment.ai_summary
                            : "No AI consultation provided";


                    return `

                        <tr>

                            <td>

                                <button
                                    class="patient-name-button"
                                    onclick="openStaffModal(
                                        '${appointment._id}'
                                    )">

                                    <span class="patient-avatar">

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

                                <div class="ai-summary-box">

                                    <i class="fa-solid fa-wand-magic-sparkles"></i>

                                    <span>

                                        ${escapeHTML(
                                            aiSummary
                                        )}

                                    </span>

                                </div>

                            </td>



                            <td>

                                <span class="queue-status queue-booked">

                                    <i class="fa-solid fa-calendar-check"></i>

                                    Booked

                                </span>

                            </td>



                            <td>

                                <div class="table-actions">

                                    <button
                                        class="btn btn-primary btn-sm"
                                        onclick="checkInPatient(
                                            '${appointment._id}',
                                            this
                                        )">

                                        <i class="fa-solid fa-user-check"></i>

                                        Check In

                                    </button>


                                    <button
                                        class="table-icon-button"
                                        title="View Details"
                                        onclick="openStaffModal(
                                            '${appointment._id}'
                                        )">

                                        <i class="fa-solid fa-eye"></i>

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
// PATIENT DETAIL MODAL
// ======================================================

function openStaffModal(
    appointmentId
) {

    selectedStaffAppointment =
        staffAppointments.find(
            function (appointment) {

                return String(
                    appointment._id
                ) ===
                String(
                    appointmentId
                );

            }
        );


    if (!selectedStaffAppointment) {

        return;

    }


    const slot =
        selectedStaffAppointment.slot_info ||
        {};


    document.getElementById(
        "staffModalName"
    ).textContent =
        selectedStaffAppointment.patient_name ||
        "Patient";


    document.getElementById(
        "staffModalPatientId"
    ).textContent =
        selectedStaffAppointment.patient_id ||
        "N/A";


    document.getElementById(
        "staffModalDate"
    ).textContent =
        slot.date ||
        "N/A";


    document.getElementById(
        "staffModalTime"
    ).textContent =
        slot.time ||
        "N/A";


    document.getElementById(
        "staffModalAi"
    ).textContent =
        hasAISummary(
            selectedStaffAppointment
        )
            ? selectedStaffAppointment.ai_summary
            : "No AI consultation provided.";


    const button =
        document.getElementById(
            "staffModalCheckInButton"
        );


    button.onclick =
        function () {

            checkInPatient(
                selectedStaffAppointment._id,
                button
            );

        };


    document.getElementById(
        "staffPatientModal"
    ).classList.add(
        "active"
    );

}


function closeStaffModal() {

    document.getElementById(
        "staffPatientModal"
    ).classList.remove(
        "active"
    );


    selectedStaffAppointment =
        null;

}


// ======================================================
// CHECK IN
// ======================================================

async function checkInPatient(
    appointmentId,
    button
) {

    const confirmed =
        confirm(
            "Confirm that this patient has arrived and should be checked in?"
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

        Checking In...

    `;


    try {

        const response =
            await fetch(
                `/api/staff/checkin/${appointmentId}`,
                {
                    method: "POST"
                }
            );


        const result =
            await response.json();


        if (
            !response.ok ||
            !result.success
        ) {

            throw new Error(
                "Check-in failed."
            );

        }


        closeStaffModal();


        showStaffMessage(
            "Patient checked in successfully.",
            "success"
        );


        await loadStaffQueue();

    }

    catch (error) {

        console.error(error);


        showStaffMessage(
            "Unable to check in patient.",
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

function exportStaffCSV() {

    if (
        visibleStaffAppointments.length === 0
    ) {

        alert(
            "There are no appointments to export."
        );

        return;

    }


    const rows = [

        [
            "Patient",
            "Patient ID",
            "Date",
            "Time",
            "AI Summary",
            "Status"
        ]

    ];


    visibleStaffAppointments.forEach(
        function (appointment) {

            const slot =
                appointment.slot_info || {};


            rows.push(
                [
                    appointment.patient_name || "",
                    appointment.patient_id || "",
                    slot.date || "",
                    slot.time || "",
                    appointment.ai_summary || "N/A",
                    "Booked"
                ]
            );

        }
    );


    downloadCSV(
        rows,
        "MediSync_Staff_Queue.csv"
    );

}


// ======================================================
// PRINT
// ======================================================

function printStaffQueue() {

    const newWindow =
        window.open(
            "",
            "_blank"
        );


    const rows =
        visibleStaffAppointments
            .map(
                function (appointment) {

                    const slot =
                        appointment.slot_info || {};


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
                MediSync Staff Queue
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
                    background: #f1f5f9;
                }

            </style>

        </head>

        <body>

            <h1>
                MediSync Patient Queue
            </h1>

            <table>

                <thead>

                    <tr>

                        <th>Patient</th>

                        <th>Patient ID</th>

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
        appointment.slot_info || {};


    return `${slot.date || ""} ${slot.time || ""}`;

}


function showCurrentDate() {

    const date =
        new Date();


    document.getElementById(
        "staffCurrentDate"
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


function showStaffMessage(
    message,
    type
) {

    const box =
        document.getElementById(
            "staffMessage"
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
