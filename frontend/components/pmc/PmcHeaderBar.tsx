import React from 'react';
import { Mail, RefreshCw, Upload } from 'lucide-react';

type ActiveTab = 'bom' | 'inventory' | 'stock' | 'adjustments' | 'history';

interface PmcHeaderBarProps {
  activeTab: ActiveTab;
  onChangeTab: (tab: ActiveTab) => void;
  gmailAuthorized: boolean;
  latestSyncSummary: string;
  bomStatusReady: boolean;
  bomStatusSummary: string;
  syncing: boolean;
  uploading: boolean;
  revokingGmail: boolean;
  onSyncEmails: () => void;
  onUploadClick: () => void;
  onAuthorizeGmail: () => void;
  onRevokeGmail: () => void;
}

const tabs: Array<{ key: ActiveTab; label: string }> = [
  { key: 'bom', label: '产品清单' },
  { key: 'inventory', label: '需求缺口分析' },
  { key: 'stock', label: '库存明细' },
  { key: 'adjustments', label: '邮件变动' },
  { key: 'history', label: '变更历史' },
];

const PmcHeaderBar = ({
  activeTab,
  onChangeTab,
  gmailAuthorized,
  latestSyncSummary,
  bomStatusReady,
  bomStatusSummary,
  syncing,
  uploading,
  revokingGmail,
  onSyncEmails,
  onUploadClick,
  onAuthorizeGmail,
  onRevokeGmail,
}: PmcHeaderBarProps) => {
  const syncLabel = gmailAuthorized ? '邮箱已连接' : '邮箱未连接';
  const syncMeta = gmailAuthorized ? (latestSyncSummary || '等待下一次同步') : '连接后可自动读取库存附件';
  const bomLabel = bomStatusReady ? '清单已入库' : '清单待入库';
  const bomMeta = bomStatusReady ? (bomStatusSummary || '物料清单已可用于演算') : '请先准备物料清单数据';

  return (
    <header className="pmc-topbar m-panel">
      <div className="pmc-toolbar-row">
        <div className="pmc-toolbar-main">
          <nav className="pmc-nav" aria-label="PMC 功能切换">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => onChangeTab(tab.key)}
                className={`pmc-nav-button ${activeTab === tab.key ? 'active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="pmc-toolbar-meta">
            <div className="pmc-meta-item">
              <span className={`pmc-status-dot ${gmailAuthorized ? 'is-ready' : 'is-waiting'}`} />
              <span className="pmc-meta-label">{syncLabel}</span>
              <span className="pmc-meta-text">{syncMeta}</span>
            </div>

            <span className="pmc-meta-separator" aria-hidden="true" />

            <div className="pmc-meta-item">
              <span className={`pmc-status-dot ${bomStatusReady ? 'is-ready' : 'is-waiting'}`} />
              <span className="pmc-meta-label">{bomLabel}</span>
              <span className="pmc-meta-text">{bomMeta}</span>
            </div>
          </div>
        </div>

        <div className="pmc-header-actions">
          {gmailAuthorized ? (
            <button
              type="button"
              onClick={onRevokeGmail}
              disabled={revokingGmail}
              className="m-btn-ghost"
              title="断开邮箱同步"
            >
              {revokingGmail ? '断开中...' : '断开邮箱'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onAuthorizeGmail}
              className="m-btn-ghost flex items-center gap-2"
            >
              <Mail className="w-3.5 h-3.5" />
              连接邮箱
            </button>
          )}

          <button
            type="button"
            onClick={onSyncEmails}
            disabled={syncing}
            className="m-btn-ghost flex items-center gap-2"
            title="立即同步邮件"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} strokeWidth={2} />
            {syncing ? '同步中...' : '同步邮件'}
          </button>

          <button
            type="button"
            onClick={onUploadClick}
            disabled={uploading}
            className="m-btn-primary flex items-center gap-2"
          >
            <Upload className="w-3.5 h-3.5" strokeWidth={2} />
            {uploading ? '解析中...' : '上传库存'}
          </button>
        </div>
      </div>
    </header>
  );
};

export default PmcHeaderBar;
