/**
 * tracking.js — Behavioral Telemetry Engine v2
 * =============================================
 * Thu thập metrics hành vi + presets giả lập + visualization + export.
 *
 * Features được thu thập (khớp với cột dataset Instagram):
 *   session_duration   : giây từ khi load trang
 *   like_count         : số lượt Like
 *   comment_count      : số lượt gửi Comment
 *   post_count         : số bài đăng mới
 *   ad_click           : đã click quảng cáo (bool)
 *   activity_intensity : total_clicks / session_duration
 */

(function () {
    "use strict";

    // =========================================================
    // 1. TRẠNG THÁI SESSION
    // =========================================================

    const SESSION_START_MS = Date.now();

    const metrics = {
        like_count:    0,
        comment_count: 0,
        post_count:    0,
        ad_click:      false,
        total_clicks:  0,
    };

    // Khi dùng preset, ghi đè session_duration thay vì dùng đồng hồ thật
    let presetOverrideTime = null;

    // =========================================================
    // 2. NGƯỠNG ĐẶC TRƯNG (cho HUD color-coding)
    //    Dựa trên phân phối hành vi người dùng Instagram điển hình
    //    Khớp với FEATURE_THRESHOLDS trong ml_service.py
    // =========================================================
    const THRESHOLDS = {
        session_duration:   { warn: 600,  danger: 1800, low: 20 },
        like_count:         { warn: 15,   danger: 30 },
        comment_count:      { warn: 8,    danger: 20 },
        post_count:         { warn: 3,    danger: 8 },
        activity_intensity: { warn: 2.0,  danger: 5.0 },
    };

    // Giá trị tối đa để chuẩn hóa về [0,1] cho radar chart
    const RADAR_MAX = {
        session_duration:   1800,
        like_count:         50,
        comment_count:      30,
        post_count:         15,
        ad_click:           1,
        activity_intensity: 10,
    };

    // Profile người dùng bình thường (đường tham chiếu trên radar chart)
    const NORMAL_PROFILE = [0.17, 0.06, 0.07, 0.07, 0.1, 0.06];

    // =========================================================
    // 3. BEHAVIOR PRESETS
    //    Giả lập nhanh 4 loại hành vi để demo model
    // =========================================================
    const PRESETS = {
        normal: {
            label:         "🧑 Normal User",
            overrideTime:  240,
            like_count:    3,
            comment_count: 1,
            post_count:    0,
            ad_click:      false,
            total_clicks:  72,     // ≈ 0.3 clicks/s * 240s
        },
        spammer: {
            label:         "📢 Spammer",
            overrideTime:  55,
            like_count:    28,
            comment_count: 18,
            post_count:    9,
            ad_click:      false,
            total_clicks:  264,    // ≈ 4.8 clicks/s * 55s
        },
        bot: {
            label:         "🤖 Bot",
            overrideTime:  300,
            like_count:    60,
            comment_count: 40,
            post_count:    25,
            ad_click:      false,
            total_clicks:  2700,   // ≈ 9 clicks/s * 300s
        },
        adclicker: {
            label:         "🎣 Ad-Clicker",
            overrideTime:  28,
            like_count:    1,
            comment_count: 0,
            post_count:    0,
            ad_click:      true,
            total_clicks:  14,
        },
    };

    // =========================================================
    // 4. TRACKERS
    // =========================================================

    // Tổng số click — chỉ đếm khi không dùng preset
    document.addEventListener("click", function () {
        if (presetOverrideTime === null) metrics.total_clicks++;
        updateHUD();
    });

    // like_count: click nút .like-btn
    document.addEventListener("click", function (e) {
        const btn = e.target.closest(".like-btn");
        if (!btn) return;

        if (!btn.classList.contains("liked")) {
            metrics.like_count++;
            btn.classList.add("liked", "text-red-500");
            const span = btn.querySelector(".like-count");
            if (span) span.textContent = parseInt(span.textContent) + 1;
        } else {
            metrics.like_count = Math.max(0, metrics.like_count - 1);
            btn.classList.remove("liked", "text-red-500");
            const span = btn.querySelector(".like-count");
            if (span) span.textContent = parseInt(span.textContent) - 1;
        }
        updateHUD();
    });

    // comment_count: submit .comment-form
    document.addEventListener("submit", function (e) {
        if (!e.target.matches(".comment-form")) return;
        e.preventDefault();
        const input = e.target.querySelector("input[type='text'], textarea");
        if (input && input.value.trim()) {
            metrics.comment_count++;
            input.value = "";
            showToast("💬 Comment đã ghi nhận!");
            updateHUD();
        }
    });

    // post_count: submit #post-form
    document.addEventListener("submit", function (e) {
        if (!e.target.matches("#post-form")) return;
        e.preventDefault();
        const ta = e.target.querySelector("textarea");
        if (ta && ta.value.trim()) {
            metrics.post_count++;
            ta.value = "";
            showToast("📝 Bài đăng đã ghi nhận!");
            updateHUD();
        }
    });

    // ad_click: click #ad-banner
    document.addEventListener("click", function (e) {
        if (!e.target.closest("#ad-banner")) return;
        if (metrics.ad_click) return;
        metrics.ad_click = true;
        _syncAdBannerUI(true);
        showToast("🎯 Ad click đã ghi nhận!");
        updateHUD();
    });

    function _syncAdBannerUI(clicked) {
        const banner = document.getElementById("ad-banner");
        const badge  = document.getElementById("ad-badge");
        if (!banner || !badge) return;
        if (clicked) {
            banner.classList.add("ring-2", "ring-yellow-400");
            badge.textContent = "✓ Đã click";
            badge.className = badge.className.replace("bg-yellow-500", "bg-green-500");
        } else {
            banner.classList.remove("ring-2", "ring-yellow-400");
            badge.textContent = "Được tài trợ";
            badge.className = badge.className.replace("bg-green-500", "bg-yellow-500");
        }
    }

    // =========================================================
    // 5. PRESET SYSTEM (gọi từ feed.html)
    // =========================================================

    window.applyPreset = function (key) {
        const preset = PRESETS[key];
        if (!preset) return;

        // Ghi đè metrics
        metrics.like_count    = preset.like_count;
        metrics.comment_count = preset.comment_count;
        metrics.post_count    = preset.post_count;
        metrics.ad_click      = preset.ad_click;
        metrics.total_clicks  = preset.total_clicks;
        presetOverrideTime    = preset.overrideTime;

        _syncAdBannerUI(preset.ad_click);

        // Đánh dấu nút active
        document.querySelectorAll(".preset-btn").forEach(b =>
            b.classList.remove("ring-2", "ring-indigo-500", "bg-indigo-50")
        );
        const activeBtn = document.querySelector(`[data-preset="${key}"]`);
        if (activeBtn) activeBtn.classList.add("ring-2", "ring-indigo-500", "bg-indigo-50");

        showToast(`🎭 Preset "${preset.label}" đã áp dụng!`);
        updateHUD();
    };

    window.resetPreset = function () {
        presetOverrideTime    = null;
        metrics.like_count    = 0;
        metrics.comment_count = 0;
        metrics.post_count    = 0;
        metrics.ad_click      = false;
        metrics.total_clicks  = 0;

        _syncAdBannerUI(false);
        document.querySelectorAll(".preset-btn").forEach(b =>
            b.classList.remove("ring-2", "ring-indigo-500", "bg-indigo-50")
        );
        showToast("🔄 Đã reset về trạng thái thực tế");
        updateHUD();
    };

    // =========================================================
    // 6. BUILD PAYLOAD & SUBMIT
    // =========================================================

    function buildPayload() {
        const elapsed = presetOverrideTime !== null
            ? presetOverrideTime
            : Math.round((Date.now() - SESSION_START_MS) / 1000);

        const activity_intensity = elapsed > 0
            ? parseFloat((metrics.total_clicks / elapsed).toFixed(4))
            : 0;

        const algorithm = document.querySelector('input[name="algorithm"]:checked')?.value || "kmeans";

        return {
            session_duration:   elapsed,          // float (giây)
            like_count:         metrics.like_count,
            comment_count:      metrics.comment_count,
            post_count:         metrics.post_count,
            ad_click:           metrics.ad_click,
            activity_intensity: activity_intensity,
            algorithm:          algorithm,
        };
    }

    window.submitSession = async function () {
        const btn = document.getElementById("submit-btn");
        if (btn) { btn.disabled = true; btn.textContent = "Đang phân tích..."; }

        const payload = buildPayload();
        console.log("[Tracking] Payload:", payload);

        try {
            const res = await fetch("/api/track_behavior", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            console.log("[Tracking] Response:", data);

            showResultModal(data.prediction, payload);
            loadSessionHistory();   // Cập nhật bảng lịch sử

        } catch (err) {
            console.error("[Tracking]", err);
            showToast("❌ Lỗi kết nối tới server!", "error");
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = "🔬 Chốt Session & Phân tích Hành vi"; }
        }
    };

    // =========================================================
    // 7. SESSION HISTORY TABLE
    // =========================================================

    window.loadSessionHistory = async function () {
        try {
            const res  = await fetch("/api/sessions");
            const data = await res.json();
            _renderHistory(data.sessions, data.total);
        } catch (e) {
            console.error("[History]", e);
        }
    };

    function _renderHistory(sessions, total) {
        const tbody    = document.getElementById("history-tbody");
        const countEl  = document.getElementById("history-count");
        const totalEl  = document.getElementById("history-total");
        if (!tbody) return;

        if (countEl) countEl.textContent = sessions.length;
        if (totalEl) totalEl.textContent = total;

        if (!sessions.length) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-gray-400 text-sm">
                Chưa có session. Nhấn "Chốt Session & Phân tích" để bắt đầu.
            </td></tr>`;
            return;
        }

        tbody.innerHTML = [...sessions].reverse().map((s, i) => {
            const pred      = s.prediction || {};
            const isAnomaly = pred.is_anomaly;
            const badge     = isAnomaly
                ? `<span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600">⚠ Bất thường</span>`
                : `<span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-600">✓ Bình thường</span>`;
            const algoBadge = (s.algorithm || "kmeans").toLowerCase() === "dbscan"
                ? `<span class="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">DBSCAN</span>`
                : `<span class="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">K-Means</span>`;

            return `<tr class="border-b border-gray-50 hover:bg-gray-50 text-sm">
                <td class="py-2 px-3 text-gray-400 text-xs">${s.timestamp || ""}</td>
                <td class="py-2 px-3 font-mono">${s.session_duration}s</td>
                <td class="py-2 px-3 text-center ${_hudColor("like_count", s.like_count)}">${s.like_count}</td>
                <td class="py-2 px-3 text-center ${_hudColor("comment_count", s.comment_count)}">${s.comment_count}</td>
                <td class="py-2 px-3 text-center ${_hudColor("post_count", s.post_count)}">${s.post_count}</td>
                <td class="py-2 px-3 text-center ${_hudColor("activity_intensity", s.activity_intensity)}">${parseFloat(s.activity_intensity || 0).toFixed(2)}</td>
                <td class="py-2 px-3 text-center">${s.ad_click ? "✓" : "✗"}</td>
                <td class="py-2 px-3 text-center">${algoBadge}</td>
                <td class="py-2 px-3">${badge}</td>
            </tr>`;
        }).join("");
    }

    window.clearHistory = async function () {
        if (!confirm("Xóa toàn bộ lịch sử session?")) return;
        await fetch("/api/clear_sessions", { method: "POST" });
        loadSessionHistory();
        showToast("🗑️ Đã xóa lịch sử");
    };

    window.exportCSV = function () {
        window.location.href = "/api/export/csv";
    };

    // =========================================================
    // 8. HUD — color-coded theo ngưỡng
    // =========================================================

    function _hudColor(key, value) {
        const t = THRESHOLDS[key];
        if (!t) return "text-indigo-600";
        const v = parseFloat(value);
        if (v >= (t.danger || Infinity)) return "text-red-600 font-bold";
        if (v >= (t.warn  || Infinity)) return "text-yellow-600 font-bold";
        if (t.low && v < t.low)         return "text-yellow-600";
        return "text-green-600";
    }

    function updateHUD() {
        const elapsed = presetOverrideTime !== null
            ? presetOverrideTime
            : Math.round((Date.now() - SESSION_START_MS) / 1000);

        const intensity = elapsed > 0
            ? (metrics.total_clicks / elapsed).toFixed(2)
            : "0.00";

        const items = [
            ["hud-duration",  "session_duration",   elapsed + "s"],
            ["hud-likes",     "like_count",         metrics.like_count],
            ["hud-comments",  "comment_count",      metrics.comment_count],
            ["hud-posts",     "post_count",         metrics.post_count],
            ["hud-ad",        null,                 metrics.ad_click ? "✓" : "✗"],
            ["hud-intensity", "activity_intensity", intensity],
        ];

        items.forEach(([id, key, val]) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = val;
            if (key) el.className = `text-sm font-bold tabular-nums ${_hudColor(key, parseFloat(val))}`;
        });

        // Hiện/ẩn badge "PRESET MODE"
        const badge = document.getElementById("preset-mode-badge");
        if (badge) badge.classList.toggle("hidden", presetOverrideTime === null);
    }

    setInterval(updateHUD, 1000);

    // =========================================================
    // 9. MODAL KẾT QUẢ — radar chart + feature breakdown
    // =========================================================

    let _radarChart = null;

    function showResultModal(prediction, payload) {
        const modal     = document.getElementById("result-modal");
        const isAnomaly = prediction?.is_anomaly;

        // Header
        const header   = document.getElementById("modal-header");
        const icon     = document.getElementById("modal-icon");
        const title    = document.getElementById("modal-title");
        const subtitle = document.getElementById("modal-subtitle");
        const metaEl   = document.getElementById("modal-meta");

        if (isAnomaly) {
            header.className    = "p-5 rounded-t-2xl bg-red-50 border-b border-red-200";
            icon.textContent    = "🚨";
            title.textContent   = "Phát hiện Hành vi Bất thường!";
            title.className     = "text-lg font-bold text-red-600 mt-1";
            subtitle.textContent = prediction.label || "";
            subtitle.className  = "text-sm text-red-500 mt-0.5 font-medium";
        } else {
            header.className    = "p-5 rounded-t-2xl bg-green-50 border-b border-green-200";
            icon.textContent    = "✅";
            title.textContent   = "Hành vi Bình thường";
            title.className     = "text-lg font-bold text-green-600 mt-1";
            subtitle.textContent = prediction.label || "";
            subtitle.className  = "text-sm text-green-500 mt-0.5 font-medium";
        }

        if (metaEl) {
            const algo = prediction?.algorithm || payload.algorithm?.toUpperCase() || "K-MEANS";
            const conf = prediction?.confidence;
            const cid  = prediction?.cluster_id ?? "N/A";
            metaEl.innerHTML = `
                <span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-semibold">${algo}</span>
                <span class="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs">Cluster: ${cid}</span>
                ${conf != null ? `<span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs">Confidence: ${(conf*100).toFixed(0)}%</span>` : ""}
            `;
        }

        // Feature breakdown
        _renderFeatureBreakdown(payload, prediction);

        // Radar chart
        _renderRadarChart(payload);

        // Suspicious features explanation
        _renderSuspicious(prediction?.suspicious_features || []);

        modal.classList.remove("hidden");
    }

    function _renderFeatureBreakdown(payload, prediction) {
        const tbody = document.getElementById("modal-features");
        if (!tbody) return;

        const rows = [
            ["session_duration",   "⏱️ Session Duration",   payload.session_duration + "s"],
            ["like_count",         "❤️ Like Count",          payload.like_count],
            ["comment_count",      "💬 Comment Count",       payload.comment_count],
            ["post_count",         "📝 Post Count",          payload.post_count],
            [null,                 "🎯 Ad Click",            payload.ad_click ? "Có" : "Không"],
            ["activity_intensity", "⚡ Activity Intensity",  parseFloat(payload.activity_intensity).toFixed(3) + " c/s"],
        ];

        tbody.innerHTML = rows.map(([key, label, val]) => {
            const numVal = parseFloat(val);
            const color  = key ? _hudColor(key, numVal) : "text-gray-700";
            const badge  = key ? _featureBadge(key, numVal) : "";
            return `<tr class="border-b last:border-0 border-gray-50">
                <td class="py-1.5 pr-3 text-gray-500 text-xs">${label}</td>
                <td class="py-1.5 text-xs ${color} font-semibold">${val} ${badge}</td>
            </tr>`;
        }).join("");
    }

    function _featureBadge(key, value) {
        const t = THRESHOLDS[key];
        if (!t) return "";
        if (value >= (t.danger || Infinity))
            return `<span class="ml-1 bg-red-100 text-red-600 px-1.5 py-0.5 rounded text-xs">⚠ Nguy hiểm</span>`;
        if (value >= (t.warn || Infinity))
            return `<span class="ml-1 bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded text-xs">⚡ Đáng ngờ</span>`;
        if (t.low && value < t.low)
            return `<span class="ml-1 bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded text-xs">⚡ Bất thường</span>`;
        return `<span class="ml-1 bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-xs">✓ OK</span>`;
    }

    function _renderSuspicious(features) {
        const el = document.getElementById("modal-suspicious");
        if (!el) return;
        if (!features.length) {
            el.classList.add("hidden");
            return;
        }
        el.classList.remove("hidden");
        el.innerHTML = `
            <p class="text-xs font-semibold text-red-600 mb-1">🔍 Lý do bị phát hiện:</p>
            <ul class="text-xs text-red-500 list-disc list-inside space-y-0.5">
                ${features.map(f => `<li>${f}</li>`).join("")}
            </ul>`;
    }

    function _renderRadarChart(payload) {
        const canvas = document.getElementById("radar-chart");
        if (!canvas || typeof Chart === "undefined") return;

        if (_radarChart) { _radarChart.destroy(); _radarChart = null; }

        // Chuẩn hóa về [0, 1]
        const userVals = [
            Math.min(payload.session_duration   / RADAR_MAX.session_duration,   1),
            Math.min(payload.like_count         / RADAR_MAX.like_count,         1),
            Math.min(payload.comment_count      / RADAR_MAX.comment_count,      1),
            Math.min(payload.post_count         / RADAR_MAX.post_count,         1),
            payload.ad_click ? 1 : 0,
            Math.min(payload.activity_intensity / RADAR_MAX.activity_intensity, 1),
        ];

        _radarChart = new Chart(canvas, {
            type: "radar",
            data: {
                labels: ["Session\nDuration", "Like Count", "Comment\nCount", "Post Count", "Ad Click", "Activity\nIntensity"],
                datasets: [
                    {
                        label: "Người dùng hiện tại",
                        data:  userVals,
                        backgroundColor: "rgba(99,102,241,0.25)",
                        borderColor:     "rgb(99,102,241)",
                        borderWidth: 2,
                        pointBackgroundColor: "rgb(99,102,241)",
                        pointRadius: 4,
                    },
                    {
                        label: "Tham chiếu: Bình thường",
                        data:  NORMAL_PROFILE,
                        backgroundColor: "rgba(34,197,94,0.1)",
                        borderColor:     "rgb(34,197,94)",
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 2,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "bottom", labels: { font: { size: 10 } } },
                },
                scales: {
                    r: {
                        beginAtZero: true, max: 1,
                        ticks: { display: false },
                        grid: { color: "rgba(0,0,0,0.07)" },
                        pointLabels: { font: { size: 10 } },
                    },
                },
            },
        });
    }

    window.closeResultModal = function () {
        document.getElementById("result-modal").classList.add("hidden");
    };

    // =========================================================
    // 10. TOAST
    // =========================================================

    function showToast(message, type = "success") {
        const container = document.getElementById("toast-container");
        if (!container) return;
        const toast = document.createElement("div");
        toast.className = `${type === "error" ? "bg-red-500" : "bg-gray-800"} text-white text-sm
                           px-4 py-2 rounded-lg shadow-lg transition-all duration-300 opacity-100`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add("opacity-0");
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    // =========================================================
    // INIT
    // =========================================================
    updateHUD();
    loadSessionHistory();

})();
