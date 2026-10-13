/**********************************************************************
 * SISTEMA DE CONTROL DE CAJA CHICA — GRUPO VIZCARRA
 * Módulo: SOLICITUD DE CAJA CHICA (Fase 1, versión Web App)
 *
 * CAMBIO 30-sept-2026 — BLOQUES COMUNES (no solo MOVIMIENTOS DE EFECTIVO).
 * getCatalogoSolicitud() ya no reparte un solo bloque: acepta una LISTA.
 * Hoy son MOVIMIENTOS DE EFECTIVO y COSTO DE VENTAS. Eso devuelve las
 * compras de mercancía al menú de todas las cajas y con eso el webhook de
 * Compras (AppSheet) vuelve a encontrar su cuenta.
 *
 * CAMBIO 29-sept-2026 — LA COLUMNA "SUCURSAL" VOLVIÓ A SER LA CAJA.
 * Al hacer que la cuenta contable siguiera a la sucursal del GASTO, se
 * quedó una línea escribiendo esa misma sucursal en la columna
 * "Sucursal" del Concentrado. Pero esa columna es la CAJA de donde sale
 * el efectivo: de ella cuelgan el folio y el archivo de flujo al que se
 * sincroniza la fila. Por eso aparecía "SAN PABLO UNO" donde debía
 * decir "CEDIS SAN PABLO". Ahora la caja se resuelve aparte (cajaReal)
 * y cada columna guarda lo suyo:
 *
 *     Sucursal              -> la CAJA que paga          (CEDIS SAN PABLO)
 *     Sucursales del Gasto  -> a quién se le carga       (SAN PABLO DOS)
 *     Cuenta Contable       -> sale de la del GASTO      (60301001)
 *     Folio                 -> prefijo de la CAJA        (CC-CDS-...)
 *
 * CAMBIO 22-sept-2026 — QUE EL WEBHOOK DE APPSHEET SÍ ENTRE.
 * AppSheet manda un JSON a doPost() y, si algo no empataba, la solicitud
 * se rechazaba EN SILENCIO: AppSheet daba el envío por bueno y en el
 * Concentrado no aparecía nada. Eran tres cosas:
 *
 *   1) EL NOMBRE DE LA SUCURSAL SE BUSCABA LETRA POR LETRA.
 *      Antes:  cat.entries[datos.sucursal]
 *      Si AppSheet mandaba "Cedis San Pablo" y en Catálogos decía
 *      "CEDIS SAN PABLO", la lista salía vacía. Ahora se busca sin
 *      distinguir acentos, mayúsculas ni espacios de más, y además se
 *      aceptan los nombres del catálogo contable nuevo ("San Pablo 1"
 *      vale igual que "SAN PABLO UNO").
 *
 *   2) EL TIPO DE GASTO SE COMPARABA SOLO CONTRA EL CONCEPTO.
 *      Si AppSheet mandaba "Gastos de Personal — Finiquitos", no
 *      empataba con "Gastos de Personal" y truena. Ahora se intenta
 *      contra concepto, concepto + subconcepto, la columna de
 *      combinación, la cuenta, y por último por coincidencia parcial.
 *
 *   3) NO HABÍA BITÁCORA.
 *      Ahora cada POST que llega se anota en la pestaña LOG WEBHOOK con
 *      la fecha, el JSON completo y el resultado. Si algo falla, se ve
 *      en la hoja sin tener que entrar a Ejecuciones.
 *
 * También: si el PDF que manda AppSheet resulta ser una página de login
 * (pasa cuando la URL pide sesión), ya NO se adjunta disfrazado de PDF;
 * se anota en la bitácora y la solicitud sigue su curso.
 **********************************************************************/

var SOL = {
  HOJA_CONCENTRADO: 'Concentrado',
  ESTATUS_INICIAL: 'Pendiente de autorizar',
  NOMBRE_REMITENTE: 'Sistema de Caja Chica Vizcarra',

  COL_FOLIO:        'Folio',
  COL_FECHA_SOL:    'Fecha solicitud',
  COL_SUCURSAL:     'Sucursal',
  COL_COLABORADOR:  'Colaborador',
  COL_AREA:         'Comando gasto',
  COL_TIPO_GASTO:   'Tipo de Gasto',
  COL_CUENTA:       'Cuenta Contable',
  COL_SUBCONCEPTO:  'Descripcion Subconcepto',
  COL_IMPORTE:      'Importe',
  COL_ESTATUS_AUT:  'Estatus  Autorizacion',
  COL_AUTORIZO:     'Autorizo',
  COL_CORREO_SOL:   'Correo del Solicitane',
  COL_OBSERV:       'Observaciones',

  // Columnas nuevas: se crean solas si no existen.
  // COL_SUCURSAL = la CAJA de donde sale el efectivo físico.
  // COL_SUC_APLICA = a qué sucursal(es) se le carga el gasto.
  COL_SUC_APLICA:   'Sucursales del Gasto',
  COL_ADJUNTOS:     'Adjuntos Solicitud',

  // Bitácora de todo lo que entra por el webhook de AppSheet.
  HOJA_LOG: 'LOG WEBHOOK'
};

/* Códigos de folio por sucursal.
   Se agregaron los nombres del catálogo contable nuevo como ALIAS, para
   que AppSheet pueda mandar cualquiera de las dos formas de escribirlo
   y el folio salga igual. */
var SUC_CODIGOS = {
  'GUADALAJARA':'GDL', 'SAN PABLO UNO':'SP1', 'SAN PABLO DOS':'SP2', 'SOTANO':'SOT',
  'CORREO UNO':'CR1', 'CORREO DOS':'CR2', 'RAMON CORONA UNO':'RC1', 'RAMON CORONA DOS':'RC2',
  'BOLIVIA':'BOL', 'BRASIL UNO':'BR1', 'CORREGIDORA':'CRG', 'APARTADO UNO':'AP1', 'APARTADO DOS':'AP2',
  'PUEBLA':'PUE', 'OUTLET':'OUT', 'ECOMMERCE':'ECO', 'CEDIS TEXCOCO':'CDT', 'CEDIS SAN PABLO':'CDS',
  'HAMBURGO':'HAM', 'PUEBLO ALFREDO':'PAV', 'PLATA 14':'CDP', 'PLATA':'CDP', 'CASTILLO':'CDC', 'ALFREDO':'AVZ',
  'ALFREDO VIZCARRA':'AVZ', 'EDITH HUERTA VARGAS':'EHV', 'NATASHA VIZCARRA':'NVZ',
  'ALFREDO JR. VIZCARRA':'AJV', 'SURI AILEEN VIZCARRA':'SAV', 'FERNANDA VIZCARRA':'FVZ',
  'APOYOS A FAMILIA':'APF', 'CASA FAMILIAR':'CSF',

  /* --- ALIAS del catálogo contable nuevo (mismas cajas, otro nombre) --- */
  'SAN PABLO 1':'SP1', 'SAN PABLO 2':'SP2', 'SOTANO 1':'SOT',
  'CORREO 1':'CR1', 'CORREO 2':'CR2',
  'RAMON CORONA 1':'RC1', 'RAMON CORONA 2':'RC2',
  'BRASIL 1':'BR1', 'BRASIL 2':'BR2',
  'CORREGIDORA 1':'CRG', 'CORREGIDORA 2':'CG2',
  'APARTADO 1':'AP1', 'APARTADO 2':'AP2',
  'E-COMMERCE':'ECO', 'E COMMERCE':'ECO',
  'CEDIS SAN PABLO 1':'CDS'
};


/* ===== MENÚ EN LA HOJA =====
 * Para que aparezca: guarda el código y RECARGA la hoja de cálculo (Cmd+R). */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ Caja Chica')
    .addItem('✅ PANEL DE PENDIENTES (autorizar aquí)', 'abrirPanelPendientes')
    .addSeparator()
    .addItem('🔌 Probar el webhook de AppSheet', 'menu_probarWebhook')
    .addItem('📋 Ver últimos envíos de AppSheet', 'menu_verLog')
    .addItem('🔎 Ver nombres válidos de sucursal', 'menu_nombresValidos')
    .addSeparator()
    .addItem('Anticipo Proveedor genérico (catálogo)', 'menu_catalogo')
    .addItem('Corregir anticipos ya generados', 'menu_yaGenerados')
    .addItem('Hacer las dos cosas', 'menu_todo')
    .addSeparator()
    .addItem('🧹 QUITAR "SEVERO" de todo el Concentrado', 'menu_severo')
    .addItem('Ver anticipos del catálogo (diagnóstico)', 'menu_revisar')
    .addSeparator()
    .addItem('🚨 Diagnóstico urgente de correos', 'menu_urgente')
    .addItem('🚨 Diagnóstico de Omar', 'menu_omar')
    .addItem('📧 ¿Por qué no llega el correo?', 'menu_correo')
    .addSeparator()
    .addItem('📨 Reenviar TODOS los pendientes de firma', 'menu_reenvTodos')
    .addItem('📨 Reenviar pendientes a Omar', 'menu_reenvOmar')
    .addItem('📧 Reenviar correo de UN folio', 'menu_reenviar')
    .addSeparator()
    .addItem('🚫 Cancelar folios de la lista (recomendado)', 'menu_cancelar')
    .addItem('🗑️ BORRAR filas de los folios (definitivo)', 'menu_borrar')
    .addSeparator()
    .addItem('Crear/actualizar pestaña Lideres', 'menu_lideres')
    .addToUi();
}

function menu_catalogo()   { mostrar_(genericoAnticipoProveedor()); }
function menu_yaGenerados(){ mostrar_(limpiarAnticiposYaGenerados()); }
function menu_todo()       { mostrar_(anticipoProveedorGenericoTodo()); }
function menu_severo()     { mostrar_(quitarSevero()); }
function menu_revisar()    { mostrar_(revisarAnticipos()); }
function menu_lideres()    { mostrar_(actualizarListaLideres()); }
function menu_correo()     { mostrar_(revisarCorreo()); }
function menu_urgente()    { mostrar_(diagnosticoUrgente()); }
function menu_omar()       { mostrar_(diagnosticoOmar()); }
function menu_reenvTodos() { mostrar_(reenviarTodosLosPendientes()); }
function menu_reenvOmar()  { mostrar_(reenviarPendientesOmar()); }
function menu_reenviar()   { mostrar_(reenviarCorreoDeFolio()); }
function menu_cancelar()   { mostrar_(cancelarFolios()); }
function menu_borrar()     { mostrar_(borrarFoliosDefinitivo()); }
function menu_probarWebhook()  { mostrar_(probarWebhookAppSheet()); }
function menu_verLog()         { mostrar_(verUltimosWebhooks()); }
function menu_nombresValidos() { mostrar_(verNombresValidosSucursal()); }

function mostrar_(texto) {
  var msg = String(texto || 'Listo.');
  try { SpreadsheetApp.getUi().alert(msg.substring(0, 1400)); } catch (e) { Logger.log(msg); }
}


/* ============================================================
 *  API para el formulario y para AppSheet
 * ============================================================ */

