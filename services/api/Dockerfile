# Maknam POS API. All configuration comes from environment variables set by the
# host (ENVIRONMENT, DATABASE_URL, SUPABASE_URL, CORS_ORIGINS). No .env is copied.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app
COPY scripts ./scripts

RUN useradd --create-home --uid 10001 maknam
USER maknam

EXPOSE 8000
# Run migrations as the host's release/pre-deploy step: `alembic upgrade head`.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
