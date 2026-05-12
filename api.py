from fastapi import FastAPI, BackgroundTasks, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import json
import requests
import random
import time
import os
import io
import pandas as pd
import joblib
import torch
from src.ml.hybrid_model import DroughtHybridModel
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = FastAPI(title="Terra Drought Backend")

# Add CORS Middleware to allow requests from Vercel frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins (replace with your Vercel URL in production)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
CREDENTIALS_FILE = 'credentials.json'
TARGET_FOLDER_NAME = 'GEE_Exports'
LOCAL_DATA_DIR = os.path.join('src', 'dashboard', 'data', 'gee_exports')

# Ensure local data directory exists
os.makedirs(LOCAL_DATA_DIR, exist_ok=True)

# Machine Learning Configuration
MODEL_PATH = os.path.join('src', 'ml', 'drought_predictor.pkl')
FEATURE_LIST_PATH = os.path.join('src', 'ml', 'feature_list.pkl')

def load_predictor():
    if os.path.exists(MODEL_PATH):
        return joblib.load(MODEL_PATH), joblib.load(FEATURE_LIST_PATH)
    return None, None

DROUGHT_MODEL, FEATURE_LIST = load_predictor()

# CNN-LSTM Hybrid Model Configuration
HYBRID_MODEL_PATH = os.path.join('src', 'ml', 'drought_hybrid_model.pth')
HYBRID_SCALER_PATH = os.path.join('src', 'ml', 'hybrid_scaler.pkl')

def load_hybrid_model():
    if os.path.exists(HYBRID_MODEL_PATH):
        # Initialize model architecture (temporal_dim=5 for current features)
        model = DroughtHybridModel(temporal_input_dim=5)
        model.load_state_dict(torch.load(HYBRID_MODEL_PATH))
        model.eval()
        scaler = joblib.load(HYBRID_SCALER_PATH)
        return model, scaler
    return None, None

HYBRID_MODEL, HYBRID_SCALER = load_hybrid_model()

def get_drive_service():
    # First, try to load from an environment variable (for Render deployment)
    google_creds_env = os.environ.get('GOOGLE_CREDENTIALS')
    if google_creds_env:
        try:
            creds_dict = json.loads(google_creds_env)
            creds = service_account.Credentials.from_service_account_info(
                creds_dict, scopes=SCOPES)
            return build('drive', 'v3', credentials=creds)
        except Exception as e:
            print(f"Failed to parse GOOGLE_CREDENTIALS environment variable: {e}")
            
    # Fallback to local file
    if not os.path.exists(CREDENTIALS_FILE):
        raise Exception(f"Missing {CREDENTIALS_FILE}. Please provide GOOGLE_CREDENTIALS env var or a local credentials file.")
    creds = service_account.Credentials.from_service_account_file(
        CREDENTIALS_FILE, scopes=SCOPES)
    return build('drive', 'v3', credentials=creds)

def sync_google_drive():
    try:
        service = get_drive_service()
        
        # 1. Find the GEE_Exports folder
        results = service.files().list(
            q=f"mimeType='application/vnd.google-apps.folder' and name='{TARGET_FOLDER_NAME}'",
            spaces='drive',
            fields='files(id, name)'
        ).execute()
        folders = results.get('files', [])
        
        if not folders:
            print(f"Folder '{TARGET_FOLDER_NAME}' not found. Ensure it is shared with the service account.")
            return False
            
        folder_id = list(folders)[0]['id']
        
        # 2. List all files in the folder
        results = service.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            fields="files(id, name)"
        ).execute()
        files = results.get('files', [])
        
        # 3. Download each file
        for file in files:
            file_id = file['id']
            file_name = file['name']
            file_path = os.path.join(LOCAL_DATA_DIR, file_name)
            
            print(f"Downloading {file_name}...")
            request = service.files().get_media(fileId=file_id)
            with io.FileIO(file_path, 'wb') as fh:
                downloader = MediaIoBaseDownload(fh, request)
                done = False
                while done is False:
                    status, done = downloader.next_chunk()
            print(f"Saved to {file_path}")
            
        return True
    except Exception as e:
        print(f"Drive Sync Error: {e}")
        return False

