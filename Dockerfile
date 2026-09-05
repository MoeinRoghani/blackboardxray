# The interface is built and then copied into the Python image, so the shipped
# container carries no Node and no toolchain.
FROM node:24-alpine AS interface
WORKDIR /ui
COPY ui/package.json ui/package-lock.json* ./
RUN npm install
COPY ui/ ./
COPY README.md ../README.md
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

COPY pyproject.toml README.md LICENSE ./
COPY src/ ./src/
COPY --from=interface /src/blackboardxray/server/web ./src/blackboardxray/server/web

RUN pip install --no-cache-dir ".[server]"

# The platform reads its database from the environment, and has no default,
# because one that guesses silently watches nothing.
ENV BLACKBOARDXRAY_HOST=0.0.0.0 \
    BLACKBOARDXRAY_PORT=8900
EXPOSE 8900

CMD ["blackboardxray", "serve"]
