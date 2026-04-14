from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import json
from datetime import datetime

from services.ai_completion_service import AICompletionError, chat_completion_text

router = APIRouter(prefix="/api/ai", tags=["AI"])


class RejectionRequest(BaseModel):
    poNumber: str
    supplierName: str
    missingDocs: List[str]
    customReason: str


class AnalysisRequest(BaseModel):
    status: str
    logs: List[dict]
    documents: List[dict] = []  # Added documents list


@router.post("/generate_rejection")
async def generate_rejection(request: RejectionRequest):
    """Generate rejection email content using AI"""

    today_str = datetime.now().strftime("%Y年%m月%d日")
    prompt = f"""
      你是一位专业的供应链品质管理员。
      请根据用户提供的关键词或草稿，为供应商 "{request.supplierName}" 润色/生成一封简短、专业的驳回通知。
      采购单号: {request.poNumber}
      
      用户关键词/草稿: {request.customReason or '（无具体关键词，请生成通用驳回模板）'}
      {f"存在问题的文档: {', '.join(request.missingDocs)}" if request.missingDocs else ''}

      要求:
      - 基于用户的关键词扩展成完整的句子。
      - 语气专业、客观、礼貌。
      - 明确指出需要重新提交。
      - 使用中文。
      - 直接输出邮件正文。
      - **绝对不要包含** [您的姓名]、[公司名称]、[联系方式] 等任何需要二次填写的占位符。
      - 落款格式：
        顺祝商祺！
        {today_str}
    """

    try:
        content = await chat_completion_text(
            user_prompt=prompt,
            temperature=0.7,
            timeout=30.0,
        )
        return {"content": content}
    except AICompletionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/analyze_logs")
async def analyze_logs(request: AnalysisRequest):
    """Analyze order logs for efficiency"""

    log_str = json.dumps(request.logs, ensure_ascii=False)
    doc_str = json.dumps(request.documents, ensure_ascii=False)

    prompt = f"""
      分析以下供应链订单的操作日志及文件列表，并给出一个简短的配合度与风险评估(50字以内)。
      当前状态: {request.status}
      日志: {log_str}
      文件列表: {doc_str}
      
      请扮演一位严格的“风险控制专员”。
      
      **关键分析逻辑**:
      1. **效率评估**: 如果日志显示在短时间内连续上传了多个文档，通常表明供应商备料充分且操作熟练，**应给予积极评价**（如"配合度高/资料准备充足"）。仅在文件名明显混乱时才提示需人工复核。
      2. **文件名一致性检查**: 请检查 "文件列表" 中的文件名是否与对应的文档类型(doc_type)匹配。
         - 例如：类型为 "RoHS" 但文件名包含 "REACH" 或 "MSDS"，应提示"文件名与类型不符"。
         - 如果文件名是无意义的数字/乱码，也请提示风险。
      3. 没有驳回记录不代表质量好，如果上传过快且无审核记录，应提示“需人工复核”。
      4. 只有在间隔合理、且有审核通过记录的情况下，才评价为“流程顺畅”。
      
      输出要求：客观、犀利，发现疑点直接指出。
    """

    try:
        content = await chat_completion_text(
            user_prompt=prompt,
            temperature=0.5,
            timeout=30.0,
        )
        return {"content": content}
    except AICompletionError:
        return {"content": "分析暂时不可用"}
    except Exception:
        return {"content": "分析暂时不可用"}
