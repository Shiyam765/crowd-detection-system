document.addEventListener('DOMContentLoaded', async () => {
    // --- Elements ---
    const fileInput = document.getElementById('imageUpload');
    const outputImage = document.getElementById('outputImage');
    const placeholder = document.getElementById('placeholder');
    const loader = document.getElementById('loader');
    
    const webcamVideo = document.getElementById('webcamVideo');
    const webcamToggleBtn = document.getElementById('webcamToggle');
    
    const crowdCountEl = document.getElementById('crowdCount');
    const densityLevelEl = document.getElementById('densityLevel');
    const densityBar = document.getElementById('densityBar');
    const globalStatus = document.getElementById('globalStatus');
    const pulseRing = document.querySelector('.pulse-ring');
    const alertsList = document.getElementById('alertsList');
    
    const trendValueEl = document.getElementById('trendValue');
    const predictedSizeEl = document.getElementById('predictedSize');
    const themeToggleBtn = document.getElementById('themeToggle');
    const notificationStatusEl = document.getElementById('notificationStatus');

    // Configuration - will be loaded from backend
    let CURRENT_WARNING_THRESHOLD = 10;
    let CURRENT_CRITICAL_THRESHOLD = 20;
    let PREDICTED_WARNING_THRESHOLD = 8;
    let PREDICTED_CRITICAL_THRESHOLD = 18;

    let ws = null;
    let webcamStream = null;
    let captureInterval = null;
    let isWebcamActive = false;
    let isVideoFilePlaying = false;
    let analyticsChart = null;

    // --- Initialization ---
    await loadConfig();
    initTheme();
    await initChart();

    // --- Theme Logic ---
    function initTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'light') {
            document.body.classList.add('light-mode');
            themeToggleBtn.innerText = '🌙 Dark Mode';
        }
        
        themeToggleBtn.addEventListener('click', () => {
            document.body.classList.toggle('light-mode');
            if (document.body.classList.contains('light-mode')) {
                localStorage.setItem('theme', 'light');
                themeToggleBtn.innerText = '🌙 Dark Mode';
            } else {
                localStorage.setItem('theme', 'dark');
                themeToggleBtn.innerText = '☀️ Light Mode';
            }
            // Update chart colors if it exists
            if (analyticsChart) {
                const isLight = document.body.classList.contains('light-mode');
                analyticsChart.options.scales.x.ticks.color = isLight ? '#0f172a' : '#f8fafc';
                analyticsChart.options.scales.x.title.color = isLight ? '#0f172a' : '#f8fafc';
                analyticsChart.options.scales.y.ticks.color = isLight ? '#0f172a' : '#f8fafc';
                analyticsChart.options.scales.y.title.color = isLight ? '#0f172a' : '#f8fafc';
                analyticsChart.options.plugins.legend.labels.color = isLight ? '#0f172a' : '#f8fafc';
                analyticsChart.update();
            }
        });
    }

    async function loadConfig() {
        try {
            const res = await fetch('/api/config');
            const config = await res.json();
            CURRENT_WARNING_THRESHOLD = config.current_warning_threshold;
            CURRENT_CRITICAL_THRESHOLD = config.current_critical_threshold;
            PREDICTED_WARNING_THRESHOLD = config.predicted_warning_threshold;
            PREDICTED_CRITICAL_THRESHOLD = config.predicted_critical_threshold;
            renderDensityLegend();
        } catch(e) {
            console.error("Could not load config", e);
        }
    }

    function renderDensityLegend() {
        const legendEl = document.getElementById('densityLegend');
        if (!legendEl) return;
        legendEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span>🟢 Low:</span> 
                <span style="font-weight:600; font-family:monospace;">0 - ${CURRENT_WARNING_THRESHOLD - 1} people</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid rgba(255,255,255,0.02); margin-top:0.15rem; padding-top:0.15rem;">
                <span>🟡 Medium:</span> 
                <span style="font-weight:600; font-family:monospace;">${CURRENT_WARNING_THRESHOLD} - ${CURRENT_CRITICAL_THRESHOLD - 1} people</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid rgba(255,255,255,0.02); margin-top:0.15rem; padding-top:0.15rem;">
                <span>🔴 High:</span> 
                <span style="font-weight:600; font-family:monospace;">${CURRENT_CRITICAL_THRESHOLD}+ people</span>
            </div>
        `;
    }

    // --- Chart Logic ---
    async function initChart() {
        try {
            const res = await fetch('/api/history');
            let data = await res.json();
            
            const ctx = document.getElementById('analyticsChart').getContext('2d');
            
            const isLight = document.body.classList.contains('light-mode');
            const textColor = isLight ? '#0f172a' : '#f8fafc';

            analyticsChart = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [{
                        label: 'Crowd Density',
                        data: data,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    scales: {
                        x: {
                            type: 'linear',
                            title: { display: true, text: 'Time (s)', color: textColor },
                            ticks: { color: textColor }
                        },
                        y: {
                            beginAtZero: true,
                            title: { display: true, text: 'People', color: textColor },
                            ticks: { color: textColor }
                        }
                    },
                    plugins: {
                        legend: { labels: { color: textColor } }
                    }
                }
            });
        } catch(e) {
            console.error("Failed to initialize chart", e);
        }
    }

    // --- File Upload Logic (Images and Videos) ---
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (isWebcamActive || isVideoFilePlaying) {
            stopWebcam();
            isVideoFilePlaying = false;
        }

        // Check if it's a video file
        if (file.type.startsWith('video/')) {
            playVideoFile(file);
            return;
        }

        // Show loading state for image
        placeholder.style.display = 'none';
        outputImage.style.display = 'none';
        loader.style.display = 'block';

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/api/predict', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Prediction failed');

            const data = await response.json();
            updateDashboard(data.count, data.image, data.trend, data.predicted, data.last_email_time, data.email_cooldown);
            
            if (data.history_point && analyticsChart) {
                analyticsChart.data.datasets[0].data.push(data.history_point);
                analyticsChart.update();
            }
            
        } catch (error) {
            console.error('Error:', error);
            alert('Failed to process image. Make sure the backend is running.');
            loader.style.display = 'none';
            placeholder.style.display = 'block';
        }
    });
    
    function playVideoFile(file) {
        const videoURL = URL.createObjectURL(file);
        webcamVideo.srcObject = null;
        webcamVideo.src = videoURL;
        webcamVideo.loop = true;
        webcamVideo.muted = true;
        
        webcamVideo.onloadeddata = () => {
            webcamVideo.play();
            isVideoFilePlaying = true;
            
            outputImage.style.display = 'none';
            placeholder.style.display = 'none';
            
            // Connect WebSocket
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(`${protocol}//${window.location.host}/ws/stream`);
            
            ws.onopen = () => {
                console.log('WebSocket Connected for Video File');
                if (analyticsChart) {
                    analyticsChart.data.datasets[0].data = []; // Clear chart for new stream
                }
                captureInterval = setInterval(captureAndSendFrame, 500); // 2 FPS
            };

            ws.onmessage = handleWebSocketMessage;

            ws.onclose = () => {
                console.log('WebSocket Disconnected');
            };
        };
    }

    // --- Webcam & WebSocket Logic ---
    webcamToggleBtn.addEventListener('click', () => {
        if (isWebcamActive || isVideoFilePlaying) {
            stopWebcam();
            isVideoFilePlaying = false;
        } else {
            startWebcam();
        }
    });

    async function startWebcam() {
        try {
            webcamVideo.src = "";
            webcamStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            webcamVideo.srcObject = webcamStream;
            webcamVideo.style.display = 'block';
            outputImage.style.display = 'none';
            placeholder.style.display = 'none';
            
            isWebcamActive = true;
            webcamToggleBtn.innerText = 'Stop Webcam';
            webcamToggleBtn.classList.remove('secondary');
            webcamToggleBtn.classList.add('danger');

            // Connect WebSocket
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(`${protocol}//${window.location.host}/ws/stream`);
            
            ws.onopen = () => {
                console.log('WebSocket Connected');
                if (analyticsChart) {
                    analyticsChart.data.datasets[0].data = []; // Clear chart
                }
                captureInterval = setInterval(captureAndSendFrame, 500); // 2 FPS
            };

            ws.onmessage = handleWebSocketMessage;

            ws.onclose = () => {
                console.log('WebSocket Disconnected');
                if (isWebcamActive) stopWebcam();
            };

        } catch (err) {
            console.error("Error accessing webcam: ", err);
            alert("Could not access webcam. Ensure you are using localhost or HTTPS.");
        }
    }
    
    function handleWebSocketMessage(event) {
        const data = JSON.parse(event.data);
        if (data.error) {
            console.error("WS Error:", data.error);
            return;
        }
        
        outputImage.src = data.image;
        outputImage.style.display = 'block';
        outputImage.style.position = 'absolute'; 
        outputImage.style.top = '0';
        outputImage.style.left = '0';
        outputImage.style.width = '100%';
        outputImage.style.height = '100%';
        outputImage.style.objectFit = 'contain';
        outputImage.style.zIndex = '10';
        
        updateDashboard(data.count, null, data.trend, data.predicted, data.last_email_time, data.email_cooldown);

        if (data.history_point && analyticsChart) {
            const chartData = analyticsChart.data.datasets[0].data;
            chartData.push(data.history_point);
            
            // Limit historical data to last 600 entries (since 2 FPS, 600 entries is 300 seconds of history)
            if (chartData.length > 600) {
                chartData.shift();
            }
            analyticsChart.update();
        }
    }

    function stopWebcam() {
        isWebcamActive = false;
        webcamToggleBtn.innerText = 'Start Webcam';
        webcamToggleBtn.classList.remove('danger');
        webcamToggleBtn.classList.add('secondary');
        
        if (captureInterval) clearInterval(captureInterval);
        
        if (ws) {
            ws.close();
            ws = null;
        }

        if (webcamStream) {
            webcamStream.getTracks().forEach(track => track.stop());
            webcamStream = null;
        }
        
        webcamVideo.pause();
        webcamVideo.src = "";
        webcamVideo.srcObject = null;
        
        webcamVideo.style.display = 'none';
        outputImage.style.position = 'static';
        outputImage.style.display = 'none';
        placeholder.style.display = 'block';
    }

    function captureAndSendFrame() {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const canvas = document.createElement('canvas');
        canvas.width = webcamVideo.videoWidth;
        canvas.height = webcamVideo.videoHeight;
        
        if (canvas.width === 0) return; // Video not ready

        const ctx = canvas.getContext('2d');
        ctx.drawImage(webcamVideo, 0, 0, canvas.width, canvas.height);
        
        // Compress the image slightly for speed
        const dataURL = canvas.toDataURL('image/jpeg', 0.6);
        ws.send(dataURL);
    }

    // --- Dashboard UI Logic ---
    function updateDashboard(count, imageData, trend = 0, predicted = 0, lastEmailTime = 0, emailCooldown = 300) {
        if (imageData) {
            loader.style.display = 'none';
            outputImage.src = imageData;
            outputImage.style.display = 'block';
            outputImage.style.position = 'static';
        }

        animateValue(crowdCountEl, parseInt(crowdCountEl.innerText) || 0, count, 500);

        let status = 'Safe';
        let colorVar = '--safe-color';
        let densityText = 'Low';
        let barPercentage = Math.min((count / CURRENT_CRITICAL_THRESHOLD) * 100, 100); 

        // Update Email Status
        if (lastEmailTime > 0) {
            const now = Date.now() / 1000;
            const timeSince = now - lastEmailTime;
            if (timeSince < emailCooldown) {
                const remaining = Math.ceil(emailCooldown - timeSince);
                const min = Math.floor(remaining / 60);
                const sec = remaining % 60;
                notificationStatusEl.innerText = `Email: Cooldown (${min}m ${sec}s)`;
                notificationStatusEl.style.color = 'var(--warning-color)';
            } else {
                notificationStatusEl.innerText = 'Email: Ready';
                notificationStatusEl.style.color = 'var(--safe-color)';
            }
        } else {
            notificationStatusEl.innerText = 'Email: Ready';
            notificationStatusEl.style.color = 'var(--safe-color)';
        }

        // Update Trend UI
        let trendSign = trend > 0 ? '+' : '';
        let trendIcon = trend > 0 ? '📈' : (trend < 0 ? '📉' : '➖');
        trendValueEl.innerText = `${trendIcon} ${trendSign}${trend.toFixed(1)} / min`;
        predictedSizeEl.innerText = `Predicted Size: ${predicted} people`;

        // Handle Status logic including Predictive warning
        if (count >= CURRENT_CRITICAL_THRESHOLD) {
            status = 'Critical';
            colorVar = '--critical-color';
            densityText = 'High';
            if (globalStatus.innerText !== 'Critical') {
                addAlert(`Critical crowd density detected: ${count} people`, 'critical');
            }
        } else if (predicted >= PREDICTED_CRITICAL_THRESHOLD && count >= PREDICTED_WARNING_THRESHOLD) {
            status = 'Warning (Predicting Critical)';
            colorVar = '--warning-color';
            densityText = 'Rising Fast';
            if (globalStatus.innerText !== 'Warning (Predicting Critical)') {
                addAlert(`Early Warning: Predicted critical mass (${predicted} people)`, 'warning');
            }
        } else if (count >= CURRENT_WARNING_THRESHOLD) {
            status = 'Warning';
            colorVar = '--warning-color';
            densityText = 'Medium';
            if (!globalStatus.innerText.startsWith('Warning') && globalStatus.innerText !== 'Critical') {
                addAlert(`Warning: Crowd gathering detected: ${count} people`, 'warning');
            }
        }

        globalStatus.innerText = status;
        globalStatus.style.color = `var(${colorVar})`; 
        
        let rgbaColor = 'rgba(16, 185, 129, 0.2)';
        if (colorVar === '--warning-color') {
            rgbaColor = 'rgba(245, 158, 11, 0.2)';
        } else if (colorVar === '--critical-color') {
            rgbaColor = 'rgba(239, 68, 68, 0.2)';
        }

        globalStatus.style.backgroundColor = rgbaColor;
        globalStatus.style.borderColor = rgbaColor.replace('0.2', '0.3');
        
        pulseRing.style.backgroundColor = `var(${colorVar})`;
        pulseRing.className = `pulse-ring ${colorVar === '--critical-color' ? 'critical' : (colorVar === '--warning-color' ? 'warning' : 'safe')}`;
        
        densityLevelEl.innerText = densityText;
        densityBar.style.width = `${barPercentage}%`;
        densityBar.style.backgroundColor = `var(${colorVar})`;
    }

    function addAlert(message, type) {
        const emptyAlert = alertsList.querySelector('.empty');
        if (emptyAlert) emptyAlert.remove();

        const li = document.createElement('li');
        li.className = `alert-item ${type}`;
        
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        li.innerHTML = `
            <span>${message}</span>
            <span class="alert-time">${timeString}</span>
        `;
        
        alertsList.prepend(li);

        if (alertsList.children.length > 5) {
            alertsList.removeChild(alertsList.lastChild);
        }
    }

    function animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            obj.innerHTML = Math.floor(progress * (end - start) + start);
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }
});
