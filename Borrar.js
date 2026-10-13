/**********************************************************************
 * Borrar.gs — Borra folios capturados por error.
 *
 * CAMBIO (10-sept-2026): se invirtió el orden y se blindó cada paso.
 *
 * ANTES: primero recorría las 15 cajas y AL FINAL borraba la fila del
 * Concentrado. Como solo el openById estaba protegido, cualquier falla
 * en cualquiera de las 15 cajas (encabezado distinto, archivo movido,
 * o tiempo de ejecución agotado) mataba la función antes de llegar al
 * Concentrado. Resultado: el folio NO se borraba del Concentrado, y por
 * eso reaparecía en el flujo en la siguiente sincronización.
 *
 * AHORA:
 *   1) Borra la fila del Concentrado PRIMERO (es el origen de todo).
 *   2) Quita el egreso SOLO de la caja que paga el folio (no de las 15),
 *      y cada caja va en su propio try/catch: si una falla, se reporta
 *      y sigue con las demás.
 *   3) Te reporta las carpetas de Drive para que las borres a mano
 *      (a propósito NO toca Drive: si algo sale mal, las fotos siguen ahí).
 *
 * NO manda ningún correo.
 *
 * ORDEN PARA CORRER:
 *   1) verFoliosABorrar()          -> NO cambia nada, solo te muestra
 *   2) borrarFoliosSeleccionados() -> los borra
 **********************************************************************/

var BORRAR_LISTA = [
  'CC-CDS-2026-001424',
  'CC-CDS-2026-001430',
  'CC-CDS-2026-001440',
  'CC-CDS-2026-001417',
];


/* ============ PASO 1: solo mirar ============ */
function verFoliosABorrar() {
  var d = borrLeer_();
  var txt = 'FOLIOS A BORRAR: ' + BORRAR_LISTA.length + '\n';
  txt += '============================================================\n\n';

  var noExisten = [];

  BORRAR_LISTA.forEach(function (f) {
    var k = String(f).trim().toUpperCase();
    var r = d.porFolio[k];
    if (!r) { noExisten.push(f); return; }

    txt += '### ' + r.folio + '   (fila ' + r.fila + ' del Concentrado)\n';
    txt += '    Caja que paga ....... ' + (r.sucursal || '(vacio)') + '\n';
    txt += '    Gasto de ............ ' + (r.aplica || '(vacio)') + '\n';
    txt += '    Colaborador ......... ' + (r.colaborador || '(vacio)') + '\n';
    txt += '    Importe ............. $' + borrNum_(r.importe) + '\n';
    txt += '    Importe comprobado .. ' + (r.impComp === '' ? '(sin comprobar)' : '$' + borrNum_(r.impComp)) + '\n';
    txt += '    Estatus autorizacion  ' + (r.estatus || '(vacio)') + '\n';
    txt += '    Entrega efectivo .... ' + (r.entrega || '(no entregado)') + '\n';
    txt += '    Ruta evidencia ...... ' + (r.ruta || '(sin carpeta)') + '\n';
    txt += '    Egreso vive en ...... ' + (borrCajaDe_(r.sucursal) || '(ninguna caja)') + '\n\n';
  });

  if (noExisten.length) {
    txt += 'NO EXISTEN EN EL CONCENTRADO (revisa que estén bien escritos):\n';
    txt += noExisten.join('\n') + '\n';
  }

  Logger.log(txt);
  return txt;
}


