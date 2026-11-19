#!/bin/sh
# Applies any new database migrations, then starts the API.
set -e
echo "Applying database migrations..."
npx prisma migrate deploy
echo "Starting the API..."
exec node dist/index.js
