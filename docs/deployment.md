# Deployment Guide

## Local development

```bash
npm install
npm run dev
```

## Infrastructure

```bash
docker compose -f docker-compose.dev.yml up -d
```

## Production notes

- Run behind HTTPS and a reverse proxy.
- Keep secrets in environment variables only.
- Use Postgres and Redis managed services where possible.
- Restrict the WebRTC TURN/STUN configuration to authorized infrastructure.
- Expose only the required ports, with internal-only networking for the database and Redis services.
