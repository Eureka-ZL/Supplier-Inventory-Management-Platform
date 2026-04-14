import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type {
  TargetGapBatchRowResult,
  TargetGapTreeNode,
} from './types';
import { formatProductName, formatQty, formatReservedUsageText, getBomTierLabel } from './utils';

export const buildTargetGapRowTree = (row: TargetGapBatchRowResult): TargetGapTreeNode | null => {
  const layers = row.layers || [];
  const layerRows = layers.flatMap((layer) =>
    (layer.rows || []).map((item) => ({
      ...item,
      tier: layer.tier,
      tier_label: layer.label,
    }))
  );

  const codeNameMap = new Map<string, string>();
  const edgeMap = new Map<string, Set<string>>();
  const materialBySourcePart = new Map<
    string,
    {
      part_no: string;
      name?: string;
      spec?: string;
      manufacturer?: string;
      available_qty?: number;
      current_available_qty?: number;
      simulated_available_qty?: number;
      reserved_qty?: number;
      shortage_qty: number;
      shortage_units: number;
      alt_group?: string | number | null;
      is_alternative?: boolean;
    }
  >();
  const subassemblyMap = new Map<string, { gap_units: number; buildable_units: number }>();

  layerRows.forEach((item) => {
    const sourceCode = (item.source_product_code || '').trim();
    const sourceName = (item.source_product_name || '').trim();
    if (sourceCode && sourceName && !codeNameMap.has(sourceCode)) {
      codeNameMap.set(sourceCode, sourceName);
    }
    if (item.is_subassembly) {
      const childCode = (item.part_no || '').trim();
      if (sourceCode && childCode) {
        if (!edgeMap.has(sourceCode)) edgeMap.set(sourceCode, new Set<string>());
        edgeMap.get(sourceCode)!.add(childCode);
      }
      if (childCode && item.name && !codeNameMap.has(childCode)) {
        codeNameMap.set(childCode, item.name);
      }
      if (childCode) {
        subassemblyMap.set(childCode, {
          gap_units: Number(item.subassembly_gap_units || 0),
          buildable_units: Number(item.subassembly_buildable_units || 0),
        });
      }
    } else if (Number(item.shortage_qty || 0) > 0) {
      const source = sourceCode || 'root';
      const partNo = (item.part_no || '').trim();
      if (!partNo) return;
      const key = `${source}::${partNo}`;
      const old = materialBySourcePart.get(key);
      if (!old) {
        materialBySourcePart.set(key, {
          part_no: partNo,
          name: item.name,
          spec: item.spec,
          manufacturer: item.manufacturer,
          available_qty: Number(item.current_available_qty ?? item.available_qty ?? 0),
          current_available_qty: Number(item.current_available_qty ?? item.available_qty ?? 0),
          simulated_available_qty: Number(item.simulated_available_qty || 0),
          reserved_qty: Number(item.reserved_qty || 0),
          shortage_qty: Number(item.shortage_qty || 0),
          shortage_units: Number(item.shortage_units || 0),
          alt_group: item.alt_group,
          is_alternative: !!item.is_alternative,
        });
      } else {
        old.shortage_qty += Number(item.shortage_qty || 0);
        old.shortage_units = Math.max(old.shortage_units, Number(item.shortage_units || 0));
        old.available_qty = Math.max(
          Number(old.available_qty || 0),
          Number(item.current_available_qty ?? item.available_qty ?? 0)
        );
        old.current_available_qty = Math.max(
          Number(old.current_available_qty || 0),
          Number(item.current_available_qty ?? item.available_qty ?? 0)
        );
        old.simulated_available_qty = Math.max(
          Number(old.simulated_available_qty || 0),
          Number(item.simulated_available_qty || 0)
        );
        old.reserved_qty = Math.max(Number(old.reserved_qty || 0), Number(item.reserved_qty || 0));
        old.is_alternative = old.is_alternative || !!item.is_alternative;
        if (old.alt_group === undefined || old.alt_group === null) {
          old.alt_group = item.alt_group;
        }
      }
    }
  });

  const rootLayerRow = layerRows.find((item) => (item.tier || '') === 'finished' && (item.source_product_code || '').trim());
  const parsedProductCode = (row.product || '').match(/(\d{11,13})/)?.[1] || '';
  const rootCode = (rootLayerRow?.source_product_code || parsedProductCode || '').trim();
  const rootName = (rootLayerRow?.source_product_name || row.product || '').trim();
  if (!rootCode) return null;
  if (rootName && !codeNameMap.has(rootCode)) {
    codeNameMap.set(rootCode, rootName);
  }

  (row.subassembly_shortages || []).forEach((item) => {
    const code = (item.part_no || '').trim();
    if (!code) return;
    const existing = subassemblyMap.get(code);
    subassemblyMap.set(code, {
      gap_units: Number(item.gap_units || 0),
      buildable_units: existing?.buildable_units ?? Number(item.buildable_units || 0),
    });
  });

  const buildNodeLabel = (code: string) => {
    const name = formatProductName((codeNameMap.get(code) || '').trim());
    if (!name) return code;
    if (name.includes(code)) return name;
    return `${name} (${code})`;
  };

  const buildTree = (code: string, visited: Set<string>): TargetGapTreeNode | null => {
    const currentCode = (code || '').trim();
    if (!currentCode || visited.has(currentCode)) return null;
    const nextVisited = new Set<string>(visited);
    nextVisited.add(currentCode);

    const childAssemblyNodes: TargetGapTreeNode[] = [];
    const childCodes = Array.from(edgeMap.get(currentCode) || []);
    childCodes.forEach((childCode) => {
      const child = buildTree(childCode, nextVisited);
      if (child) childAssemblyNodes.push(child);
    });

    const materialNodes: TargetGapTreeNode[] = Array.from(materialBySourcePart.entries())
      .filter(([key]) => key.startsWith(`${currentCode}::`))
      .map(([key, value]) => ({
        key: `material::${key}`,
        type: 'material' as const,
        code: value.part_no,
        label: value.name || value.part_no,
        shortage_qty: value.shortage_qty,
        impact_units: value.shortage_units,
        available_qty: value.available_qty,
        current_available_qty: value.current_available_qty,
        simulated_available_qty: value.simulated_available_qty,
        reserved_qty: value.reserved_qty,
        spec: value.spec,
        manufacturer: value.manufacturer,
        alt_group: value.alt_group,
        is_alternative: value.is_alternative,
        children: [],
      }))
      .sort((a, b) => Number(b.shortage_qty || 0) - Number(a.shortage_qty || 0));

    const groupedAlternativeNodes = new Map<string, TargetGapTreeNode[]>();
    const materialChildren: TargetGapTreeNode[] = [];

    materialNodes.forEach((node) => {
      if (node.alt_group === undefined || node.alt_group === null) {
        materialChildren.push(node);
        return;
      }
      const groupKey = String(node.alt_group);
      if (!groupedAlternativeNodes.has(groupKey)) {
        groupedAlternativeNodes.set(groupKey, []);
      }
      groupedAlternativeNodes.get(groupKey)!.push(node);
    });

    const alternativeGroupNodes: TargetGapTreeNode[] = Array.from(groupedAlternativeNodes.entries())
      .map(([groupId, nodes]) => {
        if (nodes.length <= 1) {
          materialChildren.push(...nodes);
          return null;
        }
        const sortedNodes = [...nodes].sort((a, b) => Number(a.shortage_qty || 0) - Number(b.shortage_qty || 0));
        const bestShortage = sortedNodes.reduce((minValue, item) => {
          const current = Number(item.shortage_qty || 0);
          return minValue === null || current < minValue ? current : minValue;
        }, null as number | null) ?? 0;
        const bestImpactUnits = sortedNodes.reduce((minValue, item) => {
          const current = Number(item.impact_units || 0);
          return minValue === null || current < minValue ? current : minValue;
        }, null as number | null) ?? 0;
        const firstLabel = String(sortedNodes[0]?.label || '').trim();
        const groupLabel = firstLabel ? `${firstLabel} 替代组` : `替代料组 ${groupId}`;
        return {
          key: `alt-group::${currentCode}::${groupId}`,
          type: 'alternative_group' as const,
          code: `ALT-${groupId}`,
          label: groupLabel,
          shortage_qty: bestShortage,
          impact_units: bestImpactUnits,
          alt_group: groupId,
          option_count: sortedNodes.length,
          is_alternative: true,
          children: sortedNodes,
        };
      })
      .filter(Boolean) as TargetGapTreeNode[];

    const sub = subassemblyMap.get(currentCode);
    const children = [
      ...childAssemblyNodes,
      ...alternativeGroupNodes.sort((a, b) => Number(a.shortage_qty || 0) - Number(b.shortage_qty || 0)),
      ...materialChildren.sort((a, b) => Number(b.shortage_qty || 0) - Number(a.shortage_qty || 0)),
    ];
    const inferredGapUnits = children.reduce((maxValue, child) => {
      const current = Number(child.impact_units || 0);
      return current > maxValue ? current : maxValue;
    }, 0);
    const hasExactSubassemblyStats = currentCode === rootCode || subassemblyMap.has(currentCode);
    const impactUnits = currentCode === rootCode
      ? Number(row.gap_units || 0)
      : hasExactSubassemblyStats ? Number(sub?.gap_units || 0) : inferredGapUnits;
    const buildableUnits = currentCode === rootCode
      ? Number(row.current_capacity || 0)
      : hasExactSubassemblyStats ? Number(sub?.buildable_units || 0) : undefined;
    if (currentCode !== rootCode && children.length === 0 && Number(impactUnits || 0) <= 0) return null;

    return {
      key: `assembly::${currentCode}`,
      type: 'assembly',
      code: currentCode,
      label: buildNodeLabel(currentCode),
      tier_label: getBomTierLabel(currentCode),
      impact_units: impactUnits,
      buildable_units: buildableUnits,
      inferred_from_children: !hasExactSubassemblyStats && currentCode !== rootCode,
      children,
    };
  };

  return buildTree(rootCode, new Set<string>());
};

