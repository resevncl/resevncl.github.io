"""
Lee las páginas guardadas en /fuente, baja las fotos a /img y actualiza products.json.

Uso:  python extraer.py

- Varias páginas de la misma publicación (una por color) se juntan en un solo
  producto con sus colores. Si la publicación mezcla diseños distintos
  (códigos tipo "0012x-3 White"), cada diseño queda como producto aparte.
- Los productos que ya están en products.json NO se pisan: se conservan nombre,
  precio, visible, etc. Solo se agregan productos nuevos.
- ajustes.json (opcional) define el nombre de los productos nuevos y permite mover o
  renombrar colores (por ejemplo cuando un "color" es en realidad otro diseño).
- Para volver a extraer un producto desde cero, bórralo de products.json y corre de nuevo.
"""
import html
import json
import re
import shutil
import struct
import sys
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).parent
FUENTE = RAIZ / "fuente"
CACHE = FUENTE / "cache"
IMG = RAIZ / "img"
MIN = IMG / "min"
JSON = RAIZ / "products.json"
AJUSTES = RAIZ / "ajustes.json"
CDN = "https://http2.mlstatic.com/"
MIN_LADO = 800  # bajo esto se avisa como baja resolución

RELLENO = r"\b(env[ií]o gratis|oferta|nuevo|new|hot sale|cuotas sin inter[eé]s)\b"
NO_POLERA = r"\b(poler[oó]n|hoodie|sudadera|pantal[oó]n|pants|shorts|jogger|chaqueta|jacket|gorr[ao]|cap|calcet)"
ES_POLERA = r"\b(polera|t-?shirts?|tshirts?|tee|camisetas?|remera)\b"
CODIGO_DISENO = r"^(\d{3,4}x-\d|DILH\d+FH)[\s-]*(.*)$"
COLORES = {"white": "Blanco", "black": "Negro", "blue": "Azul", "red": "Rojo", "green": "Verde",
           "beige": "Beige", "brown": "Marrón", "grey": "Gris", "gray": "Gris", "pink": "Rosado",
           "yellow": "Amarillo", "purple": "Morado", "orange": "Naranjo"}


