import React, { useEffect, useMemo, useState } from 'react';
import {
    Search,
    Users,
    Plus,
    ShieldCheck,
    PackageCheck,
    Clock3,
    RefreshCw,
    UserCircle,
    KeyRound,
    Loader2,
    Pencil,
    Trash2,
} from 'lucide-react';
import { authApi } from '../../../services/api';
import { AuthUser, InternalUserAccount, UserRole } from '../../../types';
import { EmptyState } from '../../ui/EmptyState';
import { Modal } from '../../ui/Modal';
import { ConfirmModal } from '../ConfirmModal';
import { notify } from '../../ui/NotificationCenter';

interface AccountManagementPanelProps {
    currentUser: AuthUser;
    onCurrentUserUpdate: (user: AuthUser, accessToken?: string) => void;
}

interface CreateUserFormState {
    username: string;
    role: '' | UserRole.ADMIN | UserRole.IQC | UserRole.PMC;
    is_super_admin: boolean;
    password: string;
    confirmPassword: string;
}

interface EditUserFormState {
    username: string;
    is_super_admin: boolean;
    newPassword: string;
    confirmPassword: string;
}

const ROLE_META: Record<UserRole.ADMIN | UserRole.IQC | UserRole.PMC, { label: string; badgeClass: string; icon: React.ReactNode }> = {
    [UserRole.ADMIN]: {
        label: '管理员',
        badgeClass: 'bg-purple-50 text-purple-700 border border-purple-200',
        icon: <ShieldCheck className="w-4 h-4 text-purple-600" />,
    },
    [UserRole.IQC]: {
        label: 'IQC',
        badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        icon: <PackageCheck className="w-4 h-4 text-emerald-600" />,
    },
    [UserRole.PMC]: {
        label: 'PMC',
        badgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
        icon: <Clock3 className="w-4 h-4 text-indigo-600" />,
    },
};

const defaultCreateForm = (): CreateUserFormState => ({
    username: '',
    role: '',
    is_super_admin: false,
    password: '',
    confirmPassword: '',
});

const getRoleMeta = (account: Pick<InternalUserAccount, 'role' | 'is_super_admin'>) => {
    if (account.role === UserRole.ADMIN && account.is_super_admin) {
        return {
            label: '超级管理员',
            badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
            icon: <ShieldCheck className="w-4 h-4 text-amber-600" />,
        };
    }
    return ROLE_META[account.role as UserRole.ADMIN | UserRole.IQC | UserRole.PMC];
};

