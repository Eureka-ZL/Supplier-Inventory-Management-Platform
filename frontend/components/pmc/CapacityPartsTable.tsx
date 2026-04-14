import React from 'react';

interface CapacityProductPart {
  part_no: string;
  name?: string;
  spec?: string;
  manufacturer?: string;
  required_qty: number;
  available_qty: number;
  can_produce: number;
  is_bottleneck: boolean;
  part_type?: 'fixed' | 'alternative';
  alt_group?: string;
  is_selected_option?: boolean;
}

interface CapacityProductLike {
  parts: CapacityProductPart[];
}

interface CapacityPartsTableProps {
  product: CapacityProductLike;
  keyPrefix: string;
  sortMode?: 'none' | 'can_produce_asc';
}

export const CapacityPartsTable: React.FC<CapacityPartsTableProps> = ({
  product,
  keyPrefix,
  sortMode = 'none',
}) => {
  const displayParts = [...(product.parts || [])];
  if (sortMode === 'can_produce_asc') {
    displayParts.sort((a, b) => {
      if (a.can_produce !== b.can_produce) return a.can_produce - b.can_produce;
      if (a.available_qty !== b.available_qty) return a.available_qty - b.available_qty;
      if (a.required_qty !== b.required_qty) return b.required_qty - a.required_qty;
      return String(a.part_no || '').localeCompare(String(b.part_no || ''), 'zh-CN');
    });
  }

  return (
    <div className="border-t border-slate-100 bg-white">
      <div className="px-6 py-4 flex items-center justify-between bg-slate-50">
        <span className="text-[13px] font-bold text-slate-700">底层物料支撑明细</span>
        <span className="text-[13px] font-bold text-slate-500">共 {displayParts.length} 项</span>
      </div>
      <div className="overflow-x-auto">
        <table className="m-table min-w-[700px]">
          <thead>
            <tr>
              <th>物料编码</th>
              <th>物料名称</th>
              <th>规格描述</th>
              <th>厂家</th>
              <th className="!text-right whitespace-nowrap w-20">用量</th>
              <th className="!text-right whitespace-nowrap w-20">库存</th>
              <th className="!text-right whitespace-nowrap w-24">支撑</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {displayParts.map((part, partIdx) => {
              const isBottleneck = part.is_bottleneck;
              
              return (
                <tr
                  key={`${keyPrefix}-${part.part_no}-${partIdx}`}
                  className={`transition-colors ${
                    isBottleneck ? 'bg-rose-50 hover:bg-rose-100/80' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="font-mono text-[12px] font-medium text-slate-900">{part.part_no}</td>
                  <td>
                    <div className="flex items-center gap-2">
                       <span className="text-slate-800 font-bold text-[13px] line-clamp-2 leading-snug pr-2" title={part.name || '-'}>
                         {part.name || '-'}
                       </span>
                       {part.part_type === 'alternative' && (
                         <span className="m-badge-blue !py-0 !text-[9px] shrink-0">互替组 {part.alt_group}</span>
                       )}
                    </div>
                  </td>
                  <td className="text-[12px] text-slate-500 pr-4 leading-relaxed max-w-[300px] break-words" title={part.spec || '-'}>{part.spec || '-'}</td>
                  <td>
                    <div className="text-[12px] text-slate-600 line-clamp-2 leading-snug" title={part.manufacturer || '-'}>
                      {part.manufacturer || '-'}
                    </div>
                  </td>
                  <td className="text-right font-medium text-slate-700 tabular-nums">{part.required_qty}</td>
                  <td className="text-right font-medium text-slate-600 tabular-nums">{part.available_qty}</td>
                  <td className={`text-right tabular-nums ${isBottleneck ? 'font-black text-[15px] text-rose-600' : 'font-bold text-[15px] text-slate-900'}`}>
                    {part.can_produce}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CapacityPartsTable;
