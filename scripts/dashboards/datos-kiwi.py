#!/usr/bin/env python3
"""BL-601: datos de Kiwi TCMS para el dashboard «Calidad del proceso».

Lee, de cada Test Plan activo del producto y la versión del dashboard
(por defecto «Bistrolink» y «develop»), sus casos y sus últimos Test Runs con
las ejecuciones, y los guarda en un JSON que procesa metricas-pruebas.mjs. No
calcula nada: solo trae los datos.

Autenticación igual que cleanup-test-runs.yml: Auth.login y la cookie de
sesión, con un transporte HTTPS propio (esta instancia rechaza el usuario y
la contraseña en la URL, y un transporte HTTP a secas recibe 301 sin fin).

Uso:
  KIWI_URL=... KIWI_USERNAME=... KIWI_PASSWORD=... \\
    python3 scripts/dashboards/datos-kiwi.py kiwi.json
Opcionales: KIWI_PRODUCTO (por defecto Bistrolink) y KIWI_VERSION (por
defecto develop): solo se leen los Test Plans de ese producto y esa versión.

Solo lectura. Sin dependencias fuera de la biblioteca estándar.
"""

import json
import os
import sys
import time
import xmlrpc.client
from urllib.parse import urlparse

RUNS_POR_PLAN = 10  # los mismos que conserva cleanup-test-runs.yml por defecto
PRODUCTO = os.environ.get("KIWI_PRODUCTO", "").strip() or "Bistrolink"
VERSION = os.environ.get("KIWI_VERSION", "").strip() or "develop"


class CookieTransport(xmlrpc.client.SafeTransport):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._cookies = []

    def send_headers(self, connection, headers):
        if self._cookies:
            connection.putheader("Cookie", "; ".join(self._cookies))
        super().send_headers(connection, headers)

    def parse_response(self, response):
        for header in response.msg.get_all("Set-Cookie", []):
            cookie = header.split(";", 1)[0]
            if cookie not in self._cookies:
                self._cookies.append(cookie)
        return super().parse_response(response)


def con_reintentos(fn, intentos=3):
    for intento in range(1, intentos + 1):
        try:
            return fn()
        except xmlrpc.client.Fault:
            raise  # rechazo real del servidor: no se reintenta
        except (xmlrpc.client.ProtocolError, OSError) as exc:
            if intento == intentos:
                raise
            print(f"Reintento {intento}/{intentos} por: {exc}", file=sys.stderr)
            time.sleep(2 ** intento)


def texto(valor):
    return "" if valor is None else str(valor)


def main():
    salida = sys.argv[1] if len(sys.argv) > 1 else "kiwi.json"
    url = urlparse(os.environ["KIWI_URL"])
    if url.scheme != "https":
        url = url._replace(scheme="https")
    servidor = xmlrpc.client.ServerProxy(
        url._replace(path="/xml-rpc/").geturl(),
        allow_none=True,
        transport=CookieTransport(use_datetime=False),
    )
    con_reintentos(
        lambda: servidor.Auth.login(os.environ["KIWI_USERNAME"], os.environ["KIWI_PASSWORD"])
    )

    # Cada estado tiene un peso: > 0 aprobado, < 0 fallido, 0 sin ejecutar.
    estados = {
        e["id"]: {"nombre": e["name"], "peso": e["weight"]}
        for e in con_reintentos(lambda: servidor.TestExecutionStatus.filter({}))
    }

    # Solo los Test Plans activos del producto y la versión del dashboard:
    # los de otras versiones (por ejemplo, de pruebas viejas) no cuentan.
    filtro = {
        "is_active": True,
        "product__name": PRODUCTO,
        "product_version__value": VERSION,
    }
    print(f"Test Plans activos de {PRODUCTO}, versión {VERSION}:")
    planes = []
    for plan in sorted(
        con_reintentos(lambda: servidor.TestPlan.filter(filtro)),
        key=lambda p: p["id"],
    ):
        plan_id = plan["id"]
        casos = con_reintentos(lambda: servidor.TestCase.filter({"plan": plan_id}))
        runs = con_reintentos(lambda: servidor.TestRun.filter({"plan": plan_id}))
        runs = sorted(runs, key=lambda r: (texto(r.get("start_date")), r["id"]), reverse=True)
        ultimos = []
        for run in runs[:RUNS_POR_PLAN]:
            run_id = run["id"]
            ejecuciones = con_reintentos(lambda: servidor.TestExecution.filter({"run": run_id}))
            ultimos.append(
                {
                    "id": run_id,
                    "resumen": texto(run.get("summary")),
                    "inicio": texto(run.get("start_date")),
                    "ejecuciones": [
                        {
                            "caso": ej.get("case", ej.get("case_id")),
                            "peso": estados.get(
                                ej.get("status", ej.get("status_id")), {}
                            ).get("peso", 0),
                        }
                        for ej in ejecuciones
                    ],
                }
            )
        planes.append(
            {
                "id": plan_id,
                "nombre": plan["name"],
                "casos": [
                    {"id": c["id"], "titulo": c["summary"]}
                    for c in casos
                    # Solo los casos confirmados (CONFIRMED); los propuestos o
                    # deshabilitados no se ejecutan.
                    if texto(c.get("case_status__name")).upper() in ("", "CONFIRMED")
                ],
                "runsTotales": len(runs),
                "runs": ultimos,
            }
        )
        print(f"TP-{plan_id} ({plan['name']}): {len(casos)} casos, {len(runs)} runs")

    with open(salida, "w", encoding="utf-8") as archivo:
        json.dump({"planes": planes}, archivo, ensure_ascii=False)
    print(f"Datos de Kiwi en {salida}")


if __name__ == "__main__":
    main()
