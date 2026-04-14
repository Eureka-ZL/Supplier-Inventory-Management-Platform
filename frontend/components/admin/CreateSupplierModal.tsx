import React, { useState } from 'react';
import { Building2, User } from 'lucide-react';
import { SupplierCategory } from '../../types';
import { Modal } from '../ui/Modal';
interface CreateSupplierModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (formData: CreateSupplierFormData) => Promise<void>;
}
export interface CreateSupplierFormData {
    name: string;
    code: string;
    category: string[];
    address: string;
    contacts: { name: string; position: string; phone: string; email: string }[];
    office_phone: string;
    business_license: string;
    fax: string;
    website: string;
    notes: string;
    is_new: boolean;
    is_site_inspected: boolean;
    create_account: boolean;
}

const initialFormData: CreateSupplierFormData = {
    name: '',
    code: '',
    category: [],
    address: '',
    contacts: [{ name: '', position: '', phone: '', email: '' }],
    office_phone: '',
    business_license: '',
    fax: '',
    website: '',
    notes: '',
    is_new: false,
    is_site_inspected: false,
    create_account: true,
};

export const CreateSupplierModal: React.FC<CreateSupplierModalProps> = ({
    isOpen, onClose, onSubmit
}) => {
    const [formData, setFormData] = useState<CreateSupplierFormData>({ ...initialFormData });

    const handleCreate = async () => {
        await onSubmit(formData);
        setFormData({ ...initialFormData });
    };

    const handleClose = () => {
        setFormData({ ...initialFormData });
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title="新增供应商"
            description="录入新的供应商基础信息"
            maxWidth="4xl"
            contentClassName="p-8"
            footer={
                <>
                    <button onClick={handleClose} className="px-6 py-2.5 border border-slate-300 text-slate-700 font-medium rounded-xl hover:bg-slate-100 transition-colors">取消</button>
                    <button onClick={handleCreate} className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95">确认创建</button>
                </>
            }
        >
            <div className="grid grid-cols-12 gap-6">
                        {/* Basic Info */}
                        <div className="col-span-12 font-bold text-slate-800 flex items-center gap-2 pb-2 border-b mb-2">
                            <Building2 className="w-4 h-4 text-blue-500" /> 企业基本信息
                        </div>

                        <div className="col-span-8">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">供应商全称 <span className="text-red-500">*</span></label>
                            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="输入供应商法定全称" className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" />
                        </div>
                        <div className="col-span-4">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">供应商编码</label>
                            <input type="text" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="SRM-00X" className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" />
                        </div>

                        <div className="col-span-12">
                            <label className="block text-sm font-medium text-slate-700 mb-2">供应商类别</label>
                            <div className="flex flex-wrap gap-3">
                                {Object.entries(SupplierCategory).map(([key, value]) => (
                                    <label key={key} className={`cursor-pointer px-4 py-2 rounded-lg border text-sm transition-all ${formData.category.includes(value)
                                        ? 'bg-blue-50 border-blue-500 text-blue-700 font-medium'
                                        : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300'
                                        }`}>
                                        <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={formData.category.includes(value)}
                                            onChange={(e) => {
                                                if (e.target.checked) setFormData({ ...formData, category: [...formData.category, value] });
                                                else setFormData({ ...formData, category: formData.category.filter(c => c !== value) });
                                            }}
                                        />
                                        {value}
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Contact Info */}
                        <div className="col-span-12 font-bold text-slate-800 flex items-center gap-2 pb-2 border-b mb-2 mt-4">
                            <User className="w-4 h-4 text-purple-500" /> 下单联系人信息
                        </div>

                        <div className="col-span-3">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">联系人姓名</label>
                            <input type="text" value={formData.contacts[0]?.name || ''} onChange={(e) => setFormData({ ...formData, contacts: [{ ...formData.contacts[0], name: e.target.value }] })} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-purple-500" />
                        </div>
                        <div className="col-span-3">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">职务</label>
                            <input type="text" value={formData.contacts[0]?.position || ''} onChange={(e) => setFormData({ ...formData, contacts: [{ ...formData.contacts[0], position: e.target.value }] })} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-purple-500" />
                        </div>
                        <div className="col-span-3">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">手机号</label>
                            <input type="text" value={formData.contacts[0]?.phone || ''} onChange={(e) => setFormData({ ...formData, contacts: [{ ...formData.contacts[0], phone: e.target.value }] })} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-purple-500" />
                        </div>
                        <div className="col-span-3">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">邮箱</label>
                            <input type="email" value={formData.contacts[0]?.email || ''} onChange={(e) => setFormData({ ...formData, contacts: [{ ...formData.contacts[0], email: e.target.value }] })} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-purple-500" />
                        </div>

                        {/* Company Info */}
                        <div className="col-span-12 font-bold text-slate-800 flex items-center gap-2 pb-2 border-b mb-2 mt-4">
                            <Building2 className="w-4 h-4 text-slate-500" /> 公司更多详情
                        </div>

                        <div className="col-span-8">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">公司地址</label>
                            <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
                        </div>
                        <div className="col-span-4">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">公司座机</label>
                            <input type="text" value={formData.office_phone} onChange={(e) => setFormData({ ...formData, office_phone: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
                        </div>
                        <div className="col-span-4">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">营业执照号</label>
                            <input type="text" value={formData.business_license} onChange={(e) => setFormData({ ...formData, business_license: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
                        </div>
                        <div className="col-span-4">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">公司传真</label>
                            <input type="text" value={formData.fax} onChange={(e) => setFormData({ ...formData, fax: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
                        </div>
                        <div className="col-span-4">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">公司网站</label>
                            <input type="text" value={formData.website} onChange={(e) => setFormData({ ...formData, website: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
                        </div>

                        <div className="col-span-12">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">备注</label>
                            <input type="text" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
                        </div>

                        <div className="col-span-12 bg-slate-50 rounded-xl p-4 flex gap-6 mt-2">
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={formData.is_new} onChange={(e) => setFormData({ ...formData, is_new: e.target.checked })} className="w-4 h-4 rounded text-blue-600" />
                                <span className="text-slate-700 font-medium">是否为新引入供应商</span>
                            </label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={formData.is_site_inspected} onChange={(e) => setFormData({ ...formData, is_site_inspected: e.target.checked })} className="w-4 h-4 rounded text-blue-600" />
                                <span className="text-slate-700 font-medium">已完成现场考察</span>
                            </label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={formData.create_account} onChange={(e) => setFormData({ ...formData, create_account: e.target.checked })} className="w-4 h-4 rounded text-blue-600" />
                                <span className="text-slate-700 font-medium">同时创建登录账户</span>
                            </label>
                        </div>
                    </div>
        </Modal>
    );
};
