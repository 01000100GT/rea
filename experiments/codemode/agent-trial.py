"""Evaluate one real Codex CLI task with an isolated REA MCP registration."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['direct', 'client-code', 'bridge'], required=True)
    parser.add_argument('--prompt', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model', default='gpt-5.6-terra')
    parser.add_argument('--reasoning', default='high')
    parser.add_argument('--timeout', type=int, default=900)
    parser.add_argument('--codex', default='/usr/bin/codex')
    parser.add_argument('--providers', type=Path)
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[2]
    experiment = Path(__file__).resolve().parent
    node = shutil.which('node')
    if subprocess.check_output([node, '--version'], text=True).strip() != 'v24.18.0':
        raise SystemExit('Use pinned Node 24.18.0 on PATH')
    args.output.mkdir(parents=True, exist_ok=False, mode=0o700)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=args.output))
    trial_codex_home = profile / 'codex'
    account = profile / 'account'
    workspace = profile / 'workspace'
    for directory in [trial_codex_home, account, workspace]:
        directory.mkdir(mode=0o700)
    source_auth = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'auth.json'
    auth = trial_codex_home / 'auth.json'
    started = time.monotonic()
    timeout = False
    exit_code = None
    environment = dict(os.environ)
    environment.update({
        'CODEX_HOME': str(trial_codex_home), 'HOME': str(account),
        'XDG_CONFIG_HOME': str(account / '.config'),
        'XDG_CACHE_HOME': str(account / '.cache'),
        'XDG_DATA_HOME': str(account / '.local/share'),
        'NODE_OPTIONS': '--max-old-space-size=512',
    })
    provider_env = {'REA_LOG_LEVEL': 'silent', 'NODE_OPTIONS': '--max-old-space-size=512'}
    if args.providers:
        # This explicit caller file supplies only selected provider settings.
        provider_env.update(json.loads(args.providers.read_text()))
    command_args = [str(repository / 'scripts/rea.mjs'), 'mcp']
    if args.mode == 'bridge':
        command_args = [str(experiment / 'bridge.mjs'), node, *command_args]
    instruction = (
        'Use the registered REA MCP server for this investigation. Static analysis '
        'only: do not execute target code, fetch URLs, launch a GUI, or modify targets. '
        'Preserve observations, derivations, inferences, limitations, and real Evidence IDs. '
        'An Evidence value has evidence_id, normalized_result and limitations; '
        'non-Evidence session values have result. '
        'The analyzed target digest is Evidence.subject.digest.sha256. '
        'normalized_result.engine.artifact_sha256 identifies the analysis engine '
        'artifact and must never be substituted for the target digest. '
        'Prefer summary/focused views where appropriate. Do not invent successful facts '
        'after a tool error. No other agents. Stop once the requested facts are supported.'
    )
    if args.mode == 'bridge':
        instruction += (
            ' Original REA operations are available through rea_search and rea_execute. '
            'Discover tool names/schemas on demand. Execute JavaScript bodies using '
            'tools.<original_name>(original_arguments), json(reply) to parse the original '
            'MCP result, and return only the needed facts plus their Evidence IDs and '
            'limitations. Compose known dependent calls in one script when useful. '
            'Select needed fields from normalized_result inside the script; do not '
            'return entire Evidence, raw_result or full method/class inventories when '
            'the question requests a subset. '
            'Await every call; the upstream session persists across scripts.'
        )
    if args.mode == 'client-code':
        instruction += (
            ' Use the client JavaScript executor to compose registered MCP calls when '
            'possible and select the requested normalized_result fields before returning '
            'intermediate output to model context. Keep real Evidence IDs and limitations.'
        )
    quote = json.dumps
    config = '\n'.join([
        'approval_policy = "never"', 'sandbox_mode = "read-only"',
        'web_search = "disabled"', 'model = ' + quote(args.model),
        'model_reasoning_effort = ' + quote(args.reasoning),
        'developer_instructions = ' + quote(instruction),
        '[features]', 'multi_agent = false', 'shell_snapshot = false',
        'shell_tool = false', 'unified_exec = false',
        'code_mode = ' + ('true' if args.mode == 'client-code' else 'false'),
        'code_mode_only = ' + ('true' if args.mode == 'client-code' else 'false'),
        '[history]', 'persistence = "none"',
        '[mcp_servers.rea]', 'command = ' + quote(node),
        'args = ' + quote(command_args), 'startup_timeout_sec = 60',
        'tool_timeout_sec = 600', '[mcp_servers.rea.env]',
        *[key + ' = ' + quote(value) for key, value in provider_env.items()],
        '[mcp_servers.rea.tools.rea_execute]', 'approval_mode = "approve"',
    ]) + '\n'
    # MCP read-only hints cover normal static tools. Explicitly authorize only
    # the session-opening primitive needed by the requested native tasks.
    config += '[mcp_servers.rea.tools.open_binary]\napproval_mode = "approve"\n'
    for tool in ['analyze_javascript_application', 'inspect_analysis_view',
                 'inspect_android_package', 'search_android_classes',
                 'inspect_android_class', 'inspect_android_method',
                 'inspect_firmware_regions', 'inspect_managed_artifact',
                 'inspect_managed_member', 'analyze_function', 'close_binary']:
        config += '[mcp_servers.rea.tools.' + tool + ']\napproval_mode = "approve"\n'
    try:
        if source_auth.exists():
            shutil.copyfile(source_auth, auth)
            auth.chmod(0o600)
        (trial_codex_home / 'config.toml').write_text(config)
        (trial_codex_home / 'config.toml').chmod(0o600)
        prompt = args.prompt.read_text()
        (args.output / 'prompt.txt').write_text(prompt)
        (args.output / 'trial-settings.json').write_text(json.dumps({
            'mode': args.mode, 'model': args.model, 'reasoning': args.reasoning,
            'developer_instructions': instruction,
            'developer_instructions_sha256': hashlib.sha256(instruction.encode()).hexdigest(),
            'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
            'provider_settings_sha256': hashlib.sha256(
                json.dumps(provider_env, sort_keys=True).encode()).hexdigest(),
            'features': {'shell_tool': False, 'unified_exec': False,
                         'multi_agent': False, 'code_mode': args.mode == 'client-code',
                         'code_mode_only': args.mode == 'client-code'},
        }, indent=2) + '\n')
        invocation = [args.codex, '--no-daemon', 'exec', '--ephemeral',
                      '--skip-git-repo-check', '--ignore-rules', '--json',
                      '--color', 'never', '-C', str(workspace),
                      '--output-last-message', str(args.output.resolve() / 'answer.txt'), '-']
        with (args.output / 'events.jsonl').open('w') as events, (args.output / 'stderr.log').open('w') as errors:
            child = subprocess.Popen(invocation, env=environment, cwd=workspace,
                                     stdin=subprocess.PIPE, stdout=events, stderr=errors, text=True)
            child.stdin.write(prompt)
            child.stdin.close()
            try:
                exit_code = child.wait(timeout=args.timeout)
            except subprocess.TimeoutExpired:
                timeout = True
                child.terminate()
                try:
                    exit_code = child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    exit_code = child.wait()
        usage = []
        tools = []
        event_types = {}
        for line in (args.output / 'events.jsonl').read_text().splitlines():
            event = json.loads(line)
            kind = event.get('type', 'unknown')
            event_types[kind] = event_types.get(kind, 0) + 1
            if 'usage' in event:
                usage.append(event['usage'])
            item = event.get('item', {})
            if item.get('type') == 'mcp_tool_call' and kind == 'item.completed':
                tools.append({k: item.get(k) for k in ['server', 'tool', 'arguments', 'status', 'error']})
        summary = {
            'mode': args.mode, 'requested_model': args.model, 'reasoning': args.reasoning,
            'baseline_sha': 'fb94d9dde0ccda83ae520ac6fb22b1d283562cf3',
            'codex_version': subprocess.check_output([args.codex, '--version'], text=True).strip(),
            'exit_code': exit_code, 'timeout': timeout,
            'wall_seconds': round(time.monotonic() - started, 3),
            'usage': usage, 'completed_mcp_calls': tools, 'event_types': event_types,
            'factual_correctness': 'not_assessed',
            'scope': 'real_cli_trial_requires_transcript_and_fact_review',
        }
        (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
        print(json.dumps(summary))
    finally:
        # Always remove copied credentials, config, caches and profile state.
        shutil.rmtree(profile)
    raise SystemExit(124 if timeout else exit_code)


if __name__ == '__main__':
    main()
