import React, { Suspense, useEffect, useState } from 'react';
import {
  PackageCheck, Truck, ShieldCheck, LogOut, UserCircle,
  Users, Clock, AlertCircle, Layers, ArrowRight
} from 'lucide-react';
import { AuthUser, UserRole, PurchaseOrder, SupplierStats } from './types';
import { authApi, orderApi, setAuthToken } from './services/api';

const PMCView = React.lazy(() =>
  import('./components/PMCView').then((module) => ({ default: module.PMCView }))
);
const SupplierView = React.lazy(() =>
  import('./components/SupplierView').then((module) => ({ default: module.SupplierView }))
);
const AdminView = React.lazy(() =>
  import('./components/AdminView').then((module) => ({ default: module.AdminView }))
);
const IQCView = React.lazy(() =>
  import('./components/IQCView').then((module) => ({ default: module.IQCView }))
);
const AuthScreen = React.lazy(() =>
  import('./components/AuthScreen').then((module) => ({ default: module.AuthScreen }))
);

const ViewLoadingFallback: React.FC<{ message?: string }> = ({ message = '正在加载页面...' }) => (
  <div className="min-h-[320px] flex items-center justify-center">
    <div className="text-sm font-bold text-slate-400 tracking-widest">{message}</div>
  </div>
);