/** Lee el Catálogo y devuelve sucursales + tipos de gasto por sucursal.
 *  Ademas separa:
 *   - "cajasQuePagan": sucursales que SÍ pueden ser "Caja que paga" (se
 *     excluyen los familiares/pseudo-sucursales que rutean su pago a otra
 *     caja real, ej. CEDIS SAN PABLO).
 *   - "personales": sucursales que en realidad son un catálogo PERSONAL
 *     (el bloque de "TITULAR" con las cuentas 990-999, etc. de cada
 *     familiar) en vez de una caja/sucursal real (bloque de "SUCURSAL").
 *
 *  NUEVO 22-sept-2026: también devuelve "indice", que es el mismo
 *  contenido pero con la llave NORMALIZADA (sin acentos, en mayúsculas y
 *  sin espacios de más). Eso es lo que permite que AppSheet mande el
 *  nombre escrito de cualquier forma y aun así lo encuentre. */
function getCatalogoSolicitud() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cat = ss.getSheetByName('Catálogos') || ss.getSheetByName('Catalogos');
  if (!cat) throw new Error('No se encontró la hoja de Catálogos.');

  /* BLOQUES QUE NO PERTENECEN A NINGUNA SUCURSAL.
     Son grupos de cuentas que CUALQUIER caja puede pedir. Se escriben UNA
     sola vez en la pestaña de Catálogos y aquí se le reparten a TODAS las
     unidades. Cada bloque conserva su nombre contable real:

       MOVIMIENTOS DE EFECTIVO -> traspasos, depósitos a banco, préstamos
                                  a empleados. No son gasto: es dinero que
                                  sale de la caja.
       COSTO DE VENTAS         -> compra de mercancía nacional e importada,
                                  fletes, gastos aduanales, anticipos a
                                  proveedor. Es costo, no gasto.

     Para agregar otro bloque más adelante (por ejemplo GASTOS FINANCIEROS)
     basta con escribirlo en esta lista y usar ese MISMO texto en la
     columna B (SUCURSAL) de las filas de la pestaña Catálogos. */
  var BLOQUES_COMUNES = [
    'MOVIMIENTOS DE EFECTIVO',
    'COSTO DE VENTAS'
  ];

  var last = cat.getLastRow();
  if (last < 2) return { sucursales: [], entries: {}, indice: {}, cajasQuePagan: [], personales: [] };

  var datos = cat.getRange(2, 1, last - 1, 10).getDisplayValues();
  var entries = {};
  var personalesSet = {};   // nombres que vienen del bloque "TITULAR" (catálogo personal)
  var modoPersonal = false; // true = de aquí en adelante estamos en el bloque de TITULAR

  datos.forEach(function (f) {
    var cuenta   = String(f[0] || '').trim();
    var col2     = String(f[1] || '').trim();   // dice "SUCURSAL" o "TITULAR" según el bloque
    var concepto = String(f[2] || '').trim();

    // Encabezado de un bloque nuevo del catálogo (ej. "CUENTA | SUCURSAL | ..."
    // o "CUENTA | TITULAR | ..."): define si de aquí en adelante (hasta el
    // próximo encabezado) las filas son de un catálogo personal o no.
    if (cuenta.toUpperCase() === 'CUENTA') {
      modoPersonal = (col2.toUpperCase() === 'TITULAR');
      return;
    }

    var sucursal = col2 || String(f[6] || '').trim();
    // Las filas de título de sección no tienen sucursal ni concepto -> se saltan.
    if (!cuenta || !sucursal || !concepto) return;

    if (!entries[sucursal]) entries[sucursal] = [];
    entries[sucursal].push({
      idx:         0,
      concepto:    concepto,
      cuenta:      cuenta,
      subconcepto: String(f[3] || ''),
      tipo:        String(f[4] || ''),
      combinacion: String(f[5] || ''),
      autorizador: String(f[7] || ''),
      correo:      String(f[8] || ''),
      copias:      String(f[9] || '')
    });

    if (modoPersonal) personalesSet[sucursal] = true;
  });

  /* ---- Se sacan los bloques comunes y se reparten a todas las unidades ----
     Se comparan NORMALIZADOS (sin acentos, en mayúsculas), así da igual si en
     la pestaña quedó escrito "Costo de Ventas" o "COSTO DE VENTAS". */
  var comunes = [];
  var normComunes = BLOQUES_COMUNES.map(normalizarTexto);
  Object.keys(entries).forEach(function (suc) {
    if (normComunes.indexOf(normalizarTexto(suc)) === -1) return;
    comunes = comunes.concat(entries[suc]);
    delete entries[suc];          // no son sucursales: no deben salir en los menús
    delete personalesSet[suc];
  });
  if (comunes.length) {
    Object.keys(entries).forEach(function (suc) {
      entries[suc] = entries[suc].concat(comunes);
    });
  }

  // Quita opciones REPETIDAS dentro de una misma sucursal.
  // Se copia cada entrada porque las de los bloques comunes son el MISMO objeto
  // en todas las sucursales: si se les pusiera el idx encima, se pisarían entre sí.
  Object.keys(entries).forEach(function (suc) {
    var vistas = {}, limpias = [];
    entries[suc].forEach(function (e) {
      var clave = normalizarTexto(e.concepto) + '||' + normalizarTexto(e.subconcepto);
      if (vistas[clave]) return;
      vistas[clave] = true;
      limpias.push({
        idx:         limpias.length,
        concepto:    e.concepto,
        cuenta:      e.cuenta,
        subconcepto: e.subconcepto,
        tipo:        e.tipo,
        combinacion: e.combinacion,
        autorizador: e.autorizador,
        correo:      e.correo,
        copias:      e.copias
      });
    });
    entries[suc] = limpias;
  });

  var sucursales = Object.keys(entries); // orden del catálogo (familia queda al final)

  // Índice normalizado: NOMBRE NORMALIZADO -> { real: '<como está escrito>', lista: [...] }
  var indice = {};
  sucursales.forEach(function (s) {
    indice[normalizarTexto(s)] = { real: s, lista: entries[s] };
  });

  var EXCLUIR_DE_CAJA_QUE_PAGA = [
    'PUEBLO ALFREDO', 'PLATA 14', 'PLATA', 'CASTILLO',
    'ALFREDO VIZCARRA', 'ALFREDO',
    'EDITH HUERTA VARGAS', 'NATASHA VIZCARRA', 'ALFREDO JR. VIZCARRA',
    'SURI AILEEN VIZCARRA', 'FERNANDA VIZCARRA',
    'APOYOS A FAMILIA', 'CASA FAMILIAR'
  ].map(normalizarTexto);

  var cajasQuePagan = sucursales.filter(function (s) {
    return EXCLUIR_DE_CAJA_QUE_PAGA.indexOf(normalizarTexto(s)) === -1;
  });

  var personales = Object.keys(personalesSet);

  return { sucursales: sucursales, cajasQuePagan: cajasQuePagan, entries: entries,
           indice: indice, personales: personales };
}


/** Busca la sucursal en el catálogo SIN exigir que esté escrita idéntica.
 *  Devuelve { real, lista } o null.
 *  Prueba, en este orden:
 *    1) el nombre normalizado tal cual
 *    2) quitando/agregando la palabra "CAJA" al inicio
 *    3) traduciendo número por palabra (1 <-> UNO, 2 <-> DOS)
 *    4) por coincidencia parcial (uno contiene al otro) */
function solBuscarSucursal_(cat, nombre) {
  var n = normalizarTexto(nombre);
  if (!n) return null;

  var ind = cat.indice || {};
  if (ind[n]) return ind[n];

  // "CAJA CEDIS SAN PABLO" -> "CEDIS SAN PABLO"
  var sinCaja = n.replace(/^CAJA\s+/, '');
  if (ind[sinCaja]) return ind[sinCaja];

  // Números <-> palabras, en los dos sentidos
  var variantes = [
    n.replace(/\bUNO\b/g, '1').replace(/\bDOS\b/g, '2'),
    n.replace(/\b1\b/g, 'UNO').replace(/\b2\b/g, 'DOS'),
    sinCaja.replace(/\bUNO\b/g, '1').replace(/\bDOS\b/g, '2'),
    sinCaja.replace(/\b1\b/g, 'UNO').replace(/\b2\b/g, 'DOS'),
    n.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  ];
  for (var i = 0; i < variantes.length; i++) {
    if (variantes[i] && ind[variantes[i]]) return ind[variantes[i]];
  }

  // Coincidencia parcial: solo si hay UNA sola candidata (si hay varias,
  // mejor fallar y avisar que arriesgarse a cargarle el gasto a otra caja).
  var llaves = Object.keys(ind);
  var candidatas = llaves.filter(function (k) {
    return k.indexOf(n) >= 0 || n.indexOf(k) >= 0;
  });
  if (candidatas.length === 1) return ind[candidatas[0]];

  return null;
}


/** Encuentra la fila del catálogo que corresponde al tipo de gasto.
 *  Antes solo comparaba contra el concepto; ahora prueba varias formas
 *  porque AppSheet manda texto libre. Devuelve la entrada o null. */
function solBuscarTipoGasto_(lista, tipoGasto, tipoIndice) {
  if (!lista || !lista.length) return null;

  // 1) Por índice, que es lo que manda el formulario web (lo más exacto).
  var i = (tipoIndice === 0 || tipoIndice) ? Number(tipoIndice) : -1;
  if (i >= 0 && i < lista.length) return lista[i];

  var t = normalizarTexto(tipoGasto);
  if (!t) return null;

  var k;

  // 2) Concepto exacto.
  for (k = 0; k < lista.length; k++) {
    if (normalizarTexto(lista[k].concepto) === t) return lista[k];
  }

  // 3) "Concepto — Subconcepto" exacto (con guion largo, corto o sin guion).
  for (k = 0; k < lista.length; k++) {
    var c = normalizarTexto(lista[k].concepto);
    var s = normalizarTexto(lista[k].subconcepto);
    if (!s) continue;
    if (t === normalizarTexto(c + ' — ' + s)) return lista[k];
    if (t === normalizarTexto(c + ' - ' + s)) return lista[k];
    if (t === normalizarTexto(c + ' ' + s))   return lista[k];
  }

  // 4) Contra la columna de combinación y contra la cuenta.
  for (k = 0; k < lista.length; k++) {
    if (lista[k].combinacion && normalizarTexto(lista[k].combinacion) === t) return lista[k];
    if (normalizarTexto(lista[k].cuenta) === t) return lista[k];
  }

  // 5) Subconcepto exacto (por si AppSheet manda solo el detalle).
  for (k = 0; k < lista.length; k++) {
    if (lista[k].subconcepto && normalizarTexto(lista[k].subconcepto) === t) return lista[k];
  }

  // 6) Por coincidencia parcial, y SOLO si hay una única candidata.
  var candidatas = [];
  for (k = 0; k < lista.length; k++) {
    var full = normalizarTexto(lista[k].concepto + ' ' + lista[k].subconcepto + ' ' + lista[k].combinacion);
    if (full.indexOf(t) >= 0 || t.indexOf(normalizarTexto(lista[k].concepto)) === 0) candidatas.push(lista[k]);
  }
  if (candidatas.length === 1) return candidatas[0];

  return null;
}


/** Lee la pestaña "Lideres" (Área | Líder | Correo) para los desplegables. */
function getLideres() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Lideres') || ss.getSheetByName('Líderes');
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var datos = sh.getRange(2, 1, last - 1, 3).getDisplayValues();
  var out = [];
  datos.forEach(function (f) {
    var area   = String(f[0] || '').trim();
    var lider  = String(f[1] || '').trim();
    var correo = String(f[2] || '').trim();
    if (!area || !lider || !correo) return;
    out.push({ area: area, lider: lider, correo: correo });
  });
  return out;
}


