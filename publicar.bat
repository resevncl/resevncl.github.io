@echo off
rem Doble clic para subir los cambios al sitio publicado
cd /d "%~dp0"
python extraer.py
git add -A
git commit -m "Actualiza catalogo"
git push
pause
