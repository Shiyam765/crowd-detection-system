document.addEventListener('DOMContentLoaded', async () => {
    const themeToggleBtn = document.getElementById('themeToggle');
    const configForm = document.getElementById('configForm');
    
    const currentWarningInput = document.getElementById('currentWarningThreshold');
    const currentCriticalInput = document.getElementById('currentCriticalThreshold');
    const predictedWarningInput = document.getElementById('predictedWarningThreshold');
    const predictedCriticalInput = document.getElementById('predictedCriticalThreshold');
    
    const saveMessage = document.getElementById('saveMessage');
    const adminSubtitle = document.getElementById('adminSubtitle');
    const guideContainer = document.getElementById('densityClassificationGuide');

    // Theme Logic
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        themeToggleBtn.innerText = '🌙 Dark Mode';
        adminSubtitle.style.color = 'rgba(0,0,0,0.6)';
    }
    
    themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        if (document.body.classList.contains('light-mode')) {
            localStorage.setItem('theme', 'light');
            themeToggleBtn.innerText = '🌙 Dark Mode';
            adminSubtitle.style.color = 'rgba(0,0,0,0.6)';
        } else {
            localStorage.setItem('theme', 'dark');
            themeToggleBtn.innerText = '☀️ Light Mode';
            adminSubtitle.style.color = 'rgba(255,255,255,0.6)';
        }
    });

    // Dynamic Density Classification Guide
    function updateClassificationGuide() {
        const warningVal = parseInt(currentWarningInput.value) || 0;
        const criticalVal = parseInt(currentCriticalInput.value) || 0;
        
        if (!guideContainer) return;
        
        guideContainer.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.05);">
                <span style="font-weight: bold; color: var(--safe-color);">🟢 Low Density</span>
                <span style="font-family: monospace; font-size: 1.05rem;">0 - ${Math.max(0, warningVal - 1)} people</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-top: 0.5rem;">
                <span style="font-weight: bold; color: var(--warning-color);">🟡 Medium Density</span>
                <span style="font-family: monospace; font-size: 1.05rem;">${warningVal} - ${Math.max(warningVal, criticalVal - 1)} people</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 0.5rem;">
                <span style="font-weight: bold; color: var(--critical-color);">🔴 High Density</span>
                <span style="font-family: monospace; font-size: 1.05rem;">${criticalVal}+ people</span>
            </div>
        `;
    }

    currentWarningInput.addEventListener('input', updateClassificationGuide);
    currentCriticalInput.addEventListener('input', updateClassificationGuide);

    // Load current config
    try {
        const res = await fetch('/api/config');
        if(res.ok) {
            const data = await res.json();
            currentWarningInput.value = data.current_warning_threshold;
            currentCriticalInput.value = data.current_critical_threshold;
            predictedWarningInput.value = data.predicted_warning_threshold;
            predictedCriticalInput.value = data.predicted_critical_threshold;
            updateClassificationGuide(); // Render guide
        }
    } catch(e) {
        console.error("Failed to load config", e);
    }

    // Save config
    configForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const current_warning_threshold = parseInt(currentWarningInput.value);
        const current_critical_threshold = parseInt(currentCriticalInput.value);
        const predicted_warning_threshold = parseInt(predictedWarningInput.value);
        const predicted_critical_threshold = parseInt(predictedCriticalInput.value);

        if (current_warning_threshold >= current_critical_threshold) {
            alert("Current Warning threshold must be less than Current Critical threshold.");
            return;
        }
        if (predicted_warning_threshold >= predicted_critical_threshold) {
            alert("Predicted Warning threshold must be less than Predicted Critical threshold.");
            return;
        }

        const saveBtn = document.getElementById('saveBtn');
        saveBtn.innerText = 'Saving...';
        
        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    current_warning_threshold, 
                    current_critical_threshold,
                    predicted_warning_threshold,
                    predicted_critical_threshold
                })
            });
            
            if(res.ok) {
                saveMessage.style.display = 'block';
                setTimeout(() => {
                    saveMessage.style.display = 'none';
                }, 3000);
            } else {
                alert("Failed to save config.");
            }
        } catch(e) {
            console.error("Failed to save", e);
            alert("Error saving config.");
        } finally {
            saveBtn.innerText = 'Save Configuration';
        }
    });
});
