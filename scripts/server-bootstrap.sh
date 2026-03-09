#!/usr/bin/env bash
# Run this ONCE on the server to install Docker, Nginx, Certbot
# Usage: ssh -i ~/.ssh/boyig.pem root@47.108.85.216 'bash -s' < scripts/server-bootstrap.sh

set -e

echo "==> Updating system..."
apt update && apt upgrade -y

echo "==> Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

echo "==> Installing Docker Compose plugin..."
apt install -y docker-compose-plugin

echo "==> Installing Nginx..."
apt install -y nginx

echo "==> Installing Certbot..."
apt install -y certbot python3-certbot-nginx

echo "==> Creating app directory..."
mkdir -p /opt/careloop

echo "==> Bootstrap complete."
echo "    Next: create /opt/careloop/.env and deploy the app."