export const AccountManagementPanel: React.FC<AccountManagementPanelProps> = ({ currentUser, onCurrentUserUpdate }) => {
    const [accounts, setAccounts] = useState<InternalUserAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [keyword, setKeyword] = useState('');
    const [roleFilter, setRoleFilter] = useState<'ALL' | UserRole.ADMIN | UserRole.IQC | UserRole.PMC>('ALL');
    const [error, setError] = useState<string | null>(null);

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [createForm, setCreateForm] = useState<CreateUserFormState>(defaultCreateForm);
    const [createFormError, setCreateFormError] = useState('');

    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [profileUsername, setProfileUsername] = useState(currentUser.username || '');
    const [isPasswordOpen, setIsPasswordOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<InternalUserAccount | null>(null);
    const [deletingAccount, setDeletingAccount] = useState<InternalUserAccount | null>(null);
    const [editForm, setEditForm] = useState<EditUserFormState>({
        username: '',
        is_super_admin: false,
        newPassword: '',
        confirmPassword: '',
    });
    const [passwordForm, setPasswordForm] = useState({
        new_password: '',
        confirm_password: '',
    });

    useEffect(() => {
        setProfileUsername(currentUser.username || '');
    }, [currentUser.username]);

    const loadAccounts = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await authApi.listInternalUsers();
            setAccounts(Array.isArray(data) ? data : []);
        } catch (err: any) {
            setError(err.message || '内部账户加载失败');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadAccounts();
    }, []);

    const filteredAccounts = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return accounts.filter((account) => {
            const roleMatched = roleFilter === 'ALL' || account.role === roleFilter;
            const roleLabel = getRoleMeta(account).label.toLowerCase();
            const keywordMatched = !query || account.username.toLowerCase().includes(query) || roleLabel.includes(query);
            return roleMatched && keywordMatched;
        });
    }, [accounts, keyword, roleFilter]);

    const counts = useMemo(() => ({
        total: accounts.length,
        superAdmin: accounts.filter((item) => item.role === UserRole.ADMIN && item.is_super_admin).length,
        admin: accounts.filter((item) => item.role === UserRole.ADMIN && !item.is_super_admin).length,
        iqc: accounts.filter((item) => item.role === UserRole.IQC).length,
        pmc: accounts.filter((item) => item.role === UserRole.PMC).length,
    }), [accounts]);

    const handleCreateUser = async () => {
        const username = createForm.username.trim();
        setCreateFormError('');
        if (!username) {
            setCreateFormError('请输入用户名');
            return;
        }
        if (!createForm.role) {
            setCreateFormError('请选择用户');
            return;
        }
        if (createForm.password.length < 6) {
            setCreateFormError('初始密码至少需要 6 位');
            return;
        }
        if (createForm.password !== createForm.confirmPassword) {
            setCreateFormError('两次输入的密码不一致');
            return;
        }

        try {
            setSubmitting(true);
            await authApi.createInternalUser({
                username,
                role: createForm.role,
                is_super_admin: createForm.role === UserRole.ADMIN ? createForm.is_super_admin : false,
                password: createForm.password,
            });
            setIsCreateOpen(false);
            setCreateForm(defaultCreateForm());
            setCreateFormError('');
            await loadAccounts();
        } catch (err: any) {
            setCreateFormError(err.message || '创建失败，请重试');
        } finally {
            setSubmitting(false);
        }
    };

    const handleUpdateProfile = async () => {
        const username = profileUsername.trim();
        if (!username) {
            notify.warning('用户名不能为空');
            return;
        }

        try {
            setSubmitting(true);
            const response = await authApi.updateMyProfile({ username });
            onCurrentUserUpdate(response.user, response.access_token);
            notify.success('账户名已更新');
            setIsProfileOpen(false);
            await loadAccounts();
        } catch (err: any) {
            notify.error(`更新失败: ${err.message || '未知错误'}`);
        } finally {
            setSubmitting(false);
        }
    };

    const handleUpdatePassword = async () => {
        if (!passwordForm.new_password || !passwordForm.confirm_password) {
            notify.warning('请填写完整的密码信息');
            return;
        }
        if (passwordForm.new_password.length < 6) {
            notify.warning('新密码至少需要 6 位');
            return;
        }
        if (passwordForm.new_password !== passwordForm.confirm_password) {
            notify.warning('两次输入的新密码不一致');
            return;
        }

        try {
            setSubmitting(true);
            const response = await authApi.updateMyPassword(passwordForm);
            notify.success(response.message || '密码已更新');
            setIsPasswordOpen(false);
            setPasswordForm({
                new_password: '',
                confirm_password: '',
            });
        } catch (err: any) {
            notify.error(`更新失败: ${err.message || '未知错误'}`);
        } finally {
            setSubmitting(false);
        }
    };

    const openEditModal = (account: InternalUserAccount) => {
        setEditingAccount(account);
        setEditForm({
            username: account.username,
            is_super_admin: account.is_super_admin === true,
            newPassword: '',
            confirmPassword: '',
        });
    };

    const handleUpdateInternalAccount = async () => {
        if (!editingAccount) return;
        const username = editForm.username.trim();
        if (!username) {
            notify.warning('用户名不能为空');
            return;
        }
        const shouldUpdatePassword = Boolean(editForm.newPassword || editForm.confirmPassword);
        if (shouldUpdatePassword) {
            if (editForm.newPassword.length < 6) {
                notify.warning('新密码至少需要 6 位');
                return;
            }
            if (editForm.newPassword !== editForm.confirmPassword) {
                notify.warning('两次输入的新密码不一致');
                return;
            }
        }

        try {
            setSubmitting(true);
            const updated = await authApi.updateInternalUser(editingAccount.id, {
                username,
                is_super_admin: editingAccount.role === UserRole.ADMIN ? editForm.is_super_admin : false,
            });
            if (shouldUpdatePassword) {
                await authApi.updateInternalUserPassword(editingAccount.id, {
                    new_password: editForm.newPassword,
                    confirm_password: editForm.confirmPassword,
                });
            }
            if (updated.id === currentUser.id) {
                const me = await authApi.updateMyProfile({ username: updated.username });
                onCurrentUserUpdate(me.user, me.access_token);
            }
            notify.success(shouldUpdatePassword ? '账户名和密码已更新' : '账户名已更新');
            setEditingAccount(null);
            await loadAccounts();
        } catch (err: any) {
            notify.error(`更新失败: ${err.message || '未知错误'}`);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDeleteInternalAccount = async (account: InternalUserAccount) => {
        setDeletingAccount(account);
    };

    const confirmDeleteInternalAccount = async () => {
        if (!deletingAccount) return;
        try {
            setSubmitting(true);
            const response = await authApi.deleteInternalUser(deletingAccount.id);
            notify.success(response.message || '账户已删除');
            setDeletingAccount(null);
            await loadAccounts();
        } catch (err: any) {
            notify.error(`删除失败: ${err.message || '未知错误'}`);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col gap-6 overflow-hidden">
            <ConfirmModal
                isOpen={!!deletingAccount}
                onClose={() => setDeletingAccount(null)}
                onConfirm={() => { void confirmDeleteInternalAccount(); }}
                title="确认删除内部账户"
                message={deletingAccount ? `确定要删除内部账户“${deletingAccount.username}”吗？删除后将无法恢复。` : ''}
                type="danger"
                confirmLabel="确认删除"
            />
            <div className="bg-white rounded-[32px] border border-slate-200/60 shadow-sm p-8">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                    <div>
                        <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">账户管理</h2>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={() => void loadAccounts()}
                            className="h-10 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-semibold text-sm inline-flex items-center gap-2 transition-colors"
                        >
                            <RefreshCw className="w-4 h-4" />
                            刷新列表
                        </button>
                        <button
                            onClick={() => setIsCreateOpen(true)}
                            className="h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm inline-flex items-center gap-2 transition-colors shadow-sm"
                        >
                            <Plus className="w-4 h-4" />
                            新建内部账户
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mt-8">
                    <SummaryCard title="内部账户总数" value={counts.total} accent="slate" />
                    <SummaryCard title="超级管理员" value={counts.superAdmin} accent="amber" />
                    <SummaryCard title="管理员" value={counts.admin} accent="purple" />
                    <SummaryCard title="IQC" value={counts.iqc} accent="emerald" />
                    <SummaryCard title="PMC" value={counts.pmc} accent="indigo" />
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.7fr)_380px] gap-6 flex-1 overflow-hidden">
                <div className="bg-white rounded-[32px] border border-slate-200/60 shadow-sm flex flex-col min-h-0 overflow-hidden">
                    <div className="px-8 py-6 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900">账户列表</h3>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <div className="relative">
                                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    value={keyword}
                                    onChange={(e) => setKeyword(e.target.value)}
                                    placeholder="搜索用户名或角色"
                                    className="h-10 w-full sm:w-64 rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-300"
                                />
                            </div>
                            <select
                                value={roleFilter}
                                onChange={(e) => setRoleFilter(e.target.value as 'ALL' | UserRole.ADMIN | UserRole.IQC | UserRole.PMC)}
                                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300"
                            >
                                <option value="ALL">全部角色</option>
                                <option value={UserRole.ADMIN}>管理员</option>
                                <option value={UserRole.IQC}>IQC</option>
                                <option value={UserRole.PMC}>PMC</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto">
                        {loading ? (
                            <div className="h-full flex items-center justify-center">
                                <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-500">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    正在加载账户列表...
                                </div>
                            </div>
                        ) : error ? (
                            <div className="h-full flex items-center justify-center px-8">
                                <div className="text-center">
                                    <div className="text-sm font-semibold text-rose-600">{error}</div>
                                    <button
                                        onClick={() => void loadAccounts()}
                                        className="mt-4 h-9 px-4 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-sm font-medium text-slate-600"
                                    >
                                        重新加载
                                    </button>
                                </div>
                            </div>
                        ) : filteredAccounts.length === 0 ? (
                            <EmptyState
                                icon={<Users className="w-8 h-8 text-slate-300" />}
                                title="没有匹配的内部账户"
                                description="可以调整筛选条件，或直接创建一个新的管理员 / IQC / PMC 账户。"
                                className="py-16"
                            />
                        ) : (
                            <table className="w-full text-left">
                                <thead className="bg-slate-50/80 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-8 py-4 text-[11px] font-bold tracking-[0.08em] text-slate-400">账户</th>
                                        <th className="px-4 py-4 text-[11px] font-bold tracking-[0.08em] text-slate-400">角色</th>
                                        <th className="px-4 py-4 text-[11px] font-bold tracking-[0.08em] text-slate-400">创建时间</th>
                                        <th className="px-8 py-4 text-[11px] font-bold tracking-[0.08em] text-slate-400 text-right">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredAccounts.map((account) => {
                                        const roleMeta = getRoleMeta(account);
                                        const isCurrent = account.id === currentUser.id;
                                        return (
                                            <tr key={account.id} className="hover:bg-slate-50/70 transition-colors">
                                                <td className="px-8 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                                                            {roleMeta.icon}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-semibold text-slate-900">{account.username}</span>
                                                                {isCurrent && (
                                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                                                        当前登录
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-xs text-slate-400 mt-1">ID #{account.id}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${roleMeta.badgeClass}`}>
                                                        {roleMeta.label}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 text-sm text-slate-500 font-medium">
                                                    {new Date(account.created_at).toLocaleString('zh-CN')}
                                                </td>
                                                <td className="px-8 py-4">
                                                    <div className="flex items-center justify-end gap-2">
                                                        {!isCurrent ? (
                                                            <>
                                                                <button
                                                                    onClick={() => openEditModal(account)}
                                                                    className="h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium inline-flex items-center gap-1.5"
                                                                >
                                                                    <Pencil className="w-3.5 h-3.5" />
                                                                    编辑
                                                                </button>
                                                                <button
                                                                    onClick={() => void handleDeleteInternalAccount(account)}
                                                                    className="h-9 px-3 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-sm font-medium inline-flex items-center gap-1.5"
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                    删除
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <span className="text-xs font-medium text-slate-400">当前登录账号请在右侧修改</span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                <div className="bg-white rounded-[32px] border border-slate-200/60 shadow-sm p-8 flex flex-col gap-6">
                    <div>
                        <div className="text-[11px] font-black tracking-[0.14em] text-slate-400 mb-2">MY ACCOUNT</div>
                        <h3 className="text-lg font-bold text-slate-900">我的账户</h3>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                        <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-2xl bg-white border border-slate-200 flex items-center justify-center">
                                <UserCircle className="w-6 h-6 text-slate-500" />
                            </div>
                            <div>
                                <div className="text-base font-bold text-slate-900">{currentUser.username}</div>
                                <div className="text-sm text-slate-500">{getRoleMeta(currentUser).label || currentUser.role}</div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <button
                            onClick={() => setIsProfileOpen(true)}
                            className="w-full h-11 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
                        >
                            <UserCircle className="w-4 h-4" />
                            修改我的账户名
                        </button>
                        <button
                            onClick={() => setIsPasswordOpen(true)}
                            className="w-full h-11 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
                        >
                            <KeyRound className="w-4 h-4" />
                            修改我的密码
                        </button>
                    </div>

                    <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4 text-sm text-amber-900 leading-relaxed">
                        内部账号不会像供应商账号那样长期展示明文密码。创建后只使用哈希保存，修改密码也只会更新哈希值。
                    </div>
                </div>
            </div>

            <Modal
                isOpen={isCreateOpen}
                onClose={() => {
                    if (submitting) return;
                    setIsCreateOpen(false);
                    setCreateForm(defaultCreateForm());
                    setCreateFormError('');
                }}
                title="新建内部账户"
                description="管理员可以在这里创建管理员、IQC、PMC 账号。"
                maxWidth="lg"
                footer={
                    <>
                        <button
                            onClick={() => {
                                setIsCreateOpen(false);
                                setCreateForm(defaultCreateForm());
                                setCreateFormError('');
                            }}
                            className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium"
                            disabled={submitting}
                        >
                            取消
                        </button>
                        <button
                            onClick={() => void handleCreateUser()}
                            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium disabled:opacity-60"
                            disabled={submitting}
                        >
                            {submitting ? '创建中...' : '确认创建'}
                        </button>
                    </>
                }
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="用户名">
                        <input
                            value={createForm.username}
                            onChange={(e) => setCreateForm(prev => ({ ...prev, username: e.target.value }))}
                            className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300"
                            placeholder="例如：admin_zhangsan"
                        />
                    </Field>
                    <Field label="角色">
                        <select
                            value={createForm.role}
                            onChange={(e) => setCreateForm(prev => ({ ...prev, role: e.target.value as '' | UserRole.ADMIN | UserRole.IQC | UserRole.PMC }))}
                            className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300 bg-white"
                        >
                            <option value="">请选择用户</option>
                            <option value={UserRole.ADMIN}>管理员</option>
                            <option value={UserRole.IQC}>IQC</option>
                            <option value={UserRole.PMC}>PMC</option>
                        </select>
                    </Field>
                    <Field label="超级管理员权限">
                        <label className={`h-11 rounded-xl border px-3 text-sm inline-flex items-center gap-2 ${createForm.role === UserRole.ADMIN ? 'border-slate-200 text-slate-700' : 'border-slate-100 text-slate-300 bg-slate-50'}`}>
                            <input
                                type="checkbox"
                                checked={createForm.is_super_admin}
                                onChange={(e) => setCreateForm(prev => ({ ...prev, is_super_admin: e.target.checked }))}
                                disabled={createForm.role !== UserRole.ADMIN}
                            />
                            <span>{createForm.role === UserRole.ADMIN ? '授予该账号超级管理员权限' : '仅 ADMIN 角色可开启'}</span>
                        </label>
                    </Field>
                    <Field label="初始密码">
                        <input
                            type="password"
                            value={createForm.password}
                            onChange={(e) => setCreateForm(prev => ({ ...prev, password: e.target.value }))}
                            className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300"
                            placeholder="至少 6 位"
                        />
                    </Field>
                    <Field label="确认密码">
                        <input
                            type="password"
                            value={createForm.confirmPassword}
                            onChange={(e) => setCreateForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                            className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300"
                            placeholder="再次输入密码"
                        />
                    </Field>
                </div>
                {createFormError && (
                    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                        {createFormError}
                    </div>
                )}
            </Modal>

            <Modal
                isOpen={isProfileOpen}
                onClose={() => {
                    if (submitting) return;
                    setIsProfileOpen(false);
                    setProfileUsername(currentUser.username || '');
                }}
                title="修改我的账户名"
                description="修改后会自动刷新当前登录会话。"
                maxWidth="md"
                footer={
                    <>
                        <button
                            onClick={() => {
                                setIsProfileOpen(false);
                                setProfileUsername(currentUser.username || '');
                            }}
                            className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium"
                            disabled={submitting}
                        >
                            取消
                        </button>
                        <button
                            onClick={() => void handleUpdateProfile()}
                            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium disabled:opacity-60"
                            disabled={submitting}
                        >
                            {submitting ? '保存中...' : '保存账户名'}
                        </button>
                    </>
                }
            >
                <Field label="新用户名">
                    <input
                        value={profileUsername}
                        onChange={(e) => setProfileUsername(e.target.value)}
                        className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300"
                        placeholder="请输入新的用户名"
                    />
                </Field>
            </Modal>

            <Modal
                isOpen={isPasswordOpen}
                onClose={() => {
                    if (submitting) return;
                    setIsPasswordOpen(false);
                    setPasswordForm({
                        new_password: '',
                        confirm_password: '',
                    });
                }}
                title="修改我的密码"
                description="当前已登录，无需输入旧密码，直接设置新的登录密码即可。"
                maxWidth="md"
                footer={
                    <>
                        <button
                            onClick={() => {
                                setIsPasswordOpen(false);
                                setPasswordForm({
                                    new_password: '',
                                    confirm_password: '',
                                });
                            }}
                            className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium"
                            disabled={submitting}
                        >
                            取消
                        </button>
                        <button
                            onClick={() => void handleUpdatePassword()}
                            className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium disabled:opacity-60"
                            disabled={submitting}
                        >
                            {submitting ? '提交中...' : '更新密码'}
                        </button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Field label="新密码">
                        <input
                            type="password"
                            value={passwordForm.new_password}
                            onChange={(e) => setPasswordForm(prev => ({ ...prev, new_password: e.target.value }))}
                            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300"
                        />
                    </Field>
                    <Field label="确认新密码">
                        <input
                            type="password"
                            value={passwordForm.confirm_password}
                            onChange={(e) => setPasswordForm(prev => ({ ...prev, confirm_password: e.target.value }))}
                            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300"
                        />
                    </Field>
                </div>
            </Modal>

            <Modal
                isOpen={!!editingAccount}
                onClose={() => {
                    if (submitting) return;
                    setEditingAccount(null);
                }}
                title="编辑内部账户"
                description="可以修改账户名；如需改密码，也可以在这里直接设置新密码。"
                maxWidth="md"
                footer={
                    <>
                        <button
                            onClick={() => setEditingAccount(null)}
                            className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium"
                            disabled={submitting}
                        >
                            取消
                        </button>
                        <button
                            onClick={() => void handleUpdateInternalAccount()}
                            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium disabled:opacity-60"
                            disabled={submitting}
                        >
                            {submitting ? '保存中...' : '保存修改'}
                        </button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Field label="用户名">
                        <input
                            value={editForm.username}
                            onChange={(e) => setEditForm(prev => ({ ...prev, username: e.target.value }))}
                            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300"
                        />
                    </Field>
                    {editingAccount?.role === UserRole.ADMIN && (
                        <Field label="超级管理员权限">
                            <label className="h-11 rounded-xl border border-slate-200 px-3 text-sm inline-flex items-center gap-2 text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={editForm.is_super_admin}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, is_super_admin: e.target.checked }))}
                                />
                                <span>该账号拥有完整系统治理权限</span>
                            </label>
                        </Field>
                    )}
                    <Field label="新密码">
                        <input
                            type="password"
                            value={editForm.newPassword}
                            onChange={(e) => setEditForm(prev => ({ ...prev, newPassword: e.target.value }))}
                            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300"
                            placeholder="不修改可留空"
                        />
                    </Field>
                    <Field label="确认新密码">
                        <input
                            type="password"
                            value={editForm.confirmPassword}
                            onChange={(e) => setEditForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300"
                            placeholder="不修改可留空"
                        />
                    </Field>
                </div>
            </Modal>
        </div>
    );
};

const SummaryCard: React.FC<{ title: string; value: number; accent: 'slate' | 'amber' | 'purple' | 'emerald' | 'indigo' }> = ({ title, value, accent }) => {
    const classes = {
        slate: 'border-slate-200 bg-slate-50/60 text-slate-900',
        amber: 'border-amber-200 bg-amber-50/60 text-amber-700',
        purple: 'border-purple-200 bg-purple-50/60 text-purple-700',
        emerald: 'border-emerald-200 bg-emerald-50/60 text-emerald-700',
        indigo: 'border-indigo-200 bg-indigo-50/60 text-indigo-700',
    }[accent];

    return (
        <div className={`rounded-2xl border p-5 ${classes}`}>
            <div className="text-sm font-medium text-slate-500">{title}</div>
            <div className="text-3xl font-extrabold mt-3 tracking-tight">{value}</div>
        </div>
    );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
    return (
        <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-slate-700">{label}</span>
            {children}
        </label>
    );
};

export default AccountManagementPanel;