var LIDERES_REALES = [
  ['Compras',            'Natasha Vizcarra',     'natasha.compras@grupovizcarra.mx'],
  ['Compras',            'Fernanda Gonzalez',    'fernanda.compras@grupovizcarra.mx'],
  ['Finanzas',           'Angel Gonzalez',       'angel@grupovizcarra.mx'],
  ['Recursos Humanos',   'Sandra García',        'sandra.talento@grupovizcarra.mx'],
  ['Diseño',             'Cynthia Rosillo',      'cynthia.marca@grupovizcarra.mx'],
  ['E-commerce',         'Luis Enrique Gomez',   'luis.ecommerce@grupovizcarra.net'],
  ['Almacén',            'Marco Antonio Medez',  'marco@grupovizcarra.mx'],
  ['Dirección',          'Ricardo Rodriguez',    'ricardo@grupovizcarra.mx'],
  ['Marketing',          'Alberto Morales',      'digital.media@grupovizcarra.net'],
  ['Desarrollo',         'Hugo Muñoz',           'hugo@grupovizcarra.mx'],
  ['Sistemas',           'Uriel Sanchez',        'uriel@grupovizcarra.mx'],
  ['Mantenimiento',      'Gonzalo Macin',        'gonzalo@grupovizcarra.mx'],
  ['Operaciones',        'Sergio Cordova',       'sergio.operaciones@grupovizcarra.net'],
  ['CEOS',               'Alfredo Vizcarra',     'eri.grupovizcarra@gmail.com'],
  ['CEOS',               'Edith Huerta Vargas',  'eri.grupovizcarra@gmail.com']
];

function crearHojaLideres() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Lideres');
  if (sh) return 'La pestaña "Lideres" ya existe. Usa actualizarListaLideres().';

  sh = ss.insertSheet('Lideres');
  sh.getRange(1, 1, 1, 3).setValues([['Área', 'Líder', 'Correo']]);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#0b3d66').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.getRange(2, 1, LIDERES_REALES.length, 3).setValues(LIDERES_REALES);
  sh.autoResizeColumns(1, 3);
  return 'Pestaña "Lideres" creada con ' + LIDERES_REALES.length + ' líderes reales.';
}

function actualizarListaLideres() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Lideres');
  if (!sh) return crearHojaLideres();
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  sh.getRange(2, 1, LIDERES_REALES.length, 3).setValues(LIDERES_REALES);
  sh.autoResizeColumns(1, 3);
  return 'Pestaña "Lideres" actualizada con ' + LIDERES_REALES.length + ' líderes reales.';
}


/** Registra una solicitud: folio + fila en Concentrado + adjuntos + correo.
 *  OPTIMIZADA PARA VELOCIDAD: una sola lectura del encabezado y un solo
 *  setValues; el candado solo cubre folio + escritura, no el correo ni Drive.
 *
 *  CAMBIO 22-sept-2026: la sucursal y el tipo de gasto ya no se buscan
 *  letra por letra (ver encabezado del archivo), y cuando algo no empata
 *  el mensaje de error DICE qué llegó y qué opciones había. */
function registrarSolicitud(datos) {
  try {
    if (!datos) throw new Error('No se recibieron datos.');
    if (!datos.correo)      throw new Error('Falta el correo del solicitante.');
    if (!datos.sucursal)    throw new Error('Selecciona la caja que paga.');
    if (!datos.tipoGasto)   throw new Error('Selecciona un tipo de gasto.');
    if (!datos.colaborador) throw new Error('Falta el nombre del colaborador.');
    var importe = Number(datos.importe);
    if (isNaN(importe) || importe <= 0) throw new Error('El importe solicitado no es válido.');

    /* MAYÚSCULAS 23-sept-2026 — colaborador, proveedor y descripción se
       guardan SIEMPRE en mayúsculas, sin importar cómo los hayan escrito
       en la solicitud o en AppSheet. Se conservan los acentos y la ñ
       (José -> JOSÉ, Muñoz -> MUÑOZ). Se hace aquí, antes de escribir,
       para que el Concentrado y el correo salgan igual. */
    datos.colaborador = solMayus_(datos.colaborador);
    datos.proveedor   = solMayus_(datos.proveedor);
    datos.descripcion = solMayus_(datos.descripcion);

    // ---- Catálogo (con caché de 2 min: se lee 1 vez y se reusa) ----
    var cat = getCatalogoSolicitudCache_();

    // Si el tipo de gasto elegido vino del catálogo PERSONAL de alguien
    // marcado en "aplica" (ej. un familiar) en vez del catálogo de la Caja
    // que paga, el cliente manda "catalogoSucursal" con ese nombre. Si no,
    // se usa el de siempre (la Caja que paga).
    var claveCatalogo = datos.catalogoSucursal || datos.sucursal;

    var hallada = solBuscarSucursal_(cat, claveCatalogo);
    if (!hallada) {
      throw new Error('La caja "' + claveCatalogo + '" no existe en la pestaña Catálogos. ' +
        'Nombres válidos: ' + (cat.sucursales || []).slice(0, 25).join(' · '));
    }

    /* LA CAJA QUE PAGA SE RESUELVE APARTE — 29-sept-2026.
       "hallada" es la SUCURSAL DEL GASTO: de ahí sale la cuenta contable.
       La columna "Sucursal" del Concentrado NO es esa: es la CAJA de donde
       sale el efectivo físico, y de ella cuelgan el folio y el archivo de
       flujo al que se sincroniza la fila. Antes se escribía hallada.real y
       por eso salía "SAN PABLO UNO" donde debía decir "CEDIS SAN PABLO". */
    var cajaHallada = solBuscarSucursal_(cat, datos.sucursal);
    var cajaReal = cajaHallada ? cajaHallada.real : String(datos.sucursal || '').trim();

    var lista = hallada.lista || [];

    var entry = solBuscarTipoGasto_(lista, datos.tipoGasto, datos.tipoIndice);
    if (!entry) {
      var opciones = lista.slice(0, 15).map(function (e) { return e.concepto; }).join(' · ');
      throw new Error('El tipo de gasto "' + datos.tipoGasto + '" no existe para ' + hallada.real +
        '. Opciones de esa caja: ' + opciones + (lista.length > 15 ? ' …' : ''));
    }
    if (!entry.correo) {
      throw new Error('La fila del Catálogo de ' + hallada.real + ' · ' + entry.concepto +
        ' no tiene correo de autorizador (columna I).');
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
    if (!sh) throw new Error('No se encontró la hoja "' + SOL.HOJA_CONCENTRADO + '".');

    var tz  = ss.getSpreadsheetTimeZone() || 'America/Mexico_City';
    var hoy = new Date();

    var tipoGastoTexto = entry.concepto + (entry.subconcepto ? ' — ' + entry.subconcepto : '');
    var aplica = (datos.sucursalesAplica || []);
    if (!aplica.length && datos.sucursal) aplica = [datos.sucursal];

    // ---- Ruteo de autorización (antes de escribir, para armar la fila completa) ----
    var val1 = primerAutorizador_(datos.area || '', importe);
    var correoDest, destinatario, nota, estatus, autorizo;
    if (val1) {
      correoDest   = val1.correo;
      destinatario = val1.nombre;
      estatus      = stPendiente1_(datos.area);
      autorizo     = val1.nombre + ' / ' + AUTORIZACION.FINAL_NOMBRE;
      nota = 'Autorización 1 de 2 · Validación interna de ' + datos.area +
             '. Al aprobar, pasa a Angel para la liberación final.';
    } else {
      correoDest   = entry.correo;
      destinatario = entry.autorizador;
      estatus      = SOL.ESTATUS_INICIAL;
      autorizo     = entry.autorizador;
      nota = '';
    }

    // ---- Encabezado: se lee UNA vez y se crean las columnas nuevas de un jalón ----
    var map = mapaConColumnas_(sh, [SOL.COL_SUC_APLICA, SOL.COL_ADJUNTOS]);

    // ---- Escritura de la fila: UN solo setValues ----
    var folio, row;
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      folio = generarFolioSolicitud_(Utilities.formatDate(hoy, tz, 'yyyy'), datos.sucursal);
      row = sh.getLastRow() + 1;

      var ancho = Math.max(sh.getLastColumn(), 1);
      // Se LEE la fila nueva antes de escribirla y solo se sobrescriben las
      // celdas que realmente llenamos. Así, si alguna columna trae fórmula
      // heredada o algo puesto por otra herramienta, no se borra.
      var celdas = sh.getRange(row, 1, 1, ancho).getValues()[0];
      var put = function (nombre, valor) { var i = map[nombre]; if (i != null && i < ancho) celdas[i] = valor; };

      put(SOL.COL_FOLIO,        folio);
      put(SOL.COL_FECHA_SOL,    hoy);
      put(SOL.COL_SUCURSAL,     cajaReal);       // la CAJA que paga, NO la sucursal del gasto
      put(SOL.COL_COLABORADOR,  datos.colaborador);
      put(SOL.COL_AREA,         datos.area || '');
      put(SOL.COL_TIPO_GASTO,   tipoGastoTexto);
      put(SOL.COL_CUENTA,       entry.cuenta);
      put(SOL.COL_SUBCONCEPTO,  datos.descripcion || '');
      put(SOL.COL_IMPORTE,      importe);
      put(SOL.COL_CORREO_SOL,   datos.correo);
      put(SOL.COL_OBSERV,       'Proveedor: ' + (datos.proveedor || 'No informado'));
      put(SOL.COL_SUC_APLICA,   aplica.join(', '));
      put(SOL.COL_ESTATUS_AUT,  estatus);
      put(SOL.COL_AUTORIZO,     autorizo);

      sh.getRange(row, 1, 1, ancho).setValues([celdas]);
    } finally {
      lock.releaseLock();   // el correo y Drive ya NO bloquean a los demás
    }

    // ---- Adjuntos: solo si de verdad hay archivos ----
    var urlAdjuntos = '';
    var hayArchivos = (datos.archivos || []).filter(function (a) { return a && a.b64; }).length > 0;
    if (hayArchivos) {
      try {
        urlAdjuntos = guardarAdjuntosSolicitud_(cajaReal, folio, datos.archivos, [correoDest]);
        if (urlAdjuntos && map[SOL.COL_ADJUNTOS] != null) {
          sh.getRange(row, map[SOL.COL_ADJUNTOS] + 1).setValue(urlAdjuntos);
        }
      } catch (e) { console.error('Adjuntos fallaron en ' + folio + ': ' + e.message); }
    }

    // ---- Correo de autorización ----
    try {
      enviarCorreoAutorizacion2_(correoDest, destinatario, folio,
        cajaReal, datos.area, datos.colaborador, tipoGastoTexto, datos.descripcion, importe,
        nota, entry.copias, urlAdjuntos, aplica.join(', '));
    } catch (e) {
      console.error('Correo de ' + folio + ' NO salió: ' + e.message);
      return { ok: true, folio: folio,
               mensaje: 'Solicitud registrada con folio ' + folio + ', PERO el correo de aviso NO pudo enviarse (' +
                        e.message + '). NO la vuelvas a enviar: ya quedó registrada. Avisa a Finanzas.' };
    }

    // ---- Después del correo: compartir con los demás (ya no retrasa a nadie) ----
    if (urlAdjuntos) {
      try {
        var carpeta = carpetaSolicitud_(cajaReal, folio);
        [datos.correo, AUTORIZACION.FINAL_CORREO].forEach(function (c) {
          if (c && c.indexOf('@') > 0 && c !== correoDest) {
            try { carpeta.addViewer(c); } catch (e) {}
          }
        });
      } catch (e) { console.error(e); }
    }

    return { ok: true, folio: folio,
             mensaje: 'Solicitud registrada con folio ' + folio + '. Se envió el correo de autorización a ' + destinatario + '.' };
  } catch (err) {
    return { ok: false, mensaje: err.message };
  }
}


