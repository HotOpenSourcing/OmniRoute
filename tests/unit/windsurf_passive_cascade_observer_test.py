import importlib.util
import pathlib
import tempfile
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "windsurf_passive_cascade_observer.py"
spec = importlib.util.spec_from_file_location("windsurf_passive_cascade_observer", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class WindsurfPassiveCascadeObserverTests(unittest.TestCase):
    def test_reads_plaintext_runtime_log_and_emits_ls_start_event(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = pathlib.Path(tmpdir) / "Windsurf.log"
            file_path.write_text(
                "2026-05-03 14:26:16.569 [info] Starting language server process with pid 24516\n",
                encoding="utf-8",
            )

            records = module.read_plaintext_runtime_records(file_path)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["event"], "PlaintextRuntimeBootstrap")
        self.assertEqual(records[0]["type"], "LS_START")
        self.assertEqual(records[0]["timestamp"], "2026-05-03T14:26:16.569Z")
        self.assertEqual(records[0]["surface"], "live_runtime_log")
        self.assertEqual(records[0]["metadata"]["pid"], 24516)

    def test_reads_exthost_log_and_emits_submit_proximate_signal(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = pathlib.Path(tmpdir) / "exthost.log"
            file_path.write_text(
                "2026-05-03 14:52:47.215 [info] ExtensionService#_doActivateExtension codeium.windsurf, startup: false, activationEvent: '*'\n",
                encoding="utf-8",
            )

            records = module.read_plaintext_runtime_records(file_path)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["event"], "PlaintextRuntimeBootstrap")
        self.assertEqual(records[0]["type"], "SUBMIT_PROXIMATE_SIGNAL")
        self.assertEqual(records[0]["timestamp"], "2026-05-03T14:52:47.215Z")
        self.assertEqual(records[0]["surface"], "live_runtime_log")
        self.assertEqual(records[0]["metadata"]["reason"], "codeium.windsurf extension activation")

    def test_read_plaintext_log_records_extracts_start_cascade_with_adjacent_session_id(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = pathlib.Path(tmpdir) / "Windsurf.log"
            file_path.write_text(
                "\n".join([
                    "2026-05-02 18:53:33.494 [info] session_id=session-live-1",
                    "2026-05-02 18:53:33.495 [info] call /exa.language_server_pb.LanguageServerService/StartCascade",
                ]),
                encoding="utf-8",
            )

            records = module.read_plaintext_log_records(file_path)

        self.assertEqual(records, [
            {
                "event": "PlaintextLogRpcCall",
                "timestamp": "2026-05-02T18:53:33.495Z",
                "surface": "live_runtime_log",
                "pid": None,
                "rpc": {
                    "serviceTypeName": "exa.language_server_pb.LanguageServerService",
                    "serviceMethodName": "StartCascade",
                },
                "metadata": {
                    "sessionId": "session-live-1",
                },
            }
        ])

    def test_read_plaintext_log_records_extracts_send_user_cascade_message_with_adjacent_session_id(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = pathlib.Path(tmpdir) / "Windsurf.log"
            file_path.write_text(
                "\n".join([
                    "2026-05-02 18:53:34.100 [info] session_id=session-live-2",
                    "2026-05-02 18:53:34.101 [info] call /exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
                ]),
                encoding="utf-8",
            )

            records = module.read_plaintext_log_records(file_path)

        self.assertEqual(records, [
            {
                "event": "PlaintextLogRpcCall",
                "timestamp": "2026-05-02T18:53:34.101Z",
                "surface": "live_runtime_log",
                "pid": None,
                "rpc": {
                    "serviceTypeName": "exa.language_server_pb.LanguageServerService",
                    "serviceMethodName": "SendUserCascadeMessage",
                },
                "metadata": {
                    "sessionId": "session-live-2",
                },
            }
        ])

    def test_read_plaintext_log_records_extracts_start_cascade_without_adjacent_session_id(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = pathlib.Path(tmpdir) / "Windsurf.log"
            file_path.write_text(
                "\n".join([
                    "2026-05-02 18:53:35.200 [info] some unrelated log line",
                    "2026-05-02 18:53:35.201 [info] call /exa.language_server_pb.LanguageServerService/StartCascade",
                ]),
                encoding="utf-8",
            )

            records = module.read_plaintext_log_records(file_path)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["event"], "PlaintextLogRpcCall")
        self.assertEqual(records[0]["rpc"]["serviceMethodName"], "StartCascade")
        self.assertNotIn("metadata", records[0])

    def test_read_jsonl_records_ignores_non_json_lines(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = pathlib.Path(tmpdir) / "mixed.log"
            file_path.write_text(
                "\n".join([
                    "2026-05-02 12:54:54.411 [info] update#setState idle",
                    '{"event": "LanguageServerFetchRequest", "payload": {"sessionId": "session-1"}}',
                ]),
                encoding="utf-8",
            )

            records = module.read_jsonl_records(file_path)

        self.assertEqual(records, [
            {
                "event": "LanguageServerFetchRequest",
                "payload": {"sessionId": "session-1"},
            }
        ])

    def test_returns_waiting_status_when_no_cascade_emission_is_observed(self):
        snapshot = module.correlate_observed_events([
            {
                "timestamp": "2026-05-02T12:00:00Z",
                "event": "languageServerStarted",
                "surface": "main",
                "pid": 1001,
            }
        ])

        self.assertEqual(snapshot, {
            "status": "waiting",
            "reason": "no cascade emission detected",
            "events": [],
            "evidenceSummary": {},
        })

    def test_correlates_start_and_send_user_events_across_passive_hook_envelopes(self):
        snapshot = module.correlate_observed_events([
            {
                "timestamp": "2026-05-02T12:00:00Z",
                "pid": 2001,
                "surface": "renderer",
                "event": "LanguageServerFetchRequest",
                "traceId": "trace-1",
                "csrfToken": "csrf-123",
                "rpc": {
                    "serviceTypeName": "exa.language_server_pb.LanguageServerService",
                    "serviceMethodName": "StartCascade",
                },
                "headers": {
                    "x-codeium-csrf-token": "csrf-123",
                },
                "payload": {
                    "sessionId": "session-123",
                },
            },
            {
                "at": "2026-05-02T12:00:01Z",
                "pid": 2001,
                "surface": "renderer",
                "type": "promise-client-call",
                "payload": {
                    "traceId": "trace-1",
                    "rpc": {
                        "serviceTypeName": "exa.language_server_pb.LanguageServerService",
                        "serviceMethodName": "SendUserCascadeMessage",
                    },
                    "payload": {
                        "sessionId": "session-123",
                    },
                    "headers": {
                        "x-codeium-csrf-token": "csrf-123",
                    },
                },
            },
        ])

        self.assertEqual(snapshot["status"], "observed")
        self.assertEqual(snapshot["events"][0], {
            "type": "START_CASCADE",
            "timestamp": "2026-05-02T12:00:00Z",
            "sessionId": "session-123",
            "csrfToken": "csrf-123",
            "traceCount": 0,
            "surface": "renderer",
            "pid": 2001,
            "source": "LanguageServerFetchRequest",
            "sourcePath": "unknown",
            "evidenceSource": {
                "kind": "workspace_artifact",
                "epoch": None,
                "reason": "path is not under a live Windsurf logs epoch and does not match synthetic/reference markers",
            },
        })
        self.assertEqual(snapshot["events"][1], {
            "type": "SEND_USER_CASCADE_MESSAGE",
            "timestamp": "2026-05-02T12:00:01Z",
            "sessionId": "session-123",
            "csrfToken": "csrf-123",
            "traceCount": 0,
            "surface": "renderer",
            "pid": 2001,
            "source": "promise-client-call",
            "sourcePath": "unknown",
            "evidenceSource": {
                "kind": "workspace_artifact",
                "epoch": None,
                "reason": "path is not under a live Windsurf logs epoch and does not match synthetic/reference markers",
            },
            "precededBy": {
                "type": "START_CASCADE",
                "timestamp": "2026-05-02T12:00:00Z",
                "sessionId": "session-123",
            },
        })
        self.assertEqual(snapshot["evidenceSummary"], {
            "workspace_artifact": {
                "count": 2,
                "paths": ["unknown"],
                "reasons": ["path is not under a live Windsurf logs epoch and does not match synthetic/reference markers"],
            }
        })

    def test_trace_count_delta_is_emitted_after_observed_cascade_activity(self):
        snapshot = module.correlate_observed_events([
            {
                "timestamp": "2026-05-02T12:00:00Z",
                "pid": 3001,
                "surface": "renderer",
                "event": "LanguageServerRpcCall",
                "traceId": "trace-2",
                "rpc": {
                    "serviceTypeName": "exa.language_server_pb.LanguageServerService",
                    "serviceMethodName": "StartCascade",
                },
                "payload": {
                    "sessionId": "session-xyz",
                },
            },
            {
                "observed_at": "2026-05-02T12:00:01Z",
                "pid": 3001,
                "surface": "runtime_jsonl",
                "type": "TRACE_COUNT_DELTA",
                "payload": {
                    "delta": 2,
                    "sessionId": "session-xyz",
                },
            },
            {
                "timestamp": "2026-05-02T12:00:02Z",
                "pid": 3001,
                "surface": "renderer",
                "event": "LanguageServerRpcCall",
                "traceId": "trace-2",
                "rpc": {
                    "serviceTypeName": "exa.language_server_pb.LanguageServerService",
                    "serviceMethodName": "SendUserCascadeMessage",
                },
                "payload": {
                    "sessionId": "session-xyz",
                },
            },
            {
                "observed_at": "2026-05-02T12:00:03Z",
                "pid": 3001,
                "surface": "runtime_jsonl",
                "type": "TRACE_COUNT_DELTA",
                "payload": {
                    "delta": 1,
                    "sessionId": "session-xyz",
                },
            },
        ])

        self.assertEqual(snapshot["status"], "observed")
        self.assertEqual(snapshot["events"][1], {
            "type": "TRACE_COUNT_DELTA",
            "timestamp": "2026-05-02T12:00:01Z",
            "sessionId": "session-xyz",
            "traceCount": 2,
            "traceDelta": 2,
            "surface": "runtime_jsonl",
            "pid": 3001,
            "source": "TRACE_COUNT_DELTA",
            "sourcePath": "unknown",
            "evidenceSource": {
                "kind": "workspace_artifact",
                "epoch": None,
                "reason": "path is not under a live Windsurf logs epoch and does not match synthetic/reference markers",
            },
        })
        self.assertEqual(snapshot["events"][2]["type"], "SEND_USER_CASCADE_MESSAGE")
        self.assertEqual(snapshot["events"][2]["traceCount"], 2)
        self.assertEqual(snapshot["events"][2]["sourcePath"], "unknown")
        self.assertEqual(snapshot["events"][2]["evidenceSource"]["kind"], "workspace_artifact")
        self.assertEqual(snapshot["events"][3], {
            "type": "TRACE_COUNT_DELTA",
            "timestamp": "2026-05-02T12:00:03Z",
            "sessionId": "session-xyz",
            "traceCount": 3,
            "traceDelta": 1,
            "surface": "runtime_jsonl",
            "pid": 3001,
            "source": "TRACE_COUNT_DELTA",
            "sourcePath": "unknown",
            "evidenceSource": {
                "kind": "workspace_artifact",
                "epoch": None,
                "reason": "path is not under a live Windsurf logs epoch and does not match synthetic/reference markers",
            },
        })

    def test_classify_evidence_source_distinguishes_live_and_synthetic_paths(self):
        self.assertEqual(
            module.classify_evidence_source(r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T163035\\renderer.jsonl"),
            {
                "kind": "live_runtime",
                "epoch": "20260502T163035",
                "reason": "path is under a Windsurf logs epoch directory",
            },
        )
        self.assertEqual(
            module.classify_evidence_source(r"C:\\Users\\amine\\OmniRoute\\tmp\\fixture.jsonl"),
            {
                "kind": "synthetic_reference",
                "epoch": None,
                "reason": "path matches tmp/scratch/docs markers associated with replay, matrix, or reference artifacts",
            },
        )

    def test_prioritize_observer_paths_prefers_live_runtime_then_workspace_then_synthetic(self):
        ordered = module.prioritize_observer_paths([
            pathlib.Path(r"C:\\Users\\amine\\OmniRoute\\tmp\\fixture.jsonl"),
            pathlib.Path(r"C:\\Users\\amine\\OmniRoute\\windsurf-model-runtime-capture.jsonl"),
            pathlib.Path(r"C:\\Users\\amine\\AppData\\Roaming\\Windsurf\\logs\\20260502T163035\\renderer.jsonl"),
        ])

        self.assertEqual(
            [str(path) for path in ordered],
            [
                r"C:\Users\amine\AppData\Roaming\Windsurf\logs\20260502T163035\renderer.jsonl",
                r"C:\Users\amine\OmniRoute\windsurf-model-runtime-capture.jsonl",
                r"C:\Users\amine\OmniRoute\tmp\fixture.jsonl",
            ],
        )

    def test_build_debug_sources_report_describes_discovered_and_retained_paths(self):
        original_discover_live_runtime_paths = module.discover_live_runtime_paths
        try:
            module.discover_live_runtime_paths = lambda: [
                pathlib.Path(r"C:\Users\amine\AppData\Roaming\Windsurf\logs\20260502T163035\renderer.jsonl"),
            ]
            report = module.build_debug_sources_report([
                pathlib.Path(r"C:\Users\amine\OmniRoute\windsurf-model-runtime-capture.jsonl"),
                pathlib.Path(r"C:\Users\amine\OmniRoute\tmp\fixture.jsonl"),
            ])
        finally:
            module.discover_live_runtime_paths = original_discover_live_runtime_paths

        self.assertEqual(report, {
            "discoveredLiveRuntimePaths": [
                {
                    "path": r"C:\Users\amine\AppData\Roaming\Windsurf\logs\20260502T163035\renderer.jsonl",
                    "classification": {
                        "kind": "live_runtime",
                        "epoch": "20260502T163035",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                }
            ],
            "providedPaths": [
                {
                    "path": r"C:\Users\amine\OmniRoute\windsurf-model-runtime-capture.jsonl",
                    "classification": {
                        "kind": "workspace_artifact",
                        "epoch": None,
                        "reason": "path is not under a live Windsurf logs epoch and does not match synthetic/reference markers",
                    },
                },
                {
                    "path": r"C:\Users\amine\OmniRoute\tmp\fixture.jsonl",
                    "classification": {
                        "kind": "synthetic_reference",
                        "epoch": None,
                        "reason": "path matches tmp/scratch/docs markers associated with replay, matrix, or reference artifacts",
                    },
                },
            ],
            "retainedPaths": [
                {
                    "path": r"C:\Users\amine\AppData\Roaming\Windsurf\logs\20260502T163035\renderer.jsonl",
                    "classification": {
                        "kind": "live_runtime",
                        "epoch": "20260502T163035",
                        "reason": "path is under a Windsurf logs epoch directory",
                    },
                },
                {
                    "path": r"C:\Users\amine\OmniRoute\windsurf-model-runtime-capture.jsonl",
                    "classification": {
                        "kind": "workspace_artifact",
                        "epoch": None,
                        "reason": "path is not under a live Windsurf logs epoch and does not match synthetic/reference markers",
                    },
                },
                {
                    "path": r"C:\Users\amine\OmniRoute\tmp\fixture.jsonl",
                    "classification": {
                        "kind": "synthetic_reference",
                        "epoch": None,
                        "reason": "path matches tmp/scratch/docs markers associated with replay, matrix, or reference artifacts",
                    },
                },
            ],
        })

    def test_observe_passive_cascade_ignores_non_jsonl_log_candidates(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = pathlib.Path(tmpdir) / "renderer.log"
            har_path = pathlib.Path(tmpdir) / "capture.har"
            log_path.write_text("[2026-05-02 17:48:18] plain text log line\n", encoding="utf-8")
            har_path.write_text(
                """
{
  "log": {
    "entries": [
      {
        "startedDateTime": "2026-05-02T17:48:18.389Z",
        "serverIPAddress": "127.0.0.1",
        "request": {
          "url": "http://r.localhost:62258/exa.language_server_pb.LanguageServerService/StartCascade",
          "headers": [
            {"name": "x-codeium-csrf-token", "value": "csrf-har-1"}
          ]
        }
      }
    ]
  }
}
                """.strip(),
                encoding="utf-8",
            )

            snapshot = module.observe_passive_cascade_from_jsonl([log_path, har_path])

        self.assertEqual(snapshot["status"], "observed")
        self.assertEqual(snapshot["events"][0]["type"], "START_CASCADE")
        self.assertEqual(snapshot["events"][0]["sourcePath"], str(har_path))

    def test_reads_har_records_and_detects_cascade_sequence(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            har_path = pathlib.Path(tmpdir) / "capture.har"
            har_path.write_text(
                """
{
  "log": {
    "entries": [
      {
        "startedDateTime": "2026-05-02T17:48:18.389Z",
        "serverIPAddress": "127.0.0.1",
        "request": {
          "url": "http://r.localhost:62258/exa.language_server_pb.LanguageServerService/StartCascade",
          "headers": [
            {"name": "x-codeium-csrf-token", "value": "csrf-har-1"}
          ],
          "postData": {
            "text": "devin-session-token$eyJhbGciOiJIUzI1NiJ9.eyJzZXNzaW9uX2lkIjoid2luZHN1cmYtc2Vzc2lvbi1hNjliYzY5NWQyN2E0NWVjYmRmNjVmYWI5MWQxODZhNiJ9.signature"
          }
        }
      },
      {
        "startedDateTime": "2026-05-02T17:48:18.503Z",
        "serverIPAddress": "127.0.0.1",
        "request": {
          "url": "http://e.localhost:62258/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
          "headers": [
            {"name": "x-codeium-csrf-token", "value": "csrf-har-1"}
          ],
          "postData": {
            "text": "devin-session-token$eyJhbGciOiJIUzI1NiJ9.eyJzZXNzaW9uX2lkIjoid2luZHN1cmYtc2Vzc2lvbi1hNjliYzY5NWQyN2E0NWVjYmRmNjVmYWI5MWQxODZhNiJ9.signature"
          }
        }
      }
    ]
  }
}
                """.strip(),
                encoding="utf-8",
            )

            snapshot = module.observe_passive_cascade_from_jsonl([har_path])

        self.assertEqual(snapshot["status"], "observed")
        self.assertEqual([event["type"] for event in snapshot["events"]], [
            "START_CASCADE",
            "SEND_USER_CASCADE_MESSAGE",
        ])
        self.assertEqual(snapshot["events"][0]["csrfToken"], "csrf-har-1")
        self.assertEqual(snapshot["events"][0]["surface"], "har")
        self.assertEqual(
            snapshot["events"][0]["sessionId"],
            "windsurf-session-a69bc695d27a45ecbdf65fab91d186a6",
        )
        self.assertEqual(snapshot["events"][1]["precededBy"], {
            "type": "START_CASCADE",
            "timestamp": "2026-05-02T17:48:18.389Z",
            "sessionId": "windsurf-session-a69bc695d27a45ecbdf65fab91d186a6",
        })
        self.assertEqual(
            snapshot["events"][1]["sessionId"],
            "windsurf-session-a69bc695d27a45ecbdf65fab91d186a6",
        )
        self.assertEqual(snapshot["events"][1]["sourcePath"], str(har_path))

    def test_does_not_fabricate_session_id_from_malformed_har_token_text(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            har_path = pathlib.Path(tmpdir) / "capture.har"
            har_path.write_text(
                """
{
  "log": {
    "entries": [
      {
        "startedDateTime": "2026-05-02T17:48:18.389Z",
        "serverIPAddress": "127.0.0.1",
        "request": {
          "url": "http://r.localhost:62258/exa.language_server_pb.LanguageServerService/StartCascade",
          "headers": [
            {"name": "x-codeium-csrf-token", "value": "csrf-har-2"}
          ],
          "postData": {
            "text": "devin-session-token$not-a-jwt"
          }
        }
      }
    ]
  }
}
                """.strip(),
                encoding="utf-8",
            )

            snapshot = module.observe_passive_cascade_from_jsonl([har_path])

        self.assertEqual(snapshot["status"], "observed")
        self.assertEqual(snapshot["events"][0]["type"], "START_CASCADE")
        self.assertIsNone(snapshot["events"][0]["sessionId"])

    def test_reads_multiple_jsonl_files_and_merges_passive_observations(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            start_path = pathlib.Path(tmpdir) / "csrf.jsonl"
            trace_path = pathlib.Path(tmpdir) / "runtime.jsonl"
            start_path.write_text(
                "\n".join([
                    '{"timestamp": "2026-05-02T12:00:00Z", "pid": 4001, "surface": "renderer", "event": "LanguageServerFetchRequest", "csrfToken": "csrf-999", "rpc": {"serviceMethodName": "StartCascade"}, "payload": {"sessionId": "session-999"}}',
                    '{"timestamp": "2026-05-02T12:00:01Z", "pid": 4001, "surface": "renderer", "event": "LanguageServerRpcCall", "rpc": {"serviceMethodName": "SendUserCascadeMessage"}, "payload": {"sessionId": "session-999"}}',
                ]),
                encoding="utf-8",
            )
            trace_path.write_text(
                '{"observed_at": "2026-05-02T12:00:02Z", "pid": 4001, "surface": "runtime_jsonl", "type": "TRACE_COUNT_DELTA", "payload": {"delta": 4, "sessionId": "session-999"}}',
                encoding="utf-8",
            )

            snapshot = module.observe_passive_cascade_from_jsonl([start_path, trace_path])

        self.assertEqual(snapshot["status"], "observed")
        self.assertEqual([event["type"] for event in snapshot["events"]], [
            "START_CASCADE",
            "SEND_USER_CASCADE_MESSAGE",
            "TRACE_COUNT_DELTA",
        ])
        self.assertEqual(snapshot["events"][0]["csrfToken"], "csrf-999")
        self.assertEqual(snapshot["events"][1]["precededBy"]["sessionId"], "session-999")
        self.assertEqual(snapshot["events"][2]["traceCount"], 4)
        self.assertEqual(snapshot["events"][0]["sourcePath"], str(start_path))
        self.assertEqual(snapshot["events"][2]["sourcePath"], str(trace_path))
        self.assertEqual(snapshot["evidenceSummary"], {
            "synthetic_reference": {
                "count": 3,
                "paths": [str(start_path), str(trace_path)],
                "reasons": ["path matches tmp/scratch/docs markers associated with replay, matrix, or reference artifacts"],
            }
        })

    def test_reads_plaintext_log_records_with_adjacent_explicit_session_id(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = pathlib.Path(tmpdir) / "Windsurf.log"
            log_path.write_text(
                "\n".join([
                    "2026-05-02 18:52:49.999 [info] session_id=windsurf-session-explicit-123",
                    "2026-05-02 18:52:50.000 [info] I0502 18:52:50.000000 14508 interceptor.go:78] /exa.language_server_pb.LanguageServerService/StartCascade (unknown): run state created",
                    "2026-05-02 18:52:50.001 [info] noise after rpc call",
                ]),
                encoding="utf-8",
            )

            records = module.read_plaintext_log_records(log_path)

        self.assertEqual(records, [
            {
                "event": "PlaintextLogRpcCall",
                "timestamp": "2026-05-02T18:52:50.000Z",
                "surface": "live_runtime_log",
                "pid": None,
                "rpc": {
                    "serviceTypeName": "exa.language_server_pb.LanguageServerService",
                    "serviceMethodName": "StartCascade",
                },
                "metadata": {
                    "sessionId": "windsurf-session-explicit-123",
                },
            }
        ])

    def test_discover_live_runtime_paths_includes_live_log_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            logs_root = pathlib.Path(tmpdir) / "Windsurf" / "logs" / "20260502T174337" / "window2" / "exthost" / "codeium.windsurf"
            logs_root.mkdir(parents=True)
            live_log = logs_root / "Windsurf.log"
            live_log.write_text(
                "2026-05-02 18:52:52.108 [info] E0502 18:52:52.108046 14508 interceptor.go:78] /exa.language_server_pb.LanguageServerService/SendUserCascadeMessage (unknown): run state not found\n",
                encoding="utf-8",
            )

            original_appdata = module.os.environ.get("APPDATA")
            try:
                module.os.environ["APPDATA"] = str(pathlib.Path(tmpdir))
                discovered = module.discover_live_runtime_paths()
            finally:
                if original_appdata is None:
                    module.os.environ.pop("APPDATA", None)
                else:
                    module.os.environ["APPDATA"] = original_appdata

        self.assertEqual(discovered, [live_log])

    def test_observe_preferred_passive_cascade_reads_live_log_files_without_json_decode_failure(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            logs_root = pathlib.Path(tmpdir) / "Windsurf" / "logs" / "20260502T174337" / "window2" / "exthost" / "codeium.windsurf"
            logs_root.mkdir(parents=True)
            live_log = logs_root / "Windsurf.log"
            live_log.write_text(
                "\n".join([
                    "2026-05-02 18:52:50.000 [info] I0502 18:52:50.000000 14508 interceptor.go:78] /exa.language_server_pb.LanguageServerService/StartCascade (unknown): run state created",
                    "2026-05-02 18:52:52.108 [info] E0502 18:52:52.108046 14508 interceptor.go:78] /exa.language_server_pb.LanguageServerService/SendUserCascadeMessage (unknown): run state not found",
                ]),
                encoding="utf-8",
            )

            original_appdata = module.os.environ.get("APPDATA")
            try:
                module.os.environ["APPDATA"] = str(pathlib.Path(tmpdir))
                snapshot = module.observe_preferred_passive_cascade()
            finally:
                if original_appdata is None:
                    module.os.environ.pop("APPDATA", None)
                else:
                    module.os.environ["APPDATA"] = original_appdata

        self.assertEqual(snapshot["status"], "observed")
        self.assertEqual([event["type"] for event in snapshot["events"]], [
            "START_CASCADE",
            "SEND_USER_CASCADE_MESSAGE",
        ])

    def test_reads_plaintext_log_records_with_adjacent_visible_jwt_session_id(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = pathlib.Path(tmpdir) / "Windsurf.log"
            log_path.write_text(
                "\n".join([
                    "2026-05-02 18:52:49.998 [info] devin-session-token$eyJhbGciOiJIUzI1NiJ9.eyJzZXNzaW9uX2lkIjoid2luZHN1cmYtc2Vzc2lvbi1qd3QtNzg5In0.signature",
                    "2026-05-02 18:52:50.000 [info] I0502 18:52:50.000000 14508 interceptor.go:78] /exa.language_server_pb.LanguageServerService/StartCascade (unknown): run state created",
                    "2026-05-02 18:52:50.001 [info] noise after rpc call",
                ]),
                encoding="utf-8",
            )

            records = module.read_plaintext_log_records(log_path)

        self.assertEqual(records, [
            {
                "event": "PlaintextLogRpcCall",
                "timestamp": "2026-05-02T18:52:50.000Z",
                "surface": "live_runtime_log",
                "pid": None,
                "rpc": {
                    "serviceTypeName": "exa.language_server_pb.LanguageServerService",
                    "serviceMethodName": "StartCascade",
                },
                "metadata": {
                    "sessionId": "windsurf-session-jwt-789",
                },
            }
        ])

    def test_plaintext_log_ignores_identity_hint_outside_three_line_window(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = pathlib.Path(tmpdir) / "Windsurf.log"
            log_path.write_text(
                "\n".join([
                    "sessionId=too-early",
                    "unrelated noise",
                    "2026-05-02 18:52:52.108 [info] /exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
                ]),
                encoding="utf-8",
            )

            snapshot = module.observe_passive_cascade_from_jsonl([log_path])

        self.assertEqual(snapshot["status"], "observed")
        self.assertIsNone(snapshot["events"][0]["sessionId"])

    def test_plaintext_log_conflicting_adjacent_identities_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = pathlib.Path(tmpdir) / "Windsurf.log"
            log_path.write_text(
                "\n".join([
                    "sessionId=session-one",
                    "2026-05-02 18:52:52.108 [info] /exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
                    "sessionId=session-two",
                ]),
                encoding="utf-8",
            )

            snapshot = module.observe_passive_cascade_from_jsonl([log_path])

        self.assertEqual(snapshot["status"], "observed")
        self.assertIsNone(snapshot["events"][0]["sessionId"])

    def test_plaintext_log_malformed_adjacent_jwt_stays_passive(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = pathlib.Path(tmpdir) / "Windsurf.log"
            log_path.write_text(
                "\n".join([
                    "2026-05-02 18:52:52.108 [info] /exa.language_server_pb.LanguageServerService/StartCascade",
                    "devin-session-token$not-a-jwt",
                ]),
                encoding="utf-8",
            )

            snapshot = module.observe_passive_cascade_from_jsonl([log_path])

        self.assertEqual(snapshot["status"], "observed")
        self.assertIsNone(snapshot["events"][0]["sessionId"])


if __name__ == "__main__":
    unittest.main()
