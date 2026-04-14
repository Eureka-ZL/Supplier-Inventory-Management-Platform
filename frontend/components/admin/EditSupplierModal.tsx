import React from 'react';
import { Edit, Building2, Users, Phone, Mail, FileText, Save, Plus } from 'lucide-react';
import { Supplier, SupplierCategory } from '../../types';
import { Modal } from '../ui/Modal';

interface EditSupplierModalProps {
    isOpen: boolean;
    onClose: () => void;
    editingSupplier: Supplier | null;
    editFormData: any;
    setEditFormData: (data: any) => void;
    handleUpdateSupplier: () => void;
}

export const EditSupplierModal: React.FC<EditSupplierModalProps> = ({
    isOpen, onClose, editingSupplier, editFormData, setEditFormData, handleUpdateSupplier
}) => {
    return (
        <Modal
            isOpen={isOpen && !!editingSupplier}
            onClose={onClose}
            maxWidth="4xl"
            title={
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100/50 flex items-center justify-center border border-blue-100/30">
                        <Edit className="w-5 h-5 text-blue-600" />
                    </div>
                    <span className="text-[20px] font-bold text-slate-800 tracking-tight">编辑供应商资料</span>
                </div>
            }
            contentClassName="p-6 md:p-8 bg-slate-50/30"
            footer={
                <>
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 hover:text-slate-800 transition-all focus:outline-none focus:ring-2 focus:ring-slate-200"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleUpdateSupplier}
                        className="px-8 py-2.5 bg-blue-600 text-white font-bold rounded-xl shadow-[0_4px_14px_0_rgba(37,99,235,0.39)] hover:bg-blue-700 hover:shadow-[0_6px_20px_rgba(37,99,235,0.23)] hover:transform hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/50 flex items-center gap-2"
                    >
                        <Save className="w-4 h-4" /> 保存所有更改
                    </button>
                </>
            }
        >
            {editingSupplier && editFormData ? (
                <div className="max-w-3xl mx-auto space-y-8">
                    {/* Section 1: Basic Info */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
                        <h3 className="text-[15px] font-bold text-slate-800 border-b border-slate-50 pb-3 flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-slate-400" /> 基础信息
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="md:col-span-2">
                                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">供应商全称 <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={editFormData?.name || ''}
                                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-[14px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                                    placeholder="输入完整的公司名称"
                                />
                            </div>

                            <div>
                                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">供应商编码</label>
                                <input
                                    type="text"
                                    value={editFormData?.code || ''}
                                    onChange={(e) => setEditFormData({ ...editFormData, code: e.target.value })}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-[14px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                                    placeholder="例如: V10023"
                                />
                            </div>

                            <div>
                                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">供应商分类</label>
                                <select
                                    value={Array.isArray(editFormData?.category) ? editFormData.category[0] : editFormData?.category || ''}
                                    onChange={(e) => setEditFormData({ ...editFormData, category: [e.target.value] })}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-[14px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white appearance-none cursor-pointer"
                                    style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: `right 0.5rem center`, backgroundRepeat: `no-repeat`, backgroundSize: `1.5em 1.5em` }}
                                >
                                    <option value="" disabled>请选择分类</option>
                                    {Object.entries(SupplierCategory).map(([key, value]) => (
                                        <option key={key} value={value as string}>{value as string}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Section 2: Contact Info */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
                        <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                            <h3 className="text-[15px] font-bold text-slate-800 flex items-center gap-2">
                                <Users className="w-4 h-4 text-slate-400" /> 联系人信息
                            </h3>
                            <button
                                type="button"
                                onClick={() => setEditFormData({
                                    ...editFormData,
                                    contacts: [...(editFormData?.contacts || []), { name: '', title: '', phone: '', email: '', is_primary: false }]
                                })}
                                className="text-[13px] text-blue-600 font-bold hover:text-blue-700 flex items-center gap-1 bg-blue-50/50 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors border border-blue-100/50"
                            >
                                <Plus className="w-3.5 h-3.5" /> 添加联系人
                            </button>
                        </div>

                        <div className="space-y-4">
                            {editFormData?.contacts?.map((contact: any, index: number) => (
                                <div key={index} className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5 bg-slate-50/80 rounded-xl relative border border-slate-100/50 hover:border-blue-100/50 transition-colors group">
                                    <div className="absolute top-4 right-4 flex items-center gap-4">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="primaryContact"
                                                checked={contact.is_primary}
                                                onChange={() => {
                                                    const newContacts = editFormData.contacts.map((c: any, i: number) => ({
                                                        ...c,
                                                        is_primary: i === index
                                                    }));
                                                    setEditFormData({ ...editFormData, contacts: newContacts });
                                                }}
                                                className="w-4 h-4 text-blue-600 border-slate-300 focus:ring-blue-500"
                                            />
                                            <span className="text-[13px] font-medium text-slate-600">设为主联系人</span>
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const newContacts = editFormData.contacts.filter((_: any, i: number) => i !== index);
                                                setEditFormData({ ...editFormData, contacts: newContacts });
                                            }}
                                            className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            删除
                                        </button>
                                    </div>

                                    <div>
                                        <label className="block text-[12px] font-semibold text-slate-500 mb-1.5 ml-1">姓名</label>
                                        <input
                                            type="text"
                                            value={contact.name || ''}
                                            onChange={(e) => {
                                                const newContacts = [...editFormData.contacts];
                                                newContacts[index] = { ...newContacts[index], name: e.target.value };
                                                setEditFormData({ ...editFormData, contacts: newContacts });
                                            }}
                                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white"
                                            placeholder="姓名"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[12px] font-semibold text-slate-500 mb-1.5 ml-1">职务</label>
                                        <input
                                            type="text"
                                            value={contact.title || contact.position || ''}
                                            onChange={(e) => {
                                                const newContacts = [...editFormData.contacts];
                                                newContacts[index] = { ...newContacts[index], title: e.target.value };
                                                setEditFormData({ ...editFormData, contacts: newContacts });
                                            }}
                                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white"
                                            placeholder="如: 销售经理"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[12px] font-semibold text-slate-500 mb-1.5 ml-1 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> 手机号</label>
                                        <input
                                            type="text"
                                            value={contact.phone || ''}
                                            onChange={(e) => {
                                                const newContacts = [...editFormData.contacts];
                                                newContacts[index] = { ...newContacts[index], phone: e.target.value };
                                                setEditFormData({ ...editFormData, contacts: newContacts });
                                            }}
                                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white font-mono"
                                            placeholder="手机号码"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[12px] font-semibold text-slate-500 mb-1.5 ml-1 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> 电子邮箱</label>
                                        <input
                                            type="email"
                                            value={contact.email || ''}
                                            onChange={(e) => {
                                                const newContacts = [...editFormData.contacts];
                                                newContacts[index] = { ...newContacts[index], email: e.target.value };
                                                setEditFormData({ ...editFormData, contacts: newContacts });
                                            }}
                                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white"
                                            placeholder="example@corp.com"
                                        />
                                    </div>
                                </div>
                            ))}
                            {(!editFormData?.contacts || editFormData.contacts.length === 0) && (
                                <div className="text-center py-8 text-slate-400 text-[14px] border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                                    暂无联系人，请点击上方按钮添加
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Section 3: Additional Details */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
                        <h3 className="text-[15px] font-bold text-slate-800 border-b border-slate-50 pb-3 flex items-center gap-2">
                            <FileText className="w-4 h-4 text-slate-400" /> 补充资料
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="md:col-span-2">
                                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">公司地址</label>
                                <input
                                    type="text"
                                    value={editFormData?.address || ''}
                                    onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-[14px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                                    placeholder="详细办公/工厂地址"
                                />
                            </div>

                            <div>
                                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">座机/传真</label>
                                <input
                                    type="text"
                                    value={editFormData?.office_phone || editFormData?.fax || ''}
                                    onChange={(e) => setEditFormData({ ...editFormData, office_phone: e.target.value })}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-[14px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                    placeholder="固定电话"
                                />
                            </div>

                            <div>
                                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">官方网站</label>
                                <input
                                    type="text"
                                    value={editFormData?.website || ''}
                                    onChange={(e) => setEditFormData({ ...editFormData, website: e.target.value })}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-[14px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                    placeholder="www.example.com"
                                />
                            </div>

                            <div className="md:col-span-2">
                                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">其它备注</label>
                                <textarea
                                    value={editFormData?.notes || ''}
                                    onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-[14px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none min-h-[100px]"
                                    placeholder="可以在这里输入补充说明..."
                                />
                            </div>
                        </div>
                    </div>

                    {/* Status Flags */}
                    <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-100 flex flex-wrap gap-6">
                        {[
                            { id: 'is_active', label: '激活状态' },
                            { id: 'is_new', label: '标记为新供应商' },
                            { id: 'is_site_inspected', label: '已现场考察' }
                        ].map((flag) => (
                            <label key={flag.id} className="flex items-center gap-2.5 cursor-pointer group">
                                <div className="relative flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={editFormData?.[flag.id] || false}
                                        onChange={(e) => setEditFormData({ ...editFormData, [flag.id]: e.target.checked })}
                                        className="peer sr-only"
                                    />
                                    <div className="w-5 h-5 border-2 border-slate-300 rounded transition-colors peer-checked:border-emerald-500 peer-checked:bg-emerald-500 group-hover:border-slate-400"></div>
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 peer-checked:opacity-100 text-white transition-opacity">
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                    </div>
                                </div>
                                <span className="text-[14px] font-medium text-slate-700 select-none group-hover:text-slate-900">{flag.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
            ) : null}
        </Modal>
    );
};
