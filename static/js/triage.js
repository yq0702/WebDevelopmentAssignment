document.addEventListener("DOMContentLoaded", () => {
    // UI & Chat Elements
    const bodyParts = document.querySelectorAll(".body-part");
    const chatMessages = document.getElementById("chat-messages");
    const userInput = document.getElementById("user-input");
    const sendBtn = document.getElementById("send-btn");
    const regionText = document.getElementById("selected-region-text");

    // 2.5D Model Flip Elements
    const flipBtn = document.getElementById("flip-btn");
    const bodyImage = document.getElementById("body-image");
    const hitboxesFront = document.getElementById("hitboxes-front");
    const hitboxesBack = document.getElementById("hitboxes-back");
    let isFrontView = true;

    // 0. Handle Model Flipping
    if (flipBtn) {
        flipBtn.addEventListener("click", () => {
            isFrontView = !isFrontView;
            if (isFrontView) {
                bodyImage.src = "/static/model_front.jpg";
                flipBtn.innerText = "Flip to Back";
                hitboxesFront.style.display = "block";
                hitboxesBack.style.display = "none";
            } else {
                bodyImage.src = "/static/model_back.jpg";
                flipBtn.innerText = "Flip to Front";
                hitboxesFront.style.display = "none";
                hitboxesBack.style.display = "block";
            }
        });
    }

    // 1. Handle Visual Body Map Clicks
    bodyParts.forEach(part => {
        part.addEventListener("click", async function() {
            // Checks for 'data-part' (from the new HTML) or 'data-region' (from your old code)
            const region = this.getAttribute("data-part") || this.getAttribute("data-region");

            if (regionText) {
                regionText.innerHTML = `<strong>Selected:</strong> ${region}`;
            }

            const symptomMessage = `I am experiencing symptoms in my: ${region}`;
            appendMessage(symptomMessage, 'user-message');

            // Send the body map selection to the AI
            await fetchAIResponse(symptomMessage);
        });
    });

    // 2. Handle Text Input
    if (sendBtn) {
        sendBtn.addEventListener("click", async () => {
            const text = userInput.value.trim();
            if (!text) return;

            appendMessage(text, 'user-message');
            userInput.value = '';

            // Send typed text to the AI
            await fetchAIResponse(text);
        });
    }

    // Allow "Enter" key to send message
    if (userInput) {
        userInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                sendBtn.click();
            }
        });
    }

    // 3. Centralized API Fetch Logic
    async function fetchAIResponse(text) {
        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: text })
            });

            const data = await response.json();
            
            if (data.response) {
                appendMessage(data.response, 'ai-message');
            } else if (data.error) {
                // THIS WILL NOW SHOW THE REAL ERROR ON SCREEN
                appendMessage("System Error: " + data.error, 'ai-message');
            } else {
                appendMessage("Error: The AI returned an empty response.", 'ai-message');
            }
        } catch (error) {
            console.error("Fetch Error:", error);
            appendMessage("Server connection failed. Is your Flask Python server running?", 'ai-message');
        }
    }

    // 4. UI Appender & Quick Book Parser
    function appendMessage(text, className) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `message ${className}`;
        
        // Check if the AI's response includes the secret booking trigger
        if (className === 'ai-message' && text.includes("[SHOW_BOOKING_BUTTON]")) {
            // Remove the tag from the text before displaying it
            const cleanText = text.replace("[SHOW_BOOKING_BUTTON]", "").trim();
            msgDiv.innerHTML = cleanText.replace(/\n/g, '<br>');

            // Generate the interactive button
            const bookBtn = document.createElement("button");
            bookBtn.className = "quick-book-btn";
            bookBtn.innerText = "📅 Quick Book Appointment";
            
            bookBtn.onclick = () => {
                alert("Booking System Triggered! This will connect to your scheduling database.");
            };
            
            msgDiv.appendChild(bookBtn);
        } else {
            // Standard message output with line breaks
            msgDiv.innerHTML = text.replace(/\n/g, '<br>');
        }

        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll to bottom
    }
});