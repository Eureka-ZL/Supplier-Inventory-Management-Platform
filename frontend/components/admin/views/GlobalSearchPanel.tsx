import React, { useEffect, useMemo, useState } from 'react';
import { Supplier } from '../../../types';
import { Search, X, FileText, ArrowRight, ChevronDown, Building2, PackageSearch } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { EmptyState } from '../../ui/EmptyState';

interface GlobalSearchPanelProps {
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    setActiveTab: (tab: string) => void;
    searchedOrders: any[];
    matchedSuppliers: Supplier[];
    suppliersList: Supplier[];
    setSelectedSupplierName: (name: string) => void;
    setSelectedOrderId: (id: string | null) => void;
}

interface SearchSupplierGroup {
    supplier: Supplier | null;
    supplierName: string;
    categories: string[];
    orders: any[];
    matchesSupplier: boolean;
}

export const GlobalSearchPanel: React.FC<GlobalSearchPanelProps> = ({
    searchQuery, setSearchQuery, setActiveTab,
    searchedOrders, matchedSuppliers, suppliersList,
    setSelectedSupplierName, setSelectedOrderId
}) => {
    const [expandedSuppliers, setExpandedSuppliers] = useState<Record<string, boolean>>({});

    const groupedResults = useMemo<SearchSupplierGroup[]>(() => {
        const supplierMap = new Map<string, Supplier>(
            suppliersList.map((supplier) => [supplier.name, supplier])
        );
        const resultMap = new Map<string, SearchSupplierGroup>();

        const ensureGroup = (supplierName: string): SearchSupplierGroup => {
            const existing = resultMap.get(supplierName);
            if (existing) return existing;

            const supplier = supplierMap.get(supplierName) || null;
            const group: SearchSupplierGroup = {
                supplier,
                supplierName,
                categories: supplier?.category || [],
                orders: [],
                matchesSupplier: false,
            };
            resultMap.set(supplierName, group);
            return group;
        };

        matchedSuppliers.forEach((supplier) => {
            const group = ensureGroup(supplier.name);
            group.supplier = supplier;
            group.categories = supplier.category || [];
            group.matchesSupplier = true;
        });

        searchedOrders.forEach((order) => {
            const group = ensureGroup(order.supplierName);
            group.orders.push(order);
        });

        return Array.from(resultMap.values()).sort((a, b) => {
            if (b.orders.length !== a.orders.length) {
                return b.orders.length - a.orders.length;
            }
            if (a.matchesSupplier !== b.matchesSupplier) {
                return Number(b.matchesSupplier) - Number(a.matchesSupplier);
            }
            return a.supplierName.localeCompare(b.supplierName, 'zh-CN');
        });
    }, [matchedSuppliers, searchedOrders, suppliersList]);

    useEffect(() => {
        setExpandedSuppliers({});
    }, [searchQuery]);

    const toggleSupplier = (supplierName: string) => {
        setExpandedSuppliers((prev) => ({
            ...prev,
            [supplierName]: !prev[supplierName],
        }));
    };

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            <div className="p-6 pb-0">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-6">
                    <div className="flex items-center gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                placeholder="输入交料单号、物料编码、物料名称或供应商名称进行查询..."
                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <button
                            onClick={() => {
                                setSearchQuery('');
                                setActiveTab('overview');
                            }}
                            className="px-4 py-3 bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900 rounded-xl font-medium transition-colors flex items-center gap-2 flex-shrink-0"
                            title="退出搜索并返回看板"
                        >
                            <X className="w-5 h-5" />
                            退出查询
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-hidden px-6 pb-6">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-full">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <FileText className="w-5 h-5 text-blue-500" />
                            查询结果
                            <span className="text-sm font-normal text-slate-500">
                                ({groupedResults.length} 个供应商 / {searchedOrders.length} 个订单)
                            </span>
                        </h3>
                    </div>

                    <div className="overflow-y-auto flex-1 p-6">
                        {!searchQuery.trim() ? (
                            <EmptyState
                                icon={<Search className="w-12 h-12 text-slate-300" />}
                                title="输入关键词开始查询"
                                description="可按供应商名称、交料单号、物料编码或物料名称进行检索。"
                            />
                        ) : groupedResults.length > 0 ? (
                            <div className="space-y-4">
                                {groupedResults.map((group) => {
                                    const isExpanded = !!expandedSuppliers[group.supplierName];

                                    return (
                                        <div
                                            key={group.supplierName}
                                            className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"
                                        >
                                            <button
                                                onClick={() => toggleSupplier(group.supplierName)}
                                                className="w-full px-5 py-4 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors text-left"
                                            >
                                                <div className="flex items-start gap-3 min-w-0">
                                                    <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
                                                        <Building2 className="w-5 h-5 text-blue-600" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <h4 className="text-base font-bold text-slate-800">
                                                                {group.supplierName}
                                                            </h4>
                                                            <Badge status={group.orders.length > 0 ? 'info' : 'gray'}>
                                                                {group.orders.length} 个订单
                                                            </Badge>
                                                        </div>
                                                        <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-slate-500">
                                                            {group.categories.length > 0 ? (
                                                                group.categories.slice(0, 2).map((category) => (
                                                                    <span
                                                                        key={category}
                                                                        className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200"
                                                                    >
                                                                        {category}
                                                                    </span>
                                                                ))
                                                            ) : (
                                                                <span className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200">
                                                                    暂无分类
                                                                </span>
                                                            )}
                                                            <span>
                                                                {group.orders.length > 0 ? '展开后查看命中订单' : '当前只命中供应商信息'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 flex-shrink-0">
                                                    <button
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setSearchQuery('');
                                                            setSelectedSupplierName(group.supplierName);
                                                            setSelectedOrderId(null);
                                                            setActiveTab('overview');
                                                        }}
                                                        className="px-3 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-colors"
                                                    >
                                                        查看档案
                                                    </button>
                                                    <ChevronDown
                                                        className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                                    />
                                                </div>
                                            </button>

                                            {isExpanded && (
                                                <div className="px-5 pb-5 border-t border-slate-100 bg-slate-50/70">
                                                    {group.orders.length > 0 ? (
                                                        <div className="space-y-3 pt-4">
                                                            {group.orders.map((order) => {
                                                                const docCount = order.documents
                                                                    ? Object.values(order.documents).filter((doc: any) => doc?.url).length
                                                                    : 0;
                                                                const requiredCount = 5;
                                                                const progress = Math.min(100, Math.round((docCount / requiredCount) * 100));

                                                                return (
                                                                    <div
                                                                        key={`${group.supplierName}-${order.id}`}
                                                                        className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-4"
                                                                    >
                                                                        <div className="min-w-0 flex-1">
                                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                                <span className="text-sm font-bold text-slate-800">
                                                                                    {order.id}
                                                                                </span>
                                                                                <Badge status={order.status} />
                                                                            </div>
                                                                            <div className="mt-2 text-sm text-slate-700 font-medium truncate">
                                                                                {order.partName || '未提供物料名称'}
                                                                            </div>
                                                                            <div className="mt-1 text-xs text-slate-500">
                                                                                物料编码：{order.partNumber || '未提供'}
                                                                            </div>
                                                                            <div className="mt-3 flex items-center gap-2">
                                                                                <div className="flex-1 max-w-[180px] h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                                    <div
                                                                                        className={`h-full rounded-full ${progress === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                                                                                        style={{ width: `${progress}%` }}
                                                                                    />
                                                                                </div>
                                                                                <span className="text-xs text-slate-500">
                                                                                    文档 {docCount}/{requiredCount}
                                                                                </span>
                                                                            </div>
                                                                        </div>

                                                                        <button
                                                                            onClick={() => {
                                                                                setSearchQuery('');
                                                                                setSelectedSupplierName(order.supplierName);
                                                                                setSelectedOrderId(order.id);
                                                                                setActiveTab('orders');
                                                                            }}
                                                                            className="px-3 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-colors flex items-center gap-1 flex-shrink-0"
                                                                        >
                                                                            查看订单
                                                                            <ArrowRight className="w-4 h-4" />
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <div className="pt-4">
                                                            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 flex items-center gap-3">
                                                                <div className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                                                                    <PackageSearch className="w-5 h-5 text-slate-400" />
                                                                </div>
                                                                <div>
                                                                    <div className="text-sm font-semibold text-slate-700">
                                                                        当前供应商已命中，但没有匹配订单
                                                                    </div>
                                                                    <div className="text-xs text-slate-500 mt-1">
                                                                        可以直接进入企业档案查看联系人、资质和开户信息。
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <EmptyState
                                icon={<Search className="w-12 h-12 text-slate-300" />}
                                title="未找到匹配结果"
                                description="请尝试输入更完整的供应商名称、交料单号、物料编码或物料名称。"
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
