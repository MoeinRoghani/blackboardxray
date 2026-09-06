# The interface is built and then copied into the Python image, so the shipped
# container carries no Node and no toolchain.
FROM node:26-alpine AS interface
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
COPY README.md ../README.md
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

COPY pyproject.toml README.md LICENSE ./
COPY src/ ./src/
COPY --from=interface /src/blackboardxray/server/web ./src/blackboardxray/server/web

RUN pip install --no-cache-dir ".[server]" \
    && useradd --create-home --uid 10001 xray

# Nothing here needs root, and a container that does not need it should not
# have it: the process writes to no path in this image.
USER 10001

# The platform reads its database from the environment, and has no default,
# because one that guesses silently watches nothing.
ENV BLACKBOARDXRAY_HOST=0.0.0.0 \
    BLACKBOARDXRAY_PORT=8900 \
    PYTHONUNBUFFERED=1
EXPOSE 8900

CMD ["blackboardxray", "serve"]
