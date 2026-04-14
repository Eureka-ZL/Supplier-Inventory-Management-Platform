import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { PmcHistoryEvent } from '../historyTypes';

const renderBomRowsTable = (rows: any[], emptyText: string) => (
  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
    <table className="w-full text-[12px] pmc-table">
      <colgroup>
        <col style={{ width: '18%' }} />
        <col style={{ width: '20%' }} />
        <col style={{ width: '32%' }} />
        <col style={{ width: '8%' }} />
        <col style={{ width: '14%' }} />
        <col style={{ width: '8%' }} />
      </colgroup>
      <thead className="bg-slate-50/80 border-b border-slate-100">
        <tr>
          <th className="px-4 py-2 text-left text-[11px] font-bold text-slate-400 tracking-[0.08em]">物料编码</th>
          <th className="px-4 py-2 text-left text-[11px] font-bold text-slate-400 tracking-[0.08em]">物料名称</th>
          <th className="px-4 py-2 text-left text-[11px] font-bold text-slate-400 tracking-[0.08em]">规格描述</th>
          <th className="px-4 py-2 text-right text-[11px] font-bold text-slate-400 tracking-[0.08em]">用量</th>
          <th className="px-4 py-2 text-left text-[11px] font-bold text-slate-400 tracking-[0.08em]">厂家</th>
          <th className="px-4 py-2 text-left text-[11px] font-bold text-slate-400 tracking-[0.08em]">通用料</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={6} className="px-4 py-4 text-center text-slate-400 font-bold">{emptyText}</td>
          </tr>
        ) : (
          rows.map((row: any, idx: number) => (
            <tr key={`${row?.part_no || 'row'}-${idx}`} className="border-b border-slate-100 last:border-b-0">
              <td className="px-4 py-3 font-mono text-slate-900 font-bold" title={row?.part_no || '-'}>
                <span className="cell-truncate">{row?.part_no || '-'}</span>
              </td>
              <td className="px-4 py-3 text-slate-800 font-bold" title={row?.name || '-'}>
                <span className="cell-truncate">{row?.name || '-'}</span>
              </td>
              <td className="px-4 py-3 text-slate-500" title={row?.spec || '-'}>
                <span className="cell-truncate">{row?.spec || '-'}</span>
              </td>
              <td className="px-4 py-3 text-right text-slate-900 font-bold">{row?.qty ?? '-'}</td>
              <td className="px-4 py-3 text-slate-500 font-bold" title={row?.manufacturer || '-'}>
                <span className="cell-truncate">{row?.manufacturer || '-'}</span>
              </td>
              <td className="px-4 py-3">
                {row?.alt_group ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-bold">
                    组 {row.alt_group}
                  </span>
                ) : (
                  <span className="text-slate-300 font-bold">-</span>
                )}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

const getBomFieldDiffs = (before: any, after: any) => {
  const pairs = [
    { key: 'name', label: '物料名称' },
    { key: 'spec', label: '规格描述' },
    { key: 'qty', label: '用量' },
    { key: 'manufacturer', label: '厂家' },
    { key: 'alt_group', label: '通用组' },
  ];
  return pairs
    .map((pair) => {
      const beforeValue = before?.[pair.key] ?? null;
      const afterValue = after?.[pair.key] ?? null;
      const beforeText = beforeValue === null || beforeValue === '' ? '-' : String(beforeValue);
      const afterText = afterValue === null || afterValue === '' ? '-' : String(afterValue);
      if (beforeText === afterText) return null;
      return { ...pair, beforeText, afterText };
    })
    .filter(Boolean) as Array<{ key: string; label: string; beforeText: string; afterText: string }>;
};

const renderBomChangeCards = (rows: any[], mode: 'added' | 'removed') => {
  const isAdded = mode === 'added';
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row: any, idx: number) => (
        <div key={`${mode}-${row?.part_no || 'row'}-${idx}`} className={`flex items-center gap-4 py-2.5 px-3 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors shadow-sm relative overflow-hidden group before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] ${isAdded ? 'before:bg-emerald-500' : 'before:bg-rose-500'}`}>
          <div className={`shrink-0 w-1.5 h-1.5 rounded-full ${isAdded ? 'bg-emerald-400 ring-4 ring-emerald-50' : 'bg-rose-400 ring-4 ring-rose-50'} ml-2`}></div>
          <div className="w-[100px] sm:w-[130px] shrink-0 font-mono text-[12px] font-black text-slate-800 tracking-tight">{row?.part_no || '-'}</div>
          <div className="w-[120px] sm:w-[180px] shrink-0 font-bold text-[13px] text-slate-800 truncate" title={row?.name || '-'}>{row?.name || '-'}</div>
          <div className="flex-1 min-w-0 text-[12px] text-slate-500 truncate" title={row?.spec || '-'}>{row?.spec || '-'}</div>
          <div className="w-[100px] flex items-center justify-end gap-1.5 shrink-0 border-l border-slate-100 pl-4">
            <span className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">厂商</span>
            <span className="text-[12px] font-bold text-slate-700 truncate max-w-[60px]" title={row?.manufacturer || '-'}>{row?.manufacturer || '-'}</span>
          </div>
          <div className="w-[80px] flex items-center justify-end gap-1.5 shrink-0 border-l border-slate-100 pl-4">
            <span className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">用量</span>
            <span className={`text-[13px] font-black ${isAdded ? 'text-emerald-600' : 'text-slate-800'}`}>{row?.qty ?? '-'}</span>
          </div>
          <div className="w-[80px] flex items-center justify-end gap-1.5 shrink-0 border-l border-slate-100 pl-4 pr-1">
            <span className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">通用料</span>
            <span className="text-[12px] font-bold text-slate-700">{row?.alt_group ? `组${row.alt_group}` : '否'}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

const renderBomUpdatedCards = (rows: any[]) => (
  <div className="flex flex-col gap-2">
    {rows.slice(0, 30).map((row: any, idx: number) => {
      const before = row?.before || {};
      const after = row?.after || {};
      const diffs = getBomFieldDiffs(before, after);
      return (
        <div key={`updated-card-${idx}`} className="flex flex-col py-3 px-4 border border-slate-200 bg-white hover:bg-slate-50 transition-colors rounded-lg shadow-sm relative overflow-hidden group before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-amber-500">
          <div className="flex items-center gap-4 mb-3 relative">
            <div className="absolute left-[34px] xl:left-[44px] shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400 ring-4 ring-amber-50"></div>
            <div className="w-[80px] shrink-0"></div>
            <div className="w-[100px] sm:w-[130px] shrink-0 font-mono text-[14px] font-black text-slate-800 tracking-tight">{after.part_no || before.part_no || '-'}</div>
            <div className="w-[16px] shrink-0"></div>
            <div className="flex-1 font-bold text-[14px] text-slate-800 truncate">{after.name || before.name || '-'}</div>
            <div className="text-[11px] font-bold text-amber-600/80 pr-1">变动 {diffs.length} 处字段</div>
          </div>
          <div className="flex flex-col gap-2 mt-1">
            {diffs.map((diff) => (
              <div key={`${idx}-${diff.key}`} className="flex items-center gap-4 text-[12px]">
                <span className="text-[12px] text-slate-400 font-bold tracking-wider w-[80px] shrink-0 text-right">{diff.label}</span>
                <span className="bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-400 line-through w-[100px] sm:w-[130px] text-center truncate shrink-0 font-bold">{diff.beforeText === '-' ? '空' : diff.beforeText}</span>
                <span className="text-amber-400 font-black text-[12px] shrink-0 w-[16px] text-center">→</span>
                <span className="bg-amber-100/50 border border-amber-300/60 text-amber-900 px-2 py-0.5 rounded shadow-sm w-[100px] sm:w-[130px] text-center truncate shrink-0 font-bold tracking-wide">{diff.afterText === '-' ? '空' : diff.afterText}</span>
              </div>
            ))}
          </div>
        </div>
      );
    })}
  </div>
);

const BomHistoryDetailsContent: React.FC<{ event: PmcHistoryEvent }> = ({ event }) => {
  const summary = event.summary || {};
  const detail = event.detail || {};

  return (
    <div className="space-y-5 text-[12px]">
      <div className="flex flex-wrap items-center gap-3 mt-1 mb-2">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 flex items-center gap-3 shadow-sm inline-flex">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">变更汇总</span>
          <div className="w-px h-3 bg-slate-200"></div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5"><span className="text-[11px] text-slate-400 font-bold">新增</span><span className="text-[15px] font-black text-emerald-600 tabular-nums">{summary.added_count || 0}</span></div>
            <div className="flex items-center gap-1.5"><span className="text-[11px] text-slate-400 font-bold">删除</span><span className="text-[15px] font-black text-rose-600 tabular-nums">{summary.removed_count || 0}</span></div>
            <div className="flex items-center gap-1.5"><span className="text-[11px] text-slate-400 font-bold">修改</span><span className="text-[15px] font-black text-amber-600 tabular-nums">{summary.updated_count || 0}</span></div>
            <div className="flex items-center gap-1.5"><span className="text-[11px] text-slate-400 font-bold">通用组</span><span className="text-[15px] font-black text-slate-900 tabular-nums">{summary.common_group_change_count || 0}</span></div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {(detail.updated || []).length > 0 && (
          <div>
            <div className="font-bold text-slate-800 text-[13px] border-l-2 border-amber-500 pl-2 mb-3 flex items-center justify-between leading-none">
              修改项深入对比
              <span className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-lg">{(detail.updated || []).length} 项</span>
            </div>
            {renderBomUpdatedCards(detail.updated || [])}
          </div>
        )}

        {(detail.added || []).length > 0 && (
          <div>
            <div className="font-bold text-slate-800 text-[13px] border-l-2 border-emerald-500 pl-2 mb-3 flex items-center justify-between leading-none">
              新增详细明细
              <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-lg">{(detail.added || []).length} 项</span>
            </div>
            {renderBomChangeCards(detail.added || [], 'added')}
          </div>
        )}

        {(detail.removed || []).length > 0 && (
          <div>
            <div className="font-bold text-slate-800 text-[13px] border-l-2 border-rose-500 pl-2 mb-3 flex items-center justify-between leading-none">
              删除详细明细
              <span className="text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-lg">{(detail.removed || []).length} 项</span>
            </div>
            {renderBomChangeCards(detail.removed || [], 'removed')}
          </div>
        )}

        {((detail.common_groups?.added || []).length > 0 || (detail.common_groups?.removed || []).length > 0 || (detail.common_groups?.updated || []).length > 0) && (
          <div>
            <div className="font-bold text-slate-800 text-[13px] border-l-2 border-slate-900 pl-2 mb-3 flex items-center justify-between leading-none">
              通用用料编组变动
              <div className="flex items-center gap-1.5">
                {(detail.common_groups?.added || []).length > 0 && <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-lg">+{(detail.common_groups?.added || []).length}</span>}
                {(detail.common_groups?.removed || []).length > 0 && <span className="text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-lg">−{(detail.common_groups?.removed || []).length}</span>}
                {(detail.common_groups?.updated || []).length > 0 && <span className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-lg">调整 {(detail.common_groups?.updated || []).length}</span>}
              </div>
            </div>
            <div className="space-y-3">
              {(detail.common_groups?.added || []).map((group: any, idx: number) => (
                <div key={`common-group-added-${idx}`} className="rounded-xl border border-emerald-100 bg-white overflow-hidden shadow-sm">
                  <div className="px-4 py-2 border-b border-emerald-100 bg-emerald-50/60 text-emerald-700 font-bold text-[12px]">新增通用组 {group.group}</div>
                  <div className="p-3 bg-white">{renderBomRowsTable(group.parts || [], '')}</div>
                </div>
              ))}
              {(detail.common_groups?.removed || []).map((group: any, idx: number) => (
                <div key={`common-group-removed-${idx}`} className="rounded-xl border border-rose-100 bg-white overflow-hidden shadow-sm">
                  <div className="px-4 py-2 border-b border-rose-100 bg-rose-50/60 text-rose-700 font-bold text-[12px]">删除通用组 {group.group}</div>
                  <div className="p-3 bg-white">{renderBomRowsTable(group.parts || [], '')}</div>
                </div>
              ))}
              {(detail.common_groups?.updated || []).map((group: any, idx: number) => (
                <div key={`common-group-updated-${idx}`} className="rounded-xl border border-amber-100 bg-white overflow-hidden shadow-sm">
                  <div className="px-4 py-2 border-b border-amber-100 bg-amber-50/60 text-amber-700 font-bold text-[12px]">合并重组 {group.group}</div>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 p-4 bg-white">
                    <div>
                      <div className="text-[11px] font-bold text-slate-500 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" />调整前配置</div>
                      {renderBomRowsTable(group.before_parts || [], '')}
                    </div>
                    <div>
                      <div className="text-[11px] font-bold text-slate-500 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />调整后配置</div>
                      {renderBomRowsTable(group.after_parts || [], '')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const PathNode: React.FC<{
  path: any[];
  index: number;
  eventId: string;
  event: PmcHistoryEvent;
  expandedHistoryPathNodes: Record<string, boolean>;
  setExpandedHistoryPathNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}> = ({
  path,
  index,
  eventId,
  event,
  expandedHistoryPathNodes,
  setExpandedHistoryPathNodes,
}) => {
  if (index >= path.length) return null;
  const node = path[index];
  const isLeaf = index === path.length - 1;
  const detail = event.detail || {};
  const hasDetails = isLeaf && event.event_type === 'bom_change' && (
    (detail.added || []).length > 0 ||
    (detail.removed || []).length > 0 ||
    (detail.updated || []).length > 0 ||
    (detail.common_groups?.added || []).length > 0 ||
    (detail.common_groups?.removed || []).length > 0 ||
    (detail.common_groups?.updated || []).length > 0
  );
  const hasChildren = !isLeaf || hasDetails;
  const stateKey = `${eventId}-pathnode-${index}-${node.code || Math.random()}`;
  const isExpanded = expandedHistoryPathNodes[stateKey] ?? true;

  const tier = String(node?.tier || '').trim();
  const type = String(node?.node_type || '').trim();
  const tierLabel = String(node?.tier_label || '').trim();
  const isFinished = tier === 'finished' || type === 'product' || tierLabel.includes('成品');
  const isHead = tier === 'head' || tierLabel.includes('机头');
  const isPcba = tier === 'pcba' || tierLabel.includes('PCBA');
  const label = tierLabel || (isFinished ? '成品机' : isHead ? '机头' : isPcba ? 'PCBA' : '组件');

  return (
    <div className={index > 0 ? 'ml-6 mt-3' : 'mt-2'}>
      <button
        type="button"
        onClick={() => {
          if (hasChildren) {
            setExpandedHistoryPathNodes((prev) => ({ ...prev, [stateKey]: !prev[stateKey] }));
          }
        }}
        className={`relative w-full text-left rounded-xl transition-all select-none py-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border overflow-hidden bg-white border-slate-200 shadow-sm hover:border-slate-300 hover:shadow-md ${hasChildren ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-4 min-w-0">
          {hasChildren ? (
            <div className={`w-6 h-6 shrink-0 flex items-center justify-center rounded-md transition-colors ${isExpanded ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400 border border-slate-200'}`}>
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </div>
          ) : (
            <div className="w-6 h-6 shrink-0 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-slate-900 truncate tracking-tight">{node?.name || node?.code || '-'}</div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium mt-1.5 truncate">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-slate-100 text-slate-600">{label}</span>
              <span className="opacity-80 font-mono text-[10px]">{node?.code || '-'}</span>
            </div>
          </div>
        </div>
      </button>
      {hasChildren && isExpanded && (
        <div className="ml-6 pl-4 border-l-2 border-slate-100 mt-2.5 pb-2">
          {!isLeaf && (
            <PathNode
              path={path}
              index={index + 1}
              eventId={eventId}
              event={event}
              expandedHistoryPathNodes={expandedHistoryPathNodes}
              setExpandedHistoryPathNodes={setExpandedHistoryPathNodes}
            />
          )}
          {isLeaf && hasDetails && <div className="pt-2"><BomHistoryDetailsContent event={event} /></div>}
        </div>
      )}
    </div>
  );
};

interface BomHistoryImpactPathsProps {
  event: PmcHistoryEvent;
  expandedHistoryPathNodes: Record<string, boolean>;
  setExpandedHistoryPathNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export const BomHistoryImpactPaths: React.FC<BomHistoryImpactPathsProps> = ({
  event,
  expandedHistoryPathNodes,
  setExpandedHistoryPathNodes,
}) => {
  const impactContext = event.detail?.impact_context || {};
  let impactPaths = Array.isArray(impactContext.impact_paths) ? impactContext.impact_paths : [];
  const changedNode = impactContext.changed_node || {};
  const rootNode = impactContext.root_node || {};

  if (!impactPaths.length && (rootNode?.code || rootNode?.name) && (changedNode?.code || changedNode?.name)) {
    impactPaths = [[
      { name: rootNode.name || event.product_name, code: rootNode.code || event.product_code, node_type: 'product', tier: 'finished' },
      { name: changedNode.name || event.changed_product_name, code: changedNode.code || event.changed_product_code, tier_label: event.changed_tier_label || changedNode.tier_label || '清单组件' },
    ]];
  }

  if (!impactPaths.length && !changedNode?.code && !rootNode?.code) {
    return <div className="pt-2"><BomHistoryDetailsContent event={event} /></div>;
  }

  const slicedPaths = impactPaths.map((path) => (path.length > 1 ? path.slice(1) : [])).filter((path) => path.length > 0);
  return (
    <div className="space-y-2 pt-1">
      {slicedPaths.length > 0 ? (
        slicedPaths.map((path: any[], pathIndex: number) => (
          <div key={`${event.event_id}-path-${pathIndex}`}>
            <PathNode
              path={path}
              index={0}
              eventId={event.event_id}
              event={event}
              expandedHistoryPathNodes={expandedHistoryPathNodes}
              setExpandedHistoryPathNodes={setExpandedHistoryPathNodes}
            />
          </div>
        ))
      ) : (
        <div className="pt-2"><BomHistoryDetailsContent event={event} /></div>
      )}
    </div>
  );
};