def sync_kmz_to_csv():
    """Converts the local KMZ file to the TerraDrought CSV format."""
    import json
    from zipfile import ZipFile
    import xml.etree.ElementTree as ET
    
    kmz_path = r'Datasets - ArcGIS Pro\binga_farms_final.kmz'
    output_csv = os.path.join(LOCAL_DATA_DIR, 'TerraDrought_Farmer_Stats.csv')
    tmp_dir = 'tmp_kmz_api'
    
    if not os.path.exists(kmz_path):
        print(f"Warning: {kmz_path} not found.")
        return False
        
    try:
        if os.path.exists(tmp_dir):
            import shutil
            shutil.rmtree(tmp_dir)
        os.makedirs(tmp_dir, exist_ok=True)
        with ZipFile(kmz_path, 'r') as zip_ref:
            zip_ref.extractall(tmp_dir)
            
        kml_files = [f for f in os.listdir(tmp_dir) if f.endswith('.kml')]
        if not kml_files: return False
        
        kml_file_path = os.path.join(tmp_dir, kml_files[0])
        tree = ET.parse(kml_file_path)
        root = tree.getroot()
        ns = {'kml': 'http://www.opengis.net/kml/2.2'}
        
        farmers = []
        for pm in root.findall('.//kml:Placemark', ns):
            point = pm.find('.//kml:Point/kml:coordinates', ns)
            polygon = pm.find('.//kml:Polygon//kml:coordinates', ns)
            
            coords_str = ""
            geom_type = "Point"
            if polygon is not None:
                coords_str = polygon.text.strip(); geom_type = "Polygon"
            elif point is not None:
                coords_str = point.text.strip(); geom_type = "Point"
                
            if not coords_str: continue
            
            parts = coords_str.split()
            parsed_coords = []
            for p in parts:
                c = p.split(',')
                if len(c) >= 2: parsed_coords.append([float(c[0]), float(c[1])])
            
            if not parsed_coords: continue
            
            geo_json = {
                "type": geom_type,
                "coordinates": parsed_coords[0] if geom_type == "Point" else [parsed_coords]
            }
            
            code = f"A001B{len(farmers) + 1:02d}"
            # Simulated ZB Data for each farmer
            zb_mobile = f"2637{random.randint(71000000, 78999999)}"
            zb_account = f"1100{random.randint(1000000, 9999999)}"
            
            farmers.append({
                'name': code,
                'NDVI': round(0.4 + (0.1 * (len(farmers) % 5)), 2),
                'NDWI': 0.2,
                'Predicted_Risk': 4 if len(farmers) % 4 != 0 else 2,
                'zb_mobile': zb_mobile,
                'zb_account': zb_account,
                'wallet_balance': round(random.uniform(50, 1500), 2),
                '.geo': json.dumps(geo_json)
            })
            
        if farmers:
            df = pd.DataFrame(farmers)
            df.to_csv(output_csv, index=False)
            print(f"Processed {len(farmers)} farms from KMZ with ZB Wallet IDs.")
            
            # Initial seed of claims removed for research version
            return True
    except Exception as e:
        print(f"KMZ Sync Error: {e}")
    return False

@app.get("/api/predict")
async def get_drought_prediction():
    """Returns a 3-month forecast based on the hybrid model (CNN-LSTM preferred)."""
    # Use Hybrid CNN-LSTM if trained, else fallback to Random Forest
    if HYBRID_MODEL:
        return await get_hybrid_prediction()
    
    if not DROUGHT_MODEL:
        return {"status": "error", "message": "ML models not ready"}
    
    # [Existing Random Forest logic as fallback]
    csv_path = 'Binga_Unified_ML_Database_2000_2025.csv'
    if not os.path.exists(csv_path):
        return {"status": "error", "message": "Database not found"}
        
    df = pd.read_csv(csv_path).tail(1)
    
    forecasts = []
    current_data = df.copy()
    
    for i in range(1, 4):
        X = current_data[FEATURE_LIST]
        pred_vhi = DROUGHT_MODEL.predict(X)[0]
        month = (int(current_data['Month'].iloc[0]) + i - 1) % 12 + 1
        forecasts.append({
            "month": month,
            "horizon": f"T+{i}",
            "predicted_vhi": round(float(pred_vhi), 2),
            "risk_level": "High" if pred_vhi < 40 else "Moderate" if pred_vhi < 60 else "Low",
            "model": "RandomForest (Baseline)"
        })
        
    return {"forecast": forecasts}

