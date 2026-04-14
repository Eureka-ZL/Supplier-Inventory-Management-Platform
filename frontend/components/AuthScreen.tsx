import React, { useState } from 'react';
import { UserRole } from '../types';
import { Truck, ShieldCheck, PackageCheck, Lock, User, ArrowRight, LogIn, ClipboardList } from 'lucide-react';

interface AuthScreenProps {
  role: UserRole;
  onLogin: (username: string, password: string, role: UserRole) => Promise<void>;
  onBack: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ role, onLogin, onBack }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Dynamic configuration based on role
  const config = {
    [UserRole.SUPPLIER]: {
      color: 'blue',
      bgColor: 'bg-blue-600',
      textColor: 'text-blue-600',
      lightBg: 'bg-blue-50',
      hoverBg: 'hover:bg-blue-700',
      icon: Truck,
      title: '供应商门户',
      subtitle: 'Supplier Portal',
      label: '供应商名称 (Company Name)',
      placeholder: '请输入名称'
    },
    [UserRole.ADMIN]: {
      color: 'purple',
      bgColor: 'bg-purple-600',
      textColor: 'text-purple-600',
      lightBg: 'bg-purple-50',
      hoverBg: 'hover:bg-purple-700',
      icon: ShieldCheck,
      title: '管理员控制台',
      subtitle: 'Admin Console',
      label: '管理员账号 (Username)',
      placeholder: '请输入名称'
    },
    [UserRole.IQC]: {
      color: 'green',
      bgColor: 'bg-green-600',
      textColor: 'text-green-600',
      lightBg: 'bg-green-50',
      hoverBg: 'hover:bg-green-700',
      icon: PackageCheck,
      title: 'IQC 检验终端',
      subtitle: 'Incoming Quality Control',
      label: '工号/姓名 (ID/Name)',
      placeholder: '请输入名称'
    },
    [UserRole.PMC]: {
      color: 'indigo',
      bgColor: 'bg-indigo-600',
      textColor: 'text-indigo-600',
      lightBg: 'bg-indigo-50',
      hoverBg: 'hover:bg-indigo-700',
      icon: ClipboardList,
      title: '计划与库存台',
      subtitle: '库存、清单与补料演算',
      label: 'PMC 账号',
      placeholder: '请输入名称'
    }
  }[role];

  const Icon = config.icon;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!username.trim() || !password.trim()) {
      setError('请输入完整的用户名和密码');
      setLoading(false);
      return;
    }

    try {
      await onLogin(username.trim(), password, role);
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || '操作失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col">
        {/* Header */}
        <div className={`${config.bgColor} p-8 text-center relative`}>
          <button
            onClick={onBack}
            className="absolute left-4 top-4 text-white/70 hover:text-white text-sm flex items-center gap-1 transition-colors"
          >
            <ArrowRight className="w-4 h-4 rotate-180" /> 返回
          </button>
          <div className="w-20 h-20 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mx-auto mb-4 text-white shadow-inner">
            <Icon className="w-10 h-10" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-wide">{config.title}</h2>
          <p className="text-white/80 text-sm mt-1 font-medium">
            {config.subtitle}
          </p>
        </div>

        {/* Form */}
        <div className="p-8 pt-10">
          <div className="mb-6 text-center">
            <h3 className="text-xl font-bold text-gray-800">
              欢迎回来
            </h3>
            <p className="text-gray-500 text-sm mt-1">
              请输入您的账号密码以继续
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                {config.label}
              </label>
              <div className="relative">
                <User className="absolute left-3 top-3 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={`w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-${config.color}-500 focus:border-transparent outline-none transition-all bg-gray-50 focus:bg-white`}
                  placeholder={config.placeholder}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                密码 (Password)
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 text-gray-400 w-5 h-5" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-${config.color}-500 focus:border-transparent outline-none transition-all bg-gray-50 focus:bg-white`}
                  placeholder="请输入密码"
                />
              </div>
            </div>

            {error && (
              <div className="text-red-500 text-sm bg-red-50 p-3 rounded border border-red-100 flex items-start gap-2">
                <span className="mt-0.5 block w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0"></span>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full ${config.bgColor} ${config.hoverBg} text-white font-bold py-3 rounded-lg shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {loading ? '处理中...' : '登 录'}
              {!loading && <LogIn className="w-4 h-4" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
