from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from .model import TerraDroughtModel
from .indices import compute_ndvi, compute_vci, compute_tci, compute_vhi

app = FastAPI(title="Terra Drought API", version="0.1")

model = TerraDroughtModel()

class FarmPayload(BaseModel):
    farm_id: str
    latitude: float
    longitude: float
    crop: str

class RiskPayload(BaseModel):
    rainfall_anomaly: float
    ndvi_anomaly: float
    drought_index: float
    soil_moisture_index: float
    relative_humidity: float

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/farm/register")
def register_farm(payload: FarmPayload):
    # placeholder persistence path for PostGIS insertion
    return {"message": "Farm registered", "farm_id": payload.farm_id}

@app.post("/risk/calc")
def calculate_risk(payload: RiskPayload):
    # simple index mixing; production should use trained model
    tci_val = compute_tci(payload.drought_index, lst_min=0.0, lst_max=1.0)
    vci_val = compute_vci(payload.ndvi_anomaly, ndvi_min=-1.0, ndvi_max=1.0)
    vhi_val = compute_vhi(vci_val, tci_val)

    base_score = 0.4 * (1 - payload.rainfall_anomaly) + 0.3 * vhi_val / 100.0 + 0.3 * payload.soil_moisture_index / 100.0
    payout_trigger = base_score < 0.5

    return {
        "tci": round(tci_val, 2),
        "vci": round(vci_val, 2),
        "vhi": round(vhi_val, 2),
        "risk_score": round(base_score, 4),
        "payout_trigger": payout_trigger,
    }

@app.post("/model/train")
def train_model():
    # demo synthetic training; replace with true dataset path
    import pandas as pd
    import numpy as np

    n = 120
    df = pd.DataFrame({
        "rainfall_anomaly": np.random.normal(0, 1, n),
        "ndvi_anomaly": np.random.normal(0, 1, n),
        "drought_index": np.random.uniform(0, 1, n),
        "loss_ratio": np.random.uniform(0, 1, n),
    })

    X_train, X_test, y_train, y_test = model.preprocess(df, target_column="loss_ratio")
    result = model.train_xgboost(X_train, y_train, X_test, y_test)

    return {
        "train_score": result.train_score,
        "test_mse": result.test_score,
        "message": "Model training done"}

@app.post("/model/predict")
def predict_risk(payload: RiskPayload):
    # this route expects model trained and payload in dataframe form
    df = {
        "rainfall_anomaly": [payload.rainfall_anomaly],
        "ndvi_anomaly": [payload.ndvi_anomaly],
        "drought_index": [payload.drought_index],
        "soil_moisture_index": [payload.soil_moisture_index],
    }
    import pandas as pd
    x = pd.DataFrame(df)
    try:
        predictions = model.predict(x)
        return {"loss_prediction": float(predictions[0])}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
