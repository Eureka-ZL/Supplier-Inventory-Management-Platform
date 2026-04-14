import type { GlobalShortageEntry } from './types';

export const formatProductName = (name: string) => {
  if (!name) return name;
  let formatted = name.replace(/（/g, '(').replace(/）/g, ')');
  formatted = formatted.replace(/([^\s])\(/g, '$1 (');
  formatted = formatted.replace(/\)\(/g, ') (');
  formatted = formatted.replace(/\s{2,}/g, ' ');
  return formatted.trim();
};

export const formatQty = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
};

export const formatReservedUsageText = (reservedQty: number) => {
  const reserved = Number(reservedQty || 0);
  if (reserved <= 0) return '';
  return `已使用 ${formatQty(reserved)}`;
};

const escapeExcelXml = (value: string) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const buildExcelFilename = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `全局联合补料清单_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.xls`;
};

export const exportMaterialShortagesToExcel = (rows: GlobalShortageEntry[]) => {
  const headers = ['序号', '类型', '编码/组别', '名称', '规格描述/说明', '当前库存/候选', '缺口'];
  const dataRows: string[][] = rows.flatMap((row, idx) => {
    if (row.type === 'alternative_group') {
      return (row.candidates || []).map((candidate, candidateIndex) => [
        candidateIndex === 0 ? String(idx + 1) : '',
        '互替候选',
        String(candidate.part_no || ''),
        String(candidate.name || candidate.part_no || ''),
        String(
          candidateIndex === 0
            ? `${candidate.spec || ''}${row.source_product_name ? ` / ${row.source_product_name}` : ''} / 同组任选其一满足即可`
            : candidate.spec || ''
        ),
        Number(candidate.reserved_qty || 0) > 0
          ? `${formatQty(Number(candidate.available_qty || 0))}（${formatReservedUsageText(Number(candidate.reserved_qty || 0))}）`
          : formatQty(Number(candidate.available_qty || 0)),
        formatQty(Number(candidate.shortage_qty || 0)),
      ]);
    }

    return [[
      String(idx + 1),
      '普通物料',
      String(row.part_no || ''),
      String(row.name || row.part_no || ''),
      String(row.spec || ''),
      Number(row.reserved_qty || 0) > 0
        ? `${formatQty(Number(row.available_qty || 0))}（${formatReservedUsageText(Number(row.reserved_qty || 0))}）`
        : formatQty(Number(row.available_qty || 0)),
      formatQty(Number(row.shortage_qty || 0)),
    ]];
  });

  const xmlRows = [headers, ...dataRows]
    .map((cells, rowIndex) => {
      const cellXml = cells
        .map((cell, cellIndex) => {
          const isNumberColumn = rowIndex > 0 && (cellIndex === 0 || cellIndex === 4 || cellIndex === 5);
          const dataType = isNumberColumn && /^-?\d+(\.\d+)?$/.test(cell) ? 'Number' : 'String';
          return `<Cell><Data ss:Type="${dataType}">${escapeExcelXml(cell)}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cellXml}</Row>`;
    })
    .join('');

  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <Worksheet ss:Name="联合补料清单">
    <Table>
      ${xmlRows}
    </Table>
  </Worksheet>
</Workbook>`;

  const blob = new Blob([workbookXml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildExcelFilename();
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

export const getBomTierLabel = (code?: string) => {
  const value = (code || '').trim();
  if (value.startsWith('1101')) return '成品机';
  if (value.startsWith('1201')) return '机头';
  if (value.startsWith('1202')) return 'PCBA';
  return '组件';
};
