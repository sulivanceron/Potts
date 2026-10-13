/**********************************************************************
 * FechaEgreso.gs — Cambia la "Fecha solicitud" de folios específicos,
 * para que el egreso caiga en el día en que el efectivo SALIÓ de la caja.
 *
 * Después de correrlo hay que correr s-incronizarTodo() para que la fecha
 * baje a EGRESOS y el RESUMEN DIARIO se reacomode.
 *
 * CORRER:
 *   1) verCambioFechas()      -> NO cambia nada, te muestra el antes/después
 *   2) cambiarFechasFolios()  -> lo aplica
 **********************************************************************/

// Fecha a la que se van a mover. Formato: año, mes, día.
// OJO: el mes va de 1 a 12 aquí (el script ya lo ajusta internamente).
var FE_ANIO = 2026;
var FE_MES  = 10;
var FE_DIA  = 03;

var FE_FOLIOS = [
  'CC-CDS-2026-001363',
  'CC-CDS-2026-001364',
  'CC-CDS-2026-001365',
  'CC-CDS-2026-001366',
  'CC-CDS-2026-001367',
  'CC-CDS-2026-001368',
  'CC-CDS-2026-001369',
  'CC-CDS-2026-001370',
  'CC-CDS-2026-001371',
  'CC-CDS-2026-001372',
  'CC-CDS-2026-001373',
  'CC-CDS-2026-001374',
  'CC-CDS-2026-001375',
];


function verCambioFechas()     { return feProcesar_(false); }
function cambiarFechasFolios() { return feProcesar_(true);  }


function feProcesar_(aplicar) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SYNC.CENTRAL_CONCENTRADO);
  if (!sh) throw new Error('No se encontró la hoja "' + SYNC.CENTRAL_CONCENTRADO + '".');

  var mc = mapaFila_(sh, 1);
  var cFolio = mc[SYNC.C_FOLIO];
  var cFecha = mc[SYNC.C_FECHA_SOL];
  var cImp   = mc[SYNC.C_IMPORTE];
  var cEnt   = mc[SYNC.C_ENTREGA];
  if (!cFolio || !cFecha) throw new Error('Faltan las columnas Folio o Fecha solicitud.');

  var nueva = new Date(FE_ANIO, FE_MES - 1, FE_DIA, 12, 0, 0);
  var tz = ss.getSpreadsheetTimeZone() || 'America/Mexico_City';
  var fmt = function (v) {
    if (!(v instanceof Date) || isNaN(v.getTime())) return String(v || '(vacío)');
    return Utilities.formatDate(v, tz, 'dd/MM/yyyy');
  };

  var objetivo = {};
  FE_FOLIOS.forEach(function (f) { objetivo[String(f).trim().toUpperCase()] = true; });

  var datos = sh.getDataRange().getValues();
  var encontrados = {}, lineas = [], suma = 0;

  for (var r = 1; r < datos.length; r++) {
    var folio = String(datos[r][cFolio - 1] || '').trim();
    if (!folio) continue;
    var k = folio.toUpperCase();
    if (!objetivo[k]) continue;

    encontrados[k] = true;
    var antes = datos[r][cFecha - 1];
    var imp = cImp ? Number(datos[r][cImp - 1] || 0) : 0;
    suma += imp;

    lineas.push('  ' + folio + '   fila ' + (r + 1) +
                '   $' + feN_(imp) +
                '\n      Fecha solicitud:  ' + fmt(antes) + '  ->  ' + fmt(nueva) +
                (cEnt ? ('\n      Entrega efectivo: ' +
                         (String(datos[r][cEnt - 1] || '').trim() || '(no entregado)')) : ''));

    if (aplicar) sh.getRange(r + 1, cFecha).setValue(nueva);
  }

  var faltan = FE_FOLIOS.filter(function (f) {
    return !encontrados[String(f).trim().toUpperCase()];
  });

  var txt = (aplicar ? 'FECHAS CAMBIADAS' : 'REVISION (nada se cambió)') + '\n';
  txt += 'Fecha destino: ' + fmt(nueva) + '\n';
  txt += '============================================================\n';
  txt += lineas.length ? lineas.join('\n') + '\n' : '  Ningún folio de la lista se encontró.\n';
  txt += '\nFolios afectados: ' + lineas.length + '   ·   Importe total: $' + feN_(suma) + '\n';

  if (faltan.length) {
    txt += '\nNO EXISTEN EN EL CONCENTRADO:\n  ' + faltan.join('\n  ') + '\n';
  }

  txt += aplicar
    ? '\nLISTO. AHORA CORRE:  sincronizarTodo()\n'
    : '\nSi el antes/después se ve bien, corre cambiarFechasFolios().\n';

  Logger.log(txt);
  return txt;
}


function feN_(v) {
  var n = Number(v);
  if (isNaN(n)) return String(v || '');
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}