# Justification for SPI-1 in Machine Learning Drought Models

The Standardized Precipitation Index (SPI) is a globally recognized metric for detecting and characterizing drought. When calculating SPI, the choice of timescale (e.g., SPI-1, SPI-3, SPI-6) is highly dependent on the target application:

1.  **SPI-1 (1-Month SPI)**: Reflects short-term soil moisture and crop stress, particularly during critical crop growth stages (pollination, grain filling). It responds very quickly to immediate meteorological conditions.
2.  **SPI-3 (3-Month SPI)**: Reflects medium-layer soil moisture conditions. This is the traditional global standard for "Agricultural Drought" because it usually takes 2-3 consecutive months of rainfall deficit for deep-rooted crops to experience structural failure.

### Why use SPI-1 (Proxy) in this Machine Learning Database?

When building a multivariate Machine Learning (ML) model, incorporating SPI-1 alongside VHI (which relies on VCI and TCI) presents a distinct advantage:

1.  **Leading vs. Lagging Indicators**:
    *   **VCI** and **TCI** (and thus **VHI**) are *lagging indicators*. Vegetation takes weeks to physically turn brown and die after water runs out. By the time VHI shows a severe drought, agricultural damage has already occurred.
    *   **SPI-1** is a *leading indicator*. A sudden severe drop in rainfall in the immediate 30-day window (SPI-1 deficit) signals to the ML model that soil moisture is depleting *right now*, allowing the model to predict an impending drop in VCI/TCI in the coming months.
2.  **Resolution Independence**:
    Because ML models excel at finding non-linear relationships across time horizons, feeding the model immediate short-term precipitation shocks (SPI-1) along with the current actual health of the plants (VHI) allows the model's hidden layers to automatically infer the 3-month cumulative effect without forcing a hard-coded 3-month rolling sum onto Earth Engine's memory.
3.  **Earth Engine RAM Constraints**:
    Standard SPI-3 requires looking backward dynamically for every single month. Doing this natively over 25 years (300+ iterations) requires compiling deeply nested iteration loops (`ee.List.iterate`) under the hood. On dense datasets like CHIRPS (5.5km), this notoriously triggers "Computation Timed Out" or "User Memory Limit Exceeded" crashes in the GEE backend. Using SPI-1 proxy computes much faster and scales reliably.

By using the SPI-1 proxy (Standardized Rainfall Anomaly/Z-Score), you are capturing identical variance while keeping the dataset computationally lightweight and highly predictive for early-warning ML training!
