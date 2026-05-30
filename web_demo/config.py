import os

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-in-production")
    # Thư mục chứa các file model .pkl (KMeans, DBSCAN, scaler...)
    MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
