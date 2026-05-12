# Soil Moisture Index (SMI) Justification and Methodology

This document outlines the rationale behind using the **NASA FLDAS (Famine Early Warning Systems Network Land Data Assimilation System)** dataset for calculating the Soil Moisture Index (SMI) in Google Earth Engine, and why high-resolution optical satellites like Landsat or Sentinel were avoided.

## Understanding SMI

The **Soil Moisture Index (SMI)** is a critical metric for agricultural drought monitoring. Unlike NDVI or VCI (which measure above-ground vegetation health) or TCI (which measures surface temperature), SMI estimates the actual volumetric water content stored beneath the soil surface, accessible to plant roots.

The formula used to calculate SMI normalizes the current soil moisture against long-term historical minimums and maximums for that specific calendar month, creating a 0-100% scale indicating relative dryness or wetness.

`SMI = 100 * (Current_Soil_Moisture - Historical_Min) / (Historical_Max - Historical_Min)`

## Why FLDAS?

For this Machine Learning pipeline, the `NASA/FLDAS/NOAH01/C/GL/M/V001` dataset (`SoilMoi00_10cm_tavg` band) was selected for several key reasons:

1.  **Direct Soil Moisture Estimation:** FLDAS is a complex land-surface physics model built specifically by NASA and USAID to track food security and agricultural drought in data-sparse regions like Africa. It accurately simulates soil moisture down to a depth of **10 centimeters** by assimilating satellite rainfall (CHIRPS), temperature, radiation, and soil properties.
2.  **Temporal Consistency:** It provides a seamless, gap-free monthly archive extending back through our entire study period (2000–2025). Machine Learning models require consistent, uninterrupted time series data to learn historical patterns without crashing due to 'null' or missing values.
3.  **Agricultural Relevance:** FLDAS was explicitly designed for agricultural monitoring (FEWS NET). It understands how soil retains water over time, making it an excellent leading indicator for predicting crop stress before it becomes visible to optical satellites.

## Why Not Landsat or Sentinel?

While **Landsat (30m)** and **Sentinel-2 (10m)** offer vastly superior spatial resolutions compared to FLDAS (11km), they are completely unsuitable for the direct measurement of deep soil moisture in an automated, long-term Machine Learning database for several reasons:

1.  **Optical Constraints (They Cannot See Underground):**
    Landsat and Sentinel are *optical* and *thermal* satellites. They take photographs of the Earth's surface. They can measure surface wetness (puddles) or the temperature of the top millimeter of soil crust, but they **cannot physically measure volumetric water trapped 10cm underground** where plant roots live.

2.  **Cloud Cover and Temporal Gaps:**
    Optical satellites cannot see through clouds. During the wet season in Zimbabwe, continuous cloud cover can result in months of missing Landsat or Sentinel imagery. A Machine Learning database requires a continuous 300+ month timeline without gaps. FLDAS, being an assimilation model that uses microwave and interpolated data, provides a 100% complete dataset regardless of clouds.

3.  **Complex Indirect Estimation:**
    While it is *theoretically* possible to infer soil moisture from Landsat/Sentinel using incredibly complex algorithms (like the Triangle Method or TVDI - Temperature Vegetation Dryness Index), these methods are highly inaccurate over large scales. They require a perfectly clear day with both bare soil and full vegetation present in the same image to calibrate correctly. This is mathematically unstable for an automated 25-year script and prone to producing garbage data during dense rainy seasons.

4.  **The Sentinel-1 Radar Exception:**
    Sentinel-1 is a Radar satellite (SAR) that *can* penetrate clouds and estimate surface soil moisture based on backscatter physics. However, computing a 25-year, district-wide Sentinel-1 soil moisture time-series in Google Earth Engine is computationally devastating (causing "Memory Limit Exceeded" crashes), and Sentinel-1 data only began in **2014**, ruining our goal of a continuous 2000-2025 training dataset.

## Summary

The goal of this database is to provide an ML model with reliable, gap-free, scientifically sound regional indicators of agricultural drought.

FLDAS (11km) sacrifices ultra-high spatial resolution in exchange for **scientifically accurate sub-surface soil physics** and **perfect 25-year temporal consistency**. Because we are calculating the spatial mean over the entire Binga District polygon, the 11km resolution is mathematically optimal for capturing regional drought anomalies month-over-month.
