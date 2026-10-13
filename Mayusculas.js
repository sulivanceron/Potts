/**********************************************************************
 * Mayusculas.gs — PASA A MAYÚSCULAS LO QUE YA ESTÁ CAPTURADO
 *
 * El cambio que hicimos en registrarSolicitud() aplica de aquí en
 * adelante. Esto es para lo VIEJO: recorre el Concentrado y pasa a
 * mayúsculas tres cosas:
 *
 *   Colaborador                 -> completo
 *   Descripcion Subconcepto     -> completo
 *   Observaciones               -> SOLO la parte del proveedor
 *
 * Lo de Observaciones va con cuidado a propósito: esa columna también
 * guarda notas de comprobación y de cancelación ("Comprobación: se pagó
 * con ticket", "CANCELADO. Importe original: $..."). Esas NO se tocan.
 * Solo se sube a mayúsculas lo que está entre "Proveedor:" y el primer
 * separador "|".
 *
 * SE ESCRIBE CELDA POR CELDA, no en bloque. El Concentrado tiene
 * imágenes dentro de celdas (la columna Miniatura) y una escritura en
 * bloque sobre esta hoja truena con "Service error: Spreadsheets".
 * Es el mismo motivo por el que quitarSevero() está hecho así.
 *
 * Se detiene sola antes del corte de 6 minutos y GUARDA POR DÓNDE SE
 * QUEDÓ. Si te dice que faltan filas, vuelve a correr la MISMA función
 * y sigue desde ahí.
 *
 * ORDEN PARA CORRER:
 *   1) verMayusculasPendientes()      -> NO cambia nada, solo cuenta
 *   2) pasarAMayusculasConcentrado()  -> lo aplica (repetir si hace falta)
 *   3) reiniciarAvanceMayusculas()    -> solo si quieres empezar de cero
 **********************************************************************/

var MAY_LIMITE_MS   = 4.5 * 60 * 1000;   // se detiene antes del corte de 6 min
var MAY_PROP_AVANCE = 'MAY_AVANCE_CONCENTRADO';


/** Sube a mayúsculas SOLO el nombre del proveedor dentro de Observaciones.
 *  Conserva los espacios y todo lo que venga después del "|". */
function solMayusProveedor_(observaciones) {
  var t = String(observaciones == null ? '' : observaciones);
  if (!t) return t;
  return t.replace(/(Proveedor:\s*)([^|]*?)(\s*)(?=\||$)/i, function (todo, etiqueta, valor, cola) {
    return etiqueta + solMayus_(valor) + cola;
  });
}


/** Lee el Concentrado y arma la lista de celdas que habría que cambiar. */
function mayRevisar_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  if (!sh) throw new Error('No se encontró la hoja "' + SOL.HOJA_CONCENTRADO + '".');

  var last = sh.getLastRow();
  if (last < 2) return { sh: sh, cambios: [], filas: 0 };

  var map = mapaColumnas_(sh);
  var cColab = map[SOL.COL_COLABORADOR];
  var cDesc  = map[SOL.COL_SUBCONCEPTO];
  var cObs   = map[SOL.COL_OBSERV];

  var faltan = [];
  if (cColab == null) faltan.push(SOL.COL_COLABORADOR);
  if (cDesc  == null) faltan.push(SOL.COL_SUBCONCEPTO);
  if (cObs   == null) faltan.push(SOL.COL_OBSERV);
  if (faltan.length === 3) {
    throw new Error('No encontré ninguna de las columnas: ' + faltan.join(', '));
  }

  var n = last - 1;
  // Se leen SOLO las tres columnas que interesan, nunca la de imágenes.
  var colab = (cColab != null) ? sh.getRange(2, cColab + 1, n, 1).getDisplayValues() : null;
  var desc  = (cDesc  != null) ? sh.getRange(2, cDesc  + 1, n, 1).getDisplayValues() : null;
  var obs   = (cObs   != null) ? sh.getRange(2, cObs   + 1, n, 1).getDisplayValues() : null;

  var cambios = [];
  for (var i = 0; i < n; i++) {
    var fila = i + 2;

    if (colab) {
      var v1 = String(colab[i][0] || '');
      var n1 = solMayus_(v1);
      if (v1 && n1 !== v1) cambios.push({ fila: fila, col: cColab + 1, antes: v1, ahora: n1, que: 'Colaborador' });
    }
    if (desc) {
      var v2 = String(desc[i][0] || '');
      var n2 = solMayus_(v2);
      if (v2 && n2 !== v2) cambios.push({ fila: fila, col: cDesc + 1, antes: v2, ahora: n2, que: 'Descripción' });
    }
    if (obs) {
      var v3 = String(obs[i][0] || '');
      var n3 = solMayusProveedor_(v3);
      if (v3 && n3 !== v3) cambios.push({ fila: fila, col: cObs + 1, antes: v3, ahora: n3, que: 'Proveedor' });
    }
  }

  return { sh: sh, cambios: cambios, filas: n };
}


