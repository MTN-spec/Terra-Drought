# Vegetation Condition Index (VCI) Analysis Logic

## The Concept of "Current NDVI" ($NDVI_i$)

In the Google Earth Engine script `GEE_VCI_Monthly_Export.js`, the term **"Current NDVI"** (represented mathematically as $NDVI_i$) refers to the specific spatial aggregation of vegetation greenness for any single month being currently analyzed within the timeline.

Because MODIS (MOD13Q1) provides 16-day composites natively, the script aggregates these images to create a unified **Monthly Maximum Value Composite (MVC)**. This newly combined monthly composite represents the peak "Current NDVI" for that specific month in history.

## The VCI Formula

The Vegetation Condition Index is calculated to assess whether the "Current NDVI" is performing above or below historical expectations for that exact time of year.

The standard VCI formula is:

$$ VCI = \frac{NDVI_i - NDVI_{min}}{NDVI_{max} - NDVI_{min}} \times 100 $$

Where:
*   **$NDVI_i$ ("Current NDVI")**: The Maximum Value Composite for a specific, single month and year (e.g., February 2018).
*   **$NDVI_{min}$ (Historical Minimum)**: The absolute lowest NDVI ever recorded during that *same specific calendar month* (e.g., all Februarys) across the entire 25-year study period (2000-2025).
*   **$NDVI_{max}$ (Historical Maximum)**: The absolute highest NDVI ever recorded during that *same specific calendar month* (e.g., all Februarys) across the entire 25-year study period.

## Interpretation of VCI Values

Because the VCI scales the "Current NDVI" against historical extremes, the resulting value is always a percentage (0% to 100%):

*   **Near 0% (Severe Drought)**: The Current NDVI ($NDVI_i$) is the worst the vegetation has ever been during that specific month in the last 25 years.
*   **Around 50% (Normal Conditions)**: The Current NDVI is exactly average compared to historical maximums and minimums for that month.
*   **Near 100% (Optimal Conditions)**: The Current NDVI is the healthiest the vegetation has ever been during that specific month in the last 25 years.

## Script Implementation Breakdown

In `GEE_VCI_Monthly_Export.js`:

1.  **Isolating "Current NDVI"**: The script iterates chronologically through all 312 months (26 years x 12 months). For every individual month (e.g., Feb 2018), it compiles the 16-day MODIS slices overlapping that time window into one "Current NDVI" image layer. 
2.  **Referencing Historical Statistics**: When computing the formula for Feb 2018, the script reaches over to a static, long-term historical image bank to look up the 25-year minimum ($NDVI_{min}$) and maximum ($NDVI_{max}$) specifically for the month of February.
3.  **Application**: The formula is applied mapping the "Current NDVI" as a percentage of the typical historical range specifically for that month, effectively removing noise caused by expected seasonal drops in vegetation (e.g., during recurring dry seasons).