/** Catálogo con caché de 2 minutos. Evita releer ~1000 filas en cada envío. */
function getCatalogoSolicitudCache_() {
  var cache = CacheService.getScriptCache();
  try {
    var txt = cache.get('CAT_SOL');
    if (txt) return JSON.parse(txt);
  } catch (e) { /* si el caché falla, se lee normal */ }

  var cat = getCatalogoSolicitud();
  try { cache.put('CAT_SOL', JSON.stringify(cat), 120); } catch (e) { /* muy grande: se ignora */ }
  return cat;
}

/** Borra el caché del catálogo para ver un cambio de inmediato. */
function limpiarCacheCatalogo_() {
  CacheService.getScriptCache().remove('CAT_SOL');
  return 'Caché del catálogo limpiado.';
}

/** Lee el encabezado UNA vez y, de paso, crea las columnas que falten. */
function mapaConColumnas_(sh, nombresRequeridos) {
  var map = mapaColumnas_(sh);
  var col = ultimaColumnaConEncabezado_(sh);
  var nuevas = [];
  (nombresRequeridos || []).forEach(function (n) {
    if (map[n] == null) { col++; nuevas.push({ nombre: n, col: col }); map[n] = col - 1; }
  });
  nuevas.forEach(function (x) { sh.getRange(1, x.col).setValue(x.nombre).setFontWeight('bold'); });
  return map;
}


/* ============================================================
 *  BITÁCORA DEL WEBHOOK  (pestaña LOG WEBHOOK)
 *  Cada POST que manda AppSheet se anota aquí, entre bien o mal.
 * ============================================================ */

/** Devuelve la pestaña de bitácora; la crea si no existe. */
function solHojaLog_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_LOG);
  if (sh) return sh;

  sh = ss.insertSheet(SOL.HOJA_LOG, ss.getNumSheets());
  sh.getRange(1, 1, 1, 6)
    .setValues([['FECHA', 'RESULTADO', 'FOLIO', 'MENSAJE', 'CAJA QUE PAGA', 'JSON RECIBIDO']])
    .setFontWeight('bold').setBackground('#0b3d66').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 150);
  sh.setColumnWidth(2, 90);
  sh.setColumnWidth(3, 170);
  sh.setColumnWidth(4, 420);
  sh.setColumnWidth(5, 160);
  sh.setColumnWidth(6, 560);
  return sh;
}

/** Anota un renglón en la bitácora. NUNCA truena: si la bitácora falla,
 *  no se puede llevar entre las patas una solicitud que sí se registró. */
function solLogWebhook_(resultado, folio, mensaje, caja, crudo) {
  try {
    var sh = solHojaLog_();
    var fila = sh.getLastRow() + 1;
    sh.getRange(fila, 1, 1, 6).setValues([[
      new Date(),
      String(resultado || ''),
      String(folio || ''),
      String(mensaje || '').substring(0, 900),
      String(caja || ''),
      String(crudo || '').substring(0, 3000)
    ]]);
    sh.getRange(fila, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
    if (String(resultado).toUpperCase().indexOf('ERROR') === 0) {
      sh.getRange(fila, 1, 1, 6).setBackground('#fce8e6');
    }
    // No dejar crecer la bitácora para siempre: se conservan 500 renglones.
    var sobran = sh.getLastRow() - 501;
    if (sobran > 0) sh.deleteRows(2, sobran);
  } catch (e) {
    console.error('No se pudo escribir la bitácora: ' + e.message);
  }
}

/** Muestra los últimos envíos de AppSheet, para revisar sin salir de la hoja. */
function verUltimosWebhooks() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_LOG);
  if (!sh || sh.getLastRow() < 2) {
    return 'Todavía no ha llegado ningún envío de AppSheet.\n\n' +
           'Si AppSheet ya mandó algo y aquí no aparece nada, entonces ni siquiera está llegando ' +
           'al script: revisa que la implementación sea la versión NUEVA y que la URL del webhook ' +
           'sea la misma que aparece en Implementar → Administrar implementaciones.';
  }
  var desde = Math.max(2, sh.getLastRow() - 14);
  var n = sh.getLastRow() - desde + 1;
  var datos = sh.getRange(desde, 1, n, 5).getDisplayValues();
  var out = ['ÚLTIMOS ' + n + ' ENVÍOS DE APPSHEET', '============================================'];
  datos.reverse().forEach(function (f) {
    out.push(f[0] + '  [' + f[1] + ']  ' + (f[2] || '') + (f[4] ? '  · ' + f[4] : ''));
    if (f[3]) out.push('      ' + f[3]);
  });
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

/** Lista los nombres de caja que el sistema reconoce, para copiarlos tal
 *  cual a AppSheet. */
function verNombresValidosSucursal() {
  var cat = getCatalogoSolicitud();
  var out = ['NOMBRES DE CAJA VÁLIDOS (como están en la pestaña Catálogos)',
             '============================================================'];
  (cat.cajasQuePagan || []).forEach(function (s) {
    var cod = '';
    try { cod = obtenerCodigoSucursalSolicitud_(s); } catch (e) { cod = '*** SIN CÓDIGO DE FOLIO ***'; }
    out.push('  ' + s + '   ->   folio CC-' + cod);
  });
  out.push('');
  out.push('En AppSheet, el campo CAJA QUE PAGA debe mandar uno de estos textos.');
  out.push('No importan acentos ni mayúsculas, pero sí que sea la misma caja.');
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

/** PRUEBA: simula un envío de AppSheet sin tener que capturar en AppSheet.
 *  Cambia los datos de abajo y córrela desde el menú. NO manda correo real
 *  si la caja o el tipo de gasto no empatan: primero avisa qué está mal. */
function probarWebhookAppSheet() {
  var prueba = {
    correo:           'angel@grupovizcarra.mx',
    sucursal:         'CEDIS SAN PABLO',
    area:             'Finanzas',
    colaborador:      'PRUEBA WEBHOOK',
    tipoGasto:        'Gastos Operativos y Consumibles',
    descripcion:      'PRUEBA — no es una solicitud real',
    proveedor:        'PRUEBA',
    importe:          '1',
    sucursalesAplica: 'CEDIS SAN PABLO',
    archivoPdf:       ''
  };

  var cat = getCatalogoSolicitud();
  var hallada = solBuscarSucursal_(cat, prueba.sucursal);
  var out = ['PRUEBA DEL WEBHOOK (no se registró nada todavía)',
             '============================================'];
  out.push('Caja que se probó: "' + prueba.sucursal + '"');
  if (!hallada) {
    out.push('   >>> NO SE ENCONTRÓ en Catálogos.');
    out.push('   Nombres válidos: ' + (cat.cajasQuePagan || []).join(' · '));
    var m0 = out.join('\n'); Logger.log(m0); return m0;
  }
  out.push('   Encontrada como: "' + hallada.real + '"  (' + hallada.lista.length + ' tipos de gasto)');

  var entry = solBuscarTipoGasto_(hallada.lista, prueba.tipoGasto, null);
  out.push('Tipo de gasto probado: "' + prueba.tipoGasto + '"');
  if (!entry) {
    out.push('   >>> NO EMPATA con ninguna fila de esa caja.');
    out.push('   Opciones: ' + hallada.lista.map(function (e) { return e.concepto; }).join(' · '));
    var m1 = out.join('\n'); Logger.log(m1); return m1;
  }
  out.push('   Empató con: ' + entry.concepto + (entry.subconcepto ? ' — ' + entry.subconcepto : ''));
  out.push('   Cuenta contable: ' + entry.cuenta);
  out.push('   Autoriza: ' + entry.autorizador + ' (' + entry.correo + ')');
  out.push('');

  var cod = '';
  try { cod = obtenerCodigoSucursalSolicitud_(prueba.sucursal); out.push('Código de folio: ' + cod); }
  catch (e) { out.push('*** ' + e.message + ' ***'); }

  out.push('');
  out.push('TODO EMPATA. Si AppSheet manda exactamente estos textos, la solicitud entra.');
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}


/* ============================================================
 *  MANTENIMIENTO DEL CATÁLOGO — ANTICIPO PROVEEDOR
 * ============================================================ */

/** Deja "Anticipo Proveedor" GENÉRICO en todas las sucursales MENOS
 *  Guadalajara (que conserva RETPUNK 100-1 y TINLOM 100-2), y retira los
 *  duplicados que queden idénticos. Segura de repetir. */
function genericoAnticipoProveedor() {
  var cat = hojaCatalogo_();
  var last = cat.getLastRow();
  var datos = cat.getRange(2, 1, last - 1, 10).getDisplayValues();
  var cambios = [], duplicados = [], vistas = {}, revisadas = 0;

  for (var i = 0; i < datos.length; i++) {
    var fila     = i + 2;
    var cuenta   = String(datos[i][0] || '').trim();       // col A
    var concepto = String(datos[i][2] || '').trim();       // col C
    var sub      = String(datos[i][3] || '').trim();       // col D
    var combi    = String(datos[i][5] || '').trim();       // col F
    var sucursal = String(datos[i][1] || datos[i][6] || '').trim(); // col B (o G)
    if (!cuenta || !concepto || !sucursal) continue;

    if (normalizarTexto(concepto + ' ' + combi).indexOf('ANTICIPO') < 0) continue;
    revisadas++;
    if (normalizarTexto(sucursal) === 'GUADALAJARA') continue;

    if (sub) {
      cat.getRange(fila, 4).setValue('');
      if (combi) cat.getRange(fila, 6).setValue(sucursal + ' ' + concepto);
      cambios.push('Fila ' + fila + ' (cuenta ' + cuenta + ') · ' + sucursal + ' · se quitó: ' + sub);
    }

    // Deja UNA sola fila por sucursal: las repetidas se VACÍAN (no se
    // eliminan), así se recuperan con Ctrl+Z o el historial de versiones.
    var clave = normalizarTexto(sucursal) + '||' + normalizarTexto(concepto);
    if (vistas[clave]) {
      cat.getRange(fila, 1, 1, 10).clearContent();
      duplicados.push('Fila ' + fila + ' retirada (cuenta ' + cuenta + ') · se conserva la fila ' +
                      vistas[clave].fila + ' (cuenta ' + vistas[clave].cuenta + ') · ' + sucursal);
    } else {
      vistas[clave] = { fila: fila, cuenta: cuenta };
    }
  }

  SpreadsheetApp.flush();
  var msg = cambios.length
    ? 'NOMBRES QUITADOS (' + cambios.length + '):\n' + cambios.join('\n')
    : 'Sin nombres de proveedor por quitar (ya estaban genéricos).';
  msg += '\n\nFilas con "anticipo" revisadas: ' + revisadas;
  if (duplicados.length) {
    msg += '\n\nDUPLICADOS RETIRADOS (' + duplicados.length + '):\n' + duplicados.join('\n') +
           '\n\nSe vaciaron, NO se eliminaron: se puede deshacer con Ctrl+Z.';
  }
  Logger.log(msg);
  return msg;
}


/** Corrige las solicitudes YA GENERADAS en el Concentrado. */
function limpiarAnticiposYaGenerados() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  if (!sh) throw new Error('No se encontró la hoja "' + SOL.HOJA_CONCENTRADO + '".');

  var last = sh.getLastRow();
  if (last < 2) return 'El Concentrado no tiene solicitudes todavía.';

  var map = mapaColumnas_(sh);
  var cTipo = map[SOL.COL_TIPO_GASTO];
  var cSuc  = map[SOL.COL_SUCURSAL];
  var cFol  = map[SOL.COL_FOLIO];
  if (!cTipo) throw new Error('No se encontró la columna "' + SOL.COL_TIPO_GASTO + '".');

  var tipos = sh.getRange(2, cTipo, last - 1, 1).getValues();
  var sucs  = cSuc ? sh.getRange(2, cSuc, last - 1, 1).getDisplayValues() : null;
  var fols  = cFol ? sh.getRange(2, cFol, last - 1, 1).getDisplayValues() : null;
  var cambios = [];

  for (var i = 0; i < tipos.length; i++) {
    var fila     = i + 2;
    var texto    = String(tipos[i][0] || '').trim();
    var sucursal = sucs ? String(sucs[i][0] || '').trim() : '';
    if (!texto) continue;
    if (normalizarTexto(texto).indexOf('ANTICIPO') < 0) continue;
    if (normalizarTexto(sucursal) === 'GUADALAJARA') continue;

    // Texto EXACTO, sin depender de guiones ni comillas.
    var limpio = 'Anticipo Proveedor';
    if (texto === limpio) continue;

    sh.getRange(fila, cTipo).setValue(limpio);
    cambios.push('Fila ' + fila + (fols ? ' · ' + fols[i][0] : '') +
                 ' · ' + (sucursal || '?') + '\n      antes: ' + texto + '\n      ahora: ' + limpio);
  }

  SpreadsheetApp.flush();
  var msg = cambios.length
    ? 'SOLICITUDES YA GENERADAS CORREGIDAS (' + cambios.length + '):\n\n' + cambios.join('\n')
    : 'No hubo nada por corregir.';
  Logger.log(msg);
  return msg;
}


