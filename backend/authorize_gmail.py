"""
一次性 Gmail 授权脚本

运行此脚本后，浏览器会自动打开 Google 登录页面。
用 pqm@evelabinsight.com 登录并点击「允许」即可。
授权成功后会在本目录生成 token.json，后续系统会自动使用它。

使用方法:
    cd backend
    python authorize_gmail.py
"""

import os
import asyncio
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials
from database import AsyncSessionLocal
from services.audit_log_service import create_audit_log

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
CREDENTIALS_FILE = 'oauth_credentials.json'
TOKEN_FILE = 'token.json'


def main():
    print("=" * 50)
    print("Gmail 授权工具")
    print("=" * 50)

    if not os.path.exists(CREDENTIALS_FILE):
        print(f"\n❌ 找不到 {CREDENTIALS_FILE}")
        print("   请确保 OAuth 凭据文件在 backend/ 目录下")
        return

    if os.path.exists(TOKEN_FILE):
        print(f"\n⚠️  {TOKEN_FILE} 已存在，将重新授权...")

    print("\n🌐 正在打开浏览器，请用 pqm@evelabinsight.com 登录...")
    print("   然后点击「允许」按钮\n")

    try:
        flow = InstalledAppFlow.from_client_secrets_file(
            CREDENTIALS_FILE, SCOPES
        )
        creds = flow.run_local_server(port=0)

        # Save the token
        with open(TOKEN_FILE, 'w') as f:
            f.write(creds.to_json())

        async def _log_success() -> None:
            async with AsyncSessionLocal() as session:
                await create_audit_log(
                    session,
                    scope="gmail",
                    action="gmail_authorized",
                    actor="script:authorize_gmail",
                    entity_type="gmail",
                    title="Gmail 授权已完成",
                    summary="通过脚本完成 Gmail OAuth 授权，token.json 已更新",
                    detail={
                        "token_file": TOKEN_FILE,
                        "credentials_file": CREDENTIALS_FILE,
                    },
                )
                await session.commit()

        asyncio.run(_log_success())

        print("\n✅ 授权成功！")
        print(f"   令牌已保存到 {TOKEN_FILE}")
        print("   系统现在可以自动读取 Gmail 邮件了")
        print("\n   请重启后端: python main.py")

    except Exception as e:
        print(f"\n❌ 授权失败: {e}")
        print("   请确保你选择了正确的 Google 账号")


if __name__ == "__main__":
    main()
