#!/usr/bin/env bash
set -a && source .env.local && set +a

echo "→ MySQL..."
docker-compose --env-file .env.local up mysql -d --wait

echo "→ Backend :4001..."
( \
  DATABASE_URL="mysql://erp:erp_dev_pass@localhost:3306/erp" \
  API_INTERNAL_TOKEN="$API_INTERNAL_TOKEN" \
  BACKEND_API_URL="http://localhost:4001" \
  CLOCKIFY_SYNC_URL="http://localhost:4000" \
  bun run src/services/backend-api-service.ts \
) &

echo "→ Clockify sync :4000..."
( \
  CLOCKIFY_KEY="$CLOCKIFY_KEY" \
  CLOCKIFY_BASE_URL="$CLOCKIFY_BASE_URL" \
  API_INTERNAL_TOKEN="$API_INTERNAL_TOKEN" \
  BACKEND_API_URL="http://localhost:4001" \
  PORT=4000 \
  bun run src/services/clockify-sync-service.ts \
) &

echo "→ Frontend :3000..."
( bun run dev ) &

echo ""
echo "Services running. Ctrl+C to stop all."
wait
