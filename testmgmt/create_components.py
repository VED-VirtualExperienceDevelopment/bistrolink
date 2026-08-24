"""
Crea los Components del producto BistroLink en Kiwi TCMS.

Uso (mismas env vars que los otros scripts):
    $env:TCMS_URL="https://localhost/xml-rpc/"
    $env:TCMS_USERNAME="daiusil"
    $env:TCMS_PASSWORD="tu-password"
    python create_components.py
"""

import os
import ssl
from tcms_api import TCMS

TCMS_URL = os.environ["TCMS_URL"]
TCMS_USERNAME = os.environ["TCMS_USERNAME"]
TCMS_PASSWORD = os.environ["TCMS_PASSWORD"]

ssl._create_default_https_context = ssl._create_unverified_context

PRODUCT_NAME = "BistroLink"

COMPONENTS = [
    ("api", "Backend NestJS"),
    ("web", "Frontend"),
    ("keycloak", "Auth"),
    ("evolution-api", "Integración WhatsApp"),
    ("postgresql", "Base de datos"),
]


def main():
    rpc = TCMS(TCMS_URL, TCMS_USERNAME, TCMS_PASSWORD).exec

    products = rpc.Product.filter({"name": PRODUCT_NAME})
    if not products:
        raise SystemExit(
            f"No se encontró el Product '{PRODUCT_NAME}'. Creálo primero en Admin > Products."
        )
    product_id = products[0]["id"]

    created = 0

    for name, description in COMPONENTS:
        existing = rpc.Component.filter({"product": product_id, "name": name})
        if existing:
            print(f"↺  Ya existía: {name}")
            continue

        rpc.Component.create(
            {
                "product": product_id,
                "name": name,
                "description": description,
            }
        )
        created += 1
        print(f"✓  Creado: {name} ({description})")

    print(f"\nListo. {created} components creados.")


if __name__ == "__main__":
    main()