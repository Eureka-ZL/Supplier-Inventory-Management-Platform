import React, { useState } from 'react';
import { PurchaseOrder, DocType, OrderStatus, REQUIRED_DOCS, SupplierDocument } from '../types';
import { Upload, CheckCircle, AlertCircle, FileText, Plus, X, Trash2, Eye, Clock } from 'lucide-react';
import { orderApi, supplierApi, storageApi } from '../services/api';
import { ConfirmModal } from './admin/ConfirmModal';
import { notify } from './ui/NotificationCenter';

interface SupplierViewProps {
  orders: PurchaseOrder[];
  onUpdateOrder: (updatedOrder: PurchaseOrder) => void;
  onCreateOrder: (newOrder: PurchaseOrder) => Promise<void>;
  currentSupplierName: string;
}

export const SupplierView: React.FC<SupplierViewProps> = ({ orders, onUpdateOrder, onCreateOrder, currentSupplierName }) => {
  // Filter orders for this supplier
  const myOrders = orders.filter(o => o.supplierName === currentSupplierName);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(myOrders[0]?.id || null);
  const [activeTab, setActiveTab] = useState<'orders' | 'qualification'>('orders');
  const [supplierDocs, setSupplierDocs] = useState<SupplierDocument[]>([]);

  // History Modal State
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [historyDocs, setHistoryDocs] = useState<any[]>([]);
  const [selectedHistoryDocId, setSelectedHistoryDocId] = useState<number | null>(null);
  const [activeHistoryDocType, setActiveHistoryDocType] = useState<DocType | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Create Order Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newOrderForm, setNewOrderForm] = useState({
    id: '',
    partName: '',
    partNumber: ''
  });
  const [deleteDocType, setDeleteDocType] = useState<DocType | null>(null);

  const activeOrder = myOrders.find(o => o.id === selectedOrderId);

  // Set selectedOrder to the first one if the current selection is invalid
  React.useEffect(() => {
    if (activeTab === 'orders' && !activeOrder && myOrders.length > 0) {
      setSelectedOrderId(myOrders[0].id);
    }
  }, [myOrders, activeOrder, activeTab]);

  // Fetch supplier docs
  const fetchSupplierDocs = async () => {
    try {
      const docs = await supplierApi.getDocuments();
      setSupplierDocs(docs);
    } catch (err) {
      console.error("Failed to fetch supplier docs", err);
    }
  };

  React.useEffect(() => {
    fetchSupplierDocs();
  }, []);

  const handleOpenHistory = async (docType: DocType) => {
    setActiveHistoryDocType(docType);
    setIsHistoryModalOpen(true);
    setIsLoadingHistory(true);
    try {
      const history = await orderApi.getDocumentHistory(docType);
      setHistoryDocs(history);
    } catch (error) {
      console.error('Failed to load history', error);
      notify.error('加载历史记录失败');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleReuseDocument = async () => {
    if (!activeOrder || !selectedHistoryDocId || !activeHistoryDocType) return;

    try {
      await orderApi.reuseDocument(activeOrder.id, selectedHistoryDocId, activeHistoryDocType);

      // Refresh order
      const updated = await orderApi.getOrder(activeOrder.id);
      onUpdateOrder(updated);

      setIsHistoryModalOpen(false);
      setSelectedHistoryDocId(null);
      setActiveHistoryDocType(null);
    } catch (error: any) {
      notify.error('复用失败: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleFileUpload = async (docType: DocType, file: File) => {
    if (!activeOrder) return;

    // 文件大小限制检查 (50MB)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      notify.warning('文件过大，最大支持 50MB');
      return;
    }

    // 文件类型检查
    const fileName = file.name.toLowerCase();
    let allowedExtensions: string[];
    let errorMessage: string;

    if (docType === DocType.MSDS || docType === DocType.ROHS) {
      allowedExtensions = ['.pdf', '.zip', '.rar', '.7z', '.tar', '.gz', '.tgz'];
      errorMessage = '不支持的文件类型。允许的格式: PDF 或压缩包 (ZIP, RAR, 7Z, TAR, GZ)';
    } else {
      allowedExtensions = ['.pdf'];
      errorMessage = '不支持的文件类型。允许的格式: PDF';
    }

    const isAllowed = allowedExtensions.some(ext => fileName.endsWith(ext));
    if (!isAllowed) {
      notify.warning(errorMessage);
      return;
    }

    try {
      await orderApi.uploadDocument(activeOrder.id, docType, file);
      // 刷新订单数据
      const updated = await orderApi.getOrder(activeOrder.id);
      onUpdateOrder(updated);
    } catch (error: any) {
      notify.error('文件上传失败: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleFileDelete = (docType: DocType) => {
    setDeleteDocType(docType);
  };

  const confirmDeleteFile = async () => {
    if (!activeOrder || !deleteDocType) return;
    try {
      await orderApi.deleteDocument(activeOrder.id, deleteDocType);
      // 刷新订单数据
      const updated = await orderApi.getOrder(activeOrder.id);
      onUpdateOrder(updated);
      setDeleteDocType(null);
    } catch (error: any) {
      notify.error('文件删除失败: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleSupplierDocUpload = async (file: File) => {
    try {
      if (file.size > 50 * 1024 * 1024) {
        notify.warning('文件过大，最大支持 50MB');
        return;
      }
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        notify.warning('只支持 PDF 格式');
        return;
      }
      await supplierApi.uploadDocument('REACH', file);
      await fetchSupplierDocs();
    } catch (error: any) {
      notify.error('上传失败: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleSubmitReview = async () => {
    if (!activeOrder) return;

    // Check Order Level Docs
    const missingOrderDocs = REQUIRED_DOCS.filter(type => !activeOrder.documents[type]?.fileName);

    // Check Supplier Level Docs (REACH)
    const hasReach = supplierDocs.some(d => d.doc_type === 'REACH');

    if (missingOrderDocs.length > 0) {
      notify.warning(`无法提交：缺少必要文件 - ${missingOrderDocs.join(', ')}`);
      return;
    }

    if (!hasReach) {
      notify.warning('无法提交：缺少 REACH 报告，请前往“企业资质”页面上传。');
      return;
    }

    try {
      await orderApi.submitForReview(activeOrder.id);
      // 刷新订单数据
      const updated = await orderApi.getOrder(activeOrder.id);
      onUpdateOrder(updated);
    } catch (error: any) {
      notify.error('提交审核失败: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrderForm.id || !newOrderForm.partName || !newOrderForm.partNumber) {
      notify.warning("请填写所有必填字段");
      return;
    }

    if (orders.some(o => o.id === newOrderForm.id)) {
      notify.warning("该 PO 单号已存在，请检查单号是否正确。");
      return;
    }

    try {
      const newOrder = await orderApi.createOrder({
        id: newOrderForm.id,
        partNumber: newOrderForm.partNumber,
        partName: newOrderForm.partName,
        supplierName: currentSupplierName,
      });

      await onCreateOrder(newOrder);
      setIsCreateModalOpen(false);
      setSelectedOrderId(newOrder.id);
      setNewOrderForm({ id: '', partName: '', partNumber: '' });
    } catch (error: any) {
      notify.error('创建订单失败: ' + (error.response?.data?.detail || error.message));
    }
  };

  const uploadedCount = activeOrder ? REQUIRED_DOCS.filter(t => activeOrder.documents[t]?.fileName).length : 0;
  // Calculate total progress including REACH
  // Total steps = REQUIRED_DOCS.length + 1 (REACH)
  // But strictly speaking, REACH is now separate. Let's keep the progress bar for Order Docs only strictly, 
  // or maybe add a visual indicator for REACH.
  // Let's stick to Order Docs for progress bar, but maybe show an alert if REACH is missing.

  const progress = (uploadedCount / REQUIRED_DOCS.length) * 100;
  const isLocked = activeOrder ? (activeOrder.status === OrderStatus.READY_FOR_REVIEW || activeOrder.status === OrderStatus.APPROVED || activeOrder.status === OrderStatus.RECEIVED) : true;
  const hasReach = supplierDocs.some(d => d.doc_type === 'REACH');

  return (
    <div className="flex flex-col h-full bg-gray-100 relative">
      <ConfirmModal
        isOpen={!!deleteDocType}
        onClose={() => setDeleteDocType(null)}
        onConfirm={confirmDeleteFile}
        title="确认删除文件"
        message={deleteDocType ? `确定要删除 ${deleteDocType} 吗？删除后需要重新上传。` : ''}
        type="warning"
        confirmLabel="确认删除"
      />
      {/* History Modal */}
      {isHistoryModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
              <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-500" />
                选择历史 {activeHistoryDocType} 文件
              </h3>
              <button onClick={() => setIsHistoryModalOpen(false)} className="hover:bg-gray-200 p-1 rounded-full text-gray-500"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {isLoadingHistory ? (
                <div className="text-center py-8 text-gray-500">加载历史记录中...</div>
              ) : historyDocs.length === 0 ? (
                <div className="text-center py-8 text-gray-400">暂无该类型的历史上传记录</div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-12 text-xs font-semibold text-gray-500 uppercase px-4 pb-2 border-b">
                    <div className="col-span-1">选择</div>
                    <div className="col-span-5">文件名</div>
                    <div className="col-span-3">关联物料</div>
                    <div className="col-span-3 text-right">上传时间</div>
                  </div>
                  {historyDocs.map((doc) => (
                    <label
                      key={doc.id}
                      className={`grid grid-cols-12 items-center p-3 rounded-lg border cursor-pointer transition-all hover:bg-blue-50 ${selectedHistoryDocId === doc.id ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50' : 'border-gray-200'}`}
                    >
                      <div className="col-span-1">
                        <input
                          type="radio"
                          name="historyDoc"
                          className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                          checked={selectedHistoryDocId === doc.id}
                          onChange={() => setSelectedHistoryDocId(doc.id)}
                        />
                      </div>
                      <div className="col-span-5 font-medium text-gray-700 truncate pr-2" title={doc.fileName}>
                        {doc.fileName}
                      </div>
                      <div className="col-span-3 text-sm text-gray-600 truncate bg-gray-100 px-2 py-0.5 rounded w-fit max-w-full">
                        {doc.partNumber || '-'}
                      </div>
                      <div className="col-span-3 text-right text-xs text-gray-400">
                        {new Date(doc.uploadedAt).toLocaleDateString()}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t bg-gray-50 rounded-b-xl flex justify-end gap-3">
              <button
                onClick={() => setIsHistoryModalOpen(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
              >
                取消
              </button>
              <button
                disabled={!selectedHistoryDocId}
                onClick={handleReuseDocument}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold shadow-md transition-all active:scale-95"
              >
                确认复用
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Top Tab Bar or Sidebar Tab Switcher */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar */}
        <div className="w-full md:w-64 bg-white border-r flex flex-col">
          {/* Tab Switcher */}
          <div className="flex border-b">
            <button
              className={`flex-1 py-3 text-sm font-medium ${activeTab === 'orders' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => setActiveTab('orders')}
            >
              我的交料单
            </button>
            <button
              className={`flex-1 py-3 text-sm font-medium ${activeTab === 'qualification' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => setActiveTab('qualification')}
            >
              企业资质
            </button>
          </div>

          {activeTab === 'orders' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 flex justify-between items-center bg-gray-50 border-b">
                <h2 className="font-bold text-gray-700">订单列表</h2>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="bg-blue-50 text-blue-600 hover:bg-blue-100 p-1.5 rounded-lg transition-colors"
                  title="新建交料任务"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {myOrders.length === 0 && (
                  <div className="text-sm text-gray-400 text-center py-4 border-2 border-dashed rounded-lg">
                    暂无订单
                  </div>
                )}
                {myOrders.map(order => (
                  <button
                    key={order.id}
                    onClick={() => setSelectedOrderId(order.id)}
                    className={`w-full text-left p-3 rounded-md text-sm transition-colors ${selectedOrderId === order.id ? 'bg-blue-50 border-l-4 border-blue-500 text-blue-700' : 'hover:bg-gray-50 text-gray-600'
                      }`}
                  >
                    <div className="font-medium truncate">{order.id}</div>
                    <div className="text-xs mt-1 truncate">{order.partName}</div>
                    <div className={`text-xs mt-2 px-2 py-0.5 rounded inline-block ${order.status === OrderStatus.REJECTED ? 'bg-red-100 text-red-600' :
                      order.status === OrderStatus.APPROVED ? 'bg-green-100 text-green-600' :
                        'bg-gray-200 text-gray-600'
                      }`}>
                      {order.status}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'qualification' && (
            <div className="p-6 text-sm text-gray-500">
              请在此上传企业级资质文件，这些文件将适用于您的所有交料任务。
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 p-8 overflow-y-auto bg-gray-100">
          {activeTab === 'orders' ? (
            /* Existing Order View */
            activeOrder ? (
              <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-sm p-6">
                <header className="mb-8 border-b pb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                        {activeOrder.partName}
                        <span className="text-sm font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded">{activeOrder.partNumber}</span>
                      </h1>
                      <p className="text-gray-500 mt-1">PO: {activeOrder.id}</p>
                    </div>
                    {activeOrder.status === OrderStatus.REJECTED && (
                      <div className="bg-red-50 border border-red-200 p-3 rounded text-sm text-red-700 max-w-sm">
                        <div className="font-bold flex items-center mb-1"><AlertCircle className="w-4 h-4 mr-1" /> 被驳回</div>
                        {activeOrder.rejectReason || "文件不符合要求，请查看具体说明。"}
                      </div>
                    )}
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-6">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">资料完整度 ({uploadedCount}/{REQUIRED_DOCS.length})</span>
                      <span className="text-blue-600 font-medium">{Math.round(progress)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                    </div>
                  </div>
                </header>

                {/* Warning if REACH missing */}
                {!hasReach && (
                  <div className="mb-6 bg-amber-50 border border-amber-200 p-4 rounded-lg flex items-center justify-between">
                    <div className="flex items-center text-amber-800">
                      <AlertCircle className="w-5 h-5 mr-2" />
                      <span>您的企业资质中缺少 <strong>REACH 报告</strong>，这将导致无法提交审核。</span>
                    </div>
                    <button
                      onClick={() => setActiveTab('qualification')}
                      className="text-sm bg-white border border-amber-300 text-amber-800 px-3 py-1 rounded hover:bg-amber-100"
                    >
                      去上传
                    </button>
                  </div>
                )}
                {hasReach && (
                  <div className="mb-6 bg-green-50 border border-green-200 p-3 rounded-lg flex items-center text-green-800 text-sm">
                    <CheckCircle className="w-4 h-4 mr-2" />
                    <span>REACH 报告 (企业资质) 已就绪</span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {REQUIRED_DOCS.map((docType) => {
                    const fileData = activeOrder.documents[docType];
                    const isUploaded = !!fileData?.fileName;

                    return (
                      <div key={docType} className={`border rounded-lg p-4 transition-all ${isUploaded ? 'border-green-200 bg-green-50' : 'border-gray-200 hover:border-blue-300'}`}>
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-2">
                            {isUploaded ? <CheckCircle className="text-green-500 w-5 h-5" /> : <FileText className="text-gray-400 w-5 h-5" />}
                            <h3 className="font-medium text-gray-800">{docType}</h3>
                          </div>
                          {isUploaded && <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded">已上传</span>}
                        </div>

                        {isUploaded ? (
                          <div className="text-sm text-gray-600 mb-3">
                            <p className="truncate font-mono">{fileData.fileName}</p>
                            <p className="text-xs text-gray-400 mt-1">{new Date(fileData.uploadedAt!).toLocaleString()}</p>
                          </div>
                        ) : (
                          <div className="mb-3">
                            <p className="text-sm text-gray-400 italic">请上传最新的 {docType}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              {(docType === DocType.MSDS || docType === DocType.ROHS) && '支持格式: PDF 或压缩包 (.zip, .rar, .7z 等)'}
                              {(docType === DocType.SPEC || docType === DocType.REPORT || docType === DocType.OTHER) && '支持格式: PDF'}
                            </p>
                          </div>
                        )}

                        <div className="mt-2 flex gap-2">
                          <input
                            type="file"
                            id={`file-${activeOrder.id}-${docType}`}
                            className="hidden"
                            accept={docType === DocType.MSDS || docType === DocType.ROHS ? '.pdf,.zip,.rar,.7z,.tar,.gz,.tgz' : '.pdf'}
                            disabled={isLocked}
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                handleFileUpload(docType, e.target.files[0]);
                              }
                            }}
                          />
                          {!isLocked && (
                            <>
                              <label
                                htmlFor={`file-${activeOrder.id}-${docType}`}
                                className={`flex-1 inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${isUploaded
                                  ? 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                                  : 'bg-blue-600 text-white hover:bg-blue-700'
                                  }`}
                              >
                                <Upload className="w-4 h-4 mr-2" />
                                {isUploaded ? '重新上传' : '点击上传'}
                              </label>
                              <button
                                onClick={() => handleOpenHistory(docType)}
                                className="px-3 py-2 text-sm font-medium rounded-md bg-white text-blue-600 border border-blue-200 hover:bg-blue-50 transition-colors"
                                title="从历史记录中复用"
                              >
                                <Clock className="w-4 h-4" />
                              </button>
                            </>
                          )}

                          {isUploaded && (
                            <>
                              <button
                                onClick={async () => {
                                  try {
                                    const url = await storageApi.getViewUrl(activeOrder.id, docType);
                                    window.open(url, '_blank');
                                  } catch (e: any) {
                                    notify.error('预览失败: ' + e.message);
                                  }
                                }}
                                className="px-3 py-2 text-sm font-medium rounded-md bg-white text-slate-600 border border-slate-300 hover:bg-slate-50 transition-colors"
                                title="预览文件"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              {!isLocked && (
                                <button
                                  onClick={() => handleFileDelete(docType)}
                                  className="px-3 py-2 text-sm font-medium rounded-md bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors"
                                  title="删除文件"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-8 border-t pt-6 flex justify-end">
                  <button
                    onClick={handleSubmitReview}
                    disabled={isLocked || uploadedCount < REQUIRED_DOCS.length || !hasReach}
                    className={`px-6 py-3 rounded-lg font-bold text-white shadow-lg transition-all ${isLocked || uploadedCount < REQUIRED_DOCS.length || !hasReach
                      ? 'bg-gray-300 cursor-not-allowed shadow-none'
                      : 'bg-green-600 hover:bg-green-700 hover:-translate-y-0.5'
                      }`}
                  >
                    {activeOrder.status === OrderStatus.PENDING_UPLOAD || activeOrder.status === OrderStatus.REJECTED
                      ? "资料齐套，提交审核"
                      : "等待审核中..."}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <Plus className="w-16 h-16 bg-gray-100 rounded-full p-4 mb-4" />
                <p>点击左侧栏顶部的 "+" 按钮创建新订单</p>
              </div>
            )
          ) : (
            /* Qualification View */
            <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-sm p-6">
              <header className="mb-8 border-b pb-4">
                <h1 className="text-2xl font-bold text-gray-800">企业资质管理</h1>
                <p className="text-gray-500 mt-1">此处的文档将应用于您的所有交料任务。</p>
              </header>

              <div className="space-y-6">
                {/* REACH Document Section */}
                <div className="border rounded-lg p-6 bg-gray-50">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-800 flex items-center">
                        REACH 报告
                        {hasReach ? (
                          <span className="ml-3 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center">
                            <CheckCircle className="w-3 h-3 mr-1" /> 已生效
                          </span>
                        ) : (
                          <span className="ml-3 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full flex items-center">
                            <AlertCircle className="w-3 h-3 mr-1" /> 未上传
                          </span>
                        )}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">
                        请上传最新的 REACH 符合性声明或测试报告。
                      </p>
                    </div>

                    {hasReach && (
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-900">
                          {supplierDocs.find(d => d.doc_type === 'REACH')?.file_name}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          上传于: {new Date(supplierDocs.find(d => d.doc_type === 'REACH')?.uploaded_at || '').toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>


                  <div className="mt-4 flex flex-col gap-4">
                    <div className="flex items-center gap-4">
                      <input
                        type="file"
                        id="reach-upload"
                        className="hidden"
                        accept=".pdf"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleSupplierDocUpload(e.target.files[0]);
                          }
                        }}
                      />
                      <label
                        htmlFor="reach-upload"
                        className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 cursor-pointer shadow-sm"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        {hasReach ? '更新 REACH 报告' : '上传 REACH 报告'}
                      </label>

                      {hasReach && (
                        <>
                          <button
                            onClick={async () => {
                              const doc = supplierDocs.find(d => d.doc_type === 'REACH');
                              if (doc) {
                                try {
                                  const url = await storageApi.getSupplierDocViewUrl(doc.id);
                                  window.open(url, '_blank');
                                } catch (e: any) {
                                  notify.error('预览失败: ' + e.message);
                                }
                              }
                            }}
                            className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-md hover:bg-slate-50 flex items-center"
                          >
                            <Eye className="w-4 h-4 mr-2" /> 预览
                          </button>

                        </>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">仅支持 PDF 格式，最大 50MB。</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Order Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-gray-50 px-6 py-4 border-b flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800">新建交料任务</h3>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PO 单号 (Purchase Order)</label>
                <input
                  type="text"
                  required
                  className="w-full border rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="例如: PO-2023-999"
                  value={newOrderForm.id}
                  onChange={e => setNewOrderForm({ ...newOrderForm, id: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">物料名称 (Part Name)</label>
                <input
                  type="text"
                  required
                  className="w-full border rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="例如: Ceramic Capacitor 100nF"
                  value={newOrderForm.partName}
                  onChange={e => setNewOrderForm({ ...newOrderForm, partName: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">物料编号 (Part Number)</label>
                <input
                  type="text"
                  required
                  className="w-full border rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="例如: PN-887766"
                  value={newOrderForm.partNumber}
                  onChange={e => setNewOrderForm({ ...newOrderForm, partNumber: e.target.value })}
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 py-2 border rounded-lg text-gray-600 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  创建任务
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