/** PASO 1 — solo mira. No cambia absolutamente nada. */
function verMayusculasPendientes() {
  var d = mayRevisar_();
  var hecho = Number(PropertiesService.getScriptProperties().getProperty(MAY_PROP_AVANCE) || 0);

  var porTipo = { Colaborador: 0, 'Descripción': 0, Proveedor: 0 };
  d.cambios.forEach(function (c) { porTipo[c.que] = (porTipo[c.que] || 0) + 1; });

  var out = ['MAYÚSCULAS PENDIENTES EN EL CONCENTRADO',
             '============================================================',
             'Filas revisadas: ' + d.filas,
             'Celdas por cambiar: ' + d.cambios.length,
             '   Colaborador ..... ' + porTipo.Colaborador,
             '   Descripción ..... ' + porTipo['Descripción'],
             '   Proveedor ....... ' + porTipo.Proveedor,
             ''];

  if (hecho) out.push('Ya procesadas en corridas anteriores: ' + hecho + '\n');

  if (!d.cambios.length) {
    out.push('Ya está todo en mayúsculas. No hay nada que hacer.');
  } else {
    out.push('EJEMPLOS (los primeros 10):');
    d.cambios.slice(0, 10).forEach(function (c) {
      out.push('  fila ' + c.fila + ' · ' + c.que);
      out.push('      antes: ' + c.antes);
      out.push('      ahora: ' + c.ahora);
    });
    out.push('');
    out.push('Si se ve bien, corre pasarAMayusculasConcentrado().');
  }

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}


/** PASO 2 — lo aplica. Se puede repetir hasta que diga TERMINADO. */
function pasarAMayusculasConcentrado() {
  var INICIO = new Date().getTime();
  var props = PropertiesService.getScriptProperties();

  var d = mayRevisar_();
  if (!d.cambios.length) {
    props.deleteProperty(MAY_PROP_AVANCE);
    var ya = 'Ya está todo en mayúsculas. No se cambió nada.';
    Logger.log(ya);
    return ya;
  }

  var hechas = 0, errores = [];
  var i = 0;

  for (; i < d.cambios.length; i++) {
    if (new Date().getTime() - INICIO > MAY_LIMITE_MS) break;
    var c = d.cambios[i];
    try {
      // CELDA POR CELDA: la hoja tiene imágenes y las escrituras en
      // bloque truenan con "Service error: Spreadsheets".
      d.sh.getRange(c.fila, c.col).setValue(c.ahora);
      hechas++;
    } catch (e) {
      errores.push('fila ' + c.fila + ' · ' + c.que + ' -> ' + e.message);
    }
  }

  SpreadsheetApp.flush();

  var acumulado = Number(props.getProperty(MAY_PROP_AVANCE) || 0) + hechas;
  var termino = (i >= d.cambios.length);
  if (termino) props.deleteProperty(MAY_PROP_AVANCE);
  else props.setProperty(MAY_PROP_AVANCE, String(acumulado));

  var msg = 'MAYÚSCULAS APLICADAS\n';
  msg += '============================================================\n';
  msg += 'Celdas cambiadas en esta corrida: ' + hechas + '\n';
  msg += 'Total acumulado: ' + acumulado + '\n';
  if (errores.length) msg += '\nERRORES (' + errores.length + '):\n' + errores.join('\n') + '\n';
  msg += termino
    ? '\n*** TERMINADO. Ya no queda nada pendiente. ***'
    : '\n*** FALTAN ' + (d.cambios.length - i) + ' CELDAS. Vuelve a correr la MISMA función. ***';

  Logger.log(msg);
  return msg;
}


/** Reinicia el contador de avance. No deshace nada, solo el conteo. */
function reiniciarAvanceMayusculas() {
  PropertiesService.getScriptProperties().deleteProperty(MAY_PROP_AVANCE);
  return 'Contador de avance reiniciado.';
}