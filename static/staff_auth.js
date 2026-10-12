// ==========================================
// MediSync - Staff / Doctor Login
// ==========================================

document.addEventListener("DOMContentLoaded", function () {

    const form = document.getElementById("staffLoginForm");

    form.addEventListener("submit", handleStaffLogin);

});


async function handleStaffLogin(event) {

    event.preventDefault();


    const username =
        document.getElementById("staff-user").value.trim();

    const password =
        document.getElementById("staff-pass").value.trim();

    const button =
        document.getElementById("loginButton");


    if (!username || !password) {

        showLoginMessage(
            "Please enter your username and password.",
            "error"
        );

        return;
    }


    const originalButton =
        button.innerHTML;


    button.disabled = true;

    button.innerHTML = `
        <i class="fa-solid fa-spinner fa-spin"></i>
        Signing In...
    `;


    try {

        const response = await fetch("/api/auth/login", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                username: username,
                password: password
            })

        });


        const data = await response.json();


        if (!response.ok || !data.success) {

            throw new Error(
                data.message || "Login failed."
            );

        }


        // Redirect based on role
        if (data.role === "staff") {

            window.location.href =
                "/staff/dashboard";

        }

        else if (data.role === "doctor") {

            window.location.href =
                "/doctor/dashboard";

        }

        else {

            showLoginMessage(
                "This portal is only for Staff and Doctors.",
                "error"
            );

            await fetch("/api/auth/logout", {
                method: "POST"
            });

            button.disabled = false;
            button.innerHTML = originalButton;

        }


    }

    catch (error) {

        console.error(error);


        showLoginMessage(
            error.message ||
            "Unable to login.",
            "error"
        );


        button.disabled = false;

        button.innerHTML =
            originalButton;

    }

}


function showLoginMessage(message, type) {

    const box =
        document.getElementById("loginMessage");


    box.textContent =
        message;


    box.className =
        `status-message ${type}`;

}

