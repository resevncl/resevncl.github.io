(function () {
  const C = window.CONFIG;
  const $ = (id) => document.getElementById(id);
  let productos = [];
  let marcaActiva = null;

  const linkWhatsapp = (texto) =>
    "https://wa.me/" + C.whatsapp.replace(/\D/g, "") + (texto ? "?text=" + encodeURIComponent(texto) : "");

  // Si el precio es null (o vacío) no se muestra nada
  const formatoPrecio = (precio) =>
    precio === null || precio === undefined || precio === ""
      ? ""
      : "$" + Number(precio).toLocaleString("es-CL");

  const miniatura = (ruta) => ruta.replace(/^img\//, "img/min/");

  function crear(etiqueta, clase, texto) {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto) el.textContent = texto;
    return el;
  }

  // ---------- Datos de la tienda ----------
  document.title = C.nombreTienda + " — Catálogo";
  document.querySelectorAll("[data-tienda]").forEach((el) => (el.textContent = C.nombreTienda));
  if (C.logo) {
    $("logo-img").src = C.logo;
    $("logo-img").hidden = false;
    // El logo hace de primera letra: "R" + "ESEVN"
    if (C.logoComoInicial) {
      $("logo-texto").textContent = C.nombreTienda.slice(1);
      $("logo").setAttribute("aria-label", C.nombreTienda);
    }
  }
  $("link-instagram").href = "https://instagram.com/" + C.instagram.replace(/^@/, "");
  $("link-whatsapp").href = linkWhatsapp("");
  // Abre el chat directo (DM) de Instagram; Instagram no permite prellenar el mensaje
  $("detalle-instagram").href = "https://ig.me/m/" + C.instagram.replace(/^@/, "");

  if (C.aviso) {
    ["aviso-promo", "detalle-promo"].forEach((id) => { $(id).textContent = C.aviso; $(id).hidden = false; });
  }

  if (C.notaEntrega) {
    document.querySelectorAll("[data-entrega]").forEach((el) => { el.textContent = C.notaEntrega; el.hidden = false; });
  }

  // ---------- Grilla ----------
  // Nombre corto para la tarjeta: "Polera Hellstar Estrella" -> "Estrella" (la marca va en su propia línea)
  function nombreCorto(p) {
    if (!p.marca) return p.nombre;
    const i = p.nombre.toLowerCase().indexOf(p.marca.toLowerCase());
    return (i >= 0 && p.nombre.slice(i + p.marca.length).trim()) || p.nombre;
  }

  function tarjeta(p) {
    const boton = crear("button", "tarjeta");
    boton.type = "button";
    boton.addEventListener("click", () => (location.hash = "p=" + p.id));

    const foto = crear("div", "tarjeta-foto");
    p.imagenes.slice(0, 2).forEach((ruta, i) => {
      const img = crear("img", i ? "tarjeta-foto-dorso" : "");
      img.src = miniatura(ruta);
      img.onerror = () => { img.onerror = null; img.src = ruta; };
      img.alt = i ? "" : p.nombre;
      img.loading = "lazy";
      img.decoding = "async";
      foto.append(img);
    });
    boton.append(foto);
    if (p.marca) boton.append(crear("p", "tarjeta-marca", p.marca));
    boton.append(crear("p", "tarjeta-nombre", nombreCorto(p)));

    const precio = formatoPrecio(p.precio);
    if (precio) boton.append(crear("p", "tarjeta-precio", precio));
    const extra = [p.tallas.join(" · "), p.variantes.length > 1 ? p.variantes.length + " colores" : ""].filter(Boolean);
    if (extra.length) boton.append(crear("p", "tarjeta-tallas", extra.join("  |  ")));
    return boton;
  }

  // Marcas ordenadas de la que tiene más poleras a la que tiene menos
  function marcas() {
    const cuenta = {};
    productos.forEach((p) => { if (p.marca) cuenta[p.marca] = (cuenta[p.marca] || 0) + 1; });
    return Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a]);
  }

  function seccion(titulo, lista) {
    const sec = crear("section", "seccion");
    const cabecera = crear("div", "catalogo-cabecera");
    cabecera.append(crear("h2", "", titulo), crear("span", "", lista.length + (lista.length === 1 ? " producto" : " productos")));
    const grilla = crear("div", "grilla");
    grilla.append(...lista.map(tarjeta));
    sec.append(cabecera, grilla);
    return sec;
  }

  // Sin marca elegida se muestran todas, una sección por marca
  function pintarGrilla() {
    const grupos = (marcaActiva ? [marcaActiva] : marcas())
      .map((m) => seccion(m, productos.filter((p) => p.marca === m)));
    const sinMarca = productos.filter((p) => !p.marca);
    if (sinMarca.length && !marcaActiva) grupos.push(seccion(grupos.length ? "Otras" : "Poleras", sinMarca));
    $("secciones").replaceChildren(...grupos);
  }

  function pintarMenu() {
    const enlace = (texto, marca) => {
      const b = crear("button", "", texto);
      b.type = "button";
      b.setAttribute("aria-pressed", String(marca === marcaActiva));
      b.addEventListener("click", () => {
        marcaActiva = marca;
        pintarMenu();
        pintarGrilla();
        $("catalogo").scrollIntoView({ behavior: "smooth" });
      });
      return b;
    };
    const contacto = crear("a", "", "Contacto");
    contacto.href = "#contacto";
    $("menu").replaceChildren(enlace("Todo", null), ...marcas().map((m) => enlace(m, m)), contacto);
  }

  function pintarBanner() {
    const ruta = C.bannerImagen || (productos[0] && productos[0].imagenes[0]);
    if (!ruta) return;
    $("banner-img").src = ruta;
    $("banner-titulo").textContent = C.bannerTitulo;
    $("banner-boton").textContent = C.bannerBoton;
    $("banner").hidden = false;
  }

  // ---------- Detalle ----------
  function chips(idGrupo, valores) {
    const grupo = $(idGrupo);
    grupo.hidden = !valores.length;
    grupo.querySelector("ul").replaceChildren(...valores.map((v) => crear("li", "", v)));
  }

  // Galería: se desliza con el dedo, con las flechas, con los puntos o con las teclas ← →
  let irAFoto = () => {};

  function pintarFotos(p, imagenes) {
    const fotos = $("detalle-fotos");
    let actual = 0;
    fotos.replaceChildren(...imagenes.map((ruta, i) => {
      const img = crear("img");
      img.src = ruta;
      img.alt = p.nombre + " — foto " + (i + 1);
      if (i > 0) img.loading = "lazy";
      return img;
    }));

    const puntos = imagenes.length > 1 ? imagenes.map((_, i) => {
      const b = crear("button");
      b.type = "button";
      b.setAttribute("aria-label", "Foto " + (i + 1));
      b.addEventListener("click", () => irAFoto(i));
      return b;
    }) : [];
    $("detalle-puntos").replaceChildren(...puntos);

    const marcar = () => {
      puntos.forEach((b, i) => b.setAttribute("aria-current", String(i === actual)));
      $("flecha-izq").hidden = imagenes.length < 2 || actual === 0;
      $("flecha-der").hidden = imagenes.length < 2 || actual === imagenes.length - 1;
    };
    irAFoto = (i, relativo) => {
      actual = Math.max(0, Math.min(imagenes.length - 1, relativo ? actual + i : i));
      fotos.scrollTo({ left: actual * fotos.clientWidth, behavior: "smooth" });
      marcar();
    };
    // Al deslizar con el dedo, la foto visible pasa a ser la actual
    let espera;
    fotos.onscroll = () => {
      clearTimeout(espera);
      espera = setTimeout(() => { actual = Math.round(fotos.scrollLeft / fotos.clientWidth); marcar(); }, 120);
    };
    fotos.scrollLeft = 0;
    marcar();
  }

  // Elige un color: cambia las fotos, el texto "Color: X" y el mensaje de WhatsApp
  function elegirColor(p, indice) {
    const v = p.variantes[indice];
    pintarFotos(p, v.imagenes);
    $("detalle-color-actual").textContent = v.color;
    $("detalle-colores").querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === indice)));
    const consulta = p.variantes.length > 1 ? p.nombre + " (color " + v.color + ")" : p.nombre;
    $("detalle-whatsapp").href = linkWhatsapp(C.mensajeWhatsapp.replace("{nombre}", consulta));
  }

  function abrirDetalle(p) {
    $("detalle-marca").textContent = p.marca || "";
    $("detalle-nombre").textContent = p.nombre;
    const precio = formatoPrecio(p.precio);
    $("detalle-precio").textContent = precio;
    $("detalle-precio").hidden = !precio;
    // "sinPromo": true en products.json oculta el aviso de promoción en esa polera
    $("detalle-promo").hidden = !C.aviso || p.sinPromo === true;
    chips("detalle-tallas", p.tallas);

    const colores = $("detalle-colores");
    colores.hidden = !p.variantes.some((v) => v.color);
    colores.querySelector("ul").replaceChildren(...(p.variantes.length > 1 ? p.variantes.map((v, i) => {
      const li = crear("li");
      const b = crear("button");
      b.type = "button";
      b.title = v.color;
      b.setAttribute("aria-label", v.color);
      if (v.imagenes[0]) {
        const img = crear("img");
        img.src = miniatura(v.imagenes[0]);
        img.alt = "";
        b.append(img);
      } else {
        b.textContent = v.color;
      }
      b.addEventListener("click", () => elegirColor(p, i));
      li.append(b);
      return li;
    }) : []));

    $("detalle").hidden = false;
    document.body.classList.add("sin-scroll");
    $("detalle").scrollTop = 0;
    elegirColor(p, 0);
  }

  function cerrarDetalle() {
    $("detalle").hidden = true;
    document.body.classList.remove("sin-scroll");
  }

  // El detalle vive en el hash (#p=id): el botón "atrás" del celular lo cierra
  // y cada polera tiene su propio link para compartir.
  function ruta() {
    const m = location.hash.match(/^#p=(.+)$/);
    const p = m && productos.find((x) => x.id === decodeURIComponent(m[1]));
    if (p) abrirDetalle(p); else cerrarDetalle();
  }

  function salirDetalle() {
    history.pushState("", document.title, location.pathname + location.search);
    cerrarDetalle();
  }

  $("detalle-cerrar").addEventListener("click", salirDetalle);
  $("detalle").addEventListener("click", (e) => { if (e.target === $("detalle")) salirDetalle(); });
  $("flecha-izq").addEventListener("click", () => irAFoto(-1, true));
  $("flecha-der").addEventListener("click", () => irAFoto(1, true));
  document.addEventListener("keydown", (e) => {
    if ($("detalle").hidden) return;
    if (e.key === "Escape") salirDetalle();
    if (e.key === "ArrowLeft") irAFoto(-1, true);
    if (e.key === "ArrowRight") irAFoto(1, true);
  });
  window.addEventListener("hashchange", ruta);

  // ---------- Carga ----------
  fetch("products.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((datos) => {
      productos = datos
        .filter((p) => p.visible !== false)
        .map((p) => {
          const imagenes = p.imagenes || [];
          // Sin "variantes" el producto funciona igual: un solo grupo con todas sus fotos
          const variantes = p.variantes && p.variantes.length
            ? p.variantes
            : [{ color: (p.colores || []).join(" / "), imagenes }];
          return { ...p, imagenes, tallas: p.tallas || [], variantes };
        });
      pintarBanner();
      pintarMenu();
      pintarGrilla();
      if (!productos.length) { $("aviso").textContent = "Pronto nuevos productos."; $("aviso").hidden = false; }
      ruta();
    })
    .catch(() => {
      $("aviso").textContent = "No se pudo cargar el catálogo. Revisa que products.json esté bien escrito.";
      $("aviso").hidden = false;
    });
})();
