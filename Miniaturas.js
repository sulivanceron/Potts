/* ==========================================================================
   COMPROBANTES EN EL FLUJO DE CEDIS SAN PABLO — imagen incrustada
   --------------------------------------------------------------------------
   Baja la foto del comprobante de cada folio a la columna COMPROBANTE de la
   pestaña EGRESOS del archivo de flujo de CEDIS SAN PABLO.

   NO TOCA EL ALTO DE LA FILA. En ningún renglón de este código hay un
   setRowHeight: la foto se acomoda dentro de la celda con la altura que la
   fila ya tenga.

   CAMBIO 15-sept-2026 — "Se produjo un error desconocido":
   la versión anterior leía la columna COMPROBANTE completa con getValues().
   Esa columna ya trae imágenes incrustadas, y en este archivo una lectura o
   escritura EN BLOQUE sobre celdas con imagen truena con ese error genérico
   de Google. Es el mismo problema que ya está documentado en Solicitud.gs
   ("escribe CELDA POR CELDA porque la hoja tiene imágenes en celda").
   Como eso pasaba ANTES del ciclo, ningún try/catch lo alcanzaba y se caía
   la función entera.

   Ahora:
     - Solo se leen en bloque las columnas de TEXTO (FOLIO y RUTA) y las
       FÓRMULAS de la columna COMPROBANTE. Nunca getValues() sobre ella.
     - La foto se escribe celda por celda, cada una en su try/catch.
     - Se avanza en tandas de MFL_POR_TANDA filas y se guarda por dónde se
       quedó, así que puedes correrla las veces que haga falta hasta que
       diga TERMINADO.
     - Como ya no se puede distinguir "celda vacía" de "celda con imagen",
       algunas filas se rescriben. No pasa nada: queda la misma foto, con la
       URL que sí funciona hoy.

   ORDEN PARA CORRER:
     1) verComprobantesFlujoCSP()   -> NO cambia nada, solo informa
     2) bajarComprobantesFlujoCSP() -> baja las fotos (repetir hasta TERMINADO)
     3) reiniciarAvanceComprobantesCSP() -> solo si quieres empezar de cero
   ========================================================================== */

var MFL_CAJA = 'CEDIS SAN PABLO';
var MFL_LIMITE_MS = 4 * 60 * 1000;   // se detiene sola antes del corte de 6 min
var MFL_POR_TANDA = 120;             // máximo de filas por corrida
var MFL_PROP_AVANCE = 'MFL_AVANCE_CSP';

/* Primera foto dentro de una carpeta de Drive. */
function _mflPrimeraFoto_(carpeta) {
  if (!carpeta) return null;
  var it = carpeta.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (String(f.getMimeType() || '').indexOf('image/') === 0) return f;
  }
  return null;
}

/* Carpeta del folio: por el link de la columna RUTA, y si no, buscándola
   por caja + folio dentro de la carpeta raíz de comprobantes. */
function _mflCarpeta_(rutaUrl, folio) {
  var m = String(rutaUrl || '').match(/folders\/([A-Za-z0-9_\-]+)/);
  if (m) {
    try { return DriveApp.getFolderById(m[1]); } catch (e) { /* plan B */ }
  }
  try {
    if (!CFG.CARPETA_RAIZ_ID) return null;
    var raiz = DriveApp.getFolderById(CFG.CARPETA_RAIZ_ID);
    var itS = raiz.getFoldersByName(limpiaNombre_(MFL_CAJA));
    if (!itS.hasNext()) return null;
    var itF = itS.next().getFoldersByName(limpiaNombre_(folio));
    return itF.hasNext() ? itF.next() : null;
  } catch (e) { return null; }
}

/* Abre EGRESOS del flujo y lee SOLO columnas seguras:
     - FOLIO y RUTA como texto
     - la columna COMPROBANTE únicamente con getFormulas() (texto también)
   Nunca se hace getValues() sobre la columna de imágenes. */
