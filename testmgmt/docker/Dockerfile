# Extiende la imagen oficial de Kiwi TCMS con dos overrides:
#  1. local_settings.py — SECURE_PROXY_SSL_HEADER (buena práctica Django
#     estándar, aunque terminó no siendo la causa del loop).
#  2. nginx.conf — la causa REAL del loop de redirects: el nginx interno
#     de la imagen tiene un "return 301 https://..." incondicional en el
#     puerto 8080, sin importar headers de proxy. KIWI_DONT_ENFORCE_HTTPS
#     fue removido en v12.0 y de todos modos no habría alcanzado, porque
#     el enforcement vive en nginx, no en Django.
#     Ver: https://kiwitcms.readthedocs.io/en/latest/installing_docker.html#enable-plain-text-http-access
FROM kiwitcms/kiwi:latest

COPY local_settings.py /tmp/local_settings.py
COPY nginx.conf /Kiwi/etc/nginx.conf

RUN python3 -c "\
    import shutil, os, tcms.settings; \
    dest = os.path.join(os.path.dirname(tcms.settings.__file__), 'local_settings.py'); \
    shutil.copy('/tmp/local_settings.py', dest); \
    print('local_settings.py copiado a:', dest)"