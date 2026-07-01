import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "runtime_correlation_graph.py"
spec = importlib.util.spec_from_file_location("runtime_correlation_graph", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class RuntimeCorrelationGraphTests(unittest.TestCase):
    def test_cli_without_arguments_prints_empty_passive_snapshot(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            env = os.environ.copy()
            env["APPDATA"] = tmpdir
            completed = subprocess.run(
                [sys.executable, str(MODULE_PATH)],
                capture_output=True,
                text=True,
                check=True,
                env=env,
            )

        payload = json.loads(completed.stdout)

        self.assertEqual(payload["graph_id"], "G_0")
        self.assertEqual(payload["status"], "no_activity")
        self.assertEqual(payload["reason"], "no CDP/IPC/WS cascade signals observed")
        self.assertEqual(payload["events"], [])
        self.assertEqual(payload["correlation"], {
            "sessionId_clusters": [],
            "cascade_chain_detected": False,
            "evidenceSummary": {},
        })
        self.assertEqual(payload["observer"], {
            "status": "waiting",
            "reason": "no cascade emission detected",
            "evidenceSummary": {},
            "eventCount": 0,
        })

    def test_parse_args_supports_output_and_paths(self):
        args = module.parse_args(["--output", "out.json", "a.jsonl", "b.jsonl"])

        self.assertEqual(args.output, "out.json")
        self.assertEqual(args.paths, ["a.jsonl", "b.jsonl"])
        self.assertFalse(args.list_sources)

    def test_parse_args_supports_list_sources_mode(self):
        args = module.parse_args(["--list-sources", "a.jsonl"])

        self.assertTrue(args.list_sources)
        self.assertEqual(args.paths, ["a.jsonl"])

    def test_run_passive_correlation_builds_snapshot_from_observer_module(self):
        observer_snapshot = {
            "status": "observed",
            "reason": None,
            "evidenceSummary": {
                "live_runtime": {
                    "count": 3,
                    "paths": [r"C:\\live\\renderer.jsonl"],
                    "reasons": ["path is under a Windsurf logs epoch directory"],
                }
            },
            "events": [
                {
                    "type": "START_CASCADE",
                    "timestamp": "2026-05-02T12:00:00Z",
                    "sessionId": "session-runner-1",
                    "traceCount": 0,
                    "surface": "renderer",
                    "pid": 7001,
                    "source": "LanguageServerFetchRequest",
                    "sourcePath": r"C:\\live\\renderer.jsonl",
                    "evidenceSource": {
                        "kind": "live_runtime",
                        "epoch": "20260502T150751",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                },
                {
                    "type": "SEND_USER_CASCADE_MESSAGE",
                    "timestamp": "2026-05-02T12:00:01Z",
                    "sessionId": "session-runner-1",
                    "traceCount": 0,
                    "surface": "renderer",
                    "pid": 7001,
                    "source": "promise-client-call",
                    "sourcePath": r"C:\\live\\renderer.jsonl",
                    "evidenceSource": {
                        "kind": "live_runtime",
                        "epoch": "20260502T150751",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                },
                {
                    "type": "TRACE_COUNT_DELTA",
                    "timestamp": "2026-05-02T12:00:02Z",
                    "sessionId": "session-runner-1",
                    "traceCount": 1,
                    "traceDelta": 1,
                    "surface": "runtime_jsonl",
                    "pid": 7001,
                    "source": "TRACE_COUNT_DELTA",
                    "sourcePath": r"C:\\live\\runtime.jsonl",
                    "evidenceSource": {
                        "kind": "live_runtime",
                        "epoch": "20260502T150751",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                },
            ],
        }

        class StubObserver:
            def __init__(self) -> None:
                self.calls: list[object] = []

            def observe_preferred_passive_cascade(self, paths=None):
                self.calls.append(paths)
                return observer_snapshot

            def discover_live_runtime_paths(self):
                return []

            def prioritize_observer_paths(self, paths):
                return list(pathlib.Path(path) for path in paths)

        stub = StubObserver()
        with patch.object(module, "load_passive_observer_module", return_value=stub):
            snapshot = module.run_passive_correlation(["one.jsonl", "two.jsonl"])

        self.assertEqual(stub.calls, [["one.jsonl", "two.jsonl"]])
        self.assertEqual(snapshot["status"], "observing")
        self.assertEqual(snapshot["observer"], {
            "status": "observed",
            "reason": None,
            "evidenceSummary": {
                "live_runtime": {
                    "count": 3,
                    "paths": [r"C:\\live\\renderer.jsonl"],
                    "reasons": ["path is under a Windsurf logs epoch directory"],
                }
            },
            "eventCount": 3,
        })
        self.assertEqual(snapshot["sources"], {
            "discovered": [],
            "provided": ["one.jsonl", "two.jsonl"],
            "selected": ["one.jsonl", "two.jsonl"],
        })

    def test_main_writes_output_file_when_requested(self):
        expected_snapshot = {
            "graph_id": "G_0",
            "status": "no_activity",
            "reason": "no CDP/IPC/WS cascade signals observed",
            "events": [],
            "correlation": {
                "sessionId_clusters": [],
                "cascade_chain_detected": False,
                "evidenceSummary": {},
            },
            "observer": {
                "status": "waiting",
                "reason": "no cascade emission detected",
                "evidenceSummary": {},
                "eventCount": 0,
            },
            "sources": {
                "discovered": [],
                "provided": ["capture.jsonl"],
                "selected": ["capture.jsonl"],
            },
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = pathlib.Path(tmpdir) / "graph.json"
            with patch.object(module, "run_passive_correlation", return_value=expected_snapshot):
                exit_code = module.main(["--output", str(output_path), "capture.jsonl"])

            self.assertEqual(exit_code, 0)
            self.assertEqual(json.loads(output_path.read_text(encoding="utf-8")), expected_snapshot)

    def test_list_passive_sources_merges_discovered_and_provided_paths(self):
        class StubObserver:
            def discover_live_runtime_paths(self):
                return [pathlib.Path(r"C:\\live\\renderer.jsonl")]

            def prioritize_observer_paths(self, paths):
                return list(paths)

        with patch.object(module, "load_passive_observer_module", return_value=StubObserver()):
            sources = module.list_passive_sources(["C:\\manual\\capture.jsonl"])

        self.assertEqual(sources, {
            "discovered": ["C:\\live\\renderer.jsonl"],
            "provided": ["C:\\manual\\capture.jsonl"],
            "selected": ["C:\\live\\renderer.jsonl", "C:\\manual\\capture.jsonl"],
        })

    def test_main_prints_sources_when_list_sources_is_requested(self):
        expected_sources = {
            "discovered": [r"C:\\live\\renderer.jsonl"],
            "provided": [],
            "selected": [r"C:\\live\\renderer.jsonl"],
        }

        with patch.object(module, "list_passive_sources", return_value=expected_sources), patch.object(module, "run_passive_correlation") as run_mock:
            with patch("builtins.print") as print_mock:
                exit_code = module.main(["--list-sources"])

        self.assertEqual(exit_code, 0)
        run_mock.assert_not_called()
        print_mock.assert_called_once_with(json.dumps(expected_sources, indent=2))

    def test_ingestion_adapter_maps_raw_session_propagation_record_to_reducer_event(self):
        raw_record = {
            "event": "SESSION_ID_PROPAGATION",
            "timestamp": "2026-05-02T12:00:04Z",
            "source_stream": "extension_log",
            "renderer_pid": 15288,
            "payload": {
                "from": "LS",
                "to": "ExtensionHost",
                "sessionId": "session-prop-1",
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-prop-1")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-prop-1",
            "event_type": "SESSION_ID_PROPAGATION",
            "observed_at": "2026-05-02T12:00:04Z",
            "source_stream": "extension_log",
            "payload": {
                "from": "LS",
                "to": "ExtensionHost",
                "sessionId": "session-prop-1",
            },
            "evidence": {"renderer_pid": 15288},
            "graph_hint": {"sessionId": "session-prop-1"},
        })

    def test_ingestion_adapter_maps_raw_cdp_response_record_to_reducer_event(self):
        raw_record = {
            "event": "Network.responseReceived",
            "timestamp": "2026-05-02T12:00:01Z",
            "requestId": "req-raw-1",
            "renderer_pid": 15288,
            "params": {
                "response": {
                    "url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
                    "status": 200,
                }
            },
            "metadata": {
                "sessionId": "session-raw-1",
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-1")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-1",
            "event_type": "CDP_NETWORK_RESPONSE_RECEIVED",
            "observed_at": "2026-05-02T12:00:01Z",
            "source_stream": "cdp_trace",
            "payload": {
                "requestId": "req-raw-1",
                "url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
                "status": 200,
                "sessionId": "session-raw-1",
            },
            "evidence": {"method": "Network.responseReceived", "renderer_pid": 15288},
            "graph_hint": {"sessionId": "session-raw-1"},
        })

    def test_ingestion_adapter_maps_raw_cdp_websocket_record_to_reducer_event(self):
        raw_record = {
            "event": "Network.webSocketCreated",
            "timestamp": "2026-05-02T12:00:02Z",
            "requestId": "ws-raw-1",
            "renderer_pid": 15288,
            "params": {
                "url": "ws://127.0.0.1:53740/socket",
            },
            "metadata": {
                "sessionId": "session-ws-1",
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-ws-1")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-ws-1",
            "event_type": "CDP_WEBSOCKET_CREATED",
            "observed_at": "2026-05-02T12:00:02Z",
            "source_stream": "cdp_trace",
            "payload": {
                "requestId": "ws-raw-1",
                "url": "ws://127.0.0.1:53740/socket",
                "sessionId": "session-ws-1",
            },
            "evidence": {"method": "Network.webSocketCreated", "renderer_pid": 15288},
            "graph_hint": {"sessionId": "session-ws-1"},
        })

    def test_ingestion_adapter_maps_raw_cdp_request_record_to_reducer_event(self):
        raw_record = {
            "event": "Network.requestWillBeSent",
            "timestamp": "2026-05-02T12:00:03Z",
            "requestId": "req-send-1",
            "renderer_pid": 15288,
            "params": {
                "request": {
                    "url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
                }
            },
            "metadata": {
                "sessionId": "session-req-1",
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-req-1")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-req-1",
            "event_type": "CDP_NETWORK_REQUEST_WILL_BE_SENT",
            "observed_at": "2026-05-02T12:00:03Z",
            "source_stream": "cdp_trace",
            "payload": {
                "requestId": "req-send-1",
                "url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
                "sessionId": "session-req-1",
            },
            "evidence": {"method": "Network.requestWillBeSent", "renderer_pid": 15288},
            "graph_hint": {"sessionId": "session-req-1"},
        })

    def test_ingestion_adapter_maps_raw_connect_http_established_record_to_reducer_event(self):
        raw_record = {
            "event": "CONNECT_HTTP_ESTABLISHED",
            "timestamp": "2026-05-02T12:00:05Z",
            "source_stream": "ls_log",
            "renderer_pid": 15288,
            "payload": {
                "src": "LS",
                "dst": "ExtensionHost",
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-connect-1")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-connect-1",
            "event_type": "CONNECT_HTTP_ESTABLISHED",
            "observed_at": "2026-05-02T12:00:05Z",
            "source_stream": "ls_log",
            "payload": {
                "src": "LS",
                "dst": "ExtensionHost",
            },
            "evidence": {"renderer_pid": 15288},
            "graph_hint": {},
        })

    def test_ingestion_adapter_maps_raw_start_cascade_record_to_reducer_event(self):
        raw_record = {
            "event": "START_CASCADE",
            "timestamp": "2026-05-02T12:00:06Z",
            "source_stream": "runtime_jsonl",
            "renderer_pid": 15288,
            "payload": {
                "sessionId": "session-start-1",
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-start-1")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-start-1",
            "event_type": "START_CASCADE",
            "observed_at": "2026-05-02T12:00:06Z",
            "source_stream": "runtime_jsonl",
            "payload": {
                "sessionId": "session-start-1",
            },
            "evidence": {"renderer_pid": 15288},
            "graph_hint": {"sessionId": "session-start-1"},
        })

    def test_ingestion_adapter_maps_raw_send_user_cascade_message_record_to_reducer_event(self):
        raw_record = {
            "event": "SEND_USER_CASCADE_MESSAGE",
            "timestamp": "2026-05-02T12:00:07Z",
            "source_stream": "runtime_jsonl",
            "renderer_pid": 15288,
            "payload": {
                "sessionId": "session-send-1",
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-send-1")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-send-1",
            "event_type": "SEND_USER_CASCADE_MESSAGE",
            "observed_at": "2026-05-02T12:00:07Z",
            "source_stream": "runtime_jsonl",
            "payload": {
                "sessionId": "session-send-1",
            },
            "evidence": {"renderer_pid": 15288},
            "graph_hint": {"sessionId": "session-send-1"},
        })

    def test_ingestion_adapter_maps_raw_trace_count_delta_record_to_reducer_event(self):
        raw_record = {
            "event": "TRACE_COUNT_DELTA",
            "timestamp": "2026-05-02T12:00:08Z",
            "source_stream": "runtime_jsonl",
            "renderer_pid": 15288,
            "payload": {
                "delta": 1,
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-trace-1")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-trace-1",
            "event_type": "TRACE_COUNT_DELTA",
            "observed_at": "2026-05-02T12:00:08Z",
            "source_stream": "runtime_jsonl",
            "payload": {
                "delta": 1,
            },
            "evidence": {"renderer_pid": 15288},
            "graph_hint": {},
        })

    def test_ingestion_adapter_maps_raw_ls_start_record_to_reducer_event(self):
        raw_record = {
            "event": "LS_START",
            "timestamp": "2026-05-02T12:00:09Z",
            "source_stream": "ls_log",
            "renderer_pid": 15288,
            "payload": {
                "ls_pid": 15288,
                "ports": [53740],
                "sessionId": "session-ls-1",
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-ls-1")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-ls-1",
            "event_type": "LS_START",
            "observed_at": "2026-05-02T12:00:09Z",
            "source_stream": "ls_log",
            "payload": {
                "ls_pid": 15288,
                "ports": [53740],
                "sessionId": "session-ls-1",
            },
            "evidence": {"renderer_pid": 15288},
            "graph_hint": {"sessionId": "session-ls-1"},
        })

    def test_ingestion_adapter_maps_raw_extension_host_start_record_to_reducer_event(self):
        raw_record = {
            "event": "EXTENSION_HOST_START",
            "timestamp": "2026-05-02T12:00:10Z",
            "source_stream": "extension_log",
            "renderer_pid": 15288,
            "payload": {
                "pid": 20400,
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-extension-1")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-extension-1",
            "event_type": "EXTENSION_HOST_START",
            "observed_at": "2026-05-02T12:00:10Z",
            "source_stream": "extension_log",
            "payload": {
                "pid": 20400,
            },
            "evidence": {"renderer_pid": 15288},
            "graph_hint": {},
        })

    def test_ingestion_adapter_maps_raw_port_bound_record_to_reducer_event(self):
        raw_record = {
            "event": "PORT_BOUND",
            "timestamp": "2026-05-02T12:00:11Z",
            "source_stream": "ls_log",
            "renderer_pid": 15288,
            "payload": {
                "service": "LanguageServer",
                "port": 53740,
                "owner_pid": 15288,
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-port-1")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-port-1",
            "event_type": "PORT_BOUND",
            "observed_at": "2026-05-02T12:00:11Z",
            "source_stream": "ls_log",
            "payload": {
                "service": "LanguageServer",
                "port": 53740,
                "owner_pid": 15288,
            },
            "evidence": {"renderer_pid": 15288},
            "graph_hint": {},
        })

    def test_ingestion_adapter_maps_raw_node_service_start_record_to_reducer_event(self):
        raw_record = {
            "event": "NODE_SERVICE_START",
            "timestamp": "2026-05-02T12:00:12Z",
            "source_stream": "node_log",
            "renderer_pid": 15288,
            "payload": {
                "pid": 30100,
                "port": 8080,
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-node-1")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-node-1",
            "event_type": "NODE_SERVICE_START",
            "observed_at": "2026-05-02T12:00:12Z",
            "source_stream": "node_log",
            "payload": {
                "pid": 30100,
                "port": 8080,
            },
            "evidence": {"renderer_pid": 15288},
            "graph_hint": {},
        })

    def test_ingestion_adapter_maps_raw_cdp_network_request_will_be_sent_record_to_reducer_event(self):
        raw_record = {
            "event": "CDP_NETWORK_REQUEST_WILL_BE_SENT",
            "timestamp": "2026-05-02T12:00:13Z",
            "source_stream": "cdp_log",
            "renderer_pid": 15288,
            "payload": {
                "requestId": "req-123",
                "url": "http://localhost:53740/StartCascade",
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-cdp-1")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-cdp-1",
            "event_type": "CDP_NETWORK_REQUEST_WILL_BE_SENT",
            "observed_at": "2026-05-02T12:00:13Z",
            "source_stream": "cdp_log",
            "payload": {
                "requestId": "req-123",
                "url": "http://localhost:53740/StartCascade",
            },
            "evidence": {"renderer_pid": 15288},
            "graph_hint": {},
        })

    def test_ingestion_adapter_maps_raw_cdp_network_response_received_record_to_reducer_event(self):
        raw_record = {
            "event": "CDP_NETWORK_RESPONSE_RECEIVED",
            "timestamp": "2026-05-02T12:00:14Z",
            "source_stream": "cdp_log",
            "renderer_pid": 15288,
            "payload": {
                "requestId": "req-123",
                "status": 200,
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-cdp-2")

        self.assertEqual(normalized, {
            "event_id": "evt-normalized-cdp-2",
            "event_type": "CDP_NETWORK_RESPONSE_RECEIVED",
            "observed_at": "2026-05-02T12:00:14Z",
            "source_stream": "cdp_log",
            "payload": {
                "requestId": "req-123",
                "status": 200,
            },
            "evidence": {"renderer_pid": 15288},
            "graph_hint": {},
        })

    def test_observer_event_to_reducer_event_maps_acp_agent_registered(self):
        observer_event = {
            "type": "ACP_AGENT_REGISTERED",
            "timestamp": "2026-05-03T16:45:00Z",
            "sessionId": "session-acp-1",
            "surface": "acp_log",
            "pid": 12345,
        }

        reducer_event = module.observer_event_to_reducer_event(observer_event, event_id="evt-acp-1")

        self.assertEqual(reducer_event["event_id"], "evt-acp-1")
        self.assertEqual(reducer_event["event_type"], "ACP_AGENT_REGISTERED")
        self.assertEqual(reducer_event["observed_at"], "2026-05-03T16:45:00Z")
        self.assertEqual(reducer_event["payload"]["sessionId"], "session-acp-1")
        self.assertEqual(reducer_event["payload"]["surface"], "acp_log")
        self.assertEqual(reducer_event["payload"]["pid"], 12345)
        self.assertEqual(reducer_event["graph_hint"]["sessionId"], "session-acp-1")

    def test_observer_event_to_reducer_event_maps_ls_start(self):
        observer_event = {
            "type": "LS_START",
            "timestamp": "2026-05-03T16:46:00Z",
            "sessionId": "session-ls-1",
            "ls_pid": 15288,
            "ports": [53740],
        }

        reducer_event = module.observer_event_to_reducer_event(observer_event, event_id="evt-ls-1")

        self.assertEqual(reducer_event["event_id"], "evt-ls-1")
        self.assertEqual(reducer_event["event_type"], "LS_START")
        self.assertEqual(reducer_event["observed_at"], "2026-05-03T16:46:00Z")

    def test_ingestion_adapter_maps_raw_cdp_websocket_created_record_to_reducer_event(self):
        raw_record = {
            "event": "CDP_WEBSOCKET_CREATED",
            "timestamp": "2026-05-03T12:00:15Z",
            "source_stream": "cdp_log",
            "renderer_pid": 15288,
            "payload": {
                "requestId": "ws-req-456",
                "url": "ws://localhost:53740/cascade",
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-cdp-3")

        self.assertEqual(normalized["event_id"], "evt-normalized-cdp-3")
        self.assertEqual(normalized["event_type"], "CDP_WEBSOCKET_CREATED")
        self.assertEqual(normalized["observed_at"], "2026-05-03T12:00:15Z")
        self.assertEqual(normalized["source_stream"], "cdp_log")
        self.assertEqual(normalized["payload"]["requestId"], "ws-req-456")
        self.assertEqual(normalized["payload"]["url"], "ws://localhost:53740/cascade")
        self.assertEqual(normalized["evidence"]["renderer_pid"], 15288)

    def test_ingestion_adapter_maps_raw_cdp_websocket_frame_sent_record_to_reducer_event(self):
        raw_record = {
            "event": "CDP_WEBSOCKET_FRAME_SENT",
            "timestamp": "2026-05-03T12:00:16Z",
            "source_stream": "cdp_log",
            "renderer_pid": 15288,
            "payload": {
                "requestId": "ws-req-456",
                "opcode": 1,
                "payloadData": '{"method":"StartCascade"}',
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-cdp-4")

        self.assertEqual(normalized["event_id"], "evt-normalized-cdp-4")
        self.assertEqual(normalized["event_type"], "CDP_WEBSOCKET_FRAME_SENT")
        self.assertEqual(normalized["observed_at"], "2026-05-03T12:00:16Z")
        self.assertEqual(normalized["source_stream"], "cdp_log")
        self.assertEqual(normalized["payload"]["requestId"], "ws-req-456")
        self.assertEqual(normalized["payload"]["opcode"], 1)
        self.assertEqual(normalized["payload"]["payloadData"], '{"method":"StartCascade"}')
        self.assertEqual(normalized["evidence"]["renderer_pid"], 15288)

    def test_ingestion_adapter_maps_raw_cdp_websocket_frame_received_record_to_reducer_event(self):
        raw_record = {
            "event": "CDP_WEBSOCKET_FRAME_RECEIVED",
            "timestamp": "2026-05-03T12:00:17Z",
            "source_stream": "cdp_log",
            "renderer_pid": 15288,
            "payload": {
                "requestId": "ws-req-456",
                "opcode": 1,
                "payloadData": '{"result":{"sessionId":"sess-789"}}',
            },
        }

        normalized = module.normalize_passive_record(raw_record, event_id="evt-normalized-cdp-5")

        self.assertEqual(normalized["event_id"], "evt-normalized-cdp-5")
        self.assertEqual(normalized["event_type"], "CDP_WEBSOCKET_FRAME_RECEIVED")
        self.assertEqual(normalized["observed_at"], "2026-05-03T12:00:17Z")
        self.assertEqual(normalized["source_stream"], "cdp_log")
        self.assertEqual(normalized["payload"]["requestId"], "ws-req-456")
        self.assertEqual(normalized["payload"]["opcode"], 1)
        self.assertEqual(normalized["payload"]["payloadData"], '{"result":{"sessionId":"sess-789"}}')
        self.assertEqual(normalized["evidence"]["renderer_pid"], 15288)

    def test_observer_event_to_reducer_event_maps_extension_server_client_created(self):
        observer_event = {
            "type": "EXTENSION_SERVER_CLIENT_CREATED",
            "timestamp": "2026-05-03T16:47:00Z",
            "sessionId": "session-ext-1",
        }

        reducer_event = module.observer_event_to_reducer_event(observer_event, event_id="evt-ext-1")

        self.assertEqual(reducer_event["event_id"], "evt-ext-1")
        self.assertEqual(reducer_event["event_type"], "EXTENSION_SERVER_CLIENT_CREATED")
        self.assertEqual(reducer_event["observed_at"], "2026-05-03T16:47:00Z")
        self.assertEqual(reducer_event["payload"]["sessionId"], "session-ext-1")
        self.assertEqual(reducer_event["graph_hint"]["sessionId"], "session-ext-1")

    def test_multi_event_causal_chain_from_ls_start_to_websocket_frame_exchange(self):
        """Integration test: LS_START -> CDP_WEBSOCKET_CREATED -> CDP_WEBSOCKET_FRAME_SENT -> CDP_WEBSOCKET_FRAME_RECEIVED"""
        reducer = module.RuntimeCorrelationReducer()

        # Event 1: LS starts with session
        snapshot1 = reducer.apply_event({
            "event_id": "evt-1",
            "event_type": "LS_START",
            "observed_at": "2026-05-03T12:00:00Z",
            "source_stream": "ls_log",
            "payload": {"ls_pid": 15288, "ports": [53740], "sessionId": "session-abc"},
            "evidence": {},
            "graph_hint": {"sessionId": "session-abc"},
        })

        # Event 2: WebSocket created to LS port
        snapshot2 = reducer.apply_event({
            "event_id": "evt-2",
            "event_type": "CDP_WEBSOCKET_CREATED",
            "observed_at": "2026-05-03T12:00:01Z",
            "source_stream": "cdp_log",
            "payload": {"requestId": "ws-req-1", "url": "ws://localhost:53740/cascade"},
            "evidence": {"renderer_pid": 16000},
            "graph_hint": {},
        })

        # Event 3: WebSocket frame sent (StartCascade)
        snapshot3 = reducer.apply_event({
            "event_id": "evt-3",
            "event_type": "CDP_WEBSOCKET_FRAME_SENT",
            "observed_at": "2026-05-03T12:00:02Z",
            "source_stream": "cdp_log",
            "payload": {"requestId": "ws-req-1", "opcode": 1, "payloadData": '{"method":"StartCascade"}'},
            "evidence": {"renderer_pid": 16000},
            "graph_hint": {},
        })

        # Event 4: WebSocket frame received (response with sessionId)
        snapshot4 = reducer.apply_event({
            "event_id": "evt-4",
            "event_type": "CDP_WEBSOCKET_FRAME_RECEIVED",
            "observed_at": "2026-05-03T12:00:03Z",
            "source_stream": "cdp_log",
            "payload": {"requestId": "ws-req-1", "opcode": 1, "payloadData": '{"result":{"sessionId":"session-abc"}}'},
            "evidence": {"renderer_pid": 16000},
            "graph_hint": {},
        })

        # Verify graph accumulated all event IDs
        graph = reducer.current_graph()
        self.assertEqual(len(graph["events"]), 4)
        self.assertIn("evt-1", graph["events"])
        self.assertIn("evt-2", graph["events"])
        self.assertIn("evt-3", graph["events"])
        self.assertIn("evt-4", graph["events"])

        # Verify LS state captured
        self.assertEqual(graph["language_server"]["pid"], 15288)
        self.assertEqual(graph["language_server"]["ports"], [53740])
        self.assertEqual(graph["language_server"]["sessionId"], "session-abc")

        # Verify session mapping
        self.assertEqual(graph["session_mapping"]["sessionId"], "session-abc")

        # Verify LS_START alone doesn't trigger partial_signal (no forensic events yet)
        self.assertEqual(snapshot1["status"], "no_activity")

        # Verify final snapshot has all events recorded
        self.assertEqual(snapshot4["graph_id"], "G_0")

    def test_empty_snapshot_reports_no_activity_for_passive_forensics(self):
        reducer = module.RuntimeCorrelationReducer()

        snapshot = reducer.current_snapshot()

        self.assertEqual(snapshot["graph_id"], "G_0")
        self.assertEqual(snapshot["events"], [])
        self.assertEqual(snapshot["correlation"], {
            "sessionId_clusters": [],
            "cascade_chain_detected": False,
            "evidenceSummary": {},
        })
        self.assertEqual(snapshot["status"], "no_activity")
        self.assertEqual(snapshot["reason"], "no CDP/IPC/WS cascade signals observed")

    def test_session_propagation_event_populates_partial_signal_forensic_snapshot(self):
        reducer = module.RuntimeCorrelationReducer()

        reducer.apply_event(
            {
                "event_id": "evt-1",
                "event_type": "LS_START",
                "observed_at": "2026-05-02T12:00:00Z",
                "source_stream": "ls_log",
                "payload": {"ls_pid": 15288, "ports": [53740], "sessionId": "session-1"},
                "evidence": {"log_line": "LS started pid=15288 session=session-1"},
                "graph_hint": {"sessionId": "session-1"},
            }
        )
        snapshot = reducer.apply_event(
            {
                "event_id": "evt-2",
                "event_type": "SESSION_ID_PROPAGATION",
                "observed_at": "2026-05-02T12:00:01Z",
                "source_stream": "extension_log",
                "payload": {"from": "LS", "to": "ExtensionHost", "sessionId": "session-1"},
                "evidence": {"log_line": "propagated session-1 from LS to ExtensionHost"},
                "graph_hint": {"sessionId": "session-1"},
            }
        )

        self.assertEqual(snapshot["status"], "partial_signal")
        self.assertEqual(snapshot["correlation"], {
            "sessionId_clusters": [["session-1", "LS", "ExtensionHost"]],
            "cascade_chain_detected": False,
            "evidenceSummary": {},
        })
        self.assertEqual(snapshot["events"], [
            {
                "type": "IPC",
                "name": "SESSION_ID_PROPAGATION",
                "timestamp": "2026-05-02T12:00:01Z",
                "pid": 15288,
                "direction": "upstream",
                "metadata": {
                    "sessionId": "session-1",
                    "traceCount": 0,
                },
            }
        ])

    def test_observed_cascade_chain_elevates_snapshot_to_observing(self):
        reducer = module.RuntimeCorrelationReducer()

        reducer.apply_event(
            {
                "event_id": "evt-1",
                "event_type": "LS_START",
                "observed_at": "2026-05-02T12:00:00Z",
                "source_stream": "ls_log",
                "payload": {"ls_pid": 15288, "ports": [53740], "sessionId": "session-9"},
                "evidence": {"log_line": "LS started pid=15288 session=session-9"},
                "graph_hint": {"sessionId": "session-9"},
            }
        )
        reducer.apply_event(
            {
                "event_id": "evt-2",
                "event_type": "CONNECT_HTTP_ESTABLISHED",
                "observed_at": "2026-05-02T12:00:01Z",
                "source_stream": "ls_log",
                "payload": {"src": "LS", "dst": "ExtensionHost"},
                "evidence": {"log_line": "http established LS -> ExtensionHost"},
                "graph_hint": {},
            }
        )
        reducer.apply_event(
            {
                "event_id": "evt-3",
                "event_type": "START_CASCADE",
                "observed_at": "2026-05-02T12:00:02Z",
                "source_stream": "runtime_jsonl",
                "payload": {"sessionId": "session-9"},
                "evidence": {"capture_offset": 21},
                "graph_hint": {"sessionId": "session-9"},
            }
        )
        reducer.apply_event(
            {
                "event_id": "evt-4",
                "event_type": "SEND_USER_CASCADE_MESSAGE",
                "observed_at": "2026-05-02T12:00:03Z",
                "source_stream": "runtime_jsonl",
                "payload": {"sessionId": "session-9"},
                "evidence": {"capture_offset": 22},
                "graph_hint": {"sessionId": "session-9"},
            }
        )
        snapshot = reducer.apply_event(
            {
                "event_id": "evt-5",
                "event_type": "TRACE_COUNT_DELTA",
                "observed_at": "2026-05-02T12:00:04Z",
                "source_stream": "runtime_jsonl",
                "payload": {"delta": 1},
                "evidence": {"capture_offset": 23},
                "graph_hint": {},
            }
        )

        self.assertEqual(snapshot["status"], "observing")
        self.assertEqual(snapshot["correlation"], {
            "sessionId_clusters": [],
            "cascade_chain_detected": True,
            "evidenceSummary": {},
        })
        self.assertEqual(snapshot["events"], [
            {
                "type": "HTTP",
                "name": "CONNECT_HTTP_ESTABLISHED",
                "timestamp": "2026-05-02T12:00:01Z",
                "pid": 15288,
                "direction": "upstream",
                "metadata": {
                    "sessionId": "session-9",
                    "traceCount": 1,
                },
            },
            {
                "type": "IPC",
                "name": "START_CASCADE",
                "timestamp": "2026-05-02T12:00:02Z",
                "pid": 15288,
                "direction": "upstream",
                "metadata": {
                    "sessionId": "session-9",
                    "traceCount": 1,
                },
                "sourcePath": None,
                "evidenceSource": None,
            },
            {
                "type": "IPC",
                "name": "SEND_USER_CASCADE_MESSAGE",
                "timestamp": "2026-05-02T12:00:03Z",
                "pid": 15288,
                "direction": "upstream",
                "metadata": {
                    "sessionId": "session-9",
                    "traceCount": 1,
                },
                "sourcePath": None,
                "evidenceSource": None,
            },
            {
                "type": "TRACE",
                "name": "TRACE_COUNT_DELTA",
                "timestamp": "2026-05-02T12:00:04Z",
                "pid": 15288,
                "direction": "internal",
                "metadata": {
                    "sessionId": "session-9",
                    "traceCount": 1,
                    "traceDelta": 1,
                },
                "sourcePath": None,
                "evidenceSource": None,
            },
        ])

    def test_cdp_network_response_is_projected_as_passive_http_event(self):
        reducer = module.RuntimeCorrelationReducer()

        reducer.apply_event(
            {
                "event_id": "evt-1",
                "event_type": "LS_START",
                "observed_at": "2026-05-02T12:00:00Z",
                "source_stream": "ls_log",
                "payload": {"ls_pid": 15288, "ports": [53740], "sessionId": "session-11"},
                "evidence": {"log_line": "LS started pid=15288 session=session-11"},
                "graph_hint": {"sessionId": "session-11"},
            }
        )
        snapshot = reducer.apply_event(
            {
                "event_id": "evt-2",
                "event_type": "CDP_NETWORK_RESPONSE_RECEIVED",
                "observed_at": "2026-05-02T12:00:01Z",
                "source_stream": "cdp_trace",
                "payload": {
                    "requestId": "req-1",
                    "url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
                    "status": 200,
                    "sessionId": "session-11",
                },
                "evidence": {"method": "Network.responseReceived"},
                "graph_hint": {"sessionId": "session-11"},
            }
        )

        self.assertEqual(snapshot["status"], "partial_signal")
        self.assertEqual(snapshot["events"], [
            {
                "type": "HTTP",
                "name": "CDP_NETWORK_RESPONSE_RECEIVED",
                "timestamp": "2026-05-02T12:00:01Z",
                "pid": 15288,
                "direction": "downstream",
                "metadata": {
                    "sessionId": "session-11",
                    "traceCount": 0,
                    "status": 200,
                    "url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
                },
            }
        ])

    def test_cdp_websocket_created_is_projected_as_passive_ws_event(self):
        reducer = module.RuntimeCorrelationReducer()

        reducer.apply_event(
            {
                "event_id": "evt-1",
                "event_type": "LS_START",
                "observed_at": "2026-05-02T12:00:00Z",
                "source_stream": "ls_log",
                "payload": {"ls_pid": 15288, "ports": [53740], "sessionId": "session-12"},
                "evidence": {"log_line": "LS started pid=15288 session=session-12"},
                "graph_hint": {"sessionId": "session-12"},
            }
        )
        snapshot = reducer.apply_event(
            {
                "event_id": "evt-2",
                "event_type": "CDP_WEBSOCKET_CREATED",
                "observed_at": "2026-05-02T12:00:01Z",
                "source_stream": "cdp_trace",
                "payload": {
                    "requestId": "ws-1",
                    "url": "ws://127.0.0.1:53740/socket",
                    "sessionId": "session-12",
                },
                "evidence": {"method": "Network.webSocketCreated"},
                "graph_hint": {"sessionId": "session-12"},
            }
        )

        self.assertEqual(snapshot["status"], "partial_signal")
        self.assertEqual(snapshot["events"], [
            {
                "type": "WS",
                "name": "CDP_WEBSOCKET_CREATED",
                "timestamp": "2026-05-02T12:00:01Z",
                "pid": 15288,
                "direction": "upstream",
                "metadata": {
                    "sessionId": "session-12",
                    "traceCount": 0,
                    "url": "ws://127.0.0.1:53740/socket",
                },
            }
        ])

    def test_cdp_network_request_is_projected_as_passive_http_event(self):
        reducer = module.RuntimeCorrelationReducer()

        reducer.apply_event(
            {
                "event_id": "evt-1",
                "event_type": "LS_START",
                "observed_at": "2026-05-02T12:00:00Z",
                "source_stream": "ls_log",
                "payload": {"ls_pid": 15288, "ports": [53740], "sessionId": "session-13"},
                "evidence": {"log_line": "LS started pid=15288 session=session-13"},
                "graph_hint": {"sessionId": "session-13"},
            }
        )
        snapshot = reducer.apply_event(
            {
                "event_id": "evt-2",
                "event_type": "CDP_NETWORK_REQUEST_WILL_BE_SENT",
                "observed_at": "2026-05-02T12:00:01Z",
                "source_stream": "cdp_trace",
                "payload": {
                    "requestId": "req-live-1",
                    "url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
                    "sessionId": "session-13",
                },
                "evidence": {"method": "Network.requestWillBeSent"},
                "graph_hint": {"sessionId": "session-13"},
            }
        )

        self.assertEqual(snapshot["status"], "partial_signal")
        self.assertEqual(snapshot["events"], [
            {
                "type": "HTTP",
                "name": "CDP_NETWORK_REQUEST_WILL_BE_SENT",
                "timestamp": "2026-05-02T12:00:01Z",
                "pid": 15288,
                "direction": "upstream",
                "metadata": {
                    "sessionId": "session-13",
                    "traceCount": 0,
                    "url": "http://127.0.0.1:53740/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
                },
            }
        ])

    def test_session_propagation_event_creates_strict_edge(self):
        reducer = module.RuntimeCorrelationReducer()

        reducer.apply_event(
            {
                "event_id": "evt-1",
                "event_type": "LS_START",
                "observed_at": "2026-05-02T12:00:00Z",
                "source_stream": "ls_log",
                "payload": {"ls_pid": 15288, "ports": [53740], "sessionId": "session-1"},
                "evidence": {"log_line": "LS started pid=15288 session=session-1"},
                "graph_hint": {"sessionId": "session-1"},
            }
        )
        snapshot = reducer.apply_event(
            {
                "event_id": "evt-2",
                "event_type": "SESSION_ID_PROPAGATION",
                "observed_at": "2026-05-02T12:00:01Z",
                "source_stream": "extension_log",
                "payload": {"from": "LS", "to": "ExtensionHost", "sessionId": "session-1"},
                "evidence": {"log_line": "propagated session-1 from LS to ExtensionHost"},
                "graph_hint": {"sessionId": "session-1"},
            }
        )

        self.assertEqual(snapshot["graph_id"], "G_0")
        self.assertEqual(snapshot["session_mapping"]["sessionId"], "session-1")
        self.assertEqual(snapshot["session_mapping"]["propagation_path"], ["LS", "ExtensionHost"])
        self.assertEqual(snapshot["edges"], [
            {
                "from": "LS",
                "to": "ExtensionHost",
                "kind": "propagates_session_to",
                "evidence_type": "SESSION_ID_PROPAGATION",
                "evidence_event_ids": ["evt-2"],
                "observed_at": "2026-05-02T12:00:01Z",
            }
        ])

    def test_start_cascade_is_retained_as_unlinked_evidence_without_propagation_or_connection(self):
        reducer = module.RuntimeCorrelationReducer()

        snapshot = reducer.apply_event(
            {
                "event_id": "evt-1",
                "event_type": "START_CASCADE",
                "observed_at": "2026-05-02T12:00:00Z",
                "source_stream": "runtime_jsonl",
                "payload": {"sessionId": "session-2"},
                "evidence": {"capture_offset": 10},
                "graph_hint": {"sessionId": "session-2"},
            }
        )

        self.assertEqual(snapshot["graph_id"], "G_0")
        self.assertEqual(snapshot["edges"], [])
        self.assertEqual(snapshot["cascade_flow"], {
            "startCascade": True,
            "sendUserCascadeMessage": False,
            "traceCount": 0,
        })
        self.assertEqual(snapshot["session_mapping"], {
            "sessionId": "session-2",
            "propagation_path": [],
        })
        self.assertEqual(snapshot["llm_state"]["confidence"], "low")
        self.assertEqual(snapshot["llm_state"]["reason"], "StartCascade observed without a justified runtime link")
        self.assertEqual(reducer.current_graph()["unlinked_evidence"], [
            {
                "event_id": "evt-1",
                "event_type": "START_CASCADE",
            }
        ])

    def test_ls_pid_change_rotates_graph_and_archives_prior_state(self):
        reducer = module.RuntimeCorrelationReducer()

        reducer.apply_event(
            {
                "event_id": "evt-1",
                "event_type": "LS_START",
                "observed_at": "2026-05-02T12:00:00Z",
                "source_stream": "ls_log",
                "payload": {"ls_pid": 1001, "ports": [53740], "sessionId": "session-1"},
                "evidence": {"log_line": "LS started pid=1001"},
                "graph_hint": {"sessionId": "session-1"},
            }
        )
        reducer.apply_event(
            {
                "event_id": "evt-2",
                "event_type": "START_CASCADE",
                "observed_at": "2026-05-02T12:00:01Z",
                "source_stream": "runtime_jsonl",
                "payload": {"sessionId": "session-1"},
                "evidence": {"capture_offset": 1},
                "graph_hint": {"sessionId": "session-1"},
            }
        )

        snapshot = reducer.apply_event(
            {
                "event_id": "evt-3",
                "event_type": "LS_START",
                "observed_at": "2026-05-02T12:00:02Z",
                "source_stream": "ls_log",
                "payload": {"ls_pid": 2002, "ports": [53741], "sessionId": "session-1"},
                "evidence": {"log_line": "LS started pid=2002"},
                "graph_hint": {"sessionId": "session-1"},
            }
        )

        self.assertEqual(snapshot["graph_id"], "G_1")
        self.assertEqual(snapshot["language_server"], {
            "pid": 2002,
            "ports": [53741],
            "sessionId": "session-1",
        })
        archived = reducer.archived_graphs()
        self.assertEqual(len(archived), 1)
        self.assertEqual(archived[0]["graph_id"], "G_0")
        self.assertEqual(archived[0]["reset_reason"], "LS PID changed")
        self.assertEqual(archived[0]["cascade_flow"], {
            "startCascade": True,
            "sendUserCascadeMessage": False,
            "traceCount": 0,
        })

    def test_port_rebinding_rotates_graph_without_forward_merging_unlinked_evidence(self):
        reducer = module.RuntimeCorrelationReducer()

        reducer.apply_event(
            {
                "event_id": "evt-1",
                "event_type": "PORT_BOUND",
                "observed_at": "2026-05-02T12:00:00Z",
                "source_stream": "port_binding",
                "payload": {"owner_pid": 1001, "port": 53740},
                "evidence": {"binding": "1001 owns 53740"},
                "graph_hint": {},
            }
        )
        reducer.apply_event(
            {
                "event_id": "evt-2",
                "event_type": "START_CASCADE",
                "observed_at": "2026-05-02T12:00:01Z",
                "source_stream": "runtime_jsonl",
                "payload": {"sessionId": "session-1"},
                "evidence": {"capture_offset": 1},
                "graph_hint": {"sessionId": "session-1"},
            }
        )

        snapshot = reducer.apply_event(
            {
                "event_id": "evt-3",
                "event_type": "PORT_BOUND",
                "observed_at": "2026-05-02T12:00:02Z",
                "source_stream": "port_binding",
                "payload": {"owner_pid": 2002, "port": 53740},
                "evidence": {"binding": "2002 owns 53740"},
                "graph_hint": {},
            }
        )

        self.assertEqual(snapshot["graph_id"], "G_1")
        self.assertEqual(snapshot["cascade_flow"], {
            "startCascade": False,
            "sendUserCascadeMessage": False,
            "traceCount": 0,
        })
        self.assertEqual(reducer.current_graph()["unlinked_evidence"], [])
        archived = reducer.archived_graphs()
        self.assertEqual(archived[0]["unlinked_evidence"], [
            {"event_id": "evt-2", "event_type": "START_CASCADE"}
        ])
        self.assertEqual(archived[0]["reset_reason"], "port rebinding occurred")

    def test_connect_http_event_raises_confidence_when_runtime_edge_is_justified(self):
        reducer = module.RuntimeCorrelationReducer()

        reducer.apply_event(
            {
                "event_id": "evt-1",
                "event_type": "START_CASCADE",
                "observed_at": "2026-05-02T12:00:00Z",
                "source_stream": "runtime_jsonl",
                "payload": {"sessionId": "session-3"},
                "evidence": {"capture_offset": 20},
                "graph_hint": {"sessionId": "session-3"},
            }
        )
        snapshot = reducer.apply_event(
            {
                "event_id": "evt-2",
                "event_type": "CONNECT_HTTP_ESTABLISHED",
                "observed_at": "2026-05-02T12:00:01Z",
                "source_stream": "ls_log",
                "payload": {"src": "LS", "dst": "ExtensionHost"},
                "evidence": {"log_line": "http established LS -> ExtensionHost"},
                "graph_hint": {},
            }
        )

        self.assertEqual(snapshot["edges"], [
            {
                "from": "LS",
                "to": "ExtensionHost",
                "kind": "connects_to",
                "evidence_type": "CONNECT_HTTP_ESTABLISHED",
                "evidence_event_ids": ["evt-2"],
                "observed_at": "2026-05-02T12:00:01Z",
            }
        ])
        self.assertEqual(snapshot["llm_state"], {
            "active": True,
            "confidence": "medium",
            "reason": "StartCascade observed with at least one justified runtime edge",
        })

    def test_trace_count_delta_updates_snapshot_without_creating_speculative_edges(self):
        reducer = module.RuntimeCorrelationReducer()

        snapshot = reducer.apply_event(
            {
                "event_id": "evt-1",
                "event_type": "TRACE_COUNT_DELTA",
                "observed_at": "2026-05-02T12:00:00Z",
                "source_stream": "runtime_jsonl",
                "payload": {"delta": 3},
                "evidence": {"capture_offset": 30},
                "graph_hint": {},
            }
        )

        self.assertEqual(snapshot["cascade_flow"], {
            "startCascade": False,
            "sendUserCascadeMessage": False,
            "traceCount": 3,
        })
        self.assertEqual(snapshot["edges"], [])
        self.assertEqual(snapshot["events"], [
            {
                "type": "TRACE",
                "name": "TRACE_COUNT_DELTA",
                "timestamp": "2026-05-02T12:00:00Z",
                "pid": None,
                "direction": "internal",
                "metadata": {
                    "sessionId": None,
                    "traceCount": 3,
                    "traceDelta": 3,
                },
                "sourcePath": None,
                "evidenceSource": None,
            }
        ])
        self.assertEqual(snapshot["correlation"], {
            "sessionId_clusters": [],
            "cascade_chain_detected": False,
            "evidenceSummary": {},
        })
        self.assertEqual(snapshot["llm_state"], {
            "active": False,
            "confidence": "low",
            "reason": "No accepted runtime activity",
        })

    def test_passive_cascade_events_propagate_evidence_provenance_into_snapshot(self):
        reducer = module.RuntimeCorrelationReducer()

        snapshot = reducer.apply_event(
            {
                "event_id": "evt-1",
                "event_type": "SEND_USER_CASCADE_MESSAGE",
                "observed_at": "2026-05-02T12:00:03Z",
                "source_stream": "runtime_jsonl",
                "payload": {
                    "sessionId": "session-live-1",
                    "sourcePath": r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\exthost\\codeium.windsurf\\Windsurf.log",
                    "evidenceSource": {
                        "kind": "live_runtime",
                        "epoch": "20260502T150751",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                },
                "evidence": {"capture_offset": 22},
                "graph_hint": {"sessionId": "session-live-1"},
            }
        )

        self.assertEqual(snapshot["correlation"]["evidenceSummary"], {
            "live_runtime": {
                "count": 1,
                "paths": [r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\exthost\\codeium.windsurf\\Windsurf.log"],
                "reasons": ["path is under a Windsurf logs epoch directory"],
            }
        })
        self.assertEqual(snapshot["events"], [
            {
                "type": "IPC",
                "name": "SEND_USER_CASCADE_MESSAGE",
                "timestamp": "2026-05-02T12:00:03Z",
                "pid": None,
                "direction": "upstream",
                "metadata": {
                    "sessionId": "session-live-1",
                    "traceCount": 0,
                },
                "sourcePath": r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\exthost\\codeium.windsurf\\Windsurf.log",
                "evidenceSource": {
                    "kind": "live_runtime",
                    "epoch": "20260502T150751",
                    "reason": "path is under a Windsurf logs epoch directory",
                },
            }
        ])

    def test_observer_snapshot_adapter_converts_events_for_reducer_ingestion(self):
        observer_snapshot = {
            "status": "observed",
            "events": [
                {
                    "type": "START_CASCADE",
                    "timestamp": "2026-05-02T12:00:00Z",
                    "sessionId": "session-obs-1",
                    "csrfToken": "csrf-obs-1",
                    "traceCount": 0,
                    "surface": "renderer",
                    "pid": 4001,
                    "source": "LanguageServerFetchRequest",
                    "sourcePath": r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\renderer.jsonl",
                    "evidenceSource": {
                        "kind": "live_runtime",
                        "epoch": "20260502T150751",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                },
                {
                    "type": "TRACE_COUNT_DELTA",
                    "timestamp": "2026-05-02T12:00:01Z",
                    "sessionId": "session-obs-1",
                    "traceCount": 2,
                    "traceDelta": 2,
                    "surface": "runtime_jsonl",
                    "pid": 4001,
                    "source": "TRACE_COUNT_DELTA",
                    "sourcePath": r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\runtime.jsonl",
                    "evidenceSource": {
                        "kind": "live_runtime",
                        "epoch": "20260502T150751",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                },
                {
                    "type": "SEND_USER_CASCADE_MESSAGE",
                    "timestamp": "2026-05-02T12:00:02Z",
                    "sessionId": "session-obs-1",
                    "csrfToken": "csrf-obs-1",
                    "traceCount": 2,
                    "surface": "renderer",
                    "pid": 4001,
                    "source": "promise-client-call",
                    "sourcePath": r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\renderer.jsonl",
                    "evidenceSource": {
                        "kind": "live_runtime",
                        "epoch": "20260502T150751",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                    "precededBy": {
                        "type": "START_CASCADE",
                        "timestamp": "2026-05-02T12:00:00Z",
                        "sessionId": "session-obs-1",
                    },
                },
            ],
        }

        normalized_events = module.observer_snapshot_to_reducer_events(observer_snapshot, event_id_prefix="obs")

        self.assertEqual(normalized_events, [
            {
                "event_id": "obs-1",
                "event_type": "START_CASCADE",
                "observed_at": "2026-05-02T12:00:00Z",
                "source_stream": "passive_observer",
                "payload": {
                    "sessionId": "session-obs-1",
                    "csrfToken": "csrf-obs-1",
                    "traceCount": 0,
                    "surface": "renderer",
                    "pid": 4001,
                    "sourcePath": r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\renderer.jsonl",
                    "evidenceSource": {
                        "kind": "live_runtime",
                        "epoch": "20260502T150751",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                },
                "evidence": {
                    "observer_source": "LanguageServerFetchRequest",
                },
                "graph_hint": {
                    "sessionId": "session-obs-1",
                },
            },
            {
                "event_id": "obs-2",
                "event_type": "TRACE_COUNT_DELTA",
                "observed_at": "2026-05-02T12:00:01Z",
                "source_stream": "passive_observer",
                "payload": {
                    "sessionId": "session-obs-1",
                    "traceCount": 2,
                    "delta": 2,
                    "surface": "runtime_jsonl",
                    "pid": 4001,
                    "sourcePath": r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\runtime.jsonl",
                    "evidenceSource": {
                        "kind": "live_runtime",
                        "epoch": "20260502T150751",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                },
                "evidence": {
                    "observer_source": "TRACE_COUNT_DELTA",
                },
                "graph_hint": {
                    "sessionId": "session-obs-1",
                },
            },
            {
                "event_id": "obs-3",
                "event_type": "SEND_USER_CASCADE_MESSAGE",
                "observed_at": "2026-05-02T12:00:02Z",
                "source_stream": "passive_observer",
                "payload": {
                    "sessionId": "session-obs-1",
                    "csrfToken": "csrf-obs-1",
                    "traceCount": 2,
                    "surface": "renderer",
                    "pid": 4001,
                    "sourcePath": r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\renderer.jsonl",
                    "evidenceSource": {
                        "kind": "live_runtime",
                        "epoch": "20260502T150751",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                },
                "evidence": {
                    "observer_source": "promise-client-call",
                    "precededBy": {
                        "type": "START_CASCADE",
                        "timestamp": "2026-05-02T12:00:00Z",
                        "sessionId": "session-obs-1",
                    },
                },
                "graph_hint": {
                    "sessionId": "session-obs-1",
                },
            },
        ])

    def test_observer_snapshot_adapter_feeds_reducer_and_preserves_live_provenance(self):
        reducer = module.RuntimeCorrelationReducer()
        observer_snapshot = {
            "status": "observed",
            "events": [
                {
                    "type": "START_CASCADE",
                    "timestamp": "2026-05-02T12:00:00Z",
                    "sessionId": "session-obs-2",
                    "traceCount": 0,
                    "surface": "renderer",
                    "pid": 5001,
                    "source": "LanguageServerFetchRequest",
                    "sourcePath": r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\renderer.jsonl",
                    "evidenceSource": {
                        "kind": "live_runtime",
                        "epoch": "20260502T150751",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                },
                {
                    "type": "SEND_USER_CASCADE_MESSAGE",
                    "timestamp": "2026-05-02T12:00:02Z",
                    "sessionId": "session-obs-2",
                    "traceCount": 0,
                    "surface": "renderer",
                    "pid": 5001,
                    "source": "promise-client-call",
                    "sourcePath": r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\renderer.jsonl",
                    "evidenceSource": {
                        "kind": "live_runtime",
                        "epoch": "20260502T150751",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                },
                {
                    "type": "TRACE_COUNT_DELTA",
                    "timestamp": "2026-05-02T12:00:03Z",
                    "sessionId": "session-obs-2",
                    "traceCount": 1,
                    "traceDelta": 1,
                    "surface": "runtime_jsonl",
                    "pid": 5001,
                    "source": "TRACE_COUNT_DELTA",
                    "sourcePath": r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\runtime.jsonl",
                    "evidenceSource": {
                        "kind": "live_runtime",
                        "epoch": "20260502T150751",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                },
            ],
        }

        snapshot = None
        for event in module.observer_snapshot_to_reducer_events(observer_snapshot, event_id_prefix="pipe"):
            snapshot = reducer.apply_event(event)

        assert snapshot is not None
        self.assertEqual(snapshot["status"], "observing")
        self.assertEqual(snapshot["correlation"]["evidenceSummary"], {
            "live_runtime": {
                "count": 3,
                "paths": [
                    r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\renderer.jsonl",
                    r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T150751\\window1\\runtime.jsonl",
                ],
                "reasons": ["path is under a Windsurf logs epoch directory"],
            }
        })
        self.assertEqual([event["name"] for event in snapshot["events"]], [
            "START_CASCADE",
            "SEND_USER_CASCADE_MESSAGE",
            "TRACE_COUNT_DELTA",
        ])


if __name__ == "__main__":
    unittest.main()
