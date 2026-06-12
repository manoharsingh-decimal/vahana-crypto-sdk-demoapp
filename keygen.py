#!/usr/bin/env python3
"""Generate a persistent RSA-4096 keypair for the demo server.

Run once:  python keygen.py
Creates:
  backend/keys/server_private.pem
  backend/keys/server_public.pem
  frontend/.env              (VITE_SERVER_PUBLIC_KEY=<pem>)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../backend/python"))
from vahana_crypto.crypto import generate_rsa_keypair

KEYS_DIR     = os.path.join(os.path.dirname(__file__), "backend", "keys")
PRIV_PATH    = os.path.join(KEYS_DIR, "server_private.pem")
PUB_PATH     = os.path.join(KEYS_DIR, "server_public.pem")
FRONTEND_ENV = os.path.join(os.path.dirname(__file__), "frontend", ".env")

os.makedirs(KEYS_DIR, exist_ok=True)

print("⏳  Generating RSA-4096 keypair…")
priv, pub = generate_rsa_keypair()

with open(PRIV_PATH, "w") as f:
    f.write(priv)
with open(PUB_PATH, "w") as f:
    f.write(pub)

# Vite requires env values to be on one line
pub_oneline = pub.replace("\n", "\\n")
with open(FRONTEND_ENV, "w") as f:
    f.write(f"VITE_SERVER_PUBLIC_KEY={pub_oneline}\n")

print(f"✓   {PRIV_PATH}")
print(f"✓   {PUB_PATH}")
print(f"✓   {FRONTEND_ENV}")
print("\nStart the backend and frontend normally — no more /api/public-key needed.")
