/**********************************************************************
 * Recomprobar.gs — Deja un folio LISTO PARA COMPROBAR OTRA VEZ.
 *
 * Sirve cuando subieron el comprobante equivocado o capturaron mal el
 * monto comprobado.
 *
 * QUE LIMPIA (Concentrado):
 *   Importe Comprobado, Fecha de Comprobacion, Estatus Comprobación,
 *   Ruta Evidencia, Diferencia, Miniatura, Tipo de comprobante, Factura No.
 *
 * QUE NO TOCA:
 *   Entrega Efectivo  -> el dinero sí salió, el egreso se queda en la caja
 *   Estatus Autorizacion -> sigue Autorizado
 *   Importe (autorizado) -> no cambia
 *
 * TAMBIEN limpia en el archivo de la caja (pestaña EGRESOS):
 *   MONTO COMPROBADO, RUTA DEL COMPROBANTE, COMPROBANTE
 *   y regresa MONTO al monto autorizado.
 *
 * NO borra nada de Drive: te reporta las carpetas para que tú saques
 * las fotos equivocadas a mano.
 *
 * ORDEN PARA CORRER:
 *   1) verRecomprobar()      -> NO cambia nada, solo te muestra
 *   2) recomprobarFolios()   -> limpia
 *   3) sincronizarTodo()
 **********************************************************************/

var RECOMP_LISTA = [
  'CC-CDS-2026-001510',
];

// Columnas del Concentrado que se limpian
var RECOMP_COLS_LIMPIAR = [
  'Importe Comprobado',
  'Fecha de Comprobacion',
  'Estatus Comprobación',
  'Ruta Evidencia',
  'Diferencia',
  'Miniatura',
  'Tipo de comprobante',
  'Factura No. '          // ojo: lleva un espacio al final, tal como está en la hoja
];


/* ============ PASO 1: solo mirar ============ */
function verRecomprobar() {
  var d = recompLeer_();
  var txt = 'FOLIOS A DEJAR PENDIENTES POR COMPROBAR: ' + RECOMP_LISTA.length + '\n';
  txt += '============================================================\n\n';

  var noExisten = [];

  RECOMP_LISTA.forEach(function (f) {
    var k = String(f).trim().toUpperCase();
    var r = d.porFolio[k];
    if (!r) { noExisten.push(f); return; }

    txt += '### ' + r.folio + '   (fila ' + r.fila + ')\n';
    txt += '    Caja que paga ......... ' + (r.sucursal || '(vacio)') + '\n';
    txt += '    Colaborador ........... ' + (r.colaborador || '(vacio)') + '\n';
    txt += '    Importe autorizado .... $' + recompNum_(r.importe) + '\n';
    txt += '    SE VA A BORRAR:\n';
    RECOMP_COLS_LIMPIAR.forEach(function (c) {
      if (d.mapa[c] == null) {
        txt += '      ' + c + ' -> (esa columna no existe en la hoja)\n';
        return;
      }
      var v = r.valores[c];
      txt += '      ' + c + ' = ' + (v === '' || v == null ? '(ya vacio)' : '"' + v + '"') + '\n';
    });
    txt += '    SE CONSERVA:\n';
    txt += '      Entrega Efectivo = ' + (r.entrega || '(no entregado)') + '\n';
    txt += '      Estatus Autorizacion = ' + (r.estatus || '(vacio)') + '\n';
    txt += '    Carpeta de evidencia (revisala a mano): ' + (r.ruta || '(sin carpeta)') + '\n\n';
  });

  if (noExisten.length) {
    txt += 'NO EXISTEN EN EL CONCENTRADO:\n' + noExisten.join('\n') + '\n';
  }

  Logger.log(txt);
  return txt;
}