/** OPCIÓN BRUTA: barre TODO el Concentrado y donde diga "SEVERO" deja
 *  'Anticipo Proveedor'. Escribe CELDA POR CELDA (no en bloque) porque la
 *  hoja tiene imágenes en celda y setValues() sobre todo el rango truena
 *  con "Service error: Spreadsheets". */
function quitarSevero() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  if (!sh) throw new Error('No se encontró la hoja "' + SOL.HOJA_CONCENTRADO + '".');

  var textos  = sh.getDataRange().getDisplayValues();
  var tocadas = [];

  for (var r = 0; r < textos.length; r++) {
    for (var c = 0; c < textos[r].length; c++) {
      var v = String(textos[r][c] || '');
      if (v.toUpperCase().indexOf('SEVERO') < 0) continue;
      sh.getRange(r + 1, c + 1).setValue('Anticipo Proveedor');
      tocadas.push(sh.getRange(r + 1, c + 1).getA1Notation() + '  ←  ' + v);
    }
  }

  if (tocadas.length) SpreadsheetApp.flush();
  var msg = tocadas.length
    ? 'CELDAS CORREGIDAS (' + tocadas.length + '):\n\n' + tocadas.join('\n')
    : 'No se encontró la palabra "SEVERO" en ninguna celda de "' + SOL.HOJA_CONCENTRADO + '".';
  Logger.log(msg);
  return msg;
}


function anticipoProveedorGenericoTodo() {
  var a = genericoAnticipoProveedor();
  var b = limpiarAnticiposYaGenerados();
  var msg = '=== CATÁLOGO ===\n' + a + '\n\n=== SOLICITUDES YA GENERADAS ===\n' + b;
  Logger.log(msg);
  return msg;
}


/** DIAGNÓSTICO: muestra toda fila del Catálogo que mencione "anticipo". */
function revisarAnticipos() {
  var cat = hojaCatalogo_();
  var last = cat.getLastRow();
  var datos = cat.getRange(2, 1, last - 1, 10).getDisplayValues();
  var out = ['Hoja usada: "' + cat.getName() + '" · última fila: ' + last, ''];

  for (var i = 0; i < datos.length; i++) {
    var txt = normalizarTexto(String(datos[i][2] || '') + ' ' + String(datos[i][5] || ''));
    if (txt.indexOf('ANTICIPO') < 0) continue;
    out.push('FILA ' + (i + 2) +
             '\n   A cuenta      = ' + datos[i][0] +
             '\n   B sucursal    = ' + datos[i][1] +
             '\n   C concepto    = ' + datos[i][2] +
             '\n   D subconcepto = ' + datos[i][3] +
             '\n   F combinacion = ' + datos[i][5] +
             '\n   G sucursal    = ' + datos[i][6]);
  }
  if (out.length === 2) out.push('NO se encontró ninguna fila con la palabra "anticipo".');

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}


/** Devuelve la hoja de catálogo sin importar cómo esté escrito el nombre. */
function hojaCatalogo_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Catálogos') || ss.getSheetByName('Catalogos') ||
           ss.getSheetByName('Catálogo')  || ss.getSheetByName('Catalogo');
  if (sh) return sh;
  var hojas = ss.getSheets();
  for (var i = 0; i < hojas.length; i++) {
    if (normalizarTexto(hojas[i].getName()).indexOf('CATALOG') === 0) return hojas[i];
  }
  throw new Error('No se encontró la hoja de Catálogos. Pestañas disponibles: ' +
    hojas.map(function (h) { return h.getName(); }).join(', '));
}


/** Resultado SOLO al registro de ejecución.
 *  NO se usa SpreadsheetApp.getUi().alert() aquí: desde el editor ese alert
 *  intenta abrirse en la pestaña de la hoja y, si no está abierta, la
 *  ejecución se queda colgada esperando que alguien lo cierre. */
function avisar_(msg) {
  Logger.log(msg);
}


/* ============================================================
 *  ADJUNTOS EN DRIVE
 * ============================================================ */

/** Guarda los adjuntos y comparte la carpeta con los correos indicados.
 *  Estructura:  <raíz>/SOLICITUDES/<caja>/<folio>/ */
function guardarAdjuntosSolicitud_(sucursal, folio, archivos, correosLectores) {
  var lista = (archivos || []).filter(function (a) { return a && a.b64; });
  if (!lista.length) return '';

  var carpeta = carpetaSolicitud_(sucursal, folio);

  lista.forEach(function (a, idx) {
    var ext = extensionDe_(a.nombre);
    var nombre = limpiaNombre_(folio) + ' - ' + limpiaNombre_(sucursal) +
                 (lista.length > 1 ? ' - ' + (idx + 1) : '') + (ext ? '.' + ext : '');
    var blob = Utilities.newBlob(Utilities.base64Decode(a.b64), a.mime || 'application/octet-stream', nombre);
    carpeta.createFile(blob);
  });

  // Uno por uno y con try/catch: si un correo está mal escrito, no se cae
  // toda la solicitud.
  var vistos = {};
  (correosLectores || []).forEach(function (correo) {
    var c = String(correo || '').trim();
    if (!c || c.indexOf('@') < 0 || vistos[c.toLowerCase()]) return;
    vistos[c.toLowerCase()] = true;
    try { carpeta.addViewer(c); } catch (e) { console.error('No se pudo compartir con ' + c + ': ' + e.message); }
  });

  return carpeta.getUrl();
}

function carpetaSolicitud_(sucursal, folio) {
  var raiz = CFG.CARPETA_RAIZ_ID
    ? DriveApp.getFolderById(CFG.CARPETA_RAIZ_ID)
    : DriveApp.getRootFolder();
  var base = obtenerOCrearSubcarpeta_(raiz, 'SOLICITUDES');
  var suc  = obtenerOCrearSubcarpeta_(base, limpiaNombre_(sucursal || 'SIN SUCURSAL'));
  return obtenerOCrearSubcarpeta_(suc, limpiaNombre_(folio));
}


/* ============================================================
 *  CANCELAR / BORRAR FOLIOS MAL CAPTURADOS
 * ============================================================ */

/** Folios a dar de baja. Edita esta lista y vuelve a correr la función. */
var FOLIOS_A_CANCELAR = [
  'CC-CDS-2026-000017',
  'CC-CDS-2026-000018',
  'CC-CDS-2026-000019',
  'CC-CDS-2026-000004',
  'CC-CDS-2026-000002',
  'CC-GDL-2026-000001',
  'CC-SP1-2026-000001',
  'CC-SP2-2026-000001',
  'CC-SOT-2026-000001',
  'CC-CR1-2026-000001',
  'CC-CR2-2026-000001',
  'CC-RC1-2026-000001',
  'CC-RC2-2026-000001',
  'CC-BOL-2026-000001',
  'CC-BR1-2026-000001',
  'CC-CRG-2026-000001',
  'CC-AP1-2026-000001',
  'CC-AP2-2026-000001',
  'CC-PUE-2026-000001',
  'CC-GDL-2026-000002',
  'CC-SP1-2026-000002',
  'CC-CDS-2026-000021',
  'CC-CDS-2026-000026',
  'CC-BR1-2026-000002',
  'CC-SP1-2026-000003'
];

/** RECOMENDADA. Marca los folios como "Cancelado" y pone el importe en 0,
 *  así dejan de sumar en el Dashboard pero queda el rastro de auditoría. */