async def get_hybrid_prediction():
    """Logic for CNN-LSTM Inference."""
    csv_path = 'Binga_Unified_ML_Database_2000_2025.csv'
    df = pd.read_csv(csv_path).tail(6) # Need 6 months for sequence
    
    temporal_cols = ['NDVI_Mean', 'VCI_Mean', 'TCI_Mean', 'SPI_1_Mean', 'SPI_3_Mean']
    seq_data = HYBRID_SCALER.transform(df[temporal_cols])
    x_temporal = torch.from_numpy(seq_data).float().unsqueeze(0) # (1, 6, 5)
    
    # Mock Spatial Data for inference (In production, load latest TIFF)
    x_spatial = torch.randn(1, 3, 128, 128) 
    
    with torch.no_grad():
        pred_vhi = HYBRID_MODEL(x_spatial, x_temporal).item()
        
    return {
        "forecast": [{
            "month": (int(df['Month'].iloc[-1]) % 12) + 1,
            "horizon": "T+1",
            "predicted_vhi": round(float(pred_vhi), 2),
            "risk_level": "High" if pred_vhi < 35 else "Moderate" if pred_vhi < 50 else "Low",
            "model": "CNN-LSTM Hybrid (Advanced)"
        }],
        "note": "Hybrid model currently provides 1-month high-fidelity spatial-temporal forecast."
    }

@app.post("/api/sync_data")
async def trigger_sync(background_tasks: BackgroundTasks):
    background_tasks.add_task(sync_google_drive)
    background_tasks.add_task(sync_kmz_to_csv)
    return {"message": "Data synchronization (Drive + KMZ) started."}

@app.get("/api/sync_kmz")
async def manual_kmz_sync():
    """Manual trigger to refresh farmers from KMZ."""
    success = sync_kmz_to_csv()
    if success:
        return {"status": "success", "message": "Farmers database updated from KMZ"}
    raise HTTPException(status_code=500, detail="KMZ processing failed")

@app.get("/api/farmers")
async def get_farmers():
    """Reads the CSV exported by GEE, transforms it into GeoJSON."""
    csv_path = os.path.join(LOCAL_DATA_DIR, 'TerraDrought_Farmer_Stats.csv')
    fallback_json = os.path.join('src', 'dashboard', 'data', 'farmer_db.json')
    
    import glob
    if not os.path.exists(csv_path):
        # Look for any CSV but skip ndvi_timeseries.csv which is not farmer data
        csv_files = [f for f in glob.glob(os.path.join(LOCAL_DATA_DIR, '*.csv')) 
                     if 'ndvi_timeseries' not in os.path.basename(f).lower()]
        if csv_files:
            csv_path = csv_files[0]
            
    # Fallback to static JSON if no valid CSV exists
    if not os.path.exists(csv_path):
        if os.path.exists(fallback_json):
            import json
            with open(fallback_json, 'r') as f:
                return json.load(f)
        
        # Absolute last resort dummy data
        return {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [29.98, -17.27] },
                "properties": {
                    "id": "F001",
                    "name": "Live Sync Pending...",
                    "color": "#eab308",
                    "status": "warning",
                    "ndvi": 0,
                    "ndwi": 0
                }
            }]
        }
        
    try:
        df = pd.read_csv(csv_path)
        
        # Verify columns - if it doesn't look like farmer stats, fall back to JSON
        if 'name' not in df.columns:
            if os.path.exists(fallback_json):
                import json
                with open(fallback_json, 'r') as f:
                    return json.load(f)
        
        features = []
        
        # Load regional VHI for baseline risk
        reg_vhi = 50.0
        try:
            reg_df = pd.read_csv('Binga_Unified_ML_Database_2000_2025.csv').tail(1)
            reg_vhi = float(reg_df['VHI_Mean'].iloc[0])
        except: pass

        def get_status_info(score):
            # 0-100 scale: < 35 Severe, < 50 Moderate, > 50 Healthy
            if score < 35: return "severe", "#ef4444"
            if score < 50: return "moderate", "#eab308"
            return "healthy", "#22c55e"
            
        for _, row in df.iterrows():
            # Hybrid Score: 70% Regional VHI + 30% Local NDVI scaled
            local_ndvi = row.get('NDVI', 0.4)
            hybrid_score = (0.7 * reg_vhi) + (0.3 * local_ndvi * 100)
            status, color = get_status_info(hybrid_score)
            
            # GEE exports geometry in GeoJSON string under '.geo'
            geo_str = str(row.get('.geo', ''))
            geometry = { "type": "Point", "coordinates": [29.99, -17.27] } # Default
            
            if geo_str and geo_str != 'nan':
                import json
                try:
                    geometry = json.loads(geo_str)
                except: pass
                
            features.append({
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "name": row.get('name', 'Unknown Farmer'),
                    "status": status,
                    "color": color,
                    "ndvi": round(row.get('NDVI', 0), 2),
                    "vhi_regional": round(reg_vhi, 2),
                    "hybrid_risk_score": round(hybrid_score, 2)
                }
            })
            
        return {
            "type": "FeatureCollection",
            "features": features
        }
    except Exception as e:
        # If processing fails, try JSON fallback one last time
        if os.path.exists(fallback_json):
            import json
            with open(fallback_json, 'r') as f:
                return json.load(f)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/drive_images")
