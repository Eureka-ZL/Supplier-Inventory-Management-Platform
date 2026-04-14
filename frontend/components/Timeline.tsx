import React from 'react';
import { LogEntry } from '../types';
import { Clock, Upload, CheckCircle, XCircle, Package } from 'lucide-react';

interface TimelineProps {
  logs: LogEntry[];
}

// Helper function to format time duration
const formatDuration = (milliseconds: number): string => {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days}天${remainingHours > 0 ? remainingHours + '小时' : ''}`;
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}小时${remainingMinutes > 0 ? remainingMinutes + '分钟' : ''}`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}分钟${remainingSeconds > 0 ? remainingSeconds + '秒' : ''}`;
  } else {
    return `${seconds}秒`;
  }
};

// Helper function to get file type color
const getFileTypeColor = (action: string): { bg: string; border: string; text: string } => {
  if (action.includes('承认书')) {
    return { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700' };
  } else if (action.includes('RoHS')) {
    return { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700' };
  } else if (action.includes('MSDS')) {
    return { bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-700' };
  } else if (action.includes('进料检验报告')) {
    return { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-700' };
  }
  return { bg: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-700' };
};

// Helper function to get action icon
const getActionIcon = (action: string) => {
  if (action.includes('上传文件')) {
    return <Upload className="w-4 h-4" />;
  } else if (action.includes('提交审核')) {
    return <CheckCircle className="w-4 h-4" />;
  } else if (action.includes('驳回')) {
    return <XCircle className="w-4 h-4" />;
  } else if (action.includes('收货')) {
    return <Package className="w-4 h-4" />;
  }
  return <Clock className="w-4 h-4" />;
};

export const Timeline: React.FC<TimelineProps> = ({ logs }) => {
  // Sort logs by timestamp ascending (oldest first for timeline)
  const sortedLogs = [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Calculate statistics
  const uploadLogs = sortedLogs.filter(log => log.action.includes('上传文件'));
  const firstUpload = uploadLogs[0];
  const lastUpload = uploadLogs[uploadLogs.length - 1];
  const submitLog = sortedLogs.find(log => log.action.includes('提交审核'));

  let totalUploadTime: number | null = null;
  let uploadToSubmitTime: number | null = null;

  if (firstUpload && lastUpload) {
    totalUploadTime = new Date(lastUpload.timestamp).getTime() - new Date(firstUpload.timestamp).getTime();
  }

  if (lastUpload && submitLog) {
    uploadToSubmitTime = new Date(submitLog.timestamp).getTime() - new Date(lastUpload.timestamp).getTime();
  }

  return (
    <div className="mt-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
      <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center">
        <Clock className="w-4 h-4 mr-2" />
        操作记录 (Audit Trail)
      </h4>

      {/* Statistics Summary */}
      {uploadLogs.length > 0 && (
        <div className="mb-4 p-3 bg-white rounded-lg border border-gray-200 space-y-2">
          <div className="text-xs font-semibold text-gray-600 mb-2">时间统计</div>

          {uploadLogs.length > 1 && totalUploadTime !== null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-600">首次上传 → 最后文件:</span>
              <span className="font-semibold text-blue-600">{formatDuration(totalUploadTime)}</span>
            </div>
          )}

          {uploadToSubmitTime !== null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-600">最后文件 → 提交审核:</span>
              <span className="font-semibold text-green-600">{formatDuration(uploadToSubmitTime)}</span>
            </div>
          )}

          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-600">已上传文件数:</span>
            <span className="font-semibold text-purple-600">{uploadLogs.length} 个</span>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-3">
        {sortedLogs.map((log, index) => {
          const isUpload = log.action.includes('上传文件');
          const colors = getFileTypeColor(log.action);
          const icon = getActionIcon(log.action);

          // Calculate time since previous log
          let timeSincePrevious: string | null = null;
          if (index > 0) {
            const previousLog = sortedLogs[index - 1];
            const duration = new Date(log.timestamp).getTime() - new Date(previousLog.timestamp).getTime();
            timeSincePrevious = formatDuration(duration);
          }

          return (
            <div key={index} className="relative">
              {/* Time interval indicator */}
              {timeSincePrevious && (
                <div className="flex items-center gap-2 mb-1 ml-3">
                  <div className="h-4 w-0.5 bg-gray-300"></div>
                  <span className="text-xs text-gray-400 italic">⏱ {timeSincePrevious}</span>
                </div>
              )}

              {/* Log entry */}
              <div
                className={`flex flex-col text-sm border-l-4 pl-3 py-2 rounded-r-md transition-all ${isUpload ? `${colors.bg} ${colors.border}` : 'border-gray-300 bg-white'
                  }`}
              >
                <span className="text-xs text-gray-500 mb-1">
                  {new Date(log.timestamp).toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </span>

                <div className="flex items-center gap-2">
                  <span className={`${isUpload ? colors.text : 'text-gray-700'}`}>{icon}</span>
                  <span className={`font-medium ${isUpload ? colors.text : 'text-gray-800'}`}>
                    {log.action}
                  </span>
                  <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded-full">
                    {log.actor}
                  </span>
                </div>

                {log.details && (
                  <p className={`mt-1 italic text-xs ${isUpload ? colors.text : 'text-gray-600'}`}>
                    📎 {log.details}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {sortedLogs.length === 0 && <div className="text-gray-400 text-sm">暂无记录</div>}
      </div>
    </div>
  );
};