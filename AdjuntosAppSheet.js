/**********************************************************************
 * AdjuntosAppSheet.gs — ENCONTRAR EL PDF DE LA ORDEN DE COMPRA A PARTIR DE LA RUTA QUE MANDA APPSHEET
 *
 * EL PROBLEMA: AppSheet no manda una URL ni un ID de Drive. Manda una
 * RUTA RELATIVA dentro de la carpeta de la app, así:
 *
 *   appsheet/data/COMPRAS-221062921/ORDENES/TOÑO HUERTA/OC CGV26OC344.pdf
 *
 * El código viejo tiraba la ruta y buscaba el archivo por nombre en todo
 * Drive. Eso falla cuando el archivo vive en otra cuenta, cuando hay dos
 * archivos con el mismo nombre, o cuando está en una unidad compartida.
 *
 * Aquí se recorre la ruta carpeta por carpeta, que es lo correcto, y si
 * eso no funciona se prueban otros caminos, del más exacto al más
 * flexible. Nunca truena: si no lo encuentra, devuelve null y la
 * solicitud sigue su curso sin adjunto.
 *
 * ORDEN PARA CORRER:
 *   1) verRutaAppSheet()   -> diagnóstico, NO cambia nada
 *   2) ya que funcione, doPost usa resolverArchivoAppSheet_()
 **********************************************************************/

/* Ruta de ejemplo para el diagnóstico. Cámbiala por una real y corre
   verRutaAppSheet() desde el editor. */
var APPSHEET_RUTA_PRUEBA =
  'appsheet/data/COMPRAS-221062921/ORDENES/TOÑO HUERTA/OC CGV26OC344.pdf';

/* Carpeta que Compras compartió contigo. Con esto el sistema entra
   directo ahí y baja por la ruta, en vez de andar buscando por todo
   Drive. Se saca de la barra del navegador: .../folders/ESTE_ES_EL_ID */
var APPSHEET_CARPETA_ID = '17Ij4iIoOGmQE1k8_fbDfO6bMjH7liU4F';


