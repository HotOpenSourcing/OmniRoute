import gzip
import importlib.util
import json
import os
import pathlib
import socket
import sqlite3
import sys
import tempfile
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "windsurf_direct_probe.py"
spec = importlib.util.spec_from_file_location("windsurf_direct_probe", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def _decode_varint(payload: bytes, offset: int) -> tuple[int, int]:
    shift = 0
    value = 0

    while True:
        byte = payload[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return value, offset
        shift += 7


def _parse_message_fields(payload: bytes) -> list[tuple[int, int, bytes | int]]:
    fields: list[tuple[int, int, bytes | int]] = []
    offset = 0

    while offset < len(payload):
        key, offset = _decode_varint(payload, offset)
        field_number = key >> 3
        wire_type = key & 0x07

        if wire_type == 0:
            value, offset = _decode_varint(payload, offset)
            fields.append((field_number, wire_type, value))
            continue

        if wire_type == 2:
            length, offset = _decode_varint(payload, offset)
            value = payload[offset : offset + length]
            offset += length
            fields.append((field_number, wire_type, value))
            continue

        raise ValueError(f"unsupported wire type {wire_type}")

    return fields


def _get_field_values(payload: bytes, field_number: int) -> list[bytes | int]:
    return [value for number, _, value in _parse_message_fields(payload) if number == field_number]


def decode_varint(buffer: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while True:
        byte = buffer[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, offset
        shift += 7


def get_top_level_length_delimited_fields(payload: bytes, field_number: int) -> list[bytes]:
    values: list[bytes] = []
    offset = 0
    while offset < len(payload):
        tag, offset = decode_varint(payload, offset)
        wire_type = tag & 0x07
        current_field_number = tag >> 3

        if wire_type == 0:
            _, offset = decode_varint(payload, offset)
            continue

        if wire_type != 2:
            raise AssertionError(f"unsupported wire type {wire_type} in test payload decoder")

        length, offset = decode_varint(payload, offset)
        value = payload[offset : offset + length]
        offset += length

        if current_field_number == field_number:
            values.append(value)

    return values


class ConnectFrameDecodeTests(unittest.TestCase):
    def setUp(self):
        module.runtime_ls_registry = module.RuntimeLSRegistry()

    def test_chat_service_defaults_to_api(self):
        old_service = os.environ.get("WINDSURF_CHAT_SERVICE")
        try:
            os.environ.pop("WINDSURF_CHAT_SERVICE", None)
            self.assertEqual(module.get_chat_service(), "api")
        finally:
            if old_service is None:
                os.environ.pop("WINDSURF_CHAT_SERVICE", None)
            else:
                os.environ["WINDSURF_CHAT_SERVICE"] = old_service

    def test_probe_mode_defaults_to_ls_emulator_without_direct_key(self):
        old_mode = os.environ.get("WINDSURF_PROBE_MODE")
        old_token = os.environ.get("WINDSURF_DIRECT_KEY")
        old_db_path = os.environ.get("WINDSURF_STATE_DB_PATH")
        try:
            os.environ.pop("WINDSURF_PROBE_MODE", None)
            os.environ.pop("WINDSURF_DIRECT_KEY", None)
            with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp:
                db_path = tmp.name

            con = sqlite3.connect(db_path)
            cur = con.cursor()
            cur.execute("create table ItemTable (key text, value text)")
            cur.execute(
                "insert into ItemTable (key, value) values (?, ?)",
                (
                    "windsurfAuthStatus",
                    json.dumps({"apiKey": "devin-session-token$abc"}),
                ),
            )
            con.commit()
            con.close()
            os.environ["WINDSURF_STATE_DB_PATH"] = db_path

            self.assertEqual(module.get_probe_mode(), "ls_emulator")
        finally:
            if old_mode is None:
                os.environ.pop("WINDSURF_PROBE_MODE", None)
            else:
                os.environ["WINDSURF_PROBE_MODE"] = old_mode

            if old_token is None:
                os.environ.pop("WINDSURF_DIRECT_KEY", None)
            else:
                os.environ["WINDSURF_DIRECT_KEY"] = old_token

            if old_db_path is None:
                os.environ.pop("WINDSURF_STATE_DB_PATH", None)
            else:
                os.environ["WINDSURF_STATE_DB_PATH"] = old_db_path

            if "db_path" in locals():
                pathlib.Path(db_path).unlink(missing_ok=True)

    def test_probe_mode_defaults_to_direct_with_real_direct_key(self):
        old_mode = os.environ.get("WINDSURF_PROBE_MODE")
        old_token = os.environ.get("WINDSURF_DIRECT_KEY")
        try:
            os.environ.pop("WINDSURF_PROBE_MODE", None)
            os.environ["WINDSURF_DIRECT_KEY"] = "sk-ws-01-real-key"

            self.assertEqual(module.get_probe_mode(), "direct")
        finally:
            if old_mode is None:
                os.environ.pop("WINDSURF_PROBE_MODE", None)
            else:
                os.environ["WINDSURF_PROBE_MODE"] = old_mode

            if old_token is None:
                os.environ.pop("WINDSURF_DIRECT_KEY", None)
            else:
                os.environ["WINDSURF_DIRECT_KEY"] = old_token

    def test_local_language_server_url_falls_back_to_default_value(self):
        module.runtime_ls_registry = module.RuntimeLSRegistry()
        old_url = os.environ.get("WINDSURF_LANGUAGE_SERVER_URL")
        old_binding_path = os.environ.get("WINDSURF_RUNTIME_LS_BINDING_PATH")
        old_bootstrap_path = os.environ.get("WINDSURF_LIVE_BOOTSTRAP_PATH")
        old_discover = module.discover_runtime_ls_url
        try:
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                binding_path = tmp.name
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                bootstrap_path = tmp.name
            pathlib.Path(binding_path).unlink(missing_ok=True)
            pathlib.Path(bootstrap_path).write_text("{}", encoding="utf-8")
            os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = binding_path
            os.environ["WINDSURF_LIVE_BOOTSTRAP_PATH"] = bootstrap_path
            os.environ.pop("WINDSURF_LANGUAGE_SERVER_URL", None)
            module.discover_runtime_ls_url = lambda: None
            self.assertEqual(module.get_local_language_server_url(), "http://127.0.0.1:53740")
        finally:
            module.discover_runtime_ls_url = old_discover
            if old_url is None:
                os.environ.pop("WINDSURF_LANGUAGE_SERVER_URL", None)
            else:
                os.environ["WINDSURF_LANGUAGE_SERVER_URL"] = old_url
            if old_binding_path is None:
                os.environ.pop("WINDSURF_RUNTIME_LS_BINDING_PATH", None)
            else:
                os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = old_binding_path
            if old_bootstrap_path is None:
                os.environ.pop("WINDSURF_LIVE_BOOTSTRAP_PATH", None)
            else:
                os.environ["WINDSURF_LIVE_BOOTSTRAP_PATH"] = old_bootstrap_path
            if "binding_path" in locals():
                pathlib.Path(binding_path).unlink(missing_ok=True)
            if "bootstrap_path" in locals():
                pathlib.Path(bootstrap_path).unlink(missing_ok=True)

    def test_local_host_header_defaults_to_q_localhost_53740(self):
        old_host = os.environ.get("WINDSURF_LS_HOST_HEADER")
        try:
            os.environ.pop("WINDSURF_LS_HOST_HEADER", None)
            self.assertEqual(module.get_local_host_header(), "q.localhost:53740")
            self.assertEqual(module.get_local_host_header("StartCascade"), "r.localhost:53740")
        finally:
            if old_host is None:
                os.environ.pop("WINDSURF_LS_HOST_HEADER", None)
            else:
                os.environ["WINDSURF_LS_HOST_HEADER"] = old_host

    def test_local_origin_defaults_to_vscode_file_scheme(self):
        old_origin = os.environ.get("WINDSURF_LOCAL_ORIGIN")
        try:
            os.environ.pop("WINDSURF_LOCAL_ORIGIN", None)
            self.assertEqual(module.get_local_origin(), "vscode-file://vscode-app")
        finally:
            if old_origin is None:
                os.environ.pop("WINDSURF_LOCAL_ORIGIN", None)
            else:
                os.environ["WINDSURF_LOCAL_ORIGIN"] = old_origin

    def test_real_envelope_validator_requires_csrf_and_session_id(self):
        old_csrf = os.environ.get("WINDSURF_CSRF_TOKEN")
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_db_path = os.environ.get("WINDSURF_STATE_DB_PATH")
        old_binding_path = os.environ.get("WINDSURF_RUNTIME_LS_BINDING_PATH")
        old_bootstrap_path = os.environ.get("WINDSURF_LIVE_BOOTSTRAP_PATH")
        try:
            with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp:
                db_path = tmp.name
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                binding_path = tmp.name
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                bootstrap_path = tmp.name
            pathlib.Path(binding_path).unlink(missing_ok=True)
            pathlib.Path(bootstrap_path).write_text("{}", encoding="utf-8")
            con = sqlite3.connect(db_path)
            cur = con.cursor()
            cur.execute("create table ItemTable (key text, value text)")
            cur.execute(
                "insert into ItemTable (key, value) values (?, ?)",
                (
                    "windsurfAuthStatus",
                    json.dumps({"apiKey": "devin-session-token$abc"}),
                ),
            )
            con.commit()
            con.close()
            os.environ["WINDSURF_STATE_DB_PATH"] = db_path
            os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = binding_path
            os.environ["WINDSURF_LIVE_BOOTSTRAP_PATH"] = bootstrap_path
            os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            os.environ.pop("WINDSURF_SESSION_ID", None)

            summary = module.build_ls_envelope_validation_summary(rpc_name="SendUserCascadeMessage", cascade_id=None)

            self.assertFalse(summary["valid"])
            self.assertIn("csrf token missing", summary["errors"])
            self.assertIn("metadata.sessionId missing", summary["errors"])
            self.assertIn("cascadeId missing", summary["errors"])
        finally:
            if old_csrf is None:
                os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            else:
                os.environ["WINDSURF_CSRF_TOKEN"] = old_csrf

            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

            if old_db_path is None:
                os.environ.pop("WINDSURF_STATE_DB_PATH", None)
            else:
                os.environ["WINDSURF_STATE_DB_PATH"] = old_db_path

            if old_binding_path is None:
                os.environ.pop("WINDSURF_RUNTIME_LS_BINDING_PATH", None)
            else:
                os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = old_binding_path
            if old_bootstrap_path is None:
                os.environ.pop("WINDSURF_LIVE_BOOTSTRAP_PATH", None)
            else:
                os.environ["WINDSURF_LIVE_BOOTSTRAP_PATH"] = old_bootstrap_path

            if "db_path" in locals():
                pathlib.Path(db_path).unlink(missing_ok=True)
            if "binding_path" in locals():
                pathlib.Path(binding_path).unlink(missing_ok=True)
            if "bootstrap_path" in locals():
                pathlib.Path(bootstrap_path).unlink(missing_ok=True)

    def test_loads_local_env_file_for_ls_envelope_validation(self):
        old_csrf = os.environ.get("WINDSURF_CSRF_TOKEN")
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_db_path = os.environ.get("WINDSURF_STATE_DB_PATH")
        old_binding_path = os.environ.get("WINDSURF_RUNTIME_LS_BINDING_PATH")
        old_local_env_path = os.environ.get("WINDSURF_LOCAL_ENV_PATH")
        try:
            with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp:
                db_path = tmp.name
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                binding_path = tmp.name
            with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False, encoding="utf-8") as tmp:
                env_path = tmp.name
                tmp.write("WINDSURF_CSRF_TOKEN=test-csrf\n")
                tmp.write("WINDSURF_SESSION_ID=test-session\n")
            pathlib.Path(binding_path).unlink(missing_ok=True)
            con = sqlite3.connect(db_path)
            cur = con.cursor()
            cur.execute("create table ItemTable (key text, value text)")
            cur.execute(
                "insert into ItemTable (key, value) values (?, ?)",
                (
                    "windsurfAuthStatus",
                    json.dumps({"apiKey": "devin-session-token$abc"}),
                ),
            )
            con.commit()
            con.close()
            os.environ["WINDSURF_STATE_DB_PATH"] = db_path
            os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = binding_path
            os.environ["WINDSURF_LOCAL_ENV_PATH"] = env_path
            os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            os.environ.pop("WINDSURF_SESSION_ID", None)

            module.load_local_probe_env_file()
            summary = module.build_ls_envelope_validation_summary(rpc_name="StartCascade")

            self.assertEqual(os.environ.get("WINDSURF_CSRF_TOKEN"), "test-csrf")
            self.assertEqual(os.environ.get("WINDSURF_SESSION_ID"), "test-session")
            self.assertTrue(summary["valid"])
            self.assertEqual(summary["errors"], [])
        finally:
            if old_csrf is None:
                os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            else:
                os.environ["WINDSURF_CSRF_TOKEN"] = old_csrf

            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

            if old_db_path is None:
                os.environ.pop("WINDSURF_STATE_DB_PATH", None)
            else:
                os.environ["WINDSURF_STATE_DB_PATH"] = old_db_path

            if old_binding_path is None:
                os.environ.pop("WINDSURF_RUNTIME_LS_BINDING_PATH", None)
            else:
                os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = old_binding_path

            if old_local_env_path is None:
                os.environ.pop("WINDSURF_LOCAL_ENV_PATH", None)
            else:
                os.environ["WINDSURF_LOCAL_ENV_PATH"] = old_local_env_path

            if "db_path" in locals():
                pathlib.Path(db_path).unlink(missing_ok=True)
            if "binding_path" in locals():
                pathlib.Path(binding_path).unlink(missing_ok=True)
            if "env_path" in locals():
                pathlib.Path(env_path).unlink(missing_ok=True)

    def test_run_ls_emulator_cycle_skips_start_cascade_until_csrf_and_session_id_exist(self):
        old_chat_text = os.environ.get("WINDSURF_CHAT_TEXT")
        old_csrf = os.environ.get("WINDSURF_CSRF_TOKEN")
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_binding_path = os.environ.get("WINDSURF_RUNTIME_LS_BINDING_PATH")
        old_start_cascade = module.start_cascade
        old_build_run_observation = module.build_run_observation
        try:
            os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            os.environ.pop("WINDSURF_SESSION_ID", None)
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                binding_path = tmp.name
            pathlib.Path(binding_path).unlink(missing_ok=True)
            os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = binding_path
            module.runtime_ls_registry = module.RuntimeLSRegistry()

            start_cascade_called = False

            def fake_start_cascade(_token, base_url=None):
                nonlocal start_cascade_called
                start_cascade_called = True
                raise AssertionError("start_cascade should not run while csrf/session preconditions are missing")

            def fake_build_run_observation(*, run_id, prompt_text, cascade_id, metadata, assignment):
                return {
                    "run": run_id,
                    "prompt": prompt_text,
                    "cascadeId": cascade_id,
                    "sessionProvenance": metadata.get("sessionIdProvenance") if isinstance(metadata, dict) else None,
                    "waitingForCascadePreconditions": True,
                }

            module.start_cascade = fake_start_cascade
            module.build_run_observation = fake_build_run_observation

            exit_code, payload = module.run_ls_emulator_cycle(
                "devin-session-token$abc",
                prompt_text="hello_probe_001",
                run_id="WAIT-001",
            )

            self.assertFalse(start_cascade_called)
            self.assertEqual(exit_code, 0)
            self.assertEqual(payload["runObservation"]["waitingForCascadePreconditions"], True)
            self.assertIsNone(payload["startCascade"])
            self.assertIsNone(payload["sendUserCascadeMessage"])
            self.assertIsNone(payload["assignModel"])
        finally:
            module.start_cascade = old_start_cascade
            module.build_run_observation = old_build_run_observation

            if old_chat_text is None:
                os.environ.pop("WINDSURF_CHAT_TEXT", None)
            else:
                os.environ["WINDSURF_CHAT_TEXT"] = old_chat_text

            if old_csrf is None:
                os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            else:
                os.environ["WINDSURF_CSRF_TOKEN"] = old_csrf

            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

            if old_binding_path is None:
                os.environ.pop("WINDSURF_RUNTIME_LS_BINDING_PATH", None)
            else:
                os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = old_binding_path

            if "binding_path" in locals():
                pathlib.Path(binding_path).unlink(missing_ok=True)

    def test_cloud_chat_probe_uses_api_server_service_url(self):
        old_base = os.environ.get("WINDSURF_CHAT_BASE_URL")
        old_text = os.environ.get("WINDSURF_CHAT_TEXT")
        old_model = os.environ.get("WINDSURF_CHAT_MODEL_NAME")
        old_service = os.environ.get("WINDSURF_CHAT_SERVICE")
        old_method = os.environ.get("WINDSURF_CHAT_METHOD_NAME")
        try:
            os.environ["WINDSURF_CHAT_BASE_URL"] = "https://eu.windsurf.com/_route/api_server"
            os.environ["WINDSURF_CHAT_TEXT"] = "hello"
            os.environ["WINDSURF_CHAT_MODEL_NAME"] = "kimi-k2-6"
            os.environ["WINDSURF_CHAT_SERVICE"] = "api"
            os.environ["WINDSURF_CHAT_METHOD_NAME"] = "GetChatMessage"

            request, preview = module.build_chat_probe_request("test-token")

            self.assertEqual(
                request.full_url,
                "https://eu.windsurf.com/_route/api_server/"
                "exa.api_server_pb.ApiServerService/GetChatMessage",
            )
            self.assertEqual(preview["url"], request.full_url)
        finally:
            if old_base is None:
                os.environ.pop("WINDSURF_CHAT_BASE_URL", None)
            else:
                os.environ["WINDSURF_CHAT_BASE_URL"] = old_base

            if old_text is None:
                os.environ.pop("WINDSURF_CHAT_TEXT", None)
            else:
                os.environ["WINDSURF_CHAT_TEXT"] = old_text

            if old_model is None:
                os.environ.pop("WINDSURF_CHAT_MODEL_NAME", None)
            else:
                os.environ["WINDSURF_CHAT_MODEL_NAME"] = old_model

            if old_service is None:
                os.environ.pop("WINDSURF_CHAT_SERVICE", None)
            else:
                os.environ["WINDSURF_CHAT_SERVICE"] = old_service

            if old_method is None:
                os.environ.pop("WINDSURF_CHAT_METHOD_NAME", None)
            else:
                os.environ["WINDSURF_CHAT_METHOD_NAME"] = old_method

    def test_cloud_chat_request_contains_minimal_expected_fields(self):
        old_model = os.environ.get("WINDSURF_CHAT_MODEL_NAME")
        try:
            os.environ["WINDSURF_CHAT_MODEL_NAME"] = "kimi-k2-6"
            body, preview = module.build_cloud_chat_request("test-token")

            payload = body[5:]

            self.assertEqual(body[0], 0)
            self.assertEqual(int.from_bytes(body[1:5], "big"), len(payload))
            self.assertEqual(preview["chatModelName"], "kimi-k2-6")
            self.assertIn(bytes([0x0A]), payload)
            self.assertIn(bytes([0x1A]), payload)
            self.assertIn(bytes([0x72]), payload)
            self.assertNotIn(bytes([0x40]), payload)
        finally:
            if old_model is None:
                os.environ.pop("WINDSURF_CHAT_MODEL_NAME", None)
            else:
                os.environ["WINDSURF_CHAT_MODEL_NAME"] = old_model

    def test_cloud_chat_request_serializes_chat_model_name_field_14(self):
        old_model = os.environ.get("WINDSURF_CHAT_MODEL_NAME")
        try:
            os.environ["WINDSURF_CHAT_MODEL_NAME"] = "kimi-k2-6"
            body, preview = module.build_cloud_chat_request("test-token")

            payload = body[5:]
            field_payload = _get_field_values(payload, 14)[0]

            self.assertEqual(preview["chatModelName"], "kimi-k2-6")
            self.assertEqual(field_payload.decode("utf-8"), "kimi-k2-6")
        finally:
            if old_model is None:
                os.environ.pop("WINDSURF_CHAT_MODEL_NAME", None)
            else:
                os.environ["WINDSURF_CHAT_MODEL_NAME"] = old_model

    def test_cloud_chat_request_preview_exposes_bundle_identity_mapping(self):
        old_model = os.environ.get("WINDSURF_CHAT_MODEL_NAME")
        try:
            os.environ["WINDSURF_CHAT_MODEL_NAME"] = "kimi-k2-6"
            _, preview = module.build_cloud_chat_request("test-token")

            self.assertEqual(preview["chatModelName"], "kimi-k2-6")
            self.assertEqual(preview["chatModelFieldNumber"], 9)
            self.assertEqual(preview["chatModelNameFieldNumber"], 14)
            self.assertEqual(preview["chatModelEncoding"], "enum-varint")
            self.assertEqual(preview["bundleMappingChain"], [
                "model_router_uid",
                "model_uid",
                "model_id",
                "chat_model_name",
            ])
        finally:
            if old_model is None:
                os.environ.pop("WINDSURF_CHAT_MODEL_NAME", None)
            else:
                os.environ["WINDSURF_CHAT_MODEL_NAME"] = old_model

    def test_cloud_chat_request_serializes_first_chat_message_with_direct_content_field(self):
        body, preview = module.build_cloud_chat_request("test-token")

        payload = body[5:]
        field_payload = _get_field_values(payload, 3)[0]
        nested_fields = _parse_message_fields(field_payload)

        self.assertEqual(preview["chatText"], "hello")
        self.assertEqual([field[0] for field in nested_fields], [1, 3])
        self.assertEqual(nested_fields[0][2], 1)
        self.assertEqual(nested_fields[1][2], b"hello")

    def test_cloud_chat_request_can_toggle_optional_context_fields(self):
        old_context = os.environ.get("WINDSURF_CONTEXT_INCLUSION_TYPE")
        old_selection = os.environ.get("WINDSURF_ACTIVE_SELECTION")
        old_open = os.environ.get("WINDSURF_OPEN_DOCUMENT_URIS")
        old_workspace = os.environ.get("WINDSURF_WORKSPACE_URIS")
        old_active_uri = os.environ.get("WINDSURF_ACTIVE_DOCUMENT_URI")
        old_active_workspace = os.environ.get("WINDSURF_ACTIVE_DOCUMENT_WORKSPACE_URI")
        old_active_text = os.environ.get("WINDSURF_ACTIVE_DOCUMENT_TEXT")
        old_active_editor_language = os.environ.get("WINDSURF_ACTIVE_DOCUMENT_EDITOR_LANGUAGE")
        try:
            os.environ["WINDSURF_CONTEXT_INCLUSION_TYPE"] = "0"
            os.environ["WINDSURF_ACTIVE_SELECTION"] = ""
            os.environ["WINDSURF_OPEN_DOCUMENT_URIS"] = "file:///open.py"
            os.environ["WINDSURF_WORKSPACE_URIS"] = "file:///workspace"
            os.environ["WINDSURF_ACTIVE_DOCUMENT_URI"] = "file:///open.py"
            os.environ["WINDSURF_ACTIVE_DOCUMENT_WORKSPACE_URI"] = "file:///workspace"
            os.environ["WINDSURF_ACTIVE_DOCUMENT_TEXT"] = "hello"
            os.environ["WINDSURF_ACTIVE_DOCUMENT_EDITOR_LANGUAGE"] = "python"

            body, preview = module.build_cloud_chat_request("test-token")
            payload = body[5:]

            self.assertEqual(preview["contextInclusionType"], "0")
            self.assertEqual(preview["activeDocument"]["absoluteUri"], "file:///open.py")
            self.assertIn(bytes([0x2A]), payload)
            self.assertIn(bytes([0x40]), payload)
            self.assertIn(bytes([0x5A]), payload)
            self.assertIn(bytes([0x62]), payload)
            self.assertIn(bytes([0x6A]), payload)
        finally:
            if old_context is None:
                os.environ.pop("WINDSURF_CONTEXT_INCLUSION_TYPE", None)
            else:
                os.environ["WINDSURF_CONTEXT_INCLUSION_TYPE"] = old_context

            if old_selection is None:
                os.environ.pop("WINDSURF_ACTIVE_SELECTION", None)
            else:
                os.environ["WINDSURF_ACTIVE_SELECTION"] = old_selection

            if old_open is None:
                os.environ.pop("WINDSURF_OPEN_DOCUMENT_URIS", None)
            else:
                os.environ["WINDSURF_OPEN_DOCUMENT_URIS"] = old_open

            if old_workspace is None:
                os.environ.pop("WINDSURF_WORKSPACE_URIS", None)
            else:
                os.environ["WINDSURF_WORKSPACE_URIS"] = old_workspace

            if old_active_uri is None:
                os.environ.pop("WINDSURF_ACTIVE_DOCUMENT_URI", None)
            else:
                os.environ["WINDSURF_ACTIVE_DOCUMENT_URI"] = old_active_uri

            if old_active_workspace is None:
                os.environ.pop("WINDSURF_ACTIVE_DOCUMENT_WORKSPACE_URI", None)
            else:
                os.environ["WINDSURF_ACTIVE_DOCUMENT_WORKSPACE_URI"] = old_active_workspace

            if old_active_text is None:
                os.environ.pop("WINDSURF_ACTIVE_DOCUMENT_TEXT", None)
            else:
                os.environ["WINDSURF_ACTIVE_DOCUMENT_TEXT"] = old_active_text

            if old_active_editor_language is None:
                os.environ.pop("WINDSURF_ACTIVE_DOCUMENT_EDITOR_LANGUAGE", None)
            else:
                os.environ["WINDSURF_ACTIVE_DOCUMENT_EDITOR_LANGUAGE"] = old_active_editor_language

    def test_probe_mode_accepts_chat(self):
        old_mode = os.environ.get("WINDSURF_PROBE_MODE")
        try:
            os.environ["WINDSURF_PROBE_MODE"] = "chat"
            self.assertEqual(module.get_probe_mode(), "chat")
        finally:
            if old_mode is None:
                os.environ.pop("WINDSURF_PROBE_MODE", None)
            else:
                os.environ["WINDSURF_PROBE_MODE"] = old_mode

    def test_probe_mode_accepts_api_wrapper(self):
        old_mode = os.environ.get("WINDSURF_PROBE_MODE")
        try:
            os.environ["WINDSURF_PROBE_MODE"] = "api-wrapper"
            self.assertEqual(module.get_probe_mode(), "api-wrapper")
        finally:
            if old_mode is None:
                os.environ.pop("WINDSURF_PROBE_MODE", None)
            else:
                os.environ["WINDSURF_PROBE_MODE"] = old_mode

    def test_probe_mode_accepts_assign_model(self):
        old_mode = os.environ.get("WINDSURF_PROBE_MODE")
        try:
            os.environ["WINDSURF_PROBE_MODE"] = "assign-model"
            self.assertEqual(module.get_probe_mode(), "assign-model")
        finally:
            if old_mode is None:
                os.environ.pop("WINDSURF_PROBE_MODE", None)
            else:
                os.environ["WINDSURF_PROBE_MODE"] = old_mode

    def test_assign_model_probe_uses_api_server_assign_model_url(self):
        old_base = os.environ.get("WINDSURF_CHAT_BASE_URL")
        old_method = os.environ.get("WINDSURF_ASSIGN_MODEL_METHOD_NAME")
        try:
            os.environ["WINDSURF_CHAT_BASE_URL"] = "https://server.codeium.com"
            os.environ["WINDSURF_ASSIGN_MODEL_METHOD_NAME"] = "AssignModel"

            request, preview = module.build_assign_model_probe_request("test-token")

            self.assertEqual(
                request.full_url,
                "https://server.codeium.com/exa.api_server_pb.ApiServerService/AssignModel",
            )
            self.assertEqual(preview["url"], request.full_url)
        finally:
            if old_base is None:
                os.environ.pop("WINDSURF_CHAT_BASE_URL", None)
            else:
                os.environ["WINDSURF_CHAT_BASE_URL"] = old_base

            if old_method is None:
                os.environ.pop("WINDSURF_ASSIGN_MODEL_METHOD_NAME", None)
            else:
                os.environ["WINDSURF_ASSIGN_MODEL_METHOD_NAME"] = old_method

    def test_start_cascade_probe_uses_local_host_header_default(self):
        old_csrf = os.environ.get("WINDSURF_CSRF_TOKEN")
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_db_path = os.environ.get("WINDSURF_STATE_DB_PATH")
        old_binding_path = os.environ.get("WINDSURF_RUNTIME_LS_BINDING_PATH")
        old_bootstrap_path = os.environ.get("WINDSURF_LIVE_BOOTSTRAP_PATH")
        try:
            with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp:
                db_path = tmp.name
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                binding_path = tmp.name
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                bootstrap_path = tmp.name
            pathlib.Path(binding_path).unlink(missing_ok=True)
            pathlib.Path(bootstrap_path).write_text("{}", encoding="utf-8")
            con = sqlite3.connect(db_path)
            cur = con.cursor()
            cur.execute("create table ItemTable (key text, value text)")
            cur.execute(
                "insert into ItemTable (key, value) values (?, ?)",
                (
                    "windsurfAuthStatus",
                    json.dumps({"apiKey": "devin-session-token$abc"}),
                ),
            )
            con.commit()
            con.close()
            os.environ["WINDSURF_STATE_DB_PATH"] = db_path
            os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = binding_path
            os.environ["WINDSURF_LIVE_BOOTSTRAP_PATH"] = bootstrap_path
            os.environ["WINDSURF_CSRF_TOKEN"] = "csrf-123"
            os.environ["WINDSURF_SESSION_ID"] = "session-123"

            request, _preview = module.build_start_cascade_probe_request("devin-session-token$abc")

            self.assertEqual(request.headers["Host"], "r.localhost:53740")
            self.assertEqual(request.headers.get("X-codeium-csrf-token"), "csrf-123")
            self.assertEqual(request.headers.get("Origin"), "vscode-file://vscode-app")
            self.assertNotIn("Authorization", request.headers)
        finally:
            if old_csrf is None:
                os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            else:
                os.environ["WINDSURF_CSRF_TOKEN"] = old_csrf

            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

            if old_db_path is None:
                os.environ.pop("WINDSURF_STATE_DB_PATH", None)
            else:
                os.environ["WINDSURF_STATE_DB_PATH"] = old_db_path

            if old_binding_path is None:
                os.environ.pop("WINDSURF_RUNTIME_LS_BINDING_PATH", None)
            else:
                os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = old_binding_path
            if old_bootstrap_path is None:
                os.environ.pop("WINDSURF_LIVE_BOOTSTRAP_PATH", None)
            else:
                os.environ["WINDSURF_LIVE_BOOTSTRAP_PATH"] = old_bootstrap_path

            if "db_path" in locals():
                pathlib.Path(db_path).unlink(missing_ok=True)
            if "binding_path" in locals():
                pathlib.Path(binding_path).unlink(missing_ok=True)
            if "bootstrap_path" in locals():
                pathlib.Path(bootstrap_path).unlink(missing_ok=True)

    def test_local_host_header_uses_confirmed_runtime_binding_port(self):
        old_host = os.environ.get("WINDSURF_LS_HOST_HEADER")
        old_binding_path = os.environ.get("WINDSURF_RUNTIME_LS_BINDING_PATH")
        original_registry = module.runtime_ls_registry
        try:
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                binding_path = tmp.name
            pathlib.Path(binding_path).unlink(missing_ok=True)
            os.environ.pop("WINDSURF_LS_HOST_HEADER", None)
            os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = binding_path
            module.runtime_ls_registry = module.RuntimeLSRegistry()
            binding = module.on_language_server_started(
                session_id="runtime-session-1",
                window_id="window-1",
                host="127.0.0.1",
                port=62258,
                lifecycle_nonce="nonce-1",
                timestamp=1714560000.0,
                csrf_token=None,
                confirmed=True,
            )
            module.persist_runtime_ls_binding(binding)

            self.assertEqual(module.get_local_host_header(), "q.localhost:62258")
            self.assertEqual(module.get_local_host_header("StartCascade"), "r.localhost:62258")
            self.assertEqual(module.get_local_host_header("SendUserCascadeMessage"), "e.localhost:62258")
        finally:
            module.runtime_ls_registry = original_registry
            if old_host is None:
                os.environ.pop("WINDSURF_LS_HOST_HEADER", None)
            else:
                os.environ["WINDSURF_LS_HOST_HEADER"] = old_host
            if old_binding_path is None:
                os.environ.pop("WINDSURF_RUNTIME_LS_BINDING_PATH", None)
            else:
                os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = old_binding_path
            if "binding_path" in locals():
                pathlib.Path(binding_path).unlink(missing_ok=True)

    def test_local_csrf_token_prefers_live_bootstrap_over_env_fallback(self):
        old_csrf = os.environ.get("WINDSURF_CSRF_TOKEN")
        old_binding_path = os.environ.get("WINDSURF_RUNTIME_LS_BINDING_PATH")
        old_bootstrap_path = os.environ.get("WINDSURF_LIVE_BOOTSTRAP_PATH")
        original_registry = module.runtime_ls_registry
        try:
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                binding_path = tmp.name
            with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
                bootstrap_path = tmp.name
                json.dump(
                    {
                        "csrfToken": "live-csrf-999",
                        "languageServerPort": 62258,
                        "languageServerUrl": "http://127.0.0.1:62258",
                    },
                    tmp,
                )
            pathlib.Path(binding_path).unlink(missing_ok=True)
            os.environ["WINDSURF_CSRF_TOKEN"] = "env-csrf-stale"
            os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = binding_path
            os.environ["WINDSURF_LIVE_BOOTSTRAP_PATH"] = bootstrap_path
            module.runtime_ls_registry = module.RuntimeLSRegistry()
            binding = module.on_language_server_started(
                session_id="runtime-session-1",
                window_id="window-1",
                host="127.0.0.1",
                port=62258,
                lifecycle_nonce="nonce-1",
                timestamp=1714560000.0,
                csrf_token=None,
                confirmed=True,
            )
            module.persist_runtime_ls_binding(binding)

            self.assertEqual(module.get_local_csrf_token(), "live-csrf-999")
        finally:
            module.runtime_ls_registry = original_registry
            if old_csrf is None:
                os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            else:
                os.environ["WINDSURF_CSRF_TOKEN"] = old_csrf
            if old_binding_path is None:
                os.environ.pop("WINDSURF_RUNTIME_LS_BINDING_PATH", None)
            else:
                os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = old_binding_path
            if old_bootstrap_path is None:
                os.environ.pop("WINDSURF_LIVE_BOOTSTRAP_PATH", None)
            else:
                os.environ["WINDSURF_LIVE_BOOTSTRAP_PATH"] = old_bootstrap_path
            if "binding_path" in locals():
                pathlib.Path(binding_path).unlink(missing_ok=True)
            if "bootstrap_path" in locals():
                pathlib.Path(bootstrap_path).unlink(missing_ok=True)

    def test_structured_rpc_log_contains_required_fields(self):
        request = module.urllib.request.Request(
            "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/StartCascade",
            data=b"abc",
            headers={"Host": "q.localhost:53740", "x-codeium-csrf-token": "csrf-123"},
            method="POST",
        )
        preview = {
            "cascadeId": "cascade-123",
            "metadata": {"sessionId": "session-123"},
        }
        result = {
            "status": 200,
            "bodyText": "9f0df4db-7fd4-4f37-a7d6-6a8c8fe6f0a1",
            "decodedUnaryProto": {"fieldNumbers": [1, 2]},
        }

        structured = module.build_structured_rpc_log("StartCascade", request, result, preview)

        self.assertEqual(structured["rpc_name"], "StartCascade")
        self.assertEqual(structured["host"], "q.localhost:53740")
        self.assertEqual(structured["status"], 200)
        self.assertEqual(structured["cascadeId"], "cascade-123")
        self.assertEqual(structured["sessionId"], "session-123")
        self.assertEqual(structured["payload_size"], 3)
        self.assertEqual(structured["protobuf_fields_detected"], [1, 2])
        self.assertEqual(structured["rawBodyPreview"], "9f0df4db-7fd4-4f37-a7d6-6a8c8fe6f0a1")
        self.assertEqual(structured["extractedCascadeId"], "9f0df4db-7fd4-4f37-a7d6-6a8c8fe6f0a1")
        self.assertEqual(structured["cascadeIdSource"], "bodyText-regex")

    def test_build_run_observation_returns_normalized_doe_shape(self):
        observation = module.build_run_observation(
            run_id="B",
            prompt_text="hello",
            cascade_id="cascade-123",
            metadata={
                "sessionId": "synthetic-123",
                "sessionIdProvenance": "synthetic",
            },
            assignment={
                "assignmentJwt": "jwt-123",
                "assignedModelUid": "MODEL_SWE_1_5",
                "harnessUid": "swe-1p5",
            },
        )

        self.assertEqual(
            observation,
            {
                "run": "B",
                "sessionProvenance": "synthetic",
                "cascadeId": "cascade-123",
                "assignedModelUid": "MODEL_SWE_1_5",
                "harnessUid": "swe-1p5",
                "jwtHash16": module.sha256_16("jwt-123"),
            },
        )

    def test_build_structured_rpc_log_preserves_instance_hints_when_present(self):
        request = module.urllib.request.Request(
            "https://server.codeium.com/exa.api_server_pb.ApiServerService/AssignModel",
            data=b"abc",
            headers={"Host": "server.codeium.com"},
            method="POST",
        )
        preview = {
            "cascadeId": "cascade-123",
            "metadata": {"sessionId": "session-123"},
        }
        result = {
            "status": 200,
            "responseObservability": {
                "instanceHints": {
                    "x-request-id": "req-123",
                    "trace-id": "trace-123",
                    "server-timing": "edge;dur=12",
                    "alt-svc": 'h3=":443"',
                    "server": "envoy",
                }
            },
            "decodedUnaryProto": {"fieldNumbers": [1]},
        }

        structured = module.build_structured_rpc_log("AssignModel", request, result, preview)

        self.assertEqual(structured["instanceHints"]["x-request-id"], "req-123")
        self.assertEqual(structured["instanceHints"]["trace-id"], "trace-123")
        self.assertEqual(structured["instanceHints"]["server-timing"], "edge;dur=12")

    def test_main_assign_model_emits_response_observability_shape(self):
        old_mode = os.environ.get("WINDSURF_PROBE_MODE")
        old_token = os.environ.get("WINDSURF_DIRECT_KEY")
        original_execute = module.DirectExecutor.execute
        original_emit_output = module.emit_output

        emitted = {}

        def fake_emit_output(payload):
            emitted.clear()
            emitted.update(payload)

        def fake_execute(_request, timeout=120):
            return 0, {
                "status": 200,
                "contentType": "application/proto",
                "responseObservability": {
                    "responseHeaders": {
                        "x-request-id": "req-123",
                        "server-timing": "edge;dur=12",
                    },
                    "instanceHints": {
                        "x-request-id": "req-123",
                        "trace-id": None,
                        "server-timing": "edge;dur=12",
                        "alt-svc": None,
                        "server": None,
                    },
                },
                "decodedProto": {
                    "assignment": {
                        "assignmentJwt": "jwt-token",
                        "assignedModelUid": "kimi-k2-5",
                        "harnessUid": "strawberry-pancake",
                        "modelRouterUid": None,
                    }
                },
            }

        try:
            os.environ["WINDSURF_PROBE_MODE"] = "assign-model"
            os.environ["WINDSURF_DIRECT_KEY"] = "test-token"
            module.DirectExecutor.execute = staticmethod(fake_execute)
            module.emit_output = fake_emit_output

            exit_code = module.main()

            self.assertEqual(exit_code, 0)
            self.assertEqual(emitted["responseObservability"]["instanceHints"]["x-request-id"], "req-123")
            self.assertEqual(emitted["decodedProto"]["assignment"]["assignedModelUid"], "kimi-k2-5")
        finally:
            module.DirectExecutor.execute = original_execute
            module.emit_output = original_emit_output
            if old_mode is None:
                os.environ.pop("WINDSURF_PROBE_MODE", None)
            else:
                os.environ["WINDSURF_PROBE_MODE"] = old_mode
            if old_token is None:
                os.environ.pop("WINDSURF_DIRECT_KEY", None)
            else:
                os.environ["WINDSURF_DIRECT_KEY"] = old_token

    def test_replay_from_capture_extracts_cascade_flow_subset(self):
        lines = [
            json.dumps(
                {
                    "classification": "cascade_initialization",
                    "request": {"url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/StartCascade"},
                    "response": {"protobufSummary": {"fieldNumbers": [1], "minimalExtract": {"possibleCascadeId": "cascade-123"}}},
                }
            ),
            json.dumps(
                {
                    "classification": "chat_message",
                    "request": {"url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage"},
                    "response": {"protobufSummary": {"fieldNumbers": [1, 2]}},
                }
            ),
            json.dumps(
                {
                    "classification": "model_assignment",
                    "request": {"url": "https://server.codeium.com/exa.api_server_pb.ApiServerService/AssignModel"},
                    "response": {"protobufSummary": {"fieldNumbers": [1]}},
                }
            ),
        ]

        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w", encoding="utf-8") as handle:
            capture_path = handle.name
            handle.write("\n".join(lines))

        try:
            replay = module.replay_from_capture(capture_path)

            self.assertEqual(replay["flowCount"], 3)
            self.assertEqual([flow["rpc"] for flow in replay["flows"]], [
                "StartCascade",
                "SendUserCascadeMessage",
                "AssignModel",
            ])
        finally:
            pathlib.Path(capture_path).unlink(missing_ok=True)

    def test_replay_from_capture_reconstructs_flow_level_session_id(self):
        lines = [
            json.dumps(
                {
                    "classification": "cascade_initialization",
                    "request": {
                        "url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/StartCascade",
                        "metadata": {"sessionId": "session-abc"},
                    },
                    "response": {"protobufSummary": {"fieldNumbers": [1], "minimalExtract": {"possibleCascadeId": "cascade-123"}}},
                }
            ),
            json.dumps(
                {
                    "classification": "chat_message",
                    "request": {
                        "url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
                        "metadata": {"sessionId": "session-abc"},
                    },
                    "response": {"protobufSummary": {"fieldNumbers": [1, 2]}},
                }
            ),
            json.dumps(
                {
                    "classification": "model_assignment",
                    "request": {
                        "url": "https://server.codeium.com/exa.api_server_pb.ApiServerService/AssignModel",
                        "metadata": {"sessionId": "session-abc"},
                    },
                    "response": {"protobufSummary": {"fieldNumbers": [1]}},
                }
            ),
        ]

        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w", encoding="utf-8") as handle:
            capture_path = handle.name
            handle.write("\n".join(lines))

        try:
            replay = module.replay_from_capture(capture_path)

            self.assertEqual(replay["flowCount"], 3)
            self.assertEqual([flow["sessionId"] for flow in replay["flows"]], [
                "session-abc",
                "session-abc",
                "session-abc",
            ])
        finally:
            pathlib.Path(capture_path).unlink(missing_ok=True)

    def test_replay_from_capture_does_not_fabricate_flow_level_session_id(self):
        lines = [
            json.dumps(
                {
                    "classification": "cascade_initialization",
                    "request": {"url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/StartCascade"},
                    "response": {"protobufSummary": {"fieldNumbers": [1], "minimalExtract": {"possibleCascadeId": "cascade-123"}}},
                }
            ),
            json.dumps(
                {
                    "classification": "chat_message",
                    "request": {"url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage"},
                    "response": {"protobufSummary": {"fieldNumbers": [1, 2]}},
                }
            ),
        ]

        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w", encoding="utf-8") as handle:
            capture_path = handle.name
            handle.write("\n".join(lines))

        try:
            replay = module.replay_from_capture(capture_path)

            self.assertEqual(replay["flowCount"], 2)
            self.assertEqual([flow.get("sessionId") for flow in replay["flows"]], [None, None])
        finally:
            pathlib.Path(capture_path).unlink(missing_ok=True)

    def test_replay_from_capture_normalizes_consistent_flow_level_session_id(self):
        lines = [
            json.dumps(
                {
                    "classification": "cascade_initialization",
                    "request": {
                        "url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/StartCascade",
                        "metadata": {"sessionId": "session-shared"},
                    },
                    "response": {"protobufSummary": {"fieldNumbers": [1], "minimalExtract": {"possibleCascadeId": "cascade-123"}}},
                }
            ),
            json.dumps(
                {
                    "classification": "chat_message",
                    "request": {
                        "url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
                        "metadata": {"sessionId": "session-shared"},
                    },
                    "response": {"protobufSummary": {"fieldNumbers": [1, 2]}},
                }
            ),
            json.dumps(
                {
                    "classification": "model_assignment",
                    "request": {
                        "url": "https://server.codeium.com/exa.api_server_pb.ApiServerService/AssignModel",
                        "metadata": {"sessionId": "session-shared"},
                    },
                    "response": {"protobufSummary": {"fieldNumbers": [1]}},
                }
            ),
        ]

        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w", encoding="utf-8") as handle:
            capture_path = handle.name
            handle.write("\n".join(lines))

        try:
            replay = module.replay_from_capture(capture_path)

            self.assertEqual({flow["sessionId"] for flow in replay["flows"]}, {"session-shared"})
        finally:
            pathlib.Path(capture_path).unlink(missing_ok=True)

    def test_replay_from_capture_matches_real_start_cascade_preview_session_id(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_synthetic = os.environ.get("WINDSURF_SYNTHETIC_SESSION_ID")
        old_csrf = os.environ.get("WINDSURF_CSRF_TOKEN")
        original_registry = module.runtime_ls_registry
        try:
            module.runtime_ls_registry = module.RuntimeLSRegistry()
            os.environ.pop("WINDSURF_SESSION_ID", None)
            os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            module.on_language_server_started(
                session_id="runtime-session-bridge",
                window_id="window-bridge",
                host="127.0.0.1",
                port=5052,
                lifecycle_nonce="nonce-bridge",
                timestamp=1714560002.0,
                csrf_token="csrf-runtime-bridge",
                confirmed=True,
            )

            _request_body, preview = module.build_start_cascade_request("devin-session-token-123")
            preview_session_id = preview["metadata"]["sessionId"]

            lines = [
                json.dumps(
                    {
                        "classification": "cascade_initialization",
                        "request": {
                            "url": preview["url"],
                            "metadata": {"sessionId": preview_session_id},
                        },
                        "response": {
                            "protobufSummary": {
                                "fieldNumbers": [1],
                                "minimalExtract": {"possibleCascadeId": "cascade-123"},
                            }
                        },
                    }
                )
            ]

            with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w", encoding="utf-8") as handle:
                capture_path = handle.name
                handle.write("\n".join(lines))

            try:
                replay = module.replay_from_capture(capture_path)

                self.assertEqual(preview_session_id, "runtime-session-bridge")
                self.assertEqual(replay["flowCount"], 1)
                self.assertEqual(replay["flows"][0]["rpc"], "StartCascade")
                self.assertEqual(replay["flows"][0]["sessionId"], preview_session_id)
            finally:
                pathlib.Path(capture_path).unlink(missing_ok=True)
        finally:
            module.runtime_ls_registry = original_registry
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session
            if old_synthetic is None:
                os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SYNTHETIC_SESSION_ID"] = old_synthetic
            if old_csrf is None:
                os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            else:
                os.environ["WINDSURF_CSRF_TOKEN"] = old_csrf

    def test_observation_layer_for_ls_emulator_mode(self):
        self.assertEqual(module.get_observation_layer("ls_emulator"), module.OBSERVATION_LAYER_LS_EMULATOR)

    def test_observation_layer_for_replay_mode(self):
        self.assertEqual(module.get_observation_layer("traffic_replay_emulator"), module.OBSERVATION_LAYER_REPLAY)

    def test_replay_executor_refuses_execution(self):
        with self.assertRaisesRegex(RuntimeError, "no execution allowed in replay mode"):
            module.ReplayExecutor.execute()

    def test_runtime_session_id_requires_observed_input(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_synthetic = os.environ.get("WINDSURF_SYNTHETIC_SESSION_ID")
        try:
            os.environ.pop("WINDSURF_SESSION_ID", None)
            os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            with self.assertRaisesRegex(ValueError, "WINDSURF_SESSION_ID is required"):
                module.get_runtime_session_id()
        finally:
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

            if old_synthetic is None:
                os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SYNTHETIC_SESSION_ID"] = old_synthetic

    def test_session_identity_marks_observed_provenance(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_synthetic = os.environ.get("WINDSURF_SYNTHETIC_SESSION_ID")
        try:
            os.environ["WINDSURF_SESSION_ID"] = "observed-123"
            os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)

            identity = module.resolve_session_identity()

            self.assertEqual(identity, {"value": "observed-123", "provenance": "observed"})
        finally:
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

            if old_synthetic is None:
                os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SYNTHETIC_SESSION_ID"] = old_synthetic

    def test_session_identity_marks_synthetic_provenance(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_synthetic = os.environ.get("WINDSURF_SYNTHETIC_SESSION_ID")
        try:
            os.environ.pop("WINDSURF_SESSION_ID", None)
            os.environ["WINDSURF_SYNTHETIC_SESSION_ID"] = "synthetic-123"

            identity = module.resolve_session_identity()

            self.assertEqual(identity, {"value": "synthetic-123", "provenance": "synthetic"})
        finally:
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

            if old_synthetic is None:
                os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SYNTHETIC_SESSION_ID"] = old_synthetic

    def test_ls_envelope_validation_uses_runtime_ls_session_id_when_env_session_id_missing(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_synthetic = os.environ.get("WINDSURF_SYNTHETIC_SESSION_ID")
        old_csrf = os.environ.get("WINDSURF_CSRF_TOKEN")
        original_registry = module.runtime_ls_registry
        try:
            module.runtime_ls_registry = module.RuntimeLSRegistry()
            os.environ.pop("WINDSURF_SESSION_ID", None)
            os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            module.on_language_server_started(
                session_id="runtime-session-1",
                window_id="window-1",
                host="127.0.0.1",
                port=5050,
                lifecycle_nonce="nonce-1",
                timestamp=1714560000.0,
                csrf_token="csrf-runtime-1",
                confirmed=True,
            )

            summary = module.build_ls_envelope_validation_summary(rpc_name="StartCascade")

            self.assertTrue(summary["metadataSessionIdPresent"])
            self.assertTrue(summary["csrfPresent"])
            self.assertTrue(summary["valid"])
        finally:
            module.runtime_ls_registry = original_registry
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

            if old_synthetic is None:
                os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SYNTHETIC_SESSION_ID"] = old_synthetic

            if old_csrf is None:
                os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            else:
                os.environ["WINDSURF_CSRF_TOKEN"] = old_csrf

    def test_ls_envelope_validation_hydrates_confirmed_runtime_binding_from_persisted_state(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_synthetic = os.environ.get("WINDSURF_SYNTHETIC_SESSION_ID")
        old_csrf = os.environ.get("WINDSURF_CSRF_TOKEN")
        old_state_path = os.environ.get("WINDSURF_RUNTIME_LS_BINDING_PATH")
        original_registry = module.runtime_ls_registry
        try:
            module.runtime_ls_registry = module.RuntimeLSRegistry()
            os.environ.pop("WINDSURF_SESSION_ID", None)
            os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                binding_path = tmp.name
            os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = binding_path

            module.build_ls_event_payload(json.dumps({
                "event": "LanguageServerStarted",
                "session_id": "persisted-runtime-session",
                "window_id": "window-persisted",
                "host": "127.0.0.1",
                "port": 5055,
                "lifecycle_nonce": "nonce-persisted",
                "timestamp": 1714560005.0,
                "csrf_token": "csrf-persisted",
                "confirmed": True,
            }))

            module.runtime_ls_registry = module.RuntimeLSRegistry()
            summary = module.build_ls_envelope_validation_summary(rpc_name="StartCascade")

            self.assertTrue(summary["metadataSessionIdPresent"])
            self.assertTrue(summary["csrfPresent"])
            self.assertTrue(summary["valid"])
        finally:
            module.runtime_ls_registry = original_registry
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

            if old_synthetic is None:
                os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SYNTHETIC_SESSION_ID"] = old_synthetic

            if old_csrf is None:
                os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            else:
                os.environ["WINDSURF_CSRF_TOKEN"] = old_csrf

            if old_state_path is None:
                os.environ.pop("WINDSURF_RUNTIME_LS_BINDING_PATH", None)
            else:
                os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = old_state_path

            if "binding_path" in locals():
                pathlib.Path(binding_path).unlink(missing_ok=True)

    def test_run_ls_emulator_cycle_does_not_start_cascade_when_persisted_binding_is_unreachable(self):
        old_chat_text = os.environ.get("WINDSURF_CHAT_TEXT")
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_synthetic = os.environ.get("WINDSURF_SYNTHETIC_SESSION_ID")
        old_csrf = os.environ.get("WINDSURF_CSRF_TOKEN")
        old_state_path = os.environ.get("WINDSURF_RUNTIME_LS_BINDING_PATH")
        old_start_cascade = module.start_cascade
        old_discover = module.discover_runtime_ls_registry_state
        original_registry = module.runtime_ls_registry
        try:
            module.runtime_ls_registry = module.RuntimeLSRegistry()
            os.environ.pop("WINDSURF_SESSION_ID", None)
            os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                binding_path = tmp.name
            os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = binding_path

            module.build_ls_event_payload(json.dumps({
                "event": "LanguageServerStarted",
                "session_id": "stale-runtime-session",
                "window_id": "window-stale",
                "host": "127.0.0.1",
                "port": 5055,
                "lifecycle_nonce": "nonce-stale",
                "timestamp": 1714560010.0,
                "csrf_token": "csrf-stale",
                "confirmed": True,
            }))

            module.runtime_ls_registry = module.RuntimeLSRegistry()
            module.discover_runtime_ls_registry_state = lambda: {
                "status": "BOOTING",
                "primary_ls_port": None,
                "active_ports": [],
            }

            start_cascade_called = False

            def fake_start_cascade(_token, base_url=None):
                nonlocal start_cascade_called
                start_cascade_called = True
                raise AssertionError("start_cascade should not run while persisted binding is unreachable")

            module.start_cascade = fake_start_cascade

            exit_code, payload = module.run_ls_emulator_cycle(
                "devin-session-token$abc",
                prompt_text="hello_probe_001",
                run_id="STALE-001",
            )

            self.assertFalse(start_cascade_called)
            self.assertEqual(exit_code, 0)
            self.assertEqual(payload["runObservation"]["cascadeAllowed"], False)
            self.assertEqual(payload["runObservation"]["waitingForCascadePreconditions"], True)
            self.assertIn("runtime binding unreachable", payload["runObservation"]["preconditionErrors"])
            self.assertEqual(payload["runObservation"]["runtimeState"], "RESET_CANDIDATE")
            self.assertEqual(payload["runObservation"]["bindingSource"], "PERSISTED")
            self.assertEqual(payload["runObservation"]["bindingValidated"], False)
            self.assertIsInstance(payload["runObservation"]["candidateBindings"], list)
            self.assertIsNone(payload["startCascade"])
        finally:
            module.runtime_ls_registry = original_registry
            module.start_cascade = old_start_cascade
            module.discover_runtime_ls_registry_state = old_discover
            if old_chat_text is None:
                os.environ.pop("WINDSURF_CHAT_TEXT", None)
            else:
                os.environ["WINDSURF_CHAT_TEXT"] = old_chat_text
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session
            if old_synthetic is None:
                os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SYNTHETIC_SESSION_ID"] = old_synthetic
            if old_csrf is None:
                os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            else:
                os.environ["WINDSURF_CSRF_TOKEN"] = old_csrf
            if old_state_path is None:
                os.environ.pop("WINDSURF_RUNTIME_LS_BINDING_PATH", None)
            else:
                os.environ["WINDSURF_RUNTIME_LS_BINDING_PATH"] = old_state_path
            if "binding_path" in locals():
                pathlib.Path(binding_path).unlink(missing_ok=True)

    def test_run_ls_emulator_cycle_polls_live_trajectory_before_assign_model(self):
        old_chat_text = os.environ.get("WINDSURF_CHAT_TEXT")
        old_csrf = os.environ.get("WINDSURF_CSRF_TOKEN")
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_assignment_router_uid = os.environ.get("WINDSURF_ASSIGNMENT_MODEL_ROUTER_UID")
        old_start_cascade = module.start_cascade
        old_send_user_cascade_message = module.send_user_cascade_message
        old_run_local_cascade_flow = module.run_local_cascade_flow
        old_assign_model_probe = module.assign_model_probe
        old_build_run_observation = module.build_run_observation
        old_is_runtime_ls_binding_reachable = module.is_runtime_ls_binding_reachable
        try:
            os.environ["WINDSURF_CSRF_TOKEN"] = "csrf-live"
            os.environ["WINDSURF_SESSION_ID"] = "observed-session-abc"
            os.environ.pop("WINDSURF_ASSIGNMENT_MODEL_ROUTER_UID", None)

            assign_model_called = False
            trajectory_polled = False

            def fake_start_cascade(_token, base_url=None):
                return 0, None, {"metadata": {"sessionIdProvenance": "observed"}}, {"cascadeId": "cascade-123"}

            def fake_send_user_cascade_message(_token, cascade_id):
                return 0, None, {"cascadeId": cascade_id}, {"status": 200}

            def fake_run_local_cascade_flow(_token, _live_language_server_url):
                nonlocal trajectory_polled
                trajectory_polled = True
                return 0, {"requestType": "get-cascade-trajectory", "cascadeId": "cascade-123"}, {
                    "decodedUnaryProto": {
                        "trajectory": {
                            "modelAssignmentInfo": {
                                "assignmentJwt": "jwt-123",
                                "assignedModelUid": "kimi-k2-6",
                                "harnessUid": "harness-1",
                                "modelRouterUid": "adaptive",
                            }
                        }
                    }
                }

            def fake_assign_model_probe(_token):
                nonlocal assign_model_called
                assign_model_called = True
                self.assertEqual(os.environ.get("WINDSURF_ASSIGNMENT_MODEL_ROUTER_UID"), "adaptive")
                return 0, None, {"modelRouterUid": "adaptive"}, {"status": 200}

            def fake_build_run_observation(*, run_id, prompt_text, cascade_id, metadata, assignment):
                return {
                    "run": run_id,
                    "prompt": prompt_text,
                    "cascadeId": cascade_id,
                    "sessionProvenance": metadata.get("sessionIdProvenance") if isinstance(metadata, dict) else None,
                    "modelRouterUid": assignment.get("modelRouterUid") if isinstance(assignment, dict) else None,
                }

            module.start_cascade = fake_start_cascade
            module.send_user_cascade_message = fake_send_user_cascade_message
            module.run_local_cascade_flow = fake_run_local_cascade_flow
            module.assign_model_probe = fake_assign_model_probe
            module.build_run_observation = fake_build_run_observation
            module.is_runtime_ls_binding_reachable = lambda timeout=0.2: True

            exit_code, payload = module.run_ls_emulator_cycle(
                "devin-session-token$abc",
                prompt_text="hello_probe_002",
                run_id="ROUTER-001",
            )

            self.assertTrue(trajectory_polled)
            self.assertTrue(assign_model_called)
            self.assertEqual(exit_code, 0)
            self.assertEqual(payload["runObservation"]["modelRouterUid"], "adaptive")
            self.assertEqual(payload["runObservation"]["preconditionErrors"], [])
            self.assertIsNotNone(payload["assignModel"])
            self.assertEqual(payload["assignModel"]["requestPreview"]["modelRouterUid"], "adaptive")
        finally:
            module.start_cascade = old_start_cascade
            module.send_user_cascade_message = old_send_user_cascade_message
            module.run_local_cascade_flow = old_run_local_cascade_flow
            module.assign_model_probe = old_assign_model_probe
            module.build_run_observation = old_build_run_observation
            module.is_runtime_ls_binding_reachable = old_is_runtime_ls_binding_reachable

            if old_chat_text is None:
                os.environ.pop("WINDSURF_CHAT_TEXT", None)
            else:
                os.environ["WINDSURF_CHAT_TEXT"] = old_chat_text

            if old_csrf is None:
                os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            else:
                os.environ["WINDSURF_CSRF_TOKEN"] = old_csrf

            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

            if old_assignment_router_uid is None:
                os.environ.pop("WINDSURF_ASSIGNMENT_MODEL_ROUTER_UID", None)
            else:
                os.environ["WINDSURF_ASSIGNMENT_MODEL_ROUTER_UID"] = old_assignment_router_uid
                pathlib.Path(binding_path).unlink(missing_ok=True)

    def test_start_cascade_preview_session_id_matches_runtime_ls_binding(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_synthetic = os.environ.get("WINDSURF_SYNTHETIC_SESSION_ID")
        old_csrf = os.environ.get("WINDSURF_CSRF_TOKEN")
        original_registry = module.runtime_ls_registry
        try:
            module.runtime_ls_registry = module.RuntimeLSRegistry()
            os.environ.pop("WINDSURF_SESSION_ID", None)
            os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            module.on_language_server_started(
                session_id="runtime-session-1",
                window_id="window-1",
                host="127.0.0.1",
                port=5050,
                lifecycle_nonce="nonce-1",
                timestamp=1714560000.0,
                csrf_token="csrf-runtime-1",
                confirmed=True,
            )

            _request, preview = module.build_start_cascade_probe_request("devin-session-token-123")

            self.assertEqual(preview["metadata"]["sessionId"], "runtime-session-1")
        finally:
            module.runtime_ls_registry = original_registry
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session
            if old_synthetic is None:
                os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SYNTHETIC_SESSION_ID"] = old_synthetic
            if old_csrf is None:
                os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            else:
                os.environ["WINDSURF_CSRF_TOKEN"] = old_csrf

    def test_send_user_cascade_message_preview_session_id_matches_start_cascade(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_synthetic = os.environ.get("WINDSURF_SYNTHETIC_SESSION_ID")
        old_csrf = os.environ.get("WINDSURF_CSRF_TOKEN")
        original_registry = module.runtime_ls_registry
        try:
            module.runtime_ls_registry = module.RuntimeLSRegistry()
            os.environ.pop("WINDSURF_SESSION_ID", None)
            os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            module.on_language_server_started(
                session_id="runtime-session-2",
                window_id="window-2",
                host="127.0.0.1",
                port=5051,
                lifecycle_nonce="nonce-2",
                timestamp=1714560001.0,
                csrf_token="csrf-runtime-2",
                confirmed=True,
            )

            _start_request, start_preview = module.build_start_cascade_probe_request("devin-session-token-123")
            _send_request, send_preview = module.build_send_user_cascade_message_probe_request(
                "devin-session-token-123",
                "cascade-123",
            )

            self.assertEqual(send_preview["metadata"]["sessionId"], start_preview["metadata"]["sessionId"])
            self.assertEqual(send_preview["metadata"]["sessionId"], "runtime-session-2")
        finally:
            module.runtime_ls_registry = original_registry
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session
            if old_synthetic is None:
                os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SYNTHETIC_SESSION_ID"] = old_synthetic
            if old_csrf is None:
                os.environ.pop("WINDSURF_CSRF_TOKEN", None)
            else:
                os.environ["WINDSURF_CSRF_TOKEN"] = old_csrf

    def test_assign_model_preview_session_id_matches_start_cascade(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        old_synthetic = os.environ.get("WINDSURF_SYNTHETIC_SESSION_ID")
        original_registry = module.runtime_ls_registry
        try:
            module.runtime_ls_registry = module.RuntimeLSRegistry()
            os.environ.pop("WINDSURF_SESSION_ID", None)
            os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            module.on_language_server_started(
                session_id="runtime-session-3",
                window_id="window-3",
                host="127.0.0.1",
                port=5052,
                lifecycle_nonce="nonce-3",
                timestamp=1714560002.0,
                csrf_token="csrf-runtime-3",
                confirmed=True,
            )

            _start_request, start_preview = module.build_start_cascade_probe_request("test-token")
            _assign_request, assign_preview = module.build_assign_model_probe_request("test-token")

            self.assertEqual(assign_preview["metadata"]["sessionId"], start_preview["metadata"]["sessionId"])
            self.assertEqual(assign_preview["metadata"]["sessionId"], "runtime-session-3")
        finally:
            module.runtime_ls_registry = original_registry
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session
            if old_synthetic is None:
                os.environ.pop("WINDSURF_SYNTHETIC_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SYNTHETIC_SESSION_ID"] = old_synthetic

    def test_replay_from_capture_does_not_claim_native_execution_plan(self):
        lines = [
            json.dumps(
                {
                    "classification": "cascade_initialization",
                    "request": {"url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/StartCascade"},
                    "response": {"protobufSummary": {"fieldNumbers": [1]}},
                }
            )
        ]

        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w", encoding="utf-8") as handle:
            capture_path = handle.name
            handle.write("\n".join(lines))

        try:
            replay = module.replay_from_capture(capture_path)

            self.assertNotIn("executionPlan", replay)
        finally:
            pathlib.Path(capture_path).unlink(missing_ok=True)

    def test_field_origin_summary_separates_native_from_instrumentation(self):
        payload = {
            "mode": "ls_emulator",
            "instrumentation": {"observationLayer": "ls_emulator"},
            "status": 200,
            "assignedModelUid": "model-1",
            "requestPreview": {"foo": "bar"},
        }

        summary = module.build_field_origin_summary(payload)

        self.assertEqual(summary["system_native"], ["assignedModelUid", "status"])
        self.assertIn("instrumentation", summary["instrumentation_added"])
        self.assertIn("mode", summary["instrumentation_added"])
        self.assertIn("requestPreview", summary["instrumentation_added"])

    def test_instrumentation_neutrality_report_detects_invariant_outputs(self):
        a = {"assignedModelUid": "m1", "harnessUid": "h1", "modelRouterUid": "r1"}
        b = {"assignedModelUid": "m1", "harnessUid": "h1", "modelRouterUid": "r1"}
        c = {"assignedModelUid": "m1", "harnessUid": "h1", "modelRouterUid": "r1"}

        report = module.build_instrumentation_neutrality_report(a, b, c)

        self.assertTrue(report["invariant"])

    def test_instrumentation_neutrality_report_detects_routing_drift(self):
        a = {"assignedModelUid": "m1", "harnessUid": "h1", "modelRouterUid": "r1"}
        b = {"assignedModelUid": "m2", "harnessUid": "h1", "modelRouterUid": "r1"}
        c = {"assignedModelUid": "m1", "harnessUid": "h1", "modelRouterUid": "r1"}

        report = module.build_instrumentation_neutrality_report(a, b, c)

        self.assertFalse(report["invariant"])

    def test_finalize_probe_payload_adds_field_origins(self):
        payload = module.finalize_probe_payload(
            {
                "mode": "chat",
                "instrumentation": {"observationLayer": "direct_probe"},
                "status": 200,
            }
        )

        self.assertIn("fieldOrigins", payload)
        self.assertEqual(payload["fieldOrigins"]["system_native"], ["status"])

    def test_build_run_observation_uses_minimal_doe_schema(self):
        observation = module.build_run_observation(
            run_id="P1-C2-Sobs-T0",
            prompt_text="hello isolate baseline",
            cascade_id="cascade-123",
            metadata={
                "sessionId": "observed-session-abc",
                "sessionIdProvenance": "observed",
                "teamId": "team-1",
                "userId": "user-1",
            },
            assignment={
                "assignmentJwt": "jwt-token",
                "assignedModelUid": "model-1",
                "harnessUid": "harness-1",
            },
        )

        self.assertEqual(observation["run"], "P1-C2-Sobs-T0")
        self.assertEqual(observation["cascadeId"], "cascade-123")
        self.assertEqual(observation["sessionProvenance"], "observed")
        self.assertEqual(observation["assignedModelUid"], "model-1")
        self.assertEqual(observation["harnessUid"], "harness-1")
        self.assertEqual(observation["jwtHash16"], module.sha256_16("jwt-token"))

    def test_run_abc_experiment_can_be_exposed_via_cli_payload(self):
        original_runner = module.run_instrumentation_abc_experiment
        try:
            module.run_instrumentation_abc_experiment = lambda: {"ok": True}

            payload = module.build_capture_cli_payload(["--run-abc-experiment"])

            self.assertEqual(payload, {"ok": True})
        finally:
            module.run_instrumentation_abc_experiment = original_runner

    def test_start_cascade_probe_prefers_explicit_language_server_url(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        try:
            os.environ["WINDSURF_SESSION_ID"] = "observed-session-1"
            module.on_language_server_started(
                session_id="session-1",
                window_id="window-1",
                host="127.0.0.1",
                port=57330,
                lifecycle_nonce="nonce-1",
                timestamp=1714560000.0,
                csrf_token="csrf-57330",
                confirmed=True,
            )

            request, preview = module.build_start_cascade_probe_request("test-token")

            self.assertEqual(
                request.full_url,
                "http://127.0.0.1:57330/exa.language_server_pb.LanguageServerService/StartCascade",
            )
            self.assertEqual(preview["url"], request.full_url)
            self.assertEqual(preview["requestType"], "start-cascade")
        finally:
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

    def test_assign_model_request_contains_expected_default_fields(self):
        old_base = os.environ.get("WINDSURF_CHAT_BASE_URL")
        old_variant = os.environ.get("WINDSURF_ASSIGN_MODEL_VARIANT")
        old_router_uid = os.environ.get("WINDSURF_ASSIGN_MODEL_ROUTER_UID")
        old_cascade_id = os.environ.get("WINDSURF_ASSIGN_MODEL_CASCADE_ID")
        old_text = os.environ.get("WINDSURF_ASSIGN_MODEL_PROMPT_TEXT")
        try:
            os.environ["WINDSURF_CHAT_BASE_URL"] = "https://server.codeium.com"
            os.environ["WINDSURF_ASSIGN_MODEL_VARIANT"] = "router-cascade-prompt"
            os.environ["WINDSURF_ASSIGN_MODEL_ROUTER_UID"] = "router-1"
            os.environ["WINDSURF_ASSIGN_MODEL_CASCADE_ID"] = "cascade-1"
            os.environ["WINDSURF_ASSIGN_MODEL_PROMPT_TEXT"] = "hello"

            body, preview = module.build_assign_model_request("test-token")
            payload = body
            field_numbers = [field[0] for field in _parse_message_fields(payload)]

            self.assertEqual(preview["assignModelVariant"], "router-cascade-prompt")
            self.assertEqual(preview["modelRouterUid"], "router-1")
            self.assertEqual(preview["cascadeId"], "cascade-1")
            self.assertEqual(preview["httpBodyBytes"], len(payload))
            self.assertEqual(field_numbers, [1, 2, 3, 4])
        finally:
            if old_base is None:
                os.environ.pop("WINDSURF_CHAT_BASE_URL", None)
            else:
                os.environ["WINDSURF_CHAT_BASE_URL"] = old_base

            if old_variant is None:
                os.environ.pop("WINDSURF_ASSIGN_MODEL_VARIANT", None)
            else:
                os.environ["WINDSURF_ASSIGN_MODEL_VARIANT"] = old_variant

            if old_router_uid is None:
                os.environ.pop("WINDSURF_ASSIGN_MODEL_ROUTER_UID", None)
            else:
                os.environ["WINDSURF_ASSIGN_MODEL_ROUTER_UID"] = old_router_uid

            if old_cascade_id is None:
                os.environ.pop("WINDSURF_ASSIGN_MODEL_CASCADE_ID", None)
            else:
                os.environ["WINDSURF_ASSIGN_MODEL_CASCADE_ID"] = old_cascade_id

            if old_text is None:
                os.environ.pop("WINDSURF_ASSIGN_MODEL_PROMPT_TEXT", None)
            else:
                os.environ["WINDSURF_ASSIGN_MODEL_PROMPT_TEXT"] = old_text

    def test_assign_model_request_can_fallback_to_assignment_model_router_uid(self):
        old_variant = os.environ.get("WINDSURF_ASSIGN_MODEL_VARIANT")
        old_router_uid = os.environ.get("WINDSURF_ASSIGN_MODEL_ROUTER_UID")
        old_assignment_router_uid = os.environ.get("WINDSURF_ASSIGNMENT_MODEL_ROUTER_UID")
        old_cascade_id = os.environ.get("WINDSURF_ASSIGN_MODEL_CASCADE_ID")
        try:
            os.environ["WINDSURF_ASSIGN_MODEL_VARIANT"] = "router-cascade-prompt"
            os.environ.pop("WINDSURF_ASSIGN_MODEL_ROUTER_UID", None)
            os.environ["WINDSURF_ASSIGNMENT_MODEL_ROUTER_UID"] = "adaptive"
            os.environ["WINDSURF_ASSIGN_MODEL_CASCADE_ID"] = "cascade-1"

            body, preview = module.build_assign_model_request("test-token")
            payload = body
            field_numbers = [field[0] for field in _parse_message_fields(payload)]

            self.assertEqual(preview["modelRouterUid"], "adaptive")
            self.assertEqual(field_numbers, [1, 2, 3, 4])
        finally:
            if old_variant is None:
                os.environ.pop("WINDSURF_ASSIGN_MODEL_VARIANT", None)
            else:
                os.environ["WINDSURF_ASSIGN_MODEL_VARIANT"] = old_variant

            if old_router_uid is None:
                os.environ.pop("WINDSURF_ASSIGN_MODEL_ROUTER_UID", None)
            else:
                os.environ["WINDSURF_ASSIGN_MODEL_ROUTER_UID"] = old_router_uid

            if old_assignment_router_uid is None:
                os.environ.pop("WINDSURF_ASSIGNMENT_MODEL_ROUTER_UID", None)
            else:
                os.environ["WINDSURF_ASSIGNMENT_MODEL_ROUTER_UID"] = old_assignment_router_uid

            if old_cascade_id is None:
                os.environ.pop("WINDSURF_ASSIGN_MODEL_CASCADE_ID", None)
            else:
                os.environ["WINDSURF_ASSIGN_MODEL_CASCADE_ID"] = old_cascade_id

    def test_assign_model_request_can_switch_to_metadata_only_variant(self):
        old_variant = os.environ.get("WINDSURF_ASSIGN_MODEL_VARIANT")
        try:
            os.environ["WINDSURF_ASSIGN_MODEL_VARIANT"] = "metadata-only"

            body, preview = module.build_assign_model_request("test-token")
            payload = body
            field_numbers = [field[0] for field in _parse_message_fields(payload)]

            self.assertEqual(preview["assignModelVariant"], "metadata-only")
            self.assertEqual(preview["chatMessagePromptBytes"], 0)
            self.assertEqual(field_numbers, [1])
        finally:
            if old_variant is None:
                os.environ.pop("WINDSURF_ASSIGN_MODEL_VARIANT", None)
            else:
                os.environ["WINDSURF_ASSIGN_MODEL_VARIANT"] = old_variant

    def test_decode_assign_model_response_extracts_assignment_fields(self):
        assignment = bytearray()
        assignment.extend(module.encode_string(1, "jwt-token"))
        assignment.extend(module.encode_string(2, "kimi-k2-5"))
        assignment.extend(module.encode_string(3, "strawberry-pancake"))
        assignment.extend(module.encode_string(4, "adaptive"))
        response = module.encode_message(1, bytes(assignment))

        decoded = module.decode_assign_model_response(response)

        self.assertEqual(decoded["fieldNumbers"], [1])
        self.assertEqual(decoded["assignment"]["assignmentJwt"], "jwt-token")
        self.assertEqual(decoded["assignment"]["assignedModelUid"], "kimi-k2-5")
        self.assertEqual(decoded["assignment"]["harnessUid"], "strawberry-pancake")
        self.assertEqual(decoded["assignment"]["modelRouterUid"], "adaptive")

    def test_decode_start_cascade_response_extracts_cascade_id(self):
        response = module.encode_string(1, "cascade-123")

        decoded = module.decode_start_cascade_response(response)

        self.assertEqual(decoded["fieldNumbers"], [1])
        self.assertEqual(decoded["cascadeId"], "cascade-123")

    def test_decode_start_cascade_response_extracts_live_uuid_shape(self):
        response = b"\x0a\x24" + b"76d8c2c2-ecfb-40f8-a0fc-c08f761f95f2"

        decoded = module.decode_start_cascade_response(response)

        self.assertEqual(decoded["fieldNumbers"], [1])
        self.assertEqual(decoded["cascadeId"], "76d8c2c2-ecfb-40f8-a0fc-c08f761f95f2")

    def test_decode_send_user_cascade_message_response_collects_string_fields(self):
        response = module.encode_string(1, "message-1") + module.encode_string(2, "ok")

        decoded = module.decode_send_user_cascade_message_response(response)

        self.assertEqual(decoded["fieldNumbers"], [1, 2])
        self.assertEqual(decoded["stringFields"][0]["utf8"], "message-1")
        self.assertEqual(decoded["stringFields"][1]["utf8"], "ok")

    def test_followup_variants_include_metadata_and_wrapper_locations(self):
        variants = module.run_assignment_followup_variants(
            "test-token",
            {
                "assignmentJwt": "jwt-token",
                "assignedModelUid": "kimi-k2-5",
                "harnessUid": "strawberry-pancake",
                "modelRouterUid": "adaptive",
            },
        )

        names = [variant["variant"] for variant in variants]
        self.assertIn("metadata.userJwt", names)
        self.assertIn("top-level-wrapper", names)

    def test_requested_model_uid_prefers_last_selected_cascade_model_over_router_fallback(self):
        old_explicit = os.environ.get("WINDSURF_CASCADE_REQUESTED_MODEL_UID")
        old_assign = os.environ.get("WINDSURF_ASSIGN_MODEL_ROUTER_UID")
        old_chat = os.environ.get("WINDSURF_CHAT_MODEL_NAME")
        original_get_last_selected = module.get_last_selected_cascade_model_uids
        try:
            os.environ.pop("WINDSURF_CASCADE_REQUESTED_MODEL_UID", None)
            os.environ.pop("WINDSURF_ASSIGN_MODEL_ROUTER_UID", None)
            os.environ.pop("WINDSURF_CHAT_MODEL_NAME", None)
            module.get_last_selected_cascade_model_uids = lambda: ["kimi-k2-6", "glm-5-1"]

            requested_model_uid = module.get_requested_model_uid()

            self.assertEqual(requested_model_uid, "kimi-k2-6")
        finally:
            module.get_last_selected_cascade_model_uids = original_get_last_selected

            if old_explicit is None:
                os.environ.pop("WINDSURF_CASCADE_REQUESTED_MODEL_UID", None)
            else:
                os.environ["WINDSURF_CASCADE_REQUESTED_MODEL_UID"] = old_explicit

            if old_assign is None:
                os.environ.pop("WINDSURF_ASSIGN_MODEL_ROUTER_UID", None)
            else:
                os.environ["WINDSURF_ASSIGN_MODEL_ROUTER_UID"] = old_assign

            if old_chat is None:
                os.environ.pop("WINDSURF_CHAT_MODEL_NAME", None)
            else:
                os.environ["WINDSURF_CHAT_MODEL_NAME"] = old_chat

    def test_requested_model_uid_uses_real_runtime_fallback_when_no_inputs_exist(self):
        old_explicit = os.environ.get("WINDSURF_CASCADE_REQUESTED_MODEL_UID")
        old_assign = os.environ.get("WINDSURF_ASSIGN_MODEL_ROUTER_UID")
        old_chat = os.environ.get("WINDSURF_CHAT_MODEL_NAME")
        original_get_last_selected = module.get_last_selected_cascade_model_uids
        try:
            os.environ.pop("WINDSURF_CASCADE_REQUESTED_MODEL_UID", None)
            os.environ.pop("WINDSURF_ASSIGN_MODEL_ROUTER_UID", None)
            os.environ.pop("WINDSURF_CHAT_MODEL_NAME", None)
            module.get_last_selected_cascade_model_uids = lambda: []

            requested_model_uid = module.get_requested_model_uid()

            self.assertEqual(requested_model_uid, "kimi-k2-6")
        finally:
            module.get_last_selected_cascade_model_uids = original_get_last_selected

            if old_explicit is None:
                os.environ.pop("WINDSURF_CASCADE_REQUESTED_MODEL_UID", None)
            else:
                os.environ["WINDSURF_CASCADE_REQUESTED_MODEL_UID"] = old_explicit

            if old_assign is None:
                os.environ.pop("WINDSURF_ASSIGN_MODEL_ROUTER_UID", None)
            else:
                os.environ["WINDSURF_ASSIGN_MODEL_ROUTER_UID"] = old_assign

            if old_chat is None:
                os.environ.pop("WINDSURF_CHAT_MODEL_NAME", None)
            else:
                os.environ["WINDSURF_CHAT_MODEL_NAME"] = old_chat

    def test_api_wrapper_request_contains_top_level_request_field(self):
        body, preview = module.build_api_wrapper_request("test-token")

        payload = body[5:]

        self.assertEqual(body[0], 0)
        self.assertEqual(int.from_bytes(body[1:5], "big"), len(payload))
        self.assertEqual(preview["requestType"], "api-wrapper")
        self.assertIn(bytes([0x0A]), payload)

    def test_raw_chat_request_uses_runtime_chat_base_url(self):
        old_base = os.environ.get("WINDSURF_CHAT_BASE_URL")
        old_text = os.environ.get("WINDSURF_CHAT_TEXT")
        old_model = os.environ.get("WINDSURF_CHAT_MODEL_NAME")
        old_service = os.environ.get("WINDSURF_CHAT_SERVICE")
        old_method = os.environ.get("WINDSURF_CHAT_METHOD_NAME")
        try:
            os.environ["WINDSURF_CHAT_BASE_URL"] = "https://eu.windsurf.com/_route/api_server"
            os.environ["WINDSURF_CHAT_TEXT"] = "hello"
            os.environ["WINDSURF_CHAT_MODEL_NAME"] = "kimi-k2-6"
            os.environ["WINDSURF_CHAT_SERVICE"] = "language-server"
            os.environ["WINDSURF_CHAT_METHOD_NAME"] = "RawGetChatMessage"

            request, preview = module.build_raw_chat_probe_request("test-token")

            self.assertEqual(
                request.full_url,
                "https://eu.windsurf.com/_route/api_server/"
                "exa.language_server_pb.LanguageServerService/RawGetChatMessage",
            )
            self.assertEqual(preview["url"], request.full_url)
        finally:
            if old_base is None:
                os.environ.pop("WINDSURF_CHAT_BASE_URL", None)
            else:
                os.environ["WINDSURF_CHAT_BASE_URL"] = old_base

            if old_text is None:
                os.environ.pop("WINDSURF_CHAT_TEXT", None)
            else:
                os.environ["WINDSURF_CHAT_TEXT"] = old_text

            if old_model is None:
                os.environ.pop("WINDSURF_CHAT_MODEL_NAME", None)
            else:
                os.environ["WINDSURF_CHAT_MODEL_NAME"] = old_model

            if old_service is None:
                os.environ.pop("WINDSURF_CHAT_SERVICE", None)
            else:
                os.environ["WINDSURF_CHAT_SERVICE"] = old_service

            if old_method is None:
                os.environ.pop("WINDSURF_CHAT_METHOD_NAME", None)
            else:
                os.environ["WINDSURF_CHAT_METHOD_NAME"] = old_method

    def test_get_token_falls_back_to_windsurf_sqlite_state(self):
        old_token = os.environ.get("WINDSURF_DIRECT_KEY")
        old_db_path = os.environ.get("WINDSURF_STATE_DB_PATH")
        try:
            os.environ.pop("WINDSURF_DIRECT_KEY", None)
            with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp:
                db_path = tmp.name

            con = sqlite3.connect(db_path)
            cur = con.cursor()
            cur.execute("create table ItemTable (key text, value text)")
            cur.execute(
                "insert into ItemTable (key, value) values (?, ?)",
                (
                    "windsurfAuthStatus",
                    json.dumps({"apiKey": "sqlite-token"}),
                ),
            )
            con.commit()
            con.close()

            os.environ["WINDSURF_STATE_DB_PATH"] = db_path

            self.assertEqual(module.get_token(), "sqlite-token")
        finally:
            if old_token is None:
                os.environ.pop("WINDSURF_DIRECT_KEY", None)
            else:
                os.environ["WINDSURF_DIRECT_KEY"] = old_token

            if old_db_path is None:
                os.environ.pop("WINDSURF_STATE_DB_PATH", None)
            else:
                os.environ["WINDSURF_STATE_DB_PATH"] = old_db_path

            if "db_path" in locals():
                pathlib.Path(db_path).unlink(missing_ok=True)

    def test_get_token_from_windsurf_state_preserves_devin_session_token(self):
        old_token = os.environ.get("WINDSURF_DIRECT_KEY")
        old_db_path = os.environ.get("WINDSURF_STATE_DB_PATH")
        try:
            os.environ.pop("WINDSURF_DIRECT_KEY", None)
            with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp:
                db_path = tmp.name

            con = sqlite3.connect(db_path)
            cur = con.cursor()
            cur.execute("create table ItemTable (key text, value text)")
            cur.execute(
                "insert into ItemTable (key, value) values (?, ?)",
                (
                    "windsurfAuthStatus",
                    json.dumps({"apiKey": "devin-session-token-123"}),
                ),
            )
            con.commit()
            con.close()

            os.environ["WINDSURF_STATE_DB_PATH"] = db_path

            self.assertEqual(module.get_token_from_windsurf_state(), "devin-session-token-123")
        finally:
            if old_token is None:
                os.environ.pop("WINDSURF_DIRECT_KEY", None)
            else:
                os.environ["WINDSURF_DIRECT_KEY"] = old_token

            if old_db_path is None:
                os.environ.pop("WINDSURF_STATE_DB_PATH", None)
            else:
                os.environ["WINDSURF_STATE_DB_PATH"] = old_db_path

            if "db_path" in locals():
                pathlib.Path(db_path).unlink(missing_ok=True)

    def test_main_explains_when_sqlite_only_contains_devin_session_token(self):
        old_token = os.environ.get("WINDSURF_DIRECT_KEY")
        old_db_path = os.environ.get("WINDSURF_STATE_DB_PATH")
        old_mode = os.environ.get("WINDSURF_PROBE_MODE")
        original_emit_output = module.emit_output

        emitted = {}

        def fake_emit_output(payload):
            emitted.clear()
            emitted.update(payload)

        try:
            os.environ.pop("WINDSURF_DIRECT_KEY", None)
            with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp:
                db_path = tmp.name

            con = sqlite3.connect(db_path)
            cur = con.cursor()
            cur.execute("create table ItemTable (key text, value text)")
            cur.execute(
                "insert into ItemTable (key, value) values (?, ?)",
                (
                    "windsurfAuthStatus",
                    json.dumps({"apiKey": "devin-session-token$abc"}),
                ),
            )
            con.commit()
            con.close()

            os.environ["WINDSURF_STATE_DB_PATH"] = db_path
            os.environ["WINDSURF_PROBE_MODE"] = "validate"
            module.emit_output = fake_emit_output

            exit_code = module.main()

            self.assertEqual(exit_code, 1)
            self.assertEqual(emitted["mode"], "validate")
            self.assertEqual(emitted["authType"], "direct")
            self.assertIn("direct cloud API key", emitted["hint"])
        finally:
            module.emit_output = original_emit_output

            if old_token is None:
                os.environ.pop("WINDSURF_DIRECT_KEY", None)
            else:
                os.environ["WINDSURF_DIRECT_KEY"] = old_token

            if old_db_path is None:
                os.environ.pop("WINDSURF_STATE_DB_PATH", None)
            else:
                os.environ["WINDSURF_STATE_DB_PATH"] = old_db_path

            if old_mode is None:
                os.environ.pop("WINDSURF_PROBE_MODE", None)
            else:
                os.environ["WINDSURF_PROBE_MODE"] = old_mode

            if "db_path" in locals():
                pathlib.Path(db_path).unlink(missing_ok=True)

    def test_get_token_falls_back_to_decrypted_windsurf_secret_sessions(self):
        old_token = os.environ.get("WINDSURF_DIRECT_KEY")
        old_db_path = os.environ.get("WINDSURF_STATE_DB_PATH")
        old_secret_reader = module.read_windsurf_secret
        try:
            os.environ.pop("WINDSURF_DIRECT_KEY", None)
            with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp:
                db_path = tmp.name

            con = sqlite3.connect(db_path)
            cur = con.cursor()
            cur.execute("create table ItemTable (key text, value text)")
            cur.execute(
                "insert into ItemTable (key, value) values (?, ?)",
                (
                    "windsurfAuthStatus",
                    json.dumps({"apiKey": "devin-session-token-123"}),
                ),
            )
            con.commit()
            con.close()

            def fake_read_windsurf_secret(secret_key: str) -> str:
                if secret_key != "windsurf_auth.sessions":
                    return ""
                return json.dumps([
                    {
                        "accessToken": "secret-store-token",
                    }
                ])

            module.read_windsurf_secret = fake_read_windsurf_secret
            os.environ["WINDSURF_STATE_DB_PATH"] = db_path

            self.assertEqual(module.get_token(), "secret-store-token")
        finally:
            module.read_windsurf_secret = old_secret_reader

            if old_token is None:
                os.environ.pop("WINDSURF_DIRECT_KEY", None)
            else:
                os.environ["WINDSURF_DIRECT_KEY"] = old_token

            if old_db_path is None:
                os.environ.pop("WINDSURF_STATE_DB_PATH", None)
            else:
                os.environ["WINDSURF_STATE_DB_PATH"] = old_db_path

            if "db_path" in locals():
                pathlib.Path(db_path).unlink(missing_ok=True)

    def test_resolve_auth_context_for_validate_requires_direct_key(self):
        old_token = os.environ.get("WINDSURF_DIRECT_KEY")
        old_db_path = os.environ.get("WINDSURF_STATE_DB_PATH")
        try:
            os.environ.pop("WINDSURF_DIRECT_KEY", None)
            with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp:
                db_path = tmp.name

            con = sqlite3.connect(db_path)
            cur = con.cursor()
            cur.execute("create table ItemTable (key text, value text)")
            cur.execute(
                "insert into ItemTable (key, value) values (?, ?)",
                (
                    "windsurfAuthStatus",
                    json.dumps({"apiKey": "devin-session-token-123"}),
                ),
            )
            con.commit()
            con.close()

            os.environ["WINDSURF_STATE_DB_PATH"] = db_path

            auth = module.resolve_auth_context_for_mode("validate")

            self.assertEqual(auth["token"], "")
            self.assertEqual(auth["authType"], "direct")
            self.assertIn("direct cloud API key", auth["hint"])
        finally:
            if old_token is None:
                os.environ.pop("WINDSURF_DIRECT_KEY", None)
            else:
                os.environ["WINDSURF_DIRECT_KEY"] = old_token

            if old_db_path is None:
                os.environ.pop("WINDSURF_STATE_DB_PATH", None)
            else:
                os.environ["WINDSURF_STATE_DB_PATH"] = old_db_path

            if "db_path" in locals():
                pathlib.Path(db_path).unlink(missing_ok=True)

    def test_resolve_auth_context_for_cascade_accepts_session_token_from_state(self):
        old_token = os.environ.get("WINDSURF_DIRECT_KEY")
        old_db_path = os.environ.get("WINDSURF_STATE_DB_PATH")
        try:
            os.environ.pop("WINDSURF_DIRECT_KEY", None)
            with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp:
                db_path = tmp.name

            con = sqlite3.connect(db_path)
            cur = con.cursor()
            cur.execute("create table ItemTable (key text, value text)")
            cur.execute(
                "insert into ItemTable (key, value) values (?, ?)",
                (
                    "windsurfAuthStatus",
                    json.dumps({"apiKey": "devin-session-token-123"}),
                ),
            )
            con.commit()
            con.close()

            os.environ["WINDSURF_STATE_DB_PATH"] = db_path

            auth = module.resolve_auth_context_for_mode("cascade")

            self.assertEqual(auth["token"], "devin-session-token-123")
            self.assertEqual(auth["authType"], "session")
            self.assertEqual(auth["hint"], "")
        finally:
            if old_token is None:
                os.environ.pop("WINDSURF_DIRECT_KEY", None)
            else:
                os.environ["WINDSURF_DIRECT_KEY"] = old_token

            if old_db_path is None:
                os.environ.pop("WINDSURF_STATE_DB_PATH", None)
            else:
                os.environ["WINDSURF_STATE_DB_PATH"] = old_db_path

            if "db_path" in locals():
                pathlib.Path(db_path).unlink(missing_ok=True)

    def test_decodes_end_stream_error_frame(self):
        end_stream_json = b'{"error":{"code":"unimplemented","message":"unsupported procedure"}}'
        payload = b"\x02" + len(end_stream_json).to_bytes(4, "big") + end_stream_json

        decoded = module.decode_connect_response(payload)

        self.assertEqual(decoded["frames"][0]["kind"], "end_stream")
        self.assertEqual(decoded["frames"][0]["error"]["code"], "unimplemented")
        self.assertEqual(
            decoded["frames"][0]["error"]["message"],
            "unsupported procedure",
        )

    def test_decodes_gzip_compressed_end_stream_error_frame(self):
        end_stream_json = b'{"error":{"code":"invalid_argument","message":"gzip metadata"}}'
        compressed_json = gzip.compress(end_stream_json)
        payload = b"\x03" + len(compressed_json).to_bytes(4, "big") + compressed_json

        decoded = module.decode_connect_response(payload)

        self.assertEqual(decoded["frames"][0]["kind"], "end_stream")
        self.assertEqual(decoded["frames"][0]["compressed"], True)
        self.assertEqual(decoded["frames"][0]["error"]["code"], "invalid_argument")
        self.assertEqual(decoded["frames"][0]["error"]["message"], "gzip metadata")

    def test_serialize_output_escapes_console_unsafe_characters(self):
        serialized = module.serialize_output({"body": "bad�char"})

        self.assertIn('\\ufffd', serialized)

    def test_extract_final_model_response_prefers_openai_style_message_content(self):
        result = {
            "body": {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "Hi from Windsurf",
                        }
                    }
                ]
            }
        }

        self.assertEqual(module.extract_final_model_response(result), "Hi from Windsurf")

    def test_extract_final_model_response_accepts_top_level_output_text(self):
        result = {
            "body": {
                "output_text": "Hi from Windsurf",
            }
        }

        self.assertEqual(module.extract_final_model_response(result), "Hi from Windsurf")

    def test_extract_final_model_response_can_decode_connect_json_from_body_hex(self):
        payload = b'{"output_text":"Hi from Windsurf"}'
        frame = b"\x02" + len(payload).to_bytes(4, "big") + payload
        result = {
            "contentType": "application/proto",
            "bodyHex": frame.hex(),
        }

        self.assertEqual(module.extract_final_model_response(result), "Hi from Windsurf")

    def test_main_can_emit_only_final_response_for_chat_mode(self):
        old_mode = os.environ.get("WINDSURF_PROBE_MODE")
        old_token = os.environ.get("WINDSURF_DIRECT_KEY")
        old_final_only = os.environ.get("WINDSURF_FINAL_RESPONSE_ONLY")
        old_request_timeout = os.environ.get("WINDSURF_REQUEST_TIMEOUT")
        original_run_request = module.run_request
        original_emit_output = module.emit_output

        emitted = {}

        def fake_emit_output(payload):
            emitted.clear()
            emitted.update(payload)

        def fake_run_request(_request, timeout=120):
            return 0, {
                "status": 200,
                "body": {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "Hi from Windsurf",
                            }
                        }
                    ]
                },
            }

        try:
            os.environ["WINDSURF_PROBE_MODE"] = "chat"
            os.environ["WINDSURF_DIRECT_KEY"] = "test-token"
            os.environ["WINDSURF_FINAL_RESPONSE_ONLY"] = "1"
            os.environ["WINDSURF_REQUEST_TIMEOUT"] = "120"
            module.run_request = fake_run_request
            module.emit_output = fake_emit_output

            exit_code = module.main()

            self.assertEqual(exit_code, 0)
            self.assertEqual(
                emitted,
                {
                    "mode": "chat",
                    "requestType": "cloud-chat",
                    "status": 200,
                    "finalResponse": "Hi from Windsurf",
                },
            )
        finally:
            module.run_request = original_run_request
            module.emit_output = original_emit_output

            if old_mode is None:
                os.environ.pop("WINDSURF_PROBE_MODE", None)
            else:
                os.environ["WINDSURF_PROBE_MODE"] = old_mode

            if old_token is None:
                os.environ.pop("WINDSURF_DIRECT_KEY", None)
            else:
                os.environ["WINDSURF_DIRECT_KEY"] = old_token

            if old_final_only is None:
                os.environ.pop("WINDSURF_FINAL_RESPONSE_ONLY", None)
            else:
                os.environ["WINDSURF_FINAL_RESPONSE_ONLY"] = old_final_only

            if old_request_timeout is None:
                os.environ.pop("WINDSURF_REQUEST_TIMEOUT", None)
            else:
                os.environ["WINDSURF_REQUEST_TIMEOUT"] = old_request_timeout

    def test_main_runs_full_local_cascade_flow_and_emits_final_assistant_message(self):
        old_mode = os.environ.get("WINDSURF_PROBE_MODE")
        old_token = os.environ.get("WINDSURF_DIRECT_KEY")
        old_final_only = os.environ.get("WINDSURF_FINAL_RESPONSE_ONLY")
        old_argv = sys.argv[:]
        original_start_builder = module.build_start_cascade_probe_request
        original_send_builder = module.build_send_user_cascade_message_probe_request
        original_trajectory_builder = getattr(module, "build_get_cascade_trajectory_probe_request", None)
        original_registry = module.runtime_ls_registry
        original_run_request = module.run_request
        original_emit_output = module.emit_output

        emitted_payloads = []
        requests = []

        def fake_emit_output(payload):
            emitted_payloads.append(dict(payload))

        def fake_start_builder(_token, base_url=None):
            self.assertEqual(base_url, "http://127.0.0.1:5050")
            return "start-request", {"requestType": "start-cascade", "url": "http://local-cascade.test/start"}

        def fake_send_builder(_token, cascade_id):
            self.assertEqual(cascade_id, "cascade-123")
            return "send-request", {
                "requestType": "send-user-cascade-message",
                "url": "http://local-cascade.test/send",
                "cascadeId": cascade_id,
            }

        def fake_trajectory_builder(_token, cascade_id):
            self.assertEqual(cascade_id, "cascade-123")
            return "trajectory-request", {
                "requestType": "get-cascade-trajectory",
                "url": "http://local-cascade.test/trajectory",
                "cascadeId": cascade_id,
            }

        def fake_run_request(request, timeout=120):
            requests.append(request)
            if request == "start-request":
                return 0, {
                    "status": 200,
                    "decodedUnaryProto": {
                        "stringFields": [{"fieldNumber": 1, "utf8": "cascade-123"}],
                    },
                }
            if request == "send-request":
                return 0, {
                    "status": 200,
                    "decodedUnaryProto": {
                        "stringFields": [{"fieldNumber": 1, "utf8": "message-1"}],
                    },
                }
            if request == "trajectory-request":
                return 0, {
                    "status": 200,
                    "decodedUnaryProto": {
                        "trajectory": {
                            "derived": {
                                "assistantResponses": ["Hi from Windsurf"],
                                "assistantFinal": "Hi from Windsurf",
                            },
                            "trajectoryStatus": "TRAJECTORY_STATUS_COMPLETE",
                        }
                    },
                }
            raise AssertionError(f"unexpected request: {request}")

        try:
            os.environ["WINDSURF_PROBE_MODE"] = "cascade"
            os.environ["WINDSURF_DIRECT_KEY"] = "devin-session-token-123"
            os.environ["WINDSURF_FINAL_RESPONSE_ONLY"] = "1"
            module.build_start_cascade_probe_request = fake_start_builder
            module.build_send_user_cascade_message_probe_request = fake_send_builder
            module.build_get_cascade_trajectory_probe_request = fake_trajectory_builder
            module.run_request = fake_run_request
            module.emit_output = fake_emit_output

            sys.argv = [
                "windsurf_direct_probe.py",
                "--ls-event",
                json.dumps({
                    "event": "LanguageServerStarted",
                    "session_id": "session-1",
                    "window_id": "window-1",
                    "host": "127.0.0.1",
                    "port": 5050,
                    "lifecycle_nonce": "nonce-1",
                    "timestamp": 1714560000.0,
                    "csrf_token": "csrf-1",
                    "confirmed": True,
                }),
            ]
            ingest_exit_code = module.main()
            self.assertEqual(ingest_exit_code, 0)
            self.assertEqual(emitted_payloads[0]["event"], "LanguageServerStarted")
            self.assertEqual(emitted_payloads[0]["binding"]["state"], "confirmed")

            sys.argv = ["windsurf_direct_probe.py"]
            exit_code = module.main()

            self.assertEqual(exit_code, 0)
            self.assertEqual(requests, ["start-request", "send-request", "trajectory-request"])
            self.assertEqual(
                emitted_payloads[-1],
                {
                    "mode": "cascade",
                    "requestType": "get-cascade-trajectory",
                    "status": 200,
                    "finalResponse": "Hi from Windsurf",
                },
            )
        finally:
            sys.argv = old_argv
            module.build_start_cascade_probe_request = original_start_builder
            module.build_send_user_cascade_message_probe_request = original_send_builder
            if original_trajectory_builder is None:
                delattr(module, "build_get_cascade_trajectory_probe_request")
            else:
                module.build_get_cascade_trajectory_probe_request = original_trajectory_builder
            module.runtime_ls_registry = original_registry
            module.run_request = original_run_request
            module.emit_output = original_emit_output

            if old_mode is None:
                os.environ.pop("WINDSURF_PROBE_MODE", None)
            else:
                os.environ["WINDSURF_PROBE_MODE"] = old_mode

            if old_token is None:
                os.environ.pop("WINDSURF_DIRECT_KEY", None)
            else:
                os.environ["WINDSURF_DIRECT_KEY"] = old_token

            if old_final_only is None:
                os.environ.pop("WINDSURF_FINAL_RESPONSE_ONLY", None)
            else:
                os.environ["WINDSURF_FINAL_RESPONSE_ONLY"] = old_final_only

    def test_cascade_uses_language_server_endpoint(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        try:
            os.environ["WINDSURF_SESSION_ID"] = "observed-session-1"
            module.on_language_server_started(
                session_id="session-1",
                window_id="window-1",
                host="127.0.0.1",
                port=5050,
                lifecycle_nonce="nonce-1",
                timestamp=1714560000.0,
                csrf_token="csrf-local",
                confirmed=True,
            )

            request, preview = module.build_start_cascade_probe_request("devin-session-token-123")

            self.assertEqual(
                request.full_url,
                "http://127.0.0.1:5050/"
                "exa.language_server_pb.LanguageServerService/StartCascade",
            )
            self.assertEqual(preview["url"], request.full_url)
            self.assertEqual(preview["requestType"], "start-cascade")
            self.assertIn("127.0.0.1", request.full_url)
            self.assertNotIn("eu.windsurf.com", request.full_url)
            self.assertNotIn("AssignModel", request.full_url)
        finally:
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

    def test_send_user_cascade_message_uses_language_server_endpoint(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        try:
            os.environ["WINDSURF_SESSION_ID"] = "observed-session-1"
            module.on_language_server_started(
                session_id="session-1",
                window_id="window-1",
                host="127.0.0.1",
                port=5050,
                lifecycle_nonce="nonce-1",
                timestamp=1714560000.0,
                csrf_token="csrf-local",
                confirmed=True,
            )

            request, preview = module.build_send_user_cascade_message_probe_request(
                "devin-session-token-123",
                "cascade-123",
            )

            self.assertEqual(
                request.full_url,
                "http://127.0.0.1:5050/"
                "exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
            )
            self.assertEqual(preview["requestType"], "send-user-cascade-message")
            self.assertEqual(preview["cascadeId"], "cascade-123")
            self.assertNotIn("eu.windsurf.com", request.full_url)
            self.assertNotIn("ApiServerService", request.full_url)
        finally:
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

    def test_send_user_cascade_message_probe_omits_authorization_for_local_language_server(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        try:
            os.environ["WINDSURF_SESSION_ID"] = "observed-session-1"
            module.on_language_server_started(
                session_id="session-1",
                window_id="window-1",
                host="127.0.0.1",
                port=5050,
                lifecycle_nonce="nonce-1",
                timestamp=1714560000.0,
                csrf_token="csrf-local",
                confirmed=True,
            )

            request, _preview = module.build_send_user_cascade_message_probe_request(
                "devin-session-token-123",
                "cascade-123",
            )

            self.assertNotIn("Authorization", request.headers)
            self.assertEqual(request.headers.get("Origin"), "vscode-file://vscode-app")
            self.assertEqual(request.headers["Host"], "e.localhost:5050")
        finally:
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

    def test_classify_401_root_cause_accepts_case_insensitive_csrf_header(self):
        forensic_exchange = {
            "headers": {
                "X-codeium-csrf-token": "csrf-123",
            },
            "body": "devin-session-token$abc",
            "response_status": 200,
        }

        classification = module.classify_401_root_cause(forensic_exchange)

        self.assertEqual(classification["status"], "PASS")

    def test_send_user_cascade_message_request_matches_decoded_bundle_field_numbers(self):
        module.on_language_server_started(
            session_id="session-1",
            window_id="window-1",
            host="127.0.0.1",
            port=5050,
            lifecycle_nonce="nonce-1",
            timestamp=1714560000.0,
            csrf_token="csrf-local",
            confirmed=True,
        )

        body, preview = module.build_send_user_cascade_message_request(
            "devin-session-token-123",
            "cascade-123",
        )
        field_numbers = [field[0] for field in _parse_message_fields(body)]

        self.assertEqual(preview["fieldNumbers"], {
            "metadata": 3,
            "cascadeId": 1,
            "items": 2,
            "cascadeConfig": 5,
        })
        self.assertEqual(field_numbers, [1, 2, 3, 5])
        self.assertEqual(_get_field_values(body, 1)[0], b"cascade-123")

        item_payload = _get_field_values(body, 2)[0]
        self.assertEqual(_parse_message_fields(item_payload), [(1, 2, b"hello")])

        cascade_config_payload = _get_field_values(body, 5)[0]
        self.assertTrue(len(cascade_config_payload) > 0)

    def test_get_cascade_trajectory_request_matches_decoded_bundle_field_numbers(self):
        module.on_language_server_started(
            session_id="session-1",
            window_id="window-1",
            host="127.0.0.1",
            port=5050,
            lifecycle_nonce="nonce-1",
            timestamp=1714560000.0,
            csrf_token="csrf-local",
            confirmed=True,
        )

        body, preview = module.build_get_cascade_trajectory_request(
            "devin-session-token-123",
            "cascade-123",
        )
        field_numbers = [field[0] for field in _parse_message_fields(body)]

        self.assertEqual(preview["fieldNumbers"], {
            "cascadeId": 1,
        })
        self.assertEqual(field_numbers, [1])
        self.assertEqual(_get_field_values(body, 1)[0], b"cascade-123")

    def test_assign_model_not_used_in_cascade_mode(self):
        old_session = os.environ.get("WINDSURF_SESSION_ID")
        try:
            os.environ["WINDSURF_SESSION_ID"] = "observed-session-1"
            module.on_language_server_started(
                session_id="session-1",
                window_id="window-1",
                host="127.0.0.1",
                port=5050,
                lifecycle_nonce="nonce-1",
                timestamp=1714560000.0,
                csrf_token="csrf-local",
                confirmed=True,
            )

            request, preview = module.build_start_cascade_probe_request("devin-session-token-123")

            self.assertEqual(preview["requestType"], "start-cascade")
            self.assertNotEqual(preview["requestType"], "assign-model")
            self.assertIn("LanguageServerService", request.full_url)
            self.assertIn("StartCascade", request.full_url)
            self.assertNotIn("ApiServerService", request.full_url)
            self.assertNotIn("AssignModel", request.full_url)
        finally:
            if old_session is None:
                os.environ.pop("WINDSURF_SESSION_ID", None)
            else:
                os.environ["WINDSURF_SESSION_ID"] = old_session

    def test_resolve_live_language_server_url_uses_confirmed_runtime_binding(self):
        binding = module.runtime_ls_registry.on_language_server_started(
            session_id="session-1",
            window_id="window-1",
            host="127.0.0.1",
            port=5050,
            lifecycle_nonce="nonce-1",
            timestamp=1714560000.0,
            csrf_token="csrf-1",
        )
        module.runtime_ls_registry.confirm(binding.lifecycle_nonce)

        resolved = module.resolve_live_language_server_url()

        self.assertEqual(resolved, "http://127.0.0.1:5050")

    def test_resolve_live_language_server_url_rejects_missing_runtime_binding(self):
        with self.assertRaisesRegex(ValueError, "No runtime LS binding available"):
            module.resolve_live_language_server_url()

    def test_resolve_live_language_server_url_rejects_non_confirmed_runtime_binding(self):
        module.runtime_ls_registry.on_language_server_started(
            session_id="session-1",
            window_id="window-1",
            host="127.0.0.1",
            port=5050,
            lifecycle_nonce="nonce-1",
            timestamp=1714560000.0,
            csrf_token=None,
        )

        with self.assertRaisesRegex(ValueError, "LS not ready: pending"):
            module.resolve_live_language_server_url()

    def test_runtime_fault_taxonomy_treats_messageport_termination_as_ipc_degradation_only(self):
        report = module.classify_runtime_fault_taxonomy(
            {
                "canonical_reset": False,
                "renderer_pid_changed": False,
                "target_destroyed": False,
                "execution_context_destroyed": False,
                "messageport_terminated": True,
                "ls_alive": True,
                "node_service_alive": True,
                "transport_reachable": True,
                "transport_type": "connect_http",
            }
        )

        self.assertEqual(report["reset_status"], "NO_CANONICAL_RESET")
        self.assertEqual(report["state"]["t2"], "broken (IPC layer terminated)")
        self.assertEqual(report["conclusion"]["graph_continuity"], "VALID")
        self.assertEqual(report["conclusion"]["ipc_layer"], "DEGRADED_NOT_RESET")
        self.assertEqual(report["conclusion"]["ls_state"], "STABLE")
        self.assertEqual(report["conclusion"]["node_service_state"], "STABLE")
        self.assertEqual(report["transport_type"], "connect_http")

    def test_discover_runtime_ls_registry_state_includes_messageport_termination_signal(self):
        old_run = module.subprocess.run
        captured_command = None

        class _Completed:
            def __init__(self, stdout: str):
                self.stdout = stdout

        def fake_run(args, **kwargs):
            nonlocal captured_command
            captured_command = args[3]
            return _Completed(
                json.dumps(
                    {
                        "status": "READY",
                        "ls_pid": 30152,
                        "active_ports": [59961, 59963],
                        "primary_ls_port": 59963,
                        "extension_port": 59961,
                        "node_service_pid": 26376,
                        "messageport_terminated": True,
                    }
                )
            )

        try:
            module.subprocess.run = fake_run
            state = module.discover_runtime_ls_registry_state()
        finally:
            module.subprocess.run = old_run

        self.assertIn("node_service_pid", captured_command)
        self.assertIn("messageport_terminated", captured_command)
        self.assertEqual(state["status"], "READY")
        self.assertEqual(state["ls_pid"], 30152)
        self.assertEqual(state["primary_ls_port"], 59963)
        self.assertEqual(state["extension_port"], 59961)
        self.assertEqual(state["node_service_pid"], 26376)
        self.assertEqual(state["messageport_terminated"], True)

    def test_discover_runtime_ls_registry_state_includes_canonical_lifecycle_fields(self):
        old_run = module.subprocess.run
        captured_command = None

        class _Completed:
            def __init__(self, stdout: str):
                self.stdout = stdout

        def fake_run(args, **kwargs):
            nonlocal captured_command
            captured_command = args[3]
            return _Completed(
                json.dumps(
                    {
                        "status": "READY",
                        "ls_pid": 30152,
                        "active_ports": [59961, 59963],
                        "primary_ls_port": 59963,
                        "extension_port": 59961,
                        "node_service_pid": 26376,
                        "messageport_terminated": False,
                        "renderer_pid_changed": False,
                        "target_destroyed": False,
                        "execution_context_destroyed": False,
                    }
                )
            )

        try:
            module.subprocess.run = fake_run
            state = module.discover_runtime_ls_registry_state()
        finally:
            module.subprocess.run = old_run

        self.assertIn("renderer_pid_changed", captured_command)
        self.assertIn("target_destroyed", captured_command)
        self.assertIn("execution_context_destroyed", captured_command)
        self.assertEqual(state["renderer_pid_changed"], False)
        self.assertEqual(state["target_destroyed"], False)
        self.assertEqual(state["execution_context_destroyed"], False)

    def test_discover_runtime_ls_registry_state_includes_positive_renderer_activity_from_lifecycle_trace(self):
        old_run = module.subprocess.run
        old_env = os.environ.get("WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH")

        class _Completed:
            def __init__(self, stdout: str):
                self.stdout = stdout

        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w", encoding="utf-8") as handle:
            trace_path = handle.name
            handle.write(json.dumps({
                "at": "2026-05-02T14:41:10.000Z",
                "event": "DOMContentLoaded",
                "renderer_pid": 20400,
                "target_id": "target-live",
                "payload": {},
            }) + "\n")

        try:
            os.environ["WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH"] = trace_path
            module.subprocess.run = lambda *args, **kwargs: _Completed(
                json.dumps(
                    {
                        "status": "READY",
                        "ls_pid": 30152,
                        "active_ports": [59961, 59963],
                        "primary_ls_port": 59963,
                        "extension_port": 59961,
                        "node_service_pid": 26376,
                        "messageport_terminated": False,
                        "renderer_pid_changed": False,
                        "target_destroyed": False,
                        "execution_context_destroyed": False,
                    }
                )
            )
            state = module.discover_runtime_ls_registry_state()
        finally:
            module.subprocess.run = old_run
            pathlib.Path(trace_path).unlink(missing_ok=True)
            if old_env is None:
                os.environ.pop("WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH", None)
            else:
                os.environ["WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH"] = old_env

        self.assertEqual(state["renderer_activity_observed"], True)

    def test_discover_runtime_ls_registry_state_reads_canonical_reset_from_lifecycle_trace(self):
        old_run = module.subprocess.run
        old_env = os.environ.get("WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH")

        class _Completed:
            def __init__(self, stdout: str):
                self.stdout = stdout

        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w", encoding="utf-8") as handle:
            trace_path = handle.name
            handle.write(json.dumps({
                "at": "2026-05-02T14:41:12.000Z",
                "event": "Runtime.executionContextDestroyed",
                "payload": {},
            }) + "\n")

        try:
            os.environ["WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH"] = trace_path
            module.subprocess.run = lambda *args, **kwargs: _Completed(
                json.dumps(
                    {
                        "status": "READY",
                        "ls_pid": 30152,
                        "active_ports": [59961, 59963],
                        "primary_ls_port": 59963,
                        "extension_port": 59961,
                        "node_service_pid": 26376,
                        "messageport_terminated": False,
                        "renderer_pid_changed": False,
                        "target_destroyed": False,
                        "execution_context_destroyed": False,
                    }
                )
            )
            state = module.discover_runtime_ls_registry_state()
        finally:
            module.subprocess.run = old_run
            pathlib.Path(trace_path).unlink(missing_ok=True)
            if old_env is None:
                os.environ.pop("WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH", None)
            else:
                os.environ["WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH"] = old_env

        self.assertEqual(state["execution_context_destroyed"], True)
        self.assertEqual(state["target_destroyed"], False)
        self.assertEqual(state["renderer_pid_changed"], False)

    def test_derive_active_graph_snapshot_reads_latest_graph_from_lifecycle_trace(self):
        old_env = os.environ.get("WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH")
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8") as tmp:
            trace_path = tmp.name
            tmp.write(json.dumps({"at": "2026-05-02T14:40:00.000Z", "event": "renderer-script-executed", "target_id": "target-a", "renderer_pid": 111}) + "\n")
            tmp.write(json.dumps({"at": "2026-05-02T14:40:01.000Z", "event": "bridge-response", "target_id": "target-a", "renderer_pid": 111}) + "\n")
            tmp.write(json.dumps({"at": "2026-05-02T14:40:02.000Z", "event": "Runtime.executionContextDestroyed", "target_id": "target-a", "renderer_pid": 111}) + "\n")
            tmp.write(json.dumps({"at": "2026-05-02T14:41:00.000Z", "event": "renderer-script-executed", "target_id": "target-b", "renderer_pid": 222}) + "\n")
            tmp.write(json.dumps({"at": "2026-05-02T14:41:01.000Z", "event": "Page.frameNavigated", "target_id": "target-b", "renderer_pid": 222}) + "\n")
            tmp.write(json.dumps({"at": "2026-05-02T14:41:02.000Z", "event": "bridge-response", "target_id": "target-b", "renderer_pid": 222}) + "\n")
            tmp.write(json.dumps({"at": "2026-05-02T14:41:03.000Z", "event": "Network.requestWillBeSent", "target_id": "target-b", "renderer_pid": 222}) + "\n")

        try:
            os.environ["WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH"] = trace_path
            snapshot = module.derive_active_graph_snapshot()
        finally:
            pathlib.Path(trace_path).unlink(missing_ok=True)
            if old_env is None:
                os.environ.pop("WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH", None)
            else:
                os.environ["WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH"] = old_env

        self.assertEqual(snapshot["graph_id"], "G2")
        self.assertFalse(snapshot["reset_detected"])
        self.assertEqual(snapshot["renderer_state"]["t0_renderer_start"]["observed"], True)
        self.assertEqual(snapshot["renderer_state"]["t1_webcontents_proxy_active"]["observed"], True)
        self.assertEqual(snapshot["renderer_state"]["t2_ipc_bridge_live"]["observed"], True)
        self.assertEqual(snapshot["renderer_state"]["t3_network_active"]["observed"], True)

    def test_derive_active_graph_snapshot_splits_on_renderer_pid_churn(self):
        old_env = os.environ.get("WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH")
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8") as tmp:
            trace_path = tmp.name
            tmp.write(json.dumps({"at": "2026-05-02T14:40:00.000Z", "event": "renderer-script-executed", "target_id": "target-a", "renderer_pid": 111}) + "\n")
            tmp.write(json.dumps({"at": "2026-05-02T14:40:01.000Z", "event": "Page.frameNavigated", "target_id": "target-a", "renderer_pid": 111}) + "\n")
            tmp.write(json.dumps({"at": "2026-05-02T14:40:02.000Z", "event": "renderer-script-executed", "target_id": "target-a", "renderer_pid": 222}) + "\n")
            tmp.write(json.dumps({"at": "2026-05-02T14:40:03.000Z", "event": "bridge-response", "target_id": "target-a", "renderer_pid": 222}) + "\n")

        try:
            os.environ["WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH"] = trace_path
            snapshot = module.derive_active_graph_snapshot()
        finally:
            pathlib.Path(trace_path).unlink(missing_ok=True)
            if old_env is None:
                os.environ.pop("WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH", None)
            else:
                os.environ["WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH"] = old_env

        self.assertEqual(snapshot["graph_id"], "G2")
        self.assertEqual(snapshot["renderer_state"]["t0_renderer_start"]["observed"], True)
        self.assertEqual(snapshot["renderer_state"]["t1_webcontents_proxy_active"]["observed"], False)
        self.assertEqual(snapshot["renderer_state"]["t2_ipc_bridge_live"]["observed"], True)

    def test_derive_active_graph_snapshot_splits_on_target_id_churn(self):
        old_env = os.environ.get("WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH")
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8") as tmp:
            trace_path = tmp.name
            tmp.write(json.dumps({"at": "2026-05-02T14:42:00.000Z", "event": "renderer-script-executed", "target_id": "target-a", "renderer_pid": 111}) + "\n")
            tmp.write(json.dumps({"at": "2026-05-02T14:42:01.000Z", "event": "Page.frameNavigated", "target_id": "target-a", "renderer_pid": 111}) + "\n")
            tmp.write(json.dumps({"at": "2026-05-02T14:42:02.000Z", "event": "renderer-script-executed", "target_id": "target-b", "renderer_pid": 111}) + "\n")
            tmp.write(json.dumps({"at": "2026-05-02T14:42:03.000Z", "event": "bridge-response", "target_id": "target-b", "renderer_pid": 111}) + "\n")

        try:
            os.environ["WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH"] = trace_path
            snapshot = module.derive_active_graph_snapshot()
        finally:
            pathlib.Path(trace_path).unlink(missing_ok=True)
            if old_env is None:
                os.environ.pop("WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH", None)
            else:
                os.environ["WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH"] = old_env

        self.assertEqual(snapshot["graph_id"], "G2")
        self.assertEqual(snapshot["renderer_state"]["t0_renderer_start"]["observed"], True)
        self.assertEqual(snapshot["renderer_state"]["t1_webcontents_proxy_active"]["observed"], False)
        self.assertEqual(snapshot["renderer_state"]["t2_ipc_bridge_live"]["observed"], True)

    def test_cascade_builders_exist(self):
        self.assertTrue(callable(getattr(module, "build_start_cascade_probe_request", None)))
        self.assertTrue(callable(getattr(module, "build_send_user_cascade_message_probe_request", None)))

    def test_resolves_default_override_model_uid_to_chat_model_name(self):
        capture = {
            "default_override_model_config": {
                "model_uid": "model-fast",
                "version_id": "version-7",
            },
            "client_model_configs": [
                {
                    "model_uid": "model-smart",
                    "model_info": {
                        "chat_model_name": "claude-sonnet-4-5",
                        "inference_server_url": "https://smart.example",
                    },
                },
                {
                    "model_uid": "model-fast",
                    "model_info": {
                        "chat_model_name": "kimi-k2-6",
                        "inference_server_url": "https://fast.example",
                    },
                },
            ],
        }

        resolved = module.resolve_cascade_model_selection(capture)

        self.assertEqual(resolved["selectedModelUid"], "model-fast")
        self.assertEqual(resolved["selectedVersionId"], "version-7")
        self.assertEqual(resolved["chatModelName"], "kimi-k2-6")
        self.assertEqual(resolved["inferenceServerUrl"], "https://fast.example")

    def test_builds_resolution_summary_from_capture_file(self):
        capture = {
            "default_override_model_config": {
                "model_uid": "model-fast",
                "version_id": "version-7",
            },
            "client_model_configs": [
                {
                    "model_uid": "model-fast",
                    "model_info": {
                        "chat_model_name": "kimi-k2-6",
                        "inference_server_url": "https://fast.example",
                        "base_url": "https://base.example",
                        "api_provider": "windsurf",
                    },
                }
            ],
        }

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(capture, tmp)
            capture_path = tmp.name

        try:
            summary = module.build_cascade_capture_summary(capture_path)
        finally:
            pathlib.Path(capture_path).unlink(missing_ok=True)

        self.assertEqual(summary["capturePath"], capture_path)
        self.assertEqual(summary["selectedModelUid"], "model-fast")
        self.assertEqual(summary["selectedVersionId"], "version-7")
        self.assertEqual(summary["chatModelName"], "kimi-k2-6")
        self.assertEqual(summary["inferenceServerUrl"], "https://fast.example")
        self.assertEqual(summary["baseUrl"], "https://base.example")
        self.assertEqual(summary["apiProvider"], "windsurf")

    def test_builds_resolution_summary_from_nested_user_status_capture_file(self):
        capture = {
            "user_status": {
                "team_id": "team-1",
                "cascade_model_config_data": {
                    "default_override_model_config": {
                        "model_uid": "model-fast",
                        "version_id": "version-7",
                    },
                    "client_model_configs": [
                        {
                            "model_uid": "model-fast",
                            "model_info": {
                                "chat_model_name": "kimi-k2-6",
                                "inference_server_url": "https://fast.example",
                            },
                        }
                    ],
                },
            }
        }

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(capture, tmp)
            capture_path = tmp.name

        try:
            summary = module.build_cascade_capture_summary(capture_path)
        finally:
            pathlib.Path(capture_path).unlink(missing_ok=True)

        self.assertEqual(summary["capturePath"], capture_path)
        self.assertEqual(summary["selectedModelUid"], "model-fast")
        self.assertEqual(summary["selectedVersionId"], "version-7")
        self.assertEqual(summary["chatModelName"], "kimi-k2-6")
        self.assertEqual(summary["inferenceServerUrl"], "https://fast.example")

    def test_builds_resolution_summary_from_arbitrarily_wrapped_capture_file(self):
        capture = {
            "response": {
                "payload": {
                    "default_override_model_config": {
                        "model_uid": "model-fast",
                        "version_id": "version-7",
                    },
                    "client_model_configs": [
                        {
                            "model_uid": "model-fast",
                            "model_info": {
                                "chat_model_name": "kimi-k2-6",
                                "inference_server_url": "https://fast.example",
                            },
                        }
                    ],
                }
            }
        }

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(capture, tmp)
            capture_path = tmp.name

        try:
            summary = module.build_cascade_capture_summary(capture_path)
        finally:
            pathlib.Path(capture_path).unlink(missing_ok=True)

        self.assertEqual(summary["capturePath"], capture_path)
        self.assertEqual(summary["selectedModelUid"], "model-fast")
        self.assertEqual(summary["selectedVersionId"], "version-7")
        self.assertEqual(summary["chatModelName"], "kimi-k2-6")
        self.assertEqual(summary["inferenceServerUrl"], "https://fast.example")

    def test_scan_lists_candidate_paths_for_nested_capture_markers(self):
        capture = {
            "user_status": {
                "cascade_model_config_data": {
                    "default_override_model_config": {
                        "model_uid": "model-fast",
                        "version_id": "version-7",
                    }
                }
            },
            "response": {
                "payload": {
                    "default_override_model_config": {
                        "model_uid": "model-smart",
                        "version_id": "version-9",
                    }
                }
            },
        }

        candidates = module.scan_cascade_capture_candidates(capture)

        self.assertEqual(
            candidates,
            [
                "response.payload",
                "user_status",
                "user_status.cascade_model_config_data",
            ],
        )

    def test_builds_resolution_summary_from_camel_case_nested_capture_file(self):
        capture = {
            "userStatus": {
                "cascadeModelConfigData": {
                    "defaultOverrideModelConfig": {
                        "modelUid": "model-fast",
                        "versionId": "version-7",
                    },
                    "clientModelConfigs": [
                        {
                            "modelUid": "model-fast",
                            "modelInfo": {
                                "chatModelName": "kimi-k2-6",
                                "inferenceServerUrl": "https://fast.example",
                                "baseUrl": "https://base.example",
                                "apiProvider": "windsurf",
                            },
                        }
                    ],
                }
            }
        }

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(capture, tmp)
            capture_path = tmp.name

        try:
            summary = module.build_cascade_capture_summary(capture_path)
        finally:
            pathlib.Path(capture_path).unlink(missing_ok=True)

        self.assertEqual(summary["capturePath"], capture_path)
        self.assertEqual(summary["selectedModelUid"], "model-fast")
        self.assertEqual(summary["selectedVersionId"], "version-7")
        self.assertEqual(summary["chatModelName"], "kimi-k2-6")
        self.assertEqual(summary["inferenceServerUrl"], "https://fast.example")
        self.assertEqual(summary["baseUrl"], "https://base.example")
        self.assertEqual(summary["apiProvider"], "windsurf")

    def test_builds_bridge_artifact_validation_summary(self):
        capture = {
            "userStatus": {
                "cascadeModelConfigData": {
                    "defaultOverrideModelConfig": {
                        "modelUid": "model-fast",
                        "versionId": "version-7",
                    },
                    "clientModelConfigs": [
                        {
                            "modelUid": "model-fast",
                            "modelInfo": {
                                "chatModelName": "kimi-k2-6",
                                "inferenceServerUrl": "https://fast.example",
                            },
                        }
                    ],
                }
            }
        }

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(capture, tmp)
            capture_path = tmp.name

        try:
            summary = module.build_bridge_artifact_validation_summary(capture_path)
        finally:
            pathlib.Path(capture_path).unlink(missing_ok=True)

        self.assertEqual(summary["capturePath"], capture_path)
        self.assertEqual(summary["valid"], True)
        self.assertEqual(summary["candidateCount"], 2)
        self.assertEqual(
            summary["candidates"],
            ["user_status", "user_status.cascade_model_config_data"],
        )
        self.assertEqual(summary["resolved"]["chatModelName"], "kimi-k2-6")

    def test_build_capture_cli_payload_supports_validate_bridge_flag(self):
        capture = {
            "userStatus": {
                "cascadeModelConfigData": {
                    "defaultOverrideModelConfig": {
                        "modelUid": "model-fast",
                        "versionId": "version-7",
                    },
                    "clientModelConfigs": [
                        {
                            "modelUid": "model-fast",
                            "modelInfo": {
                                "chatModelName": "kimi-k2-6",
                                "inferenceServerUrl": "https://fast.example",
                            },
                        }
                    ],
                }
            }
        }

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(capture, tmp)
            capture_path = tmp.name

        try:
            payload = module.build_capture_cli_payload(["--validate-bridge", capture_path])
        finally:
            pathlib.Path(capture_path).unlink(missing_ok=True)

        self.assertEqual(payload["capturePath"], capture_path)
        self.assertEqual(payload["valid"], True)
        self.assertEqual(payload["resolved"]["chatModelName"], "kimi-k2-6")

    def test_build_capture_cli_payload_supports_windsurf_hook_env_flag(self):
        payload = module.build_capture_cli_payload([
            "--windsurf-hook-env",
            r"C:\Users\amine\OmniRoute\scripts\scratch\windsurf-model-runtime-hook.cjs",
        ])

        self.assertEqual(payload["hookPath"], r"C:\Users\amine\OmniRoute\scripts\scratch\windsurf-model-runtime-hook.cjs")
        self.assertEqual(
            payload["normalizedHookPath"],
            "C:/Users/amine/OmniRoute/scripts/scratch/windsurf-model-runtime-hook.cjs",
        )
        self.assertEqual(
            payload["nodeOptions"],
            "--require=C:/Users/amine/OmniRoute/scripts/scratch/windsurf-model-runtime-hook.cjs",
        )
        self.assertEqual(payload["vscodeNodeOptions"], payload["nodeOptions"])
        self.assertEqual(payload["launchArgs"], ["--new-window"])

    def test_build_capture_cli_payload_ingests_language_server_started_event(self):
        payload = module.build_capture_cli_payload([
            "--ls-event",
            json.dumps({
                "event": "LanguageServerStarted",
                "session_id": "session-1",
                "window_id": "window-1",
                "host": "127.0.0.1",
                "port": 5050,
                "lifecycle_nonce": "nonce-1",
                "timestamp": 1714560000.0,
                "csrf_token": "csrf-1",
                "confirmed": True,
            }),
        ])

        self.assertEqual(payload["event"], "LanguageServerStarted")
        self.assertEqual(payload["binding"]["state"], "confirmed")
        self.assertEqual(payload["binding"]["url"], "http://127.0.0.1:5050")
        self.assertEqual(module.resolve_live_language_server_url(), "http://127.0.0.1:5050")

    def test_build_capture_cli_payload_supports_passive_observer_once_flag(self):
        old_trace_env = os.environ.get("WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH")
        old_runtime_env = os.environ.get("WINDSURF_RUNTIME_LIVENESS_STATUS_PATH")
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8") as trace_tmp:
            trace_path = trace_tmp.name
            trace_tmp.write(json.dumps({"at": "2026-05-02T14:41:00.000Z", "event": "renderer-script-executed", "target_id": "target-b", "renderer_pid": 222}) + "\n")
            trace_tmp.write(json.dumps({"at": "2026-05-02T14:41:01.000Z", "event": "Page.frameNavigated", "target_id": "target-b", "renderer_pid": 222}) + "\n")
            trace_tmp.write(json.dumps({"at": "2026-05-02T14:41:02.000Z", "event": "bridge-response", "target_id": "target-b", "renderer_pid": 222}) + "\n")
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as runtime_tmp:
            runtime_path = runtime_tmp.name
            json.dump(
                {
                    "runtime_status": "LIVE",
                    "attach_allowed": True,
                    "selected_ports": {
                        "ls_port": 59602,
                        "extension_server_port": 59599,
                    },
                    "ls_reachable": True,
                    "selected_pid_tuple": {
                        "ls_pid": 15288,
                        "node_service_pids": [4444],
                        "extension_host_pids": [4444],
                    },
                },
                runtime_tmp,
            )

        try:
            os.environ["WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH"] = trace_path
            os.environ["WINDSURF_RUNTIME_LIVENESS_STATUS_PATH"] = runtime_path
            payload = module.build_capture_cli_payload(["--passive-observer-once"])
        finally:
            pathlib.Path(trace_path).unlink(missing_ok=True)
            pathlib.Path(runtime_path).unlink(missing_ok=True)
            if old_trace_env is None:
                os.environ.pop("WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH", None)
            else:
                os.environ["WINDSURF_ELECTRON_LIFECYCLE_TRACE_PATH"] = old_trace_env
            if old_runtime_env is None:
                os.environ.pop("WINDSURF_RUNTIME_LIVENESS_STATUS_PATH", None)
            else:
                os.environ["WINDSURF_RUNTIME_LIVENESS_STATUS_PATH"] = old_runtime_env

        self.assertEqual(payload["graphId"], "G1")
        self.assertEqual(payload["answers"]["runtimeAlive"], True)
        self.assertEqual(payload["answers"]["cascadeObserved"], False)
        self.assertEqual(payload["answers"]["sessionIdPresent"], False)
        self.assertEqual(payload["answers"]["traceCountIncreasing"], "unknown")
        self.assertEqual(payload["graphSummary"]["ipc_state"], "present")

    def test_build_capture_cli_payload_ingests_language_server_stopped_event(self):
        module.build_capture_cli_payload([
            "--ls-event",
            json.dumps({
                "event": "LanguageServerStarted",
                "session_id": "session-1",
                "window_id": "window-1",
                "host": "127.0.0.1",
                "port": 5050,
                "lifecycle_nonce": "nonce-1",
                "timestamp": 1714560000.0,
                "csrf_token": "csrf-1",
                "confirmed": True,
            }),
        ])

        payload = module.build_capture_cli_payload([
            "--ls-event",
            json.dumps({
                "event": "LanguageServerStopped",
                "session_id": "session-1",
                "window_id": "window-1",
                "lifecycle_nonce": "nonce-1",
                "timestamp": 1714560010.0,
            }),
        ])

        self.assertEqual(payload["event"], "LanguageServerStopped")
        self.assertEqual(payload["binding"]["state"], "expired")
        with self.assertRaisesRegex(ValueError, "No runtime LS binding available"):
            module.resolve_live_language_server_url()

    def test_replaces_stale_binding_with_valid_discovered_one(self):
        original_registry = module.runtime_ls_registry
        old_discover = module.discover_runtime_ls_registry_state
        listener = None
        try:
            module.runtime_ls_registry = module.RuntimeLSRegistry()
            module.on_language_server_started(
                session_id="stale-session",
                window_id="window-stale",
                host="127.0.0.1",
                port=5055,
                lifecycle_nonce="nonce-stale",
                timestamp=1714560010.0,
                csrf_token="csrf-stale",
                confirmed=True,
            )
            listener = socket.create_server(("127.0.0.1", 0))
            listener_port = listener.getsockname()[1]
            module.discover_runtime_ls_registry_state = lambda: {
                "status": "READY",
                "ls_pid": 30152,
                "primary_ls_port": listener_port,
                "extension_port": 6058,
                "node_service_pid": 26376,
                "active_ports": [listener_port, 6058],
                "renderer_activity_observed": True,
            }

            promoted = module.refresh_runtime_ls_binding_from_live_discovery()
            binding = module.runtime_ls_registry.get_current()

            self.assertTrue(promoted["bindingValidated"])
            self.assertEqual(promoted["bindingSource"], "LIVE_DISCOVERY")
            self.assertIsNotNone(binding)
            self.assertEqual(binding.port, listener_port)
            self.assertEqual(binding.state, "confirmed")
            self.assertEqual(getattr(binding, "source", None), "DISCOVERED")
        finally:
            if listener is not None:
                listener.close()
            module.runtime_ls_registry = original_registry
            module.discover_runtime_ls_registry_state = old_discover

    def test_does_not_replace_binding_if_candidate_invalid(self):
        original_registry = module.runtime_ls_registry
        old_discover = module.discover_runtime_ls_registry_state
        try:
            module.runtime_ls_registry = module.RuntimeLSRegistry()
            module.on_language_server_started(
                session_id="stale-session",
                window_id="window-stale",
                host="127.0.0.1",
                port=5055,
                lifecycle_nonce="nonce-stale",
                timestamp=1714560010.0,
                csrf_token="csrf-stale",
                confirmed=True,
            )
            stale_binding = module.runtime_ls_registry.get_current()
            module.discover_runtime_ls_registry_state = lambda: {
                "status": "BOOTING",
                "ls_pid": 30152,
                "primary_ls_port": None,
                "extension_port": 6058,
                "node_service_pid": 26376,
                "active_ports": [],
                "renderer_activity_observed": False,
            }

            promoted = module.refresh_runtime_ls_binding_from_live_discovery()
            binding = module.runtime_ls_registry.get_current()

            self.assertFalse(promoted["bindingValidated"])
            self.assertEqual(promoted["bindingSource"], "PERSISTED")
            self.assertEqual(promoted["runtimeState"], "RESET_CANDIDATE")
            self.assertIs(binding, stale_binding)
            self.assertEqual(binding.port, 5055)
        finally:
            module.runtime_ls_registry = original_registry
            module.discover_runtime_ls_registry_state = old_discover

    def test_run_port_surface_mapping_emits_runtime_fault_taxonomy(self):
        old_discover = module.discover_runtime_ls_registry_state
        old_resolve = module.resolve_auth_context_for_mode
        old_run_request = module.run_request
        old_start = module.build_start_cascade_probe_request
        old_send = module.build_send_user_cascade_message_probe_request
        old_chat = module.build_chat_probe_request
        try:
            module.discover_runtime_ls_registry_state = lambda: {
                "status": "READY",
                "ls_pid": 30152,
                "primary_ls_port": 59963,
                "extension_port": 59961,
                "node_service_pid": 26376,
                "messageport_terminated": True,
            }
            module.resolve_auth_context_for_mode = lambda mode: {"token": "devin-session-token-123", "authType": "session", "hint": ""}

            def fake_request_builder(token, *args):
                return module.urllib.request.Request(
                    "http://127.0.0.1:59963/exa.language_server_pb.LanguageServerService/Fake",
                    data=b"test",
                    headers={},
                    method="POST",
                ), {"url": "http://127.0.0.1:59963/exa.language_server_pb.LanguageServerService/Fake"}

            module.build_start_cascade_probe_request = fake_request_builder
            module.build_send_user_cascade_message_probe_request = lambda token, cascade_id: fake_request_builder(token)
            module.build_chat_probe_request = fake_request_builder
            module.run_request = lambda request, timeout=120: (0, {"status": 200})

            payload = module.run_port_surface_mapping(
                ports=[59963],
                csrf_token="csrf-live",
                session_id="session-live",
            )
        finally:
            module.discover_runtime_ls_registry_state = old_discover
            module.resolve_auth_context_for_mode = old_resolve
            module.run_request = old_run_request
            module.build_start_cascade_probe_request = old_start
            module.build_send_user_cascade_message_probe_request = old_send
            module.build_chat_probe_request = old_chat

        self.assertEqual(payload["runtimeFaultTaxonomy"]["reset_status"], "NO_CANONICAL_RESET")
        self.assertEqual(payload["runtimeFaultTaxonomy"]["transport_type"], "connect_http")
        self.assertEqual(payload["runtimeFaultTaxonomy"]["conclusion"]["graph_continuity"], "VALID")
        self.assertEqual(payload["runtimeFaultTaxonomy"]["conclusion"]["ipc_layer"], "DEGRADED_NOT_RESET")
        self.assertEqual(payload["activeGraphCorrelation"]["graph_id"], "G1")
        self.assertEqual(payload["activeGraphCorrelation"]["renderer_state"], "unknown")
        self.assertEqual(payload["activeGraphCorrelation"]["ipc_state"], "absent")
        self.assertEqual(payload["activeGraphCorrelation"]["extension_server_state"], "unknown")
        self.assertEqual(payload["activeGraphCorrelation"]["ls_state"], "started")
        self.assertEqual(payload["activeGraphCorrelation"]["classification"], "ls_orphan")

    def test_run_port_surface_mapping_propagates_registry_reset_flags_into_active_graph(self):
        old_discover = module.discover_runtime_ls_registry_state
        old_resolve = module.resolve_auth_context_for_mode
        old_run_request = module.run_request
        old_start = module.build_start_cascade_probe_request
        old_send = module.build_send_user_cascade_message_probe_request
        old_chat = module.build_chat_probe_request
        try:
            module.discover_runtime_ls_registry_state = lambda: {
                "status": "READY",
                "ls_pid": 30152,
                "primary_ls_port": 59963,
                "extension_port": 59961,
                "node_service_pid": 26376,
                "messageport_terminated": False,
                "renderer_pid_changed": True,
                "target_destroyed": False,
                "execution_context_destroyed": False,
            }
            module.resolve_auth_context_for_mode = lambda mode: {"token": "devin-session-token-123", "authType": "session", "hint": ""}

            def fake_request_builder(token, *args):
                return module.urllib.request.Request(
                    "http://127.0.0.1:59963/exa.language_server_pb.LanguageServerService/Fake",
                    data=b"test",
                    headers={},
                    method="POST",
                ), {"url": "http://127.0.0.1:59963/exa.language_server_pb.LanguageServerService/Fake"}

            module.build_start_cascade_probe_request = fake_request_builder
            module.build_send_user_cascade_message_probe_request = lambda token, cascade_id: fake_request_builder(token)
            module.build_chat_probe_request = fake_request_builder
            module.run_request = lambda request, timeout=120: (0, {"status": 200})

            payload = module.run_port_surface_mapping(
                ports=[59963],
                csrf_token="csrf-live",
                session_id="session-live",
            )
        finally:
            module.discover_runtime_ls_registry_state = old_discover
            module.resolve_auth_context_for_mode = old_resolve
            module.run_request = old_run_request
            module.build_start_cascade_probe_request = old_start
            module.build_send_user_cascade_message_probe_request = old_send
            module.build_chat_probe_request = old_chat

        self.assertTrue(payload["activeGraphCorrelation"]["reset_detected"])
        self.assertEqual(payload["activeGraphCorrelation"]["classification"], "extensionserver_control_plane")

    def test_run_port_surface_mapping_binds_get_chat_message_to_requested_port(self):
        old_discover = module.discover_runtime_ls_registry_state
        old_resolve = module.resolve_auth_context_for_mode
        old_run_request = module.run_request
        old_start = module.build_start_cascade_probe_request
        old_send = module.build_send_user_cascade_message_probe_request
        try:
            requested_port = 59602
            observed_urls = []

            module.discover_runtime_ls_registry_state = lambda: {
                "status": "READY",
                "ls_pid": 30152,
                "primary_ls_port": 49265,
                "extension_port": 49263,
                "node_service_pid": 26376,
                "messageport_terminated": False,
            }
            module.resolve_auth_context_for_mode = lambda mode: {"token": "devin-session-token-123", "authType": "session", "hint": ""}

            def fake_request_builder(token, *args):
                return module.urllib.request.Request(
                    f"http://127.0.0.1:{requested_port}/exa.language_server_pb.LanguageServerService/Fake",
                    data=b"test",
                    headers={},
                    method="POST",
                ), {"url": f"http://127.0.0.1:{requested_port}/exa.language_server_pb.LanguageServerService/Fake"}

            def capture_run_request(request, timeout=120):
                observed_urls.append(request.full_url)
                return 0, {"status": 200}

            module.build_start_cascade_probe_request = fake_request_builder
            module.build_send_user_cascade_message_probe_request = lambda token, cascade_id: fake_request_builder(token)
            module.run_request = capture_run_request

            payload = module.run_port_surface_mapping(
                ports=[requested_port],
                csrf_token="csrf-live",
                session_id="session-live",
            )
        finally:
            module.discover_runtime_ls_registry_state = old_discover
            module.resolve_auth_context_for_mode = old_resolve
            module.run_request = old_run_request
            module.build_start_cascade_probe_request = old_start
            module.build_send_user_cascade_message_probe_request = old_send

        self.assertEqual(len(observed_urls), 6)
        self.assertTrue(all(f"127.0.0.1:{requested_port}" in url for url in observed_urls))
        self.assertEqual(
            payload["surfaceMapping"][str(requested_port)][-1]["url"],
            f"http://127.0.0.1:{requested_port}/exa.language_server_pb.LanguageServerService/GetChatMessage",
        )
        self.assertEqual(payload["activeGraphCorrelation"]["ipc_state"], "absent")

    def test_extracts_cascade_id_from_decoded_start_cascade_response(self):
        start_result = {
            "decodedUnaryProto": {
                "stringFields": [
                    {"fieldNumber": 1, "utf8": "cascade-123"},
                    {"fieldNumber": 2, "utf8": "ignored"},
                ]
            }
        }

        self.assertEqual(module.extract_cascade_id_from_start_result(start_result), "cascade-123")
        self.assertEqual(
            module.extract_cascade_id_details_from_start_result(start_result),
            {"cascadeId": "cascade-123", "cascadeIdSource": "protobuf"},
        )

    def test_extracts_cascade_id_from_body_text_uuid_fallback(self):
        start_result = {
            "status": 200,
            "bodyText": "ok 9f0df4db-7fd4-4f37-a7d6-6a8c8fe6f0a1 done",
        }

        self.assertEqual(
            module.extract_cascade_id_details_from_start_result(start_result),
            {
                "cascadeId": "9f0df4db-7fd4-4f37-a7d6-6a8c8fe6f0a1",
                "cascadeIdSource": "bodyText-regex",
            },
        )
        self.assertEqual(
            module.extract_cascade_id_from_start_result(start_result),
            "9f0df4db-7fd4-4f37-a7d6-6a8c8fe6f0a1",
        )

    def test_extract_cascade_id_details_returns_none_when_no_candidate_exists(self):
        start_result = {
            "status": 200,
            "bodyText": "no cascade id here",
        }

        self.assertEqual(
            module.extract_cascade_id_details_from_start_result(start_result),
            {"cascadeId": None, "cascadeIdSource": None},
        )
        self.assertIsNone(module.extract_cascade_id_from_start_result(start_result))

    def test_classify_trajectory_node_preserves_assistant_evidence(self):
        assistant_message = b"".join([
            module.encode_int64(1, 2),
            module.encode_string(3, "Hi from Windsurf"),
        ])

        classified = module.classify_trajectory_node(assistant_message)

        self.assertEqual(classified["classifier"], "assistant_emit")
        self.assertEqual(classified["chat"], {"role": 2, "text": "Hi from Windsurf"})
        self.assertEqual(classified["fieldNumbers"], [1, 3])
        self.assertEqual(classified["candidateTexts"], [])

    def test_classify_trajectory_node_preserves_string_evidence_for_policy_payload(self):
        policy_message = b"".join([
            module.encode_int64(1, 2),
            module.encode_string(3, "Use only the available tools. Never guess parameters."),
        ])

        classified = module.classify_trajectory_node(policy_message)

        self.assertEqual(classified["classifier"], "policy_or_system")
        self.assertIn("Use only the available tools. Never guess parameters.", classified["strings"])
        self.assertEqual(classified["fieldNumbers"], [1, 3])

    def test_deep_extract_strings_finds_nested_readable_text(self):
        nested_text_message = module.encode_message(
            5,
            module.encode_message(1, module.encode_string(3, "Hi from Windsurf")),
        )

        strings = module.deep_extract_strings(nested_text_message)

        self.assertIn("Hi from Windsurf", strings)

    def test_classify_trajectory_node_marks_uuid_only_payload_as_unknown(self):
        uuid_only_payload = b"".join([
            module.encode_message(2, b"".join([
                module.encode_int64(1, 1777686460),
                module.encode_int64(2, 406120875),
            ])),
            module.encode_string(3, "c789bfe4-d243-48f0-946a-8040e20f2822"),
        ])

        classified = module.classify_trajectory_node(uuid_only_payload)

        self.assertEqual(classified["classifier"], "unknown")
        self.assertEqual(classified["strings"], ["c789bfe4-d243-48f0-946a-8040e20f2822"])

    def test_decode_cascade_trajectory_response_returns_graph_first_trajectory(self):
        assistant_message = b"".join([
            module.encode_int64(1, 2),
            module.encode_string(3, "Hi from Windsurf"),
        ])
        trajectory_payload = b"".join([
            module.encode_string(1, "trajectory-123"),
            module.encode_message(9, assistant_message),
            module.encode_string(6, "cascade-123"),
        ])
        body = b"".join([
            module.encode_message(1, trajectory_payload),
            module.encode_int64(2, 1),
            module.encode_int64(3, 1),
            module.encode_int64(4, 0),
        ])

        decoded = module.decode_cascade_trajectory_response(body)
        trajectory = decoded["trajectory"]

        self.assertEqual(decoded["status"], 1)
        self.assertEqual(decoded["numTotalSteps"], 1)
        self.assertEqual(decoded["numTotalGeneratorMetadata"], 0)
        self.assertEqual(trajectory["trajectoryId"], "trajectory-123")
        self.assertEqual(trajectory["cascadeId"], "cascade-123")
        self.assertEqual(len(trajectory["nodesRaw"]), 1)
        self.assertEqual(len(trajectory["steps"]), 1)
        self.assertEqual(trajectory["steps"][0]["type"], "assistant_emit")
        self.assertEqual(trajectory["steps"][0]["outputs"], {"text": "Hi from Windsurf"})
        self.assertEqual(trajectory["derived"]["assistantResponses"], ["Hi from Windsurf"])
        self.assertEqual(trajectory["derived"]["assistantFinal"], "Hi from Windsurf")

    def test_decode_cascade_trajectory_response_classifies_user_policy_and_assistant_nodes(self):
        user_message = b"".join([
            module.encode_int64(1, 1),
            module.encode_string(3, "hello"),
        ])
        policy_message = b"".join([
            module.encode_int64(1, 2),
            module.encode_string(3, "Use only the available tools. Never guess parameters."),
        ])
        assistant_message = b"".join([
            module.encode_int64(1, 2),
            module.encode_string(3, "Hi from Windsurf"),
        ])
        trajectory_payload = b"".join([
            module.encode_string(1, "trajectory-123"),
            module.encode_message(9, user_message),
            module.encode_message(9, policy_message),
            module.encode_message(9, assistant_message),
            module.encode_string(6, "cascade-123"),
        ])
        body = module.encode_message(1, trajectory_payload)

        decoded = module.decode_cascade_trajectory_response(body)
        trajectory = decoded["trajectory"]

        self.assertEqual(
            [step["type"] for step in trajectory["steps"]],
            ["user_message", "policy_or_system", "assistant_emit"],
        )
        self.assertEqual(trajectory["derived"]["assistantFinal"], "Hi from Windsurf")

    def test_decode_raw_trajectory_nodes_preserves_order_and_field_numbers(self):
        first_node = module.encode_int64(1, 1) + module.encode_string(3, "hello")
        second_node = module.encode_int64(1, 2) + module.encode_string(3, "world")
        trajectory_payload = b"".join([
            module.encode_string(1, "trajectory-123"),
            module.encode_message(9, first_node),
            module.encode_message(9, second_node),
            module.encode_string(6, "cascade-123"),
        ])

        nodes = module.decode_raw_trajectory_nodes(trajectory_payload)

        self.assertEqual([node["index"] for node in nodes], [0, 1])
        self.assertEqual([node["fieldNumber"] for node in nodes], [9, 9])
        self.assertEqual(nodes[0]["bytes"], first_node)
        self.assertEqual(nodes[1]["bytes"], second_node)

    def test_build_cascade_steps_creates_ordered_graph_steps(self):
        classified_nodes = [
            {
                "classifier": "user_message",
                "chat": {"role": 1, "text": "hello"},
                "strings": ["hello"],
                "fieldNumbers": [1, 3],
                "containerFieldNumber": 9,
                "modelAssignmentInfo": None,
                "candidateTexts": [],
                "rawFields": [],
            },
            {
                "classifier": "assistant_emit",
                "chat": {"role": 2, "text": "Hi from Windsurf"},
                "strings": ["Hi from Windsurf"],
                "fieldNumbers": [1, 3],
                "containerFieldNumber": 9,
                "modelAssignmentInfo": None,
                "candidateTexts": [],
                "rawFields": [],
            },
        ]

        steps = module.build_cascade_steps(classified_nodes)

        self.assertEqual([step["stepIndex"] for step in steps], [0, 1])
        self.assertEqual([step["type"] for step in steps], ["user_message", "assistant_emit"])
        self.assertEqual(steps[0]["inputs"], {"text": "hello"})
        self.assertEqual(steps[1]["outputs"], {"text": "Hi from Windsurf"})

    def test_build_cascade_steps_preserves_unknown_non_empty_nodes(self):
        classified_nodes = [
            {
                "classifier": "unknown",
                "chat": None,
                "strings": [],
                "fieldNumbers": [4],
                "containerFieldNumber": 9,
                "modelAssignmentInfo": None,
                "candidateTexts": [],
                "rawFields": [{"fieldNumber": 4, "wireType": 2, "value": b"\x08\x00"}],
            }
        ]

        steps = module.build_cascade_steps(classified_nodes)

        self.assertEqual(len(steps), 1)
        self.assertEqual(steps[0]["type"], "unknown")
        self.assertEqual(steps[0]["sourceNodeIndex"], 0)
        self.assertEqual(steps[0]["rawSummary"]["classifier"], "unknown")

    def test_decode_cascade_trajectory_response_separates_tool_and_binary_nodes(self):
        tool_message = b"".join([
            module.encode_int64(1, 2),
            module.encode_string(3, "kubectl delete"),
        ])
        binary_node = module.encode_message(4, b"\x08\x00")
        trajectory_payload = b"".join([
            module.encode_string(1, "trajectory-123"),
            module.encode_message(9, tool_message),
            module.encode_message(9, binary_node),
            module.encode_string(6, "cascade-123"),
        ])
        body = module.encode_message(1, trajectory_payload)

        decoded = module.decode_cascade_trajectory_response(body)
        trajectory = decoded["trajectory"]

        self.assertEqual([step["type"] for step in trajectory["steps"]], ["unknown", "unknown"])
        self.assertEqual(trajectory["derived"]["assistantFinal"], None)

    def test_decode_cascade_trajectory_response_collapses_prefix_duplicate_assistant_partials(self):
        assistant_partial = b"".join([
            module.encode_int64(1, 2),
            module.encode_string(3, "Hi"),
        ])
        assistant_final = b"".join([
            module.encode_int64(1, 2),
            module.encode_string(3, "Hi from Windsurf"),
        ])
        trajectory_payload = b"".join([
            module.encode_string(1, "trajectory-123"),
            module.encode_message(9, assistant_partial),
            module.encode_message(9, assistant_final),
            module.encode_string(6, "cascade-123"),
        ])
        body = module.encode_message(1, trajectory_payload)

        decoded = module.decode_cascade_trajectory_response(body)
        trajectory = decoded["trajectory"]

        self.assertEqual(trajectory["derived"]["assistantResponses"], ["Hi from Windsurf"])
        self.assertEqual(trajectory["derived"]["assistantFinal"], "Hi from Windsurf")
        self.assertEqual(
            [step["type"] for step in trajectory["steps"]],
            ["assistant_emit", "assistant_emit"],
        )

    def test_builds_cascade_assignment_correlation_summary(self):
        start_result = {
            "decodedUnaryProto": {
                "stringFields": [{"fieldNumber": 1, "utf8": "cascade-123"}]
            }
        }
        send_result = {
            "decodedUnaryProto": {
                "modelAssignmentInfo": {
                    "assignmentJwt": "jwt-1",
                    "assignedModelUid": "kimi-k2-5",
                    "harnessUid": "strawberry-pancake",
                    "modelRouterUid": "adaptive",
                }
            }
        }

        summary = module.build_cascade_assignment_correlation_summary(start_result, send_result)

        self.assertEqual(summary["cascadeId"], "cascade-123")
        self.assertEqual(summary["assignmentJwt"], "jwt-1")
        self.assertEqual(summary["assignedModelUid"], "kimi-k2-5")
        self.assertEqual(summary["harnessUid"], "strawberry-pancake")
        self.assertEqual(summary["modelRouterUid"], "adaptive")

    def test_builds_active_graph_correlation_summary_without_cross_reset_inference(self):
        summary = module.build_active_graph_correlation_summary(
            {
                "graph_id": "G7",
                "reset_detected": False,
                "renderer_state": {
                    "t0_renderer_start": {"status": "confirmed", "observed": True},
                    "t1_webcontents_proxy_active": {"status": "confirmed", "observed": True},
                    "t2_ipc_bridge_live": {"status": "confirmed", "observed": True},
                    "t3_network_active": {"status": "confirmed", "observed": True},
                },
                "extension_port": 59961,
                "ls_port": 59963,
                "ls_alive": True,
                "transport_reachable": True,
            }
        )

        self.assertEqual(summary["graph_id"], "G7")
        self.assertEqual(summary["renderer_state"], "t3")
        self.assertEqual(summary["ipc_state"], "active")
        self.assertEqual(summary["ls_state"], "active")
        self.assertEqual(summary["extension_server_state"], "active")
        self.assertEqual(
            summary["causal_chain"],
            [
                "renderer → ipc",
                "ipc → extension server",
                "extension server → ls",
            ],
        )
        self.assertEqual(summary["classification"], "ls_backend")
        self.assertFalse(summary["reset_detected"])
        self.assertEqual(summary["confidence"], "medium")

    def test_builds_passive_observer_snapshot_keeps_historical_session_out_of_active_graph(self):
        snapshot = module.build_passive_observer_snapshot(
            graph={
                "graph_id": "G9",
                "reset_detected": False,
                "renderer_state": {
                    "t0_renderer_start": {"status": "confirmed", "observed": True},
                    "t1_webcontents_proxy_active": {"status": "confirmed", "observed": True},
                    "t2_ipc_bridge_live": {"status": "confirmed", "observed": True},
                    "t3_network_active": {"status": "absent", "observed": False},
                },
                "extension_port": 59599,
                "ls_port": 59602,
                "ls_alive": True,
                "transport_reachable": True,
            },
            runtime_inputs={
                "ls_port": 59602,
                "extension_port": 59599,
                "ls_alive": True,
                "transport_reachable": True,
                "node_service_alive": True,
                "extension_host_alive": True,
            },
            passive_semantics={
                "sessionId": {
                    "value": "historic-session-1",
                    "state": "observed-historical",
                    "provenance": "acp-artifact",
                    "graphId": "G8",
                },
                "traceCount": {
                    "value": 4,
                    "state": "observed-historical",
                    "provenance": "historical-capture",
                },
                "cascadeObserved": {
                    "value": False,
                    "state": "not-observed",
                    "provenance": None,
                },
            },
        )

        self.assertEqual(snapshot["graphId"], "G9")
        self.assertEqual(snapshot["answers"]["runtimeAlive"], True)
        self.assertEqual(snapshot["answers"]["sessionIdPresent"], "historical-only")
        self.assertEqual(snapshot["answers"]["cascadeObserved"], False)
        self.assertEqual(snapshot["answers"]["traceCountIncreasing"], "unknown")
        self.assertEqual(snapshot["sessionId"]["state"], "observed-historical")
        self.assertEqual(snapshot["sessionId"]["value"], "historic-session-1")
        self.assertEqual(snapshot["sessionId"]["graphId"], "G8")
        self.assertIn("active graph", snapshot["finalConclusion"])

    def test_builds_passive_observer_snapshot_marks_trace_count_increasing_only_for_current_graph(self):
        snapshot = module.build_passive_observer_snapshot(
            graph={
                "graph_id": "G4",
                "reset_detected": False,
                "renderer_state": {
                    "t0_renderer_start": {"status": "confirmed", "observed": True},
                    "t1_webcontents_proxy_active": {"status": "confirmed", "observed": True},
                    "t2_ipc_bridge_live": {"status": "confirmed", "observed": True},
                    "t3_network_active": {"status": "confirmed", "observed": True},
                },
                "extension_port": 59599,
                "ls_port": 59602,
                "ls_alive": True,
                "transport_reachable": True,
            },
            runtime_inputs={
                "ls_port": 59602,
                "extension_port": 59599,
                "ls_alive": True,
                "transport_reachable": True,
                "node_service_alive": True,
                "extension_host_alive": True,
            },
            passive_semantics={
                "sessionId": {
                    "value": "live-session-4",
                    "state": "observed-current-graph",
                    "provenance": "runtime-report",
                    "graphId": "G4",
                },
                "traceCount": {
                    "value": 7,
                    "previousValue": 5,
                    "state": "observed-current-graph",
                    "provenance": "runtime-report",
                    "deltaState": "increasing",
                    "graphId": "G4",
                },
                "cascadeObserved": {
                    "value": True,
                    "state": "observed-current-graph",
                    "provenance": "runtime-report",
                    "graphId": "G4",
                },
            },
        )

        self.assertEqual(snapshot["answers"]["runtimeAlive"], True)
        self.assertEqual(snapshot["answers"]["sessionIdPresent"], True)
        self.assertEqual(snapshot["answers"]["cascadeObserved"], True)
        self.assertEqual(snapshot["answers"]["traceCountIncreasing"], True)
        self.assertEqual(snapshot["traceCount"]["deltaState"], "increasing")
        self.assertEqual(snapshot["traceCount"]["previousValue"], 5)
        self.assertEqual(snapshot["sessionId"]["state"], "observed-current-graph")
        self.assertEqual(snapshot["sessionId"]["graphId"], "G4")

    def test_normalizes_passive_semantic_observation_prefers_current_graph_evidence(self):
        observation = module.normalize_passive_semantic_observation(
            current_graph_id="G5",
            field_name="sessionId",
            candidates=[
                {
                    "value": "historic-session",
                    "provenance": "acp-artifact",
                    "graphId": "G4",
                    "observedAt": "2026-05-02T15:00:00Z",
                },
                {
                    "value": "live-session",
                    "provenance": "runtime-report",
                    "graphId": "G5",
                    "observedAt": "2026-05-02T15:02:00Z",
                },
            ],
        )

        self.assertEqual(observation["value"], "live-session")
        self.assertEqual(observation["state"], "observed-current-graph")
        self.assertEqual(observation["provenance"], "runtime-report")
        self.assertEqual(observation["graphId"], "G5")

    def test_reads_runtime_liveness_artifact_into_graph_inputs(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            artifact_path = tmp.name
            json.dump(
                {
                    "runtime_status": "LIVE",
                    "attach_allowed": True,
                    "selected_ports": {
                        "ls_port": 59602,
                        "extension_server_port": 59599,
                    },
                    "ls_reachable": True,
                    "selected_pid_tuple": {
                        "ls_pid": 15288,
                        "node_service_pids": [4444],
                        "extension_host_pids": [4444],
                    },
                },
                tmp,
            )

        try:
            inputs = module.read_runtime_liveness_graph_inputs(pathlib.Path(artifact_path))
        finally:
            pathlib.Path(artifact_path).unlink(missing_ok=True)

        self.assertEqual(inputs["ls_port"], 59602)
        self.assertEqual(inputs["extension_port"], 59599)
        self.assertEqual(inputs["ls_alive"], True)
        self.assertEqual(inputs["transport_reachable"], True)
        self.assertEqual(inputs["node_service_alive"], True)
        self.assertEqual(inputs["extension_host_alive"], True)

    def test_run_port_surface_mapping_enriches_runtime_facts_from_liveness_artifact(self):
        old_discover = module.discover_runtime_ls_registry_state
        old_resolve = module.resolve_auth_context_for_mode
        old_run_request = module.run_request
        old_start = module.build_start_cascade_probe_request
        old_send = module.build_send_user_cascade_message_probe_request
        old_chat = module.build_chat_probe_request
        old_trace_env = os.environ.get("WINDSURF_RUNTIME_LIVENESS_STATUS_PATH")
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            artifact_path = tmp.name
            json.dump(
                {
                    "runtime_status": "LIVE",
                    "attach_allowed": True,
                    "selected_ports": {
                        "ls_port": 59602,
                        "extension_server_port": 59599,
                    },
                    "ls_reachable": True,
                    "selected_pid_tuple": {
                        "ls_pid": 15288,
                        "node_service_pids": [4444],
                        "extension_host_pids": [4444],
                    },
                },
                tmp,
            )

        try:
            os.environ["WINDSURF_RUNTIME_LIVENESS_STATUS_PATH"] = artifact_path
            module.discover_runtime_ls_registry_state = lambda: {
                "status": "READY",
                "ls_pid": 30152,
                "primary_ls_port": 59963,
                "extension_port": 59961,
                "node_service_pid": 26376,
                "messageport_terminated": False,
                "renderer_pid_changed": False,
                "target_destroyed": False,
                "execution_context_destroyed": False,
            }
            module.resolve_auth_context_for_mode = lambda mode: {"token": "devin-session-token-123", "authType": "session", "hint": ""}

            def fake_request_builder(token, *args):
                return module.urllib.request.Request(
                    "http://127.0.0.1:59963/exa.language_server_pb.LanguageServerService/Fake",
                    data=b"test",
                    headers={},
                    method="POST",
                ), {"url": "http://127.0.0.1:59963/exa.language_server_pb.LanguageServerService/Fake"}

            module.build_start_cascade_probe_request = fake_request_builder
            module.build_send_user_cascade_message_probe_request = lambda token, cascade_id: fake_request_builder(token)
            module.build_chat_probe_request = fake_request_builder
            module.run_request = lambda request, timeout=120: (0, {"status": 200})

            payload = module.run_port_surface_mapping(
                ports=[59963],
                csrf_token="csrf-live",
                session_id="session-live",
            )
        finally:
            pathlib.Path(artifact_path).unlink(missing_ok=True)
            if old_trace_env is None:
                os.environ.pop("WINDSURF_RUNTIME_LIVENESS_STATUS_PATH", None)
            else:
                os.environ["WINDSURF_RUNTIME_LIVENESS_STATUS_PATH"] = old_trace_env
            module.discover_runtime_ls_registry_state = old_discover
            module.resolve_auth_context_for_mode = old_resolve
            module.run_request = old_run_request
            module.build_start_cascade_probe_request = old_start
            module.build_send_user_cascade_message_probe_request = old_send
            module.build_chat_probe_request = old_chat

        self.assertEqual(payload["activeGraphCorrelation"]["ls_state"], "started")
        self.assertEqual(payload["activeGraphCorrelation"]["extension_server_state"], "unknown")
        self.assertEqual(payload["runtimeLiveness"]["ls_port"], 59602)
        self.assertEqual(payload["runtimeLiveness"]["extension_port"], 59599)
        self.assertEqual(payload["runtimeLiveness"]["node_service_alive"], True)

    def test_run_local_cascade_flow_retries_trajectory_until_terminal_state(self):
        original_start_builder = module.build_start_cascade_probe_request
        original_send_builder = module.build_send_user_cascade_message_probe_request
        original_trajectory_builder = module.build_get_cascade_trajectory_probe_request
        original_run_request = module.run_request
        old_attempts = os.environ.get("WINDSURF_CASCADE_POLL_ATTEMPTS")

        requests = []

        def fake_start_builder(_token, base_url=None):
            self.assertEqual(base_url, "http://127.0.0.1:5050")
            return "start-request", {"requestType": "start-cascade"}

        def fake_send_builder(_token, cascade_id):
            self.assertEqual(cascade_id, "cascade-123")
            return "send-request", {"requestType": "send-user-cascade-message", "cascadeId": cascade_id}

        def fake_trajectory_builder(_token, cascade_id):
            self.assertEqual(cascade_id, "cascade-123")
            return "trajectory-request", {"requestType": "get-cascade-trajectory", "cascadeId": cascade_id}

        def fake_run_request(request, timeout=120):
            requests.append(request)
            if request == "start-request":
                return 0, {
                    "status": 200,
                    "decodedUnaryProto": {
                        "stringFields": [{"fieldNumber": 1, "utf8": "cascade-123"}],
                    },
                }
            if request == "send-request":
                return 0, {"status": 200, "decodedUnaryProto": {}}
            if request == "trajectory-request" and requests.count("trajectory-request") == 1:
                return 0, {
                    "status": 200,
                    "decodedUnaryProto": {
                        "trajectory": {
                            "derived": {"assistantResponses": [], "assistantFinal": None},
                            "trajectoryStatus": "TRAJECTORY_STATUS_RUNNING",
                        }
                    },
                }
            if request == "trajectory-request":
                return 0, {
                    "status": 200,
                    "decodedUnaryProto": {
                        "trajectory": {
                            "derived": {
                                "assistantResponses": ["Hi from Windsurf"],
                                "assistantFinal": "Hi from Windsurf",
                            },
                            "trajectoryStatus": "TRAJECTORY_STATUS_COMPLETE",
                        }
                    },
                }
            raise AssertionError(f"unexpected request: {request}")

        try:
            os.environ["WINDSURF_CASCADE_POLL_ATTEMPTS"] = "3"
            module.build_start_cascade_probe_request = fake_start_builder
            module.build_send_user_cascade_message_probe_request = fake_send_builder
            module.build_get_cascade_trajectory_probe_request = fake_trajectory_builder
            module.run_request = fake_run_request

            exit_code, preview, result = module.run_local_cascade_flow(
                "devin-session-token-123",
                "http://127.0.0.1:5050",
            )

            self.assertEqual(exit_code, 0)
            self.assertEqual(
                requests,
                ["start-request", "send-request", "trajectory-request", "trajectory-request"],
            )
            self.assertEqual(preview["requestType"], "get-cascade-trajectory")
            self.assertEqual(
                result["decodedUnaryProto"]["trajectory"]["derived"]["assistantFinal"],
                "Hi from Windsurf",
            )
        finally:
            module.build_start_cascade_probe_request = original_start_builder
            module.build_send_user_cascade_message_probe_request = original_send_builder
            module.build_get_cascade_trajectory_probe_request = original_trajectory_builder
            module.run_request = original_run_request

            if old_attempts is None:
                os.environ.pop("WINDSURF_CASCADE_POLL_ATTEMPTS", None)
            else:
                os.environ["WINDSURF_CASCADE_POLL_ATTEMPTS"] = old_attempts


if __name__ == "__main__":
    unittest.main()
