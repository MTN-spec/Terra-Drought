import numpy as np


def compute_ndvi(nir: np.ndarray, red: np.ndarray, eps: float = 1e-6) -> np.ndarray:
    """Normalized Difference Vegetation Index"""
    return (nir - red) / (nir + red + eps)


def compute_vci(ndvi: np.ndarray, ndvi_min: float, ndvi_max: float, eps: float = 1e-6) -> np.ndarray:
    """Vegetation Condition Index"""
    return 100.0 * (ndvi - ndvi_min) / (ndvi_max - ndvi_min + eps)


def compute_tci(lst: np.ndarray, lst_min: float, lst_max: float, eps: float = 1e-6) -> np.ndarray:
    """Temperature Condition Index"""
    return 100.0 * (lst_max - lst) / (lst_max - lst_min + eps)


def compute_vhi(vci: np.ndarray, tci: np.ndarray, a: float = 0.5) -> np.ndarray:
    """Vegetation Health Index"""
    return a * vci + (1 - a) * tci


def compute_spi(precip_ts: np.ndarray, scale: int = 3) -> np.ndarray:
    """Standardized Precipitation Index (simplified: z-score over moving sum)"""
    if len(precip_ts) < scale:
        raise ValueError("Timeseries shorter than SPI scale")
    rolling = np.convolve(precip_ts, np.ones(scale), "valid")
    mu = rolling.mean()
    sigma = rolling.std(ddof=1) + 1e-6
    return (rolling - mu) / sigma


def compute_evapotranspiration(temperature: np.ndarray, humidity: np.ndarray, solar_radiation: np.ndarray) -> np.ndarray:
    """Placeholder PET using simplified FAO Penman Monteith proxy"""
    return 0.0023 * (temperature + 17.8) * np.sqrt(temperature) * (1 - humidity / 100.0) * solar_radiation


def compute_soil_moisture_index(sm: np.ndarray, sm_min: float, sm_max: float, eps: float = 1e-6) -> np.ndarray:
    """Simple SMI mapping to 0-100"""
    return 100.0 * (sm - sm_min) / (sm_max - sm_min + eps)


class GEEService:
    """Stub for Google Earth Engine integration. Replace with actual ee module calls."""

    def __init__(self):
        self.client = None

    def initialize(self):
        try:
            import ee
            ee.Initialize()
            self.client = ee
        except Exception as e:
            raise RuntimeError("GEE initialization failed: {}".format(e))

    def get_weather_index(self, start_date: str, end_date: str, region_geojson: dict):
        """Get precipitation/temperature timeseries from CHIRPS/ERA5, simplified."""
        if self.client is None:
            self.initialize()

        # Placeholder: implement using ee.ImageCollection and reducers
        raise NotImplementedError("GEE data fetch not implemented")

    def get_ndvi_timeseries(self, start_date: str, end_date: str, region_geojson: dict):
        """Compute NDVI timeseries from Sentinel-2 in GEE."""
        if self.client is None:
            self.initialize()

        # Placeholder: implement with ee.ImageCollection('COPERNICUS/S2_SR')
        raise NotImplementedError("GEE NDVI fetch not implemented")
