# Override de settings para correr detrás del proxy de Railway.
#
# Railway termina el HTTPS en su borde y reenvía la conexión al container
# como HTTP plano, mandando el header X-Forwarded-Proto: https para avisar
# que la conexión original SÍ era segura.
#
# Kiwi TCMS (Django) por default no confía en ese header y fuerza un
# redirect HTTP->HTTPS en su propio puerto 8080, lo que genera un loop
# infinito de redirects contra el proxy de Railway (que también manda todo
# como HTTP al mismo puerto). Esta línea le dice a Django que reconozca el
# header y trate la conexión como ya segura, evitando el redirect.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Healthcheck de Railway (BL-229): entra por HTTP interno, sin el header
# X-Forwarded-Proto, y Railway no sigue redirecciones. Sin esta excepción,
# Django responde 301 a https:// y el deploy falla aunque Kiwi esté sano.
# Se exime solo la página de login, que responde 200 sin sesión y pasa por
# Django y uWSGI (detecta un deploy roto). Desde afuera no cambia nada: el
# único acceso público es por el HTTPS de Railway.
# Django compara contra la ruta sin la barra inicial.
SECURE_REDIRECT_EXEMPT = [r"^accounts/login/$"]

# El dominio que asigna Railway cambia según el proyecto/environment, así
# que confiamos en cualquier host (aceptable para una instancia interna de
# test management, no expuesta como producto público).
ALLOWED_HOSTS = ["*"]
