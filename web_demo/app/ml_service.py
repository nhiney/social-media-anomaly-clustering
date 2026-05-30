"""
ml_service.py
-------------
Tầng dịch vụ Machine Learning.

Để tích hợp model thật (.pkl):
  1. Đặt scaler.pkl + kmeans_model.pkl (hoặc dbscan_model.pkl) vào /models/
  2. Bỏ comment "PRODUCTION BLOCK", comment lại "DEMO BLOCK".

Thứ tự feature PHẢI khớp với lúc train:
  [session_duration, like_count, comment_count, post_count, ad_click, activity_intensity]
"""

import os
import random
import logging

logger = logging.getLogger(__name__)

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models")

# Nhãn cluster — chỉnh lại để khớp với cluster label của model thật
LABEL_MAP = {
    0:  "Bình thường",
    1:  "Bất thường (Spammer/Bot)",
    -1: "Bất thường (Nhiễu - DBSCAN)",
}

# Ngưỡng đặc trưng dùng để giải thích anomaly (hiển thị trên UI)
FEATURE_THRESHOLDS = {
    "session_duration":   {"warn": 600,  "danger": 1800, "low_warn": 20},
    "like_count":         {"warn": 15,   "danger": 30},
    "comment_count":      {"warn": 8,    "danger": 20},
    "post_count":         {"warn": 3,    "danger": 8},
    "activity_intensity": {"warn": 2.0,  "danger": 5.0},
}


def _extract_feature_vector(data: dict) -> list:
    """
    Thứ tự này PHẢI khớp với thứ tự cột khi train model:
        data["session_duration"]    → Thời gian session (giây)
        data["like_count"]          → Tổng lượt Like
        data["comment_count"]       → Tổng lượt Comment
        data["post_count"]          → Tổng bài đăng mới
        data["ad_click"]            → Click quảng cáo (1/0)
        data["activity_intensity"]  → Tổng clicks / session_duration
    """
    return [
        float(data.get("session_duration", 0)),
        float(data.get("like_count", 0)),
        float(data.get("comment_count", 0)),
        float(data.get("post_count", 0)),
        float(1 if data.get("ad_click") else 0),
        float(data.get("activity_intensity", 0)),
    ]


def _analyze_suspicious_features(data: dict) -> list[str]:
    """Trả về danh sách các feature đang ở mức đáng ngờ để giải thích anomaly."""
    reasons = []
    for key, thresholds in FEATURE_THRESHOLDS.items():
        val = float(data.get(key, 0))
        if val >= thresholds.get("danger", float("inf")):
            reasons.append(f"{key}={val} (vượt ngưỡng nguy hiểm)")
        elif val >= thresholds.get("warn", float("inf")):
            reasons.append(f"{key}={val} (đáng ngờ)")
        elif thresholds.get("low_warn") and val < thresholds["low_warn"]:
            reasons.append(f"{key}={val} (bất thường thấp)")
    return reasons


def predict_anomaly(data: dict, algorithm: str = "kmeans") -> dict:
    """
    Args:
        data:      dict chứa metrics hành vi từ Frontend
        algorithm: "kmeans" hoặc "dbscan"

    Returns:
        label, is_anomaly, confidence, cluster_id, algorithm, suspicious_features
    """
    features = _extract_feature_vector(data)
    logger.info(f"[ML] algo={algorithm} | features={features}")

    # =========================================================
    # DEMO BLOCK
    # =========================================================
    if algorithm == "dbscan":
        # DBSCAN: -1 = noise/outlier, 0 = cluster bình thường
        cluster_id = random.choice([-1, -1, 0])   # bias về anomaly để demo rõ
    else:
        # KMeans: 0 = bình thường, 1 = bất thường
        cluster_id = random.choice([0, 1])

    label = LABEL_MAP.get(cluster_id, f"Cụm {cluster_id}")
    suspicious = _analyze_suspicious_features(data)

    return {
        "label":               label,
        "is_anomaly":          cluster_id != 0,
        "confidence":          round(random.uniform(0.62, 0.98), 2),
        "cluster_id":          cluster_id,
        "algorithm":           algorithm.upper(),
        "suspicious_features": suspicious,
    }
    # =========================================================

    # =========================================================
    # PRODUCTION BLOCK (bỏ comment khi có file .pkl)
    # =========================================================
    # import pickle, numpy as np
    #
    # scaler_path = os.path.join(MODEL_DIR, "scaler.pkl")
    # model_file  = "dbscan_model.pkl" if algorithm == "dbscan" else "kmeans_model.pkl"
    # model_path  = os.path.join(MODEL_DIR, model_file)
    #
    # with open(scaler_path, "rb") as f: scaler = pickle.load(f)
    # with open(model_path,  "rb") as f: model  = pickle.load(f)
    #
    # X = np.array(features).reshape(1, -1)
    # X_scaled = scaler.transform(X)
    # cluster_id = int(model.predict(X_scaled)[0])
    #
    # suspicious = _analyze_suspicious_features(data)
    # return {
    #     "label":               LABEL_MAP.get(cluster_id, f"Cụm {cluster_id}"),
    #     "is_anomaly":          cluster_id != 0,
    #     "confidence":          None,
    #     "cluster_id":          cluster_id,
    #     "algorithm":           algorithm.upper(),
    #     "suspicious_features": suspicious,
    # }
    # =========================================================
