# Contributing to Windsurf Authentication Toolkit

**Version:** 1.0.0
**Last Updated:** 2026-05-02T15:51:00Z
**Status:** Open for Contributions

---

## 🎯 Welcome Contributors!

Thank you for your interest in improving the Windsurf Authentication Toolkit! This guide will help you contribute effectively.

---

## 📋 Table of Contents

1. [Getting Started](#-getting-started)
2. [Development Setup](#-development-setup)
3. [Code Standards](#-code-standards)
4. [Testing Guidelines](#-testing-guidelines)
5. [Documentation Standards](#-documentation-standards)
6. [Contribution Workflow](#-contribution-workflow)
7. [Areas for Contribution](#-areas-for-contribution)
8. [Review Process](#-review-process)

---

## 🚀 Getting Started

### Prerequisites

Before contributing, ensure you have:

- [x] Python 3.8+ installed
- [x] Windsurf installed locally
- [x] Git configured
- [x] Read [README.md](README.md)
- [x] Read [WINDSURF_AUTH_FLOW.md](WINDSURF_AUTH_FLOW.md)
- [x] Tested the toolkit successfully

### First Steps

1. **Fork the repository**
   ```bash
   git clone https://github.com/your-username/omniroute.git
   cd omniroute/scripts
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run tests**
   ```bash
   python windsurf_auth_test_suite.py
   ```

4. **Verify everything works**
   ```bash
   python windsurf_quick_start.py --auto-launch
   ```

---

## 🛠️ Development Setup

### Environment Setup

```bash
# Create virtual environment
python -m venv venv

# Activate (Windows)
.\venv\Scripts\activate

# Activate (macOS/Linux)
source venv/bin/activate

# Install dependencies
pip install websockets aiohttp pytest black flake8 mypy

# Install pre-commit hooks (optional)
pip install pre-commit
pre-commit install
```

### Project Structure

```
scripts/
├── windsurf_quick_start.py          # Main entry point
├── windsurf_token_extractor.py      # Token extraction
├── windsurf_authenticated_probe.py  # Authentication testing
├── windsurf_cdp_inject.py           # CDP injection
├── windsurf_auth_test_suite.py      # Test suite
├── windsurf_direct_probe.py         # Direct LS probe
├── runtime_ls_state.py              # State management
├── README.md                        # Main documentation
├── CHEAT_SHEET.md                   # Quick reference
├── README_AUTH_TOOLKIT.md           # Complete guide
├── WINDSURF_AUTH_FLOW.md            # Auth flow guide
├── CDP_INJECTION_GUIDE.md           # CDP guide
├── INDEX.md                         # Navigation
├── EXECUTIVE_SUMMARY.md             # Research summary
├── INTEGRATION_GUIDE.md             # Integration guide
├── MAINTENANCE_GUIDE.md             # Maintenance guide
├── VISUAL_ARCHITECTURE.md           # Architecture diagrams
├── CONTRIBUTING.md                  # This file
└── requirements.txt                 # Python dependencies
```

---

## 📝 Code Standards

### Python Style Guide

We follow **PEP 8** with some modifications:

```python
# Good: Clear, documented, type-hinted
async def extract_tokens(
    cdp_port: int = 9222,
    timeout: int = 10
) -> dict[str, str]:
    """
    Extract authentication tokens from Windsurf renderer.

    Args:
        cdp_port: CDP port number (default: 9222)
        timeout: Timeout in seconds (default: 10)

    Returns:
        Dictionary with sessionId and csrfToken

    Raises:
        ConnectionError: If CDP is not available
        ValueError: If tokens are invalid
    """
    # Implementation
    pass

# Bad: No types, no docs, unclear
async def extract(port, t):
    # What does this do?
    pass
```

### Code Formatting

```bash
# Format with Black
black windsurf_token_extractor.py

# Check with flake8
flake8 windsurf_token_extractor.py

# Type check with mypy
mypy windsurf_token_extractor.py
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Functions | snake_case | `extract_tokens()` |
| Classes | PascalCase | `TokenManager` |
| Constants | UPPER_SNAKE | `DEFAULT_CDP_PORT` |
| Private | _prefix | `_internal_helper()` |
| Async | async prefix (optional) | `async_extract_tokens()` |

### Error Handling

```python
# Good: Specific exceptions, helpful messages
try:
    tokens = await extract_tokens(cdp_port=9222)
except ConnectionError as e:
    logger.error(f"CDP connection failed: {e}")
    raise RuntimeError(
        "Could not connect to CDP. "
        "Ensure Windsurf is running with --remote-debugging-port=9222"
    ) from e

# Bad: Bare except, silent failures
try:
    tokens = extract_tokens()
except:
    pass  # What went wrong?
```

### Logging

```python
import logging

logger = logging.getLogger(__name__)

# Good: Structured, informative
logger.info(
    "Tokens extracted successfully",
    extra={
        "sessionId": tokens["sessionId"][:10] + "...",
        "source": "localStorage",
        "duration_ms": duration
    }
)

# Bad: Unstructured, too verbose
print(f"Got tokens: {tokens}")  # Don't use print()
```

---

## 🧪 Testing Guidelines

### Test Structure

```python
import pytest
from windsurf_token_extractor import extract_tokens

class TestTokenExtraction:
    """Test suite for token extraction."""

    @pytest.mark.asyncio
    async def test_extract_from_local_storage(self):
        """Test extraction from localStorage."""
        tokens = await extract_tokens(source="localStorage")

        assert "sessionId" in tokens
        assert "csrfToken" in tokens
        assert len(tokens["sessionId"]) > 10

    @pytest.mark.asyncio
    async def test_extract_with_invalid_port(self):
        """Test extraction with invalid CDP port."""
        with pytest.raises(ConnectionError):
            await extract_tokens(cdp_port=9999)

    @pytest.mark.asyncio
    async def test_extract_with_timeout(self):
        """Test extraction timeout handling."""
        with pytest.raises(TimeoutError):
            await extract_tokens(timeout=0.1)
```

### Running Tests

```bash
# Run all tests
python windsurf_auth_test_suite.py

# Run specific test
pytest tests/test_token_extractor.py::TestTokenExtraction::test_extract_from_local_storage

# Run with coverage
pytest --cov=. --cov-report=html

# Run with verbose output
pytest -v
```

### Test Coverage

Aim for **>80% coverage** on new code:

```bash
# Generate coverage report
pytest --cov=. --cov-report=term-missing

# View HTML report
open htmlcov/index.html
```

---

## 📚 Documentation Standards

### Docstring Format

Use **Google-style docstrings**:

```python
def extract_tokens(cdp_port: int = 9222, timeout: int = 10) -> dict[str, str]:
    """
    Extract authentication tokens from Windsurf renderer via CDP.

    This function connects to the Windsurf renderer using Chrome DevTools
    Protocol and extracts sessionId and csrfToken from multiple sources
    including localStorage, sessionStorage, cookies, and HTTP headers.

    Args:
        cdp_port: CDP port number. Windsurf must be launched with
            --remote-debugging-port=<cdp_port>. Default: 9222.
        timeout: Maximum time to wait for extraction in seconds.
            Default: 10.

    Returns:
        Dictionary containing:
            - sessionId (str): Session identifier
            - csrfToken (str): CSRF protection token
            - timestamp (str): Extraction timestamp (ISO 8601)
            - source (str): Primary extraction source

    Raises:
        ConnectionError: If CDP is not available on the specified port.
        TimeoutError: If extraction exceeds the timeout.
        ValueError: If extracted tokens are invalid or incomplete.

    Example:
        >>> tokens = extract_tokens(cdp_port=9222, timeout=15)
        >>> print(tokens["sessionId"])
        'abc123...'

    Note:
        Windsurf must be running with an active Cascade session for
        token extraction to succeed.
    """
    pass
```

### Markdown Documentation

```markdown
# Feature Name

**Status:** ✅ Implemented | 🚧 In Progress | 📋 Planned

## Overview

Brief description of the feature (1-2 sentences).

## Usage

\`\`\`bash
# Basic usage
python script.py --option value

# Advanced usage
python script.py --option1 value1 --option2 value2
\`\`\`

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `--option` | str | None | Description |

## Examples

### Example 1: Basic Usage

\`\`\`bash
python script.py --option value
\`\`\`

**Expected output:**
\`\`\`
✅ Success
\`\`\`

## Troubleshooting

### Issue: Error message

**Solution:** How to fix it.

## See Also

- [Related Doc](link.md)
```

---

## 🔄 Contribution Workflow

### 1. Create a Branch

```bash
# Feature branch
git checkout -b feature/token-caching

# Bug fix branch
git checkout -b fix/cdp-connection-timeout

# Documentation branch
git checkout -b docs/improve-readme
```

### 2. Make Changes

```bash
# Edit files
vim windsurf_token_extractor.py

# Format code
black windsurf_token_extractor.py

# Run tests
python windsurf_auth_test_suite.py

# Check types
mypy windsurf_token_extractor.py
```

### 3. Commit Changes

```bash
# Stage changes
git add windsurf_token_extractor.py

# Commit with descriptive message
git commit -m "feat: Add token caching with TTL

- Implement in-memory cache with configurable TTL
- Add cache hit/miss metrics
- Update tests for caching behavior
- Document caching in README

Closes #123"
```

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting, missing semicolons, etc.
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance tasks

**Examples:**

```bash
# Feature
git commit -m "feat(extractor): Add WebSocket token extraction"

# Bug fix
git commit -m "fix(cdp): Handle connection timeout gracefully"

# Documentation
git commit -m "docs(readme): Add troubleshooting section"

# Refactor
git commit -m "refactor(probe): Extract validation logic to separate function"
```

### 4. Push Changes

```bash
# Push to your fork
git push origin feature/token-caching
```

### 5. Create Pull Request

1. Go to GitHub repository
2. Click "New Pull Request"
3. Select your branch
4. Fill in PR template:

```markdown
## Description

Brief description of changes.

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Refactoring

## Testing

- [ ] All existing tests pass
- [ ] New tests added (if applicable)
- [ ] Manual testing completed

## Checklist

- [ ] Code follows style guidelines
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] No breaking changes (or documented)

## Related Issues

Closes #123
```

---

## 🎯 Areas for Contribution

### High Priority

1. **Performance Optimization**
   - Reduce token extraction time
   - Implement parallel extraction
   - Optimize CDP queries

2. **Error Handling**
   - Better error messages
   - Automatic recovery strategies
   - Retry logic improvements

3. **Testing**
   - Increase test coverage
   - Add integration tests
   - Add performance benchmarks

### Medium Priority

4. **Features**
   - Token refresh automation
   - Multi-session support
   - Headless Windsurf support

5. **Documentation**
   - Video tutorials
   - More examples
   - Troubleshooting guides

6. **Tooling**
   - CI/CD pipeline
   - Automated releases
   - Docker support

### Low Priority

7. **Nice to Have**
   - GUI for token management
   - Browser extension
   - VS Code extension

---

## 🔍 Review Process

### What We Look For

1. **Code Quality**
   - Follows style guide
   - Well-documented
   - Type-hinted
   - Error handling

2. **Testing**
   - Tests pass
   - Coverage maintained/improved
   - Edge cases covered

3. **Documentation**
   - README updated
   - Docstrings complete
   - Examples provided

4. **Compatibility**
   - No breaking changes (or documented)
   - Backward compatible
   - Cross-platform tested

### Review Timeline

- **Initial Review:** Within 2 business days
- **Follow-up:** Within 1 business day
- **Merge:** After approval + CI passes

### Feedback Process

1. Reviewer leaves comments
2. Contributor addresses feedback
3. Reviewer re-reviews
4. Repeat until approved
5. Merge

---

## 🐛 Bug Reports

### Before Reporting

- [ ] Search existing issues
- [ ] Verify it's reproducible
- [ ] Test with latest version
- [ ] Collect debug information

### Bug Report Template

```markdown
## Bug Description

Clear description of the bug.

## Steps to Reproduce

1. Step 1
2. Step 2
3. Step 3

## Expected Behavior

What should happen.

## Actual Behavior

What actually happens.

## Environment

- OS: Windows 11 / macOS 14 / Ubuntu 22.04
- Python: 3.11.5
- Windsurf: 1.2.3
- Toolkit Version: 1.0.0

## Logs

\`\`\`
Paste relevant logs here
\`\`\`

## Additional Context

Any other relevant information.
```

---

## 💡 Feature Requests

### Feature Request Template

```markdown
## Feature Description

Clear description of the proposed feature.

## Use Case

Why is this feature needed? What problem does it solve?

## Proposed Solution

How should this feature work?

## Alternatives Considered

What other approaches did you consider?

## Additional Context

Any other relevant information.
```

---

## 📞 Getting Help

### Resources

- **Documentation:** [README.md](README.md)
- **Architecture:** [WINDSURF_AUTH_FLOW.md](WINDSURF_AUTH_FLOW.md)
- **Troubleshooting:** [MAINTENANCE_GUIDE.md](MAINTENANCE_GUIDE.md)

### Contact

- **Issues:** GitHub Issues
- **Discussions:** GitHub Discussions
- **Email:** dev-team@omniroute.com
- **Slack:** #omniroute-windsurf

---

## 🎓 Learning Resources

### Recommended Reading

1. **CDP (Chrome DevTools Protocol)**
   - [Official Documentation](https://chromedevtools.github.io/devtools-protocol/)
   - [CDP Viewer](https://chromedevtools.github.io/devtools-protocol/tot/)

2. **Electron**
   - [Electron Docs](https://www.electronjs.org/docs)
   - [Debugging Electron](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process)

3. **Python Async**
   - [asyncio Documentation](https://docs.python.org/3/library/asyncio.html)
   - [websockets Library](https://websockets.readthedocs.io/)

### Example Contributions

Look at these PRs for examples:

- **Feature:** PR #123 - Token caching
- **Bug Fix:** PR #124 - CDP timeout handling
- **Documentation:** PR #125 - Improved README

---

## ✅ Contribution Checklist

Before submitting a PR:

- [ ] Code follows style guide
- [ ] All tests pass
- [ ] New tests added (if applicable)
- [ ] Documentation updated
- [ ] Commit messages follow format
- [ ] No breaking changes (or documented)
- [ ] PR template filled out
- [ ] Self-review completed

---

## 🏆 Recognition

Contributors will be:

- Listed in CONTRIBUTORS.md
- Mentioned in release notes
- Credited in documentation

Top contributors may receive:

- Maintainer status
- Direct commit access
- Special recognition

---

## 📜 Code of Conduct

### Our Pledge

We pledge to make participation in our project a harassment-free experience for everyone.

### Our Standards

**Positive behavior:**
- Using welcoming language
- Being respectful of differing viewpoints
- Gracefully accepting constructive criticism
- Focusing on what is best for the community

**Unacceptable behavior:**
- Trolling, insulting/derogatory comments
- Public or private harassment
- Publishing others' private information
- Other conduct which could reasonably be considered inappropriate

### Enforcement

Violations may result in:
1. Warning
2. Temporary ban
3. Permanent ban

Report violations to: conduct@omniroute.com

---

## 📝 License

By contributing, you agree that your contributions will be licensed under the same license as the project.

---

## 🎉 Thank You!

Thank you for contributing to the Windsurf Authentication Toolkit! Your contributions help make this project better for everyone.

**Happy coding!** 🚀

---

**Last Updated:** 2026-05-02T15:51:00Z
**Version:** 1.0.0
**Status:** ✅ Active
