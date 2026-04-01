# Stage 1: Builder
# Use a supported Debian base (buster is EOL and its repos return 404)
FROM python:3.11-slim-bookworm as builder

# Install system dependencies for building Python packages
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip wheel --no-cache-dir --wheel-dir=/wheels -r requirements.txt

# Stage 2: Production
FROM python:3.11-slim-bookworm as production

# Install only runtime system dependencies
RUN apt-get update && apt-get install -y \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built wheels from builder stage
COPY --from=builder /wheels /wheels
# Install Python dependencies from wheels
RUN pip install --no-cache-dir --find-links=/wheels /wheels/*

# Copy application code
COPY . .

# Create non-root user
RUN useradd -m -u 1000 ispmax && chown -R ispmax:ispmax /app
USER ispmax

# Expose port
EXPOSE 5000

# Set default number of Gunicorn workers, configurable via environment variable
ENV GUNICORN_WORKERS=4

# Run application
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "${GUNICORN_WORKERS}", "--worker-class", "gevent", "wsgi:app"]