/* ============ PASO 2: limpiar ============ */
function recomprobarFolios() {
  var d = recompLeer_();
  var sh = d.hoja;

  var objetivo = {};
  RECOMP_LISTA.forEach(function (f) {
    var k = String(f).trim().toUpperCase();
    if (d.porFolio[k]) objetivo[k] = d.porFolio[k];
  });

  var claves = Object.keys(objetivo);
  if (!claves.length) {
    var vacio = 'Ninguno de los folios existe en el Concentrado. No se cambió nada.';
    Logger.log(vacio);
    return vacio;
  }

  var reporte = ['--- CONCENTRADO ---'];

  claves.forEach(function (k) {
    var r = objetivo[k];
    var limpiadas = [];
    RECOMP_COLS_LIMPIAR.forEach(function (c) {
      var col = d.mapa[c];
      if (col == null) return;
      sh.getRange(r.fila, col).clearContent();
      limpiadas.push(c);
    });
    reporte.push(r.folio + '  (fila ' + r.fila + ')  limpiadas: ' + limpiadas.length);
  });

  /* ---- Archivos de caja: quitar lo comprobado del EGRESO ---- */
  reporte.push('');
  reporte.push('--- EGRESOS EN LOS ARCHIVOS DE CAJA ---');

  CAJAS.forEach(function (caja) {
    var fileId = fileIdDeCaja_(caja);
    if (!fileId) return;

    var eg;
    try {
      eg = SpreadsheetApp.openById(fileId).getSheetByName('EGRESOS');
    } catch (e) {
      reporte.push(caja + ': no se pudo abrir (' + e.message + ')');
      return;
    }
    if (!eg) return;

    var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
    var colFolio = me[SYNC.EG_FOLIO];
    if (!colFolio) return;

    var primera = SYNC.EG_HEADER_ROW + 1;
    var ultima = eg.getLastRow();
    if (ultima < primera) return;

    var folios = eg.getRange(primera, colFolio, ultima - primera + 1, 1).getValues();
    var tocados = [];

    for (var i = 0; i < folios.length; i++) {
      var fo = String(folios[i][0] || '').trim().toUpperCase();
      if (!fo || !objetivo[fo]) continue;

      var fila = primera + i;
      var autorizado = objetivo[fo].importe;

      // Monto comprobado: se vacia
      if (me[SYNC.EG_MONTO_COMPROBADO]) {
        eg.getRange(fila, me[SYNC.EG_MONTO_COMPROBADO]).clearContent();
      }
      // Monto final: regresa al autorizado
      if (me[SYNC.EG_MONTO]) {
        eg.getRange(fila, me[SYNC.EG_MONTO]).setValue(Number(autorizado) || 0);
      }
      // Ruta y miniatura del comprobante: se vacian
      if (me[SYNC.EG_RUTA]) {
        eg.getRange(fila, me[SYNC.EG_RUTA]).clearContent();
      }
      if (me[SYNC.EG_COMPROBANTE]) {
        eg.getRange(fila, me[SYNC.EG_COMPROBANTE]).clearContent();
      }

      tocados.push(fo + ' -> monto $' + recompNum_(autorizado));
    }

    if (tocados.length) reporte.push(caja + ': ' + tocados.join('  |  '));
  });

  /* ---- Drive: solo se reporta ---- */
  reporte.push('');
  reporte.push('--- CARPETAS DE DRIVE (SACA TU LAS FOTOS EQUIVOCADAS) ---');
  claves.forEach(function (k) {
    var r = objetivo[k];
    reporte.push(r.folio + '   ' + (r.ruta || 'sin carpeta registrada'));
  });

  var msg = reporte.join('\n') +
            '\n\nLISTO. Estos folios ya vuelven a aparecer en "Folio a comprobar".' +
            '\nAHORA CORRE:  sincronizarTodo()';
  Logger.log(msg);
  return msg;
}


/* ============ Utilerias ============ */
function recompLeer_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SYNC.CENTRAL_CONCENTRADO);
  if (!sh) throw new Error('No se encontro la hoja "' + SYNC.CENTRAL_CONCENTRADO + '".');

  var mc = mapaFila_(sh, 1);
  var datos = sh.getDataRange().getValues();
  var porFolio = {};

  var lee = function (fila, nombre) {
    var c = mc[nombre];
    return c ? fila[c - 1] : '';
  };

  for (var r = 1; r < datos.length; r++) {
    var fila = datos[r];
    var folio = String(lee(fila, SYNC.C_FOLIO) || '').trim();
    if (!folio) continue;

    var valores = {};
    RECOMP_COLS_LIMPIAR.forEach(function (c) {
      valores[c] = mc[c] ? fila[mc[c] - 1] : '';
    });

    porFolio[folio.toUpperCase()] = {
      fila: r + 1,
      folio: folio,
      sucursal: String(lee(fila, SYNC.C_SUCURSAL) || '').trim(),
      colaborador: String(lee(fila, 'Colaborador') || '').trim(),
      importe: lee(fila, SYNC.C_IMPORTE),
      entrega: String(lee(fila, 'Entrega Efectivo') || '').trim(),
      estatus: String(lee(fila, SYNC.C_ESTATUS_AUT) || '').trim(),
      ruta: String(lee(fila, SYNC.C_RUTA) || '').trim(),
      valores: valores
    };
  }

  return { hoja: sh, mapa: mc, porFolio: porFolio };
}

function recompNum_(v) {
  var n = Number(v);
  if (isNaN(n)) return String(v || '');
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}