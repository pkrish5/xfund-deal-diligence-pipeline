#!/bin/bash

# Xfund Deal Pipeline - Local Development Startup Script

echo "🚀 Starting Xfund Deal Pipeline..."

# 1. Start Database (Postgres)
echo "📦 Starting Postgres..."
docker compose up -d postgres

# Wait for DB to be ready
echo "⏳ Waiting for database..."
sleep 5

# 2. Run Migrations (to be safe)
echo "🔄 Checking database migrations..."
npx tsx packages/shared/src/db/migrate.ts

# 3. Start Services
echo "🌐 Starting Ingress, Admin, and Worker services..."

# Kill any existing processes on ports 8080-8082
kill $(lsof -ti:8080) 2>/dev/null || true
kill $(lsof -ti:8081) 2>/dev/null || true
kill $(lsof -ti:8082) 2>/dev/null || true

# Start services in background
npx tsx apps/worker/src/server.ts > worker.log 2>&1 &
WORKER_PID=$!
echo "   ✅ Worker (PID: $WORKER_PID) -> http://localhost:8082"

npx tsx apps/ingress/src/server.ts > ingress.log 2>&1 &
INGRESS_PID=$!
echo "   ✅ Ingress (PID: $INGRESS_PID) -> http://localhost:8080"

npx tsx apps/admin/src/server.ts > admin.log 2>&1 &
ADMIN_PID=$!
echo "   ✅ Admin (PID: $ADMIN_PID) -> http://localhost:8081"

echo ""
echo "🎉 All services are running!"
echo "---------------------------------------------------"
echo "  Ingress: http://localhost:8080"
echo "  Admin:   http://localhost:8081"
echo "  Worker:  http://localhost:8082"
echo "---------------------------------------------------"
echo "Logs are being written to ingress.log, admin.log, worker.log"
echo "To stop everything, run: pkill -f 'tsx'"
echo ""

# 4. Check for ngrok
if pgrep -x "ngrok" > /dev/null
then
    echo "✅ ngrok is already running."
    echo "   URL: $(curl -s http://localhost:4040/api/tunnels | grep -o 'https://[^"]*ngrok[^"]*')"
else
    echo "⚠️  ngrok is NOT running."
    echo "   Run 'ngrok http 8080' in a separate terminal to expose the Ingress service."
fi
