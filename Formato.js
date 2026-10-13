/**********************************************************************
 * Formato.gs — Deja toda la pestaña EGRESOS con el MISMO formato.
 *
 * Qué hace:
 *   1) Toma la fila de referencia (una que ya se ve bien) y copia SU
 *      FORMATO a todas las filas de datos. Los valores no se tocan.
 *   2) Quita el relleno de la columna COMPROBANTE (ver abajo).
 *   3) Convierte las fechas que quedaron como TEXTO ("2026-08-17") a
 *      fecha de verdad, para que se alineen y se vean 17/08/2026.
 *   4) Reaplica el formato de moneda a las columnas de monto y de
 *      número al AÑO.
 *   5) Iguala la altura de las filas.
 *
 * CAMBIO 15-sept-2026 — COLUMNA COMPROBANTE SIN COLOR:
 * el color que se veía en esa columna no estaba escrito en el código:
 * venía del formato de la fila de referencia (FM_FILA_REF), que el
 * copyTo reparte a las 700 filas. Ahora, después de copiar el formato,
 * se limpia el relleno de esa columna a propósito: la miniatura del
 * comprobante se ve mejor sobre blanco y así ya no depende de cómo esté
 * pintada la fila plantilla.
 *
 * CORRER:
 *   1) verFormatoEgresosCSP()       -> NO cambia nada, te dice qué encontró
 *   2) uniformarFormatoEgresosCSP() -> lo aplica
 **********************************************************************/

var FM_CAJA = 'CEDIS SAN PABLO';

// Fila que YA se ve bien. De ella se copia el formato a todas las demás.
// En tu pantalla la 112 se ve correcta (letra negra, 17/8/2026).
var FM_FILA_REF = 111;

// Altura de todas las filas de datos. Pon 0 si no quieres que las toque.
// 45 deja espacio para las miniaturas del comprobante.
var FM_ALTO = 21;

// La columna COMPROBANTE se deja SIEMPRE sin relleno.
// Ponlo en false si algún día quieres que herede el color de la plantilla.
var FM_COMPROBANTE_SIN_COLOR = true;


function verFormatoEgresosCSP()       { return fmProcesar_(false); }
function uniformarFormatoEgresosCSP() { return fmProcesar_(true);  }


function fmProcesar_(aplicar) {
  var fileId = fileIdDeCaja_(FM_CAJA);
  if (!fileId) throw new Error('No está registrado el archivo de ' + FM_CAJA + '.');

  var ss = SpreadsheetApp.openById(fileId);
  var eg = ss.getSheetByName('EGRESOS');
  if (!eg) throw new Error('No hay pestaña EGRESOS en ' + FM_CAJA + '.');

  var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
  var primera = SYNC.EG_HEADER_ROW + 1;
  var ultima = eg.getLastRow();
  var ancho = eg.getLastColumn();
  if (ultima < primera) return 'Sin datos en EGRESOS.';

  var n = ultima - primera + 1;
  var cFecha = me[SYNC.EG_FECHA];
  var cComp = me[SYNC.EG_COMPROBANTE];

  /* ---- Detectar fechas que son texto ---- */
  var textoFechas = [];
  if (cFecha) {
    var vals = eg.getRange(primera, cFecha, n, 1).getValues();
    for (var i = 0; i < n; i++) {
      var v = vals[i][0];
      if (v === '' || v == null) continue;
      if (v instanceof Date) continue;
      textoFechas.push({ fila: primera + i, valor: String(v) });
    }
  }

  var txt = (aplicar ? 'FORMATO UNIFORMADO' : 'REVISION DE FORMATO (nada se cambió)') + '\n';
  txt += 'Archivo: ' + ss.getName() + '\n';
  txt += 'Filas de datos: ' + primera + ' a ' + ultima + '   (' + n + ' filas)\n';
  txt += 'Fila de referencia: ' + FM_FILA_REF + '\n';
  txt += 'Columna COMPROBANTE sin color: ' + (FM_COMPROBANTE_SIN_COLOR ? 'sí' : 'no') +
         (cComp ? '' : '   (*** no encontré esa columna ***)') + '\n';
  txt += '============================================================\n';
  txt += 'Fechas guardadas como TEXTO: ' + textoFechas.length + '\n';
  if (textoFechas.length) {
    txt += '  ejemplos: ' + textoFechas.slice(0, 8).map(function (x) {
      return 'fila ' + x.fila + ' = "' + x.valor + '"';
    }).join('  |  ') + '\n';
  }

  if (FM_FILA_REF < primera || FM_FILA_REF > ultima) {
    txt += '\nOJO: la fila de referencia ' + FM_FILA_REF + ' está fuera del rango de datos.\n';
    txt += 'Cambia FM_FILA_REF por una fila que sí exista y que se vea bien.\n';
    Logger.log(txt);
    return txt;
  }

  if (!aplicar) {
    txt += '\nSi se ve bien, corre uniformarFormatoEgresosCSP().\n';
    Logger.log(txt);
    return txt;
  }

  /* ---- 1) Copiar el formato de la fila de referencia a todas ---- */
  eg.getRange(FM_FILA_REF, 1, 1, ancho)
    .copyTo(eg.getRange(primera, 1, n, ancho), { formatOnly: true });
  txt += '\nFormato copiado de la fila ' + FM_FILA_REF + ' a las ' + n + ' filas.';

  /* ---- 2) Columna COMPROBANTE sin relleno ----
     Va DESPUÉS del copyTo, porque el copyTo acaba de repartir el color
     que trae la fila plantilla. Aquí se le quita. */
  if (FM_COMPROBANTE_SIN_COLOR && cComp) {
    eg.getRange(primera, cComp, n, 1).setBackground(null);
    txt += '\nColumna COMPROBANTE: relleno quitado en las ' + n + ' filas.';
  }

  /* ---- 3) Convertir las fechas de texto a fecha real ---- */
  if (cFecha) {
    eg.getRange(primera, cFecha, n, 1).setNumberFormat('dd/mm/yyyy');
    var arregladas = 0;
    textoFechas.forEach(function (x) {
      var d = fmAFecha_(x.valor);
      if (!d) return;
      eg.getRange(x.fila, cFecha).setValue(d);
      arregladas++;
    });
    txt += '\nFechas convertidas de texto a fecha: ' + arregladas;
  }

  /* ---- 4) Formatos de número por columna ---- */
  var money = [SYNC.EG_MONTO, SYNC.EG_MONTO_AUTORIZADO, SYNC.EG_MONTO_COMPROBADO];
  money.forEach(function (nombre) {
    var c = me[nombre];
    if (c) eg.getRange(primera, c, n, 1).setNumberFormat('$#,##0.00');
  });
  if (me[SYNC.EG_ANIO]) eg.getRange(primera, me[SYNC.EG_ANIO], n, 1).setNumberFormat('0');
  txt += '\nMonedas y AÑO reformateados.';

  /* ---- 5) Altura de filas ---- */
  if (FM_ALTO > 0) {
    eg.setRowHeights(primera, n, FM_ALTO);
    txt += '\nAltura de filas igualada a ' + FM_ALTO + ' px.';
  }

  txt += '\n\nLISTO. Abre EGRESOS y revísalo.\n';
  Logger.log(txt);
  return txt;
}


