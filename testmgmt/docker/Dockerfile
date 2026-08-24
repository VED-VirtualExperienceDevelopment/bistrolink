# Extiende la imagen oficial de Kiwi TCMS con dos overrides:
#  1. local_settings.py — SECURE_PROXY_SSL_HEADER (buena práctica Django
#     estándar, aunque terminó no siendo la causa del loop).
#  2. nginx.conf — la causa REAL del loop de redirects: el nginx interno
#     de la imagen tiene un "return 301 https://..." incondicional en el
#     puerto 8080, sin importar headers de proxy. KIWI_DONT_ENFORCE_HTTPS
#     fue removido en v12.0 y de todos modos no habría alcanzado, porque
#     el enforcement vive en nginx, no en Django.
#     Ver: https://kiwitcms.readthedocs.io/en/latest/installing_docker.html#enable-plain-text-http-access
#
# NOTA: el paso de copiar local_settings.py vive en un .py aparte
# (apply_local_settings.py) en vez de python inline en este RUN, porque
# un inline multilínea entre comillas es frágil ante cualquier formatter
# que reindente el Dockerfile al guardar (VS Code, Prettier, etc.) — un
# archivo .py normal no tiene ese problema.
FROM kiwitcms/kiwi:latest

COPY local_settings.py /tmp/local_settings.py
COPY nginx.conf /Kiwi/etc/nginx.conf
COPY apply_local_settings.py /tmp/apply_local_settings.py

RUN python3 /tmp/apply_local_settings.py