function _mflLeer_() {
  var id = fileIdDeCaja_(MFL_CAJA);
  if (!id) throw new Error('No hay archivo registrado para ' + MFL_CAJA + ' en la pestaña CAJAS.');

  var eg = SpreadsheetApp.openById(id).getSheetByName('EGRESOS');
  if (!eg) throw new Error('El archivo de ' + MFL_CAJA + ' no tiene pestaña EGRESOS.');

  var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
  var colComp = me[SYNC.EG_COMPROBANTE];
  var colRuta = me[SYNC.EG_RUTA];
  var colFol  = me[SYNC.EG_FOLIO];

  if (colComp == null) throw new Error('No encontré la columna "' + SYNC.EG_COMPROBANTE + '" en EGRESOS.');
  if (colRuta == null) throw new Error('No encontré la columna "' + SYNC.EG_RUTA + '" en EGRESOS.');

  var primera = SYNC.EG_HEADER_ROW + 1;
  var ultima = eg.getLastRow();
  if (ultima < primera) return { eg: eg, colComp: colComp, filas: [] };

  var n = ultima - primera + 1;
  var formulas = eg.getRange(primera, colComp, n, 1).getFormulas();
  var rutas    = eg.getRange(primera, colRuta, n, 1).getDisplayValues();
  var folios   = (colFol != null) ? eg.getRange(primera, colFol, n, 1).getDisplayValues() : null;

  var filas = [];
  for (var i = 0; i < n; i++) {
    var f = String(formulas[i][0] || '').trim().toUpperCase();
    filas.push({
      fila:    primera + i,
      folio:   folios ? String(folios[i][0] || '').trim() : '',
      ruta:    String(rutas[i][0] || '').trim(),
      formula: (f.indexOf('=IMAGE') === 0)
    });
  }

  return { eg: eg, colComp: colComp, filas: filas };
}


/* ============ PASO 1: solo mirar ============ */
function verComprobantesFlujoCSP() {
  var d = _mflLeer_();
  var avance = Number(PropertiesService.getScriptProperties().getProperty(MFL_PROP_AVANCE) || 0);

  var conRuta = 0, conFormula = 0;
  d.filas.forEach(function (r) {
    if (r.ruta) conRuta++;
    if (r.formula) conFormula++;
  });

  var txt = 'EGRESOS de ' + MFL_CAJA + '\n';
  txt += '============================================================\n';
  txt += '  Filas de datos .............. ' + d.filas.length + '\n';
  txt += '  Con carpeta en RUTA ......... ' + conRuta + '   (a estas se les puede poner foto)\n';
  txt += '  Sin carpeta en RUTA ......... ' + (d.filas.length - conRuta) + '   (se quedan vacías)\n';
  txt += '  Con fórmula =IMAGE rota ..... ' + conFormula + '\n';
  txt += '------------------------------------------------------------\n';
  txt += '  Ya procesadas en corridas anteriores: ' + avance + '\n';
  txt += '  Faltan por procesar: ' + Math.max(0, d.filas.length - avance) + '\n\n';
  txt += 'El alto de las filas NO se modifica en ningún caso.\n';
  txt += 'Corre bajarComprobantesFlujoCSP() las veces que haga falta.\n';

  Logger.log(txt);
  return txt;
}


