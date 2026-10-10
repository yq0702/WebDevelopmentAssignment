let currentRegion = "";
let selectedTags = new Set();

const regionTags = {
    "Head & Neck": ["Throbbing Headache", "Dizziness / Vertigo", "Sore Throat", "Blurred Vision", "Neck Stiffness"],
    "Chest & Heart": ["Sharp Chest Pain", "Shortness of Breath", "Heart Palpitations", "Pressure / Tightness"],
    "Abdomen & Digestive": ["Sharp Stomach Pain", "Nausea / Vomiting", "Bloating", "Acid Reflux", "Cramping"],
    "Pelvis & Groin": ["Swelling", "Pain during urination", "Pelvic Pain", "Rash / Lesion"],
    "Back & Spine": ["Lower Back Stiffness", "Sharp Shooting Pain", "Numbness in Legs", "Muscle Spasm"],
    "Arms & Hands": ["Shoulder Stiffness", "Wrist Pain", "Numbness in Fingers", "Arm Swelling"],
    "Legs & Feet": ["Knee Pain", "Ankle Sprain", "Foot Swelling", "Difficulty Walking"]
};

function selectRegion(regionName) {
    currentRegion = regionName;
    selectedTags.clear();

    document.querySelectorAll('.body-part').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.body-part').forEach(el => {
        if (el.getAttribute('onclick').includes(regionName)) {
            el.classList.add('selected');
        }
    });

    document.getElementById('selectedRegionText').innerText = regionName;

    const tagsBox = document.getElementById('tagsContainer');
    tagsBox.innerHTML = "";

    const availableTags = regionTags[regionName] || [];
    availableTags.forEach(tagName => {
        const btn = document.createElement('button');
        btn.className = 'tag-btn';
        btn.innerText = tagName;
        btn.onclick = () => toggleTag(btn, tagName);
        tagsBox.appendChild(btn);
    });
}

function toggleTag(buttonElement, tagName) {
    if (selectedTags.has(tagName)) {
        selectedTags.delete(tagName);
        buttonElement.classList.remove('active');
    } else {
        selectedTags.add(tagName);
        buttonElement.classList.add('active');
    }
}

async function analyzeSymptoms() {
    const notes = document.getElementById('symptomNotes').value.trim();
    const resultBox = document.getElementById('resultBox');

    if (!currentRegion) {
        alert("Please click a body region on the map first.");
        return;
    }

    resultBox.style.display = "block";
    resultBox.innerHTML = "<em>Analyzing structured triage inputs...</em>";

    const payload = {
        region: currentRegion,
        tags: Array.from(selectedTags),
        notes: notes
    };

    try {
        const response = await fetch('/api/triage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            resultBox.innerHTML = `
                <h4 style="margin: 0 0 8px 0; color: #0f172a;">Recommended Specialty: ${data.recommended_department}</h4>
                <p style="margin: 0 0 10px 0; color: #334155;">${data.explanation}</p>
                <small style="color: #64748b;">${data.disclaimer}</small>
            `;
        } else {
            resultBox.innerHTML = `<span style="color: red;">Error: ${data.error}</span>`;
        }
    } catch (err) {
        console.error("Triage Error:", err);
        resultBox.innerHTML = `<span style="color: red;">Failed to process triage request.</span>`;
    }
}