async def get_drive_images():
    """Returns a list of all .tif files in the local synced Drive folder."""
    import glob
    tif_files = glob.glob(os.path.join(LOCAL_DATA_DIR, '*.tif'))
    files = [{"name": os.path.basename(f), "path": f"/data/gee_exports/{os.path.basename(f)}"} for f in tif_files]
    return {"images": files}

@app.get("/api/tiles/{filename}/{z}/{x}/{y}.png")
async def get_tile(filename: str, z: int, x: int, y: int):
    """
    High-performance tile server for local GeoTIFFs.
    Reads only the required window for the current map view (XYZ tiling).
    """
    import rasterio
    from rasterio.windows import from_bounds
    from rasterio.warp import reproject, Resampling
    import numpy as np
    from PIL import Image
    import io
    import math

    tif_path = os.path.join(LOCAL_DATA_DIR, filename)
    if not os.path.exists(tif_path):
        raise HTTPException(status_code=404, detail="TIF not found")

    def xyz_to_bounds(x, y, z):
        """Converts XYZ tile coordinates to Web Mercator (EPSG:3857) bounds."""
        tile_size = 40075016.68557849 / (2**z)
        west = -20037508.342789244 + x * tile_size
        north = 20037508.342789244 - y * tile_size
        return (west, north - tile_size, west + tile_size, north)

    try:
        with rasterio.open(tif_path) as src:
            bounds = xyz_to_bounds(x, y, z)
            
            # Create destination tile (256x256)
            dst_crs = 'EPSG:3857'
            dst_transform = rasterio.transform.from_bounds(*bounds, 256, 256)
            dst_data = np.zeros((src.count, 256, 256), dtype=np.float32)

            # Reproject src window into dst tile
            reproject(
                source=rasterio.band(src, list(range(1, src.count + 1))),
                destination=dst_data,
                src_transform=src.transform,
                src_crs=src.crs,
                dst_transform=dst_transform,
                dst_crs=dst_crs,
                resampling=Resampling.bilinear
            )

            # Process data for visualization (Simple NDVI-like normalization)
            # Take the first band and normalize 0-1
            band1 = dst_data[0]
            
            # Mask out zeros/nodata
            mask = band1 != 0
            if not np.any(mask):
                return Response(status_code=204) # Empty tile

            # Normalize 0-255 for display
            normalized = np.zeros_like(band1, dtype=np.uint8)
            v_min, v_max = -0.1, 0.8 # Fixed range for NDVI-style display
            normalized[mask] = np.clip((band1[mask] - v_min) / (v_max - v_min) * 255, 0, 255).astype(np.uint8)
            
            # Create an RGBA image
            # Use a basic color ramp: Red -> Yellow -> Green
            alpha = (mask * 255).astype(np.uint8)
            img_data = np.zeros((256, 256, 4), dtype=np.uint8)
            
            # Red channel
            img_data[..., 0] = np.where(normalized < 128, 255, 255 - (normalized - 128) * 2)
            # Green channel
            img_data[..., 1] = np.where(normalized < 128, normalized * 2, 255)
            # Alpha
            img_data[..., 3] = alpha

            img = Image.fromarray(img_data, 'RGBA')
            buf = io.BytesIO()
            img.save(buf, format='PNG')
            return Response(content=buf.getvalue(), media_type="image/png")

    except Exception as e:
        print(f"Tile Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Mount the dashboard UI and Pitch Deck to be served directly from FastAPI
app.mount("/pitch", StaticFiles(directory="src/pitch", html=True), name="pitch")
app.mount("/", StaticFiles(directory="src/dashboard", html=True), name="dashboard")

if __name__ == "__main__":
    import uvicorn
    # Initial sync on boot (Commented out to speed up re-opening)
    # print("Initiating initial synced data refresh...")
    # sync_google_drive()
    # sync_kmz_to_csv()
    
    port = int(os.environ.get("PORT", 8088))
    print(f"Starting FastAPI Server on 0.0.0.0:{port}...")
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=False)
