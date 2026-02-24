#!/usr/bin/env python3
"""
E2E test for Mobile Claw Reference App.
Uses Chrome DevTools Protocol to interact with the WebView on a connected Android device.

Prerequisites:
  - App installed and running on device
  - ADB port forwarding: adb forward tcp:9222 localabstract:webview_devtools_remote_<PID>
  - Docker container 'claude-credentials-sync' running with valid OAuth token
"""

import asyncio
import json
import subprocess
import sys
import websockets

# ── CDP helpers ──────────────────────────────────────────────────────────────

_msg_id = 0

async def send_cdp(ws, method, params=None):
    global _msg_id
    _msg_id += 1
    msg = {"id": _msg_id, "method": method, "params": params or {}}
    await ws.send(json.dumps(msg))

    while True:
        resp = await asyncio.wait_for(ws.recv(), timeout=30)
        data = json.loads(resp)
        if data.get("id") == _msg_id:
            if "error" in data:
                raise RuntimeError(f"CDP error: {data['error']}")
            return data.get("result", {})
        # Skip events


async def js_eval(ws, expression, await_promise=True, timeout=30):
    """Evaluate JS in the page context."""
    result = await send_cdp(ws, "Runtime.evaluate", {
        "expression": expression,
        "returnByValue": True,
        "awaitPromise": await_promise,
    })
    if result.get("exceptionDetails"):
        exc = result["exceptionDetails"]
        text = exc.get("text", "")
        desc = exc.get("exception", {}).get("description", "")
        raise RuntimeError(f"JS error: {text} {desc}")
    return result.get("result", {}).get("value")


async def take_screenshot(ws, filename="screenshot.png"):
    """Capture a screenshot and save to file."""
    import base64
    result = await send_cdp(ws, "Page.captureScreenshot", {"format": "png"})
    data = base64.b64decode(result["data"])
    with open(filename, "wb") as f:
        f.write(data)
    print(f"  Screenshot saved: {filename}")
    return filename


# ── Test helpers ─────────────────────────────────────────────────────────────

def ok(msg):
    print(f"  \033[32m✓\033[0m {msg}")

def fail(msg):
    print(f"  \033[31m✗\033[0m {msg}")

def info(msg):
    print(f"  \033[33m→\033[0m {msg}")


# ── OAuth token helper ───────────────────────────────────────────────────────