/* ============ PASO 2: bajar las fotos ============ */
function bajarComprobantesFlujoCSP() {
  var INICIO = new Date().getTime();
  var props = PropertiesService.getScriptProperties();
  var d = _mflLeer_();

  var desde = Number(props.getProperty(MFL_PROP_AVANCE) || 0);
  if (desde >= d.filas.length) desde = 0;   // ya se recorrió todo: vuelve a empezar

  var puestas = 0, sinFoto = 0, errores = [];
  var i = desde;
  var procesadas = 0;

  for (; i < d.filas.length; i++) {
    if (procesadas >= MFL_POR_TANDA) break;
    if (new Date().getTime() - INICIO > MFL_LIMITE_MS) break;

    var r = d.filas[i];
    procesadas++;

    // Sin carpeta no hay de dónde sacar la foto.
    if (!r.ruta) { sinFoto++; continue; }

    try {
      var carpeta = _mflCarpeta_(r.ruta, r.folio);
      var foto = _mflPrimeraFoto_(carpeta);

      if (!foto) {
        // Si traía una fórmula rota, se vacía para que no quede el #ERROR!.
        if (r.formula) d.eg.getRange(r.fila, d.colComp).clearContent();
        sinFoto++;
        continue;
      }

      try {
        foto.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (e) { /* si ya estaba compartida, se sigue */ }

       // FÓRMULA, no imagen incrustada: newCellImage ya no puede leer las
      // URLs de Drive (Google cerró lh3 y tampoco acepta thumbnail), y
      // devuelve "error al recuperar la imagen" en todas. La fórmula sí
      // funciona porque la resuelve el navegador de quien abre la hoja.
      // SIN segundo argumento: así no lleva coma y sirve con cualquier
      // configuración regional. El modo por defecto ajusta la foto al
      // tamaño de la celda, así que el alto de la fila no se toca.
      d.eg.getRange(r.fila, d.colComp)
        .setFormula('=IMAGE("https://drive.google.com/thumbnail?id=' + foto.getId() + '&sz=w200")');
      // A PROPÓSITO no hay setRowHeight: el alto de la fila no se toca.
      puestas++;

    } catch (e) {
      errores.push('fila ' + r.fila + ' · ' + (r.folio || '?') + ' -> ' + e.message);
    }
  }

  props.setProperty(MFL_PROP_AVANCE, String(i));
  var termino = (i >= d.filas.length);

  var msg = 'COMPROBANTES DEL FLUJO DE ' + MFL_CAJA + '\n';
  msg += '============================================================\n';
  msg += 'Filas procesadas en esta corrida: ' + procesadas + '\n';
  msg += 'Fotos puestas: ' + puestas + '\n';
  msg += 'Sin foto (sin carpeta o carpeta sin imagen): ' + sinFoto + '\n';
  msg += 'Avance total: ' + i + ' de ' + d.filas.length + '\n';
  msg += 'El alto de las filas no se modificó.\n';
  if (errores.length) {
    msg += '\nERRORES (' + errores.length + '):\n' + errores.join('\n');
  }
  msg += termino
    ? '\n\n*** TERMINADO: se recorrieron todas las filas. ***'
    : '\n\n*** FALTAN ' + (d.filas.length - i) + ' FILAS. Vuelve a correr la MISMA función, tal cual: arranca desde la fila ' + (i + 1) + '. ***';

  Logger.log(msg);
  return msg;
}


/* ============ Reiniciar el avance (solo si quieres empezar de cero) ====== */
function reiniciarAvanceComprobantesCSP() {
  PropertiesService.getScriptProperties().deleteProperty(MFL_PROP_AVANCE);
  var msg = 'Avance reiniciado. La próxima corrida de bajarComprobantesFlujoCSP() empieza desde la primera fila.';
  Logger.log(msg);
  return msg;
}

/* TEMPORAL — solo para ver dónde truena. Bórrala después. */
function _pruebaFlujoCSP() {
  Logger.log('0) arranca');

  var id = fileIdDeCaja_('CEDIS SAN PABLO');
  Logger.log('1) fileId = ' + id);

  var ss = SpreadsheetApp.openById(id);
  Logger.log('2) archivo abierto: ' + ss.getName());

  var eg = ss.getSheetByName('EGRESOS');
  Logger.log('3) EGRESOS ok · ultima fila = ' + eg.getLastRow() + ' · ultima col = ' + eg.getLastColumn());

  var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
  Logger.log('4) col COMPROBANTE = ' + me[SYNC.EG_COMPROBANTE] +
             ' · col RUTA = ' + me[SYNC.EG_RUTA] +
             ' · col FOLIO = ' + me[SYNC.EG_FOLIO]);

  var primera = SYNC.EG_HEADER_ROW + 1;
  var n = eg.getLastRow() - SYNC.EG_HEADER_ROW;
  Logger.log('5) filas de datos = ' + n);

  var rutas = eg.getRange(primera, me[SYNC.EG_RUTA], n, 1).getDisplayValues();
  Logger.log('6) RUTA leida ok (' + rutas.length + ' filas)');

  var folios = eg.getRange(primera, me[SYNC.EG_FOLIO], n, 1).getDisplayValues();
  Logger.log('7) FOLIO leido ok (' + folios.length + ' filas)');

  var form = eg.getRange(primera, me[SYNC.EG_COMPROBANTE], n, 1).getFormulas();
  Logger.log('8) FORMULAS de COMPROBANTE leidas ok (' + form.length + ' filas)');

  Logger.log('*** TODO BIEN: ninguna lectura truena ***');
}