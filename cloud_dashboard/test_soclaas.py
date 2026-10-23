"""Test a downloaded SoCLaaS .env without displaying its API key.

Usage: python test_soclaas.py --env-file C:\\path\\to\\soclaas.env
Uses only the Python standard library and sends one small chat request.
"""

import argparse
import json
from pathlib import Path
import shlex
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirects(HTTPRedirectHandler):
    """Do not forward an Authorization header to a redirected destination."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def load_config(path):
    config = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:]
        name, raw = line.split("=", 1)
        config[name.strip()] = " ".join(shlex.split(raw, comments=True))
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True, type=Path)
    args = parser.parse_args()
    try:
        config = load_config(args.env_file)
    except (OSError, ValueError):
        print("Cannot read a valid .env file. Check the path and assignment syntax.")
        return 1

    key = config.get("SOCLAAS_API_KEY", "")
    base = config.get("SOCLAAS_BASE_URL", "").rstrip("/")
    model = config.get("SOCLAAS_MODEL", "")
    if not all((key, base, model)):
        print("Missing SOCLAAS_API_KEY, SOCLAAS_BASE_URL, or SOCLAAS_MODEL.")
        return 1

    parsed = urlsplit(base)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "soclaas-api.comp.nus.edu.sg"
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.port not in (None, 443)
    ):
        print("Unexpected service URL. No credentials sent.")
        return 1
    if parsed.path.rstrip("/") == "/v1":
        endpoint = base + "/chat/completions"
    elif not parsed.path.rstrip("/"):
        endpoint = base + "/v1/chat/completions"
    else:
        print("Unexpected base URL path. No credentials sent.")
        return 1

    body = {
        "model": model,
        "messages": [
            {"role": "user", "content": "Reply with exactly: SoCLaaS connection successful."}
        ],
    }
    request = Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with build_opener(NoRedirects()).open(request, timeout=45) as response:
            payload = response.read(262145)
            print("HTTP status:", response.status)
            if len(payload) > 262144:
                print("Response exceeded the test size limit.")
                return 1
            data = json.loads(payload)
            answer = data["choices"][0]["message"]["content"]
            if not isinstance(answer, str) or not answer.strip():
                print("Response did not contain usable assistant text.")
                return 1
            print("Model:", model.replace(key, "[REDACTED]"))
            print("Reply:", answer.replace(key, "[REDACTED]")[:500])
            return 0
    except HTTPError as error:
        print("HTTP status:", error.code)
        hints = {
            400: "Check the configured model and request parameters.",
            401: "The service rejected authentication. Check the key locally.",
            403: "Access was denied. Check account permissions and service access requirements.",
            404: "Check the endpoint and model availability.",
            429: "The service is limiting requests. Wait before retrying.",
        }
        print(hints.get(error.code, "The service returned an error; no response body or key is displayed."))
    except URLError as error:
        reason = error.reason
        if isinstance(reason, PermissionError):
            print("Network access is blocked by this execution environment.")
        else:
            print("Connection failed. Check network access and certificate trust.")
    except TimeoutError:
        print("Request timed out. Wait before retrying.")
    except (ValueError, KeyError, IndexError, TypeError):
        print("The response did not match the expected chat-completions format.")
    return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
