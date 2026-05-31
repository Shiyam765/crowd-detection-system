import os
import base64
import time
import collections
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import Response, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
import yagmail
from model_utils import CrowdPredictor

load_dotenv()

app = FastAPI(title="Crowd Density API")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize model
try:
    predictor = CrowdPredictor("yolov8n.pt")
except Exception as e:
    print(f"Error loading model: {e}")
    predictor = None

# Alert configuration
EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
EMAIL_RECIPIENT = os.getenv("EMAIL_RECIPIENT", EMAIL_USER)

last_email_time = 0
EMAIL_COOLDOWN_SECONDS = 300  # 5 minutes

# System Configuration State
class AppConfig:
    current_warning_threshold: int = 10
    current_critical_threshold: int = 20
    predicted_warning_threshold: int = 8
    predicted_critical_threshold: int = 18

app_config = AppConfig()

class ConfigUpdate(BaseModel):
    current_warning_threshold: int
    current_critical_threshold: int
    predicted_warning_threshold: int
    predicted_critical_threshold: int

# History tracking for predictive analytics
history = collections.deque(maxlen=200)
startup_time = time.time()

def update_history(count):
    current_time = time.time()
    history.append((current_time, count))
    
    # Keep entries up to 300 seconds (5 minutes) for a longer history window
    while history and current_time - history[0][0] > 300:
        history.popleft()

def get_trend_and_prediction():
    if len(history) < 5:
        latest_val = history[-1][1] if history else 0
        forecast_path = [{"x": dt, "y": latest_val, "y_min": max(0, latest_val - 1), "y_max": latest_val + 1} 
                         for dt in [0, 60, 120, 240, 360, 480, 600]]
        return 0.0, latest_val, forecast_path
        
    times = np.array([x[0] for x in history])
    counts = np.array([x[1] for x in history])
    
    t_latest = times[-1]
    t = times - t_latest
    
    if t[0] == 0:
        latest_val = counts[-1]
        forecast_path = [{"x": dt, "y": latest_val, "y_min": max(0, latest_val - 1), "y_max": latest_val + 1} 
                         for dt in [0, 60, 120, 240, 360, 480, 600]]
        return 0.0, latest_val, forecast_path

    # Compute exponential weights for Locally Weighted Regression (decay constant = 0.015)
    w = np.exp(0.015 * t)
    
    try:
        # Locally Weighted Linear Regression: fit a line y = slope * t + intercept
        slope, intercept = np.polyfit(t, counts, 1, w=w)
    except Exception:
        try:
            slope, intercept = np.polyfit(t, counts, 1)
        except Exception:
            latest_val = counts[-1]
            forecast_path = [{"x": dt, "y": latest_val, "y_min": max(0, latest_val - 1), "y_max": latest_val + 1} 
                             for dt in [0, 60, 120, 240, 360, 480, 600]]
            return 0.0, latest_val, forecast_path

    # Compute standard deviation of residuals of the linear fit
    pred_historical = slope * t + intercept
    residuals = counts - pred_historical
    std_error = float(np.std(residuals))
    if std_error < 1.0:
        std_error = 1.0

    # Generate 10-minute forecast path using Damped Linear Trend
    forecast_path = []
    latest_count = counts[-1]
    
    # phi controls how fast the trend flattens out (0.993 per second means a half-life of ~100 seconds)
    phi = 0.993
    
    for dt in [0, 60, 120, 240, 360, 480, 600]:
        # Cumulative damping multiplier: sum_{i=1}^{dt} phi^i
        if dt == 0:
            damped_time = 0.0
        else:
            damped_time = (1.0 - phi**dt) / (1.0 - phi)
            
        y_pred = latest_count + slope * damped_time
        
        # Apply safety clamps:
        # 1. Never negative
        # 2. Never exceed a logical maximum capacity to prevent runaway predictions
        max_logical_cap = max(100.0, latest_count * 2.5, app_config.current_critical_threshold * 2.0)
        y_pred = max(0.0, min(y_pred, max_logical_cap))
        
        # Confidence interval expands over time
        time_factor = dt / 60.0
        err_margin = 1.96 * std_error * np.sqrt(1.0 + time_factor)
        
        y_min = max(0.0, y_pred - err_margin)
        y_max = min(y_pred + err_margin, max_logical_cap + err_margin)
        
        forecast_path.append({
            "x": int(dt),
            "y": round(y_pred, 1),
            "y_min": round(y_min, 1),
            "y_max": round(y_max, 1)
        })

    predicted_count_10m = int(round(forecast_path[-1]["y"]))
    trend_per_min = slope * 60.0
    
    return float(trend_per_min), predicted_count_10m, forecast_path

