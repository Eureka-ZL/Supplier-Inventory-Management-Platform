import React from 'react';
import { Supplier } from '../../../types';
import { storageApi } from '../../../services/api';
import {
    Building2, Users, ShieldCheck, MapPin, Calendar, ClipboardCheck,
    UserCheck, Phone, Mail, Globe, PhoneCall, AlertCircle, Eye, Download, Key, User, FileCheck
} from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { notify } from '../../ui/NotificationCenter';

interface SupplierOverviewTabProps {
    selectedSupplier: Supplier;
    isSuperAdmin: boolean;
    handleResetPassword: (id: number, name: string) => void;
}

export const SupplierOverviewTab: React.FC<SupplierOverviewTabProps> = ({
    selectedSupplier, isSuperAdmin, handleResetPassword
}) => {
    return (
        <div className="animate-in fade-in duration-300">
            <div className="space-y-5">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-stretch">
                    <div className="bg-white rounded-[24px] p-6 md:p-8 border border-slate-100 shadow-sm transition-shadow hover:shadow-md flex flex-col gap-6 xl:col-span-2 min-h-[280px]">
                    <div className="flex items-center gap-3 mb-2 shrink-0">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100/50 flex items-center justify-center border border-blue-100/30">
                            <Building2 className="w-5 h-5 text-blue-600" />
                        </div>
                        <h3 className="font-bold text-slate-800 text-[18px]">企业档案</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-8 gap-x-10 flex-1">
                        <div>
                            <label className="text-[12px] font-medium text-slate-400 mb-2 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-slate-300" /> 注册地址</label>
                            <div className="text-slate-800 font-medium leading-relaxed text-[15px] line-clamp-2">{selectedSupplier.address || <span className="text-slate-300 font-normal">未提供</span>}</div>
                        </div>

                        <div>
                            <label className="text-[12px] font-medium text-slate-400 mb-2 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-slate-300" /> 营业执照号</label>
                            <div className="text-slate-800 font-semibold text-[15px] font-mono truncate">{selectedSupplier.business_license || <span className="text-slate-300 font-normal">未提供</span>}</div>
                            <div className="text-slate-400 text-[12px] mt-1.5 flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-slate-300" /> {new Date(selectedSupplier.created_at).toLocaleDateString()} 建档</div>
                        </div>

                        <div className="sm:col-span-2 flex flex-col min-h-[120px]">
                            <label className="text-[12px] font-medium text-slate-400 mb-2 flex items-center gap-1.5 shrink-0"><ClipboardCheck className="w-4 h-4 text-slate-300" /> 备注与物料分类</label>
                            <div className="text-slate-600 leading-relaxed text-[14px] bg-slate-50/50 p-4 rounded-xl border border-slate-100 flex-1 overflow-y-auto custom-scrollbar">
                                {selectedSupplier.notes || <span className="text-slate-400 font-normal italic">暂无备注信息</span>}
                            </div>
                        </div>
                    </div>
                    </div>

                    <div className="bg-white rounded-[24px] border border-slate-100 shadow-sm flex flex-col overflow-hidden min-h-[280px] max-h-[420px]">
                        <div className="p-6 md:p-8 border-b border-slate-50 flex items-center justify-between shrink-0 bg-white relative z-10 pb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-50 to-purple-100/50 flex items-center justify-center border border-purple-100/30">
                                    <Users className="w-5 h-5 text-purple-600" />
                                </div>
                                <h3 className="font-bold text-slate-800 text-[18px]">核心联系人</h3>
                            </div>
                            <span className="text-[12px] font-semibold text-purple-700 bg-purple-50 px-3 py-1 rounded-lg border border-purple-100/50">
                                {selectedSupplier.contacts?.length || 0} 位
                            </span>
                        </div>

                        <div className="p-4 flex-1 overflow-y-auto custom-scrollbar bg-slate-50/30 max-h-[248px]">
                            {!selectedSupplier.contacts || selectedSupplier.contacts.length === 0 ? (
                                <div className="h-full min-h-[150px] flex flex-col items-center justify-center text-slate-400 opacity-80">
                                    <Users className="w-8 h-8 mb-3 text-slate-300" />
                                    <p className="font-medium text-[13px] text-slate-500">暂未录入联系人</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    {selectedSupplier.contacts.map((contact, idx) => (
                                        <div key={idx} className="bg-white p-4 rounded-[20px] border border-slate-100 hover:border-purple-200/60 hover:shadow-sm transition-all group relative shrink-0">
                                            {contact.is_primary && (
                                                <div className="absolute top-0 right-0">
                                                    <div className="bg-purple-100/80 text-purple-700 text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-bl-xl flex items-center gap-0.5">
                                                        <UserCheck className="w-2.5 h-2.5" /> 首选
                                                    </div>
                                                </div>
                                            )}
                                            <div className="flex items-start gap-3">
                                                <div className="w-10 h-10 rounded-full bg-stone-50 flex items-center justify-center text-slate-600 font-bold text-[15px] border border-stone-100 shrink-0">
                                                    {contact.name.charAt(0)}
                                                </div>
                                                <div className="flex-1 min-w-0 pr-6">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <h4 className="font-extrabold text-slate-800 text-[14px] truncate">{contact.name}</h4>
                                                        {contact.position && (
                                                            <span className="text-[9px] font-bold text-slate-500 uppercase shrink-0 px-1 bg-slate-100 rounded">
                                                                {contact.position}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-col gap-1 mt-2">
                                                        <div className="flex items-center gap-2 text-slate-500">
                                                            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                            <span className="truncate flex-1 font-medium text-[12px] font-mono">{contact.phone || <span className="text-slate-300 font-normal">未录入</span>}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2 text-slate-500">
                                                            <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                            <span className="truncate flex-1 font-medium text-[12px]">{contact.email || <span className="text-slate-300 font-normal">未录入</span>}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-stretch">
                    <div className="bg-white rounded-[24px] p-6 md:p-8 border border-slate-100 shadow-sm transition-shadow hover:shadow-md flex flex-col border-t-4 border-t-emerald-400 min-h-[220px]">
                        <div className="flex items-center gap-3 mb-6 shrink-0">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/50 flex items-center justify-center border border-emerald-100/30">
                                <PhoneCall className="w-5 h-5 text-emerald-600" />
                            </div>
                            <h3 className="font-bold text-slate-800 text-[18px]">联系与通讯</h3>
                        </div>
                        <div className="flex flex-col gap-6 flex-1">
                            <div>
                                <label className="text-[12px] font-medium text-slate-400 mb-1.5 flex items-center gap-1.5"><Globe className="w-4 h-4 text-slate-300" /> 官方网站</label>
                                <div className="text-slate-800 font-medium text-[15px] truncate">
                                    {selectedSupplier.website ? (
                                        <a href={selectedSupplier.website.startsWith('http') ? selectedSupplier.website : `https://${selectedSupplier.website}`} target="_blank" rel="noopener noreferrer" className="hover:underline text-blue-600">
                                            {selectedSupplier.website.replace('http://', '').replace('https://', '')}
                                        </a>
                                    ) : <span className="text-slate-300 font-normal">未提供</span>}
                                </div>
                            </div>
                            <div>
                                <label className="text-[12px] font-medium text-slate-400 mb-1.5 flex items-center gap-1.5"><Phone className="w-4 h-4 text-slate-300" /> 公司座机</label>
                                <div className="text-slate-800 font-medium text-[15px] truncate font-mono">{selectedSupplier.office_phone || <span className="text-slate-300 font-normal">未提供</span>}</div>
                            </div>
                            <div>
                                <label className="text-[12px] font-medium text-slate-400 mb-1.5 flex items-center gap-1.5"><ClipboardCheck className="w-4 h-4 text-slate-300" /> 公司传真</label>
                                <div className="text-slate-800 font-medium text-[15px] truncate font-mono">{selectedSupplier.fax || <span className="text-slate-300 font-normal">未提供</span>}</div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-[24px] border border-slate-100 shadow-sm flex flex-col p-6 md:p-8 border-t-4 border-t-purple-400 min-h-[220px]">
                        <div className="flex items-center gap-3 mb-6 shrink-0">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-50 to-purple-100/50 flex items-center justify-center border border-purple-100/30">
                                <FileCheck className="w-5 h-5 text-purple-600" />
                            </div>
                            <h3 className="font-bold text-slate-800 text-[18px]">企业资质</h3>
                        </div>
                        <div className="space-y-4 flex-1">
                            {['REACH'].map(docType => {
                                const doc = selectedSupplier.documents?.find(d => d.doc_type === docType);
                                return (
                                    <div key={docType} className={`flex items-center justify-between p-4 rounded-[18px] border transition-all ${doc ? 'bg-emerald-50/50 border-emerald-100' : 'bg-slate-50 border-slate-100'} shrink-0`}>
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-sm border ${doc ? 'bg-white text-emerald-500 border-emerald-100' : 'bg-white text-slate-300 border-slate-100'}`}>
                                                {doc ? <ShieldCheck className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                                            </div>
                                            <div className="flex flex-col gap-0.5">
                                                <span className="font-bold text-slate-800 text-[13px]">{docType} 合规</span>
                                                <span className="mt-1">
                                                    {doc ? (
                                                        <Badge status="已审核" className="uppercase px-2 text-[10px]" />
                                                    ) : (
                                                        <Badge status="待审核" className="uppercase px-2 text-[10px] bg-slate-100 text-slate-500 border-slate-200" />
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                        {doc && (
                                            <div className="flex gap-1.5">
                                                <button onClick={async () => { if (doc.id) { try { const url = await storageApi.getSupplierDocViewUrl(doc.id); window.open(url, '_blank'); } catch (e: any) { notify.error('预览失败: ' + e.message); } } }} className="p-2 bg-white hover:bg-emerald-50 rounded-xl transition-colors text-emerald-600 border border-emerald-100 shadow-sm"><Eye className="w-3.5 h-3.5" /></button>
                                                <button onClick={async () => { if (doc.id) { try { const url = await storageApi.getSupplierDocDownloadUrl(doc.id); const link = document.createElement('a'); link.href = url; link.download = ''; document.body.appendChild(link); link.click(); document.body.removeChild(link); } catch (e: any) { notify.error('下载失败: ' + e.message); } } }} className="p-2 bg-white hover:bg-emerald-50 rounded-xl transition-colors text-emerald-600 border border-emerald-100 shadow-sm"><Download className="w-3.5 h-3.5" /></button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {isSuperAdmin && (
                    <div className={`bg-white p-6 md:p-8 rounded-[24px] border shadow-sm relative overflow-hidden group flex flex-col justify-center transition-all duration-300 min-h-[220px] ${selectedSupplier.has_account ? 'border-t-4 border-t-indigo-500' : 'border-t-4 border-t-slate-300'}`}>
                        {selectedSupplier.has_account ? (
                            <>
                                <div className="absolute right-0 top-0 w-40 h-40 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 rounded-bl-full pointer-events-none"></div>
                                <div className="flex justify-between items-center mb-6 relative z-10 shrink-0">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100/50 flex items-center justify-center border border-indigo-100/30">
                                            <Key className="w-5 h-5 text-indigo-600" />
                                        </div>
                                        <h3 className="font-bold text-slate-800 text-[18px]">登录账户</h3>
                                    </div>
                                    <button onClick={() => handleResetPassword(selectedSupplier.id, selectedSupplier.name)} className="text-[12px] font-medium border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 hover:text-indigo-600 px-3 py-1.5 rounded-lg transition-colors">重置密码</button>
                                </div>
                                <div className="flex flex-col gap-3 relative z-10">
                                    <div className="bg-slate-50/80 p-3 h-[56px] rounded-xl border border-slate-100 flex items-center group-hover:bg-slate-50 transition-colors">
                                        <div className="w-20 text-[12px] font-medium text-slate-400">用户名</div>
                                        <div className="flex-1 font-mono text-slate-800 font-semibold select-all text-[15px] tracking-wide">{selectedSupplier.account_username}</div>
                                    </div>
                                    <div className="bg-slate-50/80 p-3 h-[56px] rounded-xl border border-slate-100 flex items-center group-hover:bg-slate-50 transition-colors">
                                        <div className="w-20 text-[12px] font-medium text-slate-400">暗码</div>
                                        <div className="flex-1 font-mono text-slate-800 font-semibold select-all text-[15px] tracking-wide">{selectedSupplier.account_password}</div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center text-center relative z-10 h-full">
                                <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3 border border-slate-100">
                                    <User className="w-5 h-5 text-slate-300" />
                                </div>
                                <h3 className="font-semibold text-slate-600 text-[15px] mb-1">未开通供应商账户</h3>
                                <p className="text-[13px] text-slate-400 mb-4 px-4">开通专属账户后，供应商可自助处理交料业务</p>
                            </div>
                        )}
                    </div>
                    )}
                </div>
            </div>
        </div>
    );
};
