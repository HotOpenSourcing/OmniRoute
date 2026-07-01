import importlib.util
import json
import os
import pathlib

path = pathlib.Path("C:/Users/amine/OmniRoute/scripts/windsurf_direct_probe.py")
spec = importlib.util.spec_from_file_location("windsurf_direct_probe", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

BASE_TOKEN = "devin-session-token-123"
BASE_SESSION_ID = "cloud-family-routing-session"
PROMPT = "hello"

CASES = [
    {"name": "A_userJwt_only", "userJwt": "test", "headerAuth": None, "assignmentJwt": None},
    {"name": "B_header_only", "userJwt": None, "headerAuth": "test", "assignmentJwt": None},
    {"name": "D_all_three", "userJwt": "test", "headerAuth": "test", "assignmentJwt": "test"},
]

ENDPOINTS = [
    {
        "name": "GetChatMessage",
        "kind": "chat-family",
        "mode": "builder",
        "builder": "build_chat_probe_request",
        "chat_service": "api",
        "chat_method_name": "GetChatMessage",
    },
    {
        "name": "RawGetChatMessage",
        "kind": "chat-family",
        "mode": "builder",
        "builder": "build_raw_chat_probe_request",
        "chat_service": "ls",
        "chat_method_name": "RawGetChatMessage",
    },
    {
        "name": "ApiWrapper",
        "kind": "chat-family",
        "mode": "builder",
        "builder": "build_api_wrapper_probe_request",
        "chat_service": "api",
        "chat_method_name": "GetChatMessage",
    },
    {
        "name": "GetUserStatus",
        "kind": "seat-management",
        "mode": "validate",
    },
]

SAVED = {k: os.environ.get(k) for k in [
    "WINDSURF_SESSION_ID",
    "WINDSURF_CHAT_TEXT",
    "WINDSURF_USER_JWT",
    "WINDSURF_CHAT_AUTHORIZATION_TOKEN",
    "WINDSURF_ASSIGNMENT_JWT",
    "WINDSURF_ASSIGNMENT_JWT_LOCATION",
    "WINDSURF_CHAT_SERVICE",
    "WINDSURF_CHAT_METHOD_NAME",
]}


def set_case_env(case):
    os.environ["WINDSURF_SESSION_ID"] = BASE_SESSION_ID
    os.environ["WINDSURF_CHAT_TEXT"] = PROMPT
    if case["userJwt"] is None:
        os.environ.pop("WINDSURF_USER_JWT", None)
    else:
        os.environ["WINDSURF_USER_JWT"] = case["userJwt"]
    if case["headerAuth"] is None:
        os.environ.pop("WINDSURF_CHAT_AUTHORIZATION_TOKEN", None)
    else:
        os.environ["WINDSURF_CHAT_AUTHORIZATION_TOKEN"] = case["headerAuth"]
    if case["assignmentJwt"] is None:
        os.environ.pop("WINDSURF_ASSIGNMENT_JWT", None)
        os.environ.pop("WINDSURF_ASSIGNMENT_JWT_LOCATION", None)
    else:
        os.environ["WINDSURF_ASSIGNMENT_JWT"] = case["assignmentJwt"]
        os.environ["WINDSURF_ASSIGNMENT_JWT_LOCATION"] = "top-level-wrapper"


def extract_connect_error(result):
    decoded = result.get("connectDecoded")
    if not isinstance(decoded, dict):
        return None
    frames = decoded.get("frames") or []
    for frame in reversed(frames):
        if isinstance(frame, dict) and isinstance(frame.get("error"), dict):
            return frame["error"]
    return None


def classify_path(error_message):
    if not isinstance(error_message, str):
        return "no-explicit-auth-error"
    lowered = error_message.lower()
    if "jwt tokens not enabled" in lowered:
        return "jwt-pipeline"
    if "invalid api key" in lowered:
        return "api-key-pipeline"
    return "other-error"


def run_endpoint(endpoint, case):
    set_case_env(case)

    if endpoint["mode"] == "builder":
        os.environ["WINDSURF_CHAT_SERVICE"] = endpoint["chat_service"]
        os.environ["WINDSURF_CHAT_METHOD_NAME"] = endpoint["chat_method_name"]
        builder = getattr(mod, endpoint["builder"])
        req, preview = builder(BASE_TOKEN)
    elif endpoint["mode"] == "validate":
        req = mod.build_validate_request(BASE_TOKEN)
        preview = {
            "url": mod.VALIDATE_URL,
            "requestType": "validate",
            "metadata": mod.get_metadata_payload(BASE_TOKEN),
            "assignmentJwtLocation": os.environ.get("WINDSURF_ASSIGNMENT_JWT_LOCATION") or None,
        }
    else:
        raise ValueError(f"Unsupported endpoint mode: {endpoint['mode']}")

    exit_code, result = mod.run_request(req)
    error = extract_connect_error(result)
    message = error.get("message") if isinstance(error, dict) else None
    if message is None and isinstance(result.get("body"), dict):
        message = result["body"].get("message")

    status = result.get("status")
    active_surface = status != 404

    return {
        "http_status": status,
        "active_surface": active_surface,
        "error": error or ({"message": result.get("body")} if result.get("body") else None),
        "routing_class": classify_path(message),
        "notes": {
            "url": preview.get("url"),
            "requestType": preview.get("requestType"),
            "kind": endpoint["kind"],
            "userJwtPreview": preview.get("metadata", {}).get("userJwt", "<absent>"),
            "assignmentJwtLocation": preview.get("assignmentJwtLocation"),
        },
    }


results = {"endpoints": {}, "active_surfaces": []}
try:
    for endpoint in ENDPOINTS:
        endpoint_results = {}
        statuses = []
        for case in CASES:
            outcome = run_endpoint(endpoint, case)
            endpoint_results[case["name"]] = outcome
            statuses.append(outcome.get("http_status"))
        results["endpoints"][endpoint["name"]] = endpoint_results
        if any(status is not None and status != 404 for status in statuses):
            results["active_surfaces"].append({
                "name": endpoint["name"],
                "kind": endpoint["kind"],
                "statuses": statuses,
            })
finally:
    for key, value in SAVED.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value

print(json.dumps(results, ensure_ascii=False, indent=2))
