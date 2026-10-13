/**********************************************************************
 * Duplicados.gs — Quita folios repetidos de la pestaña EGRESOS.
 *
 * CAMBIO 10-sept-2026 — EL CRITERIO.
 * Antes conservaba SIEMPRE la primera aparición. Eso resultó peligroso:
 * cuando el script duplica un folio, la primera copia es la VIEJA (con
 * la fecha de autorización y sin comprobación) y la de abajo es la
 * NUEVA y correcta. Conservar la primera dejaba los renglones malos y
 * borraba los buenos.
 *
 * Ahora decide comparando contra el Concentrado, en este orden:
 *   1) Se queda la copia cuya FECHA es igual a la "Fecha solicitud"
 *      del Concentrado. Esa es la buena, sin importar dónde esté.
 *   2) Si ninguna coincide, la que tenga MONTO COMPROBADO lleno.
 *   3) Si siguen empatando, la de más abajo (la última que escribió
 *      el script).
 *
 * CORRER:
 *   1) verDuplicadosCSP()      -> NO cambia nada
 *   2) quitarDuplicadosCSP()   -> borra las filas de sobra
 **********************************************************************/

var DUP_CAJA = 'CEDIS SAN PABLO';


function verDuplicadosCSP()    { return dupProcesar_(false); }
function quitarDuplicadosCSP() { return dupProcesar_(true);  }


function dupProcesar_(borrar) {
  var fileId = fileIdDeCaja_(DUP_CAJA);
  if (!fileId) throw new Error('No está registrado el archivo de ' + DUP_CAJA + '.');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone() || 'America/Mexico_City';
  var dia = function (v) {
    if (!(v instanceof Date) || isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  };
  var verFecha = function (v) {
    return dia(v) ? Utilities.formatDate(v, tz, 'dd/MM/yyyy') : '(sin fecha)';
  };

  /* ---- la verdad viene del Concentrado: Fecha solicitud por folio ---- */
  var conc = ss.getSheetByName(SYNC.CENTRAL_CONCENTRADO);
  if (!conc) throw new Error('No se encontró la hoja "' + SYNC.CENTRAL_CONCENTRADO + '".');
  var mc = mapaFila_(conc, 1);
  var cFolioC = mc[SYNC.C_FOLIO], cFechaC = mc[SYNC.C_FECHA_SOL];
  if (!cFolioC || !cFechaC) throw new Error('Faltan Folio o Fecha solicitud en el Concentrado.');

  var datosC = conc.getDataRange().getValues();
  var solicitud = {};
  for (var r = 1; r < datosC.length; r++) {
    var fo = String(datosC[r][cFolioC - 1] || '').trim().toUpperCase();
    if (fo) solicitud[fo] = dia(datosC[r][cFechaC - 1]);
  }

  /* ---- EGRESOS del flujo ---- */
  var eg = SpreadsheetApp.openById(fileId).getSheetByName('EGRESOS');
  if (!eg) throw new Error('No hay pestaña EGRESOS en ' + DUP_CAJA + '.');

  var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
  var cFolio = me[SYNC.EG_FOLIO];
  var cFecha = me[SYNC.EG_FECHA];
  var cMonto = me[SYNC.EG_MONTO];
  var cComp  = me[SYNC.EG_MONTO_COMPROBADO];
  if (!cFolio) throw new Error('No hay columna Folio en EGRESOS.');
  if (!cFecha) throw new Error('No hay columna FECHA en EGRESOS.');

  var primera = SYNC.EG_HEADER_ROW + 1;
  var ultima = eg.getLastRow();
  if (ultima < primera) return 'Sin datos.';

  var n = ultima - primera + 1;
  var vals = eg.getRange(primera, 1, n, eg.getLastColumn()).getValues();

  var porFolio = {}, orden = [];
  for (var i = 0; i < n; i++) {
    var f = String(vals[i][cFolio - 1] || '').trim();
    if (!f) continue;
    var k = f.toUpperCase();
    if (!porFolio[k]) { porFolio[k] = []; orden.push(k); }
    porFolio[k].push({
      fila: primera + i,
      folio: f,
      fecha: vals[i][cFecha - 1],
      monto: cMonto ? (Number(vals[i][cMonto - 1]) || 0) : 0,
      comp: cComp ? String(vals[i][cComp - 1] || '').trim() : ''
    });
  }

  /* ---- decidir cuál se queda, folio por folio ---- */
  var aBorrar = [], lineas = [], suma = 0, nDup = 0;

  orden.forEach(function (k) {
    var arr = porFolio[k];
    if (arr.length < 2) return;
    nDup++;

    var esperada = solicitud[k] || '';
    var mejor = -1, razon = '';

    for (var j = 0; j < arr.length; j++) {
      if (esperada && dia(arr[j].fecha) === esperada) { mejor = j; razon = 'su fecha es la del Concentrado'; }
    }
    if (mejor === -1) {
      for (var j2 = 0; j2 < arr.length; j2++) {
        if (arr[j2].comp !== '') { mejor = j2; razon = 'es la única con monto comprobado'; }
      }
    }
    if (mejor === -1) { mejor = arr.length - 1; razon = 'es la más reciente'; }

    lineas.push('  ' + arr[0].folio +
                (esperada ? ('   ·   solicitud en Concentrado: ' + esperada)
                          : '   ·   (este folio no está en el Concentrado)'));
    arr.forEach(function (x, j) {
      var queda = (j === mejor);
      if (!queda) { aBorrar.push(x); suma += x.monto; }
      lineas.push('      ' + (queda ? 'SE QUEDA ' : 'SE BORRA ') +
                  'fila ' + x.fila +
                  '   ' + verFecha(x.fecha) +
                  '   $' + dupN_(x.monto) +
                  '   comprobado: ' + (x.comp !== '' ? '$' + dupN_(x.comp) : '(vacío)') +
                  (queda ? '   <-- ' + razon : ''));
    });
  });

  var txt = (borrar ? 'DUPLICADOS BORRADOS' : 'DUPLICADOS ENCONTRADOS (nada se cambió)') + '\n';
  txt += 'Caja: ' + DUP_CAJA + '   ·   filas de datos: ' + primera + ' a ' + ultima + '\n';
  txt += '============================================================\n';

  if (!aBorrar.length) {
    txt += 'No hay folios repetidos.\n';
    Logger.log(txt);
    return txt;
  }

  txt += lineas.join('\n') + '\n';
  txt += '\nFolios duplicados: ' + nDup + '\n';
  txt += 'Filas de sobra: ' + aBorrar.length + '\n';
  txt += 'MONTO QUE SE QUITA: $' + dupN_(suma) + '\n';

  if (borrar) {
    // De abajo hacia arriba, para que no se corran los números de fila
    aBorrar.sort(function (a, b) { return b.fila - a.fila; });
    aBorrar.forEach(function (x) { eg.deleteRow(x.fila); });
    txt += '\nLISTO. Ahora vuelve a correr radiografiaEgresosCSP() para confirmar.\n';
  } else {
    txt += '\nRevisa que cada "SE QUEDA" sea el de la fecha correcta.\n';
    txt += 'Si se ve bien, corre quitarDuplicadosCSP().\n';
  }

  Logger.log(txt);
  return txt;
}


function dupN_(v) {
  var n = Number(v);
  if (isNaN(n)) return String(v || '');
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}