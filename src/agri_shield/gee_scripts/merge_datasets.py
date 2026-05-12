import pandas as pd
import os
import glob
import random

# 1. PATH CONFIGURATION
# Root directory for synced GEE data (Drive folder)
GEE_DATA_DIR = r"f:\MTN - Main Desktop\Privy  - Agricultural Drought\src\dashboard\data\gee_exports"
# Output file for the Dashboard (System Link)
SYSTEM_STATS_FILE = r"f:\MTN - Main Desktop\Privy  - Agricultural Drought\src\dashboard\data\gee_exports\TerraDrought_Farmer_Stats.csv"
# Master Time-Series DB (For LSTM Training)
MASTER_DATABASE_FILE = r"f:\MTN - Main Desktop\Privy  - Agricultural Drought\Binga_Unified_ML_Database_2025.csv"

def merge_and_link_system():
    print("🚀 Starting Terra Drought Data Merge & System Linkage...")

    # A. LOAD MASTER TIME-SERIES (From our new GEE Master Engine)
    gee_master_files = glob.glob(os.path.join(GEE_DATA_DIR, "TerraDrought_Binga_Master_Database*.csv"))
    
    if not gee_master_files:
        print(f"❌ Error: Could not find Master Database in {GEE_DATA_DIR}")
        return

    df_master = pd.read_csv(gee_master_files[0])
    df_master = df_master.sort_values(by='Date').reset_index(drop=True)
    
    print(f"✅ Loaded Master Time-Series with {len(df_master)} monthly records.")
    
    # Save the consolidated database for the LSTM pipeline
    df_master.to_csv(MASTER_DATABASE_FILE, index=False)
    print(f"📁 LSTM Database updated at: {MASTER_DATABASE_FILE}")

    # B. LINK TO SYSTEM (Dashboard)
    # We take the most recent month's data to display on the map
    latest_indices = df_master.iloc[-1].to_dict()
    print(f"📊 Mapping latest data indices ({latest_indices['Date']}) to farmers...")

    # For the system linkage, we map this data onto farmer entities
    farmers = [
        {"name": "Binga East Communal", "lat": -17.58, "lon": 27.28, "crop": "Maize"},
        {"name": "Sengwa Basin Plot", "lat": -17.82, "lon": 28.12, "crop": "Cotton"},
        {"name": "Siachilaba Smallholdings", "lat": -17.91, "lon": 27.15, "crop": "Sorghum"},
        {"name": "Manjolo Central", "lat": -17.65, "lon": 27.35, "crop": "Maize"},
        {"name": "Tinde Agricultural Block", "lat": -18.25, "lon": 27.18, "crop": "Livestock/Fodder"}
    ]

    output_records = []
    for f in farmers:
        # Calculate Predicted Risk Score (1=Severe to 4=Healthy)
        vhi = latest_indices.get('VHI', 50)
        rai = latest_indices.get('RAI', 0)
        
        # Simple logical trigger for "Predicted_Risk"
        if vhi < 15 or rai < -2.0: risk = 1
        elif vhi < 35 or rai < -1.0: risk = 2
        elif vhi < 55 or rai < -0.5: risk = 3
        else: risk = 4
        
        record = {
            "name": f["name"],
            "Predicted_Risk": risk,
            "NDVI": latest_indices.get('NDVI', 0),
            "VHI": latest_indices.get('VHI', 0),
            "RAI": latest_indices.get('RAI', 0),
            "crop": f["crop"],
            "zb_mobile": f"2637{random.randint(71000000, 78999999)}",
            "zb_account": f"1100-{random.randint(1000,9999)}-001",
            ".geo": f'{{"type":"Point","coordinates":[{f["lon"]},{f["lat"]}]}}'
        }
        output_records.append(record)

    df_system = pd.DataFrame(output_records)
    df_system.to_csv(SYSTEM_STATS_FILE, index=False)
    
    print(f"🔔 System Link Completed. Dashboard stats updated at: {SYSTEM_STATS_FILE}")
    print(f"   (Calculated Risks: {df_system['Predicted_Risk'].value_counts().to_dict()})")

if __name__ == "__main__":
    merge_and_link_system()
