# MediSync — Intelligent Healthcare Triage & Management System

MediSync is a full-stack web application designed to streamline patient intake, symptom assessment, and hospital appointment routing through an AI-assisted triage interface.

## Key Features
* **AI Smart Triage Assistant:** Powered by `gpt-oss-20b` via the Groq API, providing fast symptom analysis and department routing with deterministic constraints (`temperature=0.1`) and hidden Chain-of-Thought reasoning (`<thinking>` XML stripping).
* **Interactive 2.5D Body Map:** Allows patients to visually select symptom locations directly on the frontend for intuitive triage input.
* **Security & Guardrails:** Implements a 3-layer input sanitization pipeline (character limits, regex symbol filtering, and prompt-injection prefix blocking), strict non-diagnostic safety boundaries, and graceful `try/except` fallback handling.
* **Admin & Doctor Directory Integration:** Connects a lightweight Python Flask backend with MongoDB to dynamically fetch live specialist records and manage patient appointments.

## Tech Stack
* **Backend:** Python, Flask
* **Database:** MongoDB
* **AI Inference:** Groq API (`gpt-oss-20b`)
* **Frontend:** HTML5, CSS3, JavaScript (Interactive 2.5D Body Map)
