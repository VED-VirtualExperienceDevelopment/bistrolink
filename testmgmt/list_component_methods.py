"""
Diagnóstico: pregunta al servidor de Kiwi TCMS qué métodos RPC existen
relacionados a "Component", en vez de adivinar el nombre exacto.

Uso (mismas env vars que los otros scripts):
    python list_component_methods.py
"""

import os
import ssl
import xmlrpc.client

TCMS_URL = os.environ["TCMS_URL"]
TCMS_USERNAME = os.environ["TCMS_USERNAME"]
TCMS_PASSWORD = os.environ["TCMS_PASSWORD"]

ctx = ssl._create_unverified_context()
server = xmlrpc.client.ServerProxy(TCMS_URL, context=ctx)
server.Auth.login(TCMS_USERNAME, TCMS_PASSWORD)

all_methods = server.system.listMethods()
component_methods = sorted(m for m in all_methods if "component" in m.lower())
testcase_methods = sorted(m for m in all_methods if m.startswith("TestCase."))

print("Métodos relacionados a Component:")
for m in component_methods:
    print(f"  - {m}")

print("\nMétodos de TestCase (por si el vínculo se maneja desde ahí):")
for m in testcase_methods:
    print(f"  - {m}")