/* Convierte "2026-08-17" o "17/08/2026" a Date. Devuelve null si no puede. */
function fmAFecha_(s) {
  var t = String(s || '').trim();
  var m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  var d = new Date(t);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/* ==========================================================================
   CORTES POR DÍA — un color ÚNICO para cada fecha
   --------------------------------------------------------------------------
   El color sale de la fecha misma y NO se repite: cada día del calendario
   recibe un color distinto. Se combinan dos cosas:
     - el matiz avanza 137 grados por día (137 y 360 no comparten divisores,
       así que la vuelta completa tarda 360 días);
     - la luminosidad alterna en tres niveles, para que el redondeo a color
       de pantalla no junte dos días parecidos.
   Resultado comprobado: 360 colores distintos en 360 días seguidos, sin una
   sola repetición, y días consecutivos bien diferenciados.

   Además:
     - el 10 de septiembre SIEMPRE tendrá el mismo color, hoy y en un mes;
     - si entran egresos nuevos o se reordenan filas, los colores no se
       recorren: cada fecha conserva el suyo.

   Se pinta en MONTO, MONTO AUTORIZADO y MONTO COMPROBADO (J, K y L).
   SOLO toca el color de fondo de esas tres columnas: no cambia valores, ni
   alturas de fila, ni formatos de número, ni ninguna otra columna.

   Se puede correr las veces que quieras: siempre da el mismo resultado.
   ========================================================================== */

var CD_CAJA = 'CEDIS SAN PABLO';

/* Qué tan vivos son los colores. Pensados como fondo: suaves, para que el
   número negro encima se siga leyendo bien.
     CD_SATURACION más alto  = más intensos
     CD_LUMINOSIDAD más alto = más claros                                 */
var CD_SATURACION  = 60;   // 0 a 100
var CD_LUMINOSIDAD = 83;   // 0 a 100

/* Grados que avanza el matiz por día. NO lo cambies por un número que
   divida a 360 (10, 12, 30, 45, 60, 90...) porque ahí sí se repetirían
   pronto. 137 es el que más separa un día del siguiente. */
var CD_PASO_GRADOS = 137;

/* Cuánto baja la luminosidad en el ciclo de tres. Es lo que evita que el
   redondeo junte dos días. */
var CD_PASO_LUZ = 4;

/* Columnas que se pintan. Si algún día quieres una más, agrégala aquí. */
var CD_COLUMNAS = ['MONTO', 'MONTO AUTORIZADO', 'MONTO COMPROBADO'];

/* Color de las filas sin fecha. '' las deja sin relleno. */
var CD_COLOR_SIN_FECHA = '';


/* Número de día continuo del calendario. */
function _cdNumeroDeDia_(d) {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

/* Color único que le toca a una fecha. */
function _cdColorDeFecha_(d) {
  var k = _cdNumeroDeDia_(d);
  var h = ((k * CD_PASO_GRADOS) % 360 + 360) % 360;
  var l = CD_LUMINOSIDAD - (((k % 3) + 3) % 3) * CD_PASO_LUZ;
  return _cdHslAHex_(h, CD_SATURACION, l);
}

/* Convierte matiz/saturación/luminosidad a un código #RRGGBB. */
function _cdHslAHex_(h, s, l) {
  h = h / 360; s = s / 100; l = l / 100;

  var r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    var hue2rgb = function (p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    var q = (l < 0.5) ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  var dos = function (x) {
    var v = Math.round(x * 255).toString(16);
    return (v.length === 1) ? ('0' + v) : v;
  };
  return '#' + dos(r) + dos(g) + dos(b);
}


function pintarCortesPorDiaCSP() {
  var fileId = fileIdDeCaja_(CD_CAJA);
  if (!fileId) throw new Error('No está registrado el archivo de ' + CD_CAJA + '.');

  var ss = SpreadsheetApp.openById(fileId);
  var eg = ss.getSheetByName('EGRESOS');
  if (!eg) throw new Error('No hay pestaña EGRESOS en ' + CD_CAJA + '.');

  var tz = ss.getSpreadsheetTimeZone() || 'America/Mexico_City';
  var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);

  var cFecha = me[SYNC.EG_FECHA];
  if (!cFecha) throw new Error('No encontré la columna "' + SYNC.EG_FECHA + '".');

  var primera = SYNC.EG_HEADER_ROW + 1;
  var ultima = eg.getLastRow();
  if (ultima < primera) return 'EGRESOS no tiene datos.';
  var n = ultima - primera + 1;

  /* ---- 1) A cada fila, el color único de SU fecha ---- */
  var fechas = eg.getRange(primera, cFecha, n, 1).getValues();

  var colores = [];
  var porDia = {};
  var sinFecha = 0;

  for (var i = 0; i < n; i++) {
    var v = fechas[i][0];

    if (!(v instanceof Date) || isNaN(v.getTime())) {
      sinFecha++;
      colores.push([CD_COLOR_SIN_FECHA]);
      continue;
    }

    var color = _cdColorDeFecha_(v);
    porDia[Utilities.formatDate(v, tz, 'yyyy-MM-dd')] = color;
    colores.push([color]);
  }

  /* ---- 2) Pintar, una columna a la vez ---- */
  var pintadas = [], faltantes = [];

  CD_COLUMNAS.forEach(function (nombre) {
    var c = me[nombre];
    if (!c) { faltantes.push(nombre); return; }
    eg.getRange(primera, c, n, 1).setBackgrounds(colores);
    pintadas.push(nombre + ' (columna ' + c + ')');
  });

  /* ---- 3) Reporte: color de cada día y aviso si algo se repitiera ---- */
  var dias = Object.keys(porDia).sort();
  var vistos = {}, repetidos = [];
  dias.forEach(function (d) {
    var c = porDia[d];
    if (vistos[c]) repetidos.push(d + ' y ' + vistos[c] + ' comparten ' + c);
    else vistos[c] = d;
  });

  var msg = 'CORTES POR DÍA — un color único por fecha — ' + CD_CAJA + '\n';
  msg += '============================================================\n';
  msg += 'Filas: ' + primera + ' a ' + ultima + '   (' + n + ')\n';
  msg += 'Días distintos: ' + dias.length + '\n';
  msg += 'Colores repetidos entre días: ' + repetidos.length + '\n';
  if (repetidos.length) msg += '   ' + repetidos.join('\n   ') + '\n';
  msg += 'Filas sin fecha (quedaron sin relleno): ' + sinFecha + '\n';
  msg += 'Columnas pintadas: ' + (pintadas.join(', ') || 'ninguna') + '\n';
  if (faltantes.length) {
    msg += '*** NO encontré estas columnas: ' + faltantes.join(', ') + ' ***\n';
  }

  msg += '\nCOLOR DE CADA DÍA:\n';
  dias.forEach(function (d) { msg += '  ' + d + '  ->  ' + porDia[d] + '\n'; });

  msg += '\nNo se tocó ningún valor, ni otras columnas, ni el alto de las filas.\n';

  Logger.log(msg);
  return msg;
}