interface TargetGapTreeProps {
  rowId: string;
  root: TargetGapTreeNode;
  expandedNodes: Record<string, boolean>;
  setExpandedNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export const TargetGapTree: React.FC<TargetGapTreeProps> = ({
  rowId,
  root,
  expandedNodes,
  setExpandedNodes,
}) => {
  const renderTreeNode = (node: TargetGapTreeNode, depth = 0): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const stateKey = `${rowId}::${node.key}`;
    const isAssembly = node.type === 'assembly';
    const isAlternativeGroup = node.type === 'alternative_group';
    const isExpanded = hasChildren ? (expandedNodes[stateKey] ?? (depth === 0 || isAlternativeGroup)) : false;
    const isShortage = !isAssembly && Number(node.shortage_qty || 0) > 0;

    return (
      <div key={stateKey} className={depth > 0 ? 'ml-6 mt-3' : 'mt-2'}>
        <button
          type="button"
          onClick={() =>
            hasChildren &&
            setExpandedNodes((prev) => ({
              ...prev,
              [stateKey]: !isExpanded,
            }))
          }
          className={`relative w-full text-left rounded-xl transition-all select-none py-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border overflow-hidden bg-white ${
            isShortage
              ? 'border-rose-100 shadow-[0_2px_8px_-2px_rgba(225,29,72,0.08)] hover:border-rose-200 hover:shadow-md before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-rose-500'
              : 'border-slate-200 shadow-sm hover:border-slate-300 hover:shadow-md'
          } ${hasChildren ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <div className="flex items-center gap-4 min-w-0">
            {hasChildren ? (
              <div className={`pmc-row-toggle ${isExpanded ? 'is-open' : ''}`}>
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </div>
            ) : (
              <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                <div className={`w-1.5 h-1.5 rounded-full ${isShortage ? 'bg-rose-400 ring-4 ring-rose-50' : 'bg-slate-300'}`}></div>
              </div>
            )}
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-slate-900 truncate tracking-tight">{node.label}</div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium mt-1.5 truncate">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                  {isAssembly ? node.tier_label || '组件' : isAlternativeGroup ? '替代组' : '物料'}
                </span>
                {!isAssembly && !isAlternativeGroup && node.is_alternative ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                    替代料
                  </span>
                ) : null}
                {!isAlternativeGroup ? <span className="opacity-80 font-mono text-[10px]">{node.code}</span> : null}
                {!isAssembly && !isAlternativeGroup && node.spec ? <span className="text-slate-400 truncate">· {node.spec}</span> : null}
              </div>
              {isAlternativeGroup ? (
                <div className="text-[11px] text-amber-700 font-medium mt-1.5">
                  同组任选其一满足即可，共 {node.option_count || node.children.length} 个候选料
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-6 shrink-0 pl-10 sm:pl-0">
            {isAssembly ? (
              <div className="flex items-center">
                <div className="text-right min-w-[60px] pr-5">
                  <span className="text-[10px] text-slate-400 block mb-1 font-semibold">可产</span>
                  <span className="text-[15px] font-bold text-slate-700 tabular-nums leading-none">
                    {node.buildable_units ?? 0}
                  </span>
                </div>
                <div className="text-right min-w-[60px] pl-5 border-l border-slate-100">
                  <span className={`text-[10px] block mb-1 font-bold ${Number(node.impact_units || 0) > 0 ? 'text-rose-400' : 'text-slate-400'}`}>缺台</span>
                  <span className={`text-[16px] font-bold tabular-nums leading-none ${Number(node.impact_units || 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {node.impact_units || 0}
                  </span>
                </div>
              </div>
            ) : isAlternativeGroup ? (
              <div className="flex items-center">
                <div className="text-right min-w-[60px] pr-5">
                  <span className="text-[10px] text-slate-400 block mb-1 font-semibold">候选数</span>
                  <span className="text-[15px] font-semibold text-slate-600 tabular-nums leading-none">{node.option_count || node.children.length}</span>
                </div>
                <div className="text-right min-w-[72px] pl-5 border-l border-slate-100">
                  <span className={`text-[10px] block mb-1 font-bold ${Number(node.shortage_qty || 0) > 0 ? 'text-rose-400' : 'text-slate-400'}`}>最小缺口</span>
                  <span className={`text-[16px] font-bold tabular-nums leading-none ${Number(node.shortage_qty || 0) > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                    {formatQty(Number(node.shortage_qty || 0))}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center">
                <div className="text-right min-w-[60px] pr-5">
                  <span className="text-[10px] text-slate-400 block mb-1 font-semibold">当前库存</span>
                  <span className="text-[15px] font-semibold text-slate-600 tabular-nums leading-none">{formatQty(Number(node.available_qty || 0))}</span>
                  {Number(node.reserved_qty || 0) > 0 ? (
                    <span className="text-[10px] text-amber-600 font-medium block mt-1 whitespace-nowrap">
                      {formatReservedUsageText(Number(node.reserved_qty || 0))}
                    </span>
                  ) : null}
                </div>
                <div className="text-right min-w-[60px] pl-5 border-l border-slate-100">
                  <span className={`text-[10px] block mb-1 font-bold ${Number(node.shortage_qty || 0) > 0 ? 'text-rose-400' : 'text-slate-400'}`}>缺口</span>
                  <span className={`text-[16px] font-bold tabular-nums leading-none ${Number(node.shortage_qty || 0) > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                    {formatQty(Number(node.shortage_qty || 0))}
                  </span>
                </div>
              </div>
            )}
          </div>
        </button>
        {hasChildren && isExpanded && (
          <div className="ml-6 pl-4 border-l-2 border-slate-100 mt-2.5 pb-2">
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return <div className="space-y-1">{renderTreeNode(root)}</div>;
};
