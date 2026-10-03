FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir torch==2.13.0 --index-url https://download.pytorch.org/whl/cpu && pip install --no-cache-dir -r backend/requirements.txt
COPY backend /app/backend
COPY tools/prepare-flood-model.py /app/tools/prepare-flood-model.py
RUN useradd --uid 10001 --create-home flood && mkdir -p /app/runtime/flood && chown -R flood:flood /app/runtime
USER flood
ENV FLOOD_RUNTIME=/app/runtime/flood FLOOD_MODEL_PATH=/app/runtime/flood/models
EXPOSE 8100
CMD ["python", "-m", "uvicorn", "backend.flood.api:app", "--host", "0.0.0.0", "--port", "8100"]