function cancelarFolios() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  if (!sh) throw new Error('No se encontró la hoja "' + SOL.HOJA_CONCENTRADO + '".');

  var map = mapaColumnas_(sh);
  var last = sh.getLastRow();
  var folios = sh.getRange(2, map[SOL.COL_FOLIO] + 1, last - 1, 1).getDisplayValues();
  var buscar = FOLIOS_A_CANCELAR.map(function (f) { return normalizarTexto(f); });

  // Columnas de comprobación a limpiar por completo (si existen en la hoja).
  var COLS_COMPROB_A_LIMPIAR = [
    'Importe Comprobado', 'Fecha de Comprobacion', 'Estatus Comprobación',
    'Ruta Evidencia', 'Diferencia', 'Miniatura', 'Tipo de comprobante', 'Factura No. '
  ];

  var hechos = [], noEncontrados = buscar.slice();

  for (var i = 0; i < folios.length; i++) {
    var f = normalizarTexto(folios[i][0]);
    if (!f) continue;
    var pos = buscar.indexOf(f);
    if (pos < 0) continue;

    var fila = i + 2;
    var idx = noEncontrados.indexOf(f);
    if (idx >= 0) noEncontrados.splice(idx, 1);

    var importePrev = (map[SOL.COL_IMPORTE] != null)
      ? Number(sh.getRange(fila, map[SOL.COL_IMPORTE] + 1).getValue()) || 0 : 0;

    setCelda_(sh, fila, map[SOL.COL_ESTATUS_AUT], 'Cancelado');
    if (map[SOL.COL_IMPORTE] != null) setCelda_(sh, fila, map[SOL.COL_IMPORTE], 0);

    COLS_COMPROB_A_LIMPIAR.forEach(function (nombreCol) {
      var c = map[nombreCol];
      if (c != null) sh.getRange(fila, c + 1).setValue('');
    });

    if (map[SOL.COL_OBSERV] != null) {
      var prev = String(sh.getRange(fila, map[SOL.COL_OBSERV] + 1).getDisplayValue() || '').trim();
      var nota = 'CANCELADO (captura incorrecta). Importe original: $' + importePrev.toFixed(2);
      setCelda_(sh, fila, map[SOL.COL_OBSERV], prev ? (prev + ' | ' + nota) : nota);
    }

    hechos.push('Fila ' + fila + ' · ' + folios[i][0] + ' · cancelado y limpiado (importe $' +
                importePrev.toFixed(2) + ' → 0)');
  }

  var msg = hechos.length
    ? 'FOLIOS CANCELADOS (' + hechos.length + '):\n' + hechos.join('\n')
    : 'No se encontró ninguno de los folios de la lista.';
  if (noEncontrados.length) msg += '\n\nNO SE ENCONTRARON: ' + noEncontrados.join(', ');
  Logger.log(msg);
  return msg;
}


/** DEFINITIVA: BORRA las filas. Se borra de ABAJO HACIA ARRIBA para que no
 *  se recorran los números de fila al ir eliminando. */
function borrarFoliosDefinitivo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  if (!sh) throw new Error('No se encontró la hoja "' + SOL.HOJA_CONCENTRADO + '".');

  var map = mapaColumnas_(sh);
  var last = sh.getLastRow();
  var folios = sh.getRange(2, map[SOL.COL_FOLIO] + 1, last - 1, 1).getDisplayValues();
  var buscar = FOLIOS_A_CANCELAR.map(function (f) { return normalizarTexto(f); });

  var aBorrar = [];
  for (var i = 0; i < folios.length; i++) {
    var f = normalizarTexto(folios[i][0]);
    if (f && buscar.indexOf(f) >= 0) aBorrar.push({ fila: i + 2, folio: folios[i][0] });
  }
  if (!aBorrar.length) return 'No se encontró ninguno de los folios de la lista.';

  aBorrar.sort(function (a, b) { return b.fila - a.fila; });
  var hechos = [];
  aBorrar.forEach(function (r) {
    sh.deleteRow(r.fila);
    hechos.push('Fila ' + r.fila + ' · ' + r.folio + ' · BORRADA');
  });

  SpreadsheetApp.flush();
  var msg = 'FILAS BORRADAS (' + hechos.length + '):\n' + hechos.join('\n') +
            '\n\nSi te equivocaste: Archivo → Historial de versiones → Ver historial.';
  Logger.log(msg);
  return msg;
}


/* ============================================================
 *  DIAGNÓSTICO Y RESCATE DE CORREOS
 * ============================================================ */

function revisarCorreo() {
  var out = [];
  var quota = MailApp.getRemainingDailyQuota();
  out.push('CUOTA DE CORREOS RESTANTE HOY: ' + quota);
  if (quota <= 0) {
    out.push('   >>> ESTA ES LA CAUSA. Se agotó el límite diario de envíos.');
    out.push('   >>> La solicitud SÍ se registra, pero el aviso no sale hasta mañana.');
  }
  out.push('');

  var cat = getCatalogoSolicitud();
  out.push('CATÁLOGO — filas de "Transporte y Logística":');
  Object.keys(cat.entries).forEach(function (suc) {
    cat.entries[suc].forEach(function (e) {
      if (normalizarTexto(e.concepto).indexOf('TRANSPORTE') < 0) return;
      out.push('   ' + suc + ' · cuenta ' + e.cuenta +
               '\n      autoriza: ' + (e.autorizador || '(VACÍO)') +
               '\n      correo:   ' + (e.correo || '(VACÍO ← el correo no puede salir)'));
    });
  });
  out.push('');

  out.push('RUTEO POR ÁREA (doble firma):');
  ['Almacén', 'Compras', 'Diseño', 'Operaciones', 'Finanzas'].forEach(function (a) {
    var v = primerAutorizador_(a, 999999);
    out.push('   ' + a + ' -> ' + (v ? ('1ª ' + v.nombre + ' (' + v.correo + ') luego Angel')
                                     : 'firma única, usa el correo del Catálogo'));
  });

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}


/** Reenvía el correo de UN folio. Cambia el folio de abajo y ejecuta. */
var FOLIO_A_REENVIAR = 'CC-CDS-2026-000023';

function reenviarCorreoDeFolio() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  var map = mapaColumnas_(sh);
  var last = sh.getLastRow();
  var folios = sh.getRange(2, map[SOL.COL_FOLIO] + 1, last - 1, 1).getDisplayValues();

  var fila = -1;
  for (var i = 0; i < folios.length; i++) {
    if (normalizarTexto(folios[i][0]) === normalizarTexto(FOLIO_A_REENVIAR)) { fila = i + 2; break; }
  }
  if (fila < 0) return 'No se encontró el folio ' + FOLIO_A_REENVIAR + ' en el Concentrado.';

  var val = function (n) { var c = map[n]; return (c == null) ? '' : String(sh.getRange(fila, c + 1).getDisplayValue() || '').trim(); };
  var area     = val(SOL.COL_AREA);
  var sucursal = val(SOL.COL_SUCURSAL);
  var importe  = (map[SOL.COL_IMPORTE] != null) ? Number(sh.getRange(fila, map[SOL.COL_IMPORTE] + 1).getValue()) || 0 : 0;
  var adj      = val(SOL.COL_ADJUNTOS);
  var aplica   = val(SOL.COL_SUC_APLICA);

  var val1 = primerAutorizador_(area, importe);
  var correo, nombre, nota = '';
  if (val1) {
    correo = val1.correo; nombre = val1.nombre;
    nota = 'Autorización 1 de 2 · Validación interna de ' + area + '.';
  } else {
    var cat = getCatalogoSolicitud();
    var hallada = solBuscarSucursal_(cat, sucursal);
    var lista = hallada ? hallada.lista : [];
    var tipo = val(SOL.COL_TIPO_GASTO);
    var e = solBuscarTipoGasto_(lista, tipo, null);
    if (!e || !e.correo) return 'El Catálogo no tiene correo de autorizador para ' + sucursal + ' · ' + tipo + '.';
    correo = e.correo; nombre = e.autorizador;
  }

  enviarCorreoAutorizacion2_(correo, nombre, FOLIO_A_REENVIAR, sucursal, area,
    val(SOL.COL_COLABORADOR), val(SOL.COL_TIPO_GASTO), val(SOL.COL_SUBCONCEPTO),
    importe, nota, '', adj, aplica);

  var msg = 'Correo de ' + FOLIO_A_REENVIAR + ' reenviado a ' + nombre + ' (' + correo + ').' +
            '\nCuota de correos restante: ' + MailApp.getRemainingDailyQuota();
  Logger.log(msg);
  return msg;
}


/** Dice EXACTAMENTE por qué no salen los correos. */
function diagnosticoUrgente() {
  var out = [];

  var q = -1;
  try { q = MailApp.getRemainingDailyQuota(); } catch (e) { out.push('No se pudo leer la cuota: ' + e.message); }
  out.push('1) CUOTA DE CORREOS RESTANTE: ' + q);
  if (q === 0) out.push('   >>> CAUSA ENCONTRADA: se agotó el límite diario.');
  out.push('');

  // Si falta Comprobacion.gs, la solicitud se ESCRIBE en la hoja pero truena
  // antes de mandar el correo. Este bloque lo detecta.
  out.push('2) FUNCIONES ENTRE ARCHIVOS:');
  [['primerAutorizador_', typeof primerAutorizador_],
   ['stPendiente1_',      typeof stPendiente1_],
   ['tieneFirma1_',       typeof tieneFirma1_],
   ['ensureCol_',         typeof ensureCol_],
   ['enviarCorreoAutorizacion2_', typeof enviarCorreoAutorizacion2_],
   ['mapaColumnas_',      typeof mapaColumnas_],
   ['setCelda_',          typeof setCelda_]
  ].forEach(function (p) {
    out.push('   ' + p[0] + ': ' + (p[1] === 'function' ? 'OK' : '*** FALTA *** (' + p[1] + ')'));
  });
  try {
    out.push('   AUTORIZACION.FINAL_CORREO: ' + (AUTORIZACION.FINAL_CORREO || '(vacío)'));
    out.push('   AUTORIZACION.OMAR_CORREO:  ' + (AUTORIZACION.OMAR_CORREO || '(vacío)'));
    out.push('   AUTORIZACION.DOBLE existe: ' + (AUTORIZACION.DOBLE ? 'SÍ' : '*** NO — Comprobacion.gs está viejo ***'));
  } catch (e) {
    out.push('   *** AUTORIZACION NO EXISTE: Comprobacion.gs no está pegado/guardado ***');
  }
  out.push('');

  out.push('3) PRUEBA DE ENVÍO a angel@grupovizcarra.mx:');
  try {
    MailApp.sendEmail({
      to: 'angel@grupovizcarra.mx',
      subject: 'PRUEBA Caja Chica — ' + new Date().toLocaleString('es-MX'),
      body: 'Si recibes esto, el envío de correos SÍ funciona.',
      name: 'Sistema de Caja Chica Vizcarra'
    });
    out.push('   ENVIADO sin error. Revisa bandeja y SPAM.');
  } catch (e) {
    out.push('   *** FALLÓ: ' + e.message + ' ***');
  }
  out.push('');

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SOL.HOJA_CONCENTRADO);
  var map = mapaColumnas_(sh);
  var last = sh.getLastRow();
  out.push('4) ÚLTIMAS 8 SOLICITUDES:');
  for (var r = Math.max(2, last - 7); r <= last; r++) {
    var g = function (n) { var c = map[n]; return (c == null) ? '' : String(sh.getRange(r, c + 1).getDisplayValue() || ''); };
    out.push('   fila ' + r + ' · ' + g(SOL.COL_FOLIO) + ' · ' + g(SOL.COL_AREA) +
             ' · ' + g(SOL.COL_ESTATUS_AUT) + ' · autoriza: ' + g(SOL.COL_AUTORIZO));
  }

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}


/** RESCATE. Reenvía el correo de TODAS las solicitudes pendientes de firma.
 *  Segura de repetir: no cambia estatus. */
