#!/bin/sh
# Corre en cada arranque del contenedor, antes de levantar nginx/uwsgi.
# "upgrade" (comando propio de Kiwi TCMS, no el "migrate" plano de Django)
# aplica migraciones pendientes + refresh_permissions + limpieza de
# adjuntos/comentarios obsoletos. Es idempotente: si no hay nada pendiente,
# no hace nada — así que es seguro dejarlo en TODOS los arranques, no solo
# después de un upgrade de imagen.
# --noinput: sin esto pide confirmación interactiva y el contenedor se
# queda colgado esperando un tty que Railway nunca le va a dar.
set -e

/Kiwi/manage.py upgrade --noinput

# Reemplaza este proceso por el script original de la imagen (no lo
# encadena como hijo) — así nginx/uwsgi siguen siendo el PID 1 y las
# señales de Railway (stop/restart) les llegan directo, igual que si
# nunca hubiéramos interpuesto este entrypoint.
exec /httpd-foreground