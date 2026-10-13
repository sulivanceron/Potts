/**********************************************************************
 * Correccion.gs — Arregla los folios donde se capturó mal la CAJA QUE PAGA.
 *
 * El dinero salió de CEDIS SAN PABLO, pero en el Concentrado quedó otra
 * sucursal en la columna "Sucursal", por eso el egreso se está bajando
 * al archivo de flujo equivocado.
 *
 * ORDEN PARA CORRER (uno por uno, en este orden):
 *   1) paso1_verQueSeVaAMover()      -> NO cambia nada, solo te muestra
 *   2) paso2_moverCajaQuePaga()      -> hace el cambio en el Concentrado
 *   3) paso3_limpiarEgresosViejos()  -> borra los egresos que quedaron
 *                                       colgados en la caja equivocada
 *   4) sincronizarTodo()             -> vuelve a bajar todo correcto
 *
 * Extra: paso0_verTodosLosFolios() te lista TODO agrupado por caja que
 * paga, por si más adelante aparecen otros mal capturados.
 **********************************************************************/

/* ============ LOS FOLIOS QUE HAY QUE ARREGLAR ============
   Estos son los de tu captura. Se van a pasar a CEDIS SAN PABLO y su
   sucursal original se guarda en "Sucursales del Gasto".

   NO va CC-HAM-2026-000001: Hamburgo ya se rutea solo a CEDIS SAN PABLO.
   NO va CC-GDL-2026-000004: ese sí es de Guadalajara (está más abajo
   como excepción).                                                     */
var CORR_FOLIOS = [
  'CC-SP2-2026-000002',
  'CC-SP2-2026-000003',
  'CC-RC2-2026-000002',
  'CC-SP2-2026-000004',
  'CC-BR1-2026-000003',
  'CC-GDL-2026-000003',
  'CC-GDL-2026-000005',
  'CC-SP2-2026-000005'
];

/* Si algún día quieres corregir POR BULTO en lugar de por folio, vacía
   CORR_FOLIOS (déjalo así: var CORR_FOLIOS = [];) y usa esta lista.
   Mientras CORR_FOLIOS tenga algo, esta se ignora por completo. */
var CORR_SUCURSALES_MAL = [
  'GUADALAJARA'
];

// La caja que REALMENTE pagó
var CORR_CAJA_REAL = 'CEDIS SAN PABLO';

// Folios que NO se deben mover nunca, aunque caigan en las reglas de arriba
var CORR_EXCEPCIONES = [
  'CC-GDL-2026-000004'
];


/* ============ PASO 0 (opcional): ver todo el panorama ============ */
function paso0_verTodosLosFolios() {
  var d = corrLeerConcentrado_();

  var porSuc = {};
  d.filas.forEach(function (f) {
    var k = f.sucursal || '(sin sucursal)';
    if (!porSuc[k]) porSuc[k] = [];
    porSuc[k].push(f);
  });

  var txt = 'FOLIOS AGRUPADOS POR CAJA QUE PAGA (columna Sucursal)\n';
  txt += '============================================================\n\n';

  Object.keys(porSuc).sort().forEach(function (k) {
    txt += '### ' + k + '   (' + porSuc[k].length + ' folios)\n';
    porSuc[k].forEach(function (f) {
      txt += "  '" + f.folio + "',   $" + corrNum_(f.importe) +
             '   gasto de: ' + (f.aplica || '(vacio)') + '\n';
    });
    txt += '\n';
  });

  Logger.log(txt);
  corrAlerta_('PASO 0 — PANORAMA', txt);
  return txt;
}


