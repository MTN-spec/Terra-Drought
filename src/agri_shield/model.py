import os
from dataclasses import dataclass
from typing import Tuple

import numpy as np
import pandas as pd
from sklearn.metrics import mean_squared_error, accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
import xgboost as xgb

try:
    import torch
    import torch.nn as nn
except ImportError:
    torch = None


@dataclass
class TrainResult:
    model: object
    train_score: float
    test_score: float


class TerraDroughtModel:
    def __init__(self, random_state=42):
        self.random_state = random_state
        self.scaler = StandardScaler()
        self.xgb_model = None
        self.rf_model = None

    def preprocess(self, df: pd.DataFrame, target_column: str):
        df = df.dropna().copy()
        y = df[target_column].astype(float)
        X = df.drop(columns=[target_column])
        X_numeric = X.select_dtypes(include=["number"])
        X_scaled = self.scaler.fit_transform(X_numeric)
        return train_test_split(X_scaled, y, test_size=0.2, random_state=self.random_state)

    def train_xgboost(self, X_train: np.ndarray, y_train: np.ndarray, X_test: np.ndarray, y_test: np.ndarray) -> TrainResult:
        model = xgb.XGBRegressor(n_estimators=150, max_depth=5, learning_rate=0.1, random_state=self.random_state)
        model.fit(X_train, y_train)
        preds = model.predict(X_test)
        mse = mean_squared_error(y_test, preds)
        self.xgb_model = model
        return TrainResult(model=model, train_score=model.score(X_train, y_train), test_score=mse)

    def train_random_forest(self, X_train: np.ndarray, y_train: np.ndarray, X_test: np.ndarray, y_test: np.ndarray) -> TrainResult:
        model = RandomForestRegressor(n_estimators=100, max_depth=8, random_state=self.random_state)
        model.fit(X_train, y_train)
        preds = model.predict(X_test)
        mse = mean_squared_error(y_test, preds)
        self.rf_model = model
        return TrainResult(model=model, train_score=model.score(X_train, y_train), test_score=mse)

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        if self.xgb_model is None:
            raise ValueError("Model is not trained yet")
        X_num = df.select_dtypes(include=["number"]).copy()
        X_scaled = self.scaler.transform(X_num)
        return self.xgb_model.predict(X_scaled)


if __name__ == "__main__":
    print("AgriShield Model module run test")
    # Simulated dataset for demonstration
    np.random.seed(42)
    n = 200
    data = pd.DataFrame({
        "rainfall_anomaly": np.random.normal(0, 1, n),
        "ndvi_anomaly": np.random.normal(0, 1, n),
        "drought_index": np.random.uniform(0, 1, n),
        "loss_ratio": np.random.uniform(0, 1, n),
    })

    model = TerraDroughtModel()
    X_train, X_test, y_train, y_test = model.preprocess(data, target_column="loss_ratio")
    result = model.train_xgboost(X_train, y_train, X_test, y_test)
    print(f"XGBoost MSE: {result.test_score:.4f}")

    result_rf = model.train_random_forest(X_train, y_train, X_test, y_test)
    print(f"RF MSE: {result_rf.test_score:.4f}")
