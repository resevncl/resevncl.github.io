(function () {
  const C = window.CONFIG;
  const $ = (id) => document.getElementById(id);
  let productos = [];
  let categoriaActiva = null;

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
  function tarjeta(p) {
    const boton = crear("button", "tarjeta");
    boton.type = "button";
    boton.addEventListener("click", () => (location.hash = "p=" + p.id));

    const foto = crear("div", "tarjeta-foto");
    if (p.imagenes[0]) {
      const img = crear("img");
      img.src = miniatura(p.imagenes[0]);
      img.onerror = () => { img.onerror = null; img.src = p.imagenes[0]; };
      img.alt = p.nombre;
      img.loading = "lazy";
      img.decoding = "async";
      foto.append(img);
    }
    boton.append(foto, crear("p", "tarjeta-nombre", p.nombre));

    const precio = formatoPrecio(p.precio);
    if (precio) boton.append(crear("p", "tarjeta-precio", precio));
    if (p.tallas.length) boton.append(crear("p", "tarjeta-tallas", p.tallas.join(" · ")));
    if (p.variantes.length > 1) boton.append(crear("p", "tarjeta-tallas", p.variantes.length + " colores"));
    return boton;
  }

  function pintarGrilla() {
    const lista = productos.filter((p) => !categoriaActiva || p.categoria === categoriaActiva);
    $("grilla").replaceChildren(...lista.map(tarjeta));
    $("contador").textContent = lista.length + (lista.length === 1 ? " producto" : " productos");
  }

  function pintarFiltros() {
    const categorias = [...new Set(productos.map((p) => p.categoria).filter(Boolean))];
    if (categorias.length < 2) return;
    const botones = [null, ...categorias].map((cat) => {
      const b = crear("button", "", cat || "Todo");
      b.type = "button";
      b.setAttribute("aria-pressed", String(cat === categoriaActiva));
      b.addEventListener("click", () => { categoriaActiva = cat; pintarFiltros(); pintarGrilla(); });
      return b;
    });
    $("filtros").replaceChildren(...botones);
    $("filtros").hidden = false;
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

  function pintarFotos(p, imagenes) {
    const fotos = $("detalle-fotos");
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
      b.addEventListener("click", () => fotos.scrollTo({ left: i * fotos.clientWidth, behavior: "smooth" }));
      return b;
    }) : [];
    $("detalle-puntos").replaceChildren(...puntos);
    const marcar = () => {
      const actual = Math.round(fotos.scrollLeft / fotos.clientWidth);
      puntos.forEach((b, i) => b.setAttribute("aria-current", String(i === actual)));
    };
    fotos.onscroll = marcar;
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
    $("detalle-nombre").textContent = p.nombre;
    const precio = formatoPrecio(p.precio);
    $("detalle-precio").textContent = precio;
    $("detalle-precio").hidden = !precio;
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
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("detalle").hidden) salirDetalle(); });
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
      pintarFiltros();
      pintarGrilla();
      if (!productos.length) { $("aviso").textContent = "Pronto nuevos productos."; $("aviso").hidden = false; }
      ruta();
    })
    .catch(() => {
      $("aviso").textContent = "No se pudo cargar el catálogo. Revisa que products.json esté bien escrito.";
      $("aviso").hidden = false;
    });
})();
