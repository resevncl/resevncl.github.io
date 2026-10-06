"""
Lee las páginas guardadas en /fuente, baja las fotos a /img y actualiza products.json.

Uso:  python extraer.py

- Los productos que ya están en products.json NO se pisan: se conservan nombre,
  precio, visible, etc. Solo se agregan los productos nuevos.
- Para volver a extraer un producto desde cero, bórralo de products.json y corre de nuevo.
"""
import html
import json
import re
import struct
import sys
import unicodedata
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).parent
FUENTE = RAIZ / "fuente"
IMG = RAIZ / "img"
MIN = IMG / "min"
JSON = RAIZ / "products.json"
CDN = "https://http2.mlstatic.com/"
MIN_ANCHO = 800  # bajo esto se avisa como baja resolución

RELLENO = r"\b(env[ií]o gratis|oferta|nuevo|new|hot sale|2024|2025|2026|cuotas sin inter[eé]s)\b"
NO_POLERA = r"\b(poler[oó]n|hoodie|sudadera|pantal[oó]n|pants|shorts?|jogger|chaqueta|jacket|gorr[ao]|cap|calcet)"
ES_POLERA = r"\b(polera|t-?shirt|tshirt|tee|camiseta|remera)\b"


def slug(texto):
    t = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def limpiar_nombre(titulo):
    t = re.sub(RELLENO, " ", titulo, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip(" -|,")
    return t.title() if t.isupper() or t.islower() else t


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


def bajar(url, destino):
    if not destino.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        destino.write_bytes(urllib.request.urlopen(req, timeout=30).read())
    return destino.read_bytes()


def variantes(pagina):
    """Devuelve {'color': [...], 'talla': [...]} desde los selectores de la publicación."""
    res = {}
    for bloque in pagina.split('class="ui-pdp-outside_variations__picker">')[1:]:
        bloque = bloque[:20000]
        m = re.search(r'title__label[^>]*>([^<:]+):?</span><span[^>]*>([^<]*)', bloque)
        if not m:
            continue
        etiqueta, valor = m.group(1).strip().lower(), html.unescape(m.group(2)).strip()
        opciones = [html.unescape(o).strip() for o in re.findall(r'aria-label="Bot[^"]*? de \d+, ([^,"]+)', bloque)]
        if not opciones and valor and valor.lower() != "elige":
            opciones = [valor]
        res[etiqueta] = list(dict.fromkeys(opciones))
    return res


def extraer(archivo):
    pagina = archivo.read_text(encoding="utf-8", errors="ignore")
    if "captcha/wall" in pagina[:5000] or 'class="ui-pdp-title"' not in pagina:
        return None, "no es una publicación (captcha o página incompleta)"
    mid = re.search(r'rel="canonical" href="[^"]*?(ML[A-Z])-?(\d+)', pagina)
    titulo = html.unescape(html.unescape(re.search(r'class="ui-pdp-title">([^<]+)', pagina).group(1))).strip()
    galeria = pagina[: pagina.find("Productos relacionados")] if "Productos relacionados" in pagina else pagina
    fotos = list(dict.fromkeys(re.findall(r"D_NQ_NP_2X_(\d+-[A-Z]+\d+_\d+)-F", galeria)))
    v = variantes(pagina)
    return {
        "id": (mid.group(1) + mid.group(2)).lower() if mid else slug(titulo),
        "titulo": titulo,
        "fotos": fotos,
        "tallas": v.get("talla", []),
        "colores": v.get("color", []),
    }, None


def main():
    IMG.mkdir(exist_ok=True)
    MIN.mkdir(exist_ok=True)
    productos = json.loads(JSON.read_text(encoding="utf-8")) if JSON.exists() else []
    existentes = {p["id"] for p in productos}
    reporte = {"nuevos": [], "omitidos": [], "dudosos": [], "baja_res": [], "errores": []}

    for archivo in sorted(FUENTE.glob("*.htm*")):
        datos, error = extraer(archivo)
        if error:
            reporte["errores"].append(f"{archivo.name}: {error}")
            continue
        if datos["id"] in existentes:
            continue
        titulo = datos["titulo"]
        if re.search(NO_POLERA, titulo, re.I) and not re.search(ES_POLERA, titulo, re.I):
            reporte["omitidos"].append(titulo)
            continue
        if not re.search(ES_POLERA, titulo, re.I) or re.search(NO_POLERA, titulo, re.I):
            reporte["dudosos"].append(titulo)

        nombre = limpiar_nombre(titulo)
        base = slug(nombre + " " + (datos["colores"][0] if len(datos["colores"]) == 1 else ""))[:60].strip("-")
        imagenes = []
        for n, foto in enumerate(datos["fotos"], 1):
            nombre_img = f"{base}-{n:02d}.webp"
            try:
                grande = bajar(f"{CDN}D_NQ_NP_2X_{foto}-F.webp", IMG / nombre_img)
                bajar(f"{CDN}D_NQ_NP_{foto}-O.webp", MIN / nombre_img)
            except Exception as e:  # noqa: BLE001
                reporte["errores"].append(f"{nombre_img}: {e}")
                continue
            dim = dimensiones_webp(grande)
            if dim and max(dim) < MIN_ANCHO:
                reporte["baja_res"].append(f"{nombre_img} ({dim[0]}x{dim[1]})")
            imagenes.append(f"img/{nombre_img}")

        productos.append({
            "id": datos["id"],
            "nombre": nombre,
            "imagenes": imagenes,
            "tallas": datos["tallas"],
            "colores": datos["colores"],
            "categoria": "poleras",
            "precio": None,
            "visible": True,
        })
        existentes.add(datos["id"])
        reporte["nuevos"].append(f"{nombre} — {len(imagenes)} fotos, tallas {datos['tallas']}, colores {datos['colores']}")

    JSON.write_text(json.dumps(productos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"Total en products.json: {len(productos)}")
    for clave, items in reporte.items():
        print(f"\n{clave.upper()} ({len(items)})")
        for i in items:
            print("  -", i)


if __name__ == "__main__":
    main()
