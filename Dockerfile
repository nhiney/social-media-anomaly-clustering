FROM python:3.11-slim

WORKDIR /app

# Copy requirements trước để tận dụng Docker layer cache
COPY web_demo/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy toàn bộ source
COPY web_demo/ .

ENV FLASK_ENV=production
ENV PORT=7860

EXPOSE 7860

CMD ["gunicorn", "-b", "0.0.0.0:7860", "--workers=2", "--timeout=60", "run:app"]
