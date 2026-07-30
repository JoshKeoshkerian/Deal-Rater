FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml alembic.ini ./
COPY alembic ./alembic
COPY app ./app

RUN pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Migrations run on every boot rather than as a separate release step -- this
# is a single-service deploy with no release-phase hook, and alembic upgrade
# is a no-op when there is nothing new to apply.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
