import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { getAuthToken } from '../../../services/api';
import type { BomPart, BomProduct } from '../bomTypes';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || '';

interface UsePmcBomEditorOptions {
  setError: Dispatch<SetStateAction<string | null>>;
  onAfterSave?: () => Promise<void> | void;
}

const normalizeAltGroups = (rows: BomPart[]): BomPart[] => {
  const mapping = new Map<number, number>();
  let nextGroup = 1;
  return rows.map((row) => {
    if (row.alt_group === null || row.alt_group === undefined) {
      return { ...row, alt_group: null };
    }
    const old = Number(row.alt_group);
    if (!mapping.has(old)) {
      mapping.set(old, nextGroup++);
    }
    return { ...row, alt_group: mapping.get(old) ?? null };
  });
};

export const usePmcBomEditor = ({
  setError,
  onAfterSave,
}: UsePmcBomEditorOptions) => {
  const [editingProductKey, setEditingProductKey] = useState<string | null>(null);
  const [editingParts, setEditingParts] = useState<BomPart[]>([]);
  const [selectedAltRows, setSelectedAltRows] = useState<Set<number>>(new Set());
  const [savingBom, setSavingBom] = useState(false);

  const startEditBom = (product: BomProduct) => {
    const key = `${product.file}-${product.product_code || product.product_name}`;
    setEditingProductKey(key);
    setSelectedAltRows(new Set());
    setEditingParts(
      (product.parts || []).map((part) => ({
        part_no: String(part.part_no || '').trim(),
        name: String(part.name || ''),
        spec: String(part.spec || ''),
        qty: Number(part.qty || 1),
        manufacturer: String(part.manufacturer || ''),
        alt_group: part.alt_group === null || part.alt_group === undefined ? null : Number(part.alt_group),
      }))
    );
  };

  const cancelEditBom = () => {
    setEditingProductKey(null);
    setEditingParts([]);
    setSelectedAltRows(new Set());
  };

  const updateEditingPart = (index: number, patch: Partial<BomPart>) => {
    setEditingParts((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addEditingPart = () => {
    setEditingParts((prev) => [
      ...prev,
      {
        part_no: '',
        name: '',
        spec: '',
        qty: 1,
        manufacturer: '',
        alt_group: null,
      },
    ]);
  };

  const removeEditingPart = (index: number) => {
    setEditingParts((prev) => prev.filter((_, i) => i !== index));
    setSelectedAltRows((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i === index) return;
        next.add(i > index ? i - 1 : i);
      });
      return next;
    });
  };

  const toggleAltRowSelection = (index: number, checked: boolean) => {
    setSelectedAltRows((prev) => {
      const next = new Set(prev);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const applySelectedAsAltGroup = () => {
    const picked = Array.from(selectedAltRows as Set<number>).sort((a: number, b: number) => a - b);
    if (picked.length < 2) {
      setError('请至少勾选两条物料后再设为互替');
      return;
    }
    setError(null);
    setEditingParts((prev) => {
      const existing = prev
        .map((row) => (row.alt_group === null || row.alt_group === undefined ? 0 : Number(row.alt_group)))
        .filter((n) => Number.isFinite(n) && n > 0);
      const nextGroupId = existing.length ? Math.max(...existing) + 1 : 1;
      const merged = prev.map((row, idx) =>
        selectedAltRows.has(idx) ? { ...row, alt_group: nextGroupId } : row,
      );
      return normalizeAltGroups(merged);
    });
    setSelectedAltRows(new Set());
  };

  const clearSelectedAltGroup = () => {
    if (selectedAltRows.size === 0) {
      setError('请先勾选需要取消互替的物料');
      return;
    }
    const hasAltSelected = Array.from(selectedAltRows.values()).some((idx) => {
      const row = editingParts[idx];
      return !!row && row.alt_group !== null && row.alt_group !== undefined;
    });
    if (!hasAltSelected) {
      setError('当前勾选项都不是互替料，无法取消互替');
      return;
    }
    setError(null);
    setEditingParts((prev) => {
      const cleared = prev.map((row, idx) =>
        selectedAltRows.has(idx) ? { ...row, alt_group: null } : row,
      );
      return normalizeAltGroups(cleared);
    });
    setSelectedAltRows(new Set());
  };

  const saveBomParts = async (product: BomProduct) => {
    if (!product.product_code) {
      setError('当前产品缺少料号，无法编辑保存');
      return;
    }
    if (!editingParts.length) {
      setError('物料清单条目不能为空');
      return;
    }
    const invalid = editingParts.findIndex((part) => !String(part.part_no || '').trim());
    if (invalid >= 0) {
      setError(`第 ${invalid + 1} 行物料编码不能为空`);
      return;
    }
    const invalidNonNumeric = editingParts.findIndex(
      (part) => !/^\d+$/.test(String(part.part_no || '').trim()),
    );
    if (invalidNonNumeric >= 0) {
      setError(`第 ${invalidNonNumeric + 1} 行物料编码必须为纯数字`);
      return;
    }

    try {
      setSavingBom(true);
      setError(null);
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/pmc/bom/product/${encodeURIComponent(product.product_code)}/parts`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parts: editingParts.map((part) => ({
            part_no: String(part.part_no || '').trim(),
            name: String(part.name || '').trim(),
            spec: String(part.spec || '').trim(),
            qty: Number(part.qty || 0),
            manufacturer: String(part.manufacturer || '').trim(),
            alt_group:
              part.alt_group === null || part.alt_group === undefined || part.alt_group === ('' as any)
                ? null
                : Number(part.alt_group),
          })),
        }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: '物料清单保存失败' }));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }

      await onAfterSave?.();
      cancelEditBom();
    } catch (err: any) {
      setError(`物料清单保存失败: ${err.message}`);
    } finally {
      setSavingBom(false);
    }
  };

  return {
    editingProductKey,
    editingParts,
    selectedAltRows,
    savingBom,
    startEditBom,
    cancelEditBom,
    updateEditingPart,
    addEditingPart,
    removeEditingPart,
    toggleAltRowSelection,
    applySelectedAsAltGroup,
    clearSelectedAltGroup,
    saveBomParts,
  };
};