def slug(texto):
    t = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def limpiar_nombre(titulo):
    t = re.sub(RELLENO, " ", titulo, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip(" -|,")
    return t.title() if t.isupper() or t.islower() else t


def traducir_color(texto):
    partes = [p for p in re.split(r"[\s/-]+", texto.strip()) if p]
    return " / ".join(COLORES.get(p.lower(), p.capitalize()) for p in partes) or "Único"


def dimensiones_webp(datos):
    if datos[:4] != b"RIFF" or datos[8:12] != b"WEBP":
        return None
    tipo = datos[12:16]
    if tipo == b"VP8X":
        return (int.from_bytes(datos[24:27], "little") + 1, int.from_bytes(datos[27:30], "little") + 1)
    if tipo == b"VP8 ":
        w, h = struct.unpack("<HH", datos[26:30])
        return (w & 0x3FFF, h & 0x3FFF)
    if tipo == b"VP8L":
        b = int.from_bytes(datos[21:25], "little")
        return ((b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1)
    return None


def bajar(foto):
    """Baja la foto grande y la miniatura a la caché. Devuelve (foto, error)."""
    try:
        for prefijo, sufijo, carpeta in (("D_NQ_NP_2X_", "-F", CACHE), ("D_NQ_NP_", "-O", CACHE / "min")):
            destino = carpeta / f"{foto}.webp"
            if not destino.exists():
                req = urllib.request.Request(f"{CDN}{prefijo}{foto}{sufijo}.webp", headers={"User-Agent": "Mozilla/5.0"})
                destino.write_bytes(urllib.request.urlopen(req, timeout=40).read())
        return foto, None
    except Exception as e:  # noqa: BLE001
        return foto, str(e)


def leer_pagina(archivo):
    pagina = archivo.read_text(encoding="utf-8", errors="ignore")
    if "captcha/wall" in pagina[:5000] or 'class="ui-pdp-title"' not in pagina:
        return None
    mid = re.search(r'rel="canonical" href="[^"]*?(ML[A-Z])-?(\d+)', pagina)
    titulo = html.unescape(html.unescape(re.search(r'class="ui-pdp-title">([^<]+)', pagina).group(1))).strip()
    fotos = []
    for tag in re.findall(r"<img[^>]*ui-pdp-gallery__figure__image[^>]*>", pagina):
        m = re.search(r'data-zoom="[^"]*?D_NQ_NP_(?:2X_)?(\d+-[A-Z]+\d+_\d+)-', tag) or re.search(r"D_NQ_NP_(?:2X_)?(\d+-[A-Z]+\d+_\d+)-", tag)
        if m and m.group(1) not in fotos:
            fotos.append(m.group(1))
    color, tallas = "", []
    for bloque in pagina.split('class="ui-pdp-outside_variations__picker">')[1:]:
        bloque = bloque[:20000]
        m = re.search(r"title__label[^>]*>([^<:]+):?</span><span[^>]*>([^<]*)", bloque)
        if not m:
            continue
        etiqueta, valor = m.group(1).strip().lower(), html.unescape(m.group(2)).strip()
        if etiqueta == "color":
            color = valor
        elif etiqueta == "talla":
            tallas = [html.unescape(o).strip() for o in re.findall(r'aria-label="Bot[^"]*? de \d+, (?:Seleccionado, )?([^,"]+)', bloque)]
    return {
        "ml": (mid.group(1) + mid.group(2)).lower() if mid else slug(titulo),
        "titulo": titulo, "color": color, "tallas": tallas, "fotos": fotos, "archivo": archivo.name,
    }


def agrupar(paginas, mover=None):
    """Junta las páginas en productos: {id: {titulo, tallas, variantes: [{color, fotos}]}}."""
    productos = {}
    for p in paginas:
        m = re.match(CODIGO_DISENO, p["color"])
        codigo, color = (m.group(1), m.group(2)) if m else ("", p["color"])
        pid, color = p["ml"] + ("-" + slug(codigo) if codigo else ""), traducir_color(color)
        if mover and f'{p["ml"]}|{p["color"]}' in mover:
            pid, color = mover[f'{p["ml"]}|{p["color"]}']
        prod = productos.setdefault(pid, {"titulo": p["titulo"], "tallas": p["tallas"], "variantes": []})
        repetida = next((v for v in prod["variantes"] if v["color"] == color), None)
        if not repetida:
            prod["variantes"].append({"color": color, "fotos": p["fotos"]})
        elif len(p["fotos"]) > len(repetida["fotos"]):  # mismo color guardado dos veces: gana el más completo
            repetida["fotos"] = p["fotos"]
    return productos


def main():
    for carpeta in (IMG, MIN, CACHE, CACHE / "min"):
        carpeta.mkdir(parents=True, exist_ok=True)
    sys.stdout.reconfigure(encoding="utf-8")
    productos = json.loads(JSON.read_text(encoding="utf-8")) if JSON.exists() else []
    ajustes = json.loads(AJUSTES.read_text(encoding="utf-8")) if AJUSTES.exists() else {}
    nombres = ajustes.get("nombres", {})
    existentes = {p["id"] for p in productos}
    usados = {Path(i).name for p in productos for i in p.get("imagenes", [])}
    reporte = {"nuevos": [], "omitidos": [], "dudosos": [], "baja_res": [], "errores": []}

    paginas = []
    for archivo in sorted(FUENTE.glob("*.htm*"), key=lambda a: a.stat().st_mtime):
        datos = leer_pagina(archivo)
        if datos:
            paginas.append(datos)
        else:
            reporte["errores"].append(f"{archivo.name}: no es una publicación (captcha o página incompleta)")

    grupos = {pid: g for pid, g in agrupar(paginas, ajustes.get("variantes")).items() if pid not in existentes}
    fotos = {f for g in grupos.values() for v in g["variantes"] for f in v["fotos"]}
    with ThreadPoolExecutor(6) as pool:
        fallidas = {f: e for f, e in pool.map(bajar, sorted(fotos)) if e}
    reporte["errores"] += [f"foto {f}: {e}" for f, e in fallidas.items()]

    for pid, g in grupos.items():
        titulo = g["titulo"]
        if re.search(NO_POLERA, titulo, re.I) and not re.search(ES_POLERA, titulo, re.I):
            reporte["omitidos"].append(titulo)
            continue
        if not re.search(ES_POLERA, titulo, re.I) or re.search(NO_POLERA, titulo, re.I):
            reporte["dudosos"].append(f"{pid}: {titulo}")

        nombre = nombres.get(pid) or limpiar_nombre(titulo)
        variantes = []
        for v in g["variantes"]:
            base = slug(f"{nombre} {v['color']}")[:60].strip("-")
            n = 2
            while f"{base}-01.webp" in usados:  # dos productos con el mismo nombre y color
                base = f"{slug(nombre + ' ' + v['color'])[:57].strip('-')}-{n}"
                n += 1
            imagenes = []
            for foto in v["fotos"]:
                if foto in fallidas:
                    continue
                nombre_img = f"{base}-{len(imagenes) + 1:02d}.webp"
                shutil.copyfile(CACHE / f"{foto}.webp", IMG / nombre_img)
                shutil.copyfile(CACHE / "min" / f"{foto}.webp", MIN / nombre_img)
                usados.add(nombre_img)
                dim = dimensiones_webp((IMG / nombre_img).read_bytes())
                if dim and max(dim) < MIN_LADO:
                    reporte["baja_res"].append(f"{nombre_img} ({dim[0]}x{dim[1]})")
                imagenes.append(f"img/{nombre_img}")
            variantes.append({"color": v["color"], "imagenes": imagenes})

        productos.append({
            "id": pid,
            "nombre": nombre,
            "imagenes": [i for v in variantes for i in v["imagenes"]],
            "tallas": g["tallas"],
            "colores": [v["color"] for v in variantes],
            "variantes": variantes,
            "categoria": "poleras",
            "precio": None,
            "visible": True,
        })
        reporte["nuevos"].append(f"{pid}: {nombre} — colores {[v['color'] + ' (' + str(len(v['imagenes'])) + ')' for v in variantes]}")

    JSON.write_text(json.dumps(productos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Total en products.json: {len(productos)}")
    for clave, items in reporte.items():
        print(f"\n{clave.upper()} ({len(items)})")
        for i in items:
            print("  -", i)


if __name__ == "__main__":
    main()