/** Parte la ruta en pedazos, quitando vacíos y espacios. */
function appsPartes_(ruta) {
  return String(ruta || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
}


/** Busca una subcarpeta por nombre dentro de otra. Devuelve null si no. */
function appsSubcarpeta_(padre, nombre) {
  try {
    var it = padre.getFoldersByName(nombre);
    return it.hasNext() ? it.next() : null;
  } catch (e) { return null; }
}


/** CAMINO 1: recorrer la ruta carpeta por carpeta.
 *
 *  No se sabe en qué nivel está la carpeta compartida — puede ser
 *  "appsheet", "data", la de la app o "ORDENES". Por eso se prueba a
 *  empezar la ruta en CADA nivel, y gana el primero que llegue completo
 *  hasta el archivo. Así da igual qué carpeta hayan compartido.
 *
 *  También se prueba desde tu unidad, por si el archivo estuviera ahí. */
function appsPorRuta_(ruta) {
  try {
    var partes = appsPartes_(ruta);
    if (!partes.length) return null;

    var archivo = partes.pop();          // el último pedazo es el archivo

    var bases = [];
    if (APPSHEET_CARPETA_ID) {
      try { bases.push(DriveApp.getFolderById(APPSHEET_CARPETA_ID)); } catch (e) { }
    }
    try { bases.push(DriveApp.getRootFolder()); } catch (e) { }

    for (var b = 0; b < bases.length; b++) {
      // inicio = desde qué pedazo de la ruta se empieza a bajar.
      // inicio = partes.length significa "el archivo está aquí mismo".
      for (var inicio = 0; inicio <= partes.length; inicio++) {
        var carpeta = bases[b];
        var ok = true;
        for (var i = inicio; i < partes.length; i++) {
          var sig = appsSubcarpeta_(carpeta, partes[i]);
          if (!sig) { ok = false; break; }
          carpeta = sig;
        }
        if (!ok) continue;
        var it = carpeta.getFilesByName(archivo);
        if (it.hasNext()) return it.next();
      }
    }
    return null;
  } catch (e) { return null; }
}


/** CAMINO 2: encontrar la carpeta de la app por su nombre en cualquier
 *  parte de Drive (aunque esté compartida) y seguir la ruta desde ahí. */
function appsPorCarpetaDeLaApp_(ruta) {
  try {
    var partes = appsPartes_(ruta);
    if (partes.length < 2) return null;

    var archivo = partes.pop();

    // Se busca, de atrás hacia adelante, la primera carpeta de la ruta que
    // exista en Drive. Así funciona aunque "appsheet" o "data" no estén
    // en TU unidad pero sí la carpeta de la app.
    for (var inicio = 0; inicio < partes.length; inicio++) {
      var it = DriveApp.getFoldersByName(partes[inicio]);
      while (it.hasNext()) {
        var base = it.next();
        var carpeta = base, ok = true;
        for (var j = inicio + 1; j < partes.length; j++) {
          carpeta = appsSubcarpeta_(carpeta, partes[j]);
          if (!carpeta) { ok = false; break; }
        }
        if (!ok) continue;
        var itA = carpeta.getFilesByName(archivo);
        if (itA.hasNext()) return itA.next();
      }
    }
    return null;
  } catch (e) { return null; }
}


/** CAMINO 3: buscar el archivo por nombre en todo Drive. Es el que ya
 *  existía. Se queda como último recurso porque puede traer el archivo
 *  equivocado si hay nombres repetidos. */
function appsPorNombre_(ruta) {
  try {
    var partes = appsPartes_(ruta);
    if (!partes.length) return null;
    var archivo = partes[partes.length - 1];
    var it = DriveApp.getFilesByName(archivo);
    return it.hasNext() ? it.next() : null;
  } catch (e) { return null; }
}


/** CAMINO 4: por si la ruta en realidad era un ID o una URL de Drive. */
function appsPorIdOUrl_(ruta) {
  try {
    var t = String(ruta || '').trim();

    var m = t.match(/[-\w]{25,}/);           // un ID dentro de una URL
    if (t.indexOf('http') === 0 && m) {
      try { return DriveApp.getFileById(m[0]); } catch (e) { }
    }
    if (t.indexOf('/') < 0 && t.indexOf('.') < 0 && t.length > 20) {
      try { return DriveApp.getFileById(t); } catch (e) { }
    }
    return null;
  } catch (e) { return null; }
}

/** AppSheet no manda la ruta pelona: manda una URL firmada tipo
 *
 *   https://www.appsheet.com/template/gettablefileurl?appName=...
 *      &fileName=appsheet%2Fdata%2FCOMPRAS-221062921%2FORDENES%2FOC%20CGV26OC347.pdf
 *      &appVersion=...&signature=...
 *
 *  Esa URL responde 404 cuando la pide el script (la firma solo sirve
 *  dentro de AppSheet). Pero NO hace falta: adentro, en el parámetro
 *  fileName, viene la ruta real del archivo en Drive. Esta función la
 *  saca y la devuelve ya legible, con los %2F convertidos en "/" y los
 *  %20 en espacios.
 *
 *  Si lo que llega no es una URL de AppSheet, devuelve vacío y el
 *  resolvedor sigue usando el texto tal como vino. */
function appsRutaDeUrlAppSheet_(ruta) {
  var t = String(ruta || '');
  if (t.toLowerCase().indexOf('appsheet.com') < 0) return '';
  var m = t.match(/[?&]fileName=([^&]+)/i);
  if (!m) return '';
  var r = m[1];
  try { r = decodeURIComponent(r); } catch (e) { }
  return r.trim();
}
/** LA BUENA: prueba los caminos, del más exacto al más flexible.
 *  Devuelve el archivo de Drive o null. Nunca truena.
 *
 *  LO PRIMERO es ver si viene una URL de AppSheet: en ese caso se le
 *  saca la ruta de adentro y se busca ESA en Drive. Antes se intentaba
 *  descargar la URL y devolvía 404, o peor: la firma larga se confundía
 *  con un ID de Drive. */
function resolverArchivoAppSheet_(ruta) {
  if (!ruta) return null;

  // 1) ¿Es una URL de AppSheet? Entonces la ruta de verdad va adentro.
  var real = '';
  try { real = appsRutaDeUrlAppSheet_(ruta); } catch (e) { real = ''; }
  var buscar = real || ruta;

  var f = null;
  if (!real) {                                  // si era URL, no tiene caso
    try { f = appsPorIdOUrl_(buscar); } catch (e) { }
  }
  if (!f) { try { f = appsPorRuta_(buscar); }           catch (e) { } }
  if (!f) { try { f = appsPorCarpetaDeLaApp_(buscar); } catch (e) { } }
  if (!f) { try { f = appsPorNombre_(buscar); }         catch (e) { } }
  return f;
}


/* ============================================================
 *  DIAGNÓSTICO — corre esto primero
 * ============================================================ */

/** Prueba los cuatro caminos con APPSHEET_RUTA_PRUEBA y te dice cuál
 *  encuentra el archivo. NO cambia nada en ningún lado. */
function verRutaAppSheet() {
  var ruta = APPSHEET_RUTA_PRUEBA;
  var partes = appsPartes_(ruta);

  var out = ['DIAGNÓSTICO DE LA RUTA DE APPSHEET',
             '============================================================',
             'Ruta: ' + ruta,
             'Pedazos: ' + partes.length + '  ->  ' + partes.join('  /  '),
             'Archivo buscado: ' + (partes.length ? partes[partes.length - 1] : '(ninguno)'),
             'Ejecutando como: ' + (Session.getActiveUser().getEmail() || '(no disponible)'),
             ''];

  /* --- Qué carpeta es la que configuraste --- */
  out.push('CARPETA CONFIGURADA:');
  if (APPSHEET_CARPETA_ID) {
    try {
      var cfg = DriveApp.getFolderById(APPSHEET_CARPETA_ID);
      out.push('   "' + cfg.getName() + '"   ->   ' + cfg.getUrl());
      var sub = cfg.getFolders(), lista = [], k = 0;
      while (sub.hasNext() && k < 8) { lista.push(sub.next().getName()); k++; }
      out.push('   contiene: ' + (lista.join(' · ') || '(sin subcarpetas)'));
    } catch (e) {
      out.push('   *** NO SE PUDO ABRIR: ' + e.message + ' ***');
      out.push('   Revisa que el ID sea correcto y que tengas acceso.');
    }
  } else {
    out.push('   (ninguna — APPSHEET_CARPETA_ID está vacío)');
  }
  out.push('');

  /* --- Los cuatro caminos --- */
  var pruebas = [
    ['1. Por ID o URL',                  appsPorIdOUrl_],
    ['2. Recorriendo la ruta',           appsPorRuta_],
    ['3. Buscando la carpeta de la app', appsPorCarpetaDeLaApp_],
    ['4. Por nombre en todo Drive',      appsPorNombre_]
  ];

  out.push('RESULTADO DE CADA CAMINO:');
  var ganador = null;
  pruebas.forEach(function (p) {
    var f = null;
    try { f = p[1](ruta); } catch (e) { }
    if (f) {
      if (!ganador) ganador = p[0];
      out.push('   ' + p[0] + ': ENCONTRADO');
      out.push('        nombre: ' + f.getName());
      out.push('        tipo:   ' + f.getMimeType());
      out.push('        link:   ' + f.getUrl());
    } else {
      out.push('   ' + p[0] + ': no lo encontró');
    }
  });
  out.push('');

  /* --- ¿Cuántos archivos con ese nombre hay? --- */
  try {
    var nombre = partes.length ? partes[partes.length - 1] : '';
    var it = DriveApp.getFilesByName(nombre);
    var cuantos = 0, ejemplos = [];
    while (it.hasNext() && cuantos < 6) { var a = it.next(); cuantos++; ejemplos.push(a.getUrl()); }
    out.push('Archivos en Drive llamados "' + nombre + '": ' + cuantos + (cuantos >= 6 ? ' o más' : ''));
    ejemplos.forEach(function (u) { out.push('   ' + u); });
  } catch (e) {
    out.push('No se pudo contar los archivos con ese nombre: ' + e.message);
  }

  out.push('');
  if (ganador) {
    out.push('>>> SÍ SE PUEDE ENCONTRAR, por el camino ' + ganador + '.');
    out.push('>>> Solo falta que doPost use resolverArchivoAppSheet_().');
  } else {
    out.push('>>> NINGÚN CAMINO LO ENCONTRÓ.');
    out.push('>>> Revisa que el ID de APPSHEET_CARPETA_ID sea el correcto y');
    out.push('>>> que el archivo OC CGV26OC344.pdf siga existiendo ahí.');
  }

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

/** Toma el ÚLTIMO envío que registró la bitácora LOG WEBHOOK, saca de su
 *  JSON la ruta del PDF, y dice qué pasó con ella. Así vemos con datos
 *  reales si AppSheet está mandando la ruta o no.
 *  NO cambia nada. */
function verUltimoPdfDelWebhook() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_LOG);
  if (!sh || sh.getLastRow() < 2) {
    return 'La pestaña LOG WEBHOOK está vacía: AppSheet no ha mandado nada, ' +
           'o el código de la bitácora no está corriendo.';
  }

  var out = ['ÚLTIMOS ENVÍOS Y SU PDF',
             '============================================================'];

  var desde = Math.max(2, sh.getLastRow() - 4);
  var n = sh.getLastRow() - desde + 1;
  var datos = sh.getRange(desde, 1, n, 6).getDisplayValues();

  datos.reverse().forEach(function (f) {
    var fecha = f[0], estado = f[1], folio = f[2], mensaje = f[3], crudo = f[5];

    out.push('');
    out.push(fecha + '   [' + estado + ']   ' + (folio || '(sin folio)'));
    if (mensaje) out.push('   mensaje: ' + mensaje);

    // Se saca "archivoPdf" del JSON que llegó, sin depender de JSON.parse
    // (el texto de la bitácora puede venir recortado).
    var m = String(crudo || '').match(/"archivoPdf"\s*:\s*"([^"]*)"/);
    if (!m) {
      out.push('   archivoPdf: *** NO VIENE EN EL JSON ***');
      out.push('      -> AppSheet no está mandando ese campo. Revisa el bot.');
      return;
    }

    var ruta = m[1];
    if (!ruta) {
      out.push('   archivoPdf: *** VIENE VACÍO ***');
      out.push('      -> La orden no traía PDF al momento de disparar el webhook,');
      out.push('         o la columna ARCHIVO PDF estaba en blanco en AppSheet.');
      return;
    }

    out.push('   archivoPdf: ' + ruta);

    var archivo = null;
    try { archivo = resolverArchivoAppSheet_(ruta); } catch (e) { }
    if (archivo) {
      out.push('      -> ENCONTRADO: ' + archivo.getName());
      out.push('         ' + archivo.getUrl());
      out.push('      -> Entonces el PDF sí se puede bajar. Si la columna W sigue');
      out.push('         vacía, falta el cambio de línea en doPost o la versión nueva.');
    } else {
      out.push('      -> *** NO SE ENCONTRÓ ESE ARCHIVO ***');
      out.push('         Copia esa ruta a APPSHEET_RUTA_PRUEBA y corre verRutaAppSheet().');
    }
  });

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}