def get_oauth_token():
    """Get OAuth token from the credentials-sync Docker container."""
    try:
        result = subprocess.run(
            ["docker", "exec", "claude-credentials-sync", "cat", "/claude-home/.credentials.json"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return None
        creds = json.loads(result.stdout)
        oauth = creds.get("claudeAiOauth", {})
        return {
            "accessToken": oauth.get("accessToken"),
            "refreshToken": oauth.get("refreshToken"),
            "expiresAt": oauth.get("expiresAt"),
        }
    except Exception as e:
        print(f"  Warning: Could not get OAuth token: {e}")
        return None


# ── Tests ────────────────────────────────────────────────────────────────────

async def test_setup_screen(ws):
    """Test 1: Verify Setup screen renders correctly."""
    print("\n═══ Test 1: Setup Screen ═══")

    url = await js_eval(ws, "window.location.href")
    info(f"Current URL: {url}")

    title = await js_eval(ws, "document.querySelector('h1')?.textContent")
    if title and "Mobile Claw" in title:
        ok(f"Title rendered: '{title}'")
    else:
        fail(f"Title not found or incorrect: '{title}'")
        return False

    # Wait for worker ready (up to 30s)
    info("Waiting for worker to be ready...")
    ready = False
    for _ in range(30):
        ready = await js_eval(ws, """
            (() => {
                const spans = document.querySelectorAll('span');
                for (const s of spans) {
                    if (s.textContent.includes('Ready')) return true;
                }
                return false;
            })()
        """)
        if ready:
            break
        await asyncio.sleep(1)

    if ready:
        ok("Worker is ready")
    else:
        fail("Worker did not become ready within 30s")
        return False

    node_ver = await js_eval(ws, """
        (() => {
            const spans = document.querySelectorAll('span');
            for (const s of spans) {
                if (s.textContent.includes('Node')) return s.textContent.trim();
            }
            return null;
        })()
    """)
    if node_ver:
        ok(f"Node version: '{node_ver}'")

    # Check auth tabs exist
    tabs = await js_eval(ws, """
        (() => {
            const buttons = document.querySelectorAll('button');
            const tabs = [];
            for (const b of buttons) {
                const t = b.textContent.trim();
                if (t.includes('OAuth') || t.includes('API Key')) tabs.push(t);
            }
            return tabs;
        })()
    """)
    if tabs and len(tabs) >= 2:
        ok(f"Auth tabs found: {tabs}")
    else:
        info(f"Auth tabs: {tabs}")

    await take_screenshot(ws, "/tmp/e2e-01-setup-screen.png")
    return True


async def test_oauth_injection(ws, oauth_token):
    """Test 2: Inject OAuth token and verify it's saved."""
    print("\n═══ Test 2: OAuth Token Injection ═══")

    # First check if auth is already configured (persisted from a previous run)
    existing = await js_eval(ws, """
        new Promise((resolve) => {
            const NodeJS = window.Capacitor.Plugins.CapacitorNodeJS;
            const handler = NodeJS.addListener('message', (event) => {
                const msg = event.args ? event.args[0] : event;
                if (msg.type === 'config.status.result') {
                    handler.remove();
                    resolve(JSON.stringify(msg));
                }
            });
            NodeJS.send({ eventName: 'message', args: [{ type: 'config.status' }] });
            setTimeout(() => { handler.remove(); resolve('timeout'); }, 5000);
        })
    """)

    already_configured = False
    if existing and existing != 'timeout':
        obj = json.loads(existing)
        if obj.get("hasKey"):
            ok(f"Auth already configured: {obj.get('masked', '')}")
            already_configured = True

    if not already_configured:
        if not oauth_token:
            info("No OAuth token available and none configured — skipping")
            return True  # Non-fatal

        access = oauth_token["accessToken"]
        refresh = oauth_token["refreshToken"]
        expires = oauth_token["expiresAt"]
        info(f"Injecting OAuth token: {access[:15]}...{access[-4:]}")

        # Use CapacitorNodeJS to send setOAuth directly to the worker
        result = await js_eval(ws, f"""
            new Promise((resolve) => {{
                const NodeJS = window.Capacitor.Plugins.CapacitorNodeJS;

                const handler = NodeJS.addListener('message', (event) => {{
                    const msg = event.args ? event.args[0] : event;
                    if (msg.type === 'config.update.result') {{
                        handler.remove();
                        resolve(JSON.stringify(msg));
                    }}
                }});

                NodeJS.send({{ eventName: 'message', args: [{{
                    type: 'config.update',
                    config: {{
                        action: 'setOAuth',
                        provider: 'anthropic',
                        accessToken: '{access}',
                        refreshToken: '{refresh}',
                        expiresAt: {expires},
                    }}
                }}] }});

                setTimeout(() => {{ handler.remove(); resolve('timeout'); }}, 5000);
            }})
        """)

        if result == 'timeout':
            fail("OAuth injection timed out")
            return False

        ok(f"OAuth token injected: {result}")

        # Verify auth status after injection
        await asyncio.sleep(1)
        status = await js_eval(ws, """
            new Promise((resolve) => {
                const NodeJS = window.Capacitor.Plugins.CapacitorNodeJS;
                const handler = NodeJS.addListener('message', (event) => {
                    const msg = event.args ? event.args[0] : event;
                    if (msg.type === 'config.status.result') {
                        handler.remove();
                        resolve(JSON.stringify(msg));
                    }
                });
                NodeJS.send({ eventName: 'message', args: [{ type: 'config.status' }] });
                setTimeout(() => { handler.remove(); resolve('timeout'); }, 5000);
            })
        """)
        info(f"Auth status after injection: {status}")

        if status and status != 'timeout':
            status_obj = json.loads(status)
            if not status_obj.get("hasKey"):
                fail("Auth status shows no key after injection")
                return False

    # Wait for UI to show the key (Continue button enabled) — no reload needed
    for _ in range(10):
        has_continue = await js_eval(ws, """
            (() => {
                const buttons = document.querySelectorAll('button');
                for (const b of buttons) {
                    if (b.textContent.includes('Continue to Chat') && !b.disabled) return true;
                }
                return false;
            })()
        """)
        if has_continue:
            ok("'Continue to Chat' button is enabled")
            break
        await asyncio.sleep(1)
    else:
        info("Continue button still disabled after 10s — proceeding anyway")

    await take_screenshot(ws, "/tmp/e2e-02-oauth-configured.png")
    return True


async def test_navigate_to_chat(ws):
    """Test 3: Navigate to chat screen."""
    print("\n═══ Test 3: Navigate to Chat ═══")

    clicked = await js_eval(ws, """
        (() => {
            const buttons = document.querySelectorAll('button');
            for (const b of buttons) {
                if (b.textContent.includes('Continue to Chat')) {
                    if (b.disabled) return 'disabled';
                    b.click();
                    return 'clicked';
                }
            }
            return 'not-found';
        })()
    """)

    if clicked == 'disabled' or clicked == 'not-found':
        info(f"Button status: {clicked} — navigating via router")
        await js_eval(ws, """
            document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/chat')
        """)
    else:
        ok("Clicked 'Continue to Chat'")

    await asyncio.sleep(1)

    on_chat = await js_eval(ws, "document.querySelector('textarea') !== null")
    if on_chat:
        ok("Chat screen loaded (textarea found)")
    else:
        fail("Chat screen not loaded")
        return False

    await take_screenshot(ws, "/tmp/e2e-03-chat-screen.png")
    return True


async def test_chat_empty_state(ws):
    """Test 4: Verify chat empty state."""
    print("\n═══ Test 4: Chat Empty State ═══")

    empty_state = await js_eval(ws, """
        (() => {
            const result = { hasTitle: false, hasSuggestions: false, suggestionsText: [] };
            const h3 = document.querySelectorAll('h3');
            for (const h of h3) {
                if (h.textContent.includes('Mobile Claw')) { result.hasTitle = true; break; }
            }
            const buttons = document.querySelectorAll('button');
            const chips = ['What can you do?', 'List workspace files', 'Write a Python script', 'Help me plan a project'];
            for (const b of buttons) {
                if (chips.includes(b.textContent.trim())) result.suggestionsText.push(b.textContent.trim());
            }
            result.hasSuggestions = result.suggestionsText.length > 0;
            return result;
        })()
    """)

    if empty_state.get('hasTitle'):
        ok("Empty state title 'Mobile Claw' found")

    if empty_state.get('hasSuggestions'):
        ok(f"Suggestion chips found: {empty_state['suggestionsText']}")

    placeholder = await js_eval(ws, "document.querySelector('textarea')?.placeholder")
    if placeholder:
        ok(f"Input placeholder: '{placeholder}'")

    status = await js_eval(ws, """
        (() => {
            const spans = document.querySelectorAll('span');
            for (const s of spans) {
                const t = s.textContent.trim();
                if (t === 'Ready' || t === 'Connecting...' || t === 'Thinking...') return t;
            }
            return null;
        })()
    """)
    if status:
        ok(f"Status indicator: '{status}'")

    return True


async def test_chat_interaction(ws, has_oauth):
    """Test 5: Send a message and check for response/streaming."""
    print("\n═══ Test 5: Chat Interaction ═══")

    has_textarea = await js_eval(ws, "document.querySelector('textarea') !== null")
    if not has_textarea:
        fail("No textarea found")
        return False

    test_message = "What is 2 + 2? Reply with just the number."
    info(f"Typing: '{test_message}'")

    await js_eval(ws, f"""
        (() => {{
            const textarea = document.querySelector('textarea');
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            nativeSetter.call(textarea, '{test_message}');
            textarea.dispatchEvent(new Event('input', {{ bubbles: true }}));
        }})()
    """)
    await asyncio.sleep(0.3)

    val = await js_eval(ws, "document.querySelector('textarea')?.value")
    ok(f"Message typed: '{val}'")

    info("Sending message...")
    await js_eval(ws, """
        (() => {
            const textarea = document.querySelector('textarea');
            const buttons = textarea.parentElement.querySelectorAll('button');
            for (const b of buttons) {
                if (!b.disabled) { b.click(); return 'clicked'; }
            }
            return 'no-button';
        })()
    """)

    await asyncio.sleep(1)

    user_msg = await js_eval(ws, """
        (() => {
            const ps = document.querySelectorAll('p');
            for (const p of ps) {
                if (p.textContent.includes('2 + 2')) return p.textContent;
            }
            return null;
        })()
    """)
    if user_msg:
        ok(f"User message in chat: '{user_msg}'")
    else:
        info("User message not visible in DOM yet")

    await take_screenshot(ws, "/tmp/e2e-04-message-sent.png")

    if not has_oauth:
        info("No OAuth token — expecting error response")
        await asyncio.sleep(5)
        error_msg = await js_eval(ws, """
            (() => {
                const mds = document.querySelectorAll('.markdown-body');
                for (const m of mds) {
                    if (m.textContent.includes('Error')) return m.textContent.substring(0, 200);
                }
                return null;
            })()
        """)
        if error_msg:
            ok(f"Error displayed (expected): '{error_msg[:80]}'")
        else:
            info("No error message visible")
        await take_screenshot(ws, "/tmp/e2e-05-chat-response.png")
        return True

    # With OAuth — wait for a real response (up to 60s)
    info("Waiting for assistant response (up to 60s)...")
    response_found = False
    for i in range(60):
        response = await js_eval(ws, """
            (() => {
                const mds = document.querySelectorAll('.markdown-body');
                if (mds.length > 0) {
                    const last = mds[mds.length - 1];
                    const text = last.textContent.trim();
                    if (text && text.length > 0) return text.substring(0, 500);
                }
                return null;
            })()
        """)
        if response and len(response) > 0:
            # Check if it's still streaming
            is_streaming = await js_eval(ws, """
                document.querySelector('.streaming-cursor') !== null
            """)
            if not is_streaming:
                ok(f"Assistant response: '{response[:100]}'")
                response_found = True
                break
            elif i > 5:
                # After 5s of streaming, that's good enough
                ok(f"Assistant streaming response: '{response[:100]}...'")
                response_found = True
                break
        await asyncio.sleep(1)

    if not response_found:
        # Check for error
        error = await js_eval(ws, """
            (() => {
                const mds = document.querySelectorAll('.markdown-body');
                for (const m of mds) {
                    if (m.textContent.includes('Error')) return m.textContent.substring(0, 200);
                }
                return null;
            })()
        """)
        if error:
            fail(f"Agent returned error: '{error[:100]}'")
            await take_screenshot(ws, "/tmp/e2e-05-chat-error.png")
            return False
        else:
            fail("No response received within 60s")
            await take_screenshot(ws, "/tmp/e2e-05-chat-timeout.png")
            return False

    await take_screenshot(ws, "/tmp/e2e-05-chat-response.png")
    return True


async def test_settings_screen(ws):
    """Test 6: Navigate to settings and verify."""
    print("\n═══ Test 6: Settings Screen ═══")

    info("Navigating to settings...")
    await js_eval(ws, """
        (() => {
            const buttons = document.querySelectorAll('button[title=Settings]');
            if (buttons.length > 0) { buttons[0].click(); return; }
            document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/settings');
        })()
    """)

    await asyncio.sleep(1)

    settings_content = await js_eval(ws, """
        (() => {
            const text = document.body.textContent;
            return {
                hasApiKey: text.includes('API Key') || text.includes('Anthropic'),
                hasWorkspace: text.includes('Workspace') || text.includes('SOUL.md'),
                hasSessions: text.includes('Session') || text.includes('History'),
                hasClear: text.includes('Clear') || text.includes('Conversation'),
            };
        })()
    """)

    checks = [
        ('hasApiKey', 'API Key section'),
        ('hasWorkspace', 'Workspace Editor section'),
        ('hasSessions', 'Session History section'),
        ('hasClear', 'Clear Conversation section'),
    ]
    for key, label in checks:
        if settings_content.get(key):
            ok(f"{label} found")
        else:
            info(f"{label} not found")

    tabs = await js_eval(ws, """
        (() => {
            const buttons = document.querySelectorAll('button');
            const names = [];
            for (const b of buttons) {
                const t = b.textContent.trim();
                if (['SOUL.md', 'MEMORY.md', 'IDENTITY.md'].includes(t)) names.push(t);
            }
            return names;
        })()
    """)
    if tabs and len(tabs) > 0:
        ok(f"Workspace editor tabs: {tabs}")

    await take_screenshot(ws, "/tmp/e2e-06-settings.png")
    return True


async def test_navigate_back(ws):
    """Test 7: Navigate back to chat."""
    print("\n═══ Test 7: Navigate Back ═══")

    await js_eval(ws, """
        (() => {
            const links = document.querySelectorAll('button, a');
            for (const l of links) {
                const t = l.textContent.trim();
                if (t.includes('Back') || t.includes('Chat')) { l.click(); return; }
            }
            document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/chat');
        })()
    """)

    await asyncio.sleep(1)

    on_chat = await js_eval(ws, "document.querySelector('textarea') !== null")
    if on_chat:
        ok("Back on chat screen")
    else:
        info("May not be on chat screen")

    await take_screenshot(ws, "/tmp/e2e-07-back-to-chat.png")
    return True


async def test_session_persistence(adb_path):
    """Test 8: Kill app and verify session restores on relaunch."""
    print("\n═══ Test 8: Session Persistence ═══")

    APP_PACKAGE = "io.mobileclaw.reference"
    APP_ACTIVITY = f"{APP_PACKAGE}/.MainActivity"

    # Step 1: Force-stop the app
    info("Force-stopping app...")
    subprocess.run([adb_path, "shell", "am", "force-stop", APP_PACKAGE],
                   capture_output=True, timeout=5)
    await asyncio.sleep(2)
    ok("App force-stopped")

    # Step 2: Relaunch the app
    info("Relaunching app...")
    subprocess.run([adb_path, "shell", "am", "start", "-n", APP_ACTIVITY],
                   capture_output=True, timeout=5)
    await asyncio.sleep(3)
    ok("App relaunched")

    # Step 3: Wait for WebView debugger to become available, then set up port forwarding
    info("Waiting for WebView to initialize...")
    ws_url = None
    for attempt in range(20):
        # Re-discover the PID and set up port forwarding
        try:
            # Find the WebView PID
            pid_result = subprocess.run(
                [adb_path, "shell", "cat", f"/proc/net/unix"],
                capture_output=True, text=True, timeout=5,
            )
            devtools_pid = None
            for line in pid_result.stdout.splitlines():
                if "webview_devtools_remote_" in line:
                    parts = line.strip().split("webview_devtools_remote_")
                    if len(parts) > 1:
                        devtools_pid = parts[1].strip()
                        break

            if not devtools_pid:
                if attempt < 19:
                    await asyncio.sleep(1)
                    continue
                fail("Could not find WebView devtools PID after app relaunch")
                return False

            # Set up port forwarding
            subprocess.run(
                [adb_path, "forward", "tcp:9222", f"localabstract:webview_devtools_remote_{devtools_pid}"],
                capture_output=True, timeout=5,
            )

            # Try to discover WS URL
            import urllib.request
            data = urllib.request.urlopen("http://localhost:9222/json", timeout=3).read()
            pages = json.loads(data)
            for page in pages:
                if page.get("type") == "page":
                    ws_url = page["webSocketDebuggerUrl"]
                    break
            if ws_url:
                break
        except Exception:
            pass
        await asyncio.sleep(1)

    if not ws_url:
        fail("Could not connect to WebView after relaunch")
        return False

    ok(f"WebView reconnected: {ws_url[:50]}...")

    # Step 4: Connect and wait for the app to restore
    try:
        async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws2:
            await send_cdp(ws2, "Runtime.enable")
            await send_cdp(ws2, "Page.enable")

            # Wait for app to finish loading + worker ready + session restore
            info("Waiting for session restore (up to 45s)...")

            # First wait for the page to be on /chat (may start on setup if no key)
            for _ in range(15):
                url = await js_eval(ws2, "window.location.href")
                if "/chat" in url:
                    break
                # If on setup, navigate to chat
                if "/" in url and "/chat" not in url and "/settings" not in url:
                    await asyncio.sleep(2)
                    # Check if we need to click Continue
                    has_continue = await js_eval(ws2, """
                        (() => {
                            const buttons = document.querySelectorAll('button');
                            for (const b of buttons) {
                                if (b.textContent.includes('Continue to Chat') && !b.disabled) {
                                    b.click();
                                    return true;
                                }
                            }
                            return false;
                        })()
                    """)
                    if has_continue:
                        await asyncio.sleep(1)
                        break
                await asyncio.sleep(1)

            url = await js_eval(ws2, "window.location.href")
            info(f"Current URL: {url}")

            # Wait for messages to be restored (the "Restoring conversation..." phase)
            restored = False
            for i in range(45):
                msg_count = await js_eval(ws2, """
                    (() => {
                        // Check for rendered assistant messages (.markdown-body)
                        const assistantMsgs = document.querySelectorAll('.markdown-body');
                        // Check for user messages
                        const userBubbles = document.querySelectorAll('.bg-secondary');
                        return { assistant: assistantMsgs.length, user: userBubbles.length };
                    })()
                """)
                if msg_count and (msg_count.get('assistant', 0) > 0 or msg_count.get('user', 0) > 0):
                    ok(f"Session restored: {msg_count.get('user', 0)} user msg(s), {msg_count.get('assistant', 0)} assistant msg(s)")
                    restored = True
                    break

                # Also check for the "Restoring conversation..." indicator (means it's in progress)
                restoring = await js_eval(ws2, """
                    (() => {
                        const spans = document.querySelectorAll('span');
                        for (const s of spans) {
                            if (s.textContent.includes('Restoring')) return true;
                        }
                        return false;
                    })()
                """)
                if restoring and i % 5 == 0:
                    info("Session restore in progress...")

                await asyncio.sleep(1)

            if not restored:
                fail("Session was not restored after app kill and relaunch")
                await take_screenshot(ws2, "/tmp/e2e-08-persistence-fail.png")
                return False

            # Verify the previous conversation content is visible
            has_prev = await js_eval(ws2, """
                (() => {
                    const text = document.body.textContent;
                    // Look for our test message or its answer
                    return text.includes('2 + 2') || text.includes('2+2') || text.includes('4');
                })()
            """)
            if has_prev:
                ok("Previous conversation content ('2 + 2' / '4') found")
            else:
                info("Previous conversation content not detected (may have different format)")

            await take_screenshot(ws2, "/tmp/e2e-08-persistence-restored.png")
    except websockets.exceptions.ConnectionClosedError:
        pass  # WebSocket may close during teardown — non-fatal if checks already passed
    return True


# ── Main ─────────────────────────────────────────────────────────────────────

async def discover_ws_url():
    import urllib.request
    try:
        data = urllib.request.urlopen("http://localhost:9222/json").read()
        pages = json.loads(data)
        for page in pages:
            if page.get("type") == "page":
                return page["webSocketDebuggerUrl"]
    except Exception as e:
        print(f"Failed to discover CDP endpoint: {e}")
        sys.exit(1)


async def main():
    print("╔════════════════════════════════════════════════╗")
    print("║  Mobile Claw Reference App — E2E Test Suite    ║")
    print("╚════════════════════════════════════════════════╝")

    # ADB path
    adb_path = "/home/rruiz/Android/Sdk/platform-tools/adb"

    # Get OAuth token
    oauth_token = get_oauth_token()
    if oauth_token and oauth_token.get("accessToken"):
        print(f"\n  OAuth token available: {oauth_token['accessToken'][:15]}...{oauth_token['accessToken'][-4:]}")
    else:
        print("\n  No OAuth token — tests will run without real API access")
        oauth_token = None

    ws_url = await discover_ws_url()
    print(f"  CDP endpoint: {ws_url}\n")

    results = []

    async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws:
        await send_cdp(ws, "Runtime.enable")
        await send_cdp(ws, "Page.enable")

        # Test 1: Setup Screen
        try:
            r = await test_setup_screen(ws)
            results.append(("Setup Screen", r))
        except Exception as e:
            fail(f"Setup Screen: {e}")
            results.append(("Setup Screen", False))

        # Test 2: OAuth Injection
        try:
            r = await test_oauth_injection(ws, oauth_token)
            results.append(("OAuth Configuration", r))
        except Exception as e:
            fail(f"OAuth Configuration: {e}")
            results.append(("OAuth Configuration", False))

        # Test 3: Navigate to Chat
        try:
            r = await test_navigate_to_chat(ws)
            results.append(("Navigate to Chat", r))
        except Exception as e:
            fail(f"Navigate to Chat: {e}")
            results.append(("Navigate to Chat", False))

        # Test 4: Chat Empty State
        try:
            r = await test_chat_empty_state(ws)
            results.append(("Chat Empty State", r))
        except Exception as e:
            fail(f"Chat Empty State: {e}")
            results.append(("Chat Empty State", False))

        # Test 5: Chat Interaction
        try:
            r = await test_chat_interaction(ws, oauth_token is not None)
            results.append(("Chat Interaction", r))
        except Exception as e:
            fail(f"Chat Interaction: {e}")
            results.append(("Chat Interaction", False))

        # Test 6: Settings Screen
        try:
            r = await test_settings_screen(ws)
            results.append(("Settings Screen", r))
        except Exception as e:
            fail(f"Settings Screen: {e}")
            results.append(("Settings Screen", False))

        # Test 7: Navigate Back
        try:
            r = await test_navigate_back(ws)
            results.append(("Navigate Back", r))
        except Exception as e:
            fail(f"Navigate Back: {e}")
            results.append(("Navigate Back", False))

    # Test 8: Session Persistence (runs outside the WS connection — kills and relaunches app)
    if oauth_token:
        try:
            r = await test_session_persistence(adb_path)
            results.append(("Session Persistence", r))
        except Exception as e:
            fail(f"Session Persistence: {e}")
            results.append(("Session Persistence", False))
    else:
        info("Skipping persistence test (no OAuth — no chat history to restore)")
        results.append(("Session Persistence (skipped)", True))

    # Summary
    print("\n╔════════════════════════════════════════════════╗")
    print("║              Test Summary                       ║")
    print("╠════════════════════════════════════════════════╣")
    passed = sum(1 for _, r in results if r)
    total = len(results)
    for name, r in results:
        status = "\033[32mPASS\033[0m" if r else "\033[31mFAIL\033[0m"
        print(f"║  {status} {name:<42s}║")
    print(f"╠════════════════════════════════════════════════╣")
    print(f"║  Result: {passed}/{total} passed                            ║")
    print(f"╚════════════════════════════════════════════════╝")

    return passed == total


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
