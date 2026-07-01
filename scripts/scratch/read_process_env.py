import ctypes
import ctypes.wintypes as w
import json
import sys

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010

ntdll = ctypes.WinDLL("ntdll")
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)


class PROCESS_BASIC_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("Reserved1", w.LPVOID),
        ("PebBaseAddress", w.LPVOID),
        ("Reserved2_0", w.LPVOID),
        ("Reserved2_1", w.LPVOID),
        ("UniqueProcessId", w.LPVOID),
        ("Reserved3", w.LPVOID),
    ]


OpenProcess = kernel32.OpenProcess
OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
OpenProcess.restype = w.HANDLE

ReadProcessMemory = kernel32.ReadProcessMemory
ReadProcessMemory.argtypes = [w.HANDLE, w.LPCVOID, w.LPVOID, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
ReadProcessMemory.restype = w.BOOL

CloseHandle = kernel32.CloseHandle
CloseHandle.argtypes = [w.HANDLE]
CloseHandle.restype = w.BOOL

NtQueryInformationProcess = ntdll.NtQueryInformationProcess
NtQueryInformationProcess.argtypes = [w.HANDLE, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong)]
NtQueryInformationProcess.restype = ctypes.c_ulong

PTR_SIZE = ctypes.sizeof(ctypes.c_void_p)
PEB_PROCESS_PARAMETERS_OFFSET = 0x20 if PTR_SIZE == 8 else 0x10
PROCESS_PARAMETERS_ENV_OFFSET = 0x80 if PTR_SIZE == 8 else 0x48


def read_mem(handle: int, address: int, size: int) -> bytes:
    buf = (ctypes.c_ubyte * size)()
    bytes_read = ctypes.c_size_t()
    ok = ReadProcessMemory(handle, ctypes.c_void_p(address), buf, size, ctypes.byref(bytes_read))
    if not ok:
        raise OSError(ctypes.get_last_error())
    return bytes(buf[: bytes_read.value])


def read_ptr(handle: int, address: int) -> int:
    data = read_mem(handle, address, PTR_SIZE)
    return int.from_bytes(data, "little")


def read_env(pid: int) -> dict[str, str]:
    handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not handle:
        raise OSError(ctypes.get_last_error())

    try:
        pbi = PROCESS_BASIC_INFORMATION()
        return_length = ctypes.c_ulong()
        status = NtQueryInformationProcess(
            handle,
            0,
            ctypes.byref(pbi),
            ctypes.sizeof(pbi),
            ctypes.byref(return_length),
        )
        if status != 0:
            raise OSError(f"NtQueryInformationProcess status={status}")

        peb = ctypes.cast(pbi.PebBaseAddress, ctypes.c_void_p).value
        if peb is None:
            raise RuntimeError("PEB address missing")

        proc_params = read_ptr(handle, peb + PEB_PROCESS_PARAMETERS_OFFSET)
        env_ptr = read_ptr(handle, proc_params + PROCESS_PARAMETERS_ENV_OFFSET)
        if not env_ptr:
            raise RuntimeError("Environment pointer missing")

        data = bytearray()
        chunk_size = 4096
        found = False
        for i in range(64):
            data.extend(read_mem(handle, env_ptr + i * chunk_size, chunk_size))
            for j in range(0, len(data) - 3, 2):
                if data[j : j + 4] == b"\x00\x00\x00\x00":
                    data = data[: j + 2]
                    found = True
                    break
            if found:
                break

        if not found:
            raise RuntimeError("Environment terminator not found")

        text = data.decode("utf-16-le", errors="replace")
        pairs: dict[str, str] = {}
        for entry in text.split("\x00"):
            if not entry:
                continue
            if "=" not in entry[1:]:
                continue
            key, value = entry.split("=", 1)
            pairs[key] = value
        return pairs
    finally:
        CloseHandle(handle)


def summarize(pid: int) -> dict[str, object]:
    pairs = read_env(pid)
    return {
        "pid": pid,
        "success": True,
        "variableCount": len(pairs),
        "interesting": {
            "NODE_OPTIONS": pairs.get("NODE_OPTIONS"),
            "VSCODE_NODE_OPTIONS": pairs.get("VSCODE_NODE_OPTIONS"),
            "ELECTRON_RUN_AS_NODE": pairs.get("ELECTRON_RUN_AS_NODE"),
            "WINDSURF_TRACE_SCENARIO": pairs.get("WINDSURF_TRACE_SCENARIO"),
            "WINDSURF_USER_DATA_DIR": pairs.get("WINDSURF_USER_DATA_DIR"),
            "WINDSURF_DEBUG_ELECTRON": pairs.get("WINDSURF_DEBUG_ELECTRON"),
        },
        "windsurfKeys": [
            {"key": key, "value": pairs[key]}
            for key in sorted(pairs)
            if key.startswith("WIND")
        ],
        "pathPresent": "PATH" in pairs,
        "comSpecPresent": "ComSpec" in pairs,
    }


if __name__ == "__main__":
    pids = [int(arg) for arg in sys.argv[1:]]
    results: list[dict[str, object]] = []
    for pid in pids:
        try:
            results.append(summarize(pid))
        except Exception as exc:
            results.append({"pid": pid, "success": False, "error": str(exc)})
    print(json.dumps(results, indent=2))
