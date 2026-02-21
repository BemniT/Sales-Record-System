FROM python:3.11-slim

# install build deps for firebase-admin and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends build-essential gcc libssl-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

# Install python deps
RUN pip install --upgrade pip
RUN pip install -r requirements.txt

# Use PORT env var from Cloud Run (default 8080)
ENV PORT 8080

# Use gunicorn to serve the app
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "app:app", "--workers", "2", "--threads", "4", "--timeout", "120"]