function reenviarTodosLosPendientes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  var map = mapaColumnas_(sh);
  var last = sh.getLastRow();
  if (last < 2) return 'No hay solicitudes.';

  var cat = getCatalogoSolicitud();
  var enviados = [], saltados = [], errores = [];

  for (var r = 2; r <= last; r++) {
    var g = function (n) { var c = map[n]; return (c == null) ? '' : String(sh.getRange(r, c + 1).getDisplayValue() || '').trim(); };
    var folio = g(SOL.COL_FOLIO);
    if (!folio) continue;

    var e0 = normalizarTexto(g(SOL.COL_ESTATUS_AUT));
    if (e0.indexOf('PENDIENTE') !== 0 && e0.indexOf('AUTORIZADO POR') !== 0) continue;

    var area     = g(SOL.COL_AREA);
    var sucursal = g(SOL.COL_SUCURSAL);
    var tipo     = g(SOL.COL_TIPO_GASTO);
    var importe  = (map[SOL.COL_IMPORTE] != null) ? Number(sh.getRange(r, map[SOL.COL_IMPORTE] + 1).getValue()) || 0 : 0;
    var adj      = g(SOL.COL_ADJUNTOS);
    var aplica   = g(SOL.COL_SUC_APLICA);

    var val1 = primerAutorizador_(area, importe);
    var correo, nombre, nota = '';

    if (val1 && e0.indexOf('AUTORIZADO POR') === 0) {
      correo = AUTORIZACION.FINAL_CORREO; nombre = AUTORIZACION.FINAL_NOMBRE;
      nota = 'Autorización 2 de 2 · Ya la validó ' + val1.nombre + ' (' + area + ').';
    } else if (val1) {
      correo = val1.correo; nombre = val1.nombre;
      nota = 'Autorización 1 de 2 · Validación interna de ' + area + '.';
    } else {
      var hallada = solBuscarSucursal_(cat, sucursal);
      var ent = hallada ? solBuscarTipoGasto_(hallada.lista, tipo, null) : null;
      if (!ent || !ent.correo) { saltados.push(folio + ' (sin correo en Catálogo: ' + sucursal + ' · ' + tipo + ')'); continue; }
      correo = ent.correo; nombre = ent.autorizador;
    }

    try {
      enviarCorreoAutorizacion2_(correo, nombre, folio, sucursal, area,
        g(SOL.COL_COLABORADOR), tipo, g(SOL.COL_SUBCONCEPTO), importe, nota, '', adj, aplica);
      enviados.push(folio + ' -> ' + nombre + ' (' + correo + ')');
    } catch (err) {
      errores.push(folio + ' -> ' + err.message);
    }
  }

  var msg = 'REENVIADOS (' + enviados.length + '):\n' + (enviados.join('\n') || '   ninguno');
  if (saltados.length) msg += '\n\nSALTADOS (' + saltados.length + '):\n' + saltados.join('\n');
  if (errores.length)  msg += '\n\nERRORES (' + errores.length + '):\n' + errores.join('\n');
  msg += '\n\nCuota de correos restante: ' + MailApp.getRemainingDailyQuota();
  Logger.log(msg);
  return msg;
}


/** RESCATE TESORERÍA. Avisa a Omar (Eri en copia) de todo lo "Autorizado"
 *  que aún no tiene registro de entrega. Segura de repetir. */
function reenviarPendientesOmar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  var map = mapaColumnas_(sh);
  var last = sh.getLastRow();
  var colEnt = ensureCol_(sh, AUTORIZACION.COL_ENTREGA);

  var enviados = [], errores = [];
  for (var r = 2; r <= last; r++) {
    var g = function (n) { var c = map[n]; return (c == null) ? '' : String(sh.getRange(r, c + 1).getDisplayValue() || '').trim(); };
    var folio = g(SOL.COL_FOLIO);
    if (!folio) continue;
    if (normalizarTexto(g(SOL.COL_ESTATUS_AUT)) !== 'AUTORIZADO') continue;

    var entregado = String(sh.getRange(r, colEnt + 1).getDisplayValue() || '').trim();
    if (entregado) continue;

    try {
      avisarEntregaOmar_(sh, r, map, folio);
      enviados.push(folio + ' · ' + g(SOL.COL_SUCURSAL) + ' · ' + g(SOL.COL_COLABORADOR));
    } catch (err) {
      errores.push(folio + ' -> ' + err.message);
    }
  }

  var msg = 'AVISOS A OMAR (+Eri en copia) ENVIADOS (' + enviados.length + '):\n' +
            (enviados.join('\n') || '   ninguno pendiente');
  if (errores.length) msg += '\n\nERRORES:\n' + errores.join('\n');
  msg += '\n\nCuota de correos restante: ' + MailApp.getRemainingDailyQuota();
  Logger.log(msg);
  return msg;
}


/** DIAGNÓSTICO ESPECÍFICO DE OMAR, renglón por renglón. */
function diagnosticoOmar() {
  var out = [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  var map = mapaColumnas_(sh);
  var last = sh.getLastRow();

  out.push('CORREO CONFIGURADO PARA OMAR: ' + AUTORIZACION.OMAR_CORREO);
  out.push('CORREO CONFIGURADO PARA ERI:  ' + AUTORIZACION.ERI_CORREO);
  out.push('CUOTA DE CORREOS RESTANTE:    ' + MailApp.getRemainingDailyQuota());
  out.push('');

  out.push('PRUEBA DIRECTA A OMAR:');
  try {
    MailApp.sendEmail({
      to: AUTORIZACION.OMAR_CORREO,
      subject: 'PRUEBA Caja Chica para Omar — ' + new Date().toLocaleString('es-MX'),
      body: 'Omar: si recibes esto, los correos del sistema SÍ te llegan. Revisa SPAM si no lo ves.',
      name: 'Sistema de Caja Chica Vizcarra'
    });
    out.push('   Enviado sin error. Que Omar revise BANDEJA y SPAM.');
  } catch (e) {
    out.push('   *** FALLÓ: ' + e.message + ' ***');
  }
  out.push('');

  var colEnt = ensureCol_(sh, AUTORIZACION.COL_ENTREGA);
  out.push('RENGLONES "Autorizado" Y SI OMAR DEBE RECIBIRLOS:');
  var pendientes = 0;
  for (var r = 2; r <= last; r++) {
    var g = function (n) { var c = map[n]; return (c == null) ? '' : String(sh.getRange(r, c + 1).getDisplayValue() || '').trim(); };
    var folio = g(SOL.COL_FOLIO);
    if (!folio) continue;
    if (normalizarTexto(g(SOL.COL_ESTATUS_AUT)) !== 'AUTORIZADO') continue;

    var entregado = String(sh.getRange(r, colEnt + 1).getDisplayValue() || '').trim();
    var area = g(SOL.COL_AREA);
    var imp  = (map[SOL.COL_IMPORTE] != null) ? Number(sh.getRange(r, map[SOL.COL_IMPORTE] + 1).getValue()) || 0 : 0;
    var pasa = liberoAngel_(sh, r, map, area, imp);

    out.push('   fila ' + r + ' · ' + folio + ' · ' + area +
             '\n      Autorizo: "' + g(SOL.COL_AUTORIZO) + '"' +
             '\n      ¿Omar debe recibirlo?: ' + (pasa ? 'SÍ' : 'NO (aquí está el bloqueo)') +
             '\n      Entrega Efectivo: ' + (entregado || '(vacío = sigue pendiente)'));
    if (pasa && !entregado) pendientes++;
  }
  out.push('');
  out.push('TOTAL PENDIENTES QUE OMAR DEBERÍA TENER: ' + pendientes);
  out.push('Corre reenviarPendientesOmar() para mandárselos todos ahora.');

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}


/* ===== Helpers propios de Solicitud ===== */

function generarFolioSolicitud_(anio, sucursal) {
  var props = PropertiesService.getScriptProperties();
  var codigo = obtenerCodigoSucursalSolicitud_(sucursal);
  var clave = 'ULTIMO_FOLIO_' + codigo + '_' + anio;
  var ultimo = Number(props.getProperty(clave) || 0);
  var nuevo = ultimo + 1;
  props.setProperty(clave, String(nuevo));
  return 'CC-' + codigo + '-' + anio + '-' + String(nuevo).padStart(6, '0');
}

/** Código de 3 letras para el folio. Ahora, si no encuentra el nombre tal
 *  cual, prueba las mismas variantes que solBuscarSucursal_ (quitar "CAJA",
 *  número por palabra) antes de rendirse, y si de plano no lo halla dice
 *  cuáles sí existen. */
function obtenerCodigoSucursalSolicitud_(sucursal) {
  var n = normalizarTexto(sucursal);
  if (SUC_CODIGOS[n]) return SUC_CODIGOS[n];

  var variantes = [
    n.replace(/^CAJA\s+/, ''),
    n.replace(/\bUNO\b/g, '1').replace(/\bDOS\b/g, '2'),
    n.replace(/\b1\b/g, 'UNO').replace(/\b2\b/g, 'DOS'),
    n.replace(/^CAJA\s+/, '').replace(/\bUNO\b/g, '1').replace(/\bDOS\b/g, '2'),
    n.replace(/^CAJA\s+/, '').replace(/\b1\b/g, 'UNO').replace(/\b2\b/g, 'DOS'),
    n.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  ];
  for (var i = 0; i < variantes.length; i++) {
    if (variantes[i] && SUC_CODIGOS[variantes[i]]) return SUC_CODIGOS[variantes[i]];
  }

  throw new Error('No hay código de folio configurado para la sucursal: "' + sucursal + '". ' +
    'Agrégala a SUC_CODIGOS en Solicitud.gs. Nombres que sí existen: ' +
    Object.keys(SUC_CODIGOS).slice(0, 20).join(' · '));
}


/* ===== CANCELACIÓN DE FOLIOS (paso 1 de 2) =====
   Marca como "Cancelado", pone el importe en 0 y limpia la comprobación.
   No manda ningún correo. ===== */
var FOLIOS_A_CANCELAR_HOY = [
  'CC-CDS-2026-000065',
  'CC-CDS-2026-000084',
  'CC-GDL-2026-000004'
];

function cancelarEstosFolios() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  if (!sh) throw new Error('No se encontró la hoja "' + SOL.HOJA_CONCENTRADO + '".');

  var map = mapaColumnas_(sh);
  var last = sh.getLastRow();
  if (last < 2) return 'La hoja no tiene datos.';
  var folios = sh.getRange(2, map[SOL.COL_FOLIO] + 1, last - 1, 1).getDisplayValues();
  var buscar = FOLIOS_A_CANCELAR_HOY.map(function (f) { return normalizarTexto(f); });

  var COLS_COMPROB_A_LIMPIAR = [
    'Importe Comprobado', 'Fecha de Comprobacion', 'Estatus Comprobación',
    'Ruta Evidencia', 'Diferencia', 'Miniatura', 'Tipo de comprobante', 'Factura No. '
  ];

  var hechos = [], noEncontrados = buscar.slice();

  for (var i = 0; i < folios.length; i++) {
    var f = normalizarTexto(folios[i][0]);
    if (!f) continue;
    if (buscar.indexOf(f) < 0) continue;

    var fila = i + 2;
    var idx = noEncontrados.indexOf(f);
    if (idx >= 0) noEncontrados.splice(idx, 1);

    var importePrev = (map[SOL.COL_IMPORTE] != null)
      ? Number(sh.getRange(fila, map[SOL.COL_IMPORTE] + 1).getValue()) || 0 : 0;

    setCelda_(sh, fila, map[SOL.COL_ESTATUS_AUT], 'Cancelado');
    if (map[SOL.COL_IMPORTE] != null) setCelda_(sh, fila, map[SOL.COL_IMPORTE], 0);

    COLS_COMPROB_A_LIMPIAR.forEach(function (nombreCol) {
      var c = map[nombreCol];
      if (c != null) sh.getRange(fila, c + 1).setValue('');
    });

    if (map[SOL.COL_OBSERV] != null) {
      var prev = String(sh.getRange(fila, map[SOL.COL_OBSERV] + 1).getDisplayValue() || '').trim();
      var nota = 'CANCELADO. Importe original: $' + importePrev.toFixed(2);
      setCelda_(sh, fila, map[SOL.COL_OBSERV], prev ? (prev + ' | ' + nota) : nota);
    }

    hechos.push('Fila ' + fila + ' · ' + folios[i][0] + ' · cancelado (importe $' + importePrev.toFixed(2) + ' → 0)');
  }

  var msg = hechos.length
    ? 'FOLIOS CANCELADOS (' + hechos.length + '):\n' + hechos.join('\n')
    : 'No se encontró ninguno de los folios de la lista.';
  if (noEncontrados.length) msg += '\n\n*** NO SE ENCONTRARON: ' + noEncontrados.join(', ') + ' ***';
  Logger.log(msg);
  return msg;
}


