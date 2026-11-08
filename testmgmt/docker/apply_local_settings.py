"""Copia local_settings.py al directorio real de tcms/settings/ dentro
de la imagen, resolviendo el path en runtime de build (no asume una
versión fija de Python)."""
import os
import shutil

import tcms.settings

dest = os.path.join(os.path.dirname(tcms.settings.__file__), "local_settings.py")
shutil.copy("/tmp/local_settings.py", dest)
print("local_settings.py copiado a:", dest)