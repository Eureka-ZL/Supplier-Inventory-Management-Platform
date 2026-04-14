"""
Gmail Service using OAuth2 User Consent Flow.

This replaces the previous Service Account approach.
Uses a one-time browser authorization to get a refresh token,
then silently reads emails forever after.
"""

import os
import base64
import logging
import re
from html import unescape
from typing import List, Tuple
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

logger = logging.getLogger(__name__)

# Only need readonly access
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

# Paths relative to backend/
CREDENTIALS_FILE = os.path.join(os.path.dirname(__file__), '..', 'oauth_credentials.json')
TOKEN_FILE = os.path.join(os.path.dirname(__file__), '..', 'token.json')


class GmailService:
    def __init__(self):
        """
        Initialize the Gmail service using OAuth2.
        On first run, opens a browser for user consent.
        After that, uses the saved token.json for silent access.
        """
        self.service = self._build_service()

    def _build_service(self):
        """Builds and returns the Gmail API service object."""
        creds = None

        # Check for existing token
        if os.path.isfile(TOKEN_FILE):
            try:
                creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
            except Exception as e:
                logger.warning(f"Failed to load token: {e}")

        # If no valid credentials, need to authorize
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                    # Save refreshed token
                    with open(TOKEN_FILE, 'w') as f:
                        f.write(creds.to_json())
                except Exception as e:
                    logger.error(f"Failed to refresh token: {e}")
                    return None
            else:
                if not os.path.exists(CREDENTIALS_FILE):
                    logger.warning(
                        f"OAuth credentials not found at {CREDENTIALS_FILE}. "
                        "Please run: python backend/authorize_gmail.py"
                    )
                    return None
                logger.warning(
                    "No valid token found. Please run: python backend/authorize_gmail.py"
                )
                return None

        try:
            service = build('gmail', 'v1', credentials=creds)
            logger.info("Gmail service initialized successfully")
            return service
        except Exception as e:
            logger.error(f"Failed to build Gmail service: {e}")
            return None

    def is_ready(self) -> bool:
        """Check if the Gmail service is properly authorized and functional."""
        return self.service is not None

    def search_messages(self, query: str = "has:attachment", max_results: int = 500) -> List[dict]:
        """Search for messages matching the specified query."""
        if not self.service:
            return []

        try:
            messages: List[dict] = []
            page_token = None

            while True:
                request = self.service.users().messages().list(
                    userId='me',
                    q=query,
                    maxResults=min(max_results, 500),
                    pageToken=page_token,
                )
                results = request.execute()
                page_messages = results.get('messages', []) or []
                messages.extend(page_messages)

                if len(messages) >= max_results:
                    return messages[:max_results]

                page_token = results.get('nextPageToken')
                if not page_token:
                    break
            return messages
        except HttpError as error:
            logger.error(f"Error searching messages: {error}")
            return []

    def get_message_detail(self, msg_id: str) -> dict:
        """Get full message details including headers."""
        if not self.service:
            return {}

        try:
            message = self.service.users().messages().get(
                userId='me', id=msg_id, format='full'
            ).execute()
            return message
        except HttpError as error:
            logger.error(f"Error getting message {msg_id}: {error}")
            return {}

    def get_message_sender(self, message: dict) -> str:
        """Extract sender email from a message."""
        headers = message.get('payload', {}).get('headers', [])
        for header in headers:
            if header['name'].lower() == 'from':
                return header['value']
        return 'unknown'

    def get_message_subject(self, message: dict) -> str:
        """Extract subject from a message."""
        headers = message.get('payload', {}).get('headers', [])
        for header in headers:
            if header.get('name', '').lower() == 'subject':
                return str(header.get('value', ''))
        return ''

    def get_message_thread_id(self, message: dict) -> str:
        """Extract Gmail thread id from a message."""
        return str(message.get('threadId', '') or '')

    def get_message_body_text(self, message: dict) -> str:
        """Extract the best-effort plain text body from Gmail message payload."""
        payload = message.get('payload', {}) or {}
        text_parts = self._extract_text_parts(payload, mime_type='text/plain')
        if text_parts:
            return "\n".join(part for part in text_parts if part).strip()

        html_parts = self._extract_text_parts(payload, mime_type='text/html')
        if html_parts:
            html_text = "\n".join(part for part in html_parts if part).strip()
            return self._strip_html(html_text)

        return ''

    def _extract_text_parts(self, part: dict, mime_type: str) -> List[str]:
        results: List[str] = []
        if not isinstance(part, dict):
            return results

        current_type = str(part.get('mimeType', '') or '')
        body = part.get('body', {}) or {}
        data = body.get('data')
        if current_type == mime_type and data:
            try:
                decoded = base64.urlsafe_b64decode(data.encode('UTF-8')).decode('utf-8', errors='ignore')
                results.append(decoded)
            except Exception as error:
                logger.warning("Failed to decode Gmail body part: %s", error)

        for child in part.get('parts', []) or []:
            results.extend(self._extract_text_parts(child, mime_type=mime_type))

        return results

    def _strip_html(self, html: str) -> str:
        # Gmail/Outlook often wrap previous replies in blockquote sections.
        text = re.sub(r"<blockquote\b[^>]*>.*?</blockquote>", " ", html, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"<div\b[^>]*class=[\"'][^\"']*gmail_quote[^\"']*[\"'][^>]*>.*?</div>", " ", text, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"</p\s*>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        text = unescape(text)
        text = re.sub(r"\s+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r"[ \t]{2,}", " ", text)
        return text.strip()

    def get_message_attachments(self, msg_id: str) -> List[Tuple[str, bytes]]:
        """
        Retrieve all attachments for a specific message.

        Returns:
            A list of tuples containing (filename, attachment_data_in_bytes)
        """
        if not self.service:
            return []

        attachments = []
        try:
            message = self.service.users().messages().get(
                userId='me', id=msg_id, format='full'
            ).execute()

            payload = message.get('payload', {})
            parts = [payload]
            if 'parts' in payload:
                parts.extend(payload['parts'])

            for part in parts:
                filename = part.get('filename', '')
                if filename:
                    if 'data' in part.get('body', {}):
                        data = part['body']['data']
                    else:
                        att_id = part['body'].get('attachmentId')
                        if not att_id:
                            continue
                        att = self.service.users().messages().attachments().get(
                            userId='me', messageId=msg_id, id=att_id
                        ).execute()
                        data = att['data']

                    file_data = base64.urlsafe_b64decode(data.encode('UTF-8'))
                    attachments.append((filename, file_data))

            return attachments

        except HttpError as error:
            logger.error(f"Error getting attachments: {error}")
            return []
