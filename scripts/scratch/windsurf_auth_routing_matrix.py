import importlib.util
import json
import os
import pathlib
import time
import urllib.request

path = pathlib.Path("C:/Users/amine/OmniRoute/scripts/windsurf_direct_probe.py")
spec = importlib.util.spec_from_file_location("windsurf_direct_probe", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

BASE_TOKEN = "devin-session-token-123"
BASE_SESSION_ID = "routing-matrix-session"
CSRF = "3a1d0e5e-db26-4abe-b2f9-41704544534e"
LOCAL_BASE_URL = "http://127.0.0.1:53740"
LOCAL_HOST = "q.localhost:53740"
PROMPT = "hello"

CASES = [
    {"name": "A_userJwt_only", "userJwt": "test", "headerAuth": None, "assignmentJwt": None},
    {"name": "B_header_only", "userJwt": None, "headerAuth": "test", "assignmentJwt": None},
    {"name": "D_all_three", "userJwt": "test", "headerAuth": "test", "assignmentJwt": "test"},
]

TRAJECTORY_POLL_ATTEMPTS = 12
TRAJECTORY_POLL_INTERVAL_SECONDS = 1.0

SAVED = {k: os.environ.get(k) for k in [
    "WINDSURF_SESSION_ID",
    "WINDSURF_CHAT_TEXT",
    "WINDSURF_USER_JWT",
    "WINDSURF_CHAT_AUTHORIZATION_TOKEN",
    "WINDSURF_ASSIGNMENT_JWT",
    "WINDSURF_ASSIGNMENT_JWT_LOCATION",
    "WINDSURF_CSRF_TOKEN",
    "WINDSURF_LANGUAGE_SERVER_URL",
]}


def set_case_env(case):
    os.environ["WINDSURF_SESSION_ID"] = BASE_SESSION_ID
    os.environ["WINDSURF_CHAT_TEXT"] = PROMPT
    os.environ["WINDSURF_CSRF_TOKEN"] = CSRF
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


def local_headers(include_authorization=False, auth_value=None):
    headers = {
        "Content-Type": "application/proto",
        "Connect-Protocol-Version": "1",
        "Accept": "application/proto, application/json",
        "User-Agent": "connect-go/1.17.0 (go1.23.4 X:nocoverageredesign)",
        "Accept-Encoding": "identity",
        "Connect-Accept-Encoding": "gzip",
        "Host": LOCAL_HOST,
        "x-codeium-csrf-token": CSRF,
    }
    if include_authorization and auth_value is not None:
        headers["Authorization"] = f"Bearer {auth_value}"
    return headers


def run_cloud_chat(case):
    set_case_env(case)
    req, preview = mod.build_chat_probe_request(BASE_TOKEN)
    exit_code, result = mod.run_request(req)
    error = extract_connect_error(result)
    msg = error.get("message") if isinstance(error, dict) else None
    return {
        "http_status": result.get("status"),
        "error": error,
        "routing_class": classify_path(msg),
        "notes": {
            "userJwtPreview": preview.get("metadata", {}).get("userJwt", "<absent>"),
            "assignmentJwtLocation": preview.get("assignmentJwtLocation"),
        },
    }


def run_local_start(case):
    set_case_env(case)
    mod.on_language_server_started(
        session_id=BASE_SESSION_ID,
        window_id="matrix-window",
        host="127.0.0.1",
        port=53740,
        lifecycle_nonce=f"nonce-{case['name']}",
        timestamp=1714560000.0,
        csrf_token=CSRF,
        confirmed=True,
    )
    body, _preview = mod.build_start_cascade_request(BASE_TOKEN, LOCAL_BASE_URL)
    req = urllib.request.Request(
        f"{LOCAL_BASE_URL}/exa.language_server_pb.LanguageServerService/StartCascade",
        data=body,
        headers=local_headers(include_authorization=case["headerAuth"] is not None, auth_value=case["headerAuth"]),
        method="POST",
    )
    exit_code, result = mod.run_request(req)
    if exit_code == 0:
        result["decodedUnaryProto"] = mod.decode_start_cascade_response(bytes.fromhex(result["bodyHex"]))
    cascade_id = mod.extract_cascade_id_from_start_result(result) if exit_code == 0 else None
    msg = None
    if isinstance(result.get("body"), dict):
        msg = result["body"].get("message")
    elif isinstance(result.get("body"), str) and "invalid" in result["body"].lower():
        msg = result["body"]
    return {
        "http_status": result.get("status"),
        "error": {"message": msg} if msg else None,
        "routing_class": classify_path(msg),
        "cascadeId": cascade_id,
    }


def run_local_send(case, cascade_id):
    set_case_env(case)
    mod.on_language_server_started(
        session_id=BASE_SESSION_ID,
        window_id="matrix-window",
        host="127.0.0.1",
        port=53740,
        lifecycle_nonce=f"nonce-send-{case['name']}",
        timestamp=1714560000.0,
        csrf_token=CSRF,
        confirmed=True,
    )
    os.environ["WINDSURF_LANGUAGE_SERVER_URL"] = LOCAL_BASE_URL
    body, _preview = mod.build_send_user_cascade_message_request(BASE_TOKEN, cascade_id)
    req = urllib.request.Request(
        f"{LOCAL_BASE_URL}/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
        data=body,
        headers=local_headers(include_authorization=case["headerAuth"] is not None, auth_value=case["headerAuth"]),
        method="POST",
    )
    exit_code, result = mod.run_request(req)
    msg = None
    if isinstance(result.get("body"), dict):
        msg = result["body"].get("message")
    elif isinstance(result.get("body"), str) and "invalid" in result["body"].lower():
        msg = result["body"]
    return {
        "http_status": result.get("status"),
        "error": {"message": msg} if msg else None,
        "routing_class": classify_path(msg),
    }


def run_local_trajectory(case, cascade_id):
    set_case_env(case)
    mod.on_language_server_started(
        session_id=BASE_SESSION_ID,
        window_id="matrix-window",
        host="127.0.0.1",
        port=53740,
        lifecycle_nonce=f"nonce-traj-{case['name']}",
        timestamp=1714560000.0,
        csrf_token=CSRF,
        confirmed=True,
    )
    os.environ["WINDSURF_LANGUAGE_SERVER_URL"] = LOCAL_BASE_URL
    polls = []
    first_auth_signal = None

    for attempt in range(1, TRAJECTORY_POLL_ATTEMPTS + 1):
        body, _preview = mod.build_get_cascade_trajectory_request(BASE_TOKEN, cascade_id)
        req = urllib.request.Request(
            f"{LOCAL_BASE_URL}/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory",
            data=body,
            headers=local_headers(include_authorization=case["headerAuth"] is not None, auth_value=case["headerAuth"]),
            method="POST",
        )
        exit_code, result = mod.run_request(req)
        message = None
        routing_class = "no-auth-signal-yet"
        step_count = None
        node_count = None

        if exit_code == 0 and result.get("bodyHex"):
            decoded = mod.decode_cascade_trajectory_response(bytes.fromhex(result["bodyHex"]))
            trajectory = decoded.get("trajectory") if isinstance(decoded, dict) else None
            strings = []
            if isinstance(trajectory, dict):
                steps = trajectory.get("steps") or []
                nodes = trajectory.get("nodesRaw") or []
                step_count = len(steps)
                node_count = len(nodes)
                for node in nodes:
                    cls = mod.classify_trajectory_node(node["bytes"])
                    strings.extend(cls.get("strings") or [])
            for s in strings:
                if isinstance(s, str) and ("jwt tokens not enabled" in s.lower() or "invalid api key" in s.lower()):
                    message = s
                    routing_class = classify_path(message)
                    break

        poll_summary = {
            "attempt": attempt,
            "http_status": result.get("status"),
            "routing_class": routing_class,
            "message": message,
            "step_count": step_count,
            "node_count": node_count,
        }
        polls.append(poll_summary)

        if first_auth_signal is None and routing_class != "no-auth-signal-yet":
            first_auth_signal = {
                **poll_summary,
                "delay_seconds": round((attempt - 1) * TRAJECTORY_POLL_INTERVAL_SECONDS, 3),
            }
            break

        time.sleep(TRAJECTORY_POLL_INTERVAL_SECONDS)

    return {
        "http_status": polls[-1]["http_status"] if polls else None,
        "error": {"message": first_auth_signal["message"]} if first_auth_signal and first_auth_signal.get("message") else None,
        "routing_class": first_auth_signal["routing_class"] if first_auth_signal else "no-auth-signal-yet",
        "first_auth_signal": first_auth_signal,
        "polls": polls,
    }


def run_assign_model(case):
    set_case_env(case)
    req, preview = mod.build_assign_model_probe_request(BASE_TOKEN)
    exit_code, result = mod.run_request(req)
    msg = None
    if isinstance(result.get("body"), dict):
        msg = result["body"].get("message")
    elif isinstance(result.get("body"), str) and result["body"].strip():
        msg = result["body"].strip()
    return {
        "http_status": result.get("status"),
        "error": {"message": msg} if msg else None,
        "routing_class": classify_path(msg),
        "notes": {
            "url": preview.get("url"),
            "assignmentJwtLocation": os.environ.get("WINDSURF_ASSIGNMENT_JWT_LOCATION"),
            "userJwtInjected": case["userJwt"],
        },
    }

results = {}
try:
    for case in CASES:
        case_result = {}
        case_result["GetChatMessage"] = run_cloud_chat(case)
        start_result = run_local_start(case)
        case_result["StartCascade"] = start_result
        cascade_id = start_result.get("cascadeId")
        if cascade_id:
            case_result["SendUserCascadeMessage"] = run_local_send(case, cascade_id)
            time.sleep(0.5)
            case_result["GetCascadeTrajectory"] = run_local_trajectory(case, cascade_id)
        else:
            case_result["SendUserCascadeMessage"] = {"http_status": None, "error": {"message": "skipped: no cascadeId"}, "routing_class": "skipped"}
            case_result["GetCascadeTrajectory"] = {"http_status": None, "error": {"message": "skipped: no cascadeId"}, "routing_class": "skipped"}
        case_result["AssignModel"] = run_assign_model(case)
        results[case["name"]] = case_result
finally:
    for key, value in SAVED.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value

print(json.dumps(results, ensure_ascii=False, indent=2))