/* ===== BORRAR TODOS LOS CANCELADOS (paso 2 de 2) =====
   Elimina del Concentrado TODAS las filas cuyo estatus sea "Cancelado". ===== */
function borrarTodosLosCancelados() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  if (!sh) throw new Error('No se encontró la hoja "' + SOL.HOJA_CONCENTRADO + '".');

  var map = mapaColumnas_(sh);
  var colEst = map[SOL.COL_ESTATUS_AUT];
  var colFol = map[SOL.COL_FOLIO];
  if (colEst == null) throw new Error('No se encontró la columna de estatus de autorización.');

  var last = sh.getLastRow();
  if (last < 2) return 'La hoja no tiene datos.';

  var datos = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getDisplayValues();
  var borrados = [];

  for (var i = datos.length - 1; i >= 0; i--) {
    var est = normalizarTexto(datos[i][colEst]);
    if (est !== normalizarTexto('Cancelado')) continue;
    var fol = String(datos[i][colFol] || '').trim() || '(sin folio)';
    sh.deleteRow(i + 2);
    borrados.push(fol);
  }

  borrados.reverse();
  var msg = borrados.length
    ? 'FILAS BORRADAS (' + borrados.length + '):\n' + borrados.join('\n')
    : 'No había ninguna fila con estatus "Cancelado".';
  Logger.log(msg);
  return msg;
}


/* ============================================================
 *  WEBHOOK DE APPSHEET  ·  CON CANDADO ANTI-DUPLICADOS
 *  (si no ves las dos líneas marcadas abajo, esta versión es vieja)
 * ============================================================ */
function doPost(e) {
  var raw = '';
  var caja = '';
  try {
    raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';

    var payload;
    try {
      payload = JSON.parse(raw);
    } catch (errJson) {
      solLogWebhook_('ERROR', '', 'El cuerpo del POST no es un JSON válido: ' + errJson.message, '', raw);
      return ContentService.createTextOutput(JSON.stringify(
        { ok: false, mensaje: 'JSON inválido: ' + errJson.message })).setMimeType(ContentService.MimeType.JSON);
    }

    caja = String(payload.sucursal || '').trim();

    /* >>> CANDADO 1 de 2 <<<
       Si AppSheet ya mandó este mismo gasto, aquí se detiene y NO se
       crea otro renglón en el Concentrado. */
    var repetido = solRevisarDuplicado_(payload, raw);
    if (repetido) {
      return ContentService.createTextOutput(JSON.stringify(repetido))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 1. Limpiar importe eliminando el signo $ y comas
    var importeLimpio = String(payload.importe || '0').replace(/[^0-9.-]+/g, '');
    var importe = Number(importeLimpio) || 0;

    // 2. Manejo de sucursales a las que aplica
    var sucursalesAplica = [];
    if (Array.isArray(payload.sucursalesAplica)) {
      sucursalesAplica = payload.sucursalesAplica;
    } else if (payload.sucursalesAplica) {
      sucursalesAplica = String(payload.sucursalesAplica)
        .split(',')
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
    }

    // 3. Obtener el archivo PDF (sea URL de AppSheet o archivo de Drive)
    var archivosAdjuntos = [];
    var avisoPdf = '';
    var rutaOArchivoPdf = String(payload.archivoPdf || '').trim();

    if (rutaOArchivoPdf) {
      try {
        var blobPdf = null;

        // Las URL de AppSheet NO se descargan (dan 404): se resuelven contra
        // Drive con resolverArchivoAppSheet_, igual que una ruta.
        if ((rutaOArchivoPdf.indexOf('http://') === 0 || rutaOArchivoPdf.indexOf('https://') === 0)
            && rutaOArchivoPdf.toLowerCase().indexOf('appsheet.com') < 0) {
          var respuesta = UrlFetchApp.fetch(rutaOArchivoPdf, { muteHttpExceptions: true });
          if (respuesta.getResponseCode() === 200) {
            var b = respuesta.getBlob();
            var ct = String(b.getContentType() || '').toLowerCase();
            // Una página de login también responde 200. Si llegó HTML, no es
            // el PDF: se descarta en vez de adjuntar basura.
            if (ct.indexOf('text/html') >= 0) {
              avisoPdf = 'La URL del PDF devolvió una página web (probablemente pide iniciar sesión), no se adjuntó.';
            } else {
              blobPdf = b;
              blobPdf.setName((payload.proveedor || 'OC') + '.pdf');
            }
          } else {
            avisoPdf = 'La URL del PDF respondió código ' + respuesta.getResponseCode() + ', no se adjuntó.';
          }
        } else {
          var archivoDrive = resolverArchivoAppSheet_(rutaOArchivoPdf);
          if (archivoDrive) blobPdf = archivoDrive.getBlob();
          else avisoPdf = 'No se encontró en Drive el archivo "' + rutaOArchivoPdf + '".';
        }

        if (blobPdf) {
          archivosAdjuntos.push({
            nombre: blobPdf.getName() || 'Orden_Compra.pdf',
            mime: blobPdf.getContentType() || 'application/pdf',
            b64: Utilities.base64Encode(blobPdf.getBytes())
          });
        }
      } catch (errPdf) {
        avisoPdf = 'No se pudo adjuntar el PDF: ' + errPdf.message;
        console.error(avisoPdf);
      }
    }

    // 4. Parámetros para registrarSolicitud
    var datos = {
      correo:           String(payload.correo || '').trim(),
      sucursal:         caja,
      area:             String(payload.area || '').trim(),
      colaborador:      String(payload.colaborador || '').trim(),
      tipoGasto:        String(payload.tipoGasto || '').trim(),
      descripcion:      String(payload.descripcion || '').trim(),
      proveedor:        String(payload.proveedor || '').trim(),
      importe:          importe,
      sucursalesAplica: sucursalesAplica,
      catalogoSucursal: payload.catalogoSucursal ? String(payload.catalogoSucursal).trim() : '',
      archivos:         archivosAdjuntos
    };

    var resultado = registrarSolicitud(datos);

    /* >>> CANDADO 2 de 2 <<<
       Guarda el folio en la huella si salió bien, o la borra si falló
       (para que un reenvío corregido sí pueda entrar). */
    solCerrarDuplicado_(payload, resultado);

    var mensajeLog = String(resultado.mensaje || '') + (avisoPdf ? '  ·  ' + avisoPdf : '');
    solLogWebhook_(resultado.ok ? 'OK' : 'ERROR', resultado.folio || '', mensajeLog, caja, raw);

    return ContentService
      .createTextOutput(JSON.stringify(resultado))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    solLogWebhook_('ERROR', '', 'Falla inesperada: ' + err.message, caja, raw);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, mensaje: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function buscarArchivoEnDrive_(rutaOId) {
  if (rutaOId.indexOf('/') < 0 && rutaOId.length > 20 && rutaOId.indexOf('.') < 0) {
    try { return DriveApp.getFileById(rutaOId); } catch (e) {}
  }
  var partes = rutaOId.split('/');
  var nombreSolo = partes[partes.length - 1].trim();
  var archivos = DriveApp.getFilesByName(nombreSolo);
  if (archivos.hasNext()) {
    return archivos.next();
  }
  return null;
}

/** Pasa un texto a MAYÚSCULAS y le quita los espacios de sobra.
 *  Conserva acentos y ñ. Si viene vacío, devuelve cadena vacía. */
function solMayus_(texto) {
  return String(texto == null ? '' : texto)
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}


/* ============================================================================
   HERRAMIENTAS DE REVISIÓN  (se corren a mano desde el editor de Apps Script)
   ============================================================================ */

/** Borra el caché del catálogo (dura 2 minutos) para que los cambios que
 *  acabas de hacer en la pestaña Catálogos se vean de inmediato.
 *  Va SIN guion bajo al final para que aparezca en la lista de "Ejecutar". */
function limpiarCache() {
  limpiarCacheCatalogo_();
  SpreadsheetApp.getActive().toast('Caché del catálogo borrado.', 'Listo', 5);
  Logger.log('Caché del catálogo borrado. La próxima solicitud lee la hoja otra vez.');
}

/** Diagnóstico: borra el caché y luego enseña en el registro cómo quedó
 *  repartido el catálogo. Sirve para comprobar que los bloques comunes
 *  (MOVIMIENTOS DE EFECTIVO y COSTO DE VENTAS) SÍ llegaron a las cajas y
 *  que NO se quedaron como si fueran una sucursal más. */
function verBloqueComun() {
  limpiarCacheCatalogo_();

  var cat = getCatalogoSolicitud();

  Logger.log('Unidades en el menú (%s): %s', cat.sucursales.length, cat.sucursales.join(' | '));
  Logger.log('Cajas que pueden pagar (%s): %s', cat.cajasQuePagan.length, cat.cajasQuePagan.join(' | '));
  Logger.log('---------------------------------------------------------------');

  var muestra = ['CEDIS SAN PABLO', 'SAN PABLO UNO', 'GUADALAJARA'];
  muestra.forEach(function (nombre) {
    var u = solBuscarSucursal_(cat, nombre);
    if (!u) { Logger.log('%s -> NO EXISTE en el catálogo', nombre); return; }

    var familias = {};
    u.lista.forEach(function (e) { familias[e.concepto] = (familias[e.concepto] || 0) + 1; });
    var nombres = Object.keys(familias);

    Logger.log('%s -> %s cuentas, %s familias', u.real, u.lista.length, nombres.length);
    Logger.log('   familias: %s', nombres.join(' | '));
  });

  Logger.log('---------------------------------------------------------------');

  // ¿Llegaron las cuentas de compras de mercancía?
  var pruebas = [
    'Adquisicion de Mercancia Nacional-COMPRA DE MERCANCIA NACIONAL',
    'Adquisicion de Mercancia Importada-COMPRA DE MERCANCIA IMPORTADA'
  ];
  var caja = solBuscarSucursal_(cat, 'CEDIS SAN PABLO');
  pruebas.forEach(function (texto) {
    var hallada = caja ? solBuscarTipoGasto_(caja.lista, texto, null) : null;
    Logger.log('"%s" -> %s', texto,
               hallada ? ('SÍ existe. Cuenta ' + hallada.cuenta + ' · ' +
                          hallada.concepto + ' · ' + hallada.subconcepto)
                       : 'NO se encontró');
  });
}