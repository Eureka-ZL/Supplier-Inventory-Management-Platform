#!/bin/sh
set -eu

echo "=== Supplier Gatekeeper bootstrap ==="
python bootstrap.py

echo "=== Starting API server ==="
exec uvicorn main:app --host 0.0.0.0 --port 8001
