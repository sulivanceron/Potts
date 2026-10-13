/**********************************************************************
 * OrdenarEgresos.gs — Acomoda la pestaña EGRESOS por FECHA, de la más
 * vieja a la más nueva. Solo reordena filas, no cambia ningún dato.
 *
 * Las miniaturas del comprobante viajan con su fila, no se pierden.
 *
 * CORRER cuando quieras:  ordenarEgresosPorFechaCSP()
 **********************************************************************/

function ordenarEgresosPorFechaCSP() {
  var id = fileIdDeCaja_('CEDIS SAN PABLO');
  if (!id) return 'sin archivo registrado';

  var eg = SpreadsheetApp.openById(id).getSheetByName('EGRESOS');
  if (!eg) return 'No hay pestaña EGRESOS.';

  var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
  var cFecha = me[SYNC.EG_FECHA];
  if (!cFecha) return 'No hay columna FECHA en EGRESOS.';

  var primera = SYNC.EG_HEADER_ROW + 1;
  var ultima = eg.getLastRow();
  if (ultima < primera + 1) return 'No hay suficientes filas para ordenar.';

  var n = ultima - primera + 1;
  eg.getRange(primera, 1, n, eg.getLastColumn())
    .sort({ column: cFecha, ascending: true });

  var msg = 'EGRESOS ordenado por FECHA: ' + n + ' filas (de la más vieja a la más nueva).';
  Logger.log(msg);
  return msg;
}