import type { InventoryAdjustmentEvent } from '../../../services/api';
import type { InventoryItem } from './types';

export const normalizePartNo = (value?: string | null) => String(value || '').trim().toUpperCase();

export const resolveItemType = (item: InventoryItem) => {
  if (item.item_type) return item.item_type;
  if (item.category?.includes('半成品')) return 'semifinished';
  if (item.category?.includes('成品')) return 'finished_goods';
  return 'raw_material';
};

export const isProductOrSemifinished = (item: InventoryItem) => {
  const itemType = resolveItemType(item);
  return itemType === 'finished_goods' || itemType === 'semifinished';
};

const PRODUCT_SORT_RULES: Array<{ label: string; keywords: string[] }> = [
  { label: '医美版', keywords: ['医美版', '医美'] },
  { label: '雅诗兰黛版', keywords: ['雅诗兰黛', 'estee'] },
  { label: '樊文花版', keywords: ['樊文花'] },
  { label: 'EVELAB', keywords: ['evelab insight', 'evelab'] },
  { label: 'ELI版', keywords: ['eli', '伊丽汇'] },
  { label: 'Meitu版', keywords: ['meitu', '美图', '美日版'] },
  { label: '欧洲版', keywords: ['欧洲版'] },
  { label: '香奈儿版', keywords: ['香奈儿'] },
  { label: 'Dior版', keywords: ['dior'] },
  { label: '格丽缇版', keywords: ['格丽缇'] },
  { label: '完美版', keywords: ['完美'] },
  { label: '无LOGO', keywords: ['无logo', '无 logo'] },
];

export const getProductSortBucket = (item: InventoryItem) => {
  const text = [
    item.description || '',
    item.raw_part_no || '',
    item.part_no || '',
  ].join(' ').toLowerCase();
  const matchIndex = PRODUCT_SORT_RULES.findIndex((rule) =>
    rule.keywords.some((keyword) => text.includes(keyword.toLowerCase()))
  );
  if (matchIndex >= 0) {
    return {
      rank: matchIndex,
      label: PRODUCT_SORT_RULES[matchIndex].label,
    };
  }
  return {
    rank: PRODUCT_SORT_RULES.length,
    label: '其他',
  };
};

export const getItemCurrentQuantity = (item: InventoryItem) => {
  const goodQty = item.good_qty ?? item.quantity ?? 0;
  const badQty = item.bad_qty ?? 0;
  return goodQty + badQty;
};

export const getEffectivePartNo = (event: InventoryAdjustmentEvent) => (
  normalizePartNo(event.matched_part_no || event.part_no)
);

export const getSignedDelta = (event: InventoryAdjustmentEvent) => {
  const quantity = Number(event.quantity || 0);
  if (event.change_type === 'outbound' || event.change_type === 'scrap') return -quantity;
  return quantity;
};

export const getActorDisplay = (event: InventoryAdjustmentEvent) => {
  if (event.actor_name?.trim()) return event.actor_name.trim();
  const sender = String(event.sender || '').trim();
  const angleMatch = sender.match(/^(.*?)\s*</);
  if (angleMatch?.[1]?.trim()) return angleMatch[1].replace(/^"+|"+$/g, '').trim();
  const emailMatch = sender.match(/([^<@\s]+)@/);
  return emailMatch?.[1] || '邮件申请人';
};

export const getOriginalEmailBody = (event: InventoryAdjustmentEvent) => {
  const value = String(event.body_text || '').trim();
  return value || '未保存原邮件正文';
};

export const formatChangeType = (changeType: string) => {
  if (changeType === 'outbound') return '领用出库';
  if (changeType === 'inbound') return '补入入库';
  if (changeType === 'return') return '归还入库';
  if (changeType === 'scrap') return '报废扣减';
  return '库存调整';
};

export const formatDateTime = (value?: string | null) => {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};
