FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV GENIE_DB_PATH=/tmp/genie_archive.sqlite3
ENV GENIE_BACKUP_DB_PATH=/app/data/genie_archive.sqlite3
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["sh", "-c", "(timeout 3 cp /app/data/genie_archive.sqlite3 /tmp/genie_archive.sqlite3 2>/dev/null || true) && exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
