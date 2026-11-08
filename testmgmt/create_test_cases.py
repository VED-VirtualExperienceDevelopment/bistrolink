"""
Crea los Test Cases de integración de BistroLink en Kiwi TCMS y los asocia
al Test Plan TP-1 ("Integration tests").

Uso:
    export TCMS_URL="https://localhost/xml-rpc/"
    export TCMS_USERNAME="daiusil"
    export TCMS_PASSWORD="tu-password"
    python create_test_cases.py

Requiere: pip install tcms-api --break-system-packages
"""

import os
import ssl
import xmlrpc.client
from tcms_api import TCMS

# ── Config ───────────────────────────────────────────────────────────────
TCMS_URL = os.environ["TCMS_URL"]
TCMS_USERNAME = os.environ["TCMS_USERNAME"]
TCMS_PASSWORD = os.environ["TCMS_PASSWORD"]

TEST_PLAN_ID = 1  # TP-1: Integration tests
PRODUCT_NAME = "BistroLink"
CATEGORY_NAME = "--default--"  # categoría genérica que Kiwi crea por default

# Certificado self-signed en local — sacar esto cuando apunte a Railway con
# HTTPS real, ahí sí conviene validar el certificado.
ssl._create_default_https_context = ssl._create_unverified_context

# ── Los 13 Test Cases, ya con la convención final [TC-I-XXX] Área: resultado ──
TEST_CASES = [
    ("TC-I-001", "Aislamiento: rechaza request sin token (401)", "keycloak"),
    ("TC-I-002", "Aislamiento: ADMIN autenticado lee datos de su propio tenant (200)", "keycloak"),
    ("TC-I-003", "Aislamiento: rol COCINA recibe 403 en endpoint solo-admin", "keycloak"),
    ("TC-I-004", "Aislamiento: usuario sin tenant_id es rechazado (401)", "keycloak"),
    ("TC-I-005", "Aislamiento: tenant B no ve datos del tenant A (cruzado)", "keycloak"),
    ("TC-I-006", "Usuarios: ADMIN puede crear un Mozo en su propio restaurante (201)", "keycloak"),
    ("TC-I-007", "Usuarios: rechaza crear usuario en restaurante de otro tenant (403)", "keycloak"),
    ("TC-I-008", "Usuarios: rechaza request sin token (401)", "keycloak"),
    ("TC-I-009", 'Health: GET / responde 200 "Hello World!"', "api"),
    ("TC-I-010", "Menú: devuelve el menú cuando tenantId y mesaId son del mismo tenant", "api"),
    ("TC-I-011", "Menú: devuelve 404 si la mesa pertenece a otro tenant", "api"),
    ("TC-I-012", "Menú: devuelve 404 para una mesa inexistente", "api"),
    ("TC-I-013", "Menú: devuelve 400 si los IDs no son UUIDs válidos", "api"),
]


def main():
    rpc = TCMS(TCMS_URL, TCMS_USERNAME, TCMS_PASSWORD).exec

    # ── Resolver Product ────────────────────────────────────────────────
    products = rpc.Product.filter({"name": PRODUCT_NAME})
    if not products:
        raise SystemExit(
            f"No se encontró el Product '{PRODUCT_NAME}'. "
            "Confirmá el nombre exacto en Admin > Products."
        )
    product_id = products[0]["id"]

    # ── Resolver Category (Kiwi TCMS crea '--default--' automáticamente
    #    para cada producto nuevo) ────────────────────────────────────────
    categories = rpc.Category.filter({"product": product_id, "name": CATEGORY_NAME})
    if not categories:
        raise SystemExit(
            f"No se encontró la categoría '{CATEGORY_NAME}' para el producto "
            f"'{PRODUCT_NAME}'. Revisá Admin > Categories."
        )
    category_id = categories[0]["id"]

    # ── Resolver Priority (usamos la que Kiwi trae por default: 'P3') ──
    priorities = rpc.Priority.filter({"value": "P3"})
    priority_id = priorities[0]["id"] if priorities else rpc.Priority.filter({})[0]["id"]

    # ── Resolver Components (deben existir: correr create_components.py antes) ──
    component_ids = {}
    for _, _, component_name in TEST_CASES:
        if component_name in component_ids:
            continue
        comps = rpc.Component.filter({"product": product_id, "name": component_name})
        if not comps:
            raise SystemExit(
                f"No se encontró el Component '{component_name}'. "
                "Corré create_components.py primero."
            )
        component_ids[component_name] = comps[0]["id"]

    created = 0
    linked = 0
    with_component = 0

    for tc_id, summary, component_name in TEST_CASES:
        full_summary = f"[{tc_id}] {summary}"

        # Evitar duplicados si el script se corre más de una vez
        existing = rpc.TestCase.filter({"summary": full_summary})
        if existing:
            case = existing[0]
            print(f"↺  Ya existía: {full_summary}")
        else:
            case = rpc.TestCase.create(
                {
                    "summary": full_summary,
                    "category": category_id,
                    "product": product_id,
                    "priority": priority_id,
                    "case_status": 2,  # 2 = CONFIRMED en instalaciones default de Kiwi
                    "notes": f"Test automatizado (integration). Componente: {component_name}. "
                    f"Corre vía Jest en apps/backend/test/*.e2e-spec.ts",
                }
            )
            created += 1
            print(f"✓  Creado: {full_summary} (id={case['id']})")

        # ── Asignar el Component (tolera el error si ya estaba asignado) ──
        try:
            rpc.TestCase.add_component(case["id"], component_name)
            with_component += 1
        except xmlrpc.client.Fault as e:
            if "already" not in str(e).lower() and "unique" not in str(e).lower():
                print(f"   ⚠  No se pudo asignar component '{component_name}': {e}")

        # ── Asociar el Test Case al Test Plan TP-1 ─────────────────────
        cases_in_plan = rpc.TestCase.filter({"plan": TEST_PLAN_ID, "id": case["id"]})
        if not cases_in_plan:
            rpc.TestPlan.add_case(TEST_PLAN_ID, case["id"])
            linked += 1
            print(f"   → asociado a TP-{TEST_PLAN_ID}")

    print(
        f"\nListo. {created} test cases creados, {linked} asociados al plan "
        f"TP-{TEST_PLAN_ID}, {with_component} con component asignado."
    )


if __name__ == "__main__":
    main()