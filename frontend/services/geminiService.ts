import { api } from './api';

export const generateRejectionEmail = async (
  poNumber: string,
  supplierName: string,
  missingDocs: string[],
  customReason: string
): Promise<string> => {
  try {
    const response = await api.post<{ content: string }>('/api/ai/generate_rejection', {
      poNumber,
      supplierName,
      missingDocs,
      customReason
    });

    return response.content || "生成失败，请手动填写。";
  } catch (error) {
    console.error("AI service error:", error);
    return "AI 服务暂时不可用，请手动填写驳回原因。";
  }
};

export const analyzeDocumentStatus = async (status: string, logs: any[], documents: any[] = []): Promise<string> => {
  try {
    const response = await api.post<{ content: string }>('/api/ai/analyze_logs', {
      status,
      logs,
      documents
    });

    return response.content || "分析不可用";
  } catch (error) {
    console.error("AI analysis error:", error);
    return "无法连接 AI 分析服务。";
  }
}