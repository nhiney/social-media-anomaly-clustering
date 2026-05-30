import csv
import io
import json
import logging
from datetime import datetime
from flask import (
    Blueprint, request, jsonify, Response,
    render_template, redirect, url_for, session, flash
)
from app.ml_service import predict_anomaly

logger = logging.getLogger(__name__)
main = Blueprint("main", __name__)

# ---------------------------------------------------------------------------
# In-memory session history (reset khi restart server — đủ cho demo)
# ---------------------------------------------------------------------------
_session_history = []

MOCK_POSTS = [
    {
        "id": 1, "username": "travel_junkie",
        "avatar": "https://i.pravatar.cc/48?img=1",
        "content": "Hoàng hôn tại Mũi Né đẹp đến nao lòng 🌅 #travel #muine",
        "image": "https://picsum.photos/seed/muine/600/350",
        "likes": 342, "time": "2 giờ trước",
    },
    {
        "id": 2, "username": "foodie_saigon",
        "avatar": "https://i.pravatar.cc/48?img=5",
        "content": "Bánh mì xíu mại Sài Gòn buổi sáng — không đâu ngon bằng! 🥖",
        "image": "https://picsum.photos/seed/banhmi/600/350",
        "likes": 198, "time": "4 giờ trước",
    },
    {
        "id": 3, "username": "dev.diary",
        "avatar": "https://i.pravatar.cc/48?img=12",
        "content": "Sau 6 tháng học ML, cuối cùng mình cũng deploy được model đầu tiên lên production 🚀",
        "image": None, "likes": 512, "time": "6 giờ trước",
    },
    {
        "id": 4, "username": "nature_vn",
        "avatar": "https://i.pravatar.cc/48?img=20",
        "content": "Ruộng bậc thang Mù Cang Chải mùa lúa chín 🌾 #mucangchai",
        "image": "https://picsum.photos/seed/mucang/600/350",
        "likes": 876, "time": "1 ngày trước",
    },
    {
        "id": 5, "username": "book_worm99",
        "avatar": "https://i.pravatar.cc/48?img=33",
        "content": "Review: 'Đắc Nhân Tâm' — cuốn sách đã thay đổi cách mình giao tiếp hoàn toàn 📚",
        "image": None, "likes": 130, "time": "2 ngày trước",
    },
]


# ---------------------------------------------------------------------------
# Page routes
# ---------------------------------------------------------------------------

@main.route("/")
def index():
    return redirect(url_for("main.login"))


@main.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        if username and password:
            session["username"] = username
            return redirect(url_for("main.feed"))
        flash("Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.", "error")
    return render_template("login.html")


@main.route("/feed")
def feed():
    if "username" not in session:
        return redirect(url_for("main.login"))
    return render_template("feed.html", posts=MOCK_POSTS, username=session["username"])


@main.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("main.login"))


# ---------------------------------------------------------------------------
# API: nhận telemetry, phân tích, lưu history
# ---------------------------------------------------------------------------

@main.route("/api/track_behavior", methods=["POST"])
def track_behavior():
    """
    Nhận JSON payload:
        session_duration, like_count, comment_count, post_count,
        ad_click, activity_intensity, algorithm ("kmeans"|"dbscan")
    """
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "Payload JSON không hợp lệ"}), 400

    algorithm = payload.get("algorithm", "kmeans")

    logger.info("=" * 60)
    logger.info("[TELEMETRY] Dữ liệu nhận từ Frontend:")
    logger.info(json.dumps(payload, indent=2, ensure_ascii=False))
    logger.info("=" * 60)

    result = predict_anomaly(payload, algorithm=algorithm)
    logger.info(f"[ML RESULT] {result}")

    # Lưu vào history
    record = {
        **{k: v for k, v in payload.items() if k != "algorithm"},
        "algorithm": algorithm,
        "username": session.get("username", "anonymous"),
        "timestamp": datetime.now().strftime("%H:%M:%S"),
        "prediction": result,
    }
    _session_history.append(record)

    return jsonify({"status": "ok", "received": payload, "prediction": result})


@main.route("/api/sessions", methods=["GET"])
def get_sessions():
    """Trả về danh sách tối đa 50 session gần nhất."""
    return jsonify({"sessions": _session_history[-50:], "total": len(_session_history)})


@main.route("/api/export/csv", methods=["GET"])
def export_csv():
    """Xuất toàn bộ session history ra file CSV để dùng trong notebook/phân tích."""
    if not _session_history:
        return jsonify({"error": "Chưa có dữ liệu"}), 404

    fieldnames = [
        "timestamp", "username", "algorithm",
        "session_duration", "like_count", "comment_count",
        "post_count", "ad_click", "activity_intensity",
        "predicted_label", "is_anomaly", "cluster_id", "confidence",
    ]

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()

    for record in _session_history:
        pred = record.get("prediction", {})
        writer.writerow({
            "timestamp":        record.get("timestamp", ""),
            "username":         record.get("username", ""),
            "algorithm":        record.get("algorithm", "kmeans"),
            "session_duration": record.get("session_duration", 0),
            "like_count":       record.get("like_count", 0),
            "comment_count":    record.get("comment_count", 0),
            "post_count":       record.get("post_count", 0),
            "ad_click":         1 if record.get("ad_click") else 0,
            "activity_intensity": record.get("activity_intensity", 0),
            "predicted_label":  pred.get("label", ""),
            "is_anomaly":       1 if pred.get("is_anomaly") else 0,
            "cluster_id":       pred.get("cluster_id", -1),
            "confidence":       pred.get("confidence", ""),
        })

    csv_content = output.getvalue()
    return Response(
        csv_content,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=behavior_dataset.csv"},
    )


@main.route("/api/clear_sessions", methods=["POST"])
def clear_sessions():
    _session_history.clear()
    return jsonify({"status": "ok", "message": "Đã xóa toàn bộ lịch sử"})
