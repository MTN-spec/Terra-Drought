# Terra-Drought System Architecture

Based on the files and codebase in the Terra-Drought repository, here is the comprehensive system architecture of the deployed model and application:

## 1. Machine Learning Architecture (`DroughtHybridModel`)
The core prediction engine uses a PyTorch-based **Hybrid CNN-LSTM architecture** designed to process both spatial imagery and temporal tabular data simultaneously to predict the Vegetation Health Index (VHI). 

*   **Spatial Branch (CNN):** Processes 128x128 localized spatial patches extracted from GeoTIFFs. It uses a 3-layer Convolutional Neural Network (Conv2D -> ReLU -> MaxPool) followed by Global Average Pooling to distill the imagery into a 64-dimensional feature vector.
*   **Temporal Branch (LSTM):** Processes a 6-month historical sequence of 5 environmental indices (NDVI, VCI, TCI, SPI_3, and SMI). It uses a 2-layer LSTM with dropout to capture time-series trends, outputting a 64-dimensional temporal vector.
*   **Fusion Head:** Concatenates the spatial and temporal vectors (128 features total) and passes them through dense linear layers to output the final VHI prediction.
*   **Fallback Model:** If real-time spatial data isn't available or fails to load, the system falls back to a pre-trained **Random Forest predictor** (`drought_predictor.pkl`) relying solely on the tabular database (`Binga_Unified_ML_Database_2000_2025.csv`).

## 2. Data Ingestion & Processing Pipeline
The system relies on background tasks to continuously sync remote research data.
*   **Google Earth Engine (GEE) Sync:** The API authenticates with a Google Service Account to find and download the latest drought imagery (GeoTIFFs) exported by GEE to a specific Drive folder (`GEE_Exports`).
*   **KMZ Parsing Engine:** A local processor reads KML/KMZ files (`binga_farms_final.kmz`), extracts geographic point/polygon geometries, simulates localized ZB banking/mobile profiles, and bundles them into a unified `.csv` and GeoJSON feature collection.
*   **Risk Scoring:** Farm-level risk is calculated as a weighted hybrid score: **70% Regional VHI** + **30% Localized Farm NDVI**.

## 3. Backend Services (`FastAPI`)
The Python backend (`api.py`) acts as the central router and data server.
*   **Inference API:** Endpoints like `/api/predict` run the PyTorch models dynamically.
*   **On-the-fly Tile Server:** A custom, high-performance XYZ tile server (`/api/tiles/{filename}/{z}/{x}/{y}.png`) built with `rasterio`. It dynamically crops, reprojects (EPSG:3857), and normalizes local GeoTIFF arrays into transparent RGBA PNG map tiles for the frontend map UI.
*   **Static Serving:** Directly serves the HTML/JS dashboard and pitch deck assets out of the `src/dashboard` and `src/pitch` directories.

## 4. Deployment Infrastructure
*   **Containerization:** The application is packaged using a custom **Docker** image. Crucially, it builds on top of `ghcr.io/osgeo/gdal:ubuntu-small-3.6.3` rather than a standard Python image. This ensures heavy geospatial C-libraries (like GDAL needed by `rasterio`) compile properly in the cloud.
*   **Application Server:** Runs via **Gunicorn** with a Uvicorn worker class to handle asynchronous requests efficiently (`gunicorn -w 1 -k uvicorn.workers.UvicornWorker`).
*   **Hosting:** Configured for deployment on **Render.com** (using the `Dockerfile` and environment variables like `GOOGLE_CREDENTIALS`) while frontend cross-origin requests are supported via `vercel.json` for **Vercel** integration.
