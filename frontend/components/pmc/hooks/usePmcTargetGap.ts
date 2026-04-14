import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { getAuthToken } from '../../../services/api';
import type { BomProduct } from '../bomTypes';
import type {
  TargetGapBatchResponse,
  TargetGapBatchResult,
  TargetGapInputRow,
  TargetGapMode,
  TargetGapSelectableProduct,
} from '../targetGap/types';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || '';
const MAX_TARGET_UNITS = 10000;

const getBomTier = (code?: string): TargetGapSelectableProduct['tier'] => {
  const value = (code || '').trim();
  if (value.startsWith('1101')) return 'finished';
  if (value.startsWith('1201')) return 'head';
  if (value.startsWith('1202')) return 'pcba';
  return 'other';
};

interface UsePmcTargetGapOptions {
  bomProducts: BomProduct[];
  recordId?: number;
  lineRank: (line: string) => number;
  formatProductName: (name: string) => string;
  setError: Dispatch<SetStateAction<string | null>>;
}

type TargetGapRowsByMode = Record<TargetGapMode, TargetGapInputRow[]>;
type TargetGapResultByMode = Record<TargetGapMode, TargetGapBatchResult | null>;
type TargetGapLoadingByMode = Record<TargetGapMode, boolean>;

export const usePmcTargetGap = ({
  bomProducts,
  recordId,
  lineRank,
  formatProductName,
  setError,
}: UsePmcTargetGapOptions) => {
  const [targetGapMode, setTargetGapMode] = useState<TargetGapMode>('finished');

  const targetGapSelectableProducts = bomProducts
    .map((product) => ({
      product_code: (product.product_code || '').trim(),
      product_name: (product.product_name || '').trim(),
      line: (product.line || product.category || '未分类').trim() || '未分类',
      source_file: (product.source_file || product.file || '').trim(),
      tier: getBomTier(product.product_code),
    }))
    .filter((product) => {
      if (!product.product_code || !product.product_name) return false;
      if (targetGapMode === 'finished') return product.tier === 'finished';
      return product.tier === 'head' || product.tier === 'pcba';
    })
    .sort((a, b) => {
      const rankDiff = lineRank(a.line) - lineRank(b.line);
      if (rankDiff !== 0) return rankDiff;
      if (targetGapMode === 'subassembly' && a.tier !== b.tier) {
        return a.tier === 'head' ? -1 : 1;
      }
      return formatProductName(a.product_name).localeCompare(formatProductName(b.product_name), 'zh-CN');
    });

  const getTargetGapProductStableKey = (product: TargetGapSelectableProduct) =>
    `${(product.line || '未分类').trim().toLowerCase()}::${(product.product_code || '').trim()}::${(product.source_file || '').trim().toLowerCase()}`;

  const targetGapProductsByLine: Record<string, TargetGapSelectableProduct[]> = {};
  targetGapSelectableProducts.forEach((product) => {
    const line = product.line || '未分类';
    if (!targetGapProductsByLine[line]) targetGapProductsByLine[line] = [];
    targetGapProductsByLine[line].push(product);
  });

  const targetGapLines = Object.keys(targetGapProductsByLine).sort((a, b) => {
    const rankDiff = lineRank(a) - lineRank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.localeCompare(b, 'zh-CN');
  });

  const createTargetGapRow = (): TargetGapInputRow => ({
    id: `tg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    line: '',
    productKey: '',
    targetUnits: '',
  });

  const [targetGapRowsByMode, setTargetGapRowsByMode] = useState<TargetGapRowsByMode>({
    finished: [createTargetGapRow()],
    subassembly: [createTargetGapRow()],
  });
  const [targetGapBatchResultByMode, setTargetGapBatchResultByMode] = useState<TargetGapResultByMode>({
    finished: null,
    subassembly: null,
  });
  const [targetGapLoadingByMode, setTargetGapLoadingByMode] = useState<TargetGapLoadingByMode>({
    finished: false,
    subassembly: false,
  });
  const rowsSignatureByModeRef = useRef<Record<TargetGapMode, string>>({
    finished: '',
    subassembly: '',
  });

  const targetGapRows = targetGapRowsByMode[targetGapMode] || [];
  const targetGapBatchResult = targetGapBatchResultByMode[targetGapMode];
  const targetGapLoading = targetGapLoadingByMode[targetGapMode];

  const setTargetGapRows: Dispatch<SetStateAction<TargetGapInputRow[]>> = (value) => {
    setTargetGapRowsByMode((prev) => {
      const currentRows = prev[targetGapMode] || [];
      const nextRows = typeof value === 'function' ? (value as (prevState: TargetGapInputRow[]) => TargetGapInputRow[])(currentRows) : value;
      return {
        ...prev,
        [targetGapMode]: nextRows,
      };
    });
  };

  useEffect(() => {
    if (targetGapLines.length === 0) {
      if (targetGapRows.length > 0) {
        setTargetGapRowsByMode((prev) => ({
          ...prev,
          [targetGapMode]: [],
        }));
      }
      return;
    }

    setTargetGapRowsByMode((prev) => {
      const modeRows = prev[targetGapMode] || [];
      let nextRows = modeRows;
      if (modeRows.length === 0) {
        nextRows = [createTargetGapRow()];
      } else {
        nextRows = modeRows.map((row) => {
          const fixedLine = row.line && targetGapProductsByLine[row.line] ? row.line : '';
          const lineProducts = fixedLine ? (targetGapProductsByLine[fixedLine] || []) : [];
          const hasProduct = fixedLine
            ? lineProducts.some((product) => getTargetGapProductStableKey(product) === row.productKey)
            : false;
          return {
            ...row,
            line: fixedLine,
            productKey: hasProduct ? row.productKey : '',
          };
        });
      }
      if (nextRows === modeRows) return prev;
      return {
        ...prev,
        [targetGapMode]: nextRows,
      };
    });
  }, [
    targetGapMode,
    targetGapLines.join('|'),
    targetGapSelectableProducts.length,
    targetGapRows.length,
  ]);

  useEffect(() => {
    const signature = targetGapRows.map((row) => `${row.id}:${row.line}:${row.productKey}:${row.targetUnits}`).join('|');
    const prevSignature = rowsSignatureByModeRef.current[targetGapMode];
    if (!prevSignature) {
      rowsSignatureByModeRef.current[targetGapMode] = signature;
      return;
    }
    if (prevSignature === signature) return;
    rowsSignatureByModeRef.current[targetGapMode] = signature;
    setTargetGapBatchResultByMode((prev) => {
      if (!prev[targetGapMode]) return prev;
      return {
        ...prev,
        [targetGapMode]: null,
      };
    });
  }, [targetGapMode, targetGapRows]);

  const resetTargetGapState = () => {
    setTargetGapBatchResultByMode({
      finished: null,
      subassembly: null,
    });
    setTargetGapRowsByMode({
      finished: [createTargetGapRow()],
      subassembly: [createTargetGapRow()],
    });
    setTargetGapLoadingByMode({
      finished: false,
      subassembly: false,
    });
    rowsSignatureByModeRef.current = {
      finished: '',
      subassembly: '',
    };
  };

  const analyzeTargetGapBatch = async () => {
    if (!recordId) {
      setError('缺少库存记录，无法进行目标缺料分析');
      return;
    }

    if (!targetGapRows.length) {
      setError(`请先添加至少一条${targetGapMode === 'finished' ? '成品机' : '子装配'}目标`);
      return;
    }

    try {
      setTargetGapLoadingByMode((prev) => ({
        ...prev,
        [targetGapMode]: true,
      }));
      setError(null);

      const targets = targetGapRows.map((row, idx) => {
        const products = targetGapProductsByLine[row.line] || [];
        const selectedProduct = products.find((product) => getTargetGapProductStableKey(product) === row.productKey);
        if (!selectedProduct) {
          throw new Error(`第 ${idx + 1} 行未选择有效${targetGapMode === 'finished' ? '成品机' : '子装配'}`);
        }
        const target = Number((row.targetUnits || '').trim());
        if (!Number.isFinite(target) || target <= 0 || !Number.isInteger(target)) {
          throw new Error(`第 ${idx + 1} 行目标台数必须是大于 0 的整数`);
        }
        if (target > MAX_TARGET_UNITS) {
          throw new Error(`第 ${idx + 1} 行目标台数不能超过 ${MAX_TARGET_UNITS}`);
        }
        return {
          row_id: row.id,
          line: row.line,
          product_code: selectedProduct.product_code,
          product_name: selectedProduct.product_name,
          target_units: target,
        };
      });

      const totalTargetUnits = targets.reduce((sum, item) => sum + Number(item.target_units || 0), 0);
      if (totalTargetUnits > MAX_TARGET_UNITS) {
        throw new Error(`目标总台数不能超过 ${MAX_TARGET_UNITS}`);
      }

      const duplicateSet = new Set<string>();
      for (const item of targets) {
        const key = `${(item.line || '').trim().toLowerCase()}::${(item.product_code || '').trim()}::${(item.product_name || '').trim().toLowerCase()}`;
        if (duplicateSet.has(key)) {
          throw new Error(`存在重复${targetGapMode === 'finished' ? '成品机' : '子装配'}，请每行选择不同对象`);
        }
        duplicateSet.add(key);
      }

      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/pmc/inventory/target-gap-batch`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          record_id: recordId,
          targets,
          target_scope: targetGapMode,
        }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: 'Analyze target gap failed' }));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      const result: TargetGapBatchResponse = await response.json();
      rowsSignatureByModeRef.current[targetGapMode] = targetGapRows
        .map((row) => `${row.id}:${row.line}:${row.productKey}:${row.targetUnits}`)
        .join('|');
      setTargetGapBatchResultByMode((prev) => ({
        ...prev,
        [targetGapMode]: result.target_gap_batch,
      }));
    } catch (err: any) {
      setError(`目标缺料分析失败: ${err.message}`);
    } finally {
      setTargetGapLoadingByMode((prev) => ({
        ...prev,
        [targetGapMode]: false,
      }));
    }
  };

  return {
    targetGapMode,
    setTargetGapMode,
    targetGapRows,
    setTargetGapRows,
    targetGapBatchResult,
    targetGapLoading,
    targetGapProductsByLine,
    targetGapLines,
    getTargetGapProductStableKey,
    analyzeTargetGapBatch,
    resetTargetGapState,
  };
};