/* ============ PASO 1: solo mirar, no cambia nada ============ */
function paso1_verQueSeVaAMover() {
  var d = corrLeerConcentrado_();
  var mueve = [], excep = [];

  d.filas.forEach(function (f) {
    if (!corrAplicaRegla_(f)) return;
    if (corrEsExcepcion_(f.folio)) { excep.push(f); return; }
    mueve.push(f);
  });

  var modo = (CORR_FOLIOS.length > 0)
    ? 'MODO LISTA DE FOLIOS (' + CORR_FOLIOS.length + ' en la lista)'
    : 'MODO POR SUCURSAL (' + CORR_SUCURSALES_MAL.join(', ') + ')';

  var txt = modo + '\n\n';
  txt += 'SE VAN A MOVER A ' + CORR_CAJA_REAL + ':  (' + mueve.length + ' folios)\n';
  txt += '------------------------------------------------------------\n';
  mueve.forEach(function (f) {
    txt += f.folio + '   paga hoy: ' + f.sucursal +
           '   $' + corrNum_(f.importe) +
           '   gasto de: ' + (f.aplica || '(vacio -> se pondra ' + f.sucursal + ')') + '\n';
  });

  txt += '\nNO SE TOCAN (excepciones):  (' + excep.length + ')\n';
  txt += '------------------------------------------------------------\n';
  excep.forEach(function (f) {
    txt += f.folio + '   ' + f.sucursal + '   $' + corrNum_(f.importe) + '\n';
  });

  // Aviso si algun folio de la lista no se encontro o ya esta bien
  if (CORR_FOLIOS.length > 0) {
    var enConc = {}, seMueve = {};
    d.filas.forEach(function (f) { enConc[f.folio.toUpperCase()] = f; });
    mueve.forEach(function (f) { seMueve[f.folio.toUpperCase()] = true; });

    var noExisten = [], yaEstaban = [];
    CORR_FOLIOS.forEach(function (x) {
      var k = String(x).trim().toUpperCase();
      if (!enConc[k]) { noExisten.push(x); return; }
      if (!seMueve[k] && !corrEsExcepcion_(x)) {
        yaEstaban.push(x + '  (ya paga ' + enConc[k].sucursal + ')');
      }
    });

    if (noExisten.length) {
      txt += '\nOJO — no existen en el Concentrado:\n' + noExisten.join('\n') + '\n';
    }
    if (yaEstaban.length) {
      txt += '\nYa estaban bien, no hace falta moverlos:\n' + yaEstaban.join('\n') + '\n';
    }
  }

  Logger.log(txt);
  corrAlerta_('PASO 1 — REVISION', txt);
  return txt;
}


/* ============ PASO 2: hace el cambio ============ */
function paso2_moverCajaQuePaga() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conc = ss.getSheetByName(SYNC.CENTRAL_CONCENTRADO);
  if (!conc) throw new Error('No se encontro la hoja "' + SYNC.CENTRAL_CONCENTRADO + '".');

  var mc = mapaFila_(conc, 1);
  var colSuc = mc[SYNC.C_SUCURSAL];
  var colFolio = mc[SYNC.C_FOLIO];
  if (!colSuc || !colFolio) throw new Error('Faltan las columnas Folio o Sucursal en el Concentrado.');

  var colAplica = mc['Sucursales del Gasto'] || mc['Sucursales del gasto'] || null;
  var colImp = mc[SYNC.C_IMPORTE];

  var datos = conc.getDataRange().getValues();
  var movidos = [], sinTocar = 0;

  for (var r = 1; r < datos.length; r++) {
    var folio = String(datos[r][colFolio - 1] || '').trim();
    if (!folio) continue;

    var f = {
      folio: folio,
      sucursal: String(datos[r][colSuc - 1] || '').trim(),
      importe: colImp ? datos[r][colImp - 1] : '',
      aplica: colAplica ? String(datos[r][colAplica - 1] || '').trim() : ''
    };

    if (!corrAplicaRegla_(f)) continue;
    if (corrEsExcepcion_(folio)) { sinTocar++; continue; }

    // 1) Guardar a quien PERTENECE el gasto. Si esta vacio, era la sucursal
    //    que estaba capturada como caja que paga.
    if (colAplica && !f.aplica) {
      conc.getRange(r + 1, colAplica).setValue(f.sucursal);
    }

    // 2) Corregir la caja que paga
    conc.getRange(r + 1, colSuc).setValue(CORR_CAJA_REAL);
    movidos.push(folio + '   (antes: ' + f.sucursal + ')');
  }

  var msg = 'Folios movidos a ' + CORR_CAJA_REAL + ': ' + movidos.length + '\n\n' +
            movidos.join('\n') +
            '\n\nSe respetaron (excepciones): ' + sinTocar +
            '\n\nAHORA CORRE:  paso3_limpiarEgresosViejos()';
  Logger.log(msg);
  corrAlerta_('PASO 2 — LISTO', msg);
  return msg;
}


/* ============ PASO 3: limpiar egresos colgados ============ */
/* Recorre TODAS las cajas y borra de su pestaña EGRESOS los folios que,
   segun el Concentrado, ya no le corresponden a esa caja.
   Los folios que NO existen en el Concentrado se dejan intactos
   (pueden ser capturas manuales de la caja).                            */
