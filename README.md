# FlyRank Capstone — Metering & Billing System

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
