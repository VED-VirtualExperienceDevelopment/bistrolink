# Extiende la imagen oficial de Kiwi TCMS con tres overrides:
#  1. local_settings.py — SECURE_PROXY_SSL_HEADER (buena práctica Django
#     estándar, aunque terminó no siendo la causa del loop).
#  2. nginx.conf — la causa REAL del loop de redirects: el nginx interno
#     de la imagen tiene un "return 301 https://..." incondicional en el
#     puerto 8080, sin importar headers de proxy. KIWI_DONT_ENFORCE_HTTPS
#     fue removido en v12.0 y de todos modos no habría alcanzado, porque
#     el enforcement vive en nginx, no en Django.
#     Ver: https://kiwitcms.readthedocs.io/en/latest/installing_docker.html#enable-plain-text-http-access
#  3. docker-entrypoint.sh — la imagen oficial (CMD /httpd-foreground) NO
#     corre migraciones al arrancar (confirmado leyendo ese script: solo
#     limpia temporales y levanta nginx+uwsgi). Sin esto, cada release con
#     cambios de schema deja el banner de "unapplied migrations" hasta que
#     alguien lo corre a mano vía "railway run". Este wrapper corre
#     "manage.py upgrade --noinput" (migrate + refresh_permissions +
#     limpieza de datos obsoletos) antes de arrancar el server real.
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

# La imagen base ya corre como USER 1001 (no-root) llegado este punto.
# COPY deja el archivo con dueño root por default, así que ese usuario no
# puede chmod +x sobre su propio archivo — se vuelve a root solo para
# copiar y dar permisos, y se restaura 1001 al final, igual que lo deja
# la imagen base.
USER root
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
USER 1001

ENTRYPOINT ["/docker-entrypoint.sh"]