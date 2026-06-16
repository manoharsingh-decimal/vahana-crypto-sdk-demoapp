#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# ── one-time setup ──────────────────────────────────────────────────────
# Create and populate the backend virtualenv if it doesn't exist.
if [ ! -d backend/venv ]; then
  echo "Creating backend virtualenv..."
  python3 -m venv backend/venv
  backend/venv/bin/pip install -r backend/requirements.txt
fi

# Generate keypair if needed.
if [ ! -f backend/keys/server_private.pem ]; then
  echo "Keys not found. Running keygen first..."
  backend/venv/bin/python keygen.py
fi

# Install frontend dependencies if needed.
if [ ! -d frontend/node_modules ]; then
  echo "Installing frontend dependencies..."
  cd frontend && npm install && cd ..
fi

# ── start services ──────────────────────────────────────────────────────
[ -f backend/.env ] && set -a && source backend/.env && set +a

source backend/venv/bin/activate
python backend/app.py &
BACKEND_PID=$!
echo "Backend started (PID $BACKEND_PID)"

cd frontend
npm run dev &
FRONTEND_PID=$!
echo "Frontend started (PID $FRONTEND_PID)"
cd ..

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'" EXIT INT TERM

wait
