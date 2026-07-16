# syntax=docker/dockerfile:1

# ---- build stage ------------------------------------------------------------
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app
RUN uv sync --frozen --no-dev

# ---- runtime stage ----------------------------------------------------------
FROM python:3.12-slim AS runner
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

COPY --from=build /app/.venv ./.venv
COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