/* ============ PASO 2: borrar ============ */
function borrarFoliosSeleccionados() {
  var d = borrLeer_();

  var objetivo = {};
  BORRAR_LISTA.forEach(function (f) {
    var k = String(f).trim().toUpperCase();
    if (d.porFolio[k]) objetivo[k] = d.porFolio[k];
  });

  var claves = Object.keys(objetivo);
  if (!claves.length) {
    var vacio = 'Ninguno de los folios de la lista existe en el Concentrado. No se borró nada.\n' +
                'Revisa que el folio esté escrito exactamente igual que en la columna "' + SYNC.C_FOLIO + '".';
    Logger.log(vacio);
    return vacio;
  }

  var reporte = [];

  // De abajo hacia arriba, para que al borrar una fila no se corran las demás.
  var filas = claves.map(function (k) { return objetivo[k]; })
                    .sort(function (a, b) { return b.fila - a.fila; });

  /* ---- 1) PRIMERO: borrar la fila del Concentrado ----
     Va primero a propósito. Es el origen de la información: mientras el
     folio siga en el Concentrado, la sincronización lo vuelve a meter al
     flujo. Si algo falla más adelante (en las cajas), no importa: la
     siguiente corrida de sincronizarTodo() limpia el flujo sola. */
  reporte.push('--- FILAS BORRADAS DEL CONCENTRADO ---');

  var borradas = [];
  filas.forEach(function (r) {
    try {
      d.hoja.deleteRow(r.fila);
      borradas.push(r);
      reporte.push('fila ' + r.fila + '   ' + r.folio + '   $' + borrNum_(r.importe));
    } catch (e) {
      reporte.push('*** NO SE PUDO BORRAR la fila ' + r.fila + ' (' + r.folio + '): ' + e.message);
    }
  });

  if (!borradas.length) {
    reporte.push('(no se borró ninguna fila — revisa si la hoja está protegida)');
  }

  // Forzar que el borrado quede escrito antes de seguir con las cajas.
  try { SpreadsheetApp.flush(); } catch (e) { }

  /* ---- 2) Quitar el egreso de la caja que paga ----
     Solo se abren las cajas involucradas, no las 15. Cada una en su
     propio try/catch: si una caja truena, se reporta y se sigue. */
  reporte.push('');
  reporte.push('--- EGRESOS EN LOS ARCHIVOS DE CAJA ---');

  var cajasTocar = {};
  var hayFolioSinCaja = false;

  filas.forEach(function (r) {
    var c = borrCajaDe_(r.sucursal);
    if (c) { cajasTocar[c] = true; } else { hayFolioSinCaja = true; }
  });

  // Si algún folio no tiene caja identificable, sí recorremos todas
  // (es el único caso en que vale la pena el trabajo extra).
  var lista = hayFolioSinCaja ? CAJAS.slice() : Object.keys(cajasTocar);

  if (!lista.length) {
    reporte.push('(ninguna caja por revisar)');
  }

  lista.forEach(function (caja) {
    try {
      var fileId = fileIdDeCaja_(caja);
      if (!fileId) { reporte.push(caja + ': sin archivo registrado en CAJAS'); return; }

      var eg = SpreadsheetApp.openById(fileId).getSheetByName('EGRESOS');
      if (!eg) { reporte.push(caja + ': el archivo no tiene pestaña EGRESOS'); return; }

      var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
      var colFolio = me[SYNC.EG_FOLIO];
      if (!colFolio) { reporte.push(caja + ': no encontré la columna "' + SYNC.EG_FOLIO + '"'); return; }

      var primera = SYNC.EG_HEADER_ROW + 1;
      var ultima = eg.getLastRow();
      if (ultima < primera) { reporte.push(caja + ': EGRESOS está vacía'); return; }

      var folios = eg.getRange(primera, colFolio, ultima - primera + 1, 1).getValues();
      var quitados = [];

      for (var i = folios.length - 1; i >= 0; i--) {
        var fo = String(folios[i][0] || '').trim().toUpperCase();
        if (!fo) continue;
        if (!objetivo[fo]) continue;
        eg.deleteRow(primera + i);
        quitados.push(fo);
      }

      if (quitados.length) {
        reporte.push(caja + ': quitados ' + quitados.length + '  -> ' + quitados.join(', '));
      } else {
        reporte.push(caja + ': no había nada que quitar');
      }

    } catch (e) {
      // Importante: NO relanzamos el error. La fila del Concentrado ya
      // se borró arriba, y sincronizarTodo() limpiará el flujo después.
      reporte.push(caja + ': *** ERROR (se continúa) -> ' + e.message);
      console.error('Borrar.gs / ' + caja + ': ' + e.message);
    }
  });

  /* ---- 3) Carpetas de Drive: se reportan, NO se borran ---- */
  reporte.push('');
  reporte.push('--- CARPETAS DE DRIVE (BORRALAS TU A MANO SI QUIERES) ---');
  filas.forEach(function (r) {
    reporte.push(r.folio + '   ' + (r.ruta || 'sin carpeta registrada'));
  });

  var msg = reporte.join('\n') +
            '\n\nBorrados del Concentrado: ' + borradas.length + ' de ' + filas.length +
            '\nSi alguna caja salió con ERROR arriba, corre sincronizarTodo() y el flujo se limpia solo.';
  Logger.log(msg);
  return msg;
}


/* ============ Utilerias ============ */

/* Envuelve a cajaDe_() para que nunca truene: si no la puede
   determinar, regresa null en lugar de tirar la ejecución. */
function borrCajaDe_(sucursal) {
  try {
    return cajaDe_(sucursal) || null;
  } catch (e) {
    return null;
  }
}

function borrLeer_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SYNC.CENTRAL_CONCENTRADO);
  if (!sh) throw new Error('No se encontro la hoja "' + SYNC.CENTRAL_CONCENTRADO + '".');

  var mc = mapaFila_(sh, 1);
  var get = function (fila, nombre) {
    var c = mc[nombre];
    return c ? fila[c - 1] : '';
  };

  var datos = sh.getDataRange().getValues();
  var porFolio = {};

  for (var r = 1; r < datos.length; r++) {
    var fila = datos[r];
    var folio = String(get(fila, SYNC.C_FOLIO) || '').trim();
    if (!folio) continue;

    porFolio[folio.toUpperCase()] = {
      fila: r + 1,
      folio: folio,
      sucursal: String(get(fila, SYNC.C_SUCURSAL) || '').trim(),
      aplica: String(get(fila, 'Sucursales del Gasto') || '').trim(),
      colaborador: String(get(fila, 'Colaborador') || '').trim(),
      importe: get(fila, SYNC.C_IMPORTE),
      impComp: (function () {
        var v = get(fila, SYNC.C_IMPORTE_COMP);
        return (v === '' || v == null) ? '' : v;
      })(),
      estatus: String(get(fila, SYNC.C_ESTATUS_AUT) || '').trim(),
      entrega: String(get(fila, 'Entrega Efectivo') || '').trim(),
      ruta: String(get(fila, SYNC.C_RUTA) || '').trim()
    };
  }

  return { hoja: sh, mapa: mc, porFolio: porFolio };
}

function borrNum_(v) {
  var n = Number(v);
  if (isNaN(n)) return String(v || '');
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}