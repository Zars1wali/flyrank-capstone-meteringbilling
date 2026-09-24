# FlyRank Capstone — Metering & Billing System

<div align="center">

[![NodeJS](https://img.shields.io/badge/node.js-%236DA55F.svg?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/postgres-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Git](https://img.shields.io/badge/git-%23F05033.svg?style=for-the-badge&logo=git&logoColor=white)](https://git-scm.com/)

</div>


A usage-based metering and billing API that tracks API calls, calculates costs, and manages customer billing cycles.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Client     │────▶│  API Server  │────▶│  Database   │
│  (REST API)  │◀────│  (Express)   │◀────│ (PostgreSQL)│
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Billing     │
                    │  Engine      │
                    └──────────────┘
```

## Run

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Start the server
npm start
```

## Seed

```bash
npm run seed
```

## Limitations

- In-memory caching only — no Redis integration yet
- No webhook support for payment providers
- Single-tenant design — multi-tenancy is a future enhancement
- Rate limiting is basic (fixed window, not sliding)
