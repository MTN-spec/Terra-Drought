import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
import joblib
import os

# Load the dataset
csv_path = 'Binga_Unified_ML_Database_2000_2025.csv'
if not os.path.exists(csv_path):
    print(f"Error: {csv_path} not found.")
    exit(1)

df = pd.read_csv(csv_path)

# Data Cleaning
# Fill missing values with the mean of the column (simple approach for research demo)
df = df.fillna(df.mean(numeric_only=True))

# Feature Engineering: Lagged values
# We want to predict VHI_Mean in the future based on current indices
df['VHI_Lag1'] = df['VHI_Mean'].shift(1)
df['SPI3_Lag1'] = df['SPI_3_Mean'].shift(1)
df['VCI_Lag1'] = df['VCI_Mean'].shift(1)

# Target: VHI_Mean (Current month)
# Note: For real forecasting, we'd shift the target, 
# but for this "hybrid detection/prediction" model, we'll train to predict VHI from indices.
df = df.dropna()

features = ['Year', 'Month', 'NDVI_Mean', 'VCI_Mean', 'TCI_Mean', 'SPI_1_Mean', 'SPI_3_Mean', 'VHI_Lag1', 'SPI3_Lag1', 'VCI_Lag1']
X = df[features]
y = df['VHI_Mean']

print(f"Training on {len(df)} samples...")

# Train Random Forest Regressor
model = RandomForestRegressor(n_estimators=100, random_state=42)
model.fit(X, y)

# Save the model
model_dir = os.path.join('src', 'ml')
os.makedirs(model_dir, exist_ok=True)
model_path = os.path.join(model_dir, 'drought_predictor.pkl')
joblib.dump(model, model_path)

# Also save the feature list to ensure consistency in api.py
joblib.dump(features, os.path.join(model_dir, 'feature_list.pkl'))

print(f"Model saved to {model_path}")
print("Feature Importance:")
for feat, importance in zip(features, model.feature_importances_):
    print(f"- {feat}: {importance:.4f}")
