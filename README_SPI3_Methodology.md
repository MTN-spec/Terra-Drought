# Justification and Methodology for SPI-3 in Google Earth Engine

The **3-Month Standardized Precipitation Index (SPI-3)** is the globally recognized standard indicator for monitoring **Agricultural Drought**. 

While SPI-1 captures immediate meteorological rainfall deficits (weather patterns), SPI-3 captures the accumulated deficit over a rolling 90-day period. This 3-month scale perfectly mirrors the time it takes for deeper soil moisture reserves to deplete to a level that causes structural damage to crop yields.

## Why SPI-3 is the Goal Standard
By accumulating rainfall over 3 months, you eliminate the "noise" of a single dry week. 
For example: If February is completely dry (low SPI-1), but January and December had torrential record-breaking rainfall, the deep soil is still wet. Therefore, the SPI-3 for February will still show "Normal" or "Wet" conditions, accurately reflecting that the crops are not yet in danger. 

## Technical Implementation in Google Earth Engine

Native SPI requires fitting chronological data to a complex Gamma Probability Distribution, which cannot be done natively within the Earth Engine Javascript Code Editor. 

Instead, this dataset uses the universally accepted proxy: **Standardized Rainfall Anomaly (SRA)** using Z-Score mathematics. 

### The 3-Month Rolling SRA Formula:
`SPI-3 ≈ (Current_3M_Precipitation - Historical_3M_Mean) / Historical_3M_StdDev`

### How the Script (`GEE_SPI3_Monthly_Export.js`) Works:

1.  **Dynamic Look-back (The 3-Month Sum)**:
    For every month in the 25-year timeline, the script mathematically rewinds the clock by 2 months. It queries the CHIRPS daily precipitation dataset for all days within that 3-month window and sums them together. 
    * *Example: For the data point "March 2018", it sums all rain from Jan 1, 2018 – Mar 31, 2018.*
2.  **Historical Normalization (The Mean)**:
    It then aggregates all 25 specific instances of that 3-month window (e.g., all 25 Jan-Feb-Mar blocks from 2000 to 2025) to calculate what the "normal" amount of rain is for that specific season.
3.  **Variance (The Standard Deviation)**:
    It calculates the standard deviation across those 25 historical blocks to understand how widely the rainfall naturally fluctuates during that season.
4.  **The Result**:
    By subtracting the historical mean from the current 3-month sum, and dividing by the standard deviation, it outputs a pristine Z-Score. 

### Output Interpretation
The resulting CSV database provides values typically ranging from -3.0 to +3.0.
*   **0**: Exactly normal rainfall for this 3-month season.
*   **+1.5 to +2.0**: Very Wet.
*   **-1.0 to -1.49**: Moderate Agricultural Drought.
*   **-1.5 to -1.99**: Severe Agricultural Drought.
*   **-2.0 or less**: Extreme Agricultural Drought.

This SPI-3 output is the perfect companion to VHI for training predictive Machine Learning models on historical crop failures.
