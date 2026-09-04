import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
import sys

def send_stock_email(subject, html_content, recipients=["819379841@qq.com", "2524153777@qq.com"]):
    smtp_host = "smtp.qq.com"
    smtp_port = 465
    sender_email = "819379841@qq.com"
    auth_code = "jzyalbvownvmbeae"

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
