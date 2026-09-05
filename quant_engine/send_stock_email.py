import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
import sys
import os

def send_stock_email(subject, html_content, recipients=None):
    smtp_host = os.getenv("ZEROQUANT_SMTP_HOST", "smtp.qq.com")
    smtp_port = int(os.getenv("ZEROQUANT_SMTP_PORT", "465"))
    sender_email = os.getenv("ZEROQUANT_SMTP_SENDER", "")
    auth_code = os.getenv("ZEROQUANT_SMTP_AUTH_CODE", "")
    recipients = recipients or [item.strip() for item in os.getenv("ZEROQUANT_EMAIL_RECIPIENTS", "").split(",") if item.strip()]
    if not sender_email or not auth_code or not recipients:
        raise RuntimeError("SMTP credentials and recipients must be configured through environment variables")

    msg = MIMEMultipart()
    msg["From"] = formataddr(("ZeroQuant", sender_email))
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject

    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        server = smtplib.SMTP_SSL(smtp_host, smtp_port)
        server.login(sender_email, auth_code)
        server.sendmail(sender_email, recipients, msg.as_string())
        server.quit()
        print("EMAIL_SENT_SUCCESS")
    except Exception as e:
        print(f"EMAIL_SENT_FAILED: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) > 2:
        send_stock_email(sys.argv[1], sys.argv[2])