def send_alert_email(count, is_predictive=False, predicted_count=0):
    global last_email_time
    if not EMAIL_USER or not EMAIL_PASSWORD or EMAIL_USER == "your_email@gmail.com":
        return
        
    current_time = time.time()
    if current_time - last_email_time < EMAIL_COOLDOWN_SECONDS:
        return
        
    try:
        yag = yagmail.SMTP(user=EMAIL_USER, password=EMAIL_PASSWORD)
        
        if is_predictive:
            subject = f"EARLY WARNING: Crowd Density Predicted to hit Critical ({predicted_count} people)"
            contents = [
                f"<h2>Proactive Crowd Alert</h2>",
                f"<p>The crowd density is rising rapidly.</p>",
                f"<p><strong>Current Count: {count} people</strong></p>",
                f"<p><strong>Predicted Count in 10 min: {predicted_count} people</strong></p>",
                f"<p>Please prepare to take action.</p>"
            ]
        else:
            subject = f"CRITICAL ALERT: High Crowd Density Detected ({count} people)"
            contents = [
                f"<h2>Crowd Density Alert</h2>",
                f"<p>The crowd density prediction system has detected a critical level of people.</p>",
                f"<p><strong>Current Count: {count} people</strong></p>",
                f"<p>Please take immediate action if necessary.</p>"
            ]
            
        yag.send(to=EMAIL_RECIPIENT, subject=subject, contents=contents)
        print("Alert email sent successfully.")
        last_email_time = current_time
    except Exception as e:
        print(f"Failed to send email: {e}")

def process_frame_logic(contents_bytes):
    count, annotated_img_bytes = predictor.predict(contents_bytes)
    
    update_history(count)
    trend, predicted_count, forecast = get_trend_and_prediction()
    
    img_b64 = base64.b64encode(annotated_img_bytes).decode('utf-8')
    
    status = "Safe"
    if count >= app_config.current_critical_threshold:
        status = "Critical"
        send_alert_email(count)
    elif predicted_count >= app_config.predicted_critical_threshold and count >= app_config.predicted_warning_threshold: 
        status = "Warning (Predicting Critical)"
        send_alert_email(count, is_predictive=True, predicted_count=predicted_count)
    elif count >= app_config.current_warning_threshold:
        status = "Warning"
        
    result = {
        "count": count,
        "status": status,
        "trend": round(trend, 1),
        "predicted": predicted_count,
        "forecast": forecast,
        "image": f"data:image/jpeg;base64,{img_b64}"
    }
    if history:
        result["history_point"] = {"x": history[-1][0] - startup_time, "y": history[-1][1]}
    return result

@app.get("/api/config")
def get_config():
    return {
        "current_warning_threshold": app_config.current_warning_threshold,
        "current_critical_threshold": app_config.current_critical_threshold,
        "predicted_warning_threshold": app_config.predicted_warning_threshold,
        "predicted_critical_threshold": app_config.predicted_critical_threshold
    }

@app.post("/api/config")
def update_config(config: ConfigUpdate):
    app_config.current_warning_threshold = config.current_warning_threshold
    app_config.current_critical_threshold = config.current_critical_threshold
    app_config.predicted_warning_threshold = config.predicted_warning_threshold
    app_config.predicted_critical_threshold = config.predicted_critical_threshold
    return {"status": "success"}

@app.get("/api/history")
def get_history():
    # Return normalized times and counts
    if not history:
        return {"times": [], "counts": []}
    
    data = [{"x": x[0] - startup_time, "y": x[1]} for x in history]
    return data

@app.post("/api/predict")
async def predict_crowd(file: UploadFile = File(...)):
    if not predictor:
        raise HTTPException(status_code=500, detail="Model not loaded")
    try:
        contents = await file.read()
        return process_frame_logic(contents)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws/stream")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    if not predictor:
        await websocket.send_json({"error": "Model not loaded"})
        await websocket.close()
        return
        
    history.clear()
        
    try:
        while True:
            data = await websocket.receive_text()
            if "," in data:
                b64_data = data.split(",")[1]
            else:
                b64_data = data
                
            try:
                img_bytes = base64.b64decode(b64_data)
                result = process_frame_logic(img_bytes)
                await websocket.send_json(result)
            except Exception as inner_e:
                print(f"Error processing frame: {inner_e}")
                await websocket.send_json({"error": str(inner_e)})
                
    except WebSocketDisconnect:
        print("Client disconnected from WebSocket")
    except Exception as e:
        print(f"WebSocket error: {e}")

# Mount frontend
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