function paso3_limpiarEgresosViejos() {
  var d = corrLeerConcentrado_();

  var destino = {};
  d.filas.forEach(function (f) {
    if (!f.folio) return;
    var caja = cajaDe_(f.sucursal);
    if (caja) destino[f.folio.toUpperCase()] = normalizarTexto(caja);
  });

  var reporte = [];

  CAJAS.forEach(function (caja) {
    var fileId = fileIdDeCaja_(caja);
    if (!fileId) { reporte.push(caja + ': sin archivo registrado, se omite'); return; }

    var eg;
    try {
      eg = SpreadsheetApp.openById(fileId).getSheetByName('EGRESOS');
    } catch (e) {
      reporte.push(caja + ': no se pudo abrir el archivo (' + e.message + ')');
      return;
    }
    if (!eg) { reporte.push(caja + ': no tiene pestaña EGRESOS'); return; }

    var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
    var colFolio = me[SYNC.EG_FOLIO];
    if (!colFolio) { reporte.push(caja + ': no tiene columna Folio en EGRESOS'); return; }

    var primera = SYNC.EG_HEADER_ROW + 1;
    var ultima = eg.getLastRow();
    if (ultima < primera) { reporte.push(caja + ': sin egresos'); return; }

    var folios = eg.getRange(primera, colFolio, ultima - primera + 1, 1).getValues();
    var yo = normalizarTexto(caja);
    var borrados = [];

    for (var i = folios.length - 1; i >= 0; i--) {
      var fo = String(folios[i][0] || '').trim();
      if (!fo) continue;
      var dst = destino[fo.toUpperCase()];
      if (!dst) continue;              // no esta en el Concentrado: no se toca
      if (dst === yo) continue;        // le corresponde a esta caja: se queda
      eg.deleteRow(primera + i);
      borrados.push(fo);
    }

    reporte.push(caja + ': borrados ' + borrados.length +
                 (borrados.length ? ('  -> ' + borrados.join(', ')) : ''));
  });

  var msg = reporte.join('\n') + '\n\nAHORA CORRE:  sincronizarTodo()';
  Logger.log(msg);
  corrAlerta_('PASO 3 — LISTO', msg);
  return msg;
}


/* ====================== Utilerias internas ====================== */

/* Decide si una fila del Concentrado entra en la correccion */
function corrAplicaRegla_(f) {
  // Nunca mover lo que ya paga la caja correcta
  if (normalizarTexto(f.sucursal) === normalizarTexto(CORR_CAJA_REAL)) return false;

  // Nunca mover lo que ya se rutea solo a la caja correcta (ej. HAMBURGO)
  var cajaHoy = cajaDe_(f.sucursal);
  if (cajaHoy && normalizarTexto(cajaHoy) === normalizarTexto(CORR_CAJA_REAL)) return false;

  if (CORR_FOLIOS.length > 0) {
    var fo = String(f.folio).trim().toUpperCase();
    return CORR_FOLIOS.some(function (x) {
      return String(x).trim().toUpperCase() === fo;
    });
  }

  return CORR_SUCURSALES_MAL.some(function (s) {
    return normalizarTexto(s) === normalizarTexto(f.sucursal);
  });
}

function corrLeerConcentrado_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conc = ss.getSheetByName(SYNC.CENTRAL_CONCENTRADO);
  if (!conc) throw new Error('No se encontro la hoja "' + SYNC.CENTRAL_CONCENTRADO + '".');

  var mc = mapaFila_(conc, 1);
  var colFolio = mc[SYNC.C_FOLIO];
  var colSuc = mc[SYNC.C_SUCURSAL];
  var colImp = mc[SYNC.C_IMPORTE];
  var colAplica = mc['Sucursales del Gasto'] || mc['Sucursales del gasto'] || null;

  var datos = conc.getDataRange().getValues();
  var filas = [];
  for (var r = 1; r < datos.length; r++) {
    var folio = String(datos[r][colFolio - 1] || '').trim();
    if (!folio) continue;
    filas.push({
      fila: r + 1,
      folio: folio,
      sucursal: String(datos[r][colSuc - 1] || '').trim(),
      importe: colImp ? datos[r][colImp - 1] : '',
      aplica: colAplica ? String(datos[r][colAplica - 1] || '').trim() : ''
    });
  }
  return { hoja: conc, mapa: mc, filas: filas };
}

function corrEsExcepcion_(folio) {
  var f = String(folio || '').trim().toUpperCase();
  return CORR_EXCEPCIONES.some(function (x) { return String(x).trim().toUpperCase() === f; });
}

function corrNum_(v) {
  var n = Number(v);
  if (isNaN(n)) return String(v || '');
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function corrAlerta_(titulo, texto) {
  try {
    var t = texto.length > 1200 ? texto.substring(0, 1200) + '\n...(ver el Registro de ejecucion)' : texto;
    SpreadsheetApp.getUi().alert(titulo + '\n\n' + t);
  } catch (e) { /* si corre sin interfaz, queda en el Logger */ }
}