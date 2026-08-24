
# Extiende la imagen oficial de Kiwi TCMS agregando local_settings.py,
# siguiendo el patrón de customización documentado oficialmente:
# https://kiwitcms.readthedocs.io/en/latest/installing_docker.html#customization
#
# Necesario para correr detrás de Railway (o cualquier proxy que termine
# HTTPS y reenvíe como HTTP plano) sin caer en un loop de redirects, ya que
# la variable KIWI_DONT_ENFORCE_HTTPS fue removida desde Kiwi TCMS v12.0.
FROM kiwitcms/kiwi:latest
 
COPY local_settings.py /tmp/local_settings.py
 
# Resolvemos el path real de tcms/settings/ en runtime de build, en vez de
# asumir una versión fija de Python (varía entre versiones de la imagen).
RUN python3 -c "\
import shutil, os, tcms.settings; \
dest = os.path.join(os.path.dirname(tcms.settings.__file__), 'local_settings.py'); \
shutil.copy('/tmp/local_settings.py', dest); \
print('local_settings.py copiado a:', dest)"