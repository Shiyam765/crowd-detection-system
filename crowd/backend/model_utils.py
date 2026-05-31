import cv2
import numpy as np
from ultralytics import YOLO

class CrowdPredictor:
    def __init__(self, model_path="yolov8n.pt"):
        # Load the YOLOv8 model
        self.model = YOLO(model_path)
        # Class 0 is 'person' in COCO dataset
        self.person_class_id = 0

    def predict(self, image_bytes: bytes):
        # Decode image
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise ValueError("Invalid image")

        # Run inference
        results = self.model(img, classes=[self.person_class_id], conf=0.3, verbose=False)
        
        # Get count
        person_count = 0
        for r in results:
            person_count += len(r.boxes)
            
        # Draw bounding boxes
        annotated_img = results[0].plot()
        
        # Encode back to JPEG
        _, buffer = cv2.imencode('.jpg', annotated_img)
        encoded_image = buffer.tobytes()
        
        return person_count, encoded_image