const App: React.FC = () => {
  const [role, setRole] = useState<UserRole | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [adminStats, setAdminStats] = useState<SupplierStats | null>(null);
  const [adminFilterStatus, setAdminFilterStatus] = useState<'all' | 'active' | 'pending' | 'incomplete'>('all');

  const sessionStorageRef = typeof window !== 'undefined' ? window.sessionStorage : null;
  const localStorageRef = typeof window !== 'undefined' ? window.localStorage : null;

  useEffect(() => {
    const savedToken = sessionStorageRef?.getItem('authToken');
    const savedUser = sessionStorageRef?.getItem('currentUser');
    localStorageRef?.removeItem('authToken');
    localStorageRef?.removeItem('currentUser');

    if (savedToken && savedUser) {
      try {
        const user = JSON.parse(savedUser);
        setAuthToken(savedToken);
        setCurrentUser(user as AuthUser);
        setRole(user.role as UserRole);
      } catch (err) {
        console.error('Failed to restore session:', err);
        sessionStorageRef?.removeItem('authToken');
        sessionStorageRef?.removeItem('currentUser');
      }
    }
    setSessionRestored(true);
  }, [localStorageRef, sessionStorageRef]);

  useEffect(() => {
    if (currentUser) {
      loadOrders();
    }
  }, [currentUser]);

  const loadOrders = async () => {
    try {
      const data = await orderApi.getOrders();
      setOrders(data);
    } catch (err: any) {
      console.error('Failed to load orders:', err);
    }
  };

  const handleLogin = async (username: string, password: string, selectedRole: UserRole) => {
    try {
      const response = await authApi.login(username, password, selectedRole);
      setCurrentUser(response.user);
      setRole(response.user.role as UserRole);
      sessionStorageRef?.setItem('authToken', response.access_token);
      sessionStorageRef?.setItem('currentUser', JSON.stringify(response.user));
    } catch (err: any) {
      console.error('Login failed:', err);
      throw err;
    }
  };

  const handleCurrentUserUpdate = (user: AuthUser, accessToken?: string) => {
    setCurrentUser(user);
    setRole(user.role as UserRole);
    sessionStorageRef?.setItem('currentUser', JSON.stringify(user));
    if (accessToken) {
      setAuthToken(accessToken);
      sessionStorageRef?.setItem('authToken', accessToken);
    }
  };

  const handleLogout = () => {
    setRole(null);
    setCurrentUser(null);
    setOrders([]);
    setAuthToken(null);
    sessionStorageRef?.removeItem('authToken');
    sessionStorageRef?.removeItem('currentUser');
    localStorageRef?.removeItem('authToken');
    localStorageRef?.removeItem('currentUser');
  };

  const handleUpdateOrder = (updatedOrder: PurchaseOrder) => {
    setOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));
  };

  const handleCreateOrder = async (newOrder: PurchaseOrder) => {
    setOrders(prev => [newOrder, ...prev]);
    await loadOrders();
  };

  // Session restore guard: avoid flashing landing page before reading localStorage.
  if (!sessionRestored) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm font-bold text-slate-400 tracking-widest">正在恢复会话...</div>
      </div>
    );
  }

  // 1. Landing Page (Role Selection)
  if (!role) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 font-sans">
        <div className="max-w-5xl w-full bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row min-h-[600px]">

          {/* Left Branding Side - Reverted to Blue */}
          <div className="md:w-2/5 bg-blue-600 p-12 text-white flex flex-col justify-between relative overflow-hidden">
            {/* Abstract Shapes */}
            <div className="absolute top-[-20%] left-[-20%] w-80 h-80 bg-white/10 rounded-full blur-3xl"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-60 h-60 bg-purple-500/20 rounded-full blur-3xl"></div>

            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-white/20 backdrop-blur-sm rounded-lg">
                  <Layers className="w-6 h-6 text-white" />
                </div>
                <span className="font-bold tracking-wider text-sm opacity-90">GATEKEEPER SYSTEM</span>
              </div>
              <h1 className="text-4xl font-extrabold mb-4 leading-tight tracking-tight shadow-sm">
                供应链<br />交料关卡系统
              </h1>
              <div className="w-12 h-1 bg-white/50 rounded-full mb-6"></div>
            </div>

            <div className="relative z-10">
              <p className="text-blue-100 text-xs uppercase tracking-widest mb-2">System Status</p>
              <div className="flex items-center gap-2 text-green-300 text-sm font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-300 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400"></span>
                </span>
                Online & Operational
              </div>
            </div>
          </div>

          {/* Right Selection Side */}
          <div className="md:w-3/5 p-8 md:p-12 flex flex-col justify-center bg-white">
            <div className="max-w-md mx-auto w-full space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">选择登录角色</h2>
                <p className="text-gray-500 mt-1 text-sm">请根据您的职能选择入口 (支持注册)</p>
              </div>

              <div className="grid gap-4">
                <button
                  onClick={() => setRole(UserRole.SUPPLIER)}
                  className="group relative flex items-center p-5 border border-gray-200 rounded-xl hover:border-blue-500 hover:shadow-lg transition-all bg-white overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <div className="relative bg-blue-100 p-3 rounded-lg text-blue-600 group-hover:scale-110 transition-transform">
                    <Truck className="w-6 h-6" />
                  </div>
                  <div className="relative ml-4 flex-1 text-left">
                    <div className="font-bold text-gray-800 group-hover:text-blue-700">供应商入口</div>
                    <div className="text-xs text-gray-400 mt-0.5">Supplier Portal</div>
                  </div>
                  <ArrowRight className="relative w-5 h-5 text-gray-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                </button>

                <button
                  onClick={() => setRole(UserRole.ADMIN)}
                  className="group relative flex items-center p-5 border border-gray-200 rounded-xl hover:border-purple-500 hover:shadow-lg transition-all bg-white overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <div className="relative bg-purple-100 p-3 rounded-lg text-purple-600 group-hover:scale-110 transition-transform">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div className="relative ml-4 flex-1 text-left">
                    <div className="font-bold text-gray-800 group-hover:text-purple-700">管理员审核</div>
                    <div className="text-xs text-gray-400 mt-0.5">Admin Console</div>
                  </div>
                  <ArrowRight className="relative w-5 h-5 text-gray-300 group-hover:text-purple-500 group-hover:translate-x-1 transition-all" />
                </button>

                <button
                  onClick={() => setRole(UserRole.IQC)}
                  className="group relative flex items-center p-5 border border-gray-200 rounded-xl hover:border-green-500 hover:shadow-lg transition-all bg-white overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-green-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <div className="relative bg-green-100 p-3 rounded-lg text-green-600 group-hover:scale-110 transition-transform">
                    <PackageCheck className="w-6 h-6" />
                  </div>
                  <div className="relative ml-4 flex-1 text-left">
                    <div className="font-bold text-gray-800 group-hover:text-green-700">IQC 收货</div>
                    <div className="text-xs text-gray-400 mt-0.5">Receiving Terminal</div>
                  </div>
                  <ArrowRight className="relative w-5 h-5 text-gray-300 group-hover:text-green-500 group-hover:translate-x-1 transition-all" />
                </button>

                <button
                  onClick={() => setRole(UserRole.PMC)}
                  className="group relative flex items-center p-5 border border-gray-200 rounded-xl hover:border-indigo-500 hover:shadow-lg transition-all bg-white overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-indigo-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <div className="relative bg-indigo-100 p-3 rounded-lg text-indigo-600 group-hover:scale-110 transition-transform">
                    <Clock className="w-6 h-6" />
                  </div>
                  <div className="relative ml-4 flex-1 text-left">
                    <div className="font-bold text-gray-800 group-hover:text-indigo-700">计划与库存台</div>
                    <div className="text-xs text-gray-400 mt-0.5">库存、清单与补料演算</div>
                  </div>
                  <ArrowRight className="relative w-5 h-5 text-gray-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" />
                </button>
              </div>
            </div>

            <div className="mt-12 text-center">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest">
                Secure • Isolated • Traceable
              </p>
            </div>
          </div>

        </div>
      </div>
    );
  }

  // 2. Authentication Interception
  if (role && !currentUser) {
    return (
      <Suspense fallback={<ViewLoadingFallback message="正在加载登录页..." />}>
        <AuthScreen
          role={role}
          onLogin={handleLogin}
          onBack={() => setRole(null)}
        />
      </Suspense>
    );
  }

  // 3. Main Application View
  return (
    <div className="h-screen bg-slate-50 flex flex-col">
      {/* Navbar */}
      <nav className="bg-white border-b border-slate-200/60 shadow-[0_2px_15px_rgba(0,0,0,0.03)] px-6 py-3 flex justify-between items-center z-50 flex-none h-[68px] box-border">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg text-white shadow-md ${
              role === UserRole.SUPPLIER ? 'bg-blue-600' :
              role === UserRole.ADMIN ? 'bg-purple-600' :
              role === UserRole.IQC ? 'bg-green-600' : 'bg-indigo-600'
              }`}>
              {role === UserRole.SUPPLIER && <Truck className="w-5 h-5" />}
              {role === UserRole.ADMIN && <ShieldCheck className="w-5 h-5" />}
              {role === UserRole.IQC && <PackageCheck className="w-5 h-5" />}
              {role === UserRole.PMC && <Clock className="w-5 h-5" />}
            </div>
            <div>
              <h1 className="font-bold text-gray-800 leading-tight">供应链交料关卡系统</h1>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                  {role === UserRole.SUPPLIER ? '供应商端' :
                   role === UserRole.ADMIN ? '供应商管理' :
                   role === UserRole.IQC ? 'IQC收货端' : '计划与库存台'}
                </span>
                <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                <span className="text-xs text-gray-400">{new Date().toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {role === UserRole.ADMIN && adminStats && (
            <div className="flex gap-2 bg-slate-100/60 p-1.5 rounded-2xl border border-slate-200/50">
              <div
                onClick={() => setAdminFilterStatus('all')}
                className={`flex items-center gap-3 px-4 py-1.5 rounded-xl transition-all cursor-pointer ${adminFilterStatus === 'all' ? 'bg-white shadow-sm ring-1 ring-slate-200/60' : 'hover:bg-slate-200/50'}`}
              >
                <div className={`text-xl font-bold ${adminFilterStatus === 'all' ? 'text-blue-600' : 'text-slate-700'}`}>{adminStats.total_suppliers}</div>
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-500">
                  <Users className={`w-4 h-4 ${adminFilterStatus === 'all' ? 'text-blue-500' : 'text-slate-400'}`} /> 供应商总数
                </div>
              </div>

              <div
                onClick={() => setAdminFilterStatus('pending')}
                className={`flex items-center gap-3 px-4 py-1.5 rounded-xl transition-all cursor-pointer ${adminFilterStatus === 'pending' ? 'bg-white shadow-sm ring-1 ring-slate-200/60' : 'hover:bg-slate-200/50'}`}
              >
                <div className={`text-xl font-bold ${adminFilterStatus === 'pending' ? 'text-orange-600' : 'text-slate-700'}`}>{adminStats.total_pending_review}</div>
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-500">
                  <Clock className={`w-4 h-4 ${adminFilterStatus === 'pending' ? 'text-orange-500' : 'text-slate-400'}`} /> 待审核
                </div>
              </div>
              <div
                onClick={() => setAdminFilterStatus('incomplete')}
                className={`flex items-center gap-3 px-4 py-1.5 rounded-xl transition-all cursor-pointer ${adminFilterStatus === 'incomplete' ? 'bg-white shadow-sm ring-1 ring-slate-200/60' : 'hover:bg-slate-200/50'}`}
              >
                <div className={`text-xl font-bold ${adminFilterStatus === 'incomplete' ? 'text-red-600' : 'text-slate-700'}`}>{adminStats.suppliers_with_incomplete}</div>
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-500">
                  <AlertCircle className={`w-4 h-4 ${adminFilterStatus === 'incomplete' ? 'text-red-500' : 'text-slate-400'}`} /> 资料缺失
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          {currentUser && (
            <div className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border ${
              role === UserRole.SUPPLIER ? 'bg-blue-50 text-blue-700 border-blue-100' :
              role === UserRole.ADMIN ? 'bg-purple-50 text-purple-700 border-purple-100' :
              role === UserRole.IQC ? 'bg-green-50 text-green-700 border-green-100' :
              'bg-indigo-50 text-indigo-700 border-indigo-100'
              }`}>
              <UserCircle className="w-4 h-4" />
              <span className="font-medium">
                {role === UserRole.SUPPLIER ? currentUser.supplier_name : currentUser.username}
              </span>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-600 transition-colors hover:bg-gray-100 px-3 py-1.5 rounded-md"
          >
            <LogOut className="w-4 h-4" /> 退出
          </button>
        </div>
      </nav>

      {/* View Content */}
      <main className="app-main-scroll flex-1 relative bg-slate-50/50 min-h-0">
        <div className="max-w-[var(--container-max)] mx-auto w-full h-full min-h-0 p-8 box-border">
          <Suspense fallback={<ViewLoadingFallback />}>
            {role === UserRole.SUPPLIER && currentUser && (
              <SupplierView
                orders={orders}
                onUpdateOrder={handleUpdateOrder}
                onCreateOrder={handleCreateOrder}
                currentSupplierName={currentUser.supplier_name || currentUser.username}
              />
            )}
            {role === UserRole.ADMIN && currentUser && (
              <AdminView
                currentUser={currentUser}
                onCurrentUserUpdate={handleCurrentUserUpdate}
                onStatsUpdate={setAdminStats}
                filterStatus={adminFilterStatus}
                onFilterChange={setAdminFilterStatus}
              />
            )}
            {role === UserRole.IQC && currentUser && (
              <IQCView
                orders={orders}
                onUpdateOrder={handleUpdateOrder}
                currentUser={currentUser.username}
              />
            )}
            {role === UserRole.PMC && currentUser && (
              <PMCView currentUser={currentUser.username} />
            )}
          </Suspense>
        </div>
      </main>
    </div>
  );
};